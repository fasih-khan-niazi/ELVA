"""
Unified LLM provider - Groq (fast cloud) with optional Ollama (local) fallback.

Key features:
  - Re-reads GROQ_API_KEY on every call (so .env edits take effect immediately
    after a uvicorn reload, no manual process restart needed).
  - Supports multi-key rotation via GROQ_API_KEYS=key1,key2,key3. On a 429
    rate-limit, the next key is tried automatically.
  - Supports model fallback: GROQ_MODEL_FALLBACKS=llama-3.1-8b-instant,...
    If the primary model is rate-limited or unavailable, the next model is
    tried before falling back to Ollama.
  - Ollama fallback is GATED behind LLM_ALLOW_OLLAMA_FALLBACK (default true).
    For production it can be disabled - Ollama on CPU is so slow (30–60s+)
    that it usually makes UX worse than a clean error message.
  - Logs a key fingerprint on first use so you can verify which key is live.

Usage:
    from llm_provider import invoke_llm
    text = invoke_llm(prompt, temperature=0.1, max_tokens=1024)

Configure via environment variables:
    LLM_PROVIDER             = "groq" | "ollama"             (default: groq)
    GROQ_API_KEY             = gsk_...                        (single key)
    GROQ_API_KEYS            = gsk_...,gsk_...                (multi-key rotation)
    GROQ_MODEL               = llama-3.3-70b-versatile        (default)
    GROQ_MODEL_FALLBACKS     = llama-3.1-8b-instant,...       (rate-limit fallback)
    LLM_ALLOW_OLLAMA_FALLBACK= "true" | "false"               (default: true)
    LLM_BUSY_MESSAGE         = customer-facing busy text      (when fallback off)
    LLM_MODEL                = llama3.2                       (ollama model)
    LLM_FALLBACK_MODELS      = llama3.1,mistral               (ollama fallbacks)
    LLM_MAX_ATTEMPTS         = 2                              (per ollama model)
"""

import os
import time
from typing import Iterator, List, Optional, Tuple

# ─── Provider selection ───────────────────────────────────────────────────


def _get_provider() -> str:
    return os.environ.get("LLM_PROVIDER", "groq").lower().strip()


