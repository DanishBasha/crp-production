"""Read-only access to what a student's mock interviews left behind.

The backend stores the full diagnostic report of every live interview in
performance.assessment_reports.report_data; the learning-plan agent uses it as
evidence (questions, scores, missed key points, delivery metrics).
"""
from __future__ import annotations

from typing import Any

from app.database.connection import execute_query


def get_latest_interview(student_id: str) -> dict[str, Any] | None:
    """The most recent completed interview that has a stored report."""
    rows = execute_query(
        """
        SELECT ar.attempt_id, ar.report_data, ar.overall_score, ar.technical_score,
               ar.communication_score, ar.created_at
        FROM performance.assessment_reports ar
        WHERE ar.student_id = %s AND ar.report_data IS NOT NULL
        ORDER BY ar.created_at DESC
        LIMIT 1
        """,
        [student_id],
    )
    return rows[0] if rows else None


def get_interview_history(student_id: str, limit: int = 5) -> list[dict[str, Any]]:
    """Headline scores of the latest interviews, newest first (for the trend line)."""
    return execute_query(
        """
        SELECT ar.attempt_id, ar.overall_score, ar.technical_score,
               ar.communication_score, ar.created_at
        FROM performance.assessment_reports ar
        WHERE ar.student_id = %s AND ar.report_data IS NOT NULL
        ORDER BY ar.created_at DESC
        LIMIT %s
        """,
        [student_id, limit],
    )


def get_current_resume(student_id: str) -> dict[str, Any] | None:
    rows = execute_query(
        """
        SELECT parsed_data
        FROM org.resumes
        WHERE student_id = %s AND is_current = true
        ORDER BY updated_at DESC
        LIMIT 1
        """,
        [student_id],
    )
    return (rows[0].get("parsed_data") or None) if rows else None


def get_student_context(student_id: str) -> dict[str, Any]:
    rows = execute_query(
        """
        SELECT u.name, p.name AS program_name
        FROM org.students s
        JOIN identity.users u ON u.id = s.user_id
        LEFT JOIN org.programs p ON p.id = s.program_id
        WHERE s.id = %s
        """,
        [student_id],
    )
    return rows[0] if rows else {}
