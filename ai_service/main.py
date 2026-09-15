from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from pydantic import BaseModel
from starlette.requests import Request
from starlette.responses import JSONResponse, StreamingResponse
import asyncio
import os
import shutil
import json
import re
import traceback
import queue
import threading
from dotenv import load_dotenv
from typing import Optional, List, Callable

# IMPORTANT: Load environment variables BEFORE importing rag_utils.
# override=True is critical: when uvicorn --reload re-imports this module
# after a code edit, the OLD env vars are still in os.environ. Without
# override the dotenv read is a no-op and key rotations (e.g. swapping a
# spent GROQ_API_KEY) silently fail to take effect. With override, the
# .env file is the source of truth on every reload.
load_dotenv(override=True)

from net_utils import prefer_ipv4_dns
prefer_ipv4_dns()

import rag_utils
from embedding_provider import get_provider_status
import terminal_log as tlog
from agent_runtime import AgentRuntime, AgentConfig
from conversation_store import ConversationStore
from llm_provider import invoke_llm

app = FastAPI()


@app.on_event("startup")
def _log_integration_env():
    """One-time startup banner and provider hints."""
    tlog.banner("ELVA AI Service")
    tlog.info("Server", "Uvicorn ready on port 8000")
    sec = (os.environ.get("INTERNAL_API_SECRET") or "").strip()
    bk = (os.environ.get("BACKEND_URL") or "").strip()
    if not sec:
        tlog.warn("Integrations", "INTERNAL_API_SECRET unset — internal order/lead posts may 401")
    if not bk:
        tlog.dim("BACKEND_URL unset — using http://localhost:3000 for internal posts")
    _log_embedding_provider()
    _check_supabase_connectivity()
    _warmup_embeddings()


def _log_embedding_provider():
    status = get_provider_status()
    provider = status.get("provider", "unknown")
    if provider == "gemini":
        if status.get("geminiConfigured"):
            tlog.ok(
                "Embeddings",
                f"Gemini {status.get('geminiModel')} ({status.get('dimensions')} dims, fallback={status.get('fallback')})",
            )
        else:
            tlog.warn("Embeddings", "EMBEDDING_PROVIDER=gemini but GEMINI_API_KEY missing")
    else:
        tlog.info("Embeddings", f"Ollama {status.get('ollamaModel')}")


def _warmup_embeddings():
    """Warm up the configured embedding provider (Gemini or Ollama)."""
    import threading
    def _probe():
        try:
            rag_utils.warmup_embeddings()
        except Exception as e:
            tlog.warn("RAG", f"Embedding warmup skipped: {e}")
    threading.Thread(target=_probe, daemon=True).start()


def _check_supabase_connectivity():
    """Non-blocking startup probe with retries for transient DNS/network blips."""
    import threading
    import time

    def _probe():
        max_attempts = 4
        for attempt in range(1, max_attempts + 1):
            try:
                from rag_utils import supabase
                supabase.table("document_chunks").select("id").limit(1).execute()
                tlog.ok("Supabase", "Connected — RAG and ingestion ready")
                return
            except Exception as e:
                msg = str(e)
                retryable = any(
                    s in msg.lower()
                    for s in ("eai_again", "enotfound", "timeout", "connection", "503", "502")
                )
                if attempt < max_attempts and retryable:
                    wait = 0.8 * attempt
                    tlog.warn("Supabase", f"Attempt {attempt} failed — retrying in {wait:.1f}s")
                    time.sleep(wait)
                    continue
                tlog.err("Supabase", f"Unreachable after {attempt} attempt(s): {e}")
                return

    threading.Thread(target=_probe, daemon=True).start()


@app.middleware("http")
async def ai_service_shared_secret_gate(request: Request, call_next):
    """
    Require AI_SERVICE_SECRET on all routes except lightweight GET probes.
    Set ELVA_DEV_INSECURE=1 in ai_service/.env for local-only open access when secret is unset.
    """
    path = request.url.path
    if request.method == "GET" and path in ("/", "/health", "/health/voice"):
        return await call_next(request)

    secret = (os.environ.get("AI_SERVICE_SECRET") or "").strip()
    if not secret:
        dev_insecure = (
            os.environ.get("ELVA_DEV_INSECURE") == "1"
            and os.environ.get("NODE_ENV") != "production"
        )
        if dev_insecure:
            return await call_next(request)
        return JSONResponse(
            status_code=503,
            content={
                "detail": "AI service is not configured. Set AI_SERVICE_SECRET in ai_service/.env "
                "(must match backend AI_SERVICE_SECRET)."
            },
        )

    header_name = "x-elva-ai-service-secret"
    provided = (request.headers.get(header_name) or "").strip()
    if provided != secret:
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})
    return await call_next(request)


store = ConversationStore()


def _persist_order_state_after_turn(
    session_id: str,
    new_order_state: dict,
    order_event: Optional[str],
) -> None:
    """Persist in-progress orders even before items are extracted (voice STT splits)."""
    if order_event == "cancelled":
        store.clear_order_state(session_id=session_id)
        return
    if new_order_state.get("status") == "submitted":
        store.set_order_state(
            session_id=session_id,
            order_data=new_order_state,
            status="submitted",
        )
        return
    status = (new_order_state.get("status") or "idle").lower()
    in_flow = status in ("collecting", "awaiting_details", "reviewing")
    has_items = bool(new_order_state.get("items"))
    has_customer = bool(new_order_state.get("customer"))
    if has_items or in_flow or has_customer:
        store.set_order_state(
            session_id=session_id,
            order_data=new_order_state,
            status=new_order_state.get("status", "collecting"),
        )


runtime = AgentRuntime()

# Voice: identity / meta prompts do not need KB retrieval; skipping RAG avoids blowing Twilio's
# ~15s gather/webhook latency budget (heavy match_documents dominates on cold cache).
_VOICE_META_IDENTITY_RE = re.compile(
    r"\b("
    r"who\s+am\s+i\s+(talking|speaking)(\s+(to|with))?|"
    r"who('?ve|\s+have)\s+i\s+(reached|got)|"
    r"who('?s|\s+is)\s+(this|that|it)\b|"
    r"who\s+are\s+you\b|"
    r"what('?s|\s+is)\s+(your\s+)?name\b|"
    r"human\s+or\s+(ai|a\s+bot)|"
    r"real\s+(person|human)\b"
    r")\b",
    re.I,
)

