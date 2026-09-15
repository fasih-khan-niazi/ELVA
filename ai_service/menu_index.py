"""
MenuIndex — single menu truth per agent/call for voice ordering.

Catalog API wins when populated; KB/RAG text fills gaps.
Used for fuzzy item matching and authoritative pricing (Tier A: no LLM on hits).
"""

from __future__ import annotations

import os
import re
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

import httpx

# Shared with agent_runtime synonym map (kept in sync manually).
MENU_SYNONYMS: Dict[str, str] = {
    "bbq": "barbecue",
    "barbeque": "barbecue",
    "mix": "mixed",
    "plater": "platter",
    "bar": "barbecue",
}

STT_MENU_PHRASE_FIXES: List[tuple] = [
    (r"\bmix\s*bar\b", "mixed barbecue"),
    (r"\bmixed\s*bar\b", "mixed barbecue"),
    (r"\bbar\s*barbecue\b", "barbecue"),
    (r"\bpassword\s+menu\b", "fast food menu"),
    (r"\bsour\s+soup\b", "hot and sour soup"),
    (r"\bhot\s+sour\s+soup\b", "hot and sour soup"),
]

_catalog_struct_cache: Dict[str, tuple] = {}
_catalog_text_cache: Dict[str, tuple] = {}
_cache_lock = threading.Lock()
_CACHE_TTL = int(os.environ.get("CATALOG_CACHE_TTL_SECONDS", "300"))


def _internal_api_headers() -> Dict[str, str]:
    secret = os.environ.get("INTERNAL_API_SECRET", "").strip()
    return {"x-internal-secret": secret} if secret else {}


def normalize_menu_text(text: str) -> str:
    t = re.sub(r"[,\.\?!;:]+", "", (text or "").lower()).strip()
    t = re.sub(r"\s+", " ", t)
    for pattern, repl in STT_MENU_PHRASE_FIXES:
        t = re.sub(pattern, repl, t)
    return " ".join(MENU_SYNONYMS.get(w, w) for w in t.split())


@dataclass
class MenuItem:
    name: str
    price: float
    source: str = "catalog"
    normalized: str = field(default="")

    def __post_init__(self) -> None:
        if not self.normalized:
            self.normalized = normalize_menu_text(self.name)


def extract_menu_entries_from_text(text: str) -> List[MenuItem]:
    """Parse catalog lines or RAG prose (e.g. 'French Fries for PKR 350')."""
    if not text:
        return []
    entries: List[MenuItem] = []
    seen: set = set()
    price_tail = r"(?:\$|€|£|₹|Rs\.?\s*|PKR\s*|AED\s*|SAR\s*)(\d+(?:[.,]\d{1,2})?)"

    for line in text.split("\n"):
        line = line.strip()
        if not line or len(line) < 4:
            continue
        name: Optional[str] = None
        price = 0.0
        m = re.match(rf"^[•\-\*]?\s*(.+?):\s*{price_tail}", line, re.I)
        if m:
            name, price = m.group(1).strip(), float(m.group(2).replace(",", "."))
        if not name:
            m = re.match(rf"^(.+?)\s+for\s+{price_tail}\b", line, re.I)
            if m:
                name, price = m.group(1).strip(), float(m.group(2).replace(",", "."))
        if not name:
            m = re.match(rf"^(.+?)\s*[-–—]\s*{price_tail}\b", line, re.I)
            if m:
                name, price = m.group(1).strip(), float(m.group(2).replace(",", "."))
        if not name or len(name) < 2:
            continue
        name = re.sub(r"\s+", " ", name).strip(" ,.")
        key = normalize_menu_text(name)
        if key in seen:
            continue
        seen.add(key)
        entries.append(MenuItem(name=name, price=price, source="kb"))

    inline_pat = re.compile(
        rf"([A-Za-z][A-Za-z0-9 &'/&/-]{{2,55}}?)\s+for\s+{price_tail}",
        re.I,
    )
    for m in inline_pat.finditer(text):
        name = re.sub(r"\s+", " ", m.group(1)).strip(" ,.")
        name = re.sub(
            r"^(?:we have|like|and|our|also|including|such as|starters? like|bbq items? like)\s+",
            "",
            name,
            flags=re.I,
        ).strip()
        price = float(m.group(2).replace(",", "."))
        key = normalize_menu_text(name)
        if key not in seen and len(name) >= 3:
            seen.add(key)
            entries.append(MenuItem(name=name, price=price, source="kb"))

    return entries


