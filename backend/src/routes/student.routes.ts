import { Router, Request, Response } from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { db } from '../shared/db/pool';
import { AppError } from '../shared/errors/AppError';
import { sendSuccess, sendError } from '../shared/helpers/response';
import { LocalStorageClient } from '../shared/storage/LocalStorageClient';
import { eventBus } from '../shared/events/eventBus';
import { Events } from '../shared/events/events';
import { authenticate, AuthRequest } from '../middleware/authenticate';
import { requireRole, requireStudentSelfOrStaff } from '../middleware/authorize';
import { env } from '../config/env';
import axios from 'axios';
import { parseResume, saveResumeVersion, getCurrentResume, ParsedResumeData } from '../services/resumeService';

export const studentRouter = Router();

const storage = new LocalStorageClient();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.UPLOAD_MAX_FILE_SIZE_MB * 1024 * 1024 },
});

function paramStr(p: string | string[] | undefined): string {
  return Array.isArray(p) ? (p[0] || '') : (p || '');
}

async function fetchStudentProfile(identifier: string) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier);
  let query = `
    SELECT
      s.id,
      s.user_id AS "userId",
      u.name,
      u.email,
      s.roll_number AS "rollNumber",
      COALESCE(u.institution_id, p.institution_id, pb.institution_id) AS "collegeId",
      COALESCE(inst.name, 'Main Institution') AS "collegeName",
      COALESCE(s.department, 'General Department') AS department,
      COALESCE(s.batch_year, 2026) AS "batchYear",
      COALESCE(s.class_name, '') AS "className",
      COALESCE(s.track, 'General Track') AS track,
      COALESCE(s.program_id, b.program_id) AS "programId",
      COALESCE(s.program_name, p.name, pb.name, 'General Engineering') AS "programName",
      s.sub_program_name AS "subProgramName",
      COALESCE(s.mentor_name, 'Faculty Mentor') AS "mentorName",
      COALESCE(s.mentor_email, 'mentor@college.edu') AS "mentorEmail",
      COALESCE(s.coding_handles, '{}'::jsonb) AS "codingHandles",
      s.resume_data AS resume,
      COALESCE(s.criteria_tasks, '[]'::jsonb) AS "criteriaTasks",
      COALESCE(s.improvement_checklist, '[]'::jsonb) AS "improvementChecklist",
      COALESCE(s.recent_reports, '[]'::jsonb) AS "recentReports",
      COALESCE(s.overall_readiness, 75) AS "overallReadiness",
      COALESCE(s.overall_readiness, 75) AS score,
      COALESCE(s.coins, 5) AS coins,
      s.created_at AS "createdAt"
    FROM org.students s
    JOIN identity.users u ON u.id = s.user_id
    LEFT JOIN org.programs p ON p.id = s.program_id
    LEFT JOIN org.batches b ON b.id = s.batch_id
    LEFT JOIN org.programs pb ON pb.id = b.program_id
    LEFT JOIN org.institutions inst ON inst.id = COALESCE(u.institution_id, p.institution_id, pb.institution_id)
  `;
  if (isUuid) {
    query += ` WHERE s.id = $1 OR s.user_id = $1`;
  } else {
    query += ` WHERE s.roll_number = $1 OR u.email = $1`;
  }
  const { rows } = await db.query(query, [identifier]);
  if (rows.length > 0) return rows[0];

  // Auto-create student record if user exists
  if (isUuid) {
    const { rows: uRows } = await db.query(
      `SELECT id, name, email, institution_id FROM identity.users WHERE id = $1`,
      [identifier]
    );
    if (uRows.length > 0) {
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
         RETURNING id`,
        [u.id, programId, batchId, roll]
      );
      if (newStu.length > 0) {
        return fetchStudentProfile(newStu[0].id);
      }
    }
  }
  return null;
}

// ── GET /api/students/me ─────────────────────────────────────────────────────
studentRouter.get(
  '/me',
  authenticate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      const student = await fetchStudentProfile(userId);
      if (!student) {
        throw new AppError(404, 'Student profile not found', 'NOT_FOUND');
      }
      sendSuccess(res, { student, profile: student });
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── GET /api/students/:studentId ─────────────────────────────────────────────
studentRouter.get(
  ['/:studentId', '/:studentId/profile'],
  authenticate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const studentId = paramStr(req.params.studentId);
      const student = await fetchStudentProfile(studentId);
      if (!student) {
        throw new AppError(404, 'Student not found', 'NOT_FOUND');
      }
      sendSuccess(res, { student, profile: student });
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── PATCH /api/students/:studentId ───────────────────────────────────────────

const patchStudentSchema = z.object({
  codingHandles: z
    .object({
      github: z.string().optional(),
      leetcode: z.string().optional(),
      hackerrank: z.string().optional(),
      codeforces: z.string().optional(),
      codechef: z.string().optional(),
      leetcodeSolved: z.number().int().min(0).optional(),
      githubRepos: z.number().int().min(0).optional(),
    })
    .optional(),
});

studentRouter.patch(
  '/:studentId',
  requireStudentSelfOrStaff,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { studentId } = req.params;
      const user = req.user!;

      // Fetch student to verify ownership for STUDENT role
      const { rows: existing } = await db.query(
        'SELECT id, user_id, coding_handles FROM org.students WHERE id = $1',
        [studentId]
      );
      if (existing.length === 0) throw new AppError(404, 'Student not found', 'NOT_FOUND');

      if (user.role === 'STUDENT' && existing[0].user_id !== user.id) {
        throw new AppError(403, 'Access denied', 'FORBIDDEN');
      }

      const parsed = patchStudentSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(422, 'Validation failed', 'VALIDATION_ERROR');
      }

      const merged = {
        ...((existing[0].coding_handles as object) ?? {}),
        ...(parsed.data.codingHandles ?? {}),
      };

      const { rows } = await db.query(
        `UPDATE org.students SET coding_handles = $1, updated_at = now()
         WHERE id = $2 RETURNING *`,
        [JSON.stringify(merged), studentId]
      );

      sendSuccess(res, { student: rows[0] });
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── Resume: stored file + server-side reading ────────────────────────────────
// The AI service extracts the text (PDF, DOCX, TXT) and keeps only facts written in the
// resume (skills, projects, experience, education...). The parsed resume is stored as a
// version in org.resumes — which the mock interview reads to ground its questions — and
// copied to org.students.resume_data, which the profile endpoints return.

const RESUME_TYPES: Record<string, { ext: string; mime: string }> = {
  '.pdf': { ext: 'pdf', mime: 'application/pdf' },
  '.docx': { ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  '.txt': { ext: 'txt', mime: 'text/plain' },
};

// The student whose resume this request changes; a student may only change their own
async function resolveResumeStudent(req: AuthRequest): Promise<{ id: string; userId: string }> {
  const user = req.user!;
  const raw = paramStr(req.params.studentId);
  let student = await fetchStudentProfile(raw === 'me' ? user.id : raw);
  if (!student && user?.id) student = await fetchStudentProfile(user.id);
  if (!student) throw new AppError(404, 'Student not found', 'NOT_FOUND');
  if (user.role === 'STUDENT' && student.userId !== user.id) throw new AppError(403, 'Access denied', 'FORBIDDEN');
  return student;
}

async function syncResumeData(studentId: string, userId: string, resume: unknown): Promise<void> {
  await db.query(
    `UPDATE org.students SET resume_data = $1, updated_at = now() WHERE id = $2`,
    [JSON.stringify(resume), studentId]
  );
  await db.query(
    `UPDATE candidate.independent_candidates SET resume_data = $1, updated_at = now() WHERE user_id = $2`,
    [JSON.stringify(resume), userId]
  ).catch(() => {});
}

// ── PATCH /api/students/:studentId/resume ─────────────────────────────────────

studentRouter.patch(
  '/:studentId/resume',
  upload.single('resume'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const student = await resolveResumeStudent(req);
      if (!req.file) throw new AppError(422, 'Resume file required', 'FILE_REQUIRED');
      const extension = (req.file.originalname.match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase();
      const type = RESUME_TYPES[extension];
      if (!type) {
        throw new AppError(422, 'Upload a PDF, DOCX or TXT file, or paste your resume text.', 'INVALID_FILE_TYPE');
      }

      // Read it first: an unreadable file (e.g. a scanned image) is rejected with a clear reason
      const parsed = await parseResume({ fileName: req.file.originalname, buffer: req.file.buffer });

      const resumeUrl = await storage.upload(req.file.buffer, `resumes/${randomUUID()}.${type.ext}`, type.mime);
      await db.query(
        `UPDATE org.students SET resume_url = $1, resume_verified = false, updated_at = now() WHERE id = $2`,
        [resumeUrl, student.id]
      );
      await db.query(
        `UPDATE candidate.independent_candidates SET resume_url = $1, updated_at = now() WHERE user_id = $2`,
        [resumeUrl, student.userId]
      ).catch(() => {});

      const version = await saveResumeVersion(student.id, {
        objectKey: resumeUrl,
        fileName: req.file.originalname,
        text: parsed.text,
        data: parsed.data,
      });
      const current = await getCurrentResume(student.id);
      await syncResumeData(student.id, student.userId, current?.view ?? null);

      sendSuccess(res, { resumeUrl, fileName: req.file.originalname, version, resume: current?.view ?? null });
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── POST /api/students/:studentId/resume/text — pasted resume text ────────────

const resumeTextSchema = z.object({ text: z.string().trim().min(50).max(30_000) });

studentRouter.post(
  '/:studentId/resume/text',
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const student = await resolveResumeStudent(req);
      const body = resumeTextSchema.safeParse(req.body);
      if (!body.success) {
        throw new AppError(422, 'Paste at least 50 characters of your resume.', 'VALIDATION_ERROR');
      }
      const parsed = await parseResume({ fileName: 'Pasted resume', text: body.data.text });
      const version = await saveResumeVersion(student.id, {
        objectKey: null,
        fileName: 'Pasted resume',
        text: parsed.text,
        data: parsed.data,
      });
      const current = await getCurrentResume(student.id);
      await syncResumeData(student.id, student.userId, current?.view ?? null);
      sendSuccess(res, { version, resume: current?.view ?? null }, 201);
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── POST /api/students/parse-resume — read resume text without saving it ──────
studentRouter.post(
  '/parse-resume',
  authenticate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { resumeText, fileName } = req.body ?? {};
      if (!resumeText || typeof resumeText !== 'string') {
        throw new AppError(422, 'Resume text is required', 'VALIDATION_ERROR');
      }
      // No made-up fallback: when the reader is unavailable the caller gets an error
      const parsed = await parseResume({ fileName: fileName || 'Uploaded resume', text: resumeText });
      sendSuccess(res, {
        fileName: fileName || 'Uploaded resume',
        parsedAt: new Date().toISOString().split('T')[0],
        ...parsed.data,
      });
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── PATCH /api/students/:studentId/verify-resume (FACULTY_MENTOR) ─────────────

studentRouter.patch(
  '/:studentId/verify-resume',
  requireRole('FACULTY_MENTOR'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { studentId } = req.params;
      const mentorId = req.user!.id;

      // Confirm this mentor is actively assigned to this student
      const { rows: assignment } = await db.query(
        `SELECT id FROM org.student_mentor_assignments
         WHERE student_id = $1 AND mentor_id = $2 AND is_active = true`,
        [studentId, mentorId]
      );
      if (assignment.length === 0) {
        throw new AppError(403, 'You are not assigned to this student', 'FORBIDDEN');
      }

      await db.query(
        `UPDATE org.students SET resume_verified = true, updated_at = now() WHERE id = $1`,
        [studentId]
      );

      const payload = { studentId, mentorId, verifiedAt: new Date().toISOString() };
      eventBus.emit(Events.MENTOR_VERIFIED, payload);

      sendSuccess(res, { message: 'Resume verified' });
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── PUT/PATCH /api/students/:studentId/profile ───────────────────────────────
studentRouter.all(
  ['/:studentId/profile', '/:studentId/update'],
  authenticate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      if (req.method !== 'PUT' && req.method !== 'PATCH' && req.method !== 'POST') {
        throw new AppError(405, 'Method not allowed', 'METHOD_NOT_ALLOWED');
      }
      const studentId = paramStr(req.params.studentId);
      const b = req.body;

      const student = await fetchStudentProfile(studentId);
      if (!student) throw new AppError(404, 'Student not found', 'NOT_FOUND');

      const stuUpdates: string[] = [];
      const stuValues: any[] = [];
      let pIdx = 1;

      if (b.department !== undefined) {
        stuUpdates.push(`department = $${pIdx++}`);
        stuValues.push(b.department);
      }
      if (b.batchYear !== undefined) {
        stuUpdates.push(`batch_year = $${pIdx++}`);
        stuValues.push(b.batchYear);
      }
      if (b.className !== undefined) {
        stuUpdates.push(`class_name = $${pIdx++}`);
        stuValues.push(b.className);
      }
      if (b.track !== undefined) {
        stuUpdates.push(`track = $${pIdx++}`);
        stuValues.push(b.track);
      }
      if (b.programName !== undefined) {
        stuUpdates.push(`program_name = $${pIdx++}`);
        stuValues.push(b.programName);
      }
      if (b.subProgramName !== undefined) {
        stuUpdates.push(`sub_program_name = $${pIdx++}`);
        stuValues.push(b.subProgramName);
      }
      if (b.mentorName !== undefined) {
        stuUpdates.push(`mentor_name = $${pIdx++}`);
        stuValues.push(b.mentorName);
      }
      if (b.mentorEmail !== undefined) {
        stuUpdates.push(`mentor_email = $${pIdx++}`);
        stuValues.push(b.mentorEmail);
      }
      if (b.codingHandles !== undefined) {
        stuUpdates.push(`coding_handles = $${pIdx++}`);
        stuValues.push(JSON.stringify(b.codingHandles));
      }
      if (b.resume !== undefined) {
        stuUpdates.push(`resume_data = $${pIdx++}`);
        stuValues.push(JSON.stringify(b.resume));
      }
      if (b.criteriaTasks !== undefined) {
        stuUpdates.push(`criteria_tasks = $${pIdx++}`);
        stuValues.push(JSON.stringify(b.criteriaTasks));
      }
      if (b.improvementChecklist !== undefined) {
        stuUpdates.push(`improvement_checklist = $${pIdx++}`);
        stuValues.push(JSON.stringify(b.improvementChecklist));
      }
      if (b.recentReports !== undefined) {
        stuUpdates.push(`recent_reports = $${pIdx++}`);
        stuValues.push(JSON.stringify(b.recentReports));
      }
      if (b.overallReadiness !== undefined || b.score !== undefined) {
        stuUpdates.push(`overall_readiness = $${pIdx++}`);
        stuValues.push(b.overallReadiness ?? b.score);
      }
      if (b.coins !== undefined) {
        stuUpdates.push(`coins = $${pIdx++}`);
        stuValues.push(b.coins);
      }
      if (b.rollNumber !== undefined) {
        stuUpdates.push(`roll_number = $${pIdx++}`);
        stuValues.push(b.rollNumber.toUpperCase());
      }

      if (stuUpdates.length > 0) {
        stuUpdates.push(`updated_at = now()`);
        stuValues.push(student.id);
        await db.query(
          `UPDATE org.students SET ${stuUpdates.join(', ')} WHERE id = $${pIdx}`,
          stuValues
        );
      }

      // Update user's name if given
      if (b.name) {
        await db.query(`UPDATE identity.users SET name = $1, updated_at = now() WHERE id = $2`, [b.name.trim(), student.userId]);
      }

      const updated = await fetchStudentProfile(student.id);
      sendSuccess(res, { student: updated, profile: updated });
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── POST /api/students/:studentId/coding-handles ──────────────────────────────
studentRouter.post(
  '/:studentId/coding-handles',
  authenticate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const studentId = paramStr(req.params.studentId);
      const handles = req.body;
      const student = await fetchStudentProfile(studentId);
      if (!student) throw new AppError(404, 'Student not found', 'NOT_FOUND');

      const merged = {
        ...(student.codingHandles || {}),
        ...handles
      };

      await db.query(
        `UPDATE org.students SET coding_handles = $1, updated_at = now() WHERE id = $2`,
        [JSON.stringify(merged), student.id]
      );

      sendSuccess(res, { codingHandles: merged });
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── POST /api/students/:studentId/resume-data ────────────────────────────────
studentRouter.post(
  '/:studentId/resume-data',
  authenticate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const parsedResume = req.body;
      if (!parsedResume || typeof parsedResume !== 'object' || Array.isArray(parsedResume)) {
        throw new AppError(422, 'Resume details required', 'VALIDATION_ERROR');
      }
      const student = await resolveResumeStudent(req);

      // Edited resume details become a new version; the text read from the file is kept
      const previous = await getCurrentResume(student.id);
      await saveResumeVersion(student.id, {
        objectKey: null,
        fileName: String(parsedResume.fileName || parsedResume.file_name || previous?.view.fileName || 'Resume'),
        text: previous?.text ?? '',
        data: parsedResume as ParsedResumeData,
      });
      const current = await getCurrentResume(student.id);
      await syncResumeData(student.id, student.userId, current?.view ?? parsedResume);

      sendSuccess(res, { resume: current?.view ?? parsedResume });
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── POST /api/students/:studentId/tasks/toggle ───────────────────────────────
studentRouter.post(
  '/:studentId/tasks/toggle',
  authenticate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const studentId = paramStr(req.params.studentId);
      const { taskId } = req.body;
      const student = await fetchStudentProfile(studentId);
      if (!student) throw new AppError(404, 'Student not found', 'NOT_FOUND');

      let tasks = Array.isArray(student.criteriaTasks) ? [...student.criteriaTasks] : [];
      let isCompleted = false;

      const tIdx = tasks.findIndex((t: any) => t.id === taskId);
      if (tIdx !== -1) {
        tasks[tIdx].isCompleted = !tasks[tIdx].isCompleted;
        isCompleted = tasks[tIdx].isCompleted;
      } else {
        tasks.push({
          id: taskId,
          title: 'Custom Task',
          description: '',
          targetTrack: 'General',
          isCompleted: true,
          verifiedByMentor: false
        });
        isCompleted = true;
      }

      await db.query(
        `UPDATE org.students SET criteria_tasks = $1, updated_at = now() WHERE id = $2`,
        [JSON.stringify(tasks), student.id]
      );

      sendSuccess(res, { isCompleted, tasks });
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── POST /api/students/:studentId/tasks/verify ───────────────────────────────
studentRouter.post(
  '/:studentId/tasks/verify',
  authenticate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const studentId = paramStr(req.params.studentId);
      const { taskId } = req.body;
      const student = await fetchStudentProfile(studentId);
      if (!student) throw new AppError(404, 'Student not found', 'NOT_FOUND');

      let tasks = Array.isArray(student.criteriaTasks) ? [...student.criteriaTasks] : [];
      const tIdx = tasks.findIndex((t: any) => t.id === taskId);
      if (tIdx !== -1) {
        tasks[tIdx].verifiedByMentor = true;
        tasks[tIdx].verifiedAt = new Date().toISOString().split('T')[0];
      }

      await db.query(
        `UPDATE org.students SET criteria_tasks = $1, updated_at = now() WHERE id = $2`,
        [JSON.stringify(tasks), student.id]
      );

      sendSuccess(res, { success: true, tasks });
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── POST /api/students/:studentId/reports ────────────────────────────────────
studentRouter.post(
  '/:studentId/reports',
  authenticate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const studentId = paramStr(req.params.studentId);
      const report = req.body;
      const student = await fetchStudentProfile(studentId);
      if (!student) throw new AppError(404, 'Student not found', 'NOT_FOUND');

      let reports = Array.isArray(student.recentReports) ? [report, ...student.recentReports] : [report];
      const newScore = report.overallScore || student.score || 75;

      await db.query(
        `UPDATE org.students
         SET recent_reports = $1, overall_readiness = $2, updated_at = now()
         WHERE id = $3`,
        [JSON.stringify(reports), newScore, student.id]
      );

      sendSuccess(res, { report, score: newScore });
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── GET /api/students/leetcode/:username ─────────────────────────────────────
studentRouter.get(
  '/leetcode/:username',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const username = paramStr(req.params.username).trim();
      if (!username) {
        throw new AppError(400, 'LeetCode username is required', 'BAD_REQUEST');
      }

      const graphqlQuery = {
        query: `
          query userProblemsSolved($username: String!) {
            allQuestionsCount {
              difficulty
              count
            }
            matchedUser(username: $username) {
              username
              submitStatsGlobal {
                acSubmissionNum {
                  difficulty
                  count
                }
              }
            }
          }
        `,
        variables: { username }
      };

      const response = await axios.post('https://leetcode.com/graphql', graphqlQuery, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://leetcode.com',
        },
        timeout: 10000,
      });

      const matched = response.data?.data?.matchedUser;
      if (!matched) {
        throw new AppError(404, `LeetCode profile "${username}" not found or is private.`, 'USER_NOT_FOUND');
      }

      const stats = matched.submitStatsGlobal?.acSubmissionNum || [];
      const totalSolved = stats.find((s: any) => s.difficulty === 'All')?.count || 0;
      const easySolved = stats.find((s: any) => s.difficulty === 'Easy')?.count || 0;
      const mediumSolved = stats.find((s: any) => s.difficulty === 'Medium')?.count || 0;
      const hardSolved = stats.find((s: any) => s.difficulty === 'Hard')?.count || 0;

      sendSuccess(res, {
        username: matched.username,
        totalSolved,
        easySolved,
        mediumSolved,
        hardSolved
      });
    } catch (err: any) {
      if (err.response?.status === 404 || err.code === 'USER_NOT_FOUND') {
        sendError(res, new AppError(404, `LeetCode profile not found`, 'NOT_FOUND'));
      } else {
        sendError(res, err);
      }
    }
  }
);

// ── PATCH /api/students/:studentId/credits ───────────────────────────────────
studentRouter.patch(
  '/:studentId/credits',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const studentId = paramStr(req.params.studentId);
      const { coins, action } = req.body;

      const { rows: studentRows } = await db.query(
        `SELECT id, user_id, coins FROM org.students WHERE id = $1`,
        [studentId]
      );
      if (studentRows.length === 0) {
        throw new AppError(404, 'Student not found', 'NOT_FOUND');
      }
      const student = studentRows[0];

      let nextCoins = typeof coins === 'number' ? Math.max(0, coins) : (student.coins ?? 5);
      if (action === 'CONSUME') {
        nextCoins = Math.max(0, (student.coins ?? 5) - 1);
      } else if (action === 'RESTORE') {
        nextCoins = 5;
      }

      // 1. Update org.students
      await db.query(
        `UPDATE org.students SET coins = $1, updated_at = now() WHERE id = $2`,
        [nextCoins, studentId]
      );

      // 2. Update candidate.independent_candidates if present
      await db.query(
        `UPDATE candidate.independent_candidates 
         SET credits = $1, 
             zero_credits_at = (CASE WHEN $1 = 0 THEN now() ELSE NULL END),
             updated_at = now() 
         WHERE user_id = $2`,
        [nextCoins, student.user_id]
      ).catch(() => {});

      // 3. Update credit.credit_accounts (1 coin = 10 credits)
      await db.query(
        `INSERT INTO credit.credit_accounts (student_id, balance)
         VALUES ($1, $2)
         ON CONFLICT (student_id) DO UPDATE SET balance = EXCLUDED.balance, updated_at = now()`,
        [studentId, nextCoins * 10]
      ).catch(() => {});

      sendSuccess(res, {
        studentId,
        coins: nextCoins,
        message: 'Credit balance updated and persisted in database'
      });
    } catch (err) {
      sendError(res, err);
    }
  }
);