# Audio / connectivity checks — no KB needed; skipping RAG saves seconds on voice.
# Do NOT match bare "hello" — callers often open with "Hello, am I calling X?"
_VOICE_HEARING_CHECK_RE = re.compile(
    r"\b("
    r"can you hear me|"
    r"do you hear me|"
    r"are you there|"
    r"is anyone there|"
    r"am i audible|"
    r"can you hear"
    r")\b",
    re.I,
)

_VOICE_HEARING_CHECK_EXACT = frozenset({
    "hello", "hi", "hey", "hello?", "hi?", "hey?",
    "hello there", "hi there", "hey there",
})


def _is_voice_meta_identity_query(text: str) -> bool:
    s = (text or "").strip()
    if len(s) > 280:
        return False
    return bool(_VOICE_META_IDENTITY_RE.search(s))


def _is_voice_hearing_check_query(text: str) -> bool:
    s = (text or "").strip()
    if len(s) > 120:
        return False
    if _VOICE_HEARING_CHECK_RE.search(s):
        return True
    clean = re.sub(r"[,\.\?!;:]+", " ", s.lower()).strip()
    clean = re.sub(r"\s+", " ", clean)
    # Only treat bare hello/hi/hey as a mic check — not "Hello, am I calling…"
    if clean in _VOICE_HEARING_CHECK_EXACT:
        return True
    words = clean.split()
    return len(words) <= 2 and words[0] in ("hello", "hi", "hey")


def _speaking_agent_name(request: "QueryRequest") -> str:
    """Persona name for spoken identity; dashboard agent_name is fallback only."""
    persona = request.persona or {}
    name = (persona.get("name") or "").strip()
    if name:
        return name
    return (request.agent_name or "Agent").strip()


class QueryRequest(BaseModel):
    query: str
    tenant_id: str
    agent_id: Optional[str] = None
    session_id: Optional[str] = None
    system_prompt: Optional[str] = None
    agent_name: Optional[str] = None
    business_name: Optional[str] = None
    tone: Optional[str] = None
    persona: Optional[dict] = None
    objectives: Optional[List[str]] = None
    capabilities: Optional[List[str]] = None
    guardrails: Optional[str] = None
    memoryConfig: Optional[dict] = None
    responseConfig: Optional[dict] = None
    channel: Optional[str] = "chat"
    caller_phone: Optional[str] = None
    currency: Optional[str] = "USD"
    first_message: Optional[str] = None
    campaign_mode: Optional[bool] = False


