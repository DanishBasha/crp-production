import { Router, Request, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { db } from '../shared/db/pool';
import { AppError } from '../shared/errors/AppError';
import { sendSuccess, sendError } from '../shared/helpers/response';
import { AuthRequest } from '../middleware/authenticate';
import { requireRole } from '../middleware/authorize';
import { sendStaffWelcomeEmail } from '../services/emailService';

export const studentBatchRouter = Router();

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

// All routes require SUPER_ADMIN, PROGRAM_ADMIN, or PLATFORM_OWNER
const requireAdminOrOwner = requireRole('SUPER_ADMIN', 'PROGRAM_ADMIN', 'PLATFORM_OWNER');

// ── POST /api/studentBatch/:collegeId/bulk-import ────────────────────────────
studentBatchRouter.post(
  '/:collegeId/bulk-import',
  requireAdminOrOwner,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const collegeId = await resolveCollegeId(req.params.collegeId);
      const { csvContent, defaultBatchYear } = req.body;

      if (!csvContent || typeof csvContent !== 'string') {
        throw new AppError(422, 'CSV content required', 'VALIDATION_ERROR');
      }

      const batchYear = defaultBatchYear || new Date().getFullYear();
      const lines = csvContent.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
      const imported: any[] = [];
      const errors: string[] = [];

      let startIdx = 0;
      let headerCols: string[] = [];

      // Detect header
      if (lines.length > 0) {
        const first = lines[0].toLowerCase();
        if (first.includes('name') || first.includes('email') || first.includes('roll')) {
          headerCols = lines[0].split(',').map(c => c.trim().toLowerCase().replace(/["']/g, ''));
          startIdx = 1;
        }
      }

      // Create or get default program and batch
      const { rows: programs } = await db.query(
        `SELECT id FROM org.programs WHERE institution_id = $1 LIMIT 1`,
        [collegeId]
      );

      let programId: string;
      if (programs.length === 0) {
        const { rows: newProg } = await db.query(
          `INSERT INTO org.programs (institution_id, name, code)
           VALUES ($1, 'General Program', 'GEN')
           RETURNING id`,
          [collegeId]
        );
        programId = newProg[0].id;
      } else {
        programId = programs[0].id;
      }

      const { rows: batches } = await db.query(
        `SELECT id FROM org.batches WHERE program_id = $1 AND year = $2`,
        [programId, batchYear]
      );

      let batchId: string;
      if (batches.length === 0) {
        const { rows: newBatch } = await db.query(
          `INSERT INTO org.batches (program_id, name, year, track)
           VALUES ($1, $2, $3, 'General')
           RETURNING id`,
          [programId, `Batch ${batchYear}`, batchYear]
        );
        batchId = newBatch[0].id;
      } else {
        batchId = batches[0].id;
      }

      for (let i = startIdx; i < lines.length; i++) {
        const cols = lines[i].split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
        if (cols.length < 2) continue;

        let name = cols[0] || '';
        let email = '';
        let rollNumber = '';
        let department = '';
        let programName = '';

        // Parse based on headers or positions
        if (headerCols.length > 0) {
          headerCols.forEach((col, idx) => {
            const val = cols[idx] || '';
            if (col.includes('name') && !col.includes('program')) name = val;
            else if (col.includes('email') || col.includes('mail')) email = val;
            else if (col.includes('roll')) rollNumber = val;
            else if (col.includes('dept') || col.includes('department')) department = val;
            else if (col.includes('program')) programName = val;
          });
        } else {
          email = cols[1] || '';
          if (cols.length >= 3) rollNumber = cols[2];
          if (cols.length >= 4) department = cols[3];
        }

        // Fallback: find email in any column
        if (!email) {
          email = cols.find(c => c.includes('@')) || '';
        }

        if (!name || !email || !email.includes('@')) {
          errors.push(`Row ${i + 1}: Missing name or valid email`);
          continue;
        }

        if (!rollNumber) {
          rollNumber = `STU${Date.now().toString(36).toUpperCase().slice(-6)}`;
        }

        try {
          // Create user
          const passwordHash = await bcrypt.hash('student123', 10);
          const { rows: userRows } = await db.query(
            `INSERT INTO identity.users (name, email, password_hash, role, status)
             VALUES ($1, $2, $3, 'STUDENT', 'ACTIVE')
             ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
             RETURNING id`,
            [name.trim(), email.toLowerCase().trim(), passwordHash]
          );

          // Create student
          const { rows: studentRows } = await db.query(
            `INSERT INTO org.students (user_id, program_id, batch_id, roll_number)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (roll_number) DO UPDATE SET user_id = EXCLUDED.user_id
             RETURNING id, roll_number`,
            [userRows[0].id, programId, batchId, rollNumber.trim().toUpperCase()]
          );

          imported.push({
            id: studentRows[0].id,
            name: name.trim(),
            email: email.toLowerCase().trim(),
            rollNumber: studentRows[0].roll_number,
            department: department || 'General',
            batchYear,
          });

          sendStaffWelcomeEmail({
            to: email.toLowerCase().trim(),
            name: name.trim(),
            role: 'STUDENT',
            password: 'welcome@2026',
            createdBy: (req as AuthRequest).user?.name || 'Administrator',
          }).catch((err) => console.error('[studentBatch] Email failed for student ' + email + ':', err));
        } catch (err) {
          errors.push(`Row ${i + 1}: ${(err as Error).message}`);
        }
      }

      sendSuccess(res, {
        count: imported.length,
        students: imported,
        assignedToProgramCount: imported.length,
        assignedToDepartmentCount: 0,
        errors,
      }, 201);
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── POST /api/studentBatch/:collegeId/purge-batch ────────────────────────────
const purgeBatchSchema = z.object({
  batchYear: z.number().int().min(2000).max(2100),
  confirmation: z.string(),
});

studentBatchRouter.post(
  '/:collegeId/purge-batch',
  requireAdminOrOwner,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { collegeId } = req.params;
      const parsed = purgeBatchSchema.safeParse(req.body);

      if (!parsed.success) {
        throw new AppError(422, 'Validation failed', 'VALIDATION_ERROR');
      }

      const { batchYear, confirmation } = parsed.data;

      // Verify confirmation
      const validConfirmations = [
        `PURGE ${batchYear}`,
        `DELETE ${batchYear}`,
        String(batchYear),
      ];

      if (!validConfirmations.includes(confirmation.trim().toUpperCase())) {
        throw new AppError(
          422,
          `Safeguard Verification Failed: You must type "PURGE ${batchYear}" to confirm permanent removal.`,
          'INVALID_CONFIRMATION'
        );
      }

      // Count students to be purged
      const { rows: countRows } = await db.query(
        `SELECT COUNT(*) AS count
         FROM org.students s
         JOIN org.batches b ON b.id = s.batch_id
         JOIN org.programs p ON p.id = b.program_id
         WHERE p.institution_id = $1 AND b.year = $2`,
        [collegeId, batchYear]
      );

      const purgedCount = parseInt(countRows[0].count);

      if (purgedCount === 0) {
        throw new AppError(404, `No students found for batch ${batchYear}`, 'NOT_FOUND');
      }

      // Delete students (cascades to other tables)
      await db.query(
        `DELETE FROM org.students s
         USING org.batches b, org.programs p
         WHERE s.batch_id = b.id
           AND b.program_id = p.id
           AND p.institution_id = $1
           AND b.year = $2`,
        [collegeId, batchYear]
      );

      sendSuccess(res, {
        purgedCount,
        batchYear,
        message: `Successfully purged ${purgedCount} graduated candidates from Batch ${batchYear}.`,
      });
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── POST /api/studentBatch/:collegeId/bulk-enroll ────────────────────────────
studentBatchRouter.post(
  '/:collegeId/bulk-enroll',
  requireAdminOrOwner,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { collegeId } = req.params;
      const { csvContent } = req.body;

      // Reuse bulk-import logic
      const result = await studentBatchRouter.stack[0].handle(req, res, () => {});
      return;
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── POST /api/studentBatch/:collegeId/enroll-single ──────────────────────────
const enrollSingleSchema = z.object({
  name: z.string().min(2).max(255),
  email: z.string().email().transform(s => s.toLowerCase()),
  rollNumber: z.string().min(2).max(100).transform(s => s.toUpperCase()),
  password: z.string().optional(),
  department: z.string().optional(),
  batchYear: z.number().int().optional(),
  programName: z.string().optional(),
  subProgramName: z.string().optional(),
});

studentBatchRouter.post(
  ['/:collegeId/enroll-single', '/:collegeId/students'],
  requireAdminOrOwner,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const collegeId = await resolveCollegeId(req.params.collegeId);
      const parsed = enrollSingleSchema.safeParse(req.body);

      if (!parsed.success) {
        throw new AppError(422, 'Validation failed', 'VALIDATION_ERROR');
      }

      const { name, email, rollNumber, password, batchYear } = parsed.data;

      // Get or create default program/batch
      const year = batchYear || new Date().getFullYear();
      const { rows: programs } = await db.query(
        `SELECT id FROM org.programs WHERE institution_id = $1 LIMIT 1`,
        [collegeId]
      );

      let programId: string;
      if (programs.length === 0) {
        const { rows: newProg } = await db.query(
          `INSERT INTO org.programs (institution_id, name, code)
           VALUES ($1, 'General Program', 'GEN')
           RETURNING id`,
          [collegeId]
        );
        programId = newProg[0].id;
      } else {
        programId = programs[0].id;
      }

      const { rows: batches } = await db.query(
        `SELECT id FROM org.batches WHERE program_id = $1 AND year = $2`,
        [programId, year]
      );

      let batchId: string;
      if (batches.length === 0) {
        const { rows: newBatch } = await db.query(
          `INSERT INTO org.batches (program_id, name, year, track)
           VALUES ($1, $2, $3, 'General')
           RETURNING id`,
          [programId, `Batch ${year}`, year]
        );
        batchId = newBatch[0].id;
      } else {
        batchId = batches[0].id;
      }

      // Create user
      const passwordHash = await bcrypt.hash(password || 'welcome@2026', 10);
      const { rows: userRows } = await db.query(
        `INSERT INTO identity.users (name, email, password_hash, role, status)
         VALUES ($1, $2, $3, 'STUDENT', 'ACTIVE')
         RETURNING id`,
        [name, email, passwordHash]
      );

      // Create student
      const { rows: studentRows } = await db.query(
        `INSERT INTO org.students (user_id, program_id, batch_id, roll_number)
         VALUES ($1, $2, $3, $4)
         RETURNING id, roll_number`,
        [userRows[0].id, programId, batchId, rollNumber]
      );

      sendStaffWelcomeEmail({
        to: email,
        name,
        role: 'STUDENT',
        password: password || 'welcome@2026',
        createdBy: (req as AuthRequest).user?.name || 'Administrator',
      }).catch((err) => console.error('[studentBatch] Email failed for single student ' + email + ':', err));

      sendSuccess(res, {
        id: studentRows[0].id,
        name,
        email,
        rollNumber: studentRows[0].roll_number,
        batchYear: year,
      }, 201);
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── PATCH /api/studentBatch/:collegeId/students/:studentId ───────────────────
const updateStudentSchema = z.object({
  name: z.string().optional(),
  email: z.string().email().transform(s => s.toLowerCase()).optional(),
  rollNumber: z.string().transform(s => s.toUpperCase()).optional(),
  department: z.string().optional(),
  programName: z.string().optional(),
  batchYear: z.number().int().optional(),
  password: z.string().optional(),
});

studentBatchRouter.patch(
  '/:collegeId/students/:studentId',
  requireAdminOrOwner,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { studentId } = req.params;
      const parsed = updateStudentSchema.safeParse(req.body);

      if (!parsed.success) {
        throw new AppError(422, 'Validation failed', 'VALIDATION_ERROR');
      }

      const updates = parsed.data;

      // Get student's user_id
      const { rows: students } = await db.query(
        `SELECT user_id FROM org.students WHERE id = $1`,
        [studentId]
      );

      if (students.length === 0) {
        throw new AppError(404, 'Student not found', 'NOT_FOUND');
      }

      const userId = students[0].user_id;

      // Update user table
      if (updates.name || updates.email || updates.password) {
        const userUpdates: string[] = [];
        const userValues: any[] = [];
        let paramIndex = 1;

        if (updates.name) {
          userUpdates.push(`name = $${paramIndex++}`);
          userValues.push(updates.name);
        }
        if (updates.email) {
          userUpdates.push(`email = $${paramIndex++}`);
          userValues.push(updates.email);
        }
        if (updates.password) {
          const passwordHash = await bcrypt.hash(updates.password, 10);
          userUpdates.push(`password_hash = $${paramIndex++}`);
          userValues.push(passwordHash);
        }

        if (userUpdates.length > 0) {
          userValues.push(userId);
          await db.query(
            `UPDATE identity.users SET ${userUpdates.join(', ')}, updated_at = now()
             WHERE id = $${paramIndex}`,
            userValues
          );
        }
      }

      // Update student table
      if (updates.rollNumber) {
        await db.query(
          `UPDATE org.students SET roll_number = $1, updated_at = now() WHERE id = $2`,
          [updates.rollNumber, studentId]
        );
      }

      sendSuccess(res, { message: 'Student updated successfully' });
    } catch (err) {
      sendError(res, err);
    }
  }
);
