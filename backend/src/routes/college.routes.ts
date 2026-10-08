import { Router, Request, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { db } from '../shared/db/pool';
import { AppError } from '../shared/errors/AppError';
import { sendSuccess, sendError } from '../shared/helpers/response';
import { AuthRequest } from '../middleware/authenticate';
import { requireRole } from '../middleware/authorize';
import { sendStaffWelcomeEmail } from '../services/emailService';

export const collegeRouter = Router();

async function resolveCollegeId(collegeId?: string | string[]): Promise<string> {
  const rawId = Array.isArray(collegeId) ? collegeId[0] : (collegeId || '');
  if (rawId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId)) {
    const { rows } = await db.query(`SELECT id FROM org.institutions WHERE id = $1`, [rawId]);
    if (rows.length > 0) return rows[0].id;
  }
  const { rows } = await db.query(`SELECT id FROM org.institutions ORDER BY created_at DESC LIMIT 1`);
  if (rows.length > 0) return rows[0].id;
  const { rows: created } = await db.query(
    `INSERT INTO org.institutions (name, code, type, is_active) VALUES ('Main Institution', 'INST01', 'COLLEGE', true) RETURNING id`
  );
  return created[0].id;
}

// Staff or Admin roles for reads across portals
const requireStaffOrAdmin = requireRole(
  'SUPER_ADMIN',
  'PLATFORM_OWNER',
  'PROGRAM_ADMIN',
  'DEPARTMENT_ADMIN',
  'COUNSELLOR',
  'FACULTY_MENTOR',
  'PLACEMENT_COORDINATOR'
);

// Mutating routes require administrative privileges
const requireSuperAdminOrOwner = requireRole(
  'SUPER_ADMIN',
  'PLATFORM_OWNER',
  'PROGRAM_ADMIN',
  'DEPARTMENT_ADMIN'
);

