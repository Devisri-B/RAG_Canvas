"""
RAG question generator — Gemini, grounded in retrieved course content.

User preferences: question TYPE (mcq, true_false, …) and NUMBER of questions,
plus Bloom's-taxonomy difficulty and an optional topic. Questions are generated
ONLY from chunks retrieved for the chosen week (no outside knowledge, every
question cites its source slide/page). Only course content is sent to the LLM —
never student data — keeping the FERPA story intact.

The LLM sits behind one function (`_llm_json`) so Gemini can be swapped for
Claude / a local model later without touching the rest.

Set your key in .env:   GEMINI_API_KEY=...        (https://aistudio.google.com/apikey)

Generate:
    python src/generate.py --week week1 --type mcq --n 5 --difficulty medium
    python src/generate.py --week week1 --type true_false --n 8 --topic "CSS selectors"
    python src/generate.py --week week1 --type mcq --n 5 --dry-run   # no API call
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from dotenv import dotenv_values
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).resolve().parent))   # so `from index import ...` works
from index import Retriever

REPO_ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = REPO_ROOT / ".env"
MODEL = "gemini-2.5-flash"
MAX_CONTEXT_CHUNKS = 120

# Difficulty == Bloom's taxonomy level (the pedagogically sound lever).
BLOOM = {
    "easy":   "Remember / Understand — recall facts, definitions, and basic comprehension.",
    "medium": "Apply / Analyze — use a concept in a new situation, compare, or distinguish ideas.",
    "hard":   "Evaluate / Create — judge, justify, predict, or synthesize across multiple points.",
}


# --------------------------------------------------------------------------- #
# Output schemas (one per question type) — also Gemini's response_schema
# --------------------------------------------------------------------------- #
class Source(BaseModel):
    source_file: str
    loc: int                       # page (PDF) or slide (PPTX) number


class MCQ(BaseModel):
    question: str
    options: list[str]             # exactly 4
    correct_index: int             # 0-based index into options
    explanation: str               # why the correct answer is right
    distractor_rationales: list[str]   # why each wrong option is wrong (aligned to options)
    supporting_quote: str          # exact sentence from the context
    source: Source


class TrueFalse(BaseModel):
    statement: str
    answer: bool
    explanation: str
    supporting_quote: str
    source: Source


# qtype -> (schema, human description used in the prompt)
QUESTION_TYPES = {
    "mcq": (MCQ, "multiple-choice questions, each with exactly 4 options and exactly one correct answer"),
    "true_false": (TrueFalse, "true/false questions"),
}


# --------------------------------------------------------------------------- #
# Context (retrieve the week's content)
# --------------------------------------------------------------------------- #
def build_context(retriever: Retriever, week: str, topic: str | None, k: int) -> tuple[str, int]:
    """Return (formatted_context, n_chunks). topic -> focused retrieval; else the whole week."""
    if topic:
        hits = retriever.retrieve(topic, week=week, k=k)
    else:
        hits = [m for m in retriever.meta if m["metadata"].get("week") == week][:MAX_CONTEXT_CHUNKS]
    if not hits:
        raise SystemExit(f"No chunks for week={week!r}. Build the index first (src/index.py build).")

    blocks = []
    for h in hits:
        m = h["metadata"]
        blocks.append(f"[{m['source_file']} · {m['loc_type']} {m['loc']}]\n{h['text']}")
    return "\n\n".join(blocks), len(hits)


def make_prompts(context: str, qtype: str, n: int, difficulty: str) -> tuple[str, str]:
    _, type_desc = QUESTION_TYPES[qtype]
    system = (
        "You are an expert assessment designer for a college computer-science course. "
        "You write questions STRICTLY from the provided lecture context — never use outside "
        "knowledge, and never write a question whose answer is not explicitly supported by the "
        "context. Every question must cite the source it came from and include the exact "
        "supporting sentence from the context."
    )
    user = (
        f"From the lecture context below, write EXACTLY {n} {type_desc}.\n"
        f"Difficulty (Bloom's level): {difficulty} — {BLOOM[difficulty]}\n\n"
        "Rules:\n"
        "- Use ONLY the context. If it can't support that many good questions, write fewer.\n"
        "- Spread questions across different parts of the material (don't cluster on one slide).\n"
        "- For MCQs: make the 3 distractors plausible but clearly wrong, and give a short "
        "rationale for EACH option (aligned to the options list).\n"
        "- Put the exact source sentence in `supporting_quote`, and the file + page/slide in `source`.\n\n"
        f"=== CONTEXT ===\n{context}\n=== END CONTEXT ==="
    )
    return system, user


# --------------------------------------------------------------------------- #
# LLM backend (swappable) — Gemini structured output
# --------------------------------------------------------------------------- #
def _llm_json(system: str, user: str, schema, model: str = MODEL) -> list:
    """Call the LLM and return a list of parsed pydantic objects. Gemini for now."""
    from google import genai
    from google.genai import types

    cfg = dotenv_values(ENV_PATH)
    key = (cfg.get("GEMINI_API_KEY") or cfg.get("GOOGLE_API_KEY") or "").strip()
    if not key:
        raise SystemExit("Set GEMINI_API_KEY in .env  (get one at https://aistudio.google.com/apikey)")

    client = genai.Client(api_key=key)
    resp = client.models.generate_content(
        model=model,
        contents=user,
        config=types.GenerateContentConfig(
            system_instruction=system,
            response_mime_type="application/json",
            response_schema=list[schema],
            temperature=0.4,
        ),
    )
    items = resp.parsed
    if items is None:                       # robustness fallback
        items = [schema(**d) for d in json.loads(resp.text)]
    return items


# --------------------------------------------------------------------------- #
# Generate
# --------------------------------------------------------------------------- #
def generate(week: str, qtype: str = "mcq", n: int = 5, difficulty: str = "medium",
             topic: str | None = None, k: int = 12, index_dir: Path | None = None,
             model: str = MODEL, dry_run: bool = False):
    schema, _ = QUESTION_TYPES[qtype]
    retriever = Retriever(index_dir) if index_dir else Retriever()
    context, n_chunks = build_context(retriever, week, topic, k)
    system, user = make_prompts(context, qtype, n, difficulty)

    if dry_run:
        print(f"[dry-run] week={week} type={qtype} n={n} difficulty={difficulty} "
              f"topic={topic or '(whole week)'} | {n_chunks} context chunks\n")
        print("--- SYSTEM ---\n" + system)
        print("\n--- USER (truncated) ---\n" + user[:1600] + "\n…")
        print(f"\n--- response_schema: list[{schema.__name__}] ---")
        return []

    return _llm_json(system, user, schema, model)[:n]


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def _print_questions(qs, qtype: str) -> None:
    for i, q in enumerate(qs, 1):
        if qtype == "mcq":
            print(f"\nQ{i}. {q.question}")
            for j, opt in enumerate(q.options):
                print(f"   {'✓' if j == q.correct_index else ' '} {chr(65+j)}. {opt}")
            print(f"   ↳ {q.explanation}")
        else:
            print(f"\nQ{i}. (T/F) {q.statement}")
            print(f"   ✓ {q.answer}  — {q.explanation}")
        print(f"   source: {q.source.source_file} · {q.source.loc}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Generate grounded questions from a week's content.")
    ap.add_argument("--week", required=True)
    ap.add_argument("--type", dest="qtype", choices=list(QUESTION_TYPES), default="mcq")
    ap.add_argument("--n", type=int, default=5, help="number of questions")
    ap.add_argument("--difficulty", choices=list(BLOOM), default="medium")
    ap.add_argument("--topic", default=None, help="focus on a topic (else the whole week)")
    ap.add_argument("-k", type=int, default=12, help="chunks to retrieve when --topic is set")
    ap.add_argument("--model", default=MODEL)
    ap.add_argument("--index-dir", type=Path, default=None)
    ap.add_argument("--out", type=Path, default=None, help="write the quiz JSON here")
    ap.add_argument("--dry-run", action="store_true", help="show the prompt; no API call")
    args = ap.parse_args()

    qs = generate(args.week, args.qtype, args.n, args.difficulty, args.topic,
                  args.k, args.index_dir, args.model, args.dry_run)
    if args.dry_run:
        return

    _print_questions(qs, args.qtype)
    out = args.out or REPO_ROOT / "data" / "quizzes" / f"{args.week}_{args.qtype}_{args.difficulty}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps([q.model_dump() for q in qs], indent=2, ensure_ascii=False))
    print(f"\n{len(qs)} {args.qtype} questions -> {out}")


if __name__ == "__main__":
    main()
