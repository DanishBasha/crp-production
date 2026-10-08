import { Router, Response } from 'express';
import { z } from 'zod';
import { db } from '../shared/db/pool';
import { AppError } from '../shared/errors/AppError';
import { sendSuccess, sendError } from '../shared/helpers/response';
import { AuthRequest } from '../middleware/authenticate';
import { eventBus } from '../shared/events/eventBus';
import { Events, AttemptCompletedPayload } from '../shared/events/events';

export const interviewRouter = Router();

// ── Validation schemas ────────────────────────────────────────────────────────

const startSessionSchema = z.object({
  studentId: z.string().uuid(),
  goal:      z.string().min(1).max(500).default('Improve technical skills and interview readiness'),
});

const concludeSessionSchema = z.object({
  goal:               z.string().min(1).max(500).optional(),
  overallScore:       z.number().min(0).max(100),
  technicalScore:     z.number().min(0).max(100).optional().nullable(),
  communicationScore: z.number().min(0).max(100).optional().nullable(),
  listeningScore:     z.number().min(0).max(100).optional().nullable(),
});

// ── Helper: look up student org context ──────────────────────────────────────

async function getStudentContext(studentId: string) {
  const { rows } = await db.query(
    `SELECT s.id, s.program_id, s.batch_id, s.subdivision_id
     FROM org.students s WHERE s.id = $1`,
    [studentId]
  );
  if (rows.length === 0) throw new AppError(404, 'Student not found', 'NOT_FOUND');
  return rows[0] as {
    id: string;
    program_id: string;
    batch_id: string;
    subdivision_id: string | null;
  };
}

// ── POST /api/sessions — Start an interview session ──────────────────────────
// Creates a new assessment_attempt linked to the student and returns the session ID.

interviewRouter.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = startSessionSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(422, 'Validation failed', 'VALIDATION_ERROR');
    const { studentId, goal } = parsed.data;

    const student = await getStudentContext(studentId);

    // Use the first active assessment as the template, or auto-create if not yet seeded
    let assessmentId: string;
    const { rows: assessmentRows } = await db.query(
      `SELECT id FROM assessment.assessments WHERE is_active = true ORDER BY created_at LIMIT 1`
    );
    if (assessmentRows.length === 0) {
      const { rows: createdAssessment } = await db.query(
        `INSERT INTO assessment.assessments (name, assessment_type, interview_type, is_active)
         VALUES ('Standard Technical Assessment', 'MOCK_INTERVIEW', 'TECHNICAL', true)
         RETURNING id`
      );
      assessmentId = createdAssessment[0].id;
    } else {
      assessmentId = assessmentRows[0].id;
    }

    // Create attempt
    const { rows: attemptRows } = await db.query(
      `INSERT INTO assessment.assessment_attempts
         (assessment_id, student_id, interview_type, program_id, batch_id,
          subdivision_id, assessment_version, scoring_version, status, started_at)
       VALUES ($1,$2,'TECHNICAL',$3,$4,$5,1,'v1.0','IN_PROGRESS',now())
       RETURNING id`,
      [assessmentId, studentId, student.program_id, student.batch_id, student.subdivision_id]
    );
    const attemptId: string = attemptRows[0].id;

    // Create session record
    const { rows: sessionRows } = await db.query(
      `INSERT INTO session.assessment_sessions
         (attempt_id, current_sequence_no, state, last_activity_at)
       VALUES ($1, 0, 'STARTED', now())
       RETURNING id`,
      [attemptId]
    );
    const sessionId: string = sessionRows[0].id;

    console.log(
      `[interview] Session started sessionId=${sessionId} attemptId=${attemptId} ` +
      `studentId=${studentId} goal="${goal}"`
    );

    sendSuccess(res, { sessionId, attemptId, goal }, 201);
  } catch (err) {
    sendError(res, err);
  }
});

// ── POST /api/sessions/:id/conclude — Conclude session, trigger Module 3 ─────
// Marks the attempt COMPLETED, stores scores, emits ATTEMPT_COMPLETED event.
// The event handler in module3Handlers.ts updates performance data AND triggers
// the Module 3 agent, which calls Groq to generate a personalized roadmap.

