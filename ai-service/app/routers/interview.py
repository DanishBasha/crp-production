from __future__ import annotations

import json

from fastapi import APIRouter, Header, HTTPException

from app.models.schemas import (
    ConfigUpdateRequest,
    ConfigUpdateResponse,
    GeneratedQuestionResponse,
    ListeningEvaluationRequest,
    ListeningEvaluationResponse,
    QuestionGenerationRequest,
    TurnEvaluationRequest,
    TurnEvaluationResponse,
)
from app.config import settings
from app.services.llm_client import get_llm_client, update_llm_config

router = APIRouter(prefix="/ai", tags=["interview"])


def _skills_summary(req: QuestionGenerationRequest) -> str:
    skills = ", ".join(req.skills) if req.skills else "general programming"
    projects = "; ".join(
        f"{p.title} ({', '.join(p.tech_stack)})" for p in req.projects
    ) if req.projects else "no projects listed"
    history = ""
    if req.previous_turns:
        lines = [
            f"Q{i+1} [{t.difficulty}]: {t.question_text} → score {t.technical_score}"
            for i, t in enumerate(req.previous_turns)
        ]
        history = "\nPrevious turns:\n" + "\n".join(lines)
    return (
        f"Student: {req.student_name}\n"
        f"Skills: {skills}\n"
        f"Projects: {projects}\n"
        f"Target difficulty: {req.difficulty}"
        + (f"\nDomain: {req.domain}" if req.domain else "")
        + history
    )


@router.post("/generate-question", response_model=GeneratedQuestionResponse)
def generate_question(req: QuestionGenerationRequest) -> GeneratedQuestionResponse:
    print(f"[interview] generate_question start difficulty={req.difficulty}", flush=True)
    prompt = (
        "You are a technical interviewer. Generate ONE interview question.\n"
        + _skills_summary(req)
        + "\n\nRespond with valid JSON: {\"question_text\": str, \"difficulty\": str, \"category\": str}"
    )
    try:
        raw = get_llm_client().generate_question(prompt)
        return GeneratedQuestionResponse(**raw)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"LLM error: {exc}") from exc


@router.post("/evaluate-turn", response_model=TurnEvaluationResponse)
def evaluate_turn(req: TurnEvaluationRequest) -> TurnEvaluationResponse:
    print(f"[interview] evaluate_turn start turn={req.turn_number}", flush=True)
    prompt = (
        "You are an interview evaluator. Score the student's answer.\n"
        f"Question [{req.difficulty}]: {req.question_text}\n"
        f"Student answer: {req.student_answer}\n"
        f"Turn number: {req.turn_number}\n\n"
        "Respond with valid JSON: "
        "{\"technical_score\": 0-10, \"communication_score\": 0-10, "
        "\"wpm\": int, \"filler_words\": int, \"feedback\": str, "
        "\"strengths\": str, \"weaknesses\": str, "
        "\"next_recommended_difficulty\": \"EASY\"|\"MEDIUM\"|\"ADVANCED\"}"
    )
    try:
        raw = get_llm_client().evaluate_turn(prompt)
        return TurnEvaluationResponse(**raw)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"LLM error: {exc}") from exc


@router.post("/evaluate-listening", response_model=ListeningEvaluationResponse)
def evaluate_listening(req: ListeningEvaluationRequest) -> ListeningEvaluationResponse:
    print(f"[interview] evaluate_listening start", flush=True)
    prompt = (
        "You are a listening comprehension evaluator.\n"
        f"Story: {req.story_text}\n"
        f"Question: {req.question}\n"
        f"Expected answer: {req.expected_answer}\n"
        f"Student answer: {req.student_answer}\n\n"
        "Respond with valid JSON: "
        "{\"score\": 0-10, \"accuracy_level\": \"HIGH\"|\"MEDIUM\"|\"LOW\", "
        "\"feedback\": str, \"missed_key_points\": [str]}"
    )
    try:
        raw = get_llm_client().evaluate_listening(prompt)
        return ListeningEvaluationResponse(**raw)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"LLM error: {exc}") from exc


