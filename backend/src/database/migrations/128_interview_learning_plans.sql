-- Post-interview 4-week learning plans built from the interview itself.
--
-- 1. assessment_reports.report_data keeps the full diagnostic report of a live mock
--    interview (every question with its score, missed key points, evaluator notes and
--    delivery metrics). The learning-plan agent reads it as evidence; until now only
--    the headline scores were stored, so plans could not say what actually went wrong.
-- 2. learning_plans.source_attempt_id ties a plan to the interview it was built from;
--    learning_plans.progress records which plan tasks the student has ticked off
--    ({ "<taskId>": "<completed ISO time>" }).
-- 3. The specialist agent definition: databases created from the earlier schema
--    version never received it (their tracker already lists a different 035), so
--    every agent run there failed with SPECIALIST_DEF_NOT_FOUND.

ALTER TABLE performance.assessment_reports ADD COLUMN IF NOT EXISTS report_data JSONB;

ALTER TABLE performance.learning_plans ADD COLUMN IF NOT EXISTS source_attempt_id UUID;
ALTER TABLE performance.learning_plans ADD COLUMN IF NOT EXISTS progress JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_learning_plans_student_created
  ON performance.learning_plans (student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assessment_reports_student_created
  ON performance.assessment_reports (student_id, created_at DESC);

INSERT INTO agent.agent_definitions
  (name, version, goal, tools, guardrails, prohibited_actions, termination_conditions,
   max_steps, max_tool_calls, max_retries, timeout_seconds)
SELECT
  'learning_specialist_agent',
  1,
  'Analyze student performance in detail, identify skill gaps, retrieve learning resources, and draft a personalized learning plan.',
  '["GetStudentPerformance","GetSkillGapAnalysis","RetrieveLearningKnowledge","SearchWebResources","DraftLearningPlan"]',
  '{"max_consecutive_tool_calls":4,"require_output_validation":true,"student_scope_enforced":true}',
  '["ModifyScores","ModifyCredits","GrantPermissions","AccessOtherStudentData","ExecuteArbitrarySQL"]',
  '["DraftPlanCompleted","MaxStepsReached","ToolFailure","Timeout","ScopeViolation"]',
  12,
  8,
  3,
  150
WHERE NOT EXISTS (
  SELECT 1 FROM agent.agent_definitions WHERE name = 'learning_specialist_agent'
);
