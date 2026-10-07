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

// Most routes require SUPER_ADMIN or higher
const requireSuperAdminOrOwner = requireRole('SUPER_ADMIN', 'PLATFORM_OWNER');

// ── GET /api/college/:collegeId/details ──────────────────────────────────────
collegeRouter.get(
  '/:collegeId/details',
  requireSuperAdminOrOwner,
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
  requireSuperAdminOrOwner,
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
          `INSERT INTO identity.users (name, email, password_hash, role, status)
           VALUES ($1, $2, $3, 'DEPARTMENT_ADMIN', 'ACTIVE')
           ON CONFLICT (email) DO UPDATE SET role = 'DEPARTMENT_ADMIN'
           RETURNING id`,
          [assignedAdminName || name + ' Admin', assignedAdminEmail, passwordHash]
        );

        // Create staff record
        await db.query(
          `INSERT INTO org.department_staff
           (user_id, institution_id, department_id, department, name, email, designation, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'Department Admin', 'ACTIVE')`,
          [userRows[0].id, collegeId, department.id, name, assignedAdminName || name + ' Admin', assignedAdminEmail]
        );

        sendStaffWelcomeEmail({
          to: assignedAdminEmail,
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

// ── DELETE /api/college/:collegeId/departments/:deptId ───────────────────────
collegeRouter.delete(
  '/:collegeId/departments/:deptId',
  requireSuperAdminOrOwner,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { deptId } = req.params;

      const { rowCount } = await db.query(
        `DELETE FROM org.departments WHERE id = $1`,
        [deptId]
      );

      if (rowCount === 0) {
        throw new AppError(404, 'Department not found', 'NOT_FOUND');
      }

      sendSuccess(res, { success: true });
    } catch (err) {
      sendError(res, err);
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
  requireSuperAdminOrOwner,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { collegeId } = req.params;
      const { rows } = await db.query(
        `SELECT id, institution_id AS college_id, name, code, created_at FROM org.programs
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
  name: z.string().min(3).max(255),
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
      const { collegeId } = req.params;
      const parsed = createProgramSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(422, 'Validation failed', 'VALIDATION_ERROR');
      }

      const { name, code } = parsed.data;

      const { rows } = await db.query(
        `INSERT INTO org.programs (institution_id, name, code)
         VALUES ($1, $2, $3)
         RETURNING id, institution_id AS college_id, name, code, created_at`,
        [collegeId, name, code]
      );

      sendSuccess(res, rows[0], 201);
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── GET /api/college/:collegeId/staff/:departmentName ────────────────────────
collegeRouter.get(
  '/:collegeId/staff/:departmentName',
  requireSuperAdminOrOwner,
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
        `INSERT INTO identity.users (name, email, password_hash, role, status)
         VALUES ($1, $2, $3, 'COUNSELLOR', 'ACTIVE')
         ON CONFLICT (email) DO UPDATE SET role = 'COUNSELLOR'
         RETURNING id`,
        [name, email, passwordHash]
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

      const activationLink = `${process.env.APP_URL || 'http://localhost:5173'}?activateToken=${token}&email=${encodeURIComponent(email)}`;

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
            `INSERT INTO identity.users (name, email, password_hash, role, status)
             VALUES ($1, $2, $3, 'COUNSELLOR', 'ACTIVE')
             ON CONFLICT (email) DO UPDATE SET role = 'COUNSELLOR'
             RETURNING id`,
            [name, email.toLowerCase(), passwordHash]
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
    try {
      const { staffId } = req.params;

      const { rowCount } = await db.query(
        `DELETE FROM org.department_staff WHERE id = $1`,
        [staffId]
      );

      if (rowCount === 0) {
        throw new AppError(404, 'Staff member not found', 'NOT_FOUND');
      }

      sendSuccess(res, { success: true });
    } catch (err) {
      sendError(res, err);
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
