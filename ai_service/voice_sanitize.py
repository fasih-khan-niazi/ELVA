"""
Post-LLM sanitizers for voice — catches hallucinations the state machine missed.
"""
import re
from typing import Any, Dict, Optional


_ORDER_CONFIRM_RE = re.compile(
    r"\b("
    r"order(?:'s|\s+is)?\s+(?:confirmed|placed|submitted|being\s+processed|on\s+its\s+way)|"
    r"(?:confirmed|placed)\s+your\s+order|"
    r"total(?:\s+is|\s+comes\s+to)?\s+(?:rs\.?|pkr|\$|€|£)\s*\d+|"
    r"(?:ready|prepared|delivered)\s+in\s+\d+\s*(?:minutes|mins|hours)"
    r")\b",
    re.I,
)


_CASH_ONLY_CLAIM_RE = re.compile(
    r"\b(cash only|only cash|we only (?:accept|take) cash|no cards?(?: or digital wallets?)?)\b",
    re.I,
)

_PHONE_FORMAT_LECTURE_RE = re.compile(
    r"\b("
    r"zero triple|triple three|one two three|say (?:it|your number) like|"
    r"eleven digit|starting with zero|digit by digit|for example.*zero"
    r")\b",
    re.I,
)


def _strip_phone_format_lectures(text: str) -> str:
    """Remove sentences that teach the caller how to say phone digits."""
    parts = re.split(r"(?<=[.!?])\s+", text.strip())
    kept = [p for p in parts if p and not _PHONE_FORMAT_LECTURE_RE.search(p)]
    return " ".join(kept).strip() if kept else text.strip()


def _strip_unauthorized_cash_claims(text: str) -> str:
    if not _CASH_ONLY_CLAIM_RE.search(text):
        return text
    parts = re.split(r"(?<=[.!?])\s+", text.strip())
    kept = [p for p in parts if p and not _CASH_ONLY_CLAIM_RE.search(p)]
    return " ".join(kept).strip() if kept else text.strip()


def sanitize_voice_llm_response(
    text: str,
    *,
    order_state: Optional[Dict[str, Any]],
    intent: str,
    has_kb_context: bool,
    currency: str = "USD",
) -> str:
    """Strip or replace common voice hallucinations."""
    if not text or not text.strip():
        return text

    status = (order_state or {}).get("status") or "idle"
    items = (order_state or {}).get("items") or []
    out = text.strip()
    out = _strip_unauthorized_cash_claims(out)
    out = _strip_phone_format_lectures(out)

    if currency == "PKR":
        out = re.sub(r"\$(\d+(?:\.\d{1,2})?)", r"Rs \1", out)
        out = re.sub(
            r"(\d+(?:\.\d{1,2})?)\s+dollars?\b",
            r"Rs \1",
            out,
            flags=re.I,
        )

    # Never claim order confirmed unless actually submitted.
    if status != "submitted" and _ORDER_CONFIRM_RE.search(out):
        if not items:
            return (
                "I don't have any items in your order yet. "
                "Tell me what you'd like and I'll add it for you."
            )
        if status in ("collecting", "awaiting_details", "reviewing"):
            return (
                "I'm still collecting your details for that order. "
                "Let me know when you're ready to continue."
            )

    # During active order flow, freeform LLM should not run — but if it did, clamp.
    if (
        status in ("collecting", "awaiting_details", "reviewing")
        and intent not in ("question", "complete_request")
        and _ORDER_CONFIRM_RE.search(out)
    ):
        return "Let's finish your order first — what would you like to do next?"

    return out