def fetch_catalog_struct(agent_id: str, tenant_id: str) -> Tuple[List[Dict[str, Any]], str]:
    """Return (items, currency) from backend catalog API."""
    key = f"{tenant_id}:{agent_id}"
    now = time.time()
    with _cache_lock:
        hit = _catalog_struct_cache.get(key)
        if hit and now - hit[0] < _CACHE_TTL:
            return hit[1], hit[2]

    backend_url = os.environ.get("BACKEND_URL", "http://localhost:3000")
    try:
        with httpx.Client(timeout=8) as client:
            resp = client.get(
                f"{backend_url}/api/internal/catalog",
                params={"agentId": agent_id, "tenantId": tenant_id},
                headers=_internal_api_headers(),
            )
            if resp.status_code != 200:
                print(f"[MenuIndex] Catalog fetch HTTP {resp.status_code}")
                return [], "PKR"
            payload = resp.json()
            if isinstance(payload, dict):
                items = payload.get("items") or []
                currency = (payload.get("currency") or "PKR").upper()
            else:
                items = payload if isinstance(payload, list) else []
                currency = "PKR"
            with _cache_lock:
                _catalog_struct_cache[key] = (now, items, currency)
            return items, currency
    except Exception as exc:
        print(f"[MenuIndex] Catalog fetch failed: {exc}")
        return [], "PKR"


