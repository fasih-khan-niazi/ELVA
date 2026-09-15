from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import SupabaseVectorStore
from supabase.client import create_client, ClientOptions
from embedding_provider import get_embeddings, get_provider_status, warmup_embeddings as _warmup_embeddings_provider
import os
import re
import time
import threading
from collections import OrderedDict
from typing import Any, Dict, List, Optional, Tuple

import terminal_log as tlog

RAG_VERBOSE = os.environ.get("RAG_VERBOSE", "").lower() in ("1", "true", "yes")


def _rag_log(message: str, *, level: str = "info") -> None:
    """Colored RAG logs — summary always, details when RAG_VERBOSE=1."""
    if level == "err":
        tlog.err("RAG", message)
    elif level == "warn":
        tlog.warn("RAG", message)
    elif level == "ok":
        tlog.ok("RAG", message)
    elif RAG_VERBOSE:
        tlog.dim(message)
    elif level == "summary":
        tlog.info("RAG", message)

# Configuration (Ollama model name used only when EMBEDDING_PROVIDER=ollama or fallback)
EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "nomic-embed-text")
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("Supabase URL and Key must be set in environment variables")

supabase = create_client(
    SUPABASE_URL,
    SUPABASE_KEY,
    options=ClientOptions(
        postgrest_client_timeout=4,   # Default was 120s — fail fast so voice never hangs
        storage_client_timeout=8,     # PDF download budget for re-sync
    ),
)

# Singleton embedding model - avoid re-initialization on every call
_embeddings_instance = None

def _get_embeddings():
    global _embeddings_instance
    if _embeddings_instance is None:
        _embeddings_instance = get_embeddings()
    return _embeddings_instance


def warmup_embeddings() -> None:
    """Pre-warm the configured embedding provider before the first live call."""
    status = get_provider_status()
    ms = _warmup_embeddings_provider()
    msg = f"provider={status['provider']} warmup={ms}ms dims={status.get('dimensions')}"
    tlog.ok("RAG", f"Embeddings ready — {msg}")


# ───────────────────────── Query-result cache ─────────────────────────
# Caches the full (context, sources, metrics) tuple keyed by
# (tenant_id, agent_id, normalized_query, match_count). TTL keeps stale answers out of
# active sessions; max size keeps memory bounded.
#
# Why cache results, not just embeddings:
#   - Repeated user queries (e.g. "menu", "prices") are common in chat/voice.
#   - The full pipeline (embed + Supabase RPC + rerank) is the expensive part;
#     caching only embeddings still pays the DB roundtrip every turn.
_RAG_CACHE_TTL_SECONDS = int(os.environ.get("RAG_CACHE_TTL_SECONDS", "300"))
_RAG_CACHE_MAX_ENTRIES = int(os.environ.get("RAG_CACHE_MAX_ENTRIES", "256"))
_rag_cache: "OrderedDict[Tuple[str, str, str, str], Tuple[float, Dict[str, Any]]]" = OrderedDict()
_rag_cache_lock = threading.Lock()


def _cache_get(key: Tuple[str, str, str, str]) -> Optional[Dict[str, Any]]:
    if _RAG_CACHE_TTL_SECONDS <= 0:
        return None
    now = time.time()
    with _rag_cache_lock:
        entry = _rag_cache.get(key)
        if not entry:
            return None
        ts, value = entry
        if now - ts > _RAG_CACHE_TTL_SECONDS:
            _rag_cache.pop(key, None)
            return None
        # LRU bump
        _rag_cache.move_to_end(key)
        return value


def _cache_set(key: Tuple[str, str, str, str], value: Dict[str, Any]) -> None:
    if _RAG_CACHE_TTL_SECONDS <= 0:
        return
    with _rag_cache_lock:
        _rag_cache[key] = (time.time(), value)
        _rag_cache.move_to_end(key)
        # Evict oldest entries above the cap
        while len(_rag_cache) > _RAG_CACHE_MAX_ENTRIES:
            _rag_cache.popitem(last=False)


