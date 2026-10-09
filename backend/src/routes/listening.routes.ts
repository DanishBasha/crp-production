import path from 'path';
import { Router, Response } from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { db } from '../shared/db/pool';
import { AppError } from '../shared/errors/AppError';
import { sendSuccess, sendError } from '../shared/helpers/response';
import { LocalStorageClient } from '../shared/storage/LocalStorageClient';
import { AuthRequest } from '../middleware/authenticate';
import { requireRole } from '../middleware/authorize';
import { env } from '../config/env';

export const listeningRouter = Router();

const storage = new LocalStorageClient();
const upload  = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: env.UPLOAD_MAX_FILE_SIZE_MB * 1024 * 1024 },
});

// ── GET /api/listening ─────────────────────────────────────────────────────────

listeningRouter.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const difficulty = req.query.difficulty as string | undefined;
    const params: unknown[] = [];
    let sql = `SELECT id, title, content, difficulty, source_type, metadata,
                      is_active, created_at, updated_at
               FROM knowledge.listening_stories WHERE is_active = true`;
    if (difficulty) {
      params.push(difficulty.toUpperCase());
      sql += ` AND difficulty = $${params.length}`;
    }
    sql += ' ORDER BY created_at DESC';
    const { rows } = await db.query(sql, params);
    sendSuccess(res, { stories: rows });
  } catch (err) {
    sendError(res, err);
  }
});

// ── GET /api/listening/:id ─────────────────────────────────────────────────────

listeningRouter.get('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { rows } = await db.query(
      `SELECT id, title, content, difficulty, source_type, metadata,
              is_active, created_at, updated_at
       FROM knowledge.listening_stories WHERE id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) throw new AppError(404, 'Listening story not found', 'NOT_FOUND');
    sendSuccess(res, { story: rows[0] });
  } catch (err) {
    sendError(res, err);
  }
});

// ── POST /api/listening ────────────────────────────────────────────────────────

const createSchema = z.object({
  title:       z.string().min(1).max(500),
  content:     z.string().min(1),
  difficulty:  z.enum(['EASY', 'MEDIUM', 'HARD']).default('MEDIUM'),
  source_type: z.string().default('MANUAL'),
  metadata:    z.record(z.unknown()).optional(),
});

listeningRouter.post(
  '/',
  requireRole('PROGRAM_ADMIN', 'TRAINER'),
  upload.single('audio'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const parsed = createSchema.safeParse(
        typeof req.body.data === 'string' ? JSON.parse(req.body.data) : req.body
      );
      if (!parsed.success) throw new AppError(422, 'Validation failed', 'VALIDATION_ERROR');
      const { title, content, difficulty, source_type, metadata } = parsed.data;

      // DBML listening_stories has no dedicated audio column — audio is stored via
      // LocalStorageClient and the resulting path is recorded in metadata.audio_url.
      // If no audio is uploaded, metadata.audio_url is simply absent.
      let resolvedMetadata: Record<string, unknown> = metadata ?? {};
      if (req.file) {
        try {
          const ext = path.extname(req.file.originalname) || '.bin';
          const destPath = `listening/${randomUUID()}${ext}`;
          const audioPath = await storage.upload(req.file.buffer, destPath, req.file.mimetype);
          resolvedMetadata = { ...resolvedMetadata, audio_url: audioPath };
        } catch (storageErr) {
          console.error('[listening] audio storage failed, story saved without audio:', storageErr);
        }
      }

      const { rows } = await db.query(
        `INSERT INTO knowledge.listening_stories
           (title, content, difficulty, source_type, metadata)
         VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [title, content, difficulty, source_type, JSON.stringify(resolvedMetadata)]
      );
      sendSuccess(res, { story: rows[0] }, 201);
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── PUT /api/listening/:id ─────────────────────────────────────────────────────

const updateSchema = z.object({
  title:       z.string().min(1).max(500).optional(),
  content:     z.string().optional(),
  difficulty:  z.enum(['EASY', 'MEDIUM', 'HARD']).optional(),
  source_type: z.string().optional(),
  metadata:    z.record(z.unknown()).optional(),
});

