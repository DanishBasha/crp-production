"""Resume reading (PDF / DOCX / text), fact-only extraction, and resume-grounded questions."""
from __future__ import annotations

import base64
import io
import zipfile
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.main import app
from app.services.resume_text import ResumeReadError, extract_resume_text

client = TestClient(app)

RESUME_TEXT = (
    "Priya Sharma - B.Tech Computer Science, 2026\n"
    "Skills: Python, Java, Django, React, PostgreSQL, Git\n"
    "Projects\n"
    "Campus Canteen Ordering App - Django, PostgreSQL: online ordering with live queue status.\n"
    "Internship: Backend intern at Acme Labs, built REST APIs in Django.\n"
)


def make_pdf(lines: list[str]) -> bytes:
    """A minimal valid PDF with one page of Helvetica text."""
    content = "BT /F1 11 Tf 72 740 Td 14 TL " + " ".join(
        "(" + line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)") + ") '" for line in lines
    ) + " ET"
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        "/Resources << /Font << /F1 5 0 R >> >> >>",
        f"<< /Length {len(content)} >>\nstream\n{content}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(out.tell())
        out.write(f"{number} 0 obj\n{body}\nendobj\n".encode("latin-1"))
    xref = out.tell()
    out.write(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    for offset in offsets:
        out.write(f"{offset:010d} 00000 n \n".encode())
    out.write(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return out.getvalue()


def make_docx(paragraphs: list[str]) -> bytes:
    body = "".join(f"<w:p><w:r><w:t>{p.replace('&', '&amp;')}</w:t></w:r></w:p>" for p in paragraphs)
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body>{body}</w:body></w:document>"
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("word/document.xml", xml)
    return buffer.getvalue()


def fake_llm(payload: dict) -> MagicMock:
    llm = MagicMock()
    llm.parse_resume.return_value = payload
    llm.generate_question.return_value = {
        "question_text": "How did you design the order queue?", "difficulty": "MEDIUM",
        "category": "Projects", "key_points": ["queue", "status updates"],
    }
    return llm


# ── Text extraction ───────────────────────────────────────────────────────────

def test_pdf_text_is_extracted():
    text = extract_resume_text("resume.pdf", make_pdf(["Skills: Django & PostgreSQL", "Built a canteen app"]))
    assert "Django" in text and "canteen" in text


def test_docx_text_is_extracted():
    text = extract_resume_text("resume.docx", make_docx(["Priya Sharma", "R&D intern, Django"]))
    assert text.splitlines() == ["Priya Sharma", "R&D intern, Django"]


def test_unsupported_file_is_rejected():
    try:
        extract_resume_text("resume.png", b"\x89PNG....")
    except ResumeReadError:
        return
    raise AssertionError("an image must not be accepted as a resume")


# ── /ai/parse-resume ──────────────────────────────────────────────────────────

def test_parse_keeps_only_facts_written_in_the_resume():
    invented = {
        "summary": "Computer science student focused on backend web development.",
        "skills": {"languages": ["Python", "Java", "Rust"], "frameworks": ["Django", "Kafka"],
                   "databases": ["PostgreSQL"], "tools": ["Git", "Kubernetes"]},
        "projects": [
            {"title": "Campus Canteen Ordering App", "tech_stack": ["Django", "PostgreSQL", "Redis"],
             "description": "Online ordering with live queue status."},
            {"title": "High-Throughput Distributed Microservice", "tech_stack": ["Kafka"], "description": "x"},
        ],
    }
    with patch("app.routers.interview.get_llm_client", return_value=fake_llm(invented)):
        res = client.post("/ai/parse-resume", json={"text": RESUME_TEXT})
    assert res.status_code == 200
    body = res.json()
    assert body["skills"]["languages"] == ["Python", "Java"]          # Rust is not on the resume
    assert body["skills"]["frameworks"] == ["Django"]                 # Kafka is not on the resume
    assert body["skills"]["tools"] == ["Git"]
    assert [p["title"] for p in body["projects"]] == ["Campus Canteen Ordering App"]
    assert body["projects"][0]["tech_stack"] == ["Django", "PostgreSQL"]
    assert body["text"].startswith("Priya Sharma")


def test_parse_pdf_upload():
    pdf = base64.b64encode(make_pdf(RESUME_TEXT.splitlines())).decode()
    payload = {"summary": "", "skills": {"frameworks": ["Django"]}, "projects": []}
    with patch("app.routers.interview.get_llm_client", return_value=fake_llm(payload)):
        res = client.post("/ai/parse-resume", json={"file_name": "cv.pdf", "content_base64": pdf})
    assert res.status_code == 200
    assert res.json()["skills"]["frameworks"] == ["Django"]
    assert "Campus Canteen Ordering App" in res.json()["text"]


def test_parse_without_readable_text_is_422():
    res = client.post("/ai/parse-resume", json={"text": "   "})
    assert res.status_code == 422


def test_parse_falls_back_to_text_when_llm_fails():
    llm = MagicMock()
    llm.parse_resume.side_effect = RuntimeError("rate limited")
    with patch("app.routers.interview.get_llm_client", return_value=llm):
        res = client.post("/ai/parse-resume", json={"text": RESUME_TEXT})
    assert res.status_code == 200
    assert res.json()["projects"] == [] and res.json()["text"].startswith("Priya")


FULL_RESUME = RESUME_TEXT + (
    "Education\nB.Tech Computer Science, VIT Vellore, 2022-2026\n"
    "Certifications\nAWS Certified Cloud Practitioner\n"
    "github.com/priyasharma  linkedin.com/in/priya-sharma\n"
)


def test_parse_keeps_real_experience_education_certifications_and_links():
    payload = {
        "experience": [
            {"title": "Backend Intern", "company": "Acme Labs", "duration": "2025", "description": "Built REST APIs."},
            {"title": "SDE Intern", "company": "Google", "duration": "2024", "description": "invented"},
        ],
        "education": [
            {"degree": "B.Tech Computer Science", "institution": "VIT Vellore", "year": "2022-2026"},
            {"degree": "MBA", "institution": "Harvard Business School", "year": "2020"},
        ],
        "certifications": ["AWS Certified Cloud Practitioner", "Oracle Certified Java Professional"],
        "links": {
            "github": "https://github.com/priyasharma",
            "linkedin": "linkedin.com/in/priya-sharma",
            "portfolio": "javascript:alert(1)",
        },
    }
    with patch("app.routers.interview.get_llm_client", return_value=fake_llm(payload)):
        res = client.post("/ai/parse-resume", json={"text": FULL_RESUME})
    body = res.json()
    assert [e["company"] for e in body["experience"]] == ["Acme Labs"]           # Google is not on the resume
    assert [e["institution"] for e in body["education"]] == ["VIT Vellore"]       # Harvard is not on the resume
    assert body["certifications"] == ["AWS Certified Cloud Practitioner"]
    assert body["links"] == {
        "github": "https://github.com/priyasharma",
        "linkedin": "https://linkedin.com/in/priya-sharma",
        "portfolio": None,                                                       # not a real link
    }


# ── Resume-grounded question generation ───────────────────────────────────────

def _question_request(focus: str) -> dict:
    return {
        "student_name": "Priya",
        "skills": ["Python", "Django"],
        "projects": [{"title": "Campus Canteen Ordering App", "tech_stack": ["Django"],
                      "description": "Online ordering with live queue status."}],
        "resume_text": RESUME_TEXT,
        "difficulty": "MEDIUM",
        "focus": focus,
        "resume_topic": 'Project "Campus Canteen Ordering App" (Django, PostgreSQL): online ordering',
        "previous_turns": [{"question_text": "Tell me about yourself.", "difficulty": "EASY",
                            "student_answer": "I am a CS student and I like backend work.",
                            "technical_score": 55}],
    }


def test_resume_focus_puts_the_resume_item_in_the_prompt():
    llm = fake_llm({})
    with patch("app.routers.interview.get_llm_client", return_value=llm):
        res = client.post("/ai/generate-question", json=_question_request("resume_topic"))
    assert res.status_code == 200
    prompt = llm.generate_question.call_args[0][0]
    assert "<resume_item>" in prompt and "Campus Canteen Ordering App" in prompt
    assert "Backend intern at Acme Labs" in prompt          # resume text excerpt is included
    assert "MOST RECENT answer" not in prompt


def test_follow_up_focus_uses_the_latest_answer_and_still_sees_the_resume():
    llm = fake_llm({})
    with patch("app.routers.interview.get_llm_client", return_value=llm):
        res = client.post("/ai/generate-question", json=_question_request("follow_up"))
    assert res.status_code == 200
    prompt = llm.generate_question.call_args[0][0]
    assert "MOST RECENT answer" in prompt
    assert "<resume_item>" not in prompt
    assert "Online ordering with live queue status" in prompt   # project description reaches the prompt
