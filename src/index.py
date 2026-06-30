"""
Embed chunks with BAAI/bge-small-en-v1.5 (local, no API) -> FAISS, with
week-filtered retrieval.

Build the index from data/chunks.jsonl:
    python src/index.py build
    python src/index.py build --model BAAI/bge-base-en-v1.5   # bigger/better

Query it (the 'week' filter is the whole point — scope to the current week):
    python src/index.py query "what is grouping selectors" --week week1 -k 5
    python src/index.py query "the three Vs of big data" -k 5   # no week filter

Index artifacts (data/index/):
    faiss.index   inner-product index over L2-normalized vectors (== cosine)
    meta.jsonl    one row per vector, aligned to its FAISS id: {id, text, metadata}
    config.json   {model, dim, normalized, count}

The downstream MCQ generator just imports Retriever:
    from index import Retriever
    hits = Retriever().retrieve("...", week="week1", k=8)
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CHUNKS = REPO_ROOT / "data" / "chunks.jsonl"
INDEX_DIR = REPO_ROOT / "data" / "index"

MODEL_NAME = "BAAI/bge-small-en-v1.5"
# bge-v1.5 wants this instruction on the QUERY side only (documents are embedded as-is).
QUERY_PREFIX = "Represent this sentence for searching relevant passages: "


def _load_model(name: str):
    from sentence_transformers import SentenceTransformer
    return SentenceTransformer(name)


# --------------------------------------------------------------------------- #
# Build
# --------------------------------------------------------------------------- #
def build(chunks_path: Path = CHUNKS, index_dir: Path = INDEX_DIR,
          model_name: str = MODEL_NAME) -> None:
    import faiss
    import numpy as np

    rows = [json.loads(line) for line in chunks_path.open()]
    if not rows:
        raise SystemExit(f"No chunks in {chunks_path} — run src/ingest.py first.")

    model = _load_model(model_name)
    emb = model.encode(
        [r["text"] for r in rows],
        batch_size=64,
        normalize_embeddings=True,        # -> inner product == cosine similarity
        convert_to_numpy=True,
        show_progress_bar=True,
    ).astype(np.float32)

    index = faiss.IndexFlatIP(emb.shape[1])   # exact search; ideal at course scale
    index.add(emb)

    index_dir.mkdir(parents=True, exist_ok=True)
    faiss.write_index(index, str(index_dir / "faiss.index"))
    with (index_dir / "meta.jsonl").open("w") as fh:
        for r in rows:
            fh.write(json.dumps(
                {"id": r["id"], "text": r["text"], "metadata": r["metadata"]},
                ensure_ascii=False) + "\n")
    (index_dir / "config.json").write_text(json.dumps(
        {"model": model_name, "dim": int(emb.shape[1]), "normalized": True,
         "count": len(rows)}, indent=2))

    weeks = sorted({str(r["metadata"].get("week")) for r in rows})
    print(f"Indexed {len(rows)} chunks (dim={emb.shape[1]}) -> {index_dir}")
    print(f"weeks present: {weeks}")


# --------------------------------------------------------------------------- #
# Retrieve (week-filtered)
# --------------------------------------------------------------------------- #
class Retriever:
    """Loads the index + model once; retrieve() searches with an optional week filter."""

    def __init__(self, index_dir: Path = INDEX_DIR):
        import faiss
        if not (index_dir / "faiss.index").exists():
            raise SystemExit(f"No index at {index_dir} — run: python src/index.py build")
        cfg = json.loads((index_dir / "config.json").read_text())
        self.index = faiss.read_index(str(index_dir / "faiss.index"))
        self.meta = [json.loads(line) for line in (index_dir / "meta.jsonl").open()]
        self.model = _load_model(cfg["model"])

    def retrieve(self, query: str, week: str | None = None, k: int = 5,
                 fetch: int | None = None) -> list[dict]:
        """Return up to k chunks (each: score + id + text + metadata).

        FAISS has no native metadata filter, so when a week is given we over-fetch
        and keep only that week's hits. At course scale this is exact and instant;
        for many courses, switch to a FAISS IDSelector over per-week id lists.
        """
        import numpy as np

        qv = self.model.encode(
            [QUERY_PREFIX + query], normalize_embeddings=True, convert_to_numpy=True,
        ).astype(np.float32)

        if fetch is None:
            fetch = k if week is None else max(50, k * 20)
        fetch = min(fetch, self.index.ntotal)
        scores, ids = self.index.search(qv, fetch)

        hits = []
        for score, i in zip(scores[0], ids[0]):
            if i < 0:
                continue
            row = self.meta[i]
            if week is not None and row["metadata"].get("week") != week:
                continue
            hits.append({"score": float(score), **row})
            if len(hits) >= k:
                break
        return hits


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def main() -> None:
    ap = argparse.ArgumentParser(description="bge embeddings -> FAISS with week filter.")
    sub = ap.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("build", help="embed data/chunks.jsonl into a FAISS index")
    b.add_argument("--chunks", type=Path, default=CHUNKS)
    b.add_argument("--index-dir", type=Path, default=INDEX_DIR)
    b.add_argument("--model", default=MODEL_NAME)

    q = sub.add_parser("query", help="search the index")
    q.add_argument("text")
    q.add_argument("--week", default=None, help="restrict to this module/week")
    q.add_argument("-k", type=int, default=5)
    q.add_argument("--index-dir", type=Path, default=INDEX_DIR)

    args = ap.parse_args()
    if args.cmd == "build":
        build(args.chunks, args.index_dir, args.model)
    else:
        for h in Retriever(args.index_dir).retrieve(args.text, week=args.week, k=args.k):
            m = h["metadata"]
            print(f"[{h['score']:.3f}] {m['source_file']} · {m['loc_type']} {m['loc']} "
                  f"· week={m.get('week')}")
            print("    " + h["text"][:160].replace("\n", " ") + " …")


if __name__ == "__main__":
    main()
