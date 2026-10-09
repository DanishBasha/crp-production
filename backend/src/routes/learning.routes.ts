import { Router, Response } from 'express';
import axios from 'axios';
import { z } from 'zod';
import { db } from '../shared/db/pool';
import { AppError } from '../shared/errors/AppError';
import { sendSuccess, sendError } from '../shared/helpers/response';
import { AuthRequest } from '../middleware/authenticate';
import { requireRole } from '../middleware/authorize';
import { env } from '../config/env';

export const learningRouter = Router();

// ── Scope guard ───────────────────────────────────────────────────────────────

async function assertStudentScope(req: AuthRequest, studentId: string): Promise<void> {
  const user = req.user!;
  const staffRoles = ['PROGRAM_ADMIN', 'TRAINER', 'PLACEMENT_COORDINATOR'];
  if (staffRoles.includes(user.role)) return;
  if (user.role === 'STUDENT') {
    const { rows } = await db.query(
      'SELECT id FROM org.students WHERE id = $1 AND user_id = $2',
      [studentId, user.id]
    );
    if (rows.length === 0) throw new AppError(403, 'Access denied', 'FORBIDDEN');
    return;
  }
  if (user.role === 'FACULTY_MENTOR') {
    const { rows } = await db.query(
      `SELECT id FROM org.student_mentor_assignments
       WHERE student_id = $1 AND mentor_user_id = $2 AND is_active = true`,
      [studentId, user.id]
    );
    if (rows.length === 0) throw new AppError(403, 'Not assigned to this student', 'FORBIDDEN');
    return;
  }
  throw new AppError(403, 'Access denied', 'FORBIDDEN');
}

// ─────────────────────────────────────────────────────────────────────────────
// KNOWLEDGE DOCUMENTS
// ─────────────────────────────────────────────────────────────────────────────

learningRouter.get('/knowledge', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const visibilityType = req.query.visibility_type as string | undefined;
    const params: unknown[] = [];
    let sql = `SELECT id, title, source_type, source_url, visibility_type,
                      institution_id, program_id, subdivision_id, metadata,
                      created_at, updated_at
               FROM knowledge.knowledge_documents`;
    const conditions: string[] = [];
    if (visibilityType) {
      params.push(visibilityType.toUpperCase());
      conditions.push(`visibility_type = $${params.length}`);
    }
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY created_at DESC';
    const { rows } = await db.query(sql, params);
    sendSuccess(res, { documents: rows });
  } catch (err) {
    sendError(res, err);
  }
});

learningRouter.get('/knowledge/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { rows: docRows } = await db.query(
      `SELECT id, title, source_type, source_url, visibility_type,
              institution_id, program_id, subdivision_id, metadata, created_at, updated_at
       FROM knowledge.knowledge_documents WHERE id = $1`,
      [req.params.id]
    );
    if (docRows.length === 0) throw new AppError(404, 'Document not found', 'NOT_FOUND');

    const { rows: chunkRows } = await db.query(
      `SELECT id, chunk_index, chunk_text, source_metadata
       FROM knowledge.knowledge_chunks WHERE document_id = $1 ORDER BY chunk_index`,
      [req.params.id]
    );
    sendSuccess(res, { document: docRows[0], chunks: chunkRows });
  } catch (err) {
    sendError(res, err);
  }
});

const createDocSchema = z.object({
  title:           z.string().min(1).max(500),
  source_type:     z.string().default('MANUAL'),
  source_url:      z.string().optional(),
  visibility_type: z.string().default('PUBLIC'),
  institution_id:  z.string().uuid().optional(),
  program_id:      z.string().uuid().optional(),
  subdivision_id:  z.string().uuid().optional(),
  metadata:        z.record(z.unknown()).optional(),
  chunks:          z.array(z.object({
    chunk_index:     z.number().int().min(0),
    chunk_text:      z.string().min(1),
    source_metadata: z.record(z.unknown()).optional(),
  })).optional(),
});