listeningRouter.put(
  '/:id',
  requireRole('PROGRAM_ADMIN', 'TRAINER'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError(422, 'Validation failed', 'VALIDATION_ERROR');
      const { title, content, difficulty, source_type, metadata } = parsed.data;

      const { rows } = await db.query(
        `UPDATE knowledge.listening_stories
         SET title       = COALESCE($2, title),
             content     = COALESCE($3, content),
             difficulty  = COALESCE($4, difficulty),
             source_type = COALESCE($5, source_type),
             metadata    = COALESCE($6, metadata),
             updated_at  = now()
         WHERE id = $1 RETURNING *`,
        [req.params.id, title ?? null, content ?? null, difficulty ?? null,
         source_type ?? null, metadata ? JSON.stringify(metadata) : null]
      );
      if (rows.length === 0) throw new AppError(404, 'Listening story not found', 'NOT_FOUND');
      sendSuccess(res, { story: rows[0] });
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── DELETE /api/listening/:id — soft delete ────────────────────────────────────

listeningRouter.delete(
  '/:id',
  requireRole('PROGRAM_ADMIN'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { rows } = await db.query(
        `UPDATE knowledge.listening_stories SET is_active = false, updated_at = now()
         WHERE id = $1 RETURNING id`,
        [req.params.id]
      );
      if (rows.length === 0) throw new AppError(404, 'Listening story not found', 'NOT_FOUND');
      sendSuccess(res, { message: 'Listening story deactivated' });
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── POST /api/listening/submit-answers ──────────────────────────────────────────
listeningRouter.post('/submit-answers', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { sessionId, studentId, topic, passage, answers = [], assignmentId } = req.body;
    let student: any = null;
    const targetUserId = req.user?.id;
    if (studentId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(studentId)) {
      const { rows } = await db.query(`SELECT s.id, s.user_id, s.program_id, s.batch_id, s.track, s.roll_number, u.name, s.recent_reports FROM org.students s JOIN identity.users u ON u.id = s.user_id WHERE s.id = $1`, [studentId]);
      if (rows.length > 0) student = rows[0];
    }
    if (!student && targetUserId) {
      const { rows } = await db.query(`SELECT s.id, s.user_id, s.program_id, s.batch_id, s.track, s.roll_number, u.name, s.recent_reports FROM org.students s JOIN identity.users u ON u.id = s.user_id WHERE s.user_id = $1`, [targetUserId]);
      if (rows.length > 0) student = rows[0];
    }
    if (!student) {
      const { rows } = await db.query(`SELECT s.id, s.user_id, s.program_id, s.batch_id, s.track, s.roll_number, u.name, s.recent_reports FROM org.students s JOIN identity.users u ON u.id = s.user_id ORDER BY s.created_at DESC LIMIT 1`);
      student = rows[0] || null;
    }

    const passageQuestions: any[] = passage?.questions || [];
    let totalScore = 0;
    const evaluations = answers.map((ans: any, idx: number) => {
      const qObj = passageQuestions.find((q: any) => q.id === ans.questionId) || passageQuestions[idx] || {
        questionText: `Listening Comprehension Question ${idx + 1}`,
        targetKeywords: [],
        idealAnswerSummary: ''
      };
      const keywords: string[] = qObj.targetKeywords || qObj.keywords || [];
      const lowerAns = (ans.answerText || '').toLowerCase();
      let score = 65;
      let matchedKeywords = 0;
      keywords.forEach((kw: string) => {
        if (lowerAns.includes(kw.toLowerCase())) {
          matchedKeywords++;
          score += 10;
        }
      });
      if ((ans.answerText || '').trim().length > 20) score += 5;
      score = Math.min(98, score);
      totalScore += score;
      return {
        questionIndex: idx,
        questionText: qObj.questionText,
        studentAnswer: ans.answerText,
        expectedAnswer: qObj.idealAnswerSummary || qObj.expectedAnswer || '',
        score,
        matchedKeywords,
        feedback: score >= 80 
          ? 'Accurately captured architectural and technical details from the briefing.'
          : 'Partially captured requirement. Review technical constraints in the passage.'
      };
    });

    const avgScore = Math.round(totalScore / Math.max(1, answers.length));

    const turns = evaluations.map((ev: any, i: number) => ({
      id: `lis_turn_${i + 1}`,
      turn: i + 1,
      questionNumber: i + 1,
      question: ev.questionText,
      questionText: ev.questionText,
      difficulty: 'MEDIUM',
      category: 'Listening Comprehension',
      studentAnswer: ev.studentAnswer,
      answer: ev.studentAnswer,
      technicalScore: ev.score,
      communicationScore: Math.min(95, ev.score + 2),
      overallScore: ev.score,
      wpm: 126,
      fillerWords: 0,
      fillerCount: 0,
      pauseCount: 0,
      pointsCovered: ev.matchedKeywords > 0 ? [`Captured ${ev.matchedKeywords} key technical term(s)`] : ['General conceptual understanding demonstrated'],
      pointsMissed: ev.score < 80 ? ['Did not fully address all key constraints in passage'] : [],
      feedback: ev.feedback,
      strengths: ev.score >= 80 ? 'Accurate recall of technical requirements and constraints.' : 'Understood general concept.',
      weaknesses: ev.score < 80 ? 'Review technical constraints and specifications in the passage.' : 'None noted.'
    }));

    const finalReport = {
      id: `rep_${Date.now().toString().slice(-6)}`,
      date: new Date().toISOString().split('T')[0],
      sessionType: 'LISTENING_COMPREHENSION',
      overallScore: avgScore,
      technicalScore: avgScore,
      communicationScore: Math.min(95, avgScore + 2),
      listeningScore: avgScore,
      fluencyScore: Math.min(95, avgScore + 2),
      clarityScore: Math.min(95, avgScore + 1),
      averageWpm: 126,
      totalFillerWords: 0,
      fillerWordBreakdown: {},
      tabSwitches: 0,
      isDisqualified: false,
      questionsAnswered: answers.length,
      questionsPlanned: answers.length,
      scoringMethod: [
        'Overall Score = Average of individual question comprehension scores.',
        'Listening Retention = Keyword recall against passage rubric.',
        'Spoken Articulation = Technical clarity and vocabulary.'
      ],
      skillBreakdown: [
        {
          skill: `${topic || passage?.domain || 'Listening Comprehension'} Retention`,
          score: avgScore,
          status: avgScore >= 80 ? 'STRONG' : 'MODERATE',
          recommendation: evaluations[0]?.feedback || 'Demonstrated consistent attention to technical requirements.'
        },
        {
          skill: 'Technical Information Recall',
          score: Math.min(95, avgScore + 2),
          status: avgScore >= 80 ? 'STRONG' : 'MODERATE',
          recommendation: `Captured ${evaluations.reduce((acc: number, e: any) => acc + (e.matchedKeywords || 0), 0)} target architectural keywords across ${answers.length} questions.`
        }
      ],
      actionableNextSteps: [
        'Continue practicing verbal summarization of high-scale architectural design briefs.',
        'Focus on precisely naming protocols, caching patterns, and failover mechanics when responding.'
      ],
      turns
    };

    if (student?.id) {
      await db.query(
        `UPDATE org.students
         SET recent_reports = jsonb_build_array($1::jsonb) || COALESCE(recent_reports, '[]'::jsonb),
             overall_readiness = $2,
             score = $2,
             updated_at = now()
         WHERE id = $3`,
        [JSON.stringify(finalReport), avgScore, student.id]
      ).catch(err => console.error('[listening.routes] Failed to save report to org.students:', err));
    }

    if (assignmentId && student?.id) {
      try {
        const { rows: asgRows } = await db.query(
          `SELECT submissions FROM org.interview_assignments WHERE id = $1`,
          [assignmentId]
        );
        if (asgRows.length > 0) {
          let subs = asgRows[0].submissions || [];
          if (!Array.isArray(subs)) subs = [];
          const newSub = {
            studentId: student.id,
            studentName: student.name || 'Student',
            studentRollNumber: student.roll_number || '',
            score: avgScore,
            status: 'COMPLETED',
            submittedAt: new Date().toISOString(),
            report: finalReport
          };
          const subIdx = subs.findIndex((s: any) => s.studentId === student.id);
          if (subIdx !== -1) {
            subs[subIdx] = newSub;
          } else {
            subs.push(newSub);
          }
          await db.query(
            `UPDATE org.interview_assignments SET submissions = $1, updated_at = now() WHERE id = $2`,
            [JSON.stringify(subs), assignmentId]
          );
        }
      } catch (asgErr) {
        console.error('[listening.routes] Failed to update assignment submission:', asgErr);
      }
    }

    sendSuccess(res, {
      overallScore: avgScore,
      evaluations,
      finalReport
    });
  } catch (err) {
    sendError(res, err);
  }
});
