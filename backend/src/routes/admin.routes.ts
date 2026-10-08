import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../shared/db/pool';
import { AppError } from '../shared/errors/AppError';
import { sendSuccess, sendError } from '../shared/helpers/response';
import { AuthRequest } from '../middleware/authenticate';
import { requireRole } from '../middleware/authorize';

export const adminRouter = Router();

const VALID_STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED'] as const;

// ── GET /api/admin/users (PROGRAM_ADMIN) ──────────────────────────────────────

adminRouter.get(
  '/users',
  requireRole('PROGRAM_ADMIN'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const roleFilter = (req.query.role as string) ?? null;
      const statusFilter = (req.query.status as string) ?? null;
      const searchFilter = (req.query.search as string) ?? null;

      const { rows } = await db.query(
        `SELECT id, name, email, role, status, created_at
         FROM identity.users
         WHERE ($1::text IS NULL OR role::text = $1)
           AND ($2::text IS NULL OR status::text = $2)
           AND ($3::text IS NULL OR name ILIKE '%' || $3 || '%' OR email ILIKE '%' || $3 || '%')
         ORDER BY created_at DESC
         LIMIT 100`,
        [roleFilter, statusFilter, searchFilter]
      );
      sendSuccess(res, { users: rows });
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── PATCH /api/admin/users/:userId/role (PROGRAM_ADMIN) ───────────────────────

const roleSchema = z.object({
  role: z.enum(['STUDENT', 'FACULTY_MENTOR', 'PROGRAM_ADMIN', 'TRAINER', 'PLACEMENT_COORDINATOR']),
});

adminRouter.patch(
  '/users/:userId/role',
  requireRole('PROGRAM_ADMIN'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { userId } = req.params;
      const parsed = roleSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError(422, 'Invalid role value', 'VALIDATION_ERROR');

      // Prevent any PROGRAM_ADMIN from granting PROGRAM_ADMIN to another user.
      // Full cross-institution scoping is a post-MVP item; this guard prevents the most
      // dangerous privilege-escalation path (creating peer admins without oversight).
      if (parsed.data.role === 'PROGRAM_ADMIN') {
        throw new AppError(403, 'Cannot grant PROGRAM_ADMIN role via this endpoint', 'FORBIDDEN');
      }

      const { rows } = await db.query(
        `UPDATE identity.users
         SET role = $1, token_version = token_version + 1, updated_at = now()
         WHERE id = $2
         RETURNING id, name, email, role`,
        [parsed.data.role, userId]
      );
      if (rows.length === 0) throw new AppError(404, 'User not found', 'NOT_FOUND');

      sendSuccess(res, { user: rows[0] });
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── PATCH /api/admin/users/:userId/status (PROGRAM_ADMIN) ─────────────────────

const statusSchema = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']),
});

adminRouter.patch(
  '/users/:userId/status',
  requireRole('PROGRAM_ADMIN'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { userId } = req.params;
      const parsed = statusSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError(422, 'Invalid status value', 'VALIDATION_ERROR');

      const { rows } = await db.query(
        `UPDATE identity.users
         SET status = $1, updated_at = now()
         WHERE id = $2
         RETURNING id, name, email, status`,
        [parsed.data.status, userId]
      );
      if (rows.length === 0) throw new AppError(404, 'User not found', 'NOT_FOUND');

      sendSuccess(res, { user: rows[0] });
    } catch (err) {
      sendError(res, err);
    }
  }
);

// Roles allowed to manage assignments and students
const requireAdminOrStaff = requireRole(
  'SUPER_ADMIN',
  'PLATFORM_OWNER',
  'PROGRAM_ADMIN',
  'DEPARTMENT_ADMIN',
  'FACULTY_MENTOR',
  'COUNSELLOR',
  'PLACEMENT_COORDINATOR'
);

// ── GET /api/admin/assignments ───────────────────────────────────────────────
adminRouter.get(
  '/assignments',
  requireRole(
    'SUPER_ADMIN',
    'PLATFORM_OWNER',
    'PROGRAM_ADMIN',
    'DEPARTMENT_ADMIN',
    'FACULTY_MENTOR',
    'COUNSELLOR',
    'PLACEMENT_COORDINATOR',
    'TRAINER',
    'STUDENT'
  ),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const authUser = (req as AuthRequest).user;
      const collegeId = (req.query.collegeId as string) || authUser?.institutionId || null;
      let query = `
        SELECT
          id,
          title,
          session_type AS "sessionType",
          assigned_by_role AS "assignedByRole",
          assigned_by_name AS "assignedByName",
          assigned_by_email AS "assignedByEmail",
          assigned_by_id AS "assignedById",
          institution_id AS "collegeId",
          target_scope AS "targetScope",
          target_domain_or_track AS "targetDomainOrTrack",
          target_program_name AS "targetProgramName",
          COALESCE(target_program_names, '[]'::jsonb) AS "targetProgramNames",
          target_sub_program AS "targetSubProgram",
          target_department AS "targetDepartment",
          COALESCE(target_departments, '[]'::jsonb) AS "targetDepartments",
          target_student_id AS "targetStudentId",
          target_student_name AS "targetStudentName",
          target_class_name AS "targetClassName",
          COALESCE(target_class_names, '[]'::jsonb) AS "targetClassNames",
          interview_mode AS "interviewMode",
          domain_or_topic AS "domainOrTopic",
          difficulty,
          listening_passage_id AS "listeningPassageId",
          custom_instructions AS "customInstructions",
          due_date AS "dueDate",
          start_time AS "startTime",
          end_time AS "endTime",
          has_time_window AS "hasTimeWindow",
          is_mandatory AS "isMandatory",
          COALESCE(submissions, '[]'::jsonb) AS submissions,
          created_at AS "createdAt"
        FROM org.interview_assignments
      `;
      const params: any[] = [];
      if (collegeId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(collegeId)) {
        params.push(collegeId);
        query += ` WHERE (institution_id = $1 OR institution_id IS NULL)`;
      }
      query += ` ORDER BY created_at DESC`;

      const { rows } = await db.query(query, params);
      sendSuccess(res, rows);
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── POST /api/admin/assignments ──────────────────────────────────────────────
adminRouter.post(
  '/assignments',
  requireAdminOrStaff,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const b = req.body;
      const { rows: instRows } = await db.query(`SELECT id FROM org.institutions ORDER BY created_at DESC LIMIT 1`);
      const defaultInstId = instRows[0]?.id || null;
      const instId = (b.collegeId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(b.collegeId))
        ? b.collegeId
        : defaultInstId;

      // Duplicate assessment title validation
      const testTitle = (b.title || '').trim();
      if (!testTitle) {
        throw new AppError(422, 'Assessment title is required', 'VALIDATION_ERROR');
      }
      const { rows: dupRows } = await db.query(
        `SELECT id, title FROM org.interview_assignments
         WHERE LOWER(TRIM(title)) = LOWER(TRIM($1))
           AND (institution_id = $2 OR (institution_id IS NULL AND $2 IS NULL))
         LIMIT 1`,
        [testTitle, instId]
      );
      if (dupRows.length > 0) {
        throw new AppError(
          409,
          `An assessment named "${testTitle}" already exists. Please rename the test to a unique title.`,
          'DUPLICATE_TITLE'
        );
      }

      const { rows } = await db.query(
        `INSERT INTO org.interview_assignments (
          institution_id,
          title,
          session_type,
          assigned_by_role,
          assigned_by_name,
          assigned_by_email,
          assigned_by_id,
          target_scope,
          target_domain_or_track,
          target_program_name,
          target_program_names,
          target_sub_program,
          target_department,
          target_departments,
          target_student_id,
          target_student_name,
          target_class_name,
          target_class_names,
          interview_mode,
          domain_or_topic,
          difficulty,
          listening_passage_id,
          custom_instructions,
          due_date,
          start_time,
          end_time,
          has_time_window,
          is_mandatory,
          submissions
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
          $21, $22, $23, $24, $25, $26, $27, $28, $29
        )
        RETURNING
          id,
          title,
          session_type AS "sessionType",
          assigned_by_role AS "assignedByRole",
          assigned_by_name AS "assignedByName",
          assigned_by_email AS "assignedByEmail",
          assigned_by_id AS "assignedById",
          institution_id AS "collegeId",
          target_scope AS "targetScope",
          target_domain_or_track AS "targetDomainOrTrack",
          target_program_name AS "targetProgramName",
          COALESCE(target_program_names, '[]'::jsonb) AS "targetProgramNames",
          target_sub_program AS "targetSubProgram",
          target_department AS "targetDepartment",
          COALESCE(target_departments, '[]'::jsonb) AS "targetDepartments",
          target_student_id AS "targetStudentId",
          target_student_name AS "targetStudentName",
          target_class_name AS "targetClassName",
          COALESCE(target_class_names, '[]'::jsonb) AS "targetClassNames",
          interview_mode AS "interviewMode",
          domain_or_topic AS "domainOrTopic",
          difficulty,
          listening_passage_id AS "listeningPassageId",
          custom_instructions AS "customInstructions",
          due_date AS "dueDate",
          start_time AS "startTime",
          end_time AS "endTime",
          has_time_window AS "hasTimeWindow",
          is_mandatory AS "isMandatory",
          COALESCE(submissions, '[]'::jsonb) AS submissions,
          created_at AS "createdAt"`,
        [
          instId,
          b.title || 'Practice Drill',
          b.sessionType || 'MOCK_INTERVIEW',
          b.assignedByRole || 'SUPER_ADMIN',
          b.assignedByName || 'Placement Cell',
          b.assignedByEmail || null,
          b.assignedById || null,
          b.targetScope || 'ALL_STUDENTS',
          b.targetDomainOrTrack || 'All Batches',
          b.targetProgramName || null,
          JSON.stringify(b.targetProgramNames || []),
          b.targetSubProgram || null,
          b.targetDepartment || null,
          JSON.stringify(b.targetDepartments || []),
          b.targetStudentId || null,
          b.targetStudentName || null,
          b.targetClassName || null,
          JSON.stringify(b.targetClassNames || []),
          b.interviewMode || 'TOPIC',
          b.domainOrTopic || 'General Technical Architecture',
          b.difficulty || 'MEDIUM',
          b.listeningPassageId || null,
          b.customInstructions || null,
          b.dueDate || new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
          b.startTime || null,
          b.endTime || null,
          Boolean(b.startTime && b.endTime),
          b.isMandatory !== false,
          JSON.stringify(b.submissions || [])
        ]
      );

      sendSuccess(res, rows[0], 201);
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── POST /api/admin/assignments/:id/submit ───────────────────────────────────
adminRouter.post(
  '/assignments/:id/submit',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const submission = req.body;

      const { rows } = await db.query(
        `SELECT submissions FROM org.interview_assignments WHERE id = $1`,
        [id]
      );
      if (rows.length === 0) throw new AppError(404, 'Assignment not found', 'NOT_FOUND');

      let subs = rows[0].submissions || [];
      if (!Array.isArray(subs)) subs = [];

      const subIdx = subs.findIndex((s: any) => s.studentId === submission.studentId);
      if (subIdx !== -1) {
        subs[subIdx] = submission;
      } else {
        subs.push(submission);
      }

      const { rows: updated } = await db.query(
        `UPDATE org.interview_assignments
         SET submissions = $1, updated_at = now()
         WHERE id = $2
         RETURNING
           id,
           title,
           session_type AS "sessionType",
           institution_id AS "collegeId",
           COALESCE(submissions, '[]'::jsonb) AS submissions`,
        [JSON.stringify(subs), id]
      );

      sendSuccess(res, { success: true, assignment: updated[0] });
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── DELETE /api/admin/assignments/:id ────────────────────────────────────────
adminRouter.delete(
  '/assignments/:id',
  requireAdminOrStaff,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      await db.query(`DELETE FROM org.interview_assignments WHERE id = $1`, [id]);
      sendSuccess(res, { success: true });
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── GET /api/admin/trainers ──────────────────────────────────────────────────
adminRouter.get(
  '/trainers',
  requireAdminOrStaff,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { rows } = await db.query(
        `SELECT
          id,
          trainer_name AS "trainerName",
          trainer_email AS "trainerEmail",
          company_or_institute AS "companyOrInstitute",
          domain,
          program_id AS "programId",
          is_common_trainer AS "isCommonTrainer",
          COALESCE(associated_program_names, '[]'::jsonb) AS "associatedProgramNames",
          start_date AS "startDate",
          end_date AS "endDate",
          is_active AS "isActive",
          created_at AS "createdAt"
        FROM org.trainer_tenures
        ORDER BY created_at DESC`
      );
      sendSuccess(res, rows);
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── POST /api/admin/trainers ─────────────────────────────────────────────────
adminRouter.post(
  '/trainers',
  requireAdminOrStaff,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const t = req.body;
      const { rows: instRows } = await db.query(`SELECT id FROM org.institutions ORDER BY created_at DESC LIMIT 1`);
      const instId = instRows[0]?.id || null;

      const { rows } = await db.query(
        `INSERT INTO org.trainer_tenures (
          institution_id,
          trainer_name,
          trainer_email,
          company_or_institute,
          domain,
          is_common_trainer,
          associated_program_names,
          start_date,
          end_date,
          is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
        RETURNING
          id,
          trainer_name AS "trainerName",
          trainer_email AS "trainerEmail",
          company_or_institute AS "companyOrInstitute",
          domain,
          is_common_trainer AS "isCommonTrainer",
          COALESCE(associated_program_names, '[]'::jsonb) AS "associatedProgramNames",
          start_date AS "startDate",
          end_date AS "endDate",
          is_active AS "isActive",
          created_at AS "createdAt"`,
        [
          instId,
          t.trainerName || '',
          t.trainerEmail || '',
          t.companyOrInstitute || '',
          t.domain || '',
          Boolean(t.isCommonTrainer),
          JSON.stringify(t.associatedProgramNames || []),
          t.startDate || new Date().toISOString().split('T')[0],
          t.endDate || new Date(Date.now() + 180 * 86400000).toISOString().split('T')[0]
        ]
      );
      sendSuccess(res, rows[0], 201);
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── PATCH /api/admin/trainers/:id/revoke ─────────────────────────────────────
adminRouter.patch(
  '/trainers/:id/revoke',
  requireAdminOrStaff,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      await db.query(`UPDATE org.trainer_tenures SET is_active = false WHERE id = $1`, [id]);
      sendSuccess(res, { success: true });
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── GET /api/admin/students ──────────────────────────────────────────────────
adminRouter.get(
  '/students',
  requireAdminOrStaff,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const authUser = (req as AuthRequest).user;
      const search = (req.query.search as string) || '';
      const collegeId = (req.query.collegeId as string) || authUser?.institutionId || null;
      let query = `
        SELECT
          s.id,
          s.user_id AS "userId",
          u.name,
          u.email,
          s.roll_number AS "rollNumber",
          COALESCE(s.department, 'General Department') AS department,
          COALESCE(s.batch_year, 2026) AS "batchYear",
          COALESCE(s.class_name, '') AS "className",
          COALESCE(s.track, 'General Track') AS track,
          s.program_name AS "programName",
          s.sub_program_name AS "subProgramName",
          s.mentor_name AS "mentorName",
          s.mentor_email AS "mentorEmail",
          COALESCE(s.coding_handles, '{}'::jsonb) AS "codingHandles",
          s.resume_data AS resume,
          COALESCE(s.criteria_tasks, '[]'::jsonb) AS "criteriaTasks",
          COALESCE(s.improvement_checklist, '[]'::jsonb) AS "improvementChecklist",
          COALESCE(s.recent_reports, '[]'::jsonb) AS "recentReports",
          COALESCE(s.overall_readiness, 75) AS score,
          COALESCE(s.overall_readiness, 75) AS "overallReadiness",
          COALESCE(s.coins, 5) AS coins,
          CASE
            WHEN COALESCE(s.overall_readiness, 0) >= 80 THEN 'PLACEMENT_READY'
            WHEN COALESCE(s.overall_readiness, 0) >= 65 THEN 'ON_TRACK'
            ELSE 'NEEDS_ATTENTION'
          END AS status,
          s.created_at AS "createdAt",
          COALESCE(u.institution_id, p.institution_id, pb.institution_id) AS "collegeId"
        FROM org.students s
        JOIN identity.users u ON u.id = s.user_id
        LEFT JOIN org.programs p ON p.id = s.program_id
        LEFT JOIN org.batches b ON b.id = s.batch_id
        LEFT JOIN org.programs pb ON pb.id = b.program_id
        WHERE ($1::uuid IS NULL OR COALESCE(u.institution_id, p.institution_id, pb.institution_id) = $1::uuid)
      `;
      const params: any[] = [collegeId];
      if (search) {
        params.push(search);
        query += ` AND (u.name ILIKE '%' || $2 || '%' OR u.email ILIKE '%' || $2 || '%' OR s.roll_number ILIKE '%' || $2 || '%')`;
      }
      query += ` ORDER BY s.created_at DESC`;

      const { rows } = await db.query(query, params);
      sendSuccess(res, rows);
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── GET /api/admin/mentees ───────────────────────────────────────────────────
adminRouter.get(
  '/mentees',
  requireAdminOrStaff,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { rows } = await db.query(
        `SELECT
          s.id,
          s.user_id AS "userId",
          u.name,
          u.email,
          s.roll_number AS "rollNumber",
          COALESCE(s.department, 'General Department') AS department,
          COALESCE(s.batch_year, 2026) AS "batchYear",
          COALESCE(s.track, 'General Track') AS track,
          s.program_name AS "programName",
          s.mentor_name AS "mentorName",
          s.mentor_email AS "mentorEmail",
          COALESCE(s.coding_handles, '{}'::jsonb) AS "codingHandles",
          s.resume_data AS resume,
          COALESCE(s.criteria_tasks, '[]'::jsonb) AS "criteriaTasks",
          COALESCE(s.recent_reports, '[]'::jsonb) AS "recentReports",
          COALESCE(s.overall_readiness, 75) AS score,
          COALESCE(s.coins, 5) AS coins
        FROM org.students s
        JOIN identity.users u ON u.id = s.user_id
        ORDER BY s.created_at DESC`
      );
      sendSuccess(res, rows);
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── GET /api/admin/stats/coordinator ─────────────────────────────────────────
adminRouter.get(
  '/stats/coordinator',
  requireAdminOrStaff,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const { rows: studentRows } = await db.query(
        `SELECT
          COUNT(*) AS total_candidates,
          COUNT(*) FILTER (WHERE COALESCE(overall_readiness, 0) >= 75) AS ready_count
         FROM org.students`
      );
      const { rows: progRows } = await db.query(`SELECT COUNT(*) AS total_programs FROM org.programs`);

      const totalCandidates = parseInt(studentRows[0]?.total_candidates || '0', 10);
      const readyCount = parseInt(studentRows[0]?.ready_count || '0', 10);
      const activeProgramsCount = parseInt(progRows[0]?.total_programs || '0', 10);
      const placementReadyRate = totalCandidates > 0 ? Math.round((readyCount / totalCandidates) * 100) : 0;

      sendSuccess(res, {
        totalCandidates,
        activeProgramsCount,
        placementReadyRate,
        readyCount
      });
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── GET /api/admin/stats/system ──────────────────────────────────────────────
adminRouter.get(
  '/stats/system',
  requireAdminOrStaff,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const { rows: userCounts } = await db.query(
        `SELECT
          COUNT(*) FILTER (WHERE role = 'PROGRAM_ADMIN') AS pa_count,
          COUNT(*) FILTER (WHERE role = 'FACULTY_MENTOR') AS fm_count,
          COUNT(*) FILTER (WHERE role = 'STUDENT') AS student_count
         FROM identity.users`
      );
      const { rows: trainerCount } = await db.query(
        `SELECT COUNT(*) AS t_count FROM org.trainer_tenures WHERE is_active = true`
      );

      sendSuccess(res, {
        programAdminsCount: parseInt(userCounts[0]?.pa_count || '0', 10),
        facultyMentorsCount: parseInt(userCounts[0]?.fm_count || '0', 10),
        trainersCount: parseInt(trainerCount[0]?.t_count || '0', 10),
        studentsCount: parseInt(userCounts[0]?.student_count || '0', 10)
      });
    } catch (err) {
      sendError(res, err);
    }
  }
);