class MenuIndex:
    """In-memory menu for one agent; catalog entries override KB duplicates."""

    def __init__(self, agent_id: str, tenant_id: str) -> None:
        self.agent_id = agent_id
        self.tenant_id = tenant_id
        self.currency = "PKR"
        self.items: Dict[str, MenuItem] = {}
        self.blob = ""
        self.source = "none"

    def warm_from_catalog(self) -> int:
        rows, currency = fetch_catalog_struct(self.agent_id, self.tenant_id)
        self.currency = currency
        added = 0
        for row in rows:
            name = (row.get("name") or "").strip()
            if not name:
                continue
            price = float(row.get("price") or 0)
            item = MenuItem(name=name, price=price, source="catalog")
            self.items[item.normalized] = item
            added += 1
        if added:
            self.source = "catalog"
            self._rebuild_blob()
            print(f"[MenuIndex] Warmed {added} catalog items for agent={self.agent_id}")
        else:
            print(f"[MenuIndex] Catalog empty for agent={self.agent_id}")
        return added

    def merge_kb_text(self, text: str) -> int:
        """Add KB/RAG items only when not already in catalog (catalog wins)."""
        if not text:
            return 0
        added = 0
        for entry in extract_menu_entries_from_text(text):
            if entry.normalized in self.items:
                continue
            self.items[entry.normalized] = entry
            added += 1
        if added:
            self.source = "catalog+kb" if self.source == "catalog" else ("kb" if self.source == "none" else self.source)
            self._rebuild_blob()
        return added

    def _rebuild_blob(self) -> None:
        sym = "Rs." if self.currency == "PKR" else "$"
        lines = ["=== MENU INDEX ==="]
        for item in sorted(self.items.values(), key=lambda x: x.name.lower()):
            lines.append(f"  • {item.name}: {sym}{item.price:.0f}")
        self.blob = "\n".join(lines)

    def apply_to_order_state(self, order_state: Dict[str, Any]) -> None:
        order_state["_menu_index_ready"] = bool(self.items)
        order_state["_menu_index_source"] = self.source
        order_state["_menu_index_count"] = len(self.items)
        if self.blob:
            order_state["_session_menu_blob"] = self.blob
        order_state["_menu_index_items"] = [
            {"name": i.name, "price": i.price, "normalized": i.normalized}
            for i in self.items.values()
        ]

    @classmethod
    def from_order_state(cls, agent_id: str, tenant_id: str, order_state: Optional[Dict]) -> MenuIndex:
        idx = cls(agent_id, tenant_id)
        if not order_state:
            return idx
        for row in order_state.get("_menu_index_items") or []:
            name = row.get("name", "")
            if not name:
                continue
            item = MenuItem(
                name=name,
                price=float(row.get("price") or 0),
                source=order_state.get("_menu_index_source", "cache"),
            )
            idx.items[item.normalized] = item
        blob = (order_state.get("_session_menu_blob") or "").strip()
        if blob:
            idx.blob = blob
            idx.source = order_state.get("_menu_index_source", idx.source)
        return idx

    def fuzzy_match(
        self,
        query: str,
        strip_residue: Optional[Callable[[str], str]] = None,
    ) -> List[Dict[str, Any]]:
        if not query or not self.items:
            return []

        queries = [query]
        if strip_residue:
            residue = strip_residue(query)
            if residue and residue != query.strip().lower():
                queries.append(residue)

        best: Optional[MenuItem] = None
        best_score = 0
        best_q_norm = ""

        skip_tokens = frozenset({
            "a", "an", "the", "as", "well", "too", "also", "please", "add",
            "get", "order", "want", "like", "some", "more", "extra",
        })

        for q in queries:
            q_norm = normalize_menu_text(q)
            q_words = {w for w in q_norm.split() if len(w) > 1 and w not in skip_tokens}
            if not q_words:
                continue
            for item in self.items.values():
                name_norm = item.normalized
                name_words = {w for w in name_norm.split() if len(w) > 1}
                if name_norm in q_norm or q_norm in name_norm:
                    score = 100 + len(name_norm)
                else:
                    overlap = q_words & name_words
                    if not overlap:
                        continue
                    overlap_n = len(overlap)
                    if overlap_n < 2:
                        only = next(iter(overlap))
                        if len(only) < 4:
                            continue
                    coverage = overlap_n / max(len(q_words), 1)
                    score = overlap_n * 25 + int(coverage * 30) + len(name_norm)
                if score > best_score:
                    best_score = score
                    best = item
                    best_q_norm = q_norm

            if not best and len(q_words) == 1:
                word = next(iter(q_words))
                if len(word) >= 4:
                    matches = [i for i in self.items.values() if word in i.normalized.split()]
                    if len(matches) == 1:
                        best, best_score, best_q_norm = matches[0], 80, q_norm

        if not best or best_score < 55:
            return []

        # Reject weak matches when the customer named something not in the menu item
        # (e.g. "chicken wings" must not map to "Chicken Corn Soup" via "chicken" alone).
        if best_q_norm:
            q_words = {w for w in best_q_norm.split() if len(w) > 1 and w not in skip_tokens}
            stray = [w for w in q_words if len(w) >= 4 and w not in best.normalized]
            if stray and best_score < 90:
                print(
                    f"[MenuIndex] Rejected weak match '{query}' -> '{best.name}' "
                    f"(score={best_score}, stray={stray})"
                )
                return []

        print(f"[MenuIndex] Fuzzy match (score={best_score}): '{query}' -> '{best.name}' @ {best.price}")
        return [{"name": best.name, "quantity": 1, "price": best.price}]

    @staticmethod
    def split_order_segments(query: str) -> List[str]:
        """Split compound add requests: 'fries and wings' -> ['fries', 'wings']."""
        q = (query or "").lower().strip()
        q = re.sub(r"[,\.\?!;:]+$", "", q)
        q = re.sub(
            r"^(?:please\s+)?(?:add|get|order|i want|i'd like|id like|give me|can i get|can i have)\s+",
            "",
            q,
        )
        q = re.sub(r"\s+(?:as well|too|also|please)\.?$", "", q)
        parts = re.split(r"\s+and\s+|\s*,\s*|\s+plus\s+|\s+with\s+", q, flags=re.I)
        out: List[str] = []
        for part in parts:
            seg = re.sub(r"\s+", " ", part.strip())
            if len(seg) >= 3:
                out.append(seg)
        return out or ([q] if len(q) >= 3 else [])

    def fuzzy_match_all(
        self,
        query: str,
        strip_residue: Optional[Callable[[str], str]] = None,
    ) -> tuple:
        """Match each segment in a compound utterance. Returns (items, unmatched_phrases)."""
        segments = self.split_order_segments(query)
        if not segments:
            return [], []
        if len(segments) == 1:
            hit = self.fuzzy_match(segments[0], strip_residue=strip_residue)
            return hit, [] if hit else [segments[0]]

        matched: List[Dict[str, Any]] = []
        unmatched: List[str] = []
        seen: set = set()
        for seg in segments:
            hits = self.fuzzy_match(seg, strip_residue=strip_residue)
            if hits:
                key = normalize_menu_text(hits[0].get("name", ""))
                if key not in seen:
                    seen.add(key)
                    matched.append(hits[0])
            else:
                unmatched.append(seg)
        return matched, unmatched

    def enrich_item_prices(self, items: List[Dict[str, Any]]) -> None:
        for item in items:
            if float(item.get("price") or 0) > 0:
                continue
            norm = normalize_menu_text(item.get("name", ""))
            hit = self.items.get(norm)
            if not hit:
                for key, mi in self.items.items():
                    if norm in key or key in norm:
                        hit = mi
                        break
            if hit and hit.price > 0:
                item["price"] = hit.price

    def ensure_context(
        self,
        order_state: Optional[Dict[str, Any]],
        kb_context: str = "",
        rag_fetch: Optional[Callable[[], str]] = None,
    ) -> str:
        if not self.items:
            self.warm_from_catalog()
        # Catalog populated → authoritative; do not merge stale KB menu lines.
        catalog_authoritative = self.source == "catalog" and bool(self.items)
        if kb_context and not catalog_authoritative:
            self.merge_kb_text(kb_context)
        if order_state and not catalog_authoritative:
            session_blob = (order_state.get("_session_menu_blob") or "").strip()
            if session_blob:
                self.merge_kb_text(session_blob)
        if not self.items and rag_fetch:
            try:
                rag = rag_fetch()
                if rag and rag != "No relevant context found.":
                    self.merge_kb_text(rag)
                    print("[MenuIndex] Loaded menu from RAG fallback")
            except Exception as exc:
                print(f"[MenuIndex] RAG fallback failed: {exc}")
        if order_state is not None:
            self.apply_to_order_state(order_state)
        return self.blob
