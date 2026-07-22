"""Optional RAG retrieval layer: chunk week text -> bge embeddings -> FAISS,
with week-filtered similarity search.

The current generator stuffs a whole week's text into the LLM, which is fine
while a week fits the context window. This module is provided for when that
stops scaling — large weeks, whole-course review, or source-cited retrieval —
so the generator can pull the top-k relevant chunks instead of everything.

``select_material()`` is wired into generation (app/generation.py): every quiz
is built from chunk -> bge -> FAISS focused material rather than a raw truncated
blob. Heavy deps are regular requirements, imported lazily. ``WeekRetriever``
below is also available for multi-week / persistent retrieval. Typical use:

    r = WeekRetriever()
    r.add_week("Week 1", extract_week_text(root, module), source="week1")
    r.build()
    for score, chunk in r.retrieve("how do CSS selectors group?", week="Week 1", k=6):
        ...
"""

from __future__ import annotations

from dataclasses import dataclass

MODEL_NAME = "BAAI/bge-small-en-v1.5"
# bge-v1.5 wants this instruction on the QUERY side only (passages embedded as-is).
QUERY_PREFIX = "Represent this sentence for searching relevant passages: "
CHUNK_TOKENS = 900
CHUNK_OVERLAP = 120


def chunk_text(text: str, chunk_tokens: int = CHUNK_TOKENS,
               overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Token-aware recursive split (respects paragraph/sentence boundaries)."""
    from langchain_text_splitters import RecursiveCharacterTextSplitter

    splitter = RecursiveCharacterTextSplitter.from_tiktoken_encoder(
        encoding_name="cl100k_base", chunk_size=chunk_tokens, chunk_overlap=overlap,
    )
    return [c for c in splitter.split_text(text) if c.strip()]


_shared_model = None


def _get_model(model_name: str = MODEL_NAME):
    """Load the embedding model once per process (avoids reloading per call)."""
    global _shared_model
    if _shared_model is None:
        from sentence_transformers import SentenceTransformer

        _shared_model = SentenceTransformer(model_name)
    return _shared_model


def select_material(text: str, query: str, max_tokens: int = 12_000,
                    model_name: str = MODEL_NAME) -> str:
    """Chunk -> bge embeddings -> FAISS; return the chunks most relevant to
    ``query`` that fit ``max_tokens``, in reading order.

    Wired into generation so every quiz is built from focused material instead of
    a raw character-truncated blob. If everything fits the budget all chunks are
    kept (lossless); only oversized weeks get trimmed by relevance.
    """
    import faiss
    import numpy as np
    import tiktoken

    chunks = chunk_text(text)
    if len(chunks) <= 1:
        return text

    enc = tiktoken.get_encoding("cl100k_base")
    tokens = [len(enc.encode(c)) for c in chunks]

    model = _get_model(model_name)
    emb = model.encode(chunks, normalize_embeddings=True, convert_to_numpy=True).astype(np.float32)
    index = faiss.IndexFlatIP(emb.shape[1])
    index.add(emb)
    qv = model.encode(
        [QUERY_PREFIX + query], normalize_embeddings=True, convert_to_numpy=True,
    ).astype(np.float32)
    _, ranked = index.search(qv, len(chunks))

    picked: set[int] = set()
    used = 0
    for i in ranked[0]:
        if i < 0:
            continue
        if picked and used + tokens[i] > max_tokens:
            break
        picked.add(int(i))
        used += tokens[i]

    return "\n\n".join(chunks[i] for i in range(len(chunks)) if i in picked)


@dataclass
class Chunk:
    text: str
    week: str
    source: str


class WeekRetriever:
    """In-memory FAISS index over week chunks; retrieve top-k, filtered by week."""

    def __init__(self, model_name: str = MODEL_NAME):
        from sentence_transformers import SentenceTransformer

        self.model = SentenceTransformer(model_name)
        self._chunks: list[Chunk] = []
        self._index = None

    def add_week(self, week: str, text: str, source: str = "") -> None:
        for piece in chunk_text(text):
            self._chunks.append(Chunk(piece, week, source))

    def build(self) -> None:
        import faiss
        import numpy as np

        if not self._chunks:
            raise ValueError("No chunks added — call add_week() first.")
        emb = self.model.encode(
            [c.text for c in self._chunks], normalize_embeddings=True,
            convert_to_numpy=True,
        ).astype(np.float32)
        self._index = faiss.IndexFlatIP(emb.shape[1])  # cosine (normalized vectors)
        self._index.add(emb)

    def retrieve(self, query: str, week: str | None = None, k: int = 8) -> list[tuple[float, Chunk]]:
        import numpy as np

        if self._index is None:
            raise RuntimeError("Index not built — call build() first.")
        qv = self.model.encode(
            [QUERY_PREFIX + query], normalize_embeddings=True, convert_to_numpy=True,
        ).astype(np.float32)
        # FAISS has no metadata filter: over-fetch, then keep this week's hits.
        fetch = min(len(self._chunks), k if week is None else max(50, k * 20))
        scores, ids = self._index.search(qv, fetch)
        out: list[tuple[float, Chunk]] = []
        for score, i in zip(scores[0], ids[0]):
            if i < 0:
                continue
            chunk = self._chunks[i]
            if week is not None and chunk.week != week:
                continue
            out.append((float(score), chunk))
            if len(out) >= k:
                break
        return out
