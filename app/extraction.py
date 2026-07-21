"""Extract text from weekly course materials (PDF, PPTX)."""

from __future__ import annotations

from pathlib import Path

SUPPORTED_MATERIAL_SUFFIXES = (".pdf", ".pptx")


def is_supported_material(filename: str) -> bool:
    """Return True if the file type can be used for quiz generation."""
    lower = filename.lower()
    return lower.endswith(SUPPORTED_MATERIAL_SUFFIXES)


def extract_pdf_text(path: Path) -> str:
    from pypdf import PdfReader

    reader = PdfReader(str(path))
    parts: list[str] = []
    for page in reader.pages:
        text = page.extract_text()
        if text and text.strip():
            parts.append(text.strip())
    return "\n\n".join(parts)


def extract_pptx_text(path: Path) -> str:
    from pptx import Presentation

    prs = Presentation(str(path))
    parts: list[str] = []
    for slide_num, slide in enumerate(prs.slides, start=1):
        slide_parts: list[str] = []
        for shape in slide.shapes:
            if not shape.has_text_frame:
                continue
            for paragraph in shape.text_frame.paragraphs:
                line = paragraph.text.strip()
                if line:
                    slide_parts.append(line)
        if slide_parts:
            parts.append(f"Slide {slide_num}:\n" + "\n".join(slide_parts))
    return "\n\n".join(parts)


def extract_file_text(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return extract_pdf_text(path)
    if suffix == ".pptx":
        return extract_pptx_text(path)
    raise ValueError(f"Unsupported file type: {path.suffix} ({path.name})")

