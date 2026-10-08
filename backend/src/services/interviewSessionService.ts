/**
 * Interview session lifecycle shared by the HTTP routes (/api/sessions) and the
 * live interview WebSocket gateway.
 *
 * One interview = assessment.assessment_attempts row + session.assessment_sessions
 * row. The assessment_sessions id doubles as the session.interview_sessions id
 * (transcript checkpoints) and the live gateway / Redis session key.
 */

import { PoolClient } from 'pg';
import { db } from '../shared/db/pool';
import { AppError } from '../shared/errors/AppError';
import { env } from '../config/env';
import { eventBus } from '../shared/events/eventBus';
import { Events, AttemptCompletedPayload } from '../shared/events/events';
import { sessionContextService, InterviewState, InterviewResume } from './sessionContextService';
import type { InterviewReport } from './interviewReport';
import { getCoins, spendCoin, refundCoin } from './coinService';
import { getCurrentResume, getStoredResumeData } from './resumeService';

export const FIRST_QUESTION =
  "Tell me about yourself. Walk me through your background, the key skills you've built, and what you've been working on most recently.";

// Rubric for the opening question (later questions get theirs from the AI with the question)
export const FIRST_QUESTION_KEY_POINTS = [
  'Education or background in one or two sentences',
  'Key technical skills relevant to the role',
  'A specific recent project and the problem it solved',
  'Their own role or contribution in that work',
  'An outcome, result or what they learned',
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface StudentContext {
  id: string;
  program_id: string;
  batch_id: string;
  subdivision_id: string | null;
}

export interface AttemptScores {
  overallScore: number;
  technicalScore: number | null;
  communicationScore: number | null;
  listeningScore: number | null;
}

// Creates the attempt + session rows for a student, using the first active
// assessment as the template. Returns both ids.
//
// Only one IN_PROGRESS attempt per student and assessment is allowed
// (idx_attempts_one_active). Starting again means the student left the earlier
// interview (closed the tab, exited), so that attempt is marked ABANDONED.
export async function createAttemptAndSession(
  student: StudentContext,
): Promise<{ attemptId: string; sessionId: string }> {
  let { rows: assessmentRows } = await db.query<{ id: string }>(
    `SELECT id FROM assessment.assessments WHERE is_active = true ORDER BY created_at LIMIT 1`
  );
  if (assessmentRows.length === 0) {
    // A fresh database has no assessment yet: create the standard one, as POST /interview does
    ({ rows: assessmentRows } = await db.query<{ id: string }>(
      `INSERT INTO assessment.assessments (name, assessment_type, interview_type, is_active)
       VALUES ('Standard Technical Assessment', 'MOCK_INTERVIEW', 'TECHNICAL', true)
       RETURNING id`
    ));
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows: abandoned } = await client.query<{ id: string }>(
      `UPDATE assessment.assessment_attempts
       SET status = 'ABANDONED', completed_at = now()
       WHERE student_id = $1 AND assessment_id = $2 AND status = 'IN_PROGRESS'
       RETURNING id`,
      [student.id, assessmentRows[0].id]
    );
    if (abandoned.length > 0) {
      const abandonedIds = abandoned.map((row) => row.id);
      await client.query(
        `UPDATE session.assessment_sessions SET state = 'ABANDONED', last_activity_at = now()
         WHERE attempt_id = ANY($1::uuid[])`,
        [abandonedIds]
      );
      await client.query(
        `UPDATE session.interview_sessions SET status = 'abandoned', ended_at = now(), updated_at = now()
         WHERE id IN (SELECT id FROM session.assessment_sessions WHERE attempt_id = ANY($1::uuid[]))`,
        [abandonedIds]
      );
    }

    const { rows: attemptRows } = await client.query<{ id: string }>(
      `INSERT INTO assessment.assessment_attempts
         (assessment_id, student_id, interview_type, program_id, batch_id,
          subdivision_id, assessment_version, scoring_version, status, started_at)
       VALUES ($1,$2,'TECHNICAL',$3,$4,$5,1,'v1.0','IN_PROGRESS',now())
       RETURNING id`,
      [assessmentRows[0].id, student.id, student.program_id, student.batch_id, student.subdivision_id]
    );
    const attemptId = attemptRows[0].id;

    const { rows: sessionRows } = await client.query<{ id: string }>(
      `INSERT INTO session.assessment_sessions
         (attempt_id, current_sequence_no, state, last_activity_at)
       VALUES ($1, 0, 'STARTED', now())
       RETURNING id`,
      [attemptId]
    );
    await client.query('COMMIT');
    return { attemptId, sessionId: sessionRows[0].id };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Start a live (voice) interview for the logged-in student ─────────────────

// Resume details a client may still send with the start request. They are ignored:
// the interview uses only the resume the server read and parsed itself (org.resumes),
// so questions never rest on skills or projects the student did not write.
export interface ResumeInput {
  skills?: string[];
  projects?: { title: string; techStack?: string[]; description?: string }[];
}

const RESUME_EXCERPT_CHARS = 3000;

const cleanList = (values: unknown[] | undefined, max: number) =>
  (values ?? []).filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim().slice(0, 80)).slice(0, max);

async function loadResume(studentId: string, name: string): Promise<InterviewResume> {
  const current = await getCurrentResume(studentId);
  const view = current?.view ?? await getStoredResumeData(studentId);
  if (!view) return { name, skills: [], projects: [] };
  const { skills, projects, experience } = view;
  return {
    name,
    skills: cleanList([...skills.languages, ...skills.frameworks, ...skills.databases, ...skills.tools], 20),
    projects: [
      ...projects.slice(0, 6).map((p) => ({
        title: p.title.slice(0, 120),
        tech_stack: cleanList(p.techStack, 10),
        description: p.description.slice(0, 400),
      })),
      // Internships and jobs are interview topics too
      ...experience.slice(0, 3).map((e) => ({
        title: [e.title, e.company].filter(Boolean).join(' at ').slice(0, 120),
        tech_stack: [],
        description: [e.duration, e.description].filter(Boolean).join(': ').slice(0, 400),
      })),
    ].filter((p) => p.title),
    text: (current?.text ?? '').slice(0, RESUME_EXCERPT_CHARS),
  };
}

// Self-practice interviews are about the student's resume; an assignment may fix a topic
const RESUME_INTERVIEW_TOPICS = new Set(['', 'personal resume & projects', 'general programming']);

// Creates the student record (with a default program and batch) for a user who has none yet
async function createStudentForUser(userId: string): Promise<(StudentContext & { name: string }) | null> {
  const { rows: uRows } = await db.query(
    `SELECT id, name, email, institution_id FROM identity.users WHERE id = $1`,
    [userId]
  );
  if (uRows.length === 0) return null;
  const u = uRows[0];
  let instId = u.institution_id;
  if (!instId) {
    const { rows: insts } = await db.query(`SELECT id FROM org.institutions ORDER BY created_at DESC LIMIT 1`);
    instId = insts[0]?.id;
  }
  let programId: string | null = null;
  let batchId: string | null = null;
  if (instId) {
    const { rows: progs } = await db.query(`SELECT id, name FROM org.programs WHERE institution_id = $1 LIMIT 1`, [instId]);
    if (progs.length > 0) {
      programId = progs[0].id;
    } else {
      const { rows: newProg } = await db.query(
        `INSERT INTO org.programs (institution_id, name, code) VALUES ($1, 'General Engineering', 'GEN') RETURNING id`,
        [instId]
      );
      programId = newProg[0].id;
    }
    const { rows: batches } = await db.query(`SELECT id FROM org.batches WHERE program_id = $1 LIMIT 1`, [programId]);
    if (batches.length > 0) {
      batchId = batches[0].id;
    } else {
      const { rows: newBatch } = await db.query(
        `INSERT INTO org.batches (program_id, name, year, track) VALUES ($1, 'Batch 2026', 2026, 'General Track') RETURNING id`,
        [programId]
      );
      batchId = newBatch[0].id;
    }
  }
  const roll = `STU${Date.now().toString(36).toUpperCase().slice(-6)}`;
  const { rows: newStu } = await db.query(
    `INSERT INTO org.students (user_id, program_id, batch_id, roll_number, department, batch_year, track)
     VALUES ($1, $2, $3, $4, 'General Department', 2026, 'General Track')
     RETURNING id, program_id, batch_id, subdivision_id`,
    [u.id, programId, batchId, roll]
  );
  return newStu.length > 0 ? { ...newStu[0], name: u.name } : null;
}

export async function startLiveInterview(userId: string, _resumeInput?: ResumeInput, topic?: string): Promise<{
  sessionId: string;
  attemptId: string;
  maxTurns: number;
  coinsRemaining: number;
  firstQuestion: { id: string; questionNumber: number; questionText: string; difficulty: 'EASY'; category: string };
}> {
  const { rows } = await db.query<StudentContext & { name: string }>(
    `SELECT s.id, s.program_id, s.batch_id, s.subdivision_id, u.name
     FROM org.students s
     JOIN identity.users u ON u.id = s.user_id
     WHERE s.user_id = $1`,
    [userId]
  );
  const student = rows[0] ?? await createStudentForUser(userId);
  if (!student) throw new AppError(404, 'Student profile not found', 'NOT_FOUND');

  const { attemptId, sessionId } = await createAttemptAndSession(student);
  let coinsRemaining: number;
  try {
    coinsRemaining = await spendCoin(student.id, attemptId);
  } catch (err) {
    await terminateLiveInterview(sessionId, attemptId).catch(() => {});
    throw err;
  }
  const maxTurns = env.MAX_QUESTIONS_PER_SESSION;
  const resume = await loadResume(student.id, student.name)
    .catch(() => ({ name: student.name, skills: [], projects: [] }) as InterviewResume);

  const assignedTopic = RESUME_INTERVIEW_TOPICS.has((topic ?? '').trim().toLowerCase()) ? '' : topic!.trim().slice(0, 200);

  const initialState: InterviewState = {
    session_id: sessionId,
    student_id: student.id,
    topic_curriculum: [assignedTopic || 'General Programming'],
    completed_topics: [],
    active_topic: assignedTopic || 'General Programming',
    ...(assignedTopic ? { assigned_topic: assignedTopic } : {}),
    active_topic_question_count: 0,
    max_questions_per_topic: 3,
    do_not_ask_or_repeat: [FIRST_QUESTION],
    current_turn: 1,
    max_turns: maxTurns,
    current_difficulty: 'EASY',
    candidate_performance_trend: 'stable',
    consecutive_weak_answers: 0,
    current_question: FIRST_QUESTION,
    current_question_turn: 1,
    current_rubric: {},
    status: 'ACTIVE',
    attempt_id: attemptId,
    resume,
    current_category: 'Introduction',
    current_key_points: FIRST_QUESTION_KEY_POINTS,
    turn_results: [],
    clarifications_this_turn: 0,
    consecutive_ai_failures: 0,
    tab_switches: 0,
    fullscreen_exits: 0,
    resume_topics_asked: [],
    follow_ups_in_a_row: 0,
    current_question_source: 'introduction',
  };

  try {
    await db.query(
      `INSERT INTO session.interview_sessions (id, student_id, status, interview_state)
       VALUES ($1, $2, 'active', $3)`,
      [sessionId, student.id, JSON.stringify(initialState)]
    );
    await sessionContextService.setState(sessionId, initialState);
  } catch (err) {
    // The interview never started — give the coin back
    await terminateLiveInterview(sessionId, attemptId).catch(() => {});
    await refundCoin(student.id, attemptId).catch(() => {});
    throw err;
  }

  return {
    sessionId,
    attemptId,
    maxTurns,
    coinsRemaining,
    firstQuestion: {
      id: `${sessionId}:1`,
      questionNumber: 1,
      questionText: FIRST_QUESTION,
      difficulty: 'EASY',
      category: 'Introduction',
    },
  };
}

// ── Ownership lookup used by the WebSocket gateway ───────────────────────────

export interface OwnedSession {
  sessionId: string;
  attemptId: string;
  studentId: string;
  attemptStatus: string;
}

export async function loadOwnedSession(sessionId: string, userId: string): Promise<OwnedSession> {
  if (!UUID_RE.test(sessionId)) throw new AppError(404, 'Interview session not found', 'NOT_FOUND');

  const { rows } = await db.query<{
    attempt_id: string; student_id: string; status: string; user_id: string;
  }>(
    `SELECT ss.attempt_id, a.student_id, a.status, s.user_id
     FROM session.assessment_sessions ss
     JOIN assessment.assessment_attempts a ON a.id = ss.attempt_id
     JOIN org.students s ON s.id = a.student_id
     WHERE ss.id = $1`,
    [sessionId]
  );
  if (rows.length === 0) throw new AppError(404, 'Interview session not found', 'NOT_FOUND');
  if (rows[0].user_id !== userId) throw new AppError(403, 'Access denied', 'FORBIDDEN');

  return {
    sessionId,
    attemptId: rows[0].attempt_id,
    studentId: rows[0].student_id,
    attemptStatus: rows[0].status,
  };
}

// ── Completion: marks the attempt complete, stores the report, notifies M3 ───

// Returns false when the attempt was already completed (idempotent); refuses
// attempts that were abandoned because a newer interview was started.
export async function completeAttempt(
  sessionId: string,
  attemptId: string,
  scores: AttemptScores,
  goal: string,
  componentScores?: Record<string, unknown>,
  reportData?: unknown,
): Promise<boolean> {
  const { rows: attemptRows } = await db.query<{
    student_id: string; program_id: string; batch_id: string; subdivision_id: string | null; status: string;
  }>(
    `SELECT student_id, program_id, batch_id, subdivision_id, status
     FROM assessment.assessment_attempts WHERE id = $1`,
    [attemptId]
  );
  if (attemptRows.length === 0) throw new AppError(404, 'Attempt not found', 'NOT_FOUND');
  const attempt = attemptRows[0];
  if (attempt.status === 'COMPLETED') return false;
  if (attempt.status !== 'IN_PROGRESS') {
    throw new AppError(409, 'This interview was abandoned and can no longer be completed', 'ATTEMPT_ABANDONED');
  }

  const client: PoolClient = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE assessment.assessment_attempts
       SET status='COMPLETED', completed_at=now() WHERE id=$1`,
      [attemptId]
    );
    await client.query(
      `INSERT INTO performance.assessment_reports
         (attempt_id, student_id, assessment_version, scoring_version,
          technical_score, communication_score, listening_score, overall_score,
          component_scores, skill_scores, report_data)
       VALUES ($1,$2,1,'v1.0',$3,$4,$5,$6,$7,NULL,$8)
       ON CONFLICT (attempt_id) DO UPDATE
         SET technical_score=$3, communication_score=$4,
             listening_score=$5, overall_score=$6,
             report_data=COALESCE($8, performance.assessment_reports.report_data)`,
      [
        attemptId,
        attempt.student_id,
        scores.technicalScore,
        scores.communicationScore,
        scores.listeningScore,
        scores.overallScore,
        JSON.stringify(componentScores ?? {
          TECHNICAL: scores.technicalScore,
          COMMUNICATION: scores.communicationScore,
          LISTENING: scores.listeningScore,
        }),
        reportData === undefined ? null : JSON.stringify(reportData),
      ]
    );
    await client.query(
      `UPDATE session.assessment_sessions SET state='CONCLUDED', last_activity_at=now() WHERE id=$1`,
      [sessionId]
    );
    await client.query(
      `UPDATE session.interview_sessions
       SET status='completed', overall_score=$1, ended_at=now(), updated_at=now()
       WHERE id=$2`,
      [scores.overallScore, sessionId]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Module 3 updates performance data and triggers the learning-plan agent
  const payload: AttemptCompletedPayload = {
    attemptId,
    studentId: attempt.student_id,
    programId: attempt.program_id,
    batchId: attempt.batch_id,
    subdivisionId: attempt.subdivision_id,
    overallScore: scores.overallScore,
    technicalScore: scores.technicalScore,
    communicationScore: scores.communicationScore,
    listeningScore: scores.listeningScore,
    goal,
  };
  eventBus.emit(Events.ATTEMPT_COMPLETED, payload);
  return true;
}

// Concludes a live interview with the report built from the server's own per-turn results.
export async function concludeLiveInterview(
  sessionId: string,
  attemptId: string,
  report: InterviewReport,
): Promise<void> {
  await completeAttempt(
    sessionId,
    attemptId,
    {
      overallScore: report.overallScore,
      technicalScore: report.technicalScore,
      communicationScore: report.communicationScore,
      listeningScore: null,
    },
    'Improve technical skills, communication skills, and interview readiness',
    {
      TECHNICAL: report.technicalScore,
      COMMUNICATION: report.communicationScore,
      LISTENING: null,
      FLUENCY: report.fluencyScore,
      CLARITY: report.clarityScore,
      AVERAGE_WPM: report.averageWpm || null,
      FILLER_WORDS: report.totalFillerWords,
      TAB_SWITCHES: report.tabSwitches,
      QUESTIONS_ANSWERED: report.questionsAnswered,
    },
    // The learning-plan agent builds the 4-week plan from this evidence
    report,
  );
}

// Ends a live interview without a result (proctoring disqualification, or time ran
// out before anything was answered): the attempt is ABANDONED and earns nothing.
export async function terminateLiveInterview(sessionId: string, attemptId: string): Promise<void> {
  const client: PoolClient = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE assessment.assessment_attempts SET status = 'ABANDONED', completed_at = now()
       WHERE id = $1 AND status = 'IN_PROGRESS'`,
      [attemptId]
    );
    await client.query(
      `UPDATE session.assessment_sessions SET state = 'TERMINATED', last_activity_at = now() WHERE id = $1`,
      [sessionId]
    );
    await client.query(
      `UPDATE session.interview_sessions SET status = 'terminated', ended_at = now(), updated_at = now() WHERE id = $1`,
      [sessionId]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