learningRouter.post(
  '/knowledge',
  requireRole('PROGRAM_ADMIN', 'TRAINER'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const parsed = createDocSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError(422, 'Validation failed', 'VALIDATION_ERROR');
      const {
        title, source_type, source_url, visibility_type, institution_id,
        program_id, subdivision_id, metadata, chunks,
      } = parsed.data;

      const client = await db.connect();
      try {
        await client.query('BEGIN');
        const { rows: docRows } = await client.query(
          `INSERT INTO knowledge.knowledge_documents
             (title, source_type, source_url, visibility_type, institution_id,
              program_id, subdivision_id, metadata)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [
            title, source_type, source_url ?? null, visibility_type,
            institution_id ?? null, program_id ?? null, subdivision_id ?? null,
            JSON.stringify(metadata ?? {}),
          ]
        );
        const docId = docRows[0].id;
        const insertedChunks = [];
        for (const chunk of chunks ?? []) {
          const { rows: cr } = await client.query(
            `INSERT INTO knowledge.knowledge_chunks
               (document_id, chunk_index, chunk_text, source_metadata)
             VALUES ($1,$2,$3,$4) RETURNING id, chunk_index, chunk_text`,
            [docId, chunk.chunk_index, chunk.chunk_text,
             JSON.stringify(chunk.source_metadata ?? {})]
          );
          insertedChunks.push(cr[0]);
        }
        await client.query('COMMIT');
        sendSuccess(res, { document: docRows[0], chunks: insertedChunks }, 201);
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// LEARNING PLANS
// ─────────────────────────────────────────────────────────────────────────────

learningRouter.get('/plans/:studentId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const studentId = req.params.studentId as string;
    await assertStudentScope(req, studentId);
    const { rows } = await db.query(
      `SELECT id, student_id, generated_by_agent_run_id, goal, plan_data,
              status, version, created_at, updated_at
       FROM performance.learning_plans WHERE student_id = $1 ORDER BY created_at DESC`,
      [studentId]
    );
    sendSuccess(res, { plans: rows });
  } catch (err) {
    sendError(res, err);
  }
});

// ── The student's current 4-week roadmap, built by the agent after each mock interview ──

// A run older than this that never finished is treated as dead, not "building"
const PLAN_RUN_STALE_MS = 10 * 60 * 1000;
// Right after an interview the agent run may not exist yet (it is started by an event)
const PLAN_TRIGGER_GRACE_MS = 2 * 60 * 1000;
const MAX_PLAN_REBUILDS_PER_HOUR = 5;

interface PlanRow {
  id: string; plan_data: Record<string, unknown> | null;
  source_attempt_id: string | null; version: number | null; created_at: Date;
}
interface RunRow { id: string; status: string; termination_reason: string | null; created_at: Date }

async function latestPlanRun(studentId: string): Promise<RunRow | null> {
  const { rows } = await db.query<RunRow>(
    `SELECT ar.id, ar.status, ar.termination_reason, ar.created_at
     FROM agent.agent_runs ar
     JOIN agent.agent_definitions ad ON ad.id = ar.agent_definition_id
     WHERE ar.student_id = $1 AND ad.name = 'learning_readiness_agent'
     ORDER BY ar.created_at DESC LIMIT 1`,
    [studentId]
  );
  return rows[0] ?? null;
}

const isRunActive = (run: RunRow | null): boolean =>
  !!run && ['QUEUED', 'RUNNING'].includes(run.status) && Date.now() - new Date(run.created_at).getTime() < PLAN_RUN_STALE_MS;

learningRouter.get('/plans/:studentId/current', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const studentId = req.params.studentId as string;
    await assertStudentScope(req, studentId);

    const [{ rows: planRows }, { rows: interviewRows }, run] = await Promise.all([
      db.query<PlanRow>(
        `SELECT id, plan_data, source_attempt_id, version, created_at
         FROM performance.learning_plans WHERE student_id = $1
         ORDER BY created_at DESC LIMIT 1`,
        [studentId]
      ),
      db.query<{ attempt_id: string; created_at: Date }>(
        `SELECT attempt_id, created_at FROM performance.assessment_reports
         WHERE student_id = $1 AND report_data IS NOT NULL
         ORDER BY created_at DESC LIMIT 1`,
        [studentId]
      ),
      latestPlanRun(studentId),
    ]);
    const plan = planRows[0] ?? null;
    const interview = interviewRows[0] ?? null;

    // The roadmap is current when it was built from (or after) the latest interview
    const planIsCurrent = !!plan && (!interview
      || plan.source_attempt_id === interview.attempt_id
      || new Date(plan.created_at) > new Date(interview.created_at));
    const runAfterInterview = !!run && !!interview && new Date(run.created_at) >= new Date(interview.created_at);

    let status: 'NO_INTERVIEW' | 'GENERATING' | 'READY' | 'FAILED' | 'MISSING';
    if (isRunActive(run)) status = 'GENERATING';
    else if (planIsCurrent) status = 'READY';
    else if (!interview) status = 'NO_INTERVIEW';
    else if (runAfterInterview && ['FAILED', 'DEAD'].includes(run!.status)) status = 'FAILED';
    else if (Date.now() - new Date(interview.created_at).getTime() < PLAN_TRIGGER_GRACE_MS) status = 'GENERATING';
    else status = 'MISSING';

    sendSuccess(res, {
      status,
      plan: plan && {
        id: plan.id,
        data: plan.plan_data,
        sourceAttemptId: plan.source_attempt_id,
        version: plan.version,
        createdAt: plan.created_at,
        isCurrent: planIsCurrent,
      },
      latestInterviewAt: interview?.created_at ?? null,
    });
  } catch (err) {
    sendError(res, err);
  }
});

// Builds a fresh roadmap from the latest interview (e.g. after a failed build)
learningRouter.post('/plans/:studentId/rebuild', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const studentId = req.params.studentId as string;
    await assertStudentScope(req, studentId);

    const { rows: interviewRows } = await db.query(
      `SELECT 1 FROM performance.assessment_reports
       WHERE student_id = $1 AND report_data IS NOT NULL LIMIT 1`,
      [studentId]
    );
    if (interviewRows.length === 0) {
      throw new AppError(409, 'Take a mock interview first — the roadmap is built from it', 'NO_INTERVIEW');
    }
    if (isRunActive(await latestPlanRun(studentId))) {
      throw new AppError(409, 'Your roadmap is already being built', 'PLAN_IN_PROGRESS');
    }
    const { rows: recent } = await db.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM agent.agent_runs ar
       JOIN agent.agent_definitions ad ON ad.id = ar.agent_definition_id
       WHERE ar.student_id = $1 AND ad.name = 'learning_readiness_agent'
         AND ar.created_at > now() - interval '1 hour'`,
      [studentId]
    );
    if (parseInt(recent[0]?.n ?? '0', 10) >= MAX_PLAN_REBUILDS_PER_HOUR) {
      throw new AppError(429, 'You have rebuilt your roadmap several times this hour — try again later', 'TOO_MANY_REBUILDS');
    }

    const resp = await axios.post(
      `${env.AI_SERVICE_URL}/agent/run`,
      {
        student_id: studentId,
        goal: 'Improve technical skills, communication skills, and interview readiness',
        triggered_by_user_id: req.user!.id,
      },
      { timeout: 10_000, headers: { 'X-Internal-Key': env.AI_INTERNAL_KEY } }
    );
    sendSuccess(res, { agentRunId: resp.data.run_id as string }, 202);
  } catch (err) {
    if (err && typeof err === 'object' && 'isAxiosError' in err) {
      sendError(res, new AppError(503, 'The roadmap service is unavailable — try again shortly', 'AGENT_UNAVAILABLE'));
      return;
    }
    sendError(res, err);
  }
});