interviewRouter.post('/:id/conclude', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const sessionId = req.params.id;
    const parsed = concludeSessionSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(422, 'Validation failed', 'VALIDATION_ERROR');
    const {
      goal,
      overallScore,
      technicalScore,
      communicationScore,
      listeningScore,
    } = parsed.data;

    // Load attempt via session
    const { rows: sessionRows } = await db.query(
      `SELECT ss.attempt_id
       FROM session.assessment_sessions ss
       WHERE ss.id = $1`,
      [sessionId]
    );
    if (sessionRows.length === 0) {
      throw new AppError(404, 'Session not found', 'NOT_FOUND');
    }
    const attemptId: string = sessionRows[0].attempt_id;

    // Load attempt
    const { rows: attemptRows } = await db.query(
      `SELECT student_id, program_id, batch_id, subdivision_id, status
       FROM assessment.assessment_attempts WHERE id = $1`,
      [attemptId]
    );
    if (attemptRows.length === 0) throw new AppError(404, 'Attempt not found', 'NOT_FOUND');
    const attempt = attemptRows[0];

    if (attempt.status === 'COMPLETED') {
      sendSuccess(res, { message: 'Already concluded', attemptId });
      return;
    }

    // Mark attempt complete
    await db.query(
      `UPDATE assessment.assessment_attempts
       SET status='COMPLETED', completed_at=now() WHERE id=$1`,
      [attemptId]
    );

    // Store assessment report with the provided scores
    await db.query(
      `INSERT INTO performance.assessment_reports
         (attempt_id, student_id, assessment_version, scoring_version,
          technical_score, communication_score, listening_score, overall_score,
          component_scores, skill_scores)
       VALUES ($1,$2,1,'v1.0',$3,$4,$5,$6,$7,NULL)
       ON CONFLICT (attempt_id) DO UPDATE
         SET technical_score=$3, communication_score=$4,
             listening_score=$5, overall_score=$6`,
      [
        attemptId,
        attempt.student_id,
        technicalScore ?? null,
        communicationScore ?? null,
        listeningScore ?? null,
        overallScore,
        JSON.stringify({
          TECHNICAL: technicalScore,
          COMMUNICATION: communicationScore,
          LISTENING: listeningScore,
        }),
      ]
    );

    // Update session state
    await db.query(
      `UPDATE session.assessment_sessions SET state='CONCLUDED', last_activity_at=now() WHERE id=$1`,
      [sessionId]
    );

    const resolvedGoal =
      goal ?? 'Improve technical skills, communication skills, and interview readiness';

    console.log(
      `[interview] Session concluded sessionId=${sessionId} attemptId=${attemptId} ` +
      `studentId=${attempt.student_id} overallScore=${overallScore} goal="${resolvedGoal}"`
    );

    // Emit ATTEMPT_COMPLETED — module3Handlers updates performance data
    // and triggers the Module 3 agent (Groq roadmap generation)
    const payload: AttemptCompletedPayload = {
      attemptId,
      studentId:         attempt.student_id,
      programId:         attempt.program_id,
      batchId:           attempt.batch_id,
      subdivisionId:     attempt.subdivision_id,
      overallScore,
      technicalScore:    technicalScore ?? null,
      communicationScore: communicationScore ?? null,
      listeningScore:    listeningScore ?? null,
      goal:              resolvedGoal,
    };
    eventBus.emit(Events.ATTEMPT_COMPLETED, payload);

    sendSuccess(res, { message: 'Session concluded. Module 3 agent triggered.', attemptId });
  } catch (err) {
    sendError(res, err);
  }
});

// ── Helper: resolve student from identifier or current user ──────────────────
async function resolveStudent(identifier?: string, userId?: string) {
  if (identifier && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier)) {
    const { rows } = await db.query(`SELECT id, user_id, program_id, batch_id, subdivision_id, track, department, resume_data FROM org.students WHERE id = $1`, [identifier]);
    if (rows.length > 0) return rows[0];
    const { rows: byUser } = await db.query(`SELECT id, user_id, program_id, batch_id, subdivision_id, track, department, resume_data FROM org.students WHERE user_id = $1`, [identifier]);
    if (byUser.length > 0) return byUser[0];
  }
  if (userId) {
    const { rows: byAuthUser } = await db.query(`SELECT id, user_id, program_id, batch_id, subdivision_id, track, department, resume_data FROM org.students WHERE user_id = $1`, [userId]);
    if (byAuthUser.length > 0) return byAuthUser[0];
  }
  const { rows } = await db.query(`SELECT id, user_id, program_id, batch_id, subdivision_id, track, department, resume_data FROM org.students ORDER BY created_at DESC LIMIT 1`);
  return rows[0] || null;
}