// ── GET /api/college/:collegeId/details ──────────────────────────────────────
collegeRouter.get(
  '/:collegeId/details',
  requireStaffOrAdmin,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const collegeId = await resolveCollegeId(req.params.collegeId);
      const { rows } = await db.query(
        `SELECT id, name, code, type AS campus_city, created_at FROM org.institutions WHERE id = $1`,
        [collegeId]
      );

      if (rows.length === 0) {
        throw new AppError(404, 'Institution not found', 'NOT_FOUND');
      }

      sendSuccess(res, rows[0]);
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── GET /api/college/:collegeId/departments ──────────────────────────────────
collegeRouter.get(
  '/:collegeId/departments',
  requireStaffOrAdmin,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { collegeId } = req.params;
      const { rows } = await db.query(
        `SELECT
          d.id,
          d.institution_id AS college_id,
          d.name,
          d.code,
          d.is_active,
          d.created_at,
          u.email AS assigned_admin_email,
          u.name AS assigned_admin_name
        FROM org.departments d
        LEFT JOIN identity.users u ON u.role = 'DEPARTMENT_ADMIN'
          AND EXISTS (
            SELECT 1 FROM org.department_staff ds
            WHERE ds.department_id = d.id AND ds.user_id = u.id
          )
        WHERE d.institution_id = $1
        ORDER BY d.name`,
        [collegeId]
      );

      sendSuccess(res, rows);
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── POST /api/college/:collegeId/departments ─────────────────────────────────
const createDepartmentSchema = z.object({
  name: z.string().min(3).max(255),
  code: z.string().min(2).max(20).transform(s => s.toUpperCase()),
  assignedAdminEmail: z.string().email().optional(),
  assignedAdminName: z.string().optional(),
  adminPermissions: z.array(z.string()).optional(),
});

collegeRouter.post(
  '/:collegeId/departments',
  requireSuperAdminOrOwner,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const collegeId = await resolveCollegeId(req.params.collegeId);
      const parsed = createDepartmentSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(422, 'Validation failed', 'VALIDATION_ERROR');
      }

      const { name, code, assignedAdminEmail, assignedAdminName, adminPermissions } = parsed.data;

      const { rows } = await db.query(
        `INSERT INTO org.departments (institution_id, name, code, is_active)
         VALUES ($1, $2, $3, true)
         RETURNING id, institution_id AS college_id, name, code, created_at`,
        [collegeId, name, code]
      );

      const department = rows[0];

      // If admin email provided, create user and staff record
      if (assignedAdminEmail) {
        const passwordHash = await bcrypt.hash('welcome@2026', 10);

        // Create user if doesn't exist
        const { rows: userRows } = await db.query(
          `INSERT INTO identity.users (name, email, password_hash, role, status, institution_id)
           VALUES ($1, $2, $3, 'DEPARTMENT_ADMIN', 'ACTIVE', $4)
           ON CONFLICT (email) DO UPDATE SET 
             role = CASE WHEN identity.users.role IN ('PLATFORM_OWNER', 'SUPER_ADMIN') THEN identity.users.role ELSE 'DEPARTMENT_ADMIN' END,
             name = COALESCE(identity.users.name, EXCLUDED.name),
             institution_id = COALESCE(identity.users.institution_id, EXCLUDED.institution_id)
           RETURNING id`,
          [assignedAdminName || name + ' Admin', assignedAdminEmail.toLowerCase().trim(), passwordHash, collegeId]
        );

        // Create or update staff record
        await db.query(
          `INSERT INTO org.department_staff
           (user_id, institution_id, department_id, department, name, email, designation, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'Department Admin', 'ACTIVE')
           ON CONFLICT (email) DO UPDATE SET
             user_id = EXCLUDED.user_id,
             institution_id = EXCLUDED.institution_id,
             department_id = EXCLUDED.department_id,
             department = EXCLUDED.department,
             name = EXCLUDED.name,
             designation = EXCLUDED.designation,
             status = 'ACTIVE'`,
          [userRows[0].id, collegeId, department.id, name, assignedAdminName || name + ' Admin', assignedAdminEmail.toLowerCase().trim()]
        );

        await db.query(
          `INSERT INTO identity.role_assignments (user_id, role, institution_id, department_id)
           VALUES ($1, 'DEPARTMENT_ADMIN', $2, $3)
           ON CONFLICT DO NOTHING`,
          [userRows[0].id, collegeId, department.id]
        ).catch(() => {});

        sendStaffWelcomeEmail({
          to: assignedAdminEmail.toLowerCase().trim(),
          name: assignedAdminName || `${name} Admin`,
          role: 'DEPARTMENT_ADMIN',
          password: 'welcome@2026',
          createdBy: (req as AuthRequest).user?.name || 'Administrator',
        }).catch((err) => console.error('[college.routes] Failed to send dept admin welcome email:', err));
      }

      sendSuccess(res, department, 201);
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── PATCH /api/college/:collegeId/departments/:deptId ────────────────────────
const updateDepartmentSchema = z.object({
  name: z.string().min(3).max(255).optional(),
  code: z.string().min(2).max(20).transform(s => s.toUpperCase()).optional(),
  assignedAdminEmail: z.string().email().optional(),
  assignedAdminName: z.string().optional(),
  adminPermissions: z.array(z.string()).optional(),
});

collegeRouter.patch(
  '/:collegeId/departments/:deptId',
  requireSuperAdminOrOwner,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { collegeId, deptId } = req.params;
      const parsed = updateDepartmentSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(422, 'Validation failed', 'VALIDATION_ERROR');
      }

      const updates: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (parsed.data.name) {
        updates.push(`name = $${paramIndex++}`);
        values.push(parsed.data.name);
      }
      if (parsed.data.code) {
        updates.push(`code = $${paramIndex++}`);
        values.push(parsed.data.code);
      }

      if (updates.length > 0) {
        updates.push(`updated_at = now()`);
        values.push(deptId, collegeId);

        await db.query(
          `UPDATE org.departments SET ${updates.join(', ')}
           WHERE id = $${paramIndex} AND institution_id = $${paramIndex + 1}`,
          values
        );
      }

      if (parsed.data.assignedAdminEmail && parsed.data.assignedAdminEmail.trim()) {
        const passwordHash = await bcrypt.hash('welcome@2026', 10);
        const resolvedCollegeId = await resolveCollegeId(collegeId);
        const adminEmail = parsed.data.assignedAdminEmail.toLowerCase().trim();
        const adminName = parsed.data.assignedAdminName || `${parsed.data.name || 'Department'} Admin`;

        const { rows: userRows } = await db.query(
          `INSERT INTO identity.users (name, email, password_hash, role, status, institution_id)
           VALUES ($1, $2, $3, 'DEPARTMENT_ADMIN', 'ACTIVE', $4)
           ON CONFLICT (email) DO UPDATE SET 
             role = CASE WHEN identity.users.role IN ('PLATFORM_OWNER', 'SUPER_ADMIN') THEN identity.users.role ELSE 'DEPARTMENT_ADMIN' END,
             name = COALESCE(identity.users.name, EXCLUDED.name),
             institution_id = COALESCE(identity.users.institution_id, EXCLUDED.institution_id)
           RETURNING id`,
          [adminName, adminEmail, passwordHash, resolvedCollegeId]
        );

        await db.query(
          `INSERT INTO org.department_staff
           (user_id, institution_id, department_id, department, name, email, designation, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'Department Admin', 'ACTIVE')
           ON CONFLICT (email) DO UPDATE SET
             user_id = EXCLUDED.user_id,
             institution_id = EXCLUDED.institution_id,
             department_id = EXCLUDED.department_id,
             name = EXCLUDED.name,
             designation = EXCLUDED.designation,
             status = 'ACTIVE'`,
          [userRows[0].id, resolvedCollegeId, deptId, parsed.data.name || 'Department', adminName, adminEmail]
        );

        await db.query(
          `INSERT INTO identity.role_assignments (user_id, role, institution_id, department_id)
           VALUES ($1, 'DEPARTMENT_ADMIN', $2, $3)
           ON CONFLICT DO NOTHING`,
          [userRows[0].id, resolvedCollegeId, deptId]
        ).catch(() => {});

        sendStaffWelcomeEmail({
          to: adminEmail,
          name: adminName,
          role: 'DEPARTMENT_ADMIN',
          password: 'welcome@2026',
          createdBy: (req as AuthRequest).user?.name || 'Administrator',
        }).catch((err) => console.error('[college.routes] Failed to send updated dept admin welcome email:', err));
      }

      // Fetch updated record
      const { rows } = await db.query(
        `SELECT id, institution_id AS college_id, name, code, created_at FROM org.departments
         WHERE id = $1`,
        [deptId]
      );

      sendSuccess(res, rows[0]);
    } catch (err) {
      sendError(res, err);
    }
  }
);

async function deleteUsersSafely(client: any, userIds: string[]) {
  if (!userIds || userIds.length === 0) return;
  await client.query(`UPDATE system.audit_logs SET actor_user_id = NULL WHERE actor_user_id = ANY($1::uuid[])`, [userIds]).catch(() => {});
  await client.query(`UPDATE agent.agent_runs SET triggered_by_user_id = NULL WHERE triggered_by_user_id = ANY($1::uuid[])`, [userIds]).catch(() => {});
  await client.query(`DELETE FROM identity.role_assignments WHERE user_id = ANY($1::uuid[])`, [userIds]).catch(() => {});
  await client.query(`DELETE FROM org.department_staff WHERE user_id = ANY($1::uuid[])`, [userIds]).catch(() => {});
  await client.query(`DELETE FROM org.faculty_profiles WHERE user_id = ANY($1::uuid[])`, [userIds]).catch(() => {});
  await client.query(`DELETE FROM org.student_mentor_assignments WHERE mentor_user_id = ANY($1::uuid[]) OR assigned_by = ANY($1::uuid[])`, [userIds]).catch(() => {});
  await client.query(`DELETE FROM org.trainer_subdivision_assignments WHERE trainer_user_id = ANY($1::uuid[]) OR assigned_by = ANY($1::uuid[])`, [userIds]).catch(() => {});
  await client.query(`DELETE FROM placement.mentor_verifications WHERE mentor_user_id = ANY($1::uuid[])`, [userIds]).catch(() => {});
  await client.query(
    `DELETE FROM identity.users WHERE id = ANY($1::uuid[]) AND role NOT IN ('PLATFORM_OWNER', 'SUPER_ADMIN')`,
    [userIds]
  ).catch(() => {});
}