def _bool_env(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


# ─── Groq key + client management ─────────────────────────────────────────
#
# Clients are cached per-key (not per-process) so rotating GROQ_API_KEY in
# .env, plus a uvicorn reload, is enough to start using the new key. No
# stale singleton sticks around with a depleted key.

_groq_clients: dict = {}


def _fingerprint(key: str) -> str:
    """Last 6 chars - safe to log so the user can verify which key is live."""
    if not key:
        return "<empty>"
    return f"...{key[-6:]}"


def _read_groq_keys() -> List[str]:
    """
    Return the ordered list of Groq API keys to try.
    GROQ_API_KEYS (plural, comma-separated) takes precedence; falls back to
    the singular GROQ_API_KEY for backwards compatibility.
    """
    raw_multi = os.environ.get("GROQ_API_KEYS", "").strip()
    if raw_multi:
        keys = [k.strip() for k in raw_multi.split(",") if k.strip()]
        if keys:
            return keys
    single = os.environ.get("GROQ_API_KEY", "").strip()
    return [single] if single else []


def _read_groq_models() -> List[str]:
    """Primary GROQ_MODEL plus optional GROQ_MODEL_FALLBACKS, deduped."""
    primary = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile").strip()
    raw_fallbacks = os.environ.get("GROQ_MODEL_FALLBACKS", "").strip()
    fallbacks = [m.strip() for m in raw_fallbacks.split(",") if m.strip()]
    seen, ordered = set(), []
    for m in [primary] + fallbacks:
        if m and m not in seen:
            seen.add(m)
            ordered.append(m)
    return ordered


def _get_groq_client(api_key: str):
    """Return a Groq client for this key, creating + caching it on first use."""
    if not api_key:
        raise RuntimeError(
            "GROQ_API_KEY not set. Get a free key at https://console.groq.com"
        )
    client = _groq_clients.get(api_key)
    if client is None:
        from groq import Groq
        client = Groq(api_key=api_key)
        _groq_clients[api_key] = client
        print(f"[LLM][Groq] Initialised client for key {_fingerprint(api_key)}")
    return client


# ─── Groq invoke (with model + key rotation) ─────────────────────────────


def _is_rate_limit_error(err: Exception) -> bool:
    """429 rate-limits are recoverable by switching key/model; others aren't."""
    msg = str(err).lower()
    return (
        "429" in msg
        or "rate_limit" in msg
        or "rate limit" in msg
        or "tokens per day" in msg
        or "tokens per minute" in msg
    )


def _is_auth_error(err: Exception) -> bool:
    """Bad/expired key - useful to skip permanently this run."""
    msg = str(err).lower()
    return (
        "401" in msg
        or "invalid_api_key" in msg
        or "invalid api key" in msg
        or "authentication" in msg
    )


def _invoke_groq(
    prompt: str,
    temperature: float = 0.1,
    max_tokens: int = 1024,
    system_message: Optional[str] = None,
) -> Tuple[str, bool]:
    """
    Try every (model × key) combination until one succeeds.

    Returns ``(text, ok)`` where ``ok`` is True on success. On total failure,
    raises the last exception so the caller can decide whether to fall back
    to Ollama.
    """
    keys = _read_groq_keys()
    models = _read_groq_models()
    if not keys:
        raise RuntimeError(
            "GROQ_API_KEY (or GROQ_API_KEYS) not set. "
            "Get a free key at https://console.groq.com"
        )

    messages = []
    if system_message:
        messages.append({"role": "system", "content": system_message})
    messages.append({"role": "user", "content": prompt})

    last_error: Optional[Exception] = None
    skipped_keys: set = set()
    rate_limited_models: set = set()

    # Outer loop over keys lets us rotate when a key hits its daily TPD.
    # Inner loop over models lets us drop from 70b→8b within the same key
    # if the model itself is throttled.
    for key in keys:
        if key in skipped_keys:
            continue
        for model in models:
            cache_key = (key, model)
            if cache_key in rate_limited_models:
                continue
            try:
                client = _get_groq_client(key)
                started = time.time()
                response = client.chat.completions.create(
                    model=model,
                    messages=messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
                elapsed = int((time.time() - started) * 1000)
                text = response.choices[0].message.content or ""
                tokens_used = getattr(response.usage, "total_tokens", 0)
                print(
                    f"[LLM][Groq] {model} (key {_fingerprint(key)}) - "
                    f"{elapsed}ms, {tokens_used} tokens"
                )
                return text, True
            except Exception as err:
                last_error = err
                if _is_auth_error(err):
                    print(
                        f"[LLM][Groq] AUTH FAIL on key {_fingerprint(key)} - "
                        f"skipping for this run. ({err})"
                    )
                    skipped_keys.add(key)
                    break  # try next key entirely
                if _is_rate_limit_error(err):
                    print(
                        f"[LLM][Groq] 429 on {model} (key {_fingerprint(key)}) - "
                        f"trying next model/key. ({err})"
                    )
                    rate_limited_models.add(cache_key)
                    continue
                print(
                    f"[LLM][Groq] {model} (key {_fingerprint(key)}) "
                    f"failed: {err}"
                )
                continue

    if last_error:
        raise last_error
    raise RuntimeError("Groq invocation failed for an unknown reason.")


# ─── Ollama invoke ─────────────────────────────────────────────────────────


def _invoke_ollama(
    prompt: str,
    temperature: float = 0.1,
    max_tokens: int = 1024,
    system_message: Optional[str] = None,
) -> str:
    from langchain_ollama import OllamaLLM

    model_name = os.environ.get("LLM_MODEL", "llama3.2")
    raw_fallbacks = os.environ.get("LLM_FALLBACK_MODELS", "llama3.1,mistral")
    fallback_models = [
        m.strip() for m in raw_fallbacks.split(",")
        if m.strip() and m.strip() != model_name
    ]
    max_attempts = int(os.environ.get("LLM_MAX_ATTEMPTS", "2"))

    full_prompt = f"{system_message}\n\n{prompt}" if system_message else prompt
    models = [model_name] + fallback_models
    last_error: Optional[Exception] = None

    for model in models:
        for attempt in range(1, max(1, max_attempts) + 1):
            try:
                started = time.time()
                llm = OllamaLLM(model=model, temperature=temperature)
                response = llm.invoke(full_prompt)
                elapsed = int((time.time() - started) * 1000)
                tag = "Fallback: " if model != model_name else ""
                print(f"[LLM][Ollama] {tag}{model} (attempt {attempt}) - {elapsed}ms")
                return response
            except Exception as err:
                last_error = err
                print(f"[LLM][Ollama] {model} attempt {attempt} failed: {err}")

    raise RuntimeError(f"All Ollama LLM attempts failed. Last error: {last_error}")


# ─── Unified invoke ───────────────────────────────────────────────────────


# Customer-visible message used when Groq is exhausted and Ollama fallback
# is disabled. Short and apologetic - better UX than a 70-second wait.
_DEFAULT_BUSY_MESSAGE = (
    "I'm experiencing very high traffic at the moment and can't generate a "
    "full reply right now. Please try again in a minute, or contact us "
    "directly so our team can help you straight away."
)


def invoke_llm_order_extract(
    prompt: str,
    temperature: float = 0.0,
    max_tokens: int = 512,
    system_message: Optional[str] = None,
) -> str:
    """
    Heavier model used only when the fast 8b order-item JSON extraction returns [].
    Keeps normal voice turns on llama-3.1-8b-instant for latency.
    """
    model = (
        os.environ.get("GROQ_ORDER_EXTRACT_MODEL", "").strip()
        or "llama-3.3-70b-versatile"
    )
    keys = _read_groq_keys()
    if not keys:
        return invoke_llm(prompt, temperature, max_tokens, system_message)

    messages = []
    if system_message:
        messages.append({"role": "system", "content": system_message})
    messages.append({"role": "user", "content": prompt})

    last_error: Optional[Exception] = None
    for key in keys:
        try:
            client = _get_groq_client(key)
            started = time.time()
            response = client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
            )
            elapsed = int((time.time() - started) * 1000)
            text = response.choices[0].message.content or ""
            tokens_used = getattr(response.usage, "total_tokens", 0)
            print(
                f"[LLM][Groq][order-extract] {model} (key {_fingerprint(key)}) - "
                f"{elapsed}ms, {tokens_used} tokens"
            )
            return text
        except Exception as err:
            last_error = err
            print(f"[LLM][Groq][order-extract] {model} failed: {err}")

    print(f"[LLM][Groq][order-extract] all keys failed ({last_error}) — falling back to invoke_llm")
    return invoke_llm(prompt, temperature, max_tokens, system_message)


def invoke_llm(
    prompt: str,
    temperature: float = 0.1,
    max_tokens: int = 1024,
    system_message: Optional[str] = None,
) -> str:
    """
    Invoke the configured LLM provider.

    Behaviour for the default 'groq' provider:
      1. Try every (model × key) combination on Groq.
      2. If all fail and LLM_ALLOW_OLLAMA_FALLBACK is true, try Ollama.
      3. If Ollama is disabled (or also fails), return LLM_BUSY_MESSAGE.

    The Ollama fallback gate exists because local CPU inference can take
    30–60s, which is worse UX than a fast apology.
    """
    provider = _get_provider()

    if provider == "groq":
        try:
            text, _ok = _invoke_groq(prompt, temperature, max_tokens, system_message)
            return text
        except Exception as e:
            allow_ollama = _bool_env("LLM_ALLOW_OLLAMA_FALLBACK", True)
            if not allow_ollama:
                print(
                    f"[LLM] Groq failed ({e}); Ollama fallback disabled - "
                    f"returning busy message."
                )
                return os.environ.get("LLM_BUSY_MESSAGE", _DEFAULT_BUSY_MESSAGE)
            print(f"[LLM] Groq failed ({e}), falling back to Ollama...")
            try:
                return _invoke_ollama(prompt, temperature, max_tokens, system_message)
            except Exception as e2:
                print(f"[LLM] Ollama also failed: {e2} - returning busy message.")
                return os.environ.get("LLM_BUSY_MESSAGE", _DEFAULT_BUSY_MESSAGE)

    elif provider == "ollama":
        try:
            return _invoke_ollama(prompt, temperature, max_tokens, system_message)
        except Exception as e:
            print(f"[LLM] Ollama failed ({e}) - returning busy message.")
            return os.environ.get("LLM_BUSY_MESSAGE", _DEFAULT_BUSY_MESSAGE)

    else:
        raise ValueError(f"Unknown LLM_PROVIDER: {provider}. Use 'groq' or 'ollama'.")


# ─── Streaming invoke (Groq only — voice latency) ─────────────────────────


def invoke_llm_stream(
    prompt: str,
    temperature: float = 0.1,
    max_tokens: int = 1024,
    system_message: Optional[str] = None,
) -> Iterator[str]:
    """
    Stream token deltas from Groq. Falls back to a single-chunk iterator
    if streaming fails (caller still gets the full text once).
    """
    if _get_provider() != "groq":
        yield invoke_llm(prompt, temperature, max_tokens, system_message)
        return

    keys = _read_groq_keys()
    models = _read_groq_models()
    if not keys:
        raise RuntimeError("GROQ_API_KEY not set")

    messages = []
    if system_message:
        messages.append({"role": "system", "content": system_message})
    messages.append({"role": "user", "content": prompt})

    last_error: Optional[Exception] = None
    for key in keys:
        for model in models:
            try:
                client = _get_groq_client(key)
                started = time.time()
                stream = client.chat.completions.create(
                    model=model,
                    messages=messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    stream=True,
                )
                max_stream_sec = float(os.environ.get("GROQ_VOICE_MAX_STREAM_SEC", "12"))
                got_any = False
                for chunk in stream:
                    if time.time() - started > max_stream_sec:
                        print(
                            f"[LLM][Groq-STREAM] cap {max_stream_sec}s on {model} — returning partial"
                        )
                        break
                    delta = chunk.choices[0].delta.content or ""
                    if delta:
                        got_any = True
                        yield delta
                if got_any:
                    elapsed = int((time.time() - started) * 1000)
                    print(
                        f"[LLM][Groq-STREAM] {model} (key {_fingerprint(key)}) — {elapsed}ms"
                    )
                    return
            except Exception as err:
                last_error = err
                if _is_rate_limit_error(err) or _is_auth_error(err):
                    continue
                print(f"[LLM][Groq-STREAM] {model} failed: {err}")
                continue

    if last_error:
        print(f"[LLM][Groq-STREAM] falling back to non-streaming: {last_error}")
    yield invoke_llm(prompt, temperature, max_tokens, system_message)
