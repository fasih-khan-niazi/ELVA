"""Network helpers — prefer IPv4 on Windows to reduce EAI_AGAIN DNS failures."""

from __future__ import annotations

import socket


def prefer_ipv4_dns() -> None:
    """
    Patch getaddrinfo to prefer IPv4 results first.
    Fixes intermittent getaddrinfo EAI_AGAIN on Windows dev machines.
    """
    if getattr(prefer_ipv4_dns, "_applied", False):
        return

    original = socket.getaddrinfo

    def _getaddrinfo_ipv4_first(*args, **kwargs):
        results = original(*args, **kwargs)
        ipv4 = [r for r in results if r[0] == socket.AF_INET]
        return ipv4 or results

    socket.getaddrinfo = _getaddrinfo_ipv4_first  # type: ignore[assignment]
    prefer_ipv4_dns._applied = True  # type: ignore[attr-defined]