// ── DELETE /api/college/:collegeId/departments/:deptId ───────────────────────
collegeRouter.delete(
  '/:collegeId/departments/:deptId',
  requireSuperAdminOrOwner,
  async (req: Request, res: Response): Promise<void> => {
    const client = await db.connect();
    try {
      const { collegeId, deptId } = req.params;
      const resolvedCollegeId = await resolveCollegeId(collegeId);

      const { rows: deptRows } = await client.query(
        `SELECT id, institution_id, name, code FROM org.departments WHERE id = $1`,
        [deptId]
      );

      if (deptRows.length === 0) {
        throw new AppError(404, 'Department not found', 'NOT_FOUND');
      }
      const dept = deptRows[0];

      await client.query('BEGIN');

      // 1. Identify all staff & department admin user IDs to cascade delete
      const { rows: staffUsers } = await client.query<{ id: string; email: string }>(
        `SELECT DISTINCT u.id, u.email FROM identity.users u
         LEFT JOIN org.department_staff ds ON ds.user_id = u.id OR LOWER(ds.email) = LOWER(u.email)
         LEFT JOIN identity.role_assignments ra ON ra.user_id = u.id
         WHERE (
           ds.department_id = $1 
           OR (ds.institution_id = $2 AND LOWER(ds.department) = LOWER($3))
           OR (ra.institution_id = $2 AND u.role = 'DEPARTMENT_ADMIN')
         )
         AND u.role NOT IN ('PLATFORM_OWNER', 'SUPER_ADMIN')`,
        [deptId, resolvedCollegeId, dept.name]
      );
      const userIdsToDelete = staffUsers.map(u => u.id);
      const emailsToDelete = staffUsers.map(u => u.email.toLowerCase());

      // 2. Delete pending invites for this department/staff
      if (emailsToDelete.length > 0) {
        await client.query(
          `DELETE FROM identity.pending_invites 
           WHERE institution_id = $1 AND LOWER(email) = ANY($2::text[])`,
          [resolvedCollegeId, emailsToDelete]
        ).catch(() => {});
      }

      // 3. Delete department classes
      await client.query(
        `DELETE FROM org.department_classes 
         WHERE department_id = $1 OR (institution_id = $2 AND LOWER(department) = LOWER($3))`,
        [deptId, resolvedCollegeId, dept.name]
      ).catch(() => {});

      // 4. Delete department staff
      await client.query(
        `DELETE FROM org.department_staff 
         WHERE department_id = $1 OR (institution_id = $2 AND LOWER(department) = LOWER($3))`,
        [deptId, resolvedCollegeId, dept.name]
      ).catch(() => {});

      // 5. Delete department interview assignments
      await client.query(
        `DELETE FROM org.interview_assignments 
         WHERE institution_id = $1 AND (target_department = $2 OR target_departments ? $2)`,
        [resolvedCollegeId, dept.name]
      ).catch(() => {});

      // 6. Delete users safely
      if (userIdsToDelete.length > 0) {
        await deleteUsersSafely(client, userIdsToDelete);
      }

      // 7. Delete the department
      await client.query(`DELETE FROM org.departments WHERE id = $1`, [deptId]);

      await client.query('COMMIT');

      sendSuccess(res, {
        success: true,
        message: 'Department and associated administrators/staff removed successfully',
        deletedAdminsCount: userIdsToDelete.length
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      sendError(res, err);
    } finally {
      client.release();
    }
  }
);

// ── POST /api/college/:collegeId/departments/bulk ────────────────────────────
collegeRouter.post(
  '/:collegeId/departments/bulk',
  requireSuperAdminOrOwner,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { collegeId } = req.params;
      const { csvContent } = req.body;

      if (!csvContent || typeof csvContent !== 'string') {
        throw new AppError(422, 'CSV content required', 'VALIDATION_ERROR');
      }

      const lines = csvContent.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
      const created: any[] = [];
      const errors: string[] = [];

      let startIdx = 0;
      let headerCols: string[] = [];

      // Detect header
      if (lines.length > 0) {
        const first = lines[0].toLowerCase();
        if (first.includes('dept') || first.includes('name') || first.includes('code')) {
          headerCols = lines[0].split(',').map(c => c.trim().toLowerCase().replace(/["']/g, ''));
          startIdx = 1;
        }
      }

      for (let i = startIdx; i < lines.length; i++) {
        const cols = lines[i].split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
        if (cols.length < 2) continue;

        let name = cols[0] || '';
        let code = cols[1] || '';

        if (!name || !code) {
          errors.push(`Row ${i + 1}: Missing name or code`);
          continue;
        }

        try {
          const { rows } = await db.query(
            `INSERT INTO org.departments (institution_id, name, code, is_active)
             VALUES ($1, $2, $3, true)
             ON CONFLICT (institution_id, code) DO UPDATE
             SET name = EXCLUDED.name
             RETURNING id, institution_id AS college_id, name, code`,
            [collegeId, name.trim(), code.trim().toUpperCase()]
          );
          created.push(rows[0]);
        } catch (err) {
          errors.push(`Row ${i + 1}: ${(err as Error).message}`);
        }
      }

      sendSuccess(res, { created: created.length, departments: created, errors }, 201);
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── GET /api/college/:collegeId/programs ─────────────────────────────────────
collegeRouter.get(
  '/:collegeId/programs',
  requireStaffOrAdmin,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const collegeId = await resolveCollegeId(req.params.collegeId);
      const { rows } = await db.query(
        `SELECT
          id,
          institution_id AS college_id,
          name,
          code,
          target_department AS "targetDepartment",
          assigned_admin_name AS "assignedAdminName",
          assigned_admin_email AS "assignedAdminEmail",
          COALESCE(admin_permissions, '[]'::jsonb) AS "adminPermissions",
          created_at AS "createdAt"
        FROM org.programs
        WHERE institution_id = $1
        ORDER BY name`,
        [collegeId]
      );

      sendSuccess(res, rows);
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── POST /api/college/:collegeId/programs ────────────────────────────────────
const createProgramSchema = z.object({
  name: z.string().min(2).max(255),
  code: z.string().min(2).max(20).transform(s => s.toUpperCase()),
  targetDepartment: z.string().optional(),
  assignedAdminEmail: z.string().email().optional(),
  assignedAdminName: z.string().optional(),
  adminPermissions: z.array(z.string()).optional(),
});

collegeRouter.post(
  '/:collegeId/programs',
  requireSuperAdminOrOwner,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const collegeId = await resolveCollegeId(req.params.collegeId);
      const parsed = createProgramSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(422, 'Validation failed', 'VALIDATION_ERROR');
      }

      const { name, code, targetDepartment, assignedAdminEmail, assignedAdminName, adminPermissions } = parsed.data;

      const { rows } = await db.query(
        `INSERT INTO org.programs (institution_id, name, code, target_department, assigned_admin_name, assigned_admin_email, admin_permissions)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING
           id,
           institution_id AS college_id,
           name,
           code,
           target_department AS "targetDepartment",
           assigned_admin_name AS "assignedAdminName",
           assigned_admin_email AS "assignedAdminEmail",
           COALESCE(admin_permissions, '[]'::jsonb) AS "adminPermissions",
           created_at AS "createdAt"`,
        [
          collegeId,
          name,
          code,
          targetDepartment || null,
          assignedAdminName || null,
          assignedAdminEmail || null,
          JSON.stringify(adminPermissions || ['CAN_VIEW_STUDENT_PROGRESS', 'CAN_ASSIGN_INTERVIEWS', 'CAN_MANAGE_STUDENTS'])
        ]
      );

      const program = rows[0];

      // If program admin email provided, create user and role assignment
      if (assignedAdminEmail) {
        const passwordHash = await bcrypt.hash('welcome@2026', 10);
        const { rows: userRows } = await db.query(
          `INSERT INTO identity.users (name, email, password_hash, role, status, institution_id)
           VALUES ($1, $2, $3, 'PROGRAM_ADMIN', 'ACTIVE', $4)
           ON CONFLICT (email) DO UPDATE SET 
             role = CASE WHEN identity.users.role IN ('PLATFORM_OWNER', 'SUPER_ADMIN') THEN identity.users.role ELSE 'PROGRAM_ADMIN' END,
             name = COALESCE(identity.users.name, EXCLUDED.name),
             institution_id = COALESCE(identity.users.institution_id, EXCLUDED.institution_id)
           RETURNING id`,
          [assignedAdminName || name + ' Admin', assignedAdminEmail.toLowerCase().trim(), passwordHash, collegeId]
        );

        if (userRows[0]) {
          await db.query(
            `INSERT INTO identity.role_assignments (user_id, role, institution_id, program_id)
             VALUES ($1, 'PROGRAM_ADMIN', $2, $3)
             ON CONFLICT DO NOTHING`,
            [userRows[0].id, collegeId, program.id]
          ).catch(() => {});
        }

        sendStaffWelcomeEmail({
          to: assignedAdminEmail.toLowerCase().trim(),
          name: assignedAdminName || `${name} Admin`,
          role: 'PROGRAM_ADMIN',
          password: 'welcome@2026',
          createdBy: (req as AuthRequest).user?.name || 'Administrator',
        }).catch((err) => console.error('[college.routes] Failed to send program admin welcome email:', err));
      }

      sendSuccess(res, program, 201);
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── PATCH /api/college/:collegeId/programs/:progId ───────────────────────────
collegeRouter.patch(
  '/:collegeId/programs/:progId',
  requireSuperAdminOrOwner,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { collegeId: rawCollegeId, progId } = req.params;
      const { name, code, targetDepartment, assignedAdminName, assignedAdminEmail, adminPermissions } = req.body;
      const collegeId = await resolveCollegeId(rawCollegeId);

      const updates: string[] = [];
      const values: any[] = [];
      let paramIdx = 1;

      if (name) {
        updates.push(`name = $${paramIdx++}`);
        values.push(name);
      }
      if (code) {
        updates.push(`code = $${paramIdx++}`);
        values.push(code.toUpperCase());
      }
      if (targetDepartment !== undefined) {
        updates.push(`target_department = $${paramIdx++}`);
        values.push(targetDepartment);
      }
      if (assignedAdminName !== undefined) {
        updates.push(`assigned_admin_name = $${paramIdx++}`);
        values.push(assignedAdminName);
      }
      if (assignedAdminEmail !== undefined) {
        updates.push(`assigned_admin_email = $${paramIdx++}`);
        values.push(assignedAdminEmail ? assignedAdminEmail.toLowerCase().trim() : null);
      }
      if (adminPermissions !== undefined) {
        updates.push(`admin_permissions = $${paramIdx++}`);
        values.push(JSON.stringify(adminPermissions));
      }

      if (updates.length > 0) {
        values.push(progId);
        await db.query(
          `UPDATE org.programs SET ${updates.join(', ')} WHERE id = $${paramIdx}`,
          values
        );
      }

      if (assignedAdminEmail && assignedAdminEmail.trim()) {
        const passwordHash = await bcrypt.hash('welcome@2026', 10);
        const { rows: userRows } = await db.query(
          `INSERT INTO identity.users (name, email, password_hash, role, status, institution_id)
           VALUES ($1, $2, $3, 'PROGRAM_ADMIN', 'ACTIVE', $4)
           ON CONFLICT (email) DO UPDATE SET 
             role = CASE WHEN identity.users.role IN ('PLATFORM_OWNER', 'SUPER_ADMIN') THEN identity.users.role ELSE 'PROGRAM_ADMIN' END,
             name = COALESCE(identity.users.name, EXCLUDED.name),
             institution_id = COALESCE(identity.users.institution_id, EXCLUDED.institution_id)
           RETURNING id`,
          [assignedAdminName || (name || 'Program') + ' Admin', assignedAdminEmail.toLowerCase().trim(), passwordHash, collegeId]
        );

        if (userRows[0]) {
          await db.query(
            `INSERT INTO identity.role_assignments (user_id, role, institution_id, program_id)
             VALUES ($1, 'PROGRAM_ADMIN', $2, $3)
             ON CONFLICT DO NOTHING`,
            [userRows[0].id, collegeId, progId]
          ).catch(() => {});
        }

        sendStaffWelcomeEmail({
          to: assignedAdminEmail.toLowerCase().trim(),
          name: assignedAdminName || `${name || 'Program'} Admin`,
          role: 'PROGRAM_ADMIN',
          password: 'welcome@2026',
          createdBy: (req as AuthRequest).user?.name || 'Administrator',
        }).catch((err) => console.error('[college.routes] Failed to send updated program admin welcome email:', err));
      }

      const { rows } = await db.query(
        `SELECT
          id,
          institution_id AS college_id,
          name,
          code,
          target_department AS "targetDepartment",
          assigned_admin_name AS "assignedAdminName",
          assigned_admin_email AS "assignedAdminEmail",
          COALESCE(admin_permissions, '[]'::jsonb) AS "adminPermissions",
          created_at AS "createdAt"
        FROM org.programs WHERE id = $1`,
        [progId]
      );

      sendSuccess(res, rows[0]);
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── DELETE /api/college/:collegeId/programs/:progId ──────────────────────────
collegeRouter.delete(
  '/:collegeId/programs/:progId',
  requireSuperAdminOrOwner,
  async (req: Request, res: Response): Promise<void> => {
    const client = await db.connect();
    try {
      const { collegeId, progId } = req.params;
      const resolvedCollegeId = await resolveCollegeId(collegeId);

      const { rows: progRows } = await client.query(
        `SELECT id, institution_id, name, code, assigned_admin_email FROM org.programs WHERE id = $1`,
        [progId]
      );
      if (progRows.length === 0) {
        throw new AppError(404, 'Program not found', 'NOT_FOUND');
      }
      const program = progRows[0];

      await client.query('BEGIN');

      // 1. Identify program admin user IDs to cascade delete
      const { rows: adminUsers } = await client.query<{ id: string; email: string }>(
        `SELECT DISTINCT u.id, u.email FROM identity.users u
         LEFT JOIN identity.role_assignments ra ON ra.user_id = u.id
         WHERE (
           ra.program_id = $1
           OR ($2::text IS NOT NULL AND LOWER(u.email) = LOWER($2::text))
           OR (u.role = 'PROGRAM_ADMIN' AND ra.institution_id = $3)
         )
         AND u.role NOT IN ('PLATFORM_OWNER', 'SUPER_ADMIN')`,
        [progId, program.assigned_admin_email, resolvedCollegeId]
      );
      const userIdsToDelete = adminUsers.map(u => u.id);
      const emailsToDelete = adminUsers.map(u => u.email.toLowerCase());
      if (program.assigned_admin_email) {
        emailsToDelete.push(program.assigned_admin_email.toLowerCase());
      }

      // 2. Delete pending invites
      if (emailsToDelete.length > 0) {
        await client.query(
          `DELETE FROM identity.pending_invites 
           WHERE program_id = $1 OR LOWER(email) = ANY($2::text[])`,
          [progId, emailsToDelete]
        ).catch(() => {});
      } else {
        await client.query(`DELETE FROM identity.pending_invites WHERE program_id = $1`, [progId]).catch(() => {});
      }

      // 3. Delete role assignments
      if (userIdsToDelete.length > 0) {
        await client.query(
          `DELETE FROM identity.role_assignments WHERE program_id = $1 OR user_id = ANY($2::uuid[])`,
          [progId, userIdsToDelete]
        ).catch(() => {});
      } else {
        await client.query(`DELETE FROM identity.role_assignments WHERE program_id = $1`, [progId]).catch(() => {});
      }

      // 4. Delete interview assignments for this program
      await client.query(
        `DELETE FROM org.interview_assignments 
         WHERE institution_id = $1 AND (target_program_name = $2 OR target_program_names ? $2)`,
        [resolvedCollegeId, program.name]
      ).catch(() => {});

      // 5. Unlink students and delete batches
      await client.query(`UPDATE org.students SET batch_id = NULL, program_id = NULL WHERE program_id = $1`, [progId]).catch(() => {});
      await client.query(`DELETE FROM org.batches WHERE program_id = $1`, [progId]).catch(() => {});

      // 6. Delete users safely
      if (userIdsToDelete.length > 0) {
        await deleteUsersSafely(client, userIdsToDelete);
      }

      // 7. Delete the program
      await client.query(`DELETE FROM org.programs WHERE id = $1`, [progId]);

      await client.query('COMMIT');

      sendSuccess(res, {
        success: true,
        message: 'Program and associated administrator removed successfully',
        deletedAdminsCount: userIdsToDelete.length
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      sendError(res, err);
    } finally {
      client.release();
    }
  }
);

// ── GET /api/college/:collegeId/staff/:departmentName ────────────────────────
collegeRouter.get(
  '/:collegeId/staff/:departmentName',
  requireStaffOrAdmin,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { collegeId, departmentName } = req.params;

      const { rows } = await db.query(
        `SELECT
          ds.id,
          ds.name,
          ds.email,
          ds.staff_id,
          ds.designation,
          ds.department,
          ds.status,
          ds.assigned_classes,
          ds.created_at
        FROM org.department_staff ds
        WHERE ds.institution_id = $1
          AND ($2 = 'ALL' OR LOWER(ds.department) = LOWER($2))
        ORDER BY ds.name`,
        [collegeId, departmentName]
      );

      sendSuccess(res, rows);
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── POST /api/college/:collegeId/staff ──────────────────────────────────────
const addStaffSchema = z.object({
  name: z.string().min(2).max(255),
  email: z.string().email().transform(s => s.toLowerCase()),
  designation: z.string().min(2).max(255),
  staffId: z.string().optional(),
  department: z.string().min(2).max(255),
});

collegeRouter.post(
  '/:collegeId/staff',
  requireSuperAdminOrOwner,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const collegeId = await resolveCollegeId(req.params.collegeId);
      const parsed = addStaffSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(422, 'Validation failed', 'VALIDATION_ERROR');
      }

      const { name, email, designation, staffId, department } = parsed.data;

      // Check for duplicate email
      const { rows: existing } = await db.query(
        `SELECT id FROM org.department_staff WHERE email = $1`,
        [email]
      );

      if (existing.length > 0) {
        throw new AppError(409, 'Staff member with this email already exists', 'DUPLICATE_EMAIL');
      }

      // Create user account
      const passwordHash = await bcrypt.hash('welcome@2026', 10);
      const { rows: userRows } = await db.query(
        `INSERT INTO identity.users (name, email, password_hash, role, status, institution_id)
         VALUES ($1, $2, $3, 'COUNSELLOR', 'ACTIVE', $4)
         ON CONFLICT (email) DO UPDATE SET 
           role = CASE WHEN identity.users.role IN ('PLATFORM_OWNER', 'SUPER_ADMIN', 'DEPARTMENT_ADMIN', 'PROGRAM_ADMIN') THEN identity.users.role ELSE 'COUNSELLOR' END,
           name = COALESCE(identity.users.name, EXCLUDED.name),
           institution_id = COALESCE(identity.users.institution_id, EXCLUDED.institution_id)
         RETURNING id`,
        [name, email, passwordHash, collegeId]
      );

      // Create staff record
      const token = `act_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const { rows } = await db.query(
        `INSERT INTO org.department_staff
         (user_id, institution_id, department, name, email, staff_id, designation, status, activation_token)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', $8)
         RETURNING id, name, email, staff_id, designation, department, status, created_at`,
        [userRows[0].id, collegeId, department, name, email, staffId || null, designation, token]
      );

      const reqHost = req.get('host');
      const reqProtocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
      const origin = req.headers.origin || (req.headers.referer ? new URL(req.headers.referer as string).origin : undefined);
      const hostUrl = reqHost ? `${reqProtocol}://${reqHost}` : undefined;
      const baseUrl = (process.env.APP_URL && !process.env.APP_URL.includes('localhost')) 
        ? process.env.APP_URL 
        : (origin || hostUrl || process.env.APP_URL || 'http://52.66.240.211');
      const activationLink = `${baseUrl.replace(/\/+$/, '')}/?activateToken=${token}&email=${encodeURIComponent(email)}`;

      sendStaffWelcomeEmail({
        to: email,
        name,
        role: designation || 'COUNSELLOR',
        password: 'welcome@2026',
        createdBy: (req as AuthRequest).user?.name || 'Administrator',
        loginUrl: activationLink,
      }).catch((err) => console.error('[college.routes] Failed to send staff welcome email:', err));

      sendSuccess(res, { staff: rows[0], activationLink }, 201);
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── POST /api/college/:collegeId/staff/bulk ──────────────────────────────────
collegeRouter.post(
  '/:collegeId/staff/bulk',
  requireSuperAdminOrOwner,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const collegeId = await resolveCollegeId(req.params.collegeId);
      const { departmentName, csvContent } = req.body;

      if (!csvContent || typeof csvContent !== 'string') {
        throw new AppError(422, 'CSV content required', 'VALIDATION_ERROR');
      }

      const lines = csvContent.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
      const createdStaff: any[] = [];
      const errors: string[] = [];

      let startIdx = 0;
      if (lines.length > 0 && lines[0].toLowerCase().includes('name')) {
        startIdx = 1;
      }

      for (let i = startIdx; i < lines.length; i++) {
        const cols = lines[i].split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
        if (cols.length < 2) continue;

        const name = cols[0] || '';
        const email = cols[1] || '';
        const designation = cols[2] || 'Assistant Professor';
        const staffId = cols[3] || null;

        if (!name || !email || !email.includes('@')) {
          errors.push(`Row ${i + 1}: Invalid name or email`);
          continue;
        }

        try {
          const passwordHash = await bcrypt.hash('welcome@2026', 10);
          const { rows: userRows } = await db.query(
            `INSERT INTO identity.users (name, email, password_hash, role, status, institution_id)
             VALUES ($1, $2, $3, 'COUNSELLOR', 'ACTIVE', $4)
             ON CONFLICT (email) DO UPDATE SET 
               role = CASE WHEN identity.users.role IN ('PLATFORM_OWNER', 'SUPER_ADMIN', 'DEPARTMENT_ADMIN', 'PROGRAM_ADMIN') THEN identity.users.role ELSE 'COUNSELLOR' END,
               name = COALESCE(identity.users.name, EXCLUDED.name),
               institution_id = COALESCE(identity.users.institution_id, EXCLUDED.institution_id)
             RETURNING id`,
            [name, email.toLowerCase(), passwordHash, collegeId]
          );

          const token = `act_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 7)}`;
          const { rows } = await db.query(
            `INSERT INTO org.department_staff
             (user_id, institution_id, department, name, email, staff_id, designation, status, activation_token)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', $8)
             RETURNING id, name, email, staff_id, designation, department, status`,
            [userRows[0].id, collegeId, departmentName, name, email.toLowerCase(), staffId, designation, token]
          );

          createdStaff.push(rows[0]);

          sendStaffWelcomeEmail({
            to: email.toLowerCase(),
            name,
            role: designation || 'COUNSELLOR',
            password: 'welcome@2026',
            createdBy: (req as AuthRequest).user?.name || 'Administrator',
          }).catch((err) => console.error('[college.routes] Bulk staff email failed for ' + email + ':', err));
        } catch (err) {
          errors.push(`Row ${i + 1}: ${(err as Error).message}`);
        }
      }

      sendSuccess(res, { count: createdStaff.length, staff: createdStaff, errors }, 201);
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── DELETE /api/college/:collegeId/staff/:staffId ────────────────────────────
collegeRouter.delete(
  '/:collegeId/staff/:staffId',
  requireSuperAdminOrOwner,
  async (req: Request, res: Response): Promise<void> => {
    const client = await db.connect();
    try {
      const { staffId } = req.params;

      const { rows: staffRows } = await client.query(
        `SELECT id, user_id, email FROM org.department_staff WHERE id = $1`,
        [staffId]
      );
      if (staffRows.length === 0) {
        throw new AppError(404, 'Staff member not found', 'NOT_FOUND');
      }
      const staff = staffRows[0];

      await client.query('BEGIN');

      if (staff.user_id) {
        await deleteUsersSafely(client, [staff.user_id]);
      } else if (staff.email) {
        const { rows: uRows } = await client.query(`SELECT id FROM identity.users WHERE LOWER(email) = LOWER($1)`, [staff.email]);
        if (uRows.length > 0) {
          await deleteUsersSafely(client, [uRows[0].id]);
        }
      }

      if (staff.email) {
        await client.query(`DELETE FROM identity.pending_invites WHERE LOWER(email) = LOWER($1)`, [staff.email]).catch(() => {});
      }

      await client.query(`DELETE FROM org.department_staff WHERE id = $1`, [staffId]);

      await client.query('COMMIT');

      sendSuccess(res, { success: true, message: 'Staff member and user account removed successfully' });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      sendError(res, err);
    } finally {
      client.release();
    }
  }
);

// ── POST /api/college/:collegeId/staff/activate ──────────────────────────────
const activateStaffSchema = z.object({
  token: z.string(),
  email: z.string().email().transform(s => s.toLowerCase()),
  password: z.string().min(6),
});

collegeRouter.post(
  '/:collegeId/staff/activate',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = activateStaffSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(422, 'Validation failed', 'VALIDATION_ERROR');
      }

      const { token, email, password } = parsed.data;

      // Find staff record
      const { rows: staff } = await db.query(
        `SELECT id, user_id FROM org.department_staff
         WHERE activation_token = $1 OR email = $2`,
        [token, email]
      );

      if (staff.length === 0) {
        throw new AppError(404, 'Invalid activation token', 'NOT_FOUND');
      }

      // Update user password
      const passwordHash = await bcrypt.hash(password, 10);
      await db.query(
        `UPDATE identity.users SET password_hash = $1, status = 'ACTIVE' WHERE id = $2`,
        [passwordHash, staff[0].user_id]
      );

      // Update staff status
      await db.query(
        `UPDATE org.department_staff SET status = 'ACTIVE' WHERE id = $1`,
        [staff[0].id]
      );

      sendSuccess(res, { success: true });
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── GET /api/college/:collegeId/classes ──────────────────────────────────────
collegeRouter.get(
  '/:collegeId/classes',
  requireStaffOrAdmin,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const collegeId = await resolveCollegeId(req.params.collegeId);
      const deptFilter = req.query.department as string;

      let query = `
        SELECT
          id,
          institution_id AS college_id,
          department_id AS "departmentId",
          department,
          name,
          code,
          section,
          batch_year AS "batchYear",
          semester,
          faculty_in_charge AS "facultyInCharge",
          GREATEST(COALESCE(student_count, 0), (SELECT COUNT(*)::int FROM org.students s WHERE s.class_name = org.department_classes.name)) AS "enrolledStudentCount",
          COALESCE(student_ids, '[]'::jsonb) AS "studentIds",
          created_at AS "createdAt"
        FROM org.department_classes
        WHERE institution_id = $1
      `;
      const params: any[] = [collegeId];

      if (deptFilter && deptFilter !== 'ALL') {
        params.push(deptFilter);
        query += ` AND (LOWER(department) = LOWER($2) OR department ILIKE '%' || $2 || '%')`;
      }

      query += ` ORDER BY batch_year DESC, name ASC`;

      const { rows } = await db.query(query, params);
      sendSuccess(res, rows);
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── POST /api/college/:collegeId/classes ─────────────────────────────────────
const createClassSchema = z.object({
  name: z.string().min(2).max(255),
  department: z.string().min(2).max(255),
  batchYear: z.number().int().min(2000).max(2100).optional(),
  semester: z.string().optional(),
  facultyInCharge: z.string().optional(),
  studentCount: z.number().int().optional(),
  studentIds: z.array(z.string()).optional(),
  code: z.string().optional(),
  section: z.string().optional(),
});

collegeRouter.post(
  '/:collegeId/classes',
  requireSuperAdminOrOwner,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const collegeId = await resolveCollegeId(req.params.collegeId);
      const parsed = createClassSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(422, 'Validation failed', 'VALIDATION_ERROR');
      }

      const { name, department, batchYear, semester, facultyInCharge, studentCount, studentIds, code, section } = parsed.data;

      const { rows } = await db.query(
        `INSERT INTO org.department_classes
          (institution_id, department, name, code, section, batch_year, semester, faculty_in_charge, student_count, student_ids)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING
           id,
           institution_id AS college_id,
           department,
           name,
           code,
           section,
           batch_year AS "batchYear",
           semester,
           faculty_in_charge AS "facultyInCharge",
           student_count AS "enrolledStudentCount",
           student_ids AS "studentIds",
           created_at AS "createdAt"`,
        [
          collegeId,
          department,
          name,
          code || null,
          section || null,
          batchYear || 2028,
          semester || 'Semester 5',
          facultyInCharge || null,
          studentCount || 0,
          JSON.stringify(studentIds || [])
        ]
      );

      sendSuccess(res, rows[0], 201);
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── PATCH /api/college/:collegeId/classes/:classId ───────────────────────────
collegeRouter.patch(
  '/:collegeId/classes/:classId',
  requireSuperAdminOrOwner,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { classId } = req.params;
      const { name, department, batchYear, semester, facultyInCharge, studentCount, studentIds } = req.body;

      const updates: string[] = [];
      const values: any[] = [];
      let paramIdx = 1;

      if (name !== undefined) {
        updates.push(`name = $${paramIdx++}`);
        values.push(name);
      }
      if (department !== undefined) {
        updates.push(`department = $${paramIdx++}`);
        values.push(department);
      }
      if (batchYear !== undefined) {
        updates.push(`batch_year = $${paramIdx++}`);
        values.push(batchYear);
      }
      if (semester !== undefined) {
        updates.push(`semester = $${paramIdx++}`);
        values.push(semester);
      }
      if (facultyInCharge !== undefined) {
        updates.push(`faculty_in_charge = $${paramIdx++}`);
        values.push(facultyInCharge);
      }
      if (studentCount !== undefined) {
        updates.push(`student_count = $${paramIdx++}`);
        values.push(studentCount);
      }
      if (studentIds !== undefined) {
        updates.push(`student_ids = $${paramIdx++}`);
        values.push(JSON.stringify(studentIds));
      }

      if (updates.length > 0) {
        updates.push(`updated_at = now()`);
        values.push(classId);
        await db.query(
          `UPDATE org.department_classes SET ${updates.join(', ')} WHERE id = $${paramIdx}`,
          values
        );
      }

      const { rows } = await db.query(
        `SELECT
          id,
          institution_id AS college_id,
          department,
          name,
          code,
          section,
          batch_year AS "batchYear",
          semester,
          faculty_in_charge AS "facultyInCharge",
          COALESCE(student_count, 0) AS "enrolledStudentCount",
          COALESCE(student_ids, '[]'::jsonb) AS "studentIds",
          created_at AS "createdAt"
        FROM org.department_classes WHERE id = $1`,
        [classId]
      );

      sendSuccess(res, rows[0]);
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── DELETE /api/college/:collegeId/classes/:classId ──────────────────────────
collegeRouter.delete(
  '/:collegeId/classes/:classId',
  requireSuperAdminOrOwner,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { classId } = req.params;
      await db.query(`DELETE FROM org.department_classes WHERE id = $1`, [classId]);
      sendSuccess(res, { success: true });
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── POST /api/college/:collegeId/classes/bulk ────────────────────────────────
collegeRouter.post(
  '/:collegeId/classes/bulk',
  requireSuperAdminOrOwner,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const collegeId = await resolveCollegeId(req.params.collegeId);
      const { csvContent, defaultDepartment, defaultBatchYear } = req.body;

      if (!csvContent || typeof csvContent !== 'string') {
        throw new AppError(422, 'CSV content required', 'VALIDATION_ERROR');
      }

      const lines = csvContent.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
      const created: any[] = [];
      const errors: string[] = [];

      let startIdx = 0;
      let headerCols: string[] = [];

      if (lines.length > 0) {
        const first = lines[0].toLowerCase();
        if (first.includes('name') || first.includes('class') || first.includes('dept') || first.includes('batch')) {
          headerCols = lines[0].split(',').map(c => c.trim().toLowerCase().replace(/["']/g, ''));
          startIdx = 1;
        }
      }

      for (let i = startIdx; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;
        const cols = line.split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
        if (cols.length < 1) continue;

        let name = '';
        let department = defaultDepartment || 'Information Technology';
        let batchYear = defaultBatchYear || 2028;
        let semester = 'Semester 5';
        let faculty = '';

        if (headerCols.length > 0) {
          headerCols.forEach((col, idx) => {
            const val = cols[idx] || '';
            if (col.includes('name') || col.includes('class')) name = val;
            else if (col.includes('dept') || col.includes('department')) department = val;
            else if (col.includes('batch') || col.includes('year')) {
              const num = parseInt(val, 10);
              if (!isNaN(num) && num >= 2000) batchYear = num;
            }
            else if (col.includes('sem')) semester = val;
            else if (col.includes('fac') || col.includes('incharge') || col.includes('teacher')) faculty = val;
          });
        } else {
          name = cols[0] || '';
          if (cols.length >= 2 && cols[1]) department = cols[1];
          if (cols.length >= 3) {
            const num = parseInt(cols[2], 10);
            if (!isNaN(num) && num >= 2000) batchYear = num;
          }
          if (cols.length >= 4 && cols[3]) semester = cols[3];
          if (cols.length >= 5 && cols[4]) faculty = cols[4];
        }

        if (!name.trim()) {
          errors.push(`Row ${i + 1}: Class name is required.`);
          continue;
        }

        try {
          const { rows } = await db.query(
            `INSERT INTO org.department_classes
              (institution_id, department, name, batch_year, semester, faculty_in_charge, student_count, student_ids)
             VALUES ($1, $2, $3, $4, $5, $6, 0, '[]'::jsonb)
             RETURNING
               id,
               institution_id AS college_id,
               department,
               name,
               batch_year AS "batchYear",
               semester,
               faculty_in_charge AS "facultyInCharge",
               student_count AS "enrolledStudentCount",
               student_ids AS "studentIds",
               created_at AS "createdAt"`,
            [collegeId, department.trim(), name.trim(), batchYear, semester.trim(), faculty.trim() || null]
          );
          created.push(rows[0]);
        } catch (err) {
          errors.push(`Row ${i + 1}: ${(err as Error).message}`);
        }
      }

      sendSuccess(res, { created: created.length, classes: created, errors }, 201);
    } catch (err) {
      sendError(res, err);
    }
  }
);