def invalidate_rag_cache(tenant_id: Optional[str] = None, agent_id: Optional[str] = None) -> int:
    """
    Drop cached query results. Called from ingestion / deletion paths so the
    next query sees fresh data. Returns the number of entries removed.
    """
    with _rag_cache_lock:
        if tenant_id is None and agent_id is None:
            removed = len(_rag_cache)
            _rag_cache.clear()
            return removed
        removed = 0
        for key in list(_rag_cache.keys()):
            t, a = key[0], key[1]
            if tenant_id and t != tenant_id:
                continue
            if agent_id and a != (agent_id or ""):
                continue
            _rag_cache.pop(key, None)
            removed += 1
        return removed


def _normalize_query(query: str) -> str:
    cleaned = re.sub(r"\s+", " ", query or "").strip()
    return cleaned


def _tokenize(text: str) -> List[str]:
    return re.findall(r"[a-zA-Z0-9']+", (text or "").lower())


def _lexical_boost(query: str, content: str) -> float:
    query_tokens = set(_tokenize(query))
    if not query_tokens:
        return 0.0

    content_tokens = _tokenize(content)
    if not content_tokens:
        return 0.0

    overlap = query_tokens.intersection(content_tokens)
    overlap_ratio = len(overlap) / max(1, len(query_tokens))
    phrase_bonus = 0.15 if query.lower() in (content or "").lower() else 0.0
    return overlap_ratio + phrase_bonus


def _tenant_agent_filter(docs: List[Dict], tenant_id: str, agent_id: str = None) -> List[Dict]:
    """
    Filter chunks to ones belonging to (tenant_id, agent_id).

    Strict by default: a chunk with no ``agent_id`` is treated as legacy /
    tenant-wide and is NOT served unless ``ALLOW_TENANT_GLOBAL_DOCS=true`` is
    set in the environment. The previous behaviour (always allowing
    agent_id=None to leak into every agent) caused cross-agent context bleed
    and is kept only as a transitional fallback.
    """
    allow_global = os.environ.get(
        "ALLOW_TENANT_GLOBAL_DOCS", "false"
    ).lower() in ("1", "true", "yes")

    filtered_docs: List[Dict] = []
    skipped_global = 0
    for doc in docs:
        metadata = doc.get("metadata", {}) or {}
        if metadata.get("tenant_id") != tenant_id:
            continue

        doc_agent_id = metadata.get("agent_id")
        if agent_id:
            # Normalise to string — Mongo ObjectIds and form fields must match.
            if str(doc_agent_id or "") == str(agent_id):
                filtered_docs.append(doc)
            elif doc_agent_id is None:
                if allow_global:
                    filtered_docs.append(doc)
                else:
                    skipped_global += 1
        else:
            # No agent scope requested - keep everything for this tenant.
            filtered_docs.append(doc)

    if skipped_global:
        print(
            f"[RAG] Skipped {skipped_global} tenant-global chunks (no agent_id) - "
            f"set ALLOW_TENANT_GLOBAL_DOCS=true to include them."
        )
    return filtered_docs


def _dedupe_docs(docs: List[Dict]) -> List[Dict]:
    seen = set()
    unique_docs = []
    for doc in docs:
        content = (doc.get("content") or "").strip()
        if not content:
            continue
        fingerprint = hash(content[:240].lower())
        if fingerprint in seen:
            continue
        seen.add(fingerprint)
        unique_docs.append(doc)
    return unique_docs


def _rerank_docs(query: str, docs: List[Dict]) -> List[Dict]:
    scored = []
    for doc in docs:
        similarity = float(doc.get("similarity") or 0.0)
        content = doc.get("content") or ""
        lexical = _lexical_boost(query, content)
        final_score = (0.7 * similarity) + (0.3 * lexical)
        doc["_final_score"] = final_score
        scored.append(doc)
    scored.sort(key=lambda item: item.get("_final_score", 0.0), reverse=True)
    return scored


def _short_source_label(doc: Dict) -> str:
    """Return a concise source label (filename without extension) for a document chunk."""
    import os as _os
    metadata = doc.get("metadata") or {}
    source = (
        metadata.get("source")
        or metadata.get("file_path")
        or metadata.get("filename")
        or ""
    )
    if source:
        basename = _os.path.basename(source)
        name, _ = _os.path.splitext(basename)
        return (name or source)[:40]
    return "KB"


