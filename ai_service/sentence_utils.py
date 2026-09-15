"""Detect complete spoken sentences from a streaming LLM token buffer."""

from __future__ import annotations

import re
from typing import List

_SENTENCE_END_RE = re.compile(r"(?<=[.!?])\s+")


class SentenceStreamBuffer:
    """Accumulate token deltas and emit complete sentences for voice TTS."""

    def __init__(self, min_chars: int = 10, max_sentences: int = 3) -> None:
        self._buf = ""
        self.min_chars = min_chars
        self.max_sentences = max_sentences
        self.emitted = 0

    def feed(self, token: str) -> List[str]:
        if not token:
            return []
        self._buf += token
        return self._drain(force=False)

    def flush(self) -> List[str]:
        remaining = self._buf.strip()
        self._buf = ""
        if remaining and self.emitted < self.max_sentences:
            self.emitted += 1
            return [remaining]
        return []

    def _drain(self, force: bool) -> List[str]:
        out: List[str] = []
        while self.emitted < self.max_sentences:
            match = _SENTENCE_END_RE.search(self._buf)
            if not match:
                if force and len(self._buf.strip()) >= self.min_chars:
                    text = self._buf.strip()
                    self._buf = ""
                    self.emitted += 1
                    out.append(text)
                break
            candidate = self._buf[: match.start() + 1].strip()
            self._buf = self._buf[match.end() :]
            if len(candidate) < self.min_chars:
                continue
            self.emitted += 1
            out.append(candidate)
        return out


def split_into_sentences(text: str, max_sentences: int = 3) -> List[str]:
    """Split static text into up to ``max_sentences`` spoken chunks."""
    buf = SentenceStreamBuffer(min_chars=1, max_sentences=max_sentences)
    parts: List[str] = []
    for sent in buf.feed(text):
        parts.append(sent)
    parts.extend(buf.flush())
    if not parts and text.strip():
        return [text.strip()]
    return parts[:max_sentences]
