from __future__ import annotations

from typing import Any

from app.repositories import interview_repository
from app.tools.base import ToolContext, ToolDefinition, ToolResult


class GetInterviewEvidenceTool(ToolDefinition):
    name = "GetInterviewEvidence"
    description = (
        "Retrieve the student's latest mock-interview report: every question with its "
        "score, the key points covered and missed, evaluator notes and delivery metrics "
        "(pace, filler words, pauses, response latency), plus their resume and history."
    )
    input_schema = {
        "type": "object",
        "properties": {
            "studentId": {"type": "string", "description": "UUID of the student"},
        },
        "required": ["studentId"],
    }
    read_only = True
    requires_student_scope = True

    def execute(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        student_id = args.get("studentId", "")
        if student_id != ctx.student_id:
            return ToolResult(
                success=False,
                error_code="SCOPE_VIOLATION",
                error_message="Cannot access another student's data",
            )
        try:
            latest = interview_repository.get_latest_interview(student_id)
            if latest is None or not isinstance(latest.get("report_data"), dict):
                return ToolResult(
                    success=False,
                    error_code="NOT_FOUND",
                    error_message="No completed interview with a stored report",
                )
            history = interview_repository.get_interview_history(student_id)
            resume = interview_repository.get_current_resume(student_id)
            student = interview_repository.get_student_context(student_id)
        except Exception as e:
            return ToolResult(success=False, error_code="DB_ERROR", error_message=str(e))

        data = {
            "attemptId": latest.get("attempt_id"),
            "completedAt": latest.get("created_at"),
            "report": latest["report_data"],
            "history": history,
            "resume": resume if isinstance(resume, dict) else None,
            "student": {"name": student.get("name"), "program": student.get("program_name")},
        }
        report = latest["report_data"]
        summary = (
            f"ok. interview overall={report.get('overallScore')} "
            f"tech={report.get('technicalScore')} comm={report.get('communicationScore')} "
            f"turns={len(report.get('turns') or [])} resume={'yes' if data['resume'] else 'no'}"
        )
        return ToolResult(success=True, data=data, context_summary=summary)
