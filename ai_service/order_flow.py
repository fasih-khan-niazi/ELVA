"""
Order flow guards — phase checks, submit validation, idempotency helpers.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

# Canonical phases for voice/chat ordering.
PHASE_IDLE = "idle"
PHASE_COLLECTING = "collecting"
PHASE_AWAITING_DETAILS = "awaiting_details"
PHASE_REVIEWING = "reviewing"
PHASE_SUBMITTED = "submitted"

ORDER_ACTIVE_PHASES = frozenset({
    PHASE_COLLECTING,
    PHASE_AWAITING_DETAILS,
    PHASE_REVIEWING,
})


def current_phase(order_state: Optional[Dict[str, Any]]) -> str:
    if not order_state:
        return PHASE_IDLE
    return (order_state.get("status") or PHASE_IDLE).lower()


def has_cart_items(order_state: Optional[Dict[str, Any]]) -> bool:
    return bool(order_state and order_state.get("items"))


def can_start_confirm(order_state: Dict[str, Any]) -> bool:
    return has_cart_items(order_state) and current_phase(order_state) in (
        PHASE_COLLECTING,
        PHASE_AWAITING_DETAILS,
        PHASE_REVIEWING,
    )


def can_final_submit(order_state: Dict[str, Any]) -> Tuple[bool, str]:
    """Review-step yes → submit. Returns (ok, reason)."""
    if current_phase(order_state) == PHASE_SUBMITTED:
        return False, "already_submitted"
    if current_phase(order_state) != PHASE_REVIEWING:
        return False, "not_reviewing"
    if not has_cart_items(order_state):
        return False, "empty_cart"
    customer = order_state.get("customer") or {}
    if not customer.get("name"):
        return False, "missing_name"
    if not customer.get("phone"):
        return False, "missing_phone"
    if not order_state.get("order_type"):
        return False, "missing_order_type"
    if (order_state.get("order_type") or "").lower() == "delivery":
        if not (customer.get("address") or "").strip():
            return False, "missing_address"
    return True, "ok"


def validate_items_for_submit(
    items: List[Dict[str, Any]],
    *,
    require_prices: bool = True,
) -> Tuple[bool, str]:
    if not items:
        return False, "no_items"
    for it in items:
        if not (it.get("name") or "").strip():
            return False, "unnamed_item"
        if require_prices and float(it.get("price") or 0) <= 0:
            return False, f"zero_price:{it.get('name')}"
    return True, "ok"


def mark_submit_attempt(order_state: Dict[str, Any], session_id: str) -> bool:
    """
    Idempotency guard. Returns False if submit already in progress or completed.
    """
    if current_phase(order_state) == PHASE_SUBMITTED:
        return False
    key = f"_submit_key_{session_id}"
    if order_state.get(key):
        return False
    order_state[key] = True
    return True


def phone_skip_allowed(channel: str) -> bool:
    """Voice orders require phone; chat may allow skip in future."""
    return channel != "voice"


def address_skip_allowed(order_state: Dict[str, Any], channel: str) -> bool:
    """Delivery address is mandatory on voice delivery orders."""
    if channel == "voice" and (order_state.get("order_type") or "").lower() == "delivery":
        return False
    return True