learningRouter.get('/recommendations/:studentId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const studentId = req.params.studentId as string;
    await assertStudentScope(req, studentId);
    const { rows } = await db.query(
      `SELECT lr.id, lr.learning_plan_id, lr.source_attempt_id, lr.skill_id,
              sk.name AS skill_name, lr.recommendation_type, lr.title,
              lr.description, lr.priority, lr.evidence, lr.status,
              lr.created_at, lr.updated_at
       FROM performance.learning_recommendations lr
       LEFT JOIN performance.skills sk ON sk.id = lr.skill_id
       WHERE lr.student_id = $1
       ORDER BY lr.priority DESC, lr.created_at DESC`,
      [studentId]
    );
    sendSuccess(res, { recommendations: rows });
  } catch (err) {
    sendError(res, err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// AGENT RUNS
// Node.js authenticates/authorises, then delegates execution to Python.
// ─────────────────────────────────────────────────────────────────────────────

const agentRunSchema = z.object({
  studentId: z.string().uuid(),
  goal:      z.string().min(1).max(500),
});

// ── POST /learning/agent/run — delegate to Python FastAPI agent service ────────

learningRouter.post('/agent/run', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = agentRunSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(422, 'Validation failed', 'VALIDATION_ERROR');
    const { studentId, goal } = parsed.data;

    await assertStudentScope(req, studentId);

    const { rows: studentRows } = await db.query(
      'SELECT id FROM org.students WHERE id = $1',
      [studentId]
    );
    if (studentRows.length === 0) throw new AppError(404, 'Student not found', 'NOT_FOUND');

    // Delegate entirely to the Python agent service
    const resp = await axios.post(
      `${env.AI_SERVICE_URL}/agent/run`,
      {
        student_id:            studentId,
        goal,
        triggered_by_user_id:  req.user!.id,
      },
      { timeout: 10_000, headers: { 'X-Internal-Key': env.AI_INTERNAL_KEY } }
    );

    const agentRunId: string = resp.data.run_id;
    sendSuccess(res, { agentRunId }, 202);
  } catch (err) {
    // Treat axios network/HTTP errors as a service-unavailable response
    if (err && typeof err === 'object' && ('isAxiosError' in err || (err as Record<string, unknown>).code === 'ECONNREFUSED')) {
      sendError(res, new AppError(503, 'Agent service unavailable', 'AGENT_UNAVAILABLE'));
      return;
    }
    sendError(res, err);
  }
});

