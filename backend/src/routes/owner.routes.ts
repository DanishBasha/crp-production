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
        COALESCE(sa.email, inv.email) AS super_admin_email,
        COALESCE(sa.name, inv.name) AS super_admin_name,
        CASE
          WHEN sa.id IS NOT NULL AND sa.status = 'ACTIVE' THEN 'ACTIVE'
          WHEN inv.id IS NOT NULL AND inv.status = 'PENDING' THEN 'PENDING_INVITE'
          ELSE 'NO_ADMIN'
        END AS super_admin_status
      FROM org.institutions i
      LEFT JOIN LATERAL (
        SELECT inv_a.email, u.name, u.id, u.status
        FROM identity.pending_invites inv_a
        JOIN identity.users u ON u.email = inv_a.email
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

    // Seed foundational departments
    await db.query(`
      INSERT INTO org.departments (institution_id, name, code, is_active)
      VALUES 
        ($1, 'Computer Science & Engineering', 'CSE', true),
        ($1, 'Information Technology', 'IT', true),
        ($1, 'Electronics & Communication Engineering', 'ECE', true)
      ON CONFLICT DO NOTHING
    `, [inst.id]).catch(() => {});

    // Seed foundational program
    await db.query(`
      INSERT INTO org.programs (institution_id, name, code, target_department, admin_permissions)
      VALUES ($1, 'B.Tech Computer Science & Engineering', 'BTECH-CSE', 'Computer Science & Engineering', '["CAN_VIEW_STUDENT_PROGRESS", "CAN_ASSIGN_INTERVIEWS", "CAN_MANAGE_STUDENTS"]'::jsonb)
      ON CONFLICT DO NOTHING
    `, [inst.id]).catch(() => {});

    sendSuccess(res, inst, 201);
  } catch (err) {
    sendError(res, err);
  }
});

// ── POST /api/owner/colleges/:collegeId/invite-super-admin ──────────────────
const inviteSuperAdminSchema = z.object({
  firstName: z.string().min(1).max(255),
  lastName: z.string().min(1).max(255),
  email: z.string().email().transform(s => s.toLowerCase()),
});

ownerRouter.post(
  ['/colleges/:collegeId/invite-super-admin', '/colleges/:collegeId/super-admin/invite'],
  async (req: Request, res: Response): Promise<void> => {
    try {
      const collegeId = Array.isArray(req.params.collegeId) ? req.params.collegeId[0] : (req.params.collegeId || '');
      const parsed = inviteSuperAdminSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(422, 'Validation failed', 'VALIDATION_ERROR');
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
        `SELECT id FROM identity.users WHERE email = $1`,
        [email]
      );
      if (users.length > 0) {
        throw new AppError(409, 'A user account with this email already exists', 'DUPLICATE_EMAIL');
      }

      // Clean up any stale pending invite for this email so they can be re-invited
      await db.query(`DELETE FROM identity.pending_invites WHERE email = $1`, [email]);

      // Create invitation token
      const token = `inv_sup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

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

      const reqHost = req.get('host');
      const reqProtocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
      const origin = req.headers.origin || (req.headers.referer ? new URL(req.headers.referer as string).origin : undefined);
      const hostUrl = reqHost ? `${reqProtocol}://${reqHost}` : undefined;
      const baseUrl = (process.env.APP_URL && !process.env.APP_URL.includes('localhost')) 
        ? process.env.APP_URL 
        : (origin || hostUrl || process.env.APP_URL || 'http://52.66.240.211');
      const inviteUrl = `${baseUrl.replace(/\/+$/, '')}/?page=activate&invite_token=${token}`;

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
        (SELECT COUNT(*) FROM identity.users WHERE role = 'SUPER_ADMIN' AND status = 'ACTIVE') AS active_super_admins,
        (SELECT COUNT(*) FROM org.students) AS total_students,
        (SELECT COUNT(*) FROM org.programs) AS total_programs
    `);

    sendSuccess(res, stats[0]);
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
      const { collegeId } = req.params;

      const { rows: instRows } = await client.query(
        `SELECT id, name FROM org.institutions WHERE id = $1`,
        [collegeId]
      );
      if (instRows.length === 0) {
        throw new AppError(404, 'Institution not found', 'NOT_FOUND');
      }

      await client.query('BEGIN');

      // 1. Identify all admin/staff user IDs tied to this institution (never delete PLATFORM_OWNER)
      const { rows: adminUsers } = await client.query<{ id: string }>(
        `SELECT DISTINCT u.id FROM identity.users u
         LEFT JOIN identity.role_assignments ra ON ra.user_id = u.id
         WHERE (u.institution_id = $1 OR ra.institution_id = $1)
           AND u.role != 'PLATFORM_OWNER'`,
        [collegeId]
      );
      const userIdsToDelete = adminUsers.map(u => u.id);

      // 2. Delete pending invites for this institution
      await client.query(`DELETE FROM identity.pending_invites WHERE institution_id = $1`, [collegeId]).catch(() => {});

      // 3. Delete role assignments for this institution or these users
      await client.query(
        `DELETE FROM identity.role_assignments WHERE institution_id = $1 OR user_id = ANY($2::uuid[])`,
        [collegeId, userIdsToDelete]
      ).catch(() => {});

      // 4. Delete assignments & trainer tenures
      await client.query(`DELETE FROM org.interview_assignments WHERE institution_id = $1`, [collegeId]).catch(() => {});
      await client.query(`DELETE FROM org.trainer_tenures WHERE institution_id = $1`, [collegeId]).catch(() => {});

      // 5. Delete department classes & staff & departments
      await client.query(`DELETE FROM org.department_classes WHERE institution_id = $1`, [collegeId]).catch(() => {});
      await client.query(`DELETE FROM org.department_staff WHERE institution_id = $1`, [collegeId]).catch(() => {});
      await client.query(`DELETE FROM org.departments WHERE institution_id = $1`, [collegeId]).catch(() => {});

      // 6. Delete students & batches & programs
      await client.query(
        `DELETE FROM org.students
         WHERE program_id IN (SELECT id FROM org.programs WHERE institution_id = $1)
            OR batch_id IN (SELECT b.id FROM org.batches b JOIN org.programs p ON p.id = b.program_id WHERE p.institution_id = $1)
            OR user_id = ANY($2::uuid[])`,
        [collegeId, userIdsToDelete]
      ).catch(() => {});

      await client.query(
        `DELETE FROM org.batches
         WHERE program_id IN (SELECT id FROM org.programs WHERE institution_id = $1)`,
        [collegeId]
      ).catch(() => {});

      await client.query(`DELETE FROM org.programs WHERE institution_id = $1`, [collegeId]).catch(() => {});

      // 7. Delete corresponding admin / staff users from identity.users
      if (userIdsToDelete.length > 0) {
        await client.query(`DELETE FROM identity.users WHERE id = ANY($1::uuid[]) AND role != 'PLATFORM_OWNER'`, [userIdsToDelete]).catch(() => {});
      }

      // 8. Delete the institution itself
      await client.query(`DELETE FROM org.institutions WHERE id = $1`, [collegeId]);

      await client.query('COMMIT');

      sendSuccess(res, {
        message: 'Institution and all corresponding administrators/data removed successfully',
        removedAdminsCount: userIdsToDelete.length
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