def _build_citations(top_docs: List[Dict], max_items: int = 6) -> List[Dict[str, Any]]:
    citations: List[Dict[str, Any]] = []
    for idx, doc in enumerate(top_docs[:max_items], start=1):
        metadata = doc.get("metadata") or {}
        citations.append(
            {
                "index": idx,
                "score": round(float(doc.get("_final_score") or 0.0), 4),
                "similarity": round(float(doc.get("similarity") or 0.0), 4),
                "preview": (doc.get("content") or "")[:220].replace("\n", " "),
                "source": metadata.get("source") or metadata.get("file_path") or metadata.get("filename") or "unknown",
                "page": metadata.get("page"),
            }
        )
    return citations

def ingest_pdf(file_path: str, tenant_id: str, agent_id: str = None, document_id: str = None):
    # 1. Load PDF
    loader = PyPDFLoader(file_path)
    documents = loader.load()

    total_chars = sum(len((d.page_content or "").strip()) for d in documents)
    pages = len(documents)
    tlog.info("RAG", f"PDF extracted: {pages} page(s), {total_chars:,} chars")

    if pages > 0 and total_chars < 500:
        tlog.warn(
            "RAG",
            f"Very little text ({total_chars} chars) — PDF may be image-based; use text PDF or Knowledge summary",
        )

    # 2. Split Text
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
    chunks = text_splitter.split_documents(documents)

    _rag_log(
        f"Chunking: {len(chunks)} chunks (~1000 chars each) — all searched at query time",
        level="summary",
    )

    # Add tenant_id, agent_id, and document_id to every chunk's metadata.
    # document_id allows precise per-document deletion later without touching
    # other documents' chunks for the same agent.
    for chunk in chunks:
        chunk.metadata["tenant_id"] = tenant_id
        if agent_id:
            chunk.metadata["agent_id"] = agent_id
        if document_id:
            chunk.metadata["document_id"] = document_id

    # Delete existing chunks for this document before re-inserting (re-sync / re-upload).
    if document_id:
        try:
            supabase.table("document_chunks").delete().eq(
                "metadata->>document_id", str(document_id)
            ).execute()
            _rag_log(f"Cleared existing chunks for document_id={document_id}")
        except Exception as e:
            _rag_log(f"Could not delete old chunks for document_id={document_id}: {e}", level="warn")

    # 3. Vectorize & Store
    embeddings = _get_embeddings()

    SupabaseVectorStore.from_documents(
        documents=chunks,
        embedding=embeddings,
        client=supabase,
        table_name="document_chunks",
        query_name="match_documents"
    )

    invalidate_rag_cache(tenant_id=tenant_id, agent_id=agent_id)
    return len(chunks)

def ingest_text(text: str, tenant_id: str, agent_id: str = None, source: str = "text", metadata: dict = None):
    """Ingest raw text (e.g. catalog data) into the vector store."""
    from langchain_core.documents import Document as LCDocument
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)

    trimmed = (text or "").strip()

    embeddings = _get_embeddings()

    # Delete existing catalog chunks for this tenant/source before re-inserting
    if agent_id and source.startswith("catalog_"):
        try:
            supabase.table("document_chunks").delete().eq(
                "metadata->>source", source
            ).eq(
                "metadata->>tenant_id", tenant_id
            ).execute()
            print(f"[RAG] Deleted old catalog chunks for source={source}")
        except Exception as e:
            print(f"[RAG] Warning: could not delete old catalog chunks: {e}")

    # Manual knowledge summary: one logical source per agent — replace entirely on each save.
    if agent_id and source == "agent_knowledge_summary":
        try:
            supabase.table("document_chunks").delete().eq(
                "metadata->>source", source
            ).eq(
                "metadata->>tenant_id", tenant_id
            ).eq(
                "metadata->>agent_id", str(agent_id)
            ).execute()
            print(f"[RAG] Cleared agent_knowledge_summary chunks for agent={agent_id}")
        except Exception as e:
            print(f"[RAG] Warning: could not delete old knowledge summary chunks: {e}")

        if not trimmed:
            invalidate_rag_cache(tenant_id=tenant_id, agent_id=agent_id)
            return 0

    base_meta = {"tenant_id": tenant_id, "source": source}
    if agent_id:
        base_meta["agent_id"] = agent_id
    if metadata:
        base_meta.update(metadata)

    body = trimmed if source == "agent_knowledge_summary" else (text or "")
    doc = LCDocument(page_content=body, metadata=base_meta)
    chunks = text_splitter.split_documents([doc])

    for chunk in chunks:
        chunk.metadata["tenant_id"] = tenant_id
        if agent_id:
            chunk.metadata["agent_id"] = agent_id

    SupabaseVectorStore.from_documents(
        documents=chunks,
        embedding=embeddings,
        client=supabase,
        table_name="document_chunks",
        query_name="match_documents"
    )

    tlog.ok("RAG", f"Ingested {len(chunks)} chunks · source={source}")
    invalidate_rag_cache(tenant_id=tenant_id, agent_id=agent_id)
    return len(chunks)