def _execute_voice_turn_sync(
    request: QueryRequest,
    on_sentence: Optional[Callable[[str], None]] = None,
) -> dict:
    """Run one voice turn (shared by /chat and /chat/stream)."""
    import time as _t

    request_started_at = _t.time()
    session_id = request.session_id or "default"
    history = store.load_history(session_id=session_id, limit=24)

    session_state = store.get_session_state(session_id=session_id)
    session_in_scope = session_state.get("in_scope", False)
    order_state = store.get_order_state(session_id=session_id)
    lead_state = store.get_lead_state(session_id=session_id)

    memory_config = request.memoryConfig or {}
    raw_window = memory_config.get("shortTermWindow")
    try:
        memory_window = int(raw_window)
        if memory_window <= 0:
            raise ValueError("must be positive")
    except (TypeError, ValueError):
        memory_window = 6
    memory_window = max(6, min(memory_window, 8))
    trimmed_history = history[-(memory_window * 2):] if history else []

    agent_config = AgentConfig(
        name=_speaking_agent_name(request),
        business_name=request.business_name or "",
        system_prompt=request.system_prompt or "You are a helpful AI assistant for a business.",
        persona=request.persona or {},
        tone=request.tone or "professional",
        objectives=request.objectives or [],
        capabilities=request.capabilities or [],
        guardrails=request.guardrails or "",
        memory_window=memory_window,
        response_config=request.responseConfig or {},
    )

    if request.campaign_mode:
        _q = request.query.lower().strip().rstrip(".,!?")
        _FAST_DNC = {"stop", "stop calling", "remove me", "remove from list", "do not call", "don't call", "dont call", "unsubscribe", "take me off"}
        _FAST_EXIT = {"not interested", "no thanks", "no thank you", "goodbye", "bye", "i'm not interested", "im not interested", "not for me"}
        _FAST_WRONG = {"wrong number", "wrong person", "you have the wrong number"}
        _fast_intent = _fast_reply = None
        if _q in _FAST_DNC or any(p in _q for p in _FAST_DNC):
            _fast_intent, _fast_reply = "do_not_call", "Of course, I'll remove you from our list right away. Sorry for the interruption — have a great day!"
        elif _q in _FAST_WRONG or any(p in _q for p in _FAST_WRONG):
            _fast_intent, _fast_reply = "wrong_number", "Apologies for the interruption, I must have the wrong number. Have a great day!"
        elif _q in _FAST_EXIT or any(p in _q for p in _FAST_EXIT):
            _fast_intent, _fast_reply = "not_interested", "Completely understood — I appreciate your time. Have a wonderful day!"
        if _fast_intent:
            if on_sentence:
                on_sentence(_fast_reply)
            store.append_turn(session_id=session_id, role="user", content=request.query)
            store.append_turn(session_id=session_id, role="assistant", content=_fast_reply)
            return {
                "response": _fast_reply,
                "intent": _fast_intent,
                "context": "fast_path",
                "plan": {},
                "reasoning": "Voice fast-path",
                "timings": {"fastPathMs": 0},
                "latencyMs": 0,
            }

    # Voice connectivity / identity checks — skip planner + LLM (sub-second reply).
    if request.channel == "voice" and not request.campaign_mode:
        q = (request.query or "").strip()
        if _is_voice_hearing_check_query(q):
            ostatus = (order_state or {}).get("status") or "idle"
            detail_step = (order_state.get("detail_step") or "").replace("_", " ")
            has_order_progress = bool(
                order_state.get("items")
                or order_state.get("detail_step")
                or (order_state.get("customer") or {}).get("name")
                or (order_state.get("customer") or {}).get("phone")
            )
            if ostatus in ("collecting", "awaiting_details", "reviewing") or has_order_progress:
                step_label = detail_step or "your order"
                if step_label == "name":
                    reply = "Yes, I can hear you. What name should I put on the order?"
                elif step_label == "review":
                    reply = "Yes, I can hear you. We're on your order review — say yes to place it, or tell me what to change."
                else:
                    reply = f"Yes, I can hear you. Let's continue — we were on {step_label}."
            else:
                reply = "Yes, I can hear you clearly! How can I help you today?"
            if on_sentence:
                on_sentence(reply)
            store.append_turn(session_id=session_id, role="user", content=request.query)
            store.append_turn(session_id=session_id, role="assistant", content=reply)
            return {
                "response": reply,
                "intent": "smalltalk",
                "context": "voice_hearing_check",
                "plan": {},
                "reasoning": "Voice hearing-check (order-aware)",
                "timings": {"fastPathMs": 0},
                "latencyMs": int((_t.time() - request_started_at) * 1000),
                "order_state": order_state,
            }
        if _is_voice_meta_identity_query(q):
            agent = _speaking_agent_name(request)
            business = (request.business_name or "this business").strip()
            reply = f"I'm {agent}, an AI assistant for {business}. How can I help you?"
            if on_sentence:
                on_sentence(reply)
            store.append_turn(session_id=session_id, role="user", content=request.query)
            store.append_turn(session_id=session_id, role="assistant", content=reply)
            return {
                "response": reply,
                "intent": "question",
                "context": "voice_meta_identity",
                "plan": {},
                "reasoning": "Voice identity fast-path",
                "timings": {"fastPathMs": 0},
                "latencyMs": int((_t.time() - request_started_at) * 1000),
            }

    retrieval_events = []

    def provide_context(search_query: str = None):
        q = search_query or request.query
        rag_match_count = int(os.environ.get("RAG_VOICE_MATCH_COUNT", "3"))
        if _is_voice_meta_identity_query(q) or _is_voice_hearing_check_query(q):
            retrieval_events.append({"query": q, "sources": [], "metrics": {"skipped": True}})
            return ""
        retrieval_result = rag_utils.query_rag_with_sources(
            q, request.tenant_id, request.agent_id, match_count=rag_match_count,
        )
        retrieval_events.append({
            "query": q,
            "sources": retrieval_result.get("sources", []),
            "metrics": retrieval_result.get("metrics", {}),
        })
        return retrieval_result.get("context", "No relevant context found.")

    result = runtime.run(
        config=agent_config,
        query=request.query,
        history=trimmed_history,
        context_provider=provide_context,
        session_in_scope=session_in_scope,
        order_state=order_state,
        lead_state=lead_state,
        agent_id=request.agent_id,
        tenant_id=request.tenant_id,
        session_id=session_id,
        channel="voice",
        caller_phone=request.caller_phone,
        currency=request.currency or "USD",
        campaign_mode=bool(request.campaign_mode),
        on_sentence=on_sentence,
    )

    store.append_turn(session_id=session_id, role="user", content=request.query)
    store.append_turn(session_id=session_id, role="assistant", content=result["response"])
    session_state["in_scope"] = result.get("in_scope", False)
    store.set_session_state(session_id=session_id, in_scope=session_state["in_scope"])

    if not request.campaign_mode:
        new_order_state = result.get("order_state", {})
        order_event = result.get("order_event")
        _persist_order_state_after_turn(session_id, new_order_state, order_event)
        new_lead_state = result.get("lead_state", {})
        _lead_data = new_lead_state.get("data", {}) if new_lead_state else {}
        if new_lead_state.get("captured"):
            store.set_lead_state(session_id=session_id, lead_data=_lead_data, captured=True)
        elif _lead_data.get("_capture_step") or _lead_data.get("_declined"):
            store.set_lead_state(session_id=session_id, lead_data=_lead_data, captured=False)

    store.prune_history(session_id=session_id, keep_last=max(20, memory_window * 4))

    runtime_timings = result.get("timings") or {}
    service_total_ms = int((_t.time() - request_started_at) * 1000)
    return {
        "response": result["response"],
        "intent": result.get("intent"),
        "context": result.get("context"),
        "orderDetailStep": (result.get("order_state") or {}).get("detail_step"),
        "reviewConfirmLine": (result.get("order_state") or {}).get("_review_confirm_line"),
        "orderState": result.get("order_state"),
        "timings": {
            **runtime_timings,
            "serviceTotalMs": service_total_ms,
        },
        "latencyMs": service_total_ms,
    }


class WarmSessionRequest(BaseModel):
    session_id: str
    agent_id: str
    tenant_id: str


@app.post("/voice/warm-session")
def warm_voice_session(req: WarmSessionRequest):
    """
    Prefetch catalog into session order_state at call start (Tier A latency).
    Backend invokes this when a Media Stream session connects.
    """
    from menu_index import MenuIndex

    session_id = req.session_id
    order_state = store.get_order_state(session_id=session_id) or {
        "items": [],
        "status": "idle",
        "customer": {},
    }
    idx = MenuIndex(req.agent_id, req.tenant_id)
    count = idx.warm_from_catalog()
    idx.apply_to_order_state(order_state)
    store.set_order_state(
        session_id=session_id,
        order_data=order_state,
        status=order_state.get("status", "idle"),
    )
    print(f"[WARM] session={session_id} agent={req.agent_id} items={count} source={idx.source}")
    return {
        "ok": True,
        "itemCount": count,
        "source": idx.source,
        "currency": idx.currency,
    }


@app.get("/health")
def health_check():
    return {"status": "ok", "memory": store.get_health(), "embeddings": get_provider_status()}


@app.get("/health/voice")
def voice_health_check():
    """Voice pipeline health — consumed by backend GET /api/voice/health."""
    status = get_provider_status()
    supabase_ok = False
    supabase_error = None
    try:
        rag_utils.supabase.table("document_chunks").select("id").limit(1).execute()
        supabase_ok = True
    except Exception as e:
        supabase_error = str(e)[:200]
    return {
        "status": "ok" if supabase_ok else "degraded",
        "embeddings": status,
        "supabase": {"reachable": supabase_ok, "error": supabase_error},
        "llmProvider": os.environ.get("LLM_PROVIDER", "groq"),
        "groqModel": os.environ.get("GROQ_MODEL"),
        "ragVoiceMatchCount": os.environ.get("RAG_VOICE_MATCH_COUNT", "3"),
        "voiceStreaming": True,
    }