// ── GET /learning/agent/run/:runId — poll run status (reads shared DB directly) ──

learningRouter.get('/agent/run/:runId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { rows: runRows } = await db.query(
      `SELECT id, student_id, status, goal_snapshot, termination_reason,
              correlation_id, started_at, completed_at, created_at
       FROM agent.agent_runs WHERE id = $1`,
      [req.params.runId]
    );
    if (runRows.length === 0) throw new AppError(404, 'Agent run not found', 'NOT_FOUND');
    const run = runRows[0];

    await assertStudentScope(req, run.student_id);

    const { rows: steps } = await db.query(
      `SELECT id, sequence_no, step_type, tool_name, input, output,
              status, error_code, error_message, duration_ms, created_at
       FROM agent.agent_steps
       WHERE agent_run_id = $1
       ORDER BY sequence_no ASC`,
      [req.params.runId]
    );

    let learningPlan = null;
    if (run.status === 'SUCCEEDED') {
      const { rows: planRows } = await db.query(
        `SELECT id, student_id, generated_by_agent_run_id, goal, plan_data,
                status, version, created_at, updated_at
         FROM performance.learning_plans
         WHERE generated_by_agent_run_id = $1`,
        [req.params.runId]
      );
      learningPlan = planRows[0] ?? null;
    }

    sendSuccess(res, { run, steps, learningPlan });
  } catch (err) {
    sendError(res, err);
  }
});
