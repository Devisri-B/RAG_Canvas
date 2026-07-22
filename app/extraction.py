"""Extract text from weekly course materials (PDF, PPTX).

Upgraded to recover content:
  * PPTX GROUP shapes are recursed into (python-pptx does not descend into
    groups by default — grouped titles / text boxes were being lost), and table
    text is included. These use python-pptx only, so they are ALWAYS ON.
  * Optional OCR (controlled by OCR_ENABLED in app.config, defaulting to False)
    recovers text locked inside images via docling/pymupdf if installed.
"""

from __future__ import annotations

import logging
import re
import tempfile
from pathlib import Path

from app.config import OCR_ENABLED

logger = logging.getLogger(__name__)

MAX_TEXT_CHARS = 100_000
MIN_TEXT_CHARS = 200
MIN_OCR_IMG_BYTES = 15_000  # skip icons/bullets/logos when OCR-ing pictures

SUPPORTED_MATERIAL_SUFFIXES = (".pdf", ".pptx")


def is_supported_material(filename: str) -> bool:
    """Return True if the file type can be used for quiz generation."""
    lower = filename.lower()
    return lower.endswith(SUPPORTED_MATERIAL_SUFFIXES)


# --------------------------------------------------------------------------- #
# OCR (optional, lazy) — recover text locked inside images
# --------------------------------------------------------------------------- #
_ocr_conv = None


def _ocr_image(blob: bytes, ext: str) -> str:
    """OCR one image (bytes) -> cleaned text, or '' if nothing usable."""
    global _ocr_conv
    try:
        if _ocr_conv is None:
            from docling.document_converter import DocumentConverter

            _ocr_conv = DocumentConverter()
        with tempfile.NamedTemporaryFile(suffix=f".{ext}") as tmp:
            tmp.write(blob)
            tmp.flush()
            try:
                md = _ocr_conv.convert(tmp.name).document.export_to_markdown()
            except Exception:
                return ""
        md = md.replace("<!-- image -->", " ")
        md = re.sub(r"[#>*`|]+", " ", md)
        md = re.sub(r"[^\S\n]+", " ", md).strip()
        if len(re.findall(r"[A-Za-z][A-Za-z'-]{2,}", md)) < 4:  # too little real text
            return ""
        return md
    except ImportError:
        logger.warning("Docling is not installed; skipping OCR.")
        return ""
    except Exception as exc:
        logger.debug("OCR extraction failed (%s)", exc)
        return ""


def _iter_shapes(shapes):
    """Yield every shape, recursing into GROUPs (python-pptx skips these)."""
    try:
        from pptx.enum.shapes import MSO_SHAPE_TYPE

        for sh in shapes:
            if getattr(sh, "shape_type", None) == MSO_SHAPE_TYPE.GROUP:
                yield from _iter_shapes(sh.shapes)
            else:
                yield sh
    except Exception:
        for sh in shapes:
            yield sh


# --------------------------------------------------------------------------- #
# Per-file extraction
# --------------------------------------------------------------------------- #
def extract_pdf_text(path: Path, ocr: bool | None = None) -> str:
    use_ocr = OCR_ENABLED if ocr is None else ocr

    if not use_ocr:
        from pypdf import PdfReader

        reader = PdfReader(str(path))
        parts: list[str] = []
        for page in reader.pages:
            text = page.extract_text()
            if text and text.strip():
                parts.append(text.strip())
        return "\n\n".join(parts)

    try:
        import fitz  # PyMuPDF

        parts: list[str] = []
        with fitz.open(str(path)) as doc:
            for page in doc:
                text = page.get_text("text").strip()
                if len(text) < 40 and page.get_images():
                    t = _ocr_image(page.get_pixmap(dpi=200).tobytes("png"), "png")
                    if t:
                        text = (text + "\n" + t).strip()
                if text:
                    parts.append(text)
        return "\n\n".join(parts)
    except ImportError:
        # Fallback to standard pypdf if fitz is not installed
        from pypdf import PdfReader

        reader = PdfReader(str(path))
        parts = []
        for page in reader.pages:
            text = page.extract_text()
            if text and text.strip():
                parts.append(text.strip())
        return "\n\n".join(parts)


def extract_pptx_text(path: Path, ocr: bool | None = None) -> str:
    use_ocr = OCR_ENABLED if ocr is None else ocr

    from pptx import Presentation
    from pptx.enum.shapes import MSO_SHAPE_TYPE

    prs = Presentation(str(path))
    parts: list[str] = []
    for slide_num, slide in enumerate(prs.slides, start=1):
        slide_parts: list[str] = []
        for shape in _iter_shapes(slide.shapes):  # recurse into GROUPs
            if shape.has_text_frame:
                for paragraph in shape.text_frame.paragraphs:
                    line = paragraph.text.strip()
                    if line:
                        slide_parts.append(line)
            elif getattr(shape, "has_table", False):  # tables (were skipped)
                for row in shape.table.rows:
                    slide_parts.append(" | ".join(c.text for c in row.cells))
            elif use_ocr and getattr(shape, "shape_type", None) == MSO_SHAPE_TYPE.PICTURE:  # image text
                img = shape.image
                if len(img.blob) >= MIN_OCR_IMG_BYTES:
                    text = _ocr_image(img.blob, img.ext)
                    if text:
                        slide_parts.append(text)
        if slide_parts:
            parts.append(f"Slide {slide_num}:\n" + "\n".join(slide_parts))
    return "\n\n".join(parts)


def extract_file_text(path: Path, ocr: bool | None = None) -> str:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return extract_pdf_text(path, ocr=ocr)
    if suffix == ".pptx":
        return extract_pptx_text(path, ocr=ocr)
    raise ValueError(f"Unsupported file type: {path.suffix} ({path.name})")
