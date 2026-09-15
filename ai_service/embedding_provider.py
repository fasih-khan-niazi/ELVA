"""
Embedding providers for RAG — Gemini (cloud, fast) with optional Ollama fallback.

Configure via ai_service/.env:
  EMBEDDING_PROVIDER=gemini|ollama
  GEMINI_API_KEY=...
  GEMINI_EMBED_MODEL=gemini-embedding-001
  GEMINI_EMBED_DIM=768
  EMBEDDING_FALLBACK=ollama|none   — use Ollama if Gemini fails (dev safety net)
  EMBEDDING_MODEL=nomic-embed-text — Ollama model when provider/fallback is ollama
"""

from __future__ import annotations

import os
import time
from typing import Any, Dict, List, Optional

EMBEDDING_PROVIDER = os.environ.get("EMBEDDING_PROVIDER", "ollama").lower().strip()
GEMINI_API_KEY = (os.environ.get("GEMINI_API_KEY") or "").strip()
GEMINI_EMBED_MODEL = os.environ.get("GEMINI_EMBED_MODEL", "gemini-embedding-001").strip()
GEMINI_EMBED_DIM = int(os.environ.get("GEMINI_EMBED_DIM", "768"))
EMBEDDING_FALLBACK = os.environ.get("EMBEDDING_FALLBACK", "ollama").lower().strip()
OLLAMA_EMBED_MODEL = os.environ.get("EMBEDDING_MODEL", "nomic-embed-text")


class GeminiEmbeddings:
    """Google Gemini embedding API (~50–150ms per query on free tier)."""

    def __init__(self) -> None:
        if not GEMINI_API_KEY:
            raise ValueError("GEMINI_API_KEY is not set")
        from google import genai
        from google.genai import types

        self._client = genai.Client(api_key=GEMINI_API_KEY)
        self._types = types
        self.model = GEMINI_EMBED_MODEL
        self.dimensions = GEMINI_EMBED_DIM

    def _embed(self, content: str | List[str], task_type: str) -> List[List[float]]:
        from google.genai import types

        config = types.EmbedContentConfig(
            output_dimensionality=self.dimensions,
            task_type=task_type,
        )
        response = self._client.models.embed_content(
            model=self.model,
            contents=content,
            config=config,
        )
        vectors: List[List[float]] = []
        for item in response.embeddings or []:
            values = item.values or []
            vectors.append(list(values))
        if isinstance(content, str):
            return vectors[:1]
        return vectors

    def embed_query(self, text: str) -> List[float]:
        vectors = self._embed(text, "RETRIEVAL_QUERY")
        if not vectors:
            raise RuntimeError("Gemini returned no embedding for query")
        return vectors[0]

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []
        # Batch in groups of 100 to stay within API limits.
        batch_size = 100
        all_vectors: List[List[float]] = []
        for i in range(0, len(texts), batch_size):
            batch = texts[i : i + batch_size]
            if len(batch) == 1:
                all_vectors.extend(self._embed(batch[0], "RETRIEVAL_DOCUMENT"))
            else:
                all_vectors.extend(self._embed(batch, "RETRIEVAL_DOCUMENT"))
        return all_vectors


class OllamaEmbeddings:
    """Local Ollama embeddings — slower but offline / open-source fallback."""

    def __init__(self) -> None:
        from langchain_ollama import OllamaEmbeddings as _OllamaEmbeddings

        self._client = _OllamaEmbeddings(model=OLLAMA_EMBED_MODEL)

    def embed_query(self, text: str) -> List[float]:
        return self._client.embed_query(text)

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        return self._client.embed_documents(texts)


class FallbackEmbeddings:
    """Try primary provider; on failure use fallback (logged once per call)."""

    def __init__(self, primary: Any, fallback: Any, primary_name: str, fallback_name: str) -> None:
        self.primary = primary
        self.fallback = fallback
        self.primary_name = primary_name
        self.fallback_name = fallback_name

    def embed_query(self, text: str) -> List[float]:
        try:
            return self.primary.embed_query(text)
        except Exception as exc:
            print(f"[EMBED] {self.primary_name} failed ({exc}) — using {self.fallback_name}")
            return self.fallback.embed_query(text)

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        try:
            return self.primary.embed_documents(texts)
        except Exception as exc:
            print(f"[EMBED] {self.primary_name} batch failed ({exc}) — using {self.fallback_name}")
            return self.fallback.embed_documents(texts)


_instance: Any = None


def get_embeddings() -> Any:
    """Singleton embedding client for rag_utils."""
    global _instance
    if _instance is not None:
        return _instance

    if EMBEDDING_PROVIDER == "gemini":
        primary = GeminiEmbeddings()
        if EMBEDDING_FALLBACK == "ollama":
            _instance = FallbackEmbeddings(primary, OllamaEmbeddings(), "gemini", "ollama")
        else:
            _instance = primary
        return _instance

    _instance = OllamaEmbeddings()
    return _instance


def get_provider_status() -> Dict[str, Any]:
    """Status dict for /health endpoints."""
    return {
        "provider": EMBEDDING_PROVIDER,
        "geminiConfigured": bool(GEMINI_API_KEY),
        "geminiModel": GEMINI_EMBED_MODEL if EMBEDDING_PROVIDER == "gemini" else None,
        "dimensions": GEMINI_EMBED_DIM if EMBEDDING_PROVIDER == "gemini" else 768,
        "fallback": EMBEDDING_FALLBACK if EMBEDDING_PROVIDER == "gemini" else None,
        "ollamaModel": OLLAMA_EMBED_MODEL,
    }


def warmup_embeddings() -> int:
    """Run one embed call at startup. Returns warmup duration in ms."""
    t0 = time.time()
    get_embeddings().embed_query("warmup")
    return int((time.time() - t0) * 1000)