def query_rag_with_sources(
    query: str,
    tenant_id: str,
    agent_id: Optional[str] = None,
    *,
    match_count: Optional[int] = None,
):
    try:
        started = time.time()
        normalized_query = _normalize_query(query)
        _rag_log(f"Query: '{normalized_query[:60]}' · tenant={tenant_id} · agent={agent_id}", level="summary")

        # Default 120 favors recall + rerank pool for chat.
        # Voice callers should pass a lower ``match_count`` (see main.py) to stay inside Twilio's
        # ~15s webhook budget — embed + large ``match_documents`` dominates tail latency.
        mc = match_count if match_count is not None else int(os.environ.get("RAG_MATCH_COUNT", "120"))
        mc = max(3, min(mc, 200))

        # match_documents ranks globally across ALL agents in the table.
        # When scoping to one agent we must oversample before post-filtering,
        # otherwise other agents' chunks fill the top-N slots (multi-agent bleed).
        rpc_match_count = mc
        if agent_id and tenant_id:
            rpc_match_count = max(mc, int(os.environ.get("RAG_AGENT_OVERSAMPLE", "60")))
            rpc_match_count = min(rpc_match_count, 200)
        cache_key = (tenant_id or "", agent_id or "", normalized_query.lower(), str(mc))

        # Cache hit? Skip embed + RPC + rerank entirely.
        cached = _cache_get(cache_key)
        if cached is not None:
            metrics = dict(cached.get("metrics", {}))
            metrics["cacheHit"] = True
            metrics["durationMs"] = int((time.time() - started) * 1000)
            _rag_log(f"Cache HIT — {metrics['durationMs']}ms", level="summary")
            return {
                "context": cached.get("context", "No relevant context found."),
                "sources": cached.get("sources", []),
                "metrics": metrics,
            }

        embeddings = _get_embeddings()

        t_embed0 = time.time()
        query_embedding = embeddings.embed_query(normalized_query)
        embed_ms = int((time.time() - t_embed0) * 1000)

        # Direct query to Supabase using RPC.
        # match_threshold: minimum cosine similarity for the initial DB filter.
        # 0.32 keeps recall high while filtering out near-noise chunks. The
        # post-rerank QUALITY_FLOOR below tightens further.
        match_threshold = float(os.environ.get("RAG_MATCH_THRESHOLD", "0.32"))

        t_rpc0 = time.time()
        rpc_params: Dict[str, Any] = {
            "query_embedding": query_embedding,
            "match_threshold": match_threshold,
            "match_count": rpc_match_count,
        }
        # Prefer SQL-side agent scoping when the DB function supports it (see supabase_schema.sql).
        if agent_id and tenant_id:
            rpc_params["filter_tenant_id"] = tenant_id
            rpc_params["filter_agent_id"] = str(agent_id)

        try:
            response = supabase.rpc("match_documents", rpc_params).execute()
        except Exception as rpc_err:
            err_text = str(rpc_err).lower()
            if "filter_tenant_id" in err_text or "filter_agent_id" in err_text or "does not exist" in err_text:
                _rag_log("match_documents filter params unsupported — using oversample + post-filter", level="warn")
                fallback_params = {
                    "query_embedding": query_embedding,
                    "match_threshold": match_threshold,
                    "match_count": rpc_match_count,
                }
                response = supabase.rpc("match_documents", fallback_params).execute()
            else:
                raise rpc_err
        rpc_ms = int((time.time() - t_rpc0) * 1000)
        docs = response.data or []

        if docs and RAG_VERBOSE:
            agent_ids_seen: Dict[str, int] = {}
            for d in docs[:20]:
                aid = (d.get("metadata") or {}).get("agent_id", "__global__")
                agent_ids_seen[aid] = agent_ids_seen.get(aid, 0) + 1
            _rag_log(f"Raw DB matches: {len(docs)} · agent distribution (top 20): {agent_ids_seen}")

        filtered_docs = _tenant_agent_filter(docs, tenant_id, agent_id)
        unique_docs = _dedupe_docs(filtered_docs)

        if RAG_VERBOSE:
            _rag_log(f"After filter: {len(filtered_docs)} · after dedupe: {len(unique_docs)}")
        
        reranked_docs = _rerank_docs(normalized_query, unique_docs)

        # Drop very-low-quality chunks (final_score below threshold adds noise, not signal).
        # 0.40 is a moderately strict floor - strong enough to suppress tangential matches
        # but lenient enough that genuinely-relevant chunks still pass. The fallback below
        # protects sparse KBs.
        QUALITY_FLOOR = float(os.environ.get("RAG_QUALITY_FLOOR", "0.40"))
        quality_docs = [d for d in reranked_docs if d.get("_final_score", 0.0) >= QUALITY_FLOOR]
        # Fall back to top results if nothing clears the floor (e.g. sparse KB)
        # Keep only the top ``mc`` after agent scoping + rerank.
        top_docs = (quality_docs if quality_docs else reranked_docs)[:mc]

        tlog.info(
            "RAG",
            f"Query done — embed={embed_ms}ms rpc={rpc_ms}ms · {len(top_docs)} chunks returned",
        )

        if top_docs and RAG_VERBOSE:
            for i, doc in enumerate(top_docs):
                similarity = float(doc.get('similarity') or 0.0)
                final_score = float(doc.get('_final_score') or 0.0)
                content_preview = doc.get('content', '')[:80].replace('\n', ' ')
                _rag_log(f"Doc {i+1}: sim={similarity:.3f} score={final_score:.3f} | {content_preview}...")

        # Assemble context with source labels so the LLM can attribute answers correctly
        context_parts = []
        for doc in top_docs:
            label = _short_source_label(doc)
            context_parts.append(f"[Source: {label}]\n{doc['content']}")
        context = "\n\n---\n\n".join(context_parts)
        citations = _build_citations(top_docs)
        metrics = {
            "query": normalized_query,
            "matchCount": mc,
            "rawMatches": len(docs),
            "tenantScopedMatches": len(filtered_docs),
            "uniqueMatches": len(unique_docs),
            "returnedChunks": len(top_docs),
            "durationMs": int((time.time() - started) * 1000),
        }
        
        if context:
            if RAG_VERBOSE:
                _rag_log(f"Returning context: {len(context)} chars")
            result = {
                "context": context,
                "sources": citations,
                "metrics": metrics,
            }
            _cache_set(cache_key, result)
            return result
        else:
            tlog.warn("RAG", "No matching documents found")
            empty_result = {
                "context": "No relevant context found.",
                "sources": [],
                "metrics": metrics,
            }
            _cache_set(cache_key, empty_result)
            return empty_result
        
    except Exception as e:
        tlog.err("RAG", str(e))
        import traceback
        traceback.print_exc()
        return {
            "context": "No relevant context found.",
            "sources": [],
            "metrics": {
                "query": _normalize_query(query),
                "rawMatches": 0,
                "tenantScopedMatches": 0,
                "uniqueMatches": 0,
                "returnedChunks": 0,
                "durationMs": 0,
                "error": str(e),
            },
        }


def query_rag(query: str, tenant_id: str, agent_id: str = None):
    result = query_rag_with_sources(query=query, tenant_id=tenant_id, agent_id=agent_id)
    return result.get("context", "No relevant context found.")