@app.get("/")
def read_root():
    return {"status": "AI Service is running", "memory": store.get_health()}

@app.post("/ingest")
async def ingest_document(
    file: UploadFile = File(...),
    tenant_id: str = Form(...),
    agent_id: Optional[str] = Form(None),
    document_id: Optional[str] = Form(None),
):
    safe_name = re.sub(r"[^\w.\-]", "_", os.path.basename(file.filename or "upload"))
    temp_file_path = f"temp_{safe_name}"

    try:
        print(f"Ingesting document: {file.filename} for tenant: {tenant_id}, agent: {agent_id}, document_id: {document_id}")
        # Save uploaded file temporarily
        with open(temp_file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        # Run in a thread pool so Ollama embedding doesn't block the async event loop
        # (blocking the loop would queue up all concurrent /chat requests)
        num_chunks = await asyncio.to_thread(
            rag_utils.ingest_pdf, temp_file_path, tenant_id, agent_id, document_id
        )
        print(f"Ingestion complete: {num_chunks} chunks created")
        
        return {"message": "Ingestion successful", "chunks": num_chunks}
    except Exception as e:
        print(f"Ingestion error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        # Cleanup
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)


class IngestTextRequest(BaseModel):
    tenant_id: str
    agent_id: Optional[str] = None
    text: str
    source: Optional[str] = "text"
    metadata: Optional[dict] = None


@app.post("/ingest-text")
async def ingest_text(request: IngestTextRequest):
    try:
        print(f"Ingesting text for tenant={request.tenant_id}, agent={request.agent_id}, source={request.source}")
        num_chunks = await asyncio.to_thread(
            rag_utils.ingest_text,
            request.text,
            request.tenant_id,
            request.agent_id,
            request.source,
            request.metadata or {},
        )
        return {"message": "Text ingestion successful", "chunks_upserted": num_chunks}
    except Exception as e:
        print(f"Text ingestion error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/chat")
async def chat(request: QueryRequest):
    import time as _t
    request_started_at = _t.time()
    try:
        print(f"\n{'='*60}")
        print(f"Query: '{request.query}'")
        print(f"Tenant: {request.tenant_id}")
        print(f"Agent: {request.agent_id}")
        print(f"System Prompt: {request.system_prompt[:50] if request.system_prompt else 'None'}...")
        
        # Load persistent conversation history and session state
        session_id = request.session_id or "default"
        # Voice uses up to 24 messages (12 turns × 2), chat up to 120
        history_limit = 24 if request.channel == "voice" else 120
        history = store.load_history(session_id=session_id, limit=history_limit)

        # First-message enforcement (chat channel only): if this is the very first user
        # message in the session AND the agent has a configured greeting, return it verbatim
        # without calling the LLM. Store both turns so the next message sees them in history.
        configured_first_message = (request.first_message or "").strip()
        if (
            request.channel != "voice"
            and configured_first_message
            and len(history) == 0
        ):
            store.append_turn(session_id=session_id, role="user", content=request.query)
            store.append_turn(session_id=session_id, role="assistant", content=configured_first_message)
            return {
                "response": configured_first_message,
                "context": "first_message",
                "plan": {},
                "reasoning": "Configured greeting returned verbatim.",
                "intent": "greeting",
                "citations": [],
                "retrievalMetrics": {"queries": [], "calls": 0, "totalReturnedChunks": 0, "totalDurationMs": 0, "events": []},
                "orderEvent": None,
                "orderState": {},
                "leadEvent": None,
                "leadState": {},
            }

        session_state = store.get_session_state(session_id=session_id)
        session_in_scope = session_state.get("in_scope", False)
        order_state = store.get_order_state(session_id=session_id)
        lead_state = store.get_lead_state(session_id=session_id)

        memory_config = request.memoryConfig or {}
        raw_window = memory_config.get("shortTermWindow")
        try:
            memory_window = int(raw_window)
            if memory_window <= 0:
                raise ValueError("must be positive")
        except (TypeError, ValueError):
            # Defaults: chat 24, voice 6 (matches the dashboard default).
            memory_window = 6 if request.channel == "voice" else 24
        print(f"[CHAT] memory_window={memory_window} turns (raw={raw_window}, channel={request.channel})")

        # Voice channel: floor at 6 turns (production target) and cap at 8 turns
        # to keep the prompt tight and tail latency low. Anything bigger hurts
        # TTFT without measurably improving answer quality on phone calls.
        if request.channel == "voice":
            memory_window = max(6, min(memory_window, 8))

        # Keep the last (memory_window * 2) messages: each turn = 1 user + 1 assistant
        trimmed_history = history[-(memory_window * 2):] if len(history) > 0 else []

        agent_config = AgentConfig(
            name=_speaking_agent_name(request),
            business_name=request.business_name or "",
            system_prompt=request.system_prompt or "You are a helpful AI assistant for a business.",
            persona=request.persona or {},
            tone=request.tone or "professional",
            objectives=request.objectives or [],
            capabilities=request.capabilities or [],
            guardrails=request.guardrails or "",
            memory_window=memory_window,
            response_config=request.responseConfig or {},
        )
        print(f"[CHAT] AgentConfig created: name={agent_config.name}, business_name={agent_config.business_name}, persona={agent_config.persona}")

        # ── Voice fast-path ───────────────────────────────────────────────────
        # Terminal phrases in outbound campaign mode skip RAG + LLM entirely.
        # These intents are deterministic — no context needed to respond.
        if request.channel == "voice" and request.campaign_mode:
            _q = request.query.lower().strip().rstrip(".,!?")
            _FAST_DNC = {
                "stop", "stop calling", "remove me", "remove from list",
                "do not call", "don't call", "dont call",
                "unsubscribe", "take me off",
            }
            _FAST_EXIT = {
                "not interested", "no thanks", "no thank you",
                "goodbye", "bye", "i'm not interested", "im not interested",
                "not for me", "no i'm not interested", "no im not interested",
            }
            _FAST_WRONG = {"wrong number", "wrong person", "you have the wrong number"}

            _fast_intent = None
            _fast_reply = None

            if _q in _FAST_DNC or any(p in _q for p in _FAST_DNC):
                _fast_intent = "do_not_call"
                _fast_reply = "Of course, I'll remove you from our list right away. Sorry for the interruption — have a great day!"
            elif _q in _FAST_WRONG or any(p in _q for p in _FAST_WRONG):
                _fast_intent = "wrong_number"
                _fast_reply = "Apologies for the interruption, I must have the wrong number. Have a great day!"
            elif _q in _FAST_EXIT or any(p in _q for p in _FAST_EXIT):
                _fast_intent = "not_interested"
                _fast_reply = "Completely understood — I appreciate your time. Have a wonderful day!"

            if _fast_intent:
                print(f"[VOICE-FAST-PATH] Matched '{_q}' → intent={_fast_intent}, skipped LLM")
                store.append_turn(session_id=session_id, role="user", content=request.query)
                store.append_turn(session_id=session_id, role="assistant", content=_fast_reply)
                return {
                    "response": _fast_reply,
                    "intent": _fast_intent,
                    "context": "fast_path",
                    "plan": {},
                    "reasoning": "Voice fast-path: terminal intent, LLM skipped.",
                    "citations": [],
                    "retrievalMetrics": {"queries": [], "calls": 0, "totalReturnedChunks": 0, "totalDurationMs": 0, "events": []},
                    "orderEvent": None,
                    "orderState": {},
                    "leadEvent": None,
                    "leadState": {},
                    "timings": {"fastPathMs": 0},
                }

        retrieval_events = []

        def provide_context(search_query: str = None):
            q = search_query or request.query

            rag_match_count = None
            if request.channel == "voice":
                rag_match_count = int(os.environ.get("RAG_VOICE_MATCH_COUNT", "3"))

            if request.channel == "voice" and (
                _is_voice_meta_identity_query(q) or _is_voice_hearing_check_query(q)
            ):
                skip_reason = "voice_meta_identity" if _is_voice_meta_identity_query(q) else "voice_hearing_check"
                print(f"[RAG] voice skip retrieval ({skip_reason}): {q!r}")
                retrieval_events.append({
                    "query": q,
                    "sources": [],
                    "metrics": {"skipped": True, "reason": skip_reason},
                })
                print(f"Context length: 0 chars (skipped {skip_reason}; searched: '{q}')")
                return ""

            retrieval_result = rag_utils.query_rag_with_sources(
                q,
                request.tenant_id,
                request.agent_id,
                match_count=rag_match_count,
            )
            context_value = retrieval_result.get("context", "No relevant context found.")
            retrieval_events.append({
                "query": q,
                "sources": retrieval_result.get("sources", []),
                "metrics": retrieval_result.get("metrics", {}),
            })
            print(f"Context length: {len(context_value)} chars (searched: '{q}')")
            return context_value

        # Run the blocking runtime (LLM + Ollama RAG) in a thread pool so the
        # async event loop stays free to accept new requests during processing.
        result = await asyncio.to_thread(
            runtime.run,
            config=agent_config,
            query=request.query,
            history=trimmed_history,
            context_provider=provide_context,
            session_in_scope=session_in_scope,
            order_state=order_state,
            lead_state=lead_state,
            agent_id=request.agent_id,
            tenant_id=request.tenant_id,
            session_id=session_id,
            channel=request.channel or "chat",
            caller_phone=request.caller_phone,
            currency=request.currency or "USD",
            campaign_mode=bool(request.campaign_mode),
        )

        store.append_turn(session_id=session_id, role="user", content=request.query)
        store.append_turn(session_id=session_id, role="assistant", content=result["response"])

        session_state["in_scope"] = result.get("in_scope", False)
        store.set_session_state(session_id=session_id, in_scope=session_state["in_scope"])

        # Outbound campaign voice turns must not persist order/lead machine state
        # into the shared conversation store (same session_id as callSid).
        if not request.campaign_mode:
            # Persist order state
            new_order_state = result.get("order_state", {})
            order_event = result.get("order_event")
            _persist_order_state_after_turn(session_id, new_order_state, order_event)

            # Persist lead state. We also persist when the proactive capture flow
            # is in-progress (data["_capture_step"] is set) so the multi-turn
            # state machine survives across requests.
            new_lead_state = result.get("lead_state", {})
            lead_event = result.get("lead_event")
            _lead_data = new_lead_state.get("data", {}) if new_lead_state else {}
            if new_lead_state.get("captured"):
                store.set_lead_state(session_id=session_id, lead_data=_lead_data, captured=True)
            elif _lead_data.get("_capture_step") or _lead_data.get("_declined"):
                store.set_lead_state(session_id=session_id, lead_data=_lead_data, captured=False)

        retention = max(20, memory_window * 4)
        store.prune_history(session_id=session_id, keep_last=retention)

        flattened_sources = []
        for event in retrieval_events:
            flattened_sources.extend(event.get("sources", []))

        deduped_sources = []
        seen_sources = set()
        for source in flattened_sources:
            signature = (source.get("source"), source.get("page"), source.get("preview"))
            if signature in seen_sources:
                continue
            seen_sources.add(signature)
            deduped_sources.append(source)

        deduped_sources.sort(key=lambda item: float(item.get("score") or 0.0), reverse=True)

        retrieval_metrics = {
            "queries": [event.get("query") for event in retrieval_events],
            "calls": len(retrieval_events),
            "totalReturnedChunks": sum(int((event.get("metrics") or {}).get("returnedChunks") or 0) for event in retrieval_events),
            "totalDurationMs": sum(int((event.get("metrics") or {}).get("durationMs") or 0) for event in retrieval_events),
            "events": retrieval_events,
        }

        # Per-stage timings from runtime + service-level wall clock so the UI
        # can show what *actually* happened instead of guessing from end-to-end
        # timestamps (which include browser/network overhead).
        runtime_timings = result.get("timings") or {}
        service_total_ms = int((_t.time() - request_started_at) * 1000)
        timing_breakdown = {
            "planMs": int(runtime_timings.get("planMs") or 0),
            "intentMs": int(runtime_timings.get("intentMs") or 0),
            "retrievalMs": int(runtime_timings.get("retrievalMs") or 0),
            "llmMs": int(runtime_timings.get("llmMs") or 0),
            "runtimeTotalMs": int(runtime_timings.get("totalMs") or 0),
            "serviceTotalMs": service_total_ms,
        }
        print(f"[CHAT] timings (ms): {timing_breakdown}")

        print(f"Response: {len(result['response'])} chars")
        print(f"{'='*60}\n")

        return {
            "response": result["response"],
            "context": result["context"],
            "plan": result["plan"],
            "reasoning": result.get("reasoning"),
            "intent": result.get("intent"),
            "citations": deduped_sources[:8],
            "retrievalMetrics": retrieval_metrics,
            "orderEvent": result.get("order_event"),
            "orderState": result.get("order_state"),
            "leadEvent": result.get("lead_event"),
            "leadState": result.get("lead_state"),
            "timings": timing_breakdown,
            "latencyMs": service_total_ms,
        }
    except Exception as e:
        print(f"Error: {str(e)}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/chat/stream")
async def chat_stream(request: QueryRequest):
    """
    Voice-only SSE stream. Emits ``sentence`` events as the LLM generates,
    then a final ``done`` event with the full turn payload.
    """
    if request.channel != "voice":
        raise HTTPException(status_code=400, detail="Stream endpoint supports voice channel only")

    preview = (request.query or "")[:60].replace("\n", " ")
    tlog.voice("STREAM", f'Turn "{preview}" · agent={request.agent_id or "?"}')

    event_q: queue.Queue = queue.Queue()
    event_q.put(("started", {}))

    def on_sentence(text: str):
        event_q.put(("sentence", text))

    def worker():
        try:
            payload = _execute_voice_turn_sync(request, on_sentence=on_sentence)
            event_q.put(("done", payload))
        except Exception as e:
            traceback.print_exc()
            event_q.put(("error", {"message": str(e)}))

    threading.Thread(target=worker, daemon=True).start()

    async def sse_generator():
        while True:
            kind, payload = await asyncio.to_thread(event_q.get)
            if kind == "started":
                yield f"event: started\ndata: {{}}\n\n"
            elif kind == "sentence":
                yield f"event: sentence\ndata: {json.dumps({'text': payload})}\n\n"
            elif kind == "done":
                ms = payload.get("latencyMs")
                tlog.voice("STREAM", f"Done · {ms}ms · {len(payload.get('response', ''))} chars")
                yield f"event: done\ndata: {json.dumps(payload)}\n\n"
                break
            elif kind == "error":
                tlog.err("STREAM", payload.get("message", "unknown"))
                yield f"event: error\ndata: {json.dumps(payload)}\n\n"
                break

    return StreamingResponse(
        sse_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

# ─── Post-call analysis (outbound campaigns) ─────────────────────────────

class AnalyzeCallRequest(BaseModel):
    transcript: str
    campaign_goal: Optional[str] = "qualify_lead"
    contact_name: Optional[str] = ""
    base_intent: Optional[str] = ""


@app.post("/analyze-call")
async def analyze_call(request: AnalyzeCallRequest):
    """
    Run a post-call analysis on the transcript of an outbound cold call.

    Returns a compact JSON report with:
        - summary: 2-3 sentence call summary
        - bant: { budget, authority, need, timeline } each 0-5
        - lead_score: 0-100 composite quality score
        - disposition: standardized disposition code
        - tags: short keyword tags
        - next_action: recommended next step
    """
    transcript = (request.transcript or "").strip()
    if not transcript:
        return {
            "summary": "Empty transcript.",
            "bant": {"budget": 0, "authority": 0, "need": 0, "timeline": 0},
            "lead_score": 0,
            "disposition": "no_contact",
            "tags": [],
            "next_action": "Skip - no conversation occurred.",
        }

    valid_dispositions = [
        "no_contact", "voicemail_dropped", "voicemail_no_drop",
        "gatekeeper", "wrong_number", "dnc_requested",
        "not_interested", "objection_unresolved", "callback_requested",
        "qualified_interest", "meeting_booked", "transferred",
        "hung_up", "technical_failure",
    ]

    system_message = (
        "You are a senior sales operations analyst. Given the transcript of a B2B "
        "outbound cold call, produce a strict JSON report. Be objective. Score "
        "conservatively - high scores require evidence in the transcript."
    )

    prompt = f"""
Analyze this outbound call transcript and return ONLY a JSON object - no prose.

Campaign goal: {request.campaign_goal}
Contact name: {request.contact_name or 'unknown'}
Hint about call outcome: {request.base_intent or 'unknown'}

Transcript:
\"\"\"
{transcript[:4000]}
\"\"\"

Return JSON with this exact shape:
{{
  "summary": "2-3 sentence summary of what happened on the call",
  "bant": {{
    "budget":    0-5,
    "authority": 0-5,
    "need":      0-5,
    "timeline":  0-5
  }},
  "lead_score": 0-100,
  "disposition": "one of: {', '.join(valid_dispositions)}",
  "tags": ["short", "keywords", "max 5"],
  "next_action": "one short sentence on the recommended next step"
}}

Scoring rubric:
- budget:    0=no signal, 3=hinted, 5=explicit budget mentioned
- authority: 0=junior/unknown, 3=influencer, 5=stated decision-maker
- need:      0=no pain expressed, 3=related issues, 5=explicit pain matching offer
- timeline:  0=no urgency, 3=this quarter, 5=immediate / weeks
- lead_score is roughly (B+A+N+T)/20*100, adjusted for tone & engagement
"""

    try:
        raw = invoke_llm(prompt=prompt, temperature=0.1, max_tokens=600, system_message=system_message)
    except Exception as e:
        print(f"[analyze-call] LLM error: {e}")
        return {
            "summary": transcript[:300],
            "bant": {"budget": 0, "authority": 0, "need": 0, "timeline": 0},
            "lead_score": 0,
            "disposition": request.base_intent or "hung_up",
            "tags": [],
            "next_action": "Manual review required.",
        }

    # Extract first JSON object from the LLM output
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if not match:
        print(f"[analyze-call] No JSON in LLM output: {raw[:200]}")
        return {
            "summary": transcript[:300],
            "bant": {"budget": 0, "authority": 0, "need": 0, "timeline": 0},
            "lead_score": 0,
            "disposition": "hung_up",
            "tags": [],
            "next_action": "Manual review required.",
        }

    try:
        parsed = json.loads(match.group(0))
    except Exception as e:
        print(f"[analyze-call] JSON parse error: {e}")
        return {
            "summary": transcript[:300],
            "bant": {"budget": 0, "authority": 0, "need": 0, "timeline": 0},
            "lead_score": 0,
            "disposition": "hung_up",
            "tags": [],
            "next_action": "Manual review required.",
        }

    # Sanitize / clamp
    def _clamp(v, lo, hi, default=0):
        try:
            n = int(v)
        except (TypeError, ValueError):
            return default
        return max(lo, min(hi, n))

    bant_in = parsed.get("bant", {}) or {}
    bant = {
        "budget":    _clamp(bant_in.get("budget"),    0, 5),
        "authority": _clamp(bant_in.get("authority"), 0, 5),
        "need":      _clamp(bant_in.get("need"),      0, 5),
        "timeline":  _clamp(bant_in.get("timeline"),  0, 5),
    }
    lead_score = _clamp(parsed.get("lead_score"), 0, 100,
                        default=int(((bant["budget"] + bant["authority"] + bant["need"] + bant["timeline"]) / 20) * 100))

    disposition = parsed.get("disposition", "hung_up")
    if disposition not in valid_dispositions:
        disposition = "hung_up"

    tags = parsed.get("tags") or []
    if not isinstance(tags, list):
        tags = []
    tags = [str(t)[:30] for t in tags][:5]

    return {
        "summary": str(parsed.get("summary") or transcript[:300])[:800],
        "bant": bant,
        "lead_score": lead_score,
        "disposition": disposition,
        "tags": tags,
        "next_action": str(parsed.get("next_action") or "Follow up appropriately.")[:200],
    }


class GenerateAgentConfigRequest(BaseModel):
    business_description: str
    agent_type: str = "chat"
    call_direction: Optional[str] = "inbound"


@app.post("/generate-agent-config")
async def generate_agent_config(request: GenerateAgentConfigRequest):
    """
    Generate a full agent configuration from a plain-English business description.
    Returns a pre-filled config object the user can review and adjust.
    """
    desc = (request.business_description or "").strip()
    if not desc:
        raise HTTPException(status_code=400, detail="business_description is required")

    agent_type = request.agent_type or "chat"
    call_direction = request.call_direction or "inbound"

    type_context = "a chat-based AI agent"
    if agent_type == "voice" and call_direction == "inbound":
        type_context = "an inbound voice phone agent"
    elif agent_type == "voice" and call_direction == "outbound":
        type_context = "an outbound voice phone agent that makes calls"

    system_message = (
        "You are an expert AI product configurator. Given a business description, "
        "you produce a complete, realistic agent configuration in JSON. Be specific and practical - "
        "tailor every field to the business described. Return ONLY valid JSON, no prose."
    )

    prompt = f"""
You are configuring {type_context} for the following business:

\"\"\"{desc}\"\"\"

Generate a complete agent configuration JSON with these exact fields:

{{
  "agentName": "string - a short, friendly name for the agent (not the business name)",
  "businessName": "string - the business name extracted from the description",
  "tone": "one of: professional, friendly, empathetic, humorous",
  "firstMessage": "string - the exact greeting the agent sends first",
  "personaName": "string - the agent's persona name (e.g. Sara, Max, Support Agent)",
  "personaSummary": "string - 2-3 sentences describing the agent's role and background",
  "speakingStyle": "string - 2-4 adjectives (e.g. warm, concise, confident)",
  "objectives": ["string", "string", "string", "string"],
  "capabilities": ["string", "string", "string", "string"],
  "guardrails": "string - business rules, forbidden topics, and escalation policy",
  "systemPrompt": "string - a detailed role instruction for the agent (3-5 sentences)",
  "temperature": 0.0-1.0,
  "fallbackMessage": "string - message sent when the agent cannot help"
}}

Rules:
- objectives: 4 specific, action-oriented goals for this agent
- capabilities: 4 specific things this agent can do for customers
- guardrails: at least 2 concrete rules and an escalation trigger
- systemPrompt: reference the business type and give clear behavioral instructions
- tone: choose based on business type (professional for B2B, friendly for retail, empathetic for healthcare)
- temperature: 0.2-0.35 for support/info, 0.4-0.5 for sales/lead gen

Return ONLY the JSON object. No explanation.
"""

    try:
        raw = invoke_llm(prompt=prompt, temperature=0.2, max_tokens=1000, system_message=system_message)
    except Exception as e:
        print(f"[generate-agent-config] LLM error: {e}")
        raise HTTPException(status_code=500, detail="LLM generation failed")

    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if not match:
        print(f"[generate-agent-config] No JSON in output: {raw[:300]}")
        raise HTTPException(status_code=500, detail="Could not parse generated config")

    try:
        parsed = json.loads(match.group(0))
    except Exception as e:
        print(f"[generate-agent-config] JSON parse error: {e} - raw: {raw[:300]}")
        raise HTTPException(status_code=500, detail="Generated config was malformed JSON")

    def _s(key: str, default: str = "") -> str:
        v = parsed.get(key)
        return str(v).strip() if v else default

    def _list(key: str) -> list:
        v = parsed.get(key)
        if isinstance(v, list):
            return [str(i).strip() for i in v if i]
        return []

    def _float(key: str, default: float = 0.35) -> float:
        try:
            return float(parsed.get(key, default))
        except (TypeError, ValueError):
            return default

    return {
        "agentName": _s("agentName", "My Agent"),
        "businessName": _s("businessName"),
        "tone": _s("tone", "professional"),
        "firstMessage": _s("firstMessage", "Hello! How can I help you today?"),
        "personaName": _s("personaName"),
        "personaSummary": _s("personaSummary"),
        "speakingStyle": _s("speakingStyle"),
        "objectives": _list("objectives"),
        "capabilities": _list("capabilities"),
        "guardrails": _s("guardrails"),
        "systemPrompt": _s("systemPrompt"),
        "temperature": round(max(0.0, min(1.0, _float("temperature", 0.35))), 2),
        "fallbackMessage": _s("fallbackMessage", "I'm going to connect you with one of my teammates for more help."),
    }


# ─── AI Campaign Generation ───────────────────────────────────────────────────

class GenerateCampaignRequest(BaseModel):
    prompt: str
    tenant_id: str


@app.post("/generate-campaign")
async def generate_campaign(request: GenerateCampaignRequest):
    """
    Generate a full campaign configuration from a natural-language prompt.

    Returns:
        name, description, goal, offer, targetPersona, valueProps, painPoints,
        openingScript, qualifyingQuestions, objectionHandlers, callingHours,
        maxConcurrentCalls, retryAttempts, retryDelayMinutes, consentDisclosure
    """
    prompt = (request.prompt or "").strip()
    if not prompt or len(prompt) < 10:
        raise HTTPException(status_code=400, detail="prompt must be at least 10 characters")

    system_prompt = """You are an expert sales strategist and outbound calling consultant.
Your job is to generate a complete outbound calling campaign configuration based on the user's description.

Return ONLY a valid JSON object with these exact fields:
{
  "name": "Short descriptive campaign name (max 60 chars)",
  "description": "2-sentence description of the campaign",
  "goal": one of: "book_meeting" | "qualify_lead" | "transfer_to_human" | "nurture" | "sell_direct",
  "offer": "One sentence describing what you are offering the prospect",
  "targetPersona": "Who you are calling - role, industry, company size",
  "valueProps": ["value prop 1", "value prop 2", "value prop 3", "value prop 4"],
  "painPoints": ["pain 1", "pain 2", "pain 3"],
  "openingScript": "The exact opening line the AI agent will say (2-3 sentences, natural and conversational, uses {agentName} and {businessName} placeholders)",
  "qualifyingQuestions": ["question 1", "question 2", "question 3", "question 4"],
  "objectionHandlers": [
    {"objection": "common objection 1", "response": "empathetic rebuttal 1"},
    {"objection": "common objection 2", "response": "empathetic rebuttal 2"},
    {"objection": "common objection 3", "response": "empathetic rebuttal 3"},
    {"objection": "common objection 4", "response": "empathetic rebuttal 4"}
  ],
  "callingHours": {
    "startHour": 9,
    "endHour": 18,
    "daysOfWeek": [1,2,3,4,5],
    "timezoneOffsetMinutes": 0
  },
  "maxConcurrentCalls": 5,
  "retryAttempts": 2,
  "retryDelayMinutes": 60,
  "consentDisclosure": "Short compliance disclosure or empty string"
}

Rules:
- Keep the openingScript natural, honest, and brief (max 3 sentences).
- Qualifying questions should be BANT-aligned (Budget, Authority, Need, Timeline).
- Objection handlers must be empathetic, not pushy.
- Use {agentName} and {businessName} as placeholders in scripts.
- Return ONLY the JSON. No markdown, no explanation, no code fences."""

    user_message = f"Create a complete outbound calling campaign for this use case:\n\n{prompt}"

    try:
        raw = invoke_llm(
            prompt=user_message,
            system_message=system_prompt,
            temperature=0.4,
            max_tokens=4096,
        )

        # Strip markdown fences if the model wraps in ```json ... ```
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
            cleaned = re.sub(r"\s*```$", "", cleaned)

        parsed = json.loads(cleaned)

        # Validate required fields exist, fill safe defaults for missing ones
        def _s(k, d=""): return str(parsed.get(k, d))
        def _list(k): return [str(x) for x in parsed.get(k, [])] if isinstance(parsed.get(k), list) else []
        def _int(k, d): 
            try: return int(parsed.get(k, d))
            except: return d

        valid_goals = {"book_meeting", "qualify_lead", "transfer_to_human", "nurture", "sell_direct"}
        goal = _s("goal", "qualify_lead")
        if goal not in valid_goals:
            goal = "qualify_lead"

        obj_handlers = []
        raw_handlers = parsed.get("objectionHandlers", [])
        if isinstance(raw_handlers, list):
            for h in raw_handlers:
                if isinstance(h, dict) and h.get("objection") and h.get("response"):
                    obj_handlers.append({"objection": str(h["objection"]), "response": str(h["response"])})

        calling_hours = parsed.get("callingHours", {})
        if not isinstance(calling_hours, dict):
            calling_hours = {}

        return {
            "name": _s("name", "New Campaign"),
            "description": _s("description"),
            "goal": goal,
            "offer": _s("offer"),
            "targetPersona": _s("targetPersona"),
            "valueProps": _list("valueProps"),
            "painPoints": _list("painPoints"),
            "openingScript": _s("openingScript"),
            "qualifyingQuestions": _list("qualifyingQuestions"),
            "objectionHandlers": obj_handlers,
            "callingHours": {
                "startHour": int(calling_hours.get("startHour", 9)),
                "endHour": int(calling_hours.get("endHour", 18)),
                "daysOfWeek": [int(d) for d in calling_hours.get("daysOfWeek", [1, 2, 3, 4, 5])],
                "timezoneOffsetMinutes": int(calling_hours.get("timezoneOffsetMinutes", 0)),
            },
            "maxConcurrentCalls": _int("maxConcurrentCalls", 5),
            "retryAttempts": _int("retryAttempts", 2),
            "retryDelayMinutes": _int("retryDelayMinutes", 60),
            "consentDisclosure": _s("consentDisclosure"),
        }

    except json.JSONDecodeError as e:
        print(f"[GENERATE-CAMPAIGN] JSON parse error: {e}\nRaw: {raw[:500]}")
        raise HTTPException(status_code=500, detail="AI returned invalid JSON. Please try again with a more specific prompt.")
    except Exception as e:
        print(f"[GENERATE-CAMPAIGN] Error: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn

    # Warm up the embedding model so the first real request isn't slow
    try:
        print("[STARTUP] Warming up embedding model...")
        embeddings = rag_utils._get_embeddings()
        embeddings.embed_query("warmup")
        print("[STARTUP] Embedding model ready")
    except Exception as e:
        print(f"[STARTUP] Embedding warmup failed (non-fatal): {e}")

    uvicorn.run(app, host="0.0.0.0", port=8000)
