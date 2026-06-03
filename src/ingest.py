"""
Chunk metadata schema (what every chunk carries):
    week         module name, e.g. "week1"      (None in --all-files mode)
    source_file  original filename
    file_id      Canvas file id (stable handle for re-download / citation)
    loc_type     "page" (PDF) or "slide" (PPTX)
    loc          1-based page/slide number       <- powers "source reference"
    chunk_index  position of this chunk within that page/slide
    course_id    Canvas course id
    n_tokens     token count (cl100k_base)

Output: one JSON object per line in data/chunks.jsonl:
    {"id": "...", "text": "...", "metadata": {...}}

Usage:
    python src/ingest.py --course-id 2
    python src/ingest.py --course-id 2 --all-files     # ignore modules
"""

from __future__ import annotations

import argparse
import json
import warnings
from pathlib import Path

import fitz  # PyMuPDF
import requests
import tiktoken
from canvasapi import Canvas
from dotenv import dotenv_values
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pptx import Presentation

# canvasapi warns on every HTTP (non-HTTPS) request; our local Canvas is HTTP.
warnings.filterwarnings("ignore", message="Canvas may respond unexpectedly")

REPO_ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = REPO_ROOT / ".env"


CHUNK_TOKENS = 900
CHUNK_OVERLAP = 120

_enc = tiktoken.get_encoding("cl100k_base")
_splitter = RecursiveCharacterTextSplitter.from_tiktoken_encoder(
    encoding_name="cl100k_base",
    chunk_size=CHUNK_TOKENS,
    chunk_overlap=CHUNK_OVERLAP,
)


# --------------------------------------------------------------------------- #
# Canvas connection
# --------------------------------------------------------------------------- #
def get_canvas() -> Canvas:
    cfg = dotenv_values(ENV_PATH)
    url = (cfg.get("CANVAS_BASE_URL") or "").strip()
    token = (cfg.get("CANVAS_API_TOKEN") or "").strip()
    if not url or not token:
        raise SystemExit(f"CANVAS_BASE_URL / CANVAS_API_TOKEN missing in {ENV_PATH}")
    return Canvas(url, token)


# --------------------------------------------------------------------------- #
# Enumerate the files to ingest (with their week label)
# --------------------------------------------------------------------------- #
SUPPORTED = (".pdf", ".pptx")


def iter_content_units(course, all_files: bool = False):
    """Yield (week, file_obj) for every PDF/PPTX to ingest.

    Default: walk Modules and take File items -> week = module name.
    --all-files: take every supported file on the course -> week = None.
    """
    if all_files:
        for f in course.get_files():
            if f.display_name.lower().endswith(SUPPORTED):
                yield None, f
        return

    modules = list(course.get_modules())
    if not modules:
        raise SystemExit(
            "No modules found. Organize content into Modules (e.g. 'week1'), "
            "or re-run with --all-files to ingest every file."
        )
    for m in modules:
        for item in m.get_module_items():
            if item.type != "File":
                continue
            f = course.get_file(item.content_id)
            if f.display_name.lower().endswith(SUPPORTED):
                yield m.name, f


def download(file_obj, raw_dir: Path) -> Path:
    """Download a Canvas file to raw_dir/<file_id>_<name>, cached if present.
    """
    raw_dir.mkdir(parents=True, exist_ok=True)
    dest = raw_dir / f"{file_obj.id}_{file_obj.display_name}"
    if not dest.exists():
        resp = requests.get(file_obj.url, timeout=60)
        resp.raise_for_status()
        dest.write_bytes(resp.content)
    return dest


# --------------------------------------------------------------------------- #
# Text extraction (keeps page / slide numbers)
# --------------------------------------------------------------------------- #
def extract_pdf(path: Path) -> list[tuple[int, str]]:
    """Return [(page_number_1based, text), ...]."""
    out = []
    with fitz.open(path) as doc:
        for i, page in enumerate(doc, start=1):
            out.append((i, page.get_text("text").strip()))
    return out


def extract_pptx(path: Path) -> list[tuple[int, str]]:
    """Return [(slide_number_1based, text), ...] incl. shape text + tables."""
    out = []
    prs = Presentation(str(path))
    for i, slide in enumerate(prs.slides, start=1):
        parts: list[str] = []
        for shape in slide.shapes:
            if shape.has_text_frame and shape.text_frame.text.strip():
                parts.append(shape.text_frame.text.strip())
            if shape.has_table:
                for row in shape.table.rows:
                    parts.append(" | ".join(c.text for c in row.cells))
        out.append((i, "\n".join(parts).strip()))
    return out


# --------------------------------------------------------------------------- #
# Chunking
# --------------------------------------------------------------------------- #
def chunk_unit(week, file_obj, course_id: int, path: Path) -> list[dict]:
    """Extract + chunk one file into metadata-tagged chunk records.

    Slides -> one chunk per slide (split only if a slide overflows CHUNK_TOKENS).
    PDF    -> per page, recursively split with overlap. Chunking *per page*
              keeps an exact page number on every chunk for citations.
    """
    ext = path.suffix.lower()
    if ext == ".pdf":
        pages, loc_type = extract_pdf(path), "page"
    elif ext == ".pptx":
        pages, loc_type = extract_pptx(path), "slide"
    else:
        return []

    records = []
    for loc, text in pages:
        if not text:
            continue
        for ci, piece in enumerate(_splitter.split_text(text)):
            records.append(
                {
                    "id": f"{file_obj.id}-{loc_type}{loc}-{ci}",
                    "text": piece,
                    "metadata": {
                        "course_id": course_id,
                        "week": week,
                        "source_file": file_obj.display_name,
                        "file_id": file_obj.id,
                        "loc_type": loc_type,
                        "loc": loc,
                        "chunk_index": ci,
                        "n_tokens": len(_enc.encode(piece)),
                    },
                }
            )
    return records


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def main() -> None:
    ap = argparse.ArgumentParser(description="Ingest Canvas content into chunks.")
    ap.add_argument("--course-id", type=int, default=2)
    ap.add_argument("--out", type=Path, default=REPO_ROOT / "data" / "chunks.jsonl")
    ap.add_argument("--raw-dir", type=Path, default=REPO_ROOT / "data" / "raw")
    ap.add_argument("--all-files", action="store_true",
                    help="Ignore modules; ingest every PDF/PPTX on the course.")
    args = ap.parse_args()

    course = get_canvas().get_course(args.course_id)
    print(f"Course: {course.name}\n")

    all_records: list[dict] = []
    per_file: list[tuple] = []
    for week, f in iter_content_units(course, all_files=args.all_files):
        path = download(f, args.raw_dir)
        recs = chunk_unit(week, f, args.course_id, path)
        all_records.extend(recs)
        per_file.append((week, f.display_name, len(recs)))
        print(f"  [{week or '-'}] {f.display_name}: {len(recs)} chunks")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w") as fh:
        for r in all_records:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")

    print(f"\n{len(all_records)} chunks from {len(per_file)} files -> {args.out}")
    if all_records:
        sample = all_records[len(all_records) // 2]
        print("\nSample chunk:")
        print("  id:", sample["id"])
        print("  metadata:", json.dumps(sample["metadata"]))
        print("  text:", sample["text"][:300].replace("\n", " ") + " ...")


if __name__ == "__main__":
    main()
