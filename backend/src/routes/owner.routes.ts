import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../shared/db/pool';
import { AppError } from '../shared/errors/AppError';
import { sendSuccess, sendError } from '../shared/helpers/response';
import { AuthRequest } from '../middleware/authenticate';
import { requireRole } from '../middleware/authorize';
import { sendInviteEmail } from '../services/emailService';

export const ownerRouter = Router();

// Platform owner or Super Admin role
ownerRouter.use(requireRole('PLATFORM_OWNER', 'SUPER_ADMIN'));

// ── GET /api/owner/colleges ──────────────────────────────────────────────────
ownerRouter.get('/colleges', async (_req: Request, res: Response): Promise<void> => {
  try {
    const { rows } = await db.query(`
      SELECT
        i.id,
        i.name,
        i.code,
        i.type AS campus_city,
        i.created_at,
        COALESCE(u_admin.email, sa.email, inv.email) AS super_admin_email,
        COALESCE(u_admin.name, sa.name, inv.name) AS super_admin_name,
        CASE
          WHEN u_admin.id IS NOT NULL AND u_admin.status = 'ACTIVE' THEN 'ACTIVE'
          WHEN sa.id IS NOT NULL AND sa.status = 'ACTIVE' THEN 'ACTIVE'
          WHEN inv.id IS NOT NULL AND inv.status = 'PENDING' THEN 'PENDING_INVITE'
          ELSE 'NO_ADMIN'
        END AS super_admin_status
      FROM org.institutions i
      LEFT JOIN LATERAL (
        SELECT u.id, u.email, u.name, u.status
        FROM identity.users u
        LEFT JOIN identity.role_assignments ra ON ra.user_id = u.id
        WHERE (u.institution_id = i.id OR ra.institution_id = i.id)
          AND u.role = 'SUPER_ADMIN'
        ORDER BY u.created_at DESC
        LIMIT 1
      ) u_admin ON true
      LEFT JOIN LATERAL (
        SELECT inv_a.email, u.name, u.id, u.status
        FROM identity.pending_invites inv_a
        JOIN identity.users u ON LOWER(u.email) = LOWER(inv_a.email)
        WHERE inv_a.institution_id = i.id
          AND inv_a.role = 'SUPER_ADMIN'
          AND inv_a.status = 'ACCEPTED'
        ORDER BY inv_a.created_at DESC
        LIMIT 1
      ) sa ON true
      LEFT JOIN LATERAL (
        SELECT inv_p.id, inv_p.email, inv_p.name, inv_p.status
        FROM identity.pending_invites inv_p
        WHERE inv_p.institution_id = i.id
          AND inv_p.role = 'SUPER_ADMIN'
          AND inv_p.status = 'PENDING'
        ORDER BY inv_p.created_at DESC
        LIMIT 1
      ) inv ON true
      ORDER BY i.created_at DESC
    `);
    sendSuccess(res, rows);
  } catch (err) {
    sendError(res, err);
  }
});

// ── POST /api/owner/colleges ─────────────────────────────────────────────────
const createCollegeSchema = z.object({
  name: z.string().min(3).max(255),
  code: z.string().min(2).max(20).transform(s => s.toUpperCase()),
  campusCity: z.string().min(2).max(255),
});

ownerRouter.post('/colleges', async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = createCollegeSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(422, 'Validation failed', 'VALIDATION_ERROR');
    }

    const { name, code, campusCity } = parsed.data;

    // Check for duplicates
    const { rows: existing } = await db.query(
      `SELECT id FROM org.institutions WHERE UPPER(code) = $1 OR LOWER(name) = LOWER($2)`,
      [code, name]
    );
    if (existing.length > 0) {
      throw new AppError(409, 'Institution with this name or code already exists', 'DUPLICATE');
    }

    const { rows } = await db.query(
      `INSERT INTO org.institutions (name, code, type, is_active)
       VALUES ($1, $2, $3, true)
       RETURNING id, name, code, type AS campus_city, created_at`,
      [name, code, campusCity]
    );

    const inst = rows[0];

    sendSuccess(res, inst, 201);
  } catch (err) {
    sendError(res, err);
  }
});

// ── POST /api/owner/colleges/:collegeId/invite-super-admin ──────────────────
const inviteSuperAdminSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(255),
  lastName: z.string().trim().max(255).nullish().transform(s => s || ''),
  email: z.string().trim().email('Valid email address is required').transform(s => s.toLowerCase()),
});

