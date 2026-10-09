from __future__ import annotations

import json
from typing import Any

from app.database.connection import execute_query, execute_write, execute_returning


def find_plan_by_agent_run(agent_run_id: str) -> dict[str, Any] | None:
    rows = execute_query(
        """
        SELECT id, student_id, generated_by_agent_run_id, goal, plan_data,
               status, version, created_at, updated_at
        FROM performance.learning_plans
        WHERE generated_by_agent_run_id = %s
        """,
        [agent_run_id],
    )
    return rows[0] if rows else None


def create_learning_plan(
    student_id: str,
    agent_run_id: str,
    goal: str,
    plan_data_json_str: str,
    source_attempt_id: str | None = None,
) -> dict[str, Any]:
    # The newest plan is the student's active one; earlier plans stay as history
    execute_write(
        """
        UPDATE performance.learning_plans SET status = 'SUPERSEDED', updated_at = now()
        WHERE student_id = %s AND status = 'ACTIVE'
        """,
        [student_id],
    )
    rows = execute_returning(
        """
        INSERT INTO performance.learning_plans
          (student_id, generated_by_agent_run_id, goal, plan_data, status, version, source_attempt_id)
        VALUES (%s, %s, %s, %s::jsonb, 'ACTIVE',
                COALESCE((SELECT MAX(version) FROM performance.learning_plans WHERE student_id = %s), 0) + 1,
                %s)
        RETURNING *
        """,
        [student_id, agent_run_id, goal, plan_data_json_str, student_id, source_attempt_id],
    )
    return rows[0]


def create_recommendation(
    student_id: str,
    plan_id: str,
    skill_id: str,
    title: str,
) -> None:
    execute_write(
        """
        INSERT INTO performance.learning_recommendations
          (student_id, learning_plan_id, skill_id, recommendation_type,
           title, description, priority, status)
        VALUES (%s, %s, %s, 'SKILL_GAP', %s,
                'Focus on this skill based on performance gap', 1, 'ACTIVE')
        """,
        [student_id, plan_id, skill_id, title],
    )