// ── POST /api/interview/start ────────────────────────────────────────────────
interviewRouter.post('/start', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { studentId, domain, difficulty = 'EASY', type = 'MOCK_INTERVIEW' } = req.body;
    const student = await resolveStudent(studentId, req.user?.id);

    const candidateName = req.user?.name || 'Candidate';
    let targetDomain = domain || student?.track || student?.department || 'Full Stack Development';

    const resume = student?.resume_data || {};
    const realProjects = (resume.projects && Array.isArray(resume.projects)) ? resume.projects : [];
    const realSkills = resume.skills || {};
    const languages: string[] = Array.isArray(realSkills.languages) ? realSkills.languages : [];

    let firstQuestionText = '';
    let category = 'System Architecture & Problem Solving';

    // 1. Try real AI question generation
    try {
      const { generateQuestion } = await import('../modules/evaluation/ai-client');
      let domainContext = targetDomain;
      if (realProjects.length > 0) {
        domainContext += ` - Grounded on candidate's real project: "${realProjects[0].title}" (${realProjects[0].description || ''})`;
      } else if (languages.length > 0) {
        domainContext += ` - Focused on: ${languages.join(', ')}`;
      }

      const aiResult = await generateQuestion({
        student_name: candidateName,
        difficulty: (difficulty.toUpperCase() as any) || 'EASY',
        domain: domainContext,
        previous_turns: []
      });

      if (aiResult && !aiResult.unreachable && aiResult.question_text) {
        firstQuestionText = aiResult.question_text;
        category = aiResult.category || category;
      }
    } catch (e) {
      console.warn('[interview.routes] AI generation warning:', e);
    }

    // 2. Fallback if AI was unreachable: use actual candidate details (never fake projects)
    if (!firstQuestionText) {
      if (realProjects.length > 0) {
        const p = realProjects[0];
        const techStr = (p.techStack && p.techStack.length > 0) ? p.techStack.join(', ') : (languages[0] || 'core engineering principles');
        firstQuestionText = `Walk me through the system architecture of your project "${p.title}". Specifically, how did you structure the components using ${techStr}, and what was the main engineering challenge you solved?`;
      } else if (languages.length > 0) {
        firstQuestionText = `You have highlighted proficiency in ${languages.slice(0, 2).join(' and ')}. Can you describe a challenging technical system or problem you built using this stack, explaining your architectural choices and performance considerations?`;
      } else {
        firstQuestionText = `Can you introduce yourself and discuss a significant software system or technical project you have developed, detailing the architectural choices you made and the engineering tradeoffs involved?`;
      }
    }

    const sessionId = `ses_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    sendSuccess(res, {
      sessionId,
      firstQuestion: {
        id: `q_1_${Date.now()}`,
        questionNumber: 1,
        questionText: firstQuestionText,
        difficulty: difficulty || 'EASY',
        category
      }
    }, 201);
  } catch (err) {
    sendError(res, err);
  }
});

// ── POST /api/interview/submit-turn ──────────────────────────────────────────
interviewRouter.post('/submit-turn', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      sessionId,
      studentId,
      studentAnswer,
      durationSeconds = 25,
      turnIndex = 0,
      currentQuestion,
      previousTurns = [],
      sessionType = 'MOCK_INTERVIEW',
      tabSwitches = 0
    } = req.body;

    const student = await resolveStudent(studentId, req.user?.id);

    // Call Real AI evaluation service
    const { evaluateResponse, generateQuestion } = await import('../modules/evaluation/ai-client');

    const evalRes = await evaluateResponse({
      question_text: currentQuestion?.questionText || 'Technical Question',
      student_answer: studentAnswer || '',
      difficulty: (currentQuestion?.difficulty?.toUpperCase() as any) || 'MEDIUM',
      turn_number: turnIndex + 1,
      domain: currentQuestion?.category || 'Software Engineering'
    });

    const isAIWorking = !evalRes.unreachable && evalRes.model_used !== 'unavailable';

    const turnEvaluation = {
      id: currentQuestion?.id || `q_${turnIndex + 1}`,
      questionNumber: turnIndex + 1,
      questionText: currentQuestion?.questionText || '',
      difficulty: currentQuestion?.difficulty || 'MEDIUM',
      category: currentQuestion?.category || 'Technical Assessment',
      studentAnswer: studentAnswer || '',
      technicalScore: evalRes.technical_score,
      communicationScore: evalRes.communication_score,
      wpm: evalRes.wpm,
      fillerWords: evalRes.filler_count,
      feedback: evalRes.feedback || (isAIWorking ? '' : 'Good conceptual structure. Articulate trade-offs with explicit space-time complexity analysis.'),
      strengths: evalRes.strengths || 'Clear articulation and relevant technical terminology.',
      weaknesses: evalRes.weaknesses || 'Elaborate further on concurrency constraints and system resilience.'
    };

    const isCompleted = turnIndex >= 2;
    let nextQuestion: any = null;
    let finalReport: any = null;

    if (!isCompleted) {
      const nextDiff = turnIndex === 0 ? 'MEDIUM' : 'ADVANCED';
      const history = [...previousTurns, {
        question_text: currentQuestion?.questionText,
        student_answer: studentAnswer,
        difficulty: currentQuestion?.difficulty,
        technical_score: evalRes.technical_score,
        feedback: evalRes.feedback
      }];

      const nextAI = await generateQuestion({
        student_name: req.user?.name || 'Candidate',
        difficulty: nextDiff,
        previous_turns: history,
        domain: currentQuestion?.category || 'Software Engineering'
      }).catch(() => null);

      const nextQuestionText = (nextAI && !nextAI.unreachable && nextAI.question_text)
        ? nextAI.question_text
        : (turnIndex === 0
          ? 'Considering the architecture you described, how would your system handle sudden traffic surges, database locking contention, or cache invalidation stampedes?'
          : 'What trade-offs did you evaluate between consistency and availability, and what monitoring metrics and health probes would you track in production?');

      nextQuestion = {
        id: `q_${turnIndex + 2}_${Date.now()}`,
        questionNumber: turnIndex + 2,
        questionText: nextQuestionText,
        difficulty: nextDiff,
        category: turnIndex === 0 ? 'Concurrency & Scalability' : 'Resilience & Distributed Systems'
      };
    } else {
      // 3 Turns Complete — Synthesize Real Final Diagnostic Report
      const allTurns = [...previousTurns, turnEvaluation];
      const count = Math.max(1, allTurns.length);
      const avgTech = Math.round(allTurns.reduce((acc, t) => acc + (t.technicalScore || 0), 0) / count);
      const avgComm = Math.round(allTurns.reduce((acc, t) => acc + (t.communicationScore || 0), 0) / count);
      const avgWpm = Math.round(allTurns.reduce((acc, t) => acc + (t.wpm || 0), 0) / count);
      const totalFillers = allTurns.reduce((acc, t) => acc + (t.fillerWords || 0), 0);
      const overallScore = Math.round(avgTech * 0.70 + avgComm * 0.30);

      finalReport = {
        id: `rep_${Date.now().toString().slice(-6)}`,
        date: new Date().toISOString().split('T')[0],
        sessionType,
        overallScore,
        technicalScore: avgTech,
        communicationScore: avgComm,
        averageWpm: avgWpm,
        totalFillerWords: totalFillers,
        fillerWordBreakdown: totalFillers > 0 ? { 'uh': Math.round(totalFillers * 0.5), 'um': Math.round(totalFillers * 0.5) } : {},
        skillBreakdown: [
          { skill: 'Core Technical Competency', score: avgTech, status: avgTech >= 80 ? 'STRONG' : 'MODERATE', recommendation: allTurns[0]?.feedback || 'Demonstrated conceptual knowledge.' },
          { skill: 'Verbal Delivery & Articulation', score: avgComm, status: avgComm >= 80 ? 'STRONG' : 'MODERATE', recommendation: `Speaking pace averaged ${avgWpm} WPM.` }
        ],
        actionableNextSteps: [
          `Pacing averaged ${avgWpm} WPM. ${avgWpm >= 120 && avgWpm <= 150 ? 'Maintain this optimal recruiter tempo.' : 'Target 120-150 WPM.'}`,
          totalFillers > 0 ? `Observed ${totalFillers} verbal fillers. Use 1-second strategic pauses.` : `Fluent delivery with minimal verbal fillers.`,
          allTurns[allTurns.length - 1]?.weaknesses || 'Analyze algorithmic edge cases and distributed failure modes systematically.'
        ],
        tabSwitches,
        isFlagged: tabSwitches >= 4
      };

      // Persist directly to Supabase PostgreSQL database
      if (student?.id) {
        await db.query(
          `UPDATE org.students
           SET recent_reports = jsonb_set(
             COALESCE(recent_reports, '[]'::jsonb),
             '{0}',
             $1::jsonb,
             true
           ),
           overall_readiness = $2,
           score = $2,
           updated_at = now()
           WHERE id = $3`,
          [JSON.stringify(finalReport), overallScore, student.id]
        ).catch((err) => console.error('[interview.routes] Failed to save report to org.students:', err));
      }
    }

    sendSuccess(res, {
      isCompleted,
      turnEvaluation,
      nextQuestion,
      finalReport
    });
  } catch (err) {
    sendError(res, err);
  }
});

// ── POST /api/interview/proctor-event ────────────────────────────────────────
interviewRouter.post('/proctor-event', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { sessionId, eventType, tabSwitches = 1 } = req.body;
    sendSuccess(res, {
      sessionId,
      eventType,
      tabSwitches,
      isFlagged: tabSwitches >= 4
    });
  } catch (err) {
    sendError(res, err);
  }
});