ownerRouter.post(
  ['/colleges/:collegeId/invite-super-admin', '/colleges/:collegeId/super-admin/invite'],
  async (req: Request, res: Response): Promise<void> => {
    try {
      const collegeId = Array.isArray(req.params.collegeId) ? req.params.collegeId[0] : (req.params.collegeId || '');
      const parsed = inviteSuperAdminSchema.safeParse(req.body);
      if (!parsed.success) {
        const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
        throw new AppError(422, `Validation failed: ${issues}`, 'VALIDATION_ERROR');
      }

      const { firstName, lastName, email } = parsed.data;
      const fullName = `${firstName} ${lastName}`.trim();

      // Verify institution exists (robust against local IDs like col-1)
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(collegeId);
      let activeInst: { id: string; name: string } | undefined;
      if (isUuid) {
        const { rows: institutions } = await db.query(
          `SELECT id, name FROM org.institutions WHERE id = $1`,
          [collegeId]
        );
        if (institutions.length > 0) activeInst = institutions[0];
      }
      if (!activeInst) {
        const { rows: existing } = await db.query(`SELECT id, name FROM org.institutions LIMIT 1`);
        if (existing.length > 0) {
          activeInst = existing[0];
        } else {
          const { rows: created } = await db.query(
            `INSERT INTO org.institutions (name, code, type, is_active)
             VALUES ('Main Institution', 'INST01', 'COLLEGE', true)
             RETURNING id, name`
          );
          activeInst = created[0];
        }
      }
      const institution = activeInst!;

      // Check if email already registered as user
      const { rows: users } = await db.query(
        `SELECT id, role, institution_id FROM identity.users WHERE LOWER(email) = $1`,
        [email]
      );
      if (users.length > 0 && users[0].role === 'PLATFORM_OWNER') {
        throw new AppError(400, 'Cannot invite Platform Owner as college admin', 'INVALID_OPERATION');
      }

      // Purge previous pending invites for this institution so the old admin's email is NOT stored
      // User requirement: "if any one is reinvited the previous admins mail id should not be stored"
      await db.query(`DELETE FROM identity.pending_invites WHERE institution_id = $1`, [institution.id]);
      await db.query(`DELETE FROM identity.pending_invites WHERE LOWER(email) = $1`, [email]);

      // If this institution had a prior super admin user (excluding Danish Platform Owner),
      // purge the superseded admin user and role assignments so the previous admin's email is not stored in the database!
      const { rows: prevAdmins } = await db.query(
        `SELECT id, email FROM identity.users 
         WHERE (institution_id = $1 OR id IN (SELECT user_id FROM identity.role_assignments WHERE institution_id = $1))
           AND role = 'SUPER_ADMIN'
           AND LOWER(email) != 'danishbasha18@gmail.com'
           AND LOWER(email) != $2`,
        [institution.id, email]
      );
      for (const prev of prevAdmins) {
        try {
          await db.query(`UPDATE system.audit_logs SET actor_user_id = NULL WHERE actor_user_id = $1`, [prev.id]).catch(() => {});
          await db.query(`UPDATE agent.agent_runs SET triggered_by_user_id = NULL WHERE triggered_by_user_id = $1`, [prev.id]).catch(() => {});
          await db.query(`DELETE FROM org.student_mentor_assignments WHERE mentor_id = $1 OR assigned_by = $1`, [prev.id]).catch(() => {});
          await db.query(`DELETE FROM org.trainer_subdivision_assignments WHERE trainer_id = $1 OR assigned_by = $1`, [prev.id]).catch(() => {});
          await db.query(`DELETE FROM placement.mentor_verifications WHERE mentor_user_id = $1`, [prev.id]).catch(() => {});
          await db.query(`DELETE FROM identity.role_assignments WHERE user_id = $1`, [prev.id]).catch(() => {});
          await db.query(`DELETE FROM org.department_staff WHERE user_id = $1`, [prev.id]).catch(() => {});
          await db.query(
            `DELETE FROM identity.users WHERE id = $1 AND LOWER(email) != 'danishbasha18@gmail.com' AND role != 'PLATFORM_OWNER'`,
            [prev.id]
          ).catch(() => {});
        } catch (cleanupErr) {
          console.warn('[owner.routes] Non-fatal cleanup warning for superseded admin:', cleanupErr);
        }
      }

      // Create invitation token
      const token = `inv_sup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

      const { rows } = await db.query(
        `INSERT INTO identity.pending_invites
         (token, email, first_name, last_name, name, role, institution_id, institution_name,
          permissions, status, expires_at)
         VALUES ($1, $2, $3, $4, $5, 'SUPER_ADMIN', $6, $7, $8, 'PENDING', $9)
         RETURNING *`,
        [
          token,
          email,
          firstName,
          lastName,
          fullName,
          institution.id,
          institution.name,
          JSON.stringify(['CAN_VIEW_STUDENT_PROGRESS', 'CAN_ASSIGN_INTERVIEWS', 'CAN_ASSIGN_LISTENING', 'CAN_MANAGE_STUDENTS']),
          expiresAt,
        ]
      );

      const origin = req.headers.origin || (req.headers.referer ? new URL(req.headers.referer as string).origin : undefined);
      const reqHost = req.get('host');
      const reqProtocol = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
      const hostUrl = reqHost ? `${reqProtocol}://${reqHost}` : undefined;
      const baseUrl = (process.env.APP_URL && !process.env.APP_URL.includes('localhost')) 
        ? process.env.APP_URL 
        : (origin || hostUrl || 'https://52.66.240.211');
      const secureBaseUrl = baseUrl.replace(/^http:\/\/52\.66\.240\.211/i, 'https://52.66.240.211');
      const inviteUrl = `${secureBaseUrl.replace(/\/+$/, '')}/?page=activate&invite_token=${token}`;

      // Dispatch invite email asynchronously
      sendInviteEmail({
        to: email,
        name: fullName,
        role: 'SUPER_ADMIN',
        collegeName: institution.name,
        inviteUrl,
        invitedBy: (req as AuthRequest).user?.name || 'Platform Owner',
      }).catch((err) => console.error('[owner.routes] Failed to send super-admin invite email:', err));

      sendSuccess(res, { invite: rows[0], inviteUrl }, 201);
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── GET /api/owner/stats ─────────────────────────────────────────────────────
ownerRouter.get('/stats', async (_req: Request, res: Response): Promise<void> => {
  try {
    const { rows: stats } = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM org.institutions) AS total_colleges,
        (
          SELECT COUNT(DISTINCT i.id)
          FROM org.institutions i
          WHERE EXISTS (
            SELECT 1 FROM identity.users u
            LEFT JOIN identity.role_assignments ra ON ra.user_id = u.id
            WHERE (u.institution_id = i.id OR ra.institution_id = i.id)
              AND (u.role = 'SUPER_ADMIN' OR ra.role_id = '119e7528-6954-471b-8804-3a03ca035aa1')
              AND u.status = 'ACTIVE'
          ) OR EXISTS (
            SELECT 1 FROM identity.pending_invites inv
            WHERE inv.institution_id = i.id
              AND inv.role = 'SUPER_ADMIN'
              AND inv.status = 'ACCEPTED'
          )
        ) AS active_super_admins,
        (SELECT COUNT(*) FROM org.students) AS total_students,
        (SELECT COUNT(*) FROM org.programs) AS total_programs
    `);

    sendSuccess(res, stats[0]);
  } catch (err) {
    sendError(res, err);
  }
});

// ── GET /api/owner/colleges/:collegeId/metrics ───────────────────────────
ownerRouter.get('/colleges/:collegeId/metrics', async (req: Request, res: Response): Promise<void> => {
  try {
    const rawCollegeId = Array.isArray(req.params.collegeId) ? req.params.collegeId[0] : (req.params.collegeId || '');
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawCollegeId);
    let instRows: any[] = [];
    if (isUuid) {
      const { rows } = await db.query(
        `SELECT id, name, code, type AS campus_city, created_at FROM org.institutions WHERE id = $1`,
        [rawCollegeId]
      );
      instRows = rows;
    }
    if (instRows.length === 0) {
      const { rows } = await db.query(
        `SELECT id, name, code, type AS campus_city, created_at FROM org.institutions WHERE UPPER(code) = UPPER($1) OR LOWER(name) = LOWER($1)`,
        [rawCollegeId]
      );
      instRows = rows;
    }
    if (instRows.length === 0) {
      throw new AppError(404, 'Institution not found', 'NOT_FOUND');
    }
    const college = instRows[0];
    const collegeId = college.id;

    // Count enrolled students strictly and specifically for THIS college
    const { rows: studentCountRows } = await db.query(
      `SELECT COUNT(DISTINCT s.id) AS count
       FROM org.students s
       LEFT JOIN org.programs p ON p.id = s.program_id
       LEFT JOIN org.batches b ON b.id = s.batch_id
       LEFT JOIN org.programs pb ON pb.id = b.program_id
       LEFT JOIN identity.users u ON u.id = s.user_id
       WHERE p.institution_id = $1 OR pb.institution_id = $1 OR u.institution_id = $1`,
      [collegeId]
    );
    const enrolledStudentsCount = parseInt(studentCountRows[0]?.count || '0', 10);

    // Get programs created for this college
    const { rows: progRows } = await db.query(
      `SELECT id, name, code, is_active FROM org.programs WHERE institution_id = $1 ORDER BY created_at DESC`,
      [collegeId]
    );

    // Get assignments count for this college
    const { rows: assignCountRows } = await db.query(
      `SELECT COUNT(*) AS count FROM org.interview_assignments WHERE institution_id = $1`,
      [collegeId]
    ).catch(() => ({ rows: [{ count: '0' }] }));
    const totalAssignmentsCount = parseInt(assignCountRows[0]?.count || '0', 10);

    sendSuccess(res, {
      college: {
        id: college.id,
        name: college.name,
        code: college.code,
        campusCity: college.campus_city || '',
        createdAt: college.created_at
      },
      enrolledStudentsCount,
      programsCreated: progRows,
      programsCount: progRows.length,
      totalAssignmentsCount,
      tokenUsage: {
        totalTokens: 0,
        promptTokens: 0,
        completionTokens: 0,
        audioMinutes: 0,
        whisperHours: 0,
        llmModel: 'Gemini 1.5 Flash + Whisper Pro',
        status: 'Active (0 Tokens Consumed)'
      }
    });
  } catch (err) {
    sendError(res, err);
  }
});

// ── DELETE /api/owner/colleges/:collegeId ───────────────────────────────────
ownerRouter.delete(
  '/colleges/:collegeId',
  async (req: Request, res: Response): Promise<void> => {
    const client = await db.connect();
    try {
      const collegeId = Array.isArray(req.params.collegeId) ? req.params.collegeId[0] : (req.params.collegeId || '');

      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(collegeId);
      let instRows: any[] = [];
      if (isUuid) {
        const { rows } = await client.query(
          `SELECT id, name FROM org.institutions WHERE id = $1`,
          [collegeId]
        );
        instRows = rows;
      }
      if (instRows.length === 0) {
        const { rows } = await client.query(
          `SELECT id, name FROM org.institutions WHERE UPPER(code) = UPPER($1) OR LOWER(name) = LOWER($1)`,
          [collegeId]
        );
        instRows = rows;
      }
      if (instRows.length === 0) {
        throw new AppError(404, 'Institution not found', 'NOT_FOUND');
      }
      const targetInstitutionId = instRows[0].id;

      await client.query('BEGIN');

      const safeQuery = async (queryText: string, params: any[] = []) => {
        try {
          await client.query('SAVEPOINT sp');
          await client.query(queryText, params);
          await client.query('RELEASE SAVEPOINT sp');
        } catch (subErr) {
          await client.query('ROLLBACK TO SAVEPOINT sp').catch(() => {});
          console.warn('[owner.routes DELETE college safeQuery ignored error]', (subErr as Error).message);
        }
      };

      // 1. Identify all student IDs and their user IDs tied to this institution
      const { rows: studentRows } = await client.query<{ id: string; user_id: string }>(
        `SELECT DISTINCT s.id, s.user_id FROM org.students s
         LEFT JOIN org.programs p ON p.id = s.program_id
         LEFT JOIN org.batches b ON b.id = s.batch_id
         LEFT JOIN org.programs pb ON pb.id = b.program_id
         LEFT JOIN identity.users u ON u.id = s.user_id
         WHERE p.institution_id = $1
            OR pb.institution_id = $1
            OR u.institution_id = $1
            OR s.college_id = $1`,
        [targetInstitutionId]
      );
      const studentIds = studentRows.map(s => s.id);
      const studentUserIds = studentRows.map(s => s.user_id).filter(Boolean);

      // 2. Identify all user IDs tied to this institution across all roles (students, admins, staff, faculty, self-registered)
      const { rows: usersRows } = await client.query<{ id: string; email: string }>(
        `SELECT DISTINCT u.id, u.email FROM identity.users u
         LEFT JOIN identity.role_assignments ra ON ra.user_id = u.id
         LEFT JOIN org.students s ON s.user_id = u.id
         LEFT JOIN org.programs p ON p.id = s.program_id
         LEFT JOIN org.batches b ON b.id = s.batch_id
         LEFT JOIN org.programs pb ON pb.id = b.program_id
         LEFT JOIN org.department_staff ds ON ds.user_id = u.id
         WHERE (
           u.institution_id = $1
           OR ra.institution_id = $1
           OR p.institution_id = $1
           OR pb.institution_id = $1
           OR ds.institution_id = $1
           OR u.id = ANY($2::uuid[])
           OR LOWER(u.email) IN (SELECT LOWER(email) FROM identity.pending_invites WHERE institution_id = $1)
           OR LOWER(u.email) IN (SELECT LOWER(email) FROM org.department_staff WHERE institution_id = $1)
         )
         AND u.role != 'PLATFORM_OWNER'
         AND LOWER(u.email) != 'danishbasha18@gmail.com'`,
        [targetInstitutionId, studentUserIds]
      );
      const userIdsToDelete = [...new Set(usersRows.map(u => u.id))];
      const userEmailsToDelete = [...new Set(usersRows.map(u => u.email.toLowerCase()))];

      // 3. Identify all assessment attempts tied to these students or institution programs
      const { rows: attemptRows } = await client.query<{ id: string }>(
        `SELECT DISTINCT a.id FROM assessment.assessment_attempts a
         LEFT JOIN org.programs p ON p.id = a.program_id
         WHERE (a.student_id = ANY($1::uuid[]) OR p.institution_id = $2)`,
        [studentIds, targetInstitutionId]
      );
      const attemptIds = attemptRows.map(a => a.id);

      // 4. Delete Session, Question, Evaluation & Assessment Attempt details
      if (attemptIds.length > 0 || studentIds.length > 0) {
        await safeQuery(
          `DELETE FROM session.interview_embeddings 
           WHERE session_id IN (SELECT id FROM session.assessment_sessions WHERE attempt_id = ANY($1::uuid[]))
              OR session_id IN (SELECT id FROM session.interview_sessions WHERE student_id = ANY($2::uuid[]))`,
          [attemptIds, studentIds]
        );

        await safeQuery(
          `DELETE FROM session.interview_transcripts 
           WHERE session_id IN (SELECT id FROM session.assessment_sessions WHERE attempt_id = ANY($1::uuid[]))
              OR student_id = ANY($2::uuid[])`,
          [attemptIds, studentIds]
        );

        await safeQuery(`DELETE FROM evaluation.responses WHERE attempt_id = ANY($1::uuid[])`, [attemptIds]);
        await safeQuery(`DELETE FROM session.questions WHERE attempt_id = ANY($1::uuid[])`, [attemptIds]);
        await safeQuery(`DELETE FROM performance.assessment_reports WHERE attempt_id = ANY($1::uuid[]) OR student_id = ANY($2::uuid[])`, [attemptIds, studentIds]);
        await safeQuery(`DELETE FROM performance.performance_snapshots WHERE attempt_id = ANY($1::uuid[]) OR student_id = ANY($2::uuid[])`, [attemptIds, studentIds]);
        await safeQuery(`DELETE FROM performance.skill_performances WHERE attempt_id = ANY($1::uuid[]) OR student_id = ANY($2::uuid[])`, [attemptIds, studentIds]);
        await safeQuery(`DELETE FROM session.assessment_sessions WHERE attempt_id = ANY($1::uuid[])`, [attemptIds]);
        await safeQuery(`DELETE FROM session.interview_sessions WHERE student_id = ANY($1::uuid[])`, [studentIds]);
        await safeQuery(`DELETE FROM assessment.assessment_attempts WHERE id = ANY($1::uuid[]) OR student_id = ANY($2::uuid[])`, [attemptIds, studentIds]);
      }

      // 5. Delete Student performance, credits, placement, mentor and resume data
      if (studentIds.length > 0) {
        await safeQuery(`DELETE FROM performance.student_skills WHERE student_id = ANY($1::uuid[])`, [studentIds]);
        await safeQuery(`DELETE FROM performance.learning_recommendations WHERE student_id = ANY($1::uuid[])`, [studentIds]);
        await safeQuery(`DELETE FROM performance.learning_plans WHERE student_id = ANY($1::uuid[])`, [studentIds]);
        await safeQuery(`DELETE FROM performance.performance_profiles WHERE student_id = ANY($1::uuid[])`, [studentIds]);
        await safeQuery(`DELETE FROM credit.credit_transactions WHERE student_id = ANY($1::uuid[])`, [studentIds]);
        await safeQuery(`DELETE FROM credit.credit_accounts WHERE student_id = ANY($1::uuid[])`, [studentIds]);
        await safeQuery(`DELETE FROM credit.credit_policies WHERE institution_id = $1 OR student_id = ANY($2::uuid[])`, [targetInstitutionId, studentIds]);
        await safeQuery(`DELETE FROM placement.checklist_progress WHERE student_id = ANY($1::uuid[])`, [studentIds]);
        await safeQuery(`DELETE FROM placement.mentor_verifications WHERE student_id = ANY($1::uuid[]) OR mentor_user_id = ANY($2::uuid[])`, [studentIds, userIdsToDelete]);
        await safeQuery(`DELETE FROM placement.placement_eligibility WHERE student_id = ANY($1::uuid[])`, [studentIds]);
        await safeQuery(`DELETE FROM org.resumes WHERE student_id = ANY($1::uuid[])`, [studentIds]);
        await safeQuery(`DELETE FROM org.student_mentor_assignments WHERE student_id = ANY($1::uuid[]) OR mentor_user_id = ANY($2::uuid[]) OR assigned_by = ANY($2::uuid[])`, [studentIds, userIdsToDelete]);
      }

      // 6. Delete all students of this college
      await safeQuery(
        `DELETE FROM org.students
         WHERE id = ANY($1::uuid[])
            OR user_id = ANY($2::uuid[])
            OR program_id IN (SELECT id FROM org.programs WHERE institution_id = $3)`,
        [studentIds, userIdsToDelete, targetInstitutionId]
      );

      // 7. Delete institution structure (subdivisions, batches, programs, departments, classes, staff, assignments)
      await safeQuery(`DELETE FROM org.trainer_subdivision_assignments WHERE trainer_user_id = ANY($1::uuid[]) OR assigned_by = ANY($1::uuid[])`, [userIdsToDelete]);
      await safeQuery(`DELETE FROM org.subdivisions WHERE program_id IN (SELECT id FROM org.programs WHERE institution_id = $1)`, [targetInstitutionId]);
      await safeQuery(`DELETE FROM org.batches WHERE program_id IN (SELECT id FROM org.programs WHERE institution_id = $1)`, [targetInstitutionId]);
      await safeQuery(`DELETE FROM org.programs WHERE institution_id = $1`, [targetInstitutionId]);
      await safeQuery(`DELETE FROM org.interview_assignments WHERE institution_id = $1`, [targetInstitutionId]);
      await safeQuery(`DELETE FROM org.trainer_tenures WHERE institution_id = $1`, [targetInstitutionId]);
      await safeQuery(`DELETE FROM knowledge.knowledge_documents WHERE institution_id = $1`, [targetInstitutionId]);
      await safeQuery(`DELETE FROM org.department_classes WHERE institution_id = $1`, [targetInstitutionId]);
      await safeQuery(`DELETE FROM org.department_staff WHERE institution_id = $1 OR user_id = ANY($2::uuid[])`, [targetInstitutionId, userIdsToDelete]);
      await safeQuery(`DELETE FROM org.departments WHERE institution_id = $1`, [targetInstitutionId]);
      await safeQuery(`DELETE FROM org.faculty_profiles WHERE user_id = ANY($1::uuid[])`, [userIdsToDelete]);

      // 8. Delete invitations, roles, password resets, auth tokens, and users
      await safeQuery(`DELETE FROM identity.pending_invites WHERE institution_id = $1 OR LOWER(email) = ANY($2::text[])`, [targetInstitutionId, userEmailsToDelete]);
      await safeQuery(`DELETE FROM identity.role_assignments WHERE institution_id = $1 OR user_id = ANY($2::uuid[])`, [targetInstitutionId, userIdsToDelete]);

      if (userEmailsToDelete.length > 0) {
        await safeQuery(`DELETE FROM identity.password_resets WHERE LOWER(email) = ANY($1::text[])`, [userEmailsToDelete]);
      }

      if (userIdsToDelete.length > 0) {
        // Clear foreign key references from system and agent logs
        await safeQuery(`UPDATE system.audit_logs SET actor_user_id = NULL WHERE actor_user_id::text = ANY($1::text[])`, [userIdsToDelete]);
        await safeQuery(`UPDATE agent.agent_runs SET triggered_by_user_id = NULL WHERE triggered_by_user_id::text = ANY($1::text[])`, [userIdsToDelete]);
        await safeQuery(`DELETE FROM agent.agent_runs WHERE student_id = ANY($1::uuid[]) OR triggered_by_user_id::text = ANY($2::text[])`, [studentIds, userIdsToDelete]);

        // Clear auth sessions (handling varchar/uuid data types cleanly via ::text)
        await safeQuery(`DELETE FROM auth.sessions WHERE user_id::text = ANY($1::text[])`, [userIdsToDelete]);
        await safeQuery(`DELETE FROM auth.refresh_tokens WHERE user_id::text = ANY($1::text[])`, [userIdsToDelete]);
        await safeQuery(`DELETE FROM auth.identities WHERE user_id::text = ANY($1::text[])`, [userIdsToDelete]);

        // Delete ALL users belonging to this college from identity.users (strictly protecting PLATFORM_OWNER)
        await client.query(
          `DELETE FROM identity.users 
           WHERE (id = ANY($1::uuid[]) OR institution_id = $2 OR LOWER(email) = ANY($3::text[]))
             AND role != 'PLATFORM_OWNER' 
             AND LOWER(email) != 'danishbasha18@gmail.com'`,
          [userIdsToDelete, targetInstitutionId, userEmailsToDelete]
        );
      } else {
        // In case there were users with institution_id directly set
        await client.query(
          `DELETE FROM identity.users 
           WHERE institution_id = $1
             AND role != 'PLATFORM_OWNER' 
             AND LOWER(email) != 'danishbasha18@gmail.com'`,
          [targetInstitutionId]
        );
      }

      // 9. Delete the institution itself
      await client.query(`DELETE FROM org.institutions WHERE id = $1`, [targetInstitutionId]);

      await client.query('COMMIT');

      sendSuccess(res, {
        message: 'Institution and all corresponding users and data have been completely deleted.',
        deletedUsersCount: userIdsToDelete.length,
        deletedStudentsCount: studentIds.length
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      sendError(res, err);
    } finally {
      client.release();
    }
  }
);

// ── GET /api/owner/colleges/:collegeId/metrics ───────────────────────────────
ownerRouter.get(
  '/colleges/:collegeId/metrics',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { collegeId } = req.params;

      const { rows: institution } = await db.query(
        `SELECT id, name, code, type AS campus_city, created_at FROM org.institutions WHERE id = $1`,
        [collegeId]
      );

      if (institution.length === 0) {
        throw new AppError(404, 'Institution not found', 'NOT_FOUND');
      }

      const { rows: metrics } = await db.query(
        `SELECT
          (SELECT COUNT(*) FROM org.students s
           JOIN org.batches b ON b.id = s.batch_id
           JOIN org.programs p ON p.id = b.program_id
           WHERE p.institution_id = $1) AS enrolled_students_count,
          (SELECT COUNT(*) FROM org.programs WHERE institution_id = $1) AS programs_count,
          (SELECT COUNT(*) FROM org.departments WHERE institution_id = $1) AS departments_count
        `,
        [collegeId]
      );

      sendSuccess(res, {
        college: institution[0],
        ...metrics[0],
        tokenUsage: {
          totalTokens: 0,
          promptTokens: 0,
          completionTokens: 0,
          audioMinutes: 0,
          whisperHours: 0,
          llmModel: 'Gemini 1.5 Flash + Whisper Pro',
          status: 'Active (0 Tokens Consumed)',
        },
      });
    } catch (err) {
      sendError(res, err);
    }
  }
);
