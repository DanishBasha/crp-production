"""Plain-text extraction from an uploaded resume (PDF, DOCX or text file)."""
from __future__ import annotations

import html
import io
import re
import zipfile

MAX_RESUME_CHARS = 12_000


class ResumeReadError(ValueError):
    """The file could not be read as a resume."""


def _pdf_text(data: bytes) -> str:
    from pypdf import PdfReader  # imported lazily: only resume uploads need it

    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            reader.decrypt("")
        return "\n".join((page.extract_text() or "") for page in reader.pages)
    except Exception as exc:  # malformed or password-protected PDF
        raise ResumeReadError("The PDF could not be opened.") from exc


def _docx_text(data: bytes) -> str:
    # A .docx file is a zip; the body text sits in <w:t> runs inside <w:p> paragraphs.
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            xml = archive.read("word/document.xml").decode("utf-8", errors="replace")
    except (zipfile.BadZipFile, KeyError) as exc:
        raise ResumeReadError("The Word document could not be opened.") from exc
    paragraphs = []
    for paragraph in re.findall(r"<w:p[ >].*?</w:p>", xml, flags=re.S):
        runs = re.findall(r"<w:t(?: [^>]*)?>(.*?)</w:t>", paragraph, flags=re.S)
        paragraphs.append(html.unescape("".join(runs)))
    return "\n".join(paragraphs)


def clean_text(text: str) -> str:
    lines = [re.sub(r"[ \t ]+", " ", line).strip() for line in text.splitlines()]
    cleaned = "\n".join(line for line in lines if line)
    return cleaned[:MAX_RESUME_CHARS]


def extract_resume_text(file_name: str, data: bytes) -> str:
    name = (file_name or "").lower()
    if name.endswith(".pdf") or data[:5] == b"%PDF-":
        text = _pdf_text(data)
    elif name.endswith(".docx") or data[:2] == b"PK":
        text = _docx_text(data)
    elif name.endswith((".txt", ".md")) or not name:
        text = data.decode("utf-8", errors="replace")
    else:
        raise ResumeReadError("Upload a PDF, DOCX or TXT file, or paste the resume text.")
    return clean_text(text)