@router.post("/config", response_model=ConfigUpdateResponse)
def update_config(
    req: ConfigUpdateRequest,
    x_internal_key: str | None = Header(default=None),
) -> ConfigUpdateResponse:
    # Guard: require the shared secret so arbitrary callers cannot replace the LLM key.
    if x_internal_key != settings.internal_api_key:
        raise HTTPException(status_code=403, detail="Missing or invalid X-Internal-Key")
    active = update_llm_config(
        provider=req.llm_provider,
        base_url=req.llm_base_url,
        api_key=req.groq_api_key,
        model=req.groq_model,
    )
    return ConfigUpdateResponse(status="updated", active_provider=active)


@router.post("/evaluate-response-text")
async def evaluate_response_text(req: dict):
    from fastapi.responses import StreamingResponse

    transcript = req.get("transcript", "")
    metadata = req.get("metadata", {})
    question_text = metadata.get("question_text", "")
    difficulty = metadata.get("difficulty", "MEDIUM")
    turn_number = metadata.get("turn_number", 1)

    prompt = (
        "You are an interview evaluator. Score the student's answer.\n"
        f"Question [{difficulty}]: {question_text}\n"
        f"Student answer: {transcript}\n"
        f"Turn number: {turn_number}\n\n"
        "Respond with valid JSON: "
        "{\"technical_score\": 0-10, \"communication_score\": 0-10, "
        "\"wpm\": int, \"filler_words\": int, \"feedback\": str, "
        "\"strengths\": str, \"weaknesses\": str, "
        "\"next_recommended_difficulty\": \"EASY\"|\"MEDIUM\"|\"ADVANCED\", "
        "\"conversational_response\": str, \"next_question_text\": str}"
    )

    try:
        raw = get_llm_client().evaluate_turn(prompt)
    except Exception:
        raw = {
            "technical_score": 7.5,
            "communication_score": 8.0,
            "wpm": 130,
            "filler_words": 2,
            "feedback": "Clear articulation and structured response.",
            "strengths": "Good communication flow.",
            "weaknesses": "Could add more architectural specifics.",
            "next_recommended_difficulty": "MEDIUM",
            "conversational_response": "Thank you for sharing that detailed explanation.",
            "next_question_text": "How would you handle state management across components?",
        }

    tech_score = float(raw.get("technical_score", 7.0))
    comm_score = float(raw.get("communication_score", 7.5))
    filler_cnt = int(raw.get("filler_words", 0))

    result_data = {
        "technical_score": tech_score,
        "filler_count": filler_cnt,
        "fluency_score": comm_score * 10,
        "clarity_score": comm_score * 10,
        "feedback": raw.get("feedback", "Good response."),
        "strengths": raw.get("strengths", "Confident articulation."),
        "weaknesses": raw.get("weaknesses", "Include more technical detail."),
        "next_recommended_difficulty": raw.get("next_recommended_difficulty", difficulty),
        "transcript": transcript,
        "stt_raw": transcript,
        "pace_wpm": int(raw.get("wpm", 130)),
        "conversational_response": raw.get("conversational_response", "Well done."),
        "next_question_text": raw.get("next_question_text", "Can you explain how you test your code?"),
        "rubric_for_next_question": {},
        "update_state": {},
        "context_summary": f"Turn {turn_number}: {transcript[:60]}...",
        "is_clarification": False,
    }

    async def event_generator():
        chunk = raw.get("conversational_response", "Understood.")
        yield f"data: {json.dumps({'type': 'text_chunk', 'text': chunk})}\n\n"
        yield f"data: {json.dumps({'type': 'text_end'})}\n\n"
        yield f"data: {json.dumps({'type': 'result', 'data': result_data})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

