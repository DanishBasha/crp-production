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

      // Pre-validation: ensure all referenced departments and programs exist
      const { rows: existingDepts } = await db.query(
        `SELECT LOWER(TRIM(name)) AS name FROM org.departments WHERE institution_id = $1`,
        [collegeId]
      );
      const availableDeptNames = new Set(existingDepts.map(d => d.name));

      const { rows: existingProgs } = await db.query(
        `SELECT LOWER(TRIM(name)) AS name FROM org.programs WHERE institution_id = $1`,
        [collegeId]
      );
      const availableProgNames = new Set(existingProgs.map(p => p.name));

      const missingDepts = new Set<string>();
      const missingProgs = new Set<string>();

      for (let i = startIdx; i < lines.length; i++) {
        const cols = lines[i].split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
        if (cols.length < 2) continue;
        let deptVal = '';
        let progVal = '';
        if (headerCols.length > 0) {
          headerCols.forEach((col, idx) => {
            const val = cols[idx] || '';
            if (col.includes('dept') || col.includes('department')) deptVal = val.trim();
            else if (col.includes('program')) progVal = val.trim();
          });
        } else {
          if (cols.length >= 4) deptVal = cols[3]?.trim();
        }

        if (deptVal && availableDeptNames.size > 0 && !availableDeptNames.has(deptVal.toLowerCase())) {
          missingDepts.add(deptVal);
        }
        if (progVal && availableProgNames.size > 0 && !availableProgNames.has(progVal.toLowerCase())) {
          missingProgs.add(progVal);
        }
      }

      if (missingDepts.size > 0) {
        throw new AppError(
          422,
          `The following department(s) are not available in your institution: ${Array.from(missingDepts).join(', ')}. Please first add these departments and try again.`,
          'MISSING_DATA'
        );
      }
      if (missingProgs.size > 0) {
        throw new AppError(
          422,
          `The following program(s) are not available in your institution: ${Array.from(missingProgs).join(', ')}. Please first add these programs and try again.`,
          'MISSING_DATA'
        );
      }

      for (let i = startIdx; i < lines.length; i++) {
        const cols = lines[i].split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
        if (cols.length < 2) continue;

        let name = cols[0] || '';
        let email = '';
        let rollNumber = '';
        let department = '';
        let programName = '';
        let className = '';

        // Parse based on headers or positions
        if (headerCols.length > 0) {
          headerCols.forEach((col, idx) => {
            const val = cols[idx] || '';
            if (col.includes('name') && !col.includes('program')) name = val;
            else if (col.includes('email') || col.includes('mail')) email = val;
            else if (col.includes('roll')) rollNumber = val;
            else if (col.includes('dept') || col.includes('department')) department = val;
            else if (col.includes('program')) programName = val;
            else if (col.includes('class') || col.includes('section')) className = val;
          });
        } else {
          email = cols[1] || '';
          if (cols.length >= 3) rollNumber = cols[2];
          if (cols.length >= 4) department = cols[3];
          if (cols.length >= 5) className = cols[4];
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
          // Create or update user
          const passwordHash = await bcrypt.hash('student123', 10);
          const { rows: userRows } = await db.query(
            `INSERT INTO identity.users (name, email, password_hash, role, status, institution_id)
             VALUES ($1, $2, $3, 'STUDENT', 'ACTIVE', $4)
             ON CONFLICT (email) DO UPDATE SET 
               name = EXCLUDED.name,
               institution_id = EXCLUDED.institution_id
             RETURNING id`,
            [name.trim(), email.toLowerCase().trim(), passwordHash, collegeId]
          );

          // Safe check to avoid partial index ON CONFLICT failure
          const { rows: existingStudents } = await db.query(
            `SELECT id FROM org.students 
             WHERE user_id = $1 OR (roll_number IS NOT NULL AND roll_number = $2) 
             LIMIT 1`,
            [userRows[0].id, rollNumber.trim().toUpperCase()]
          );

          let studentId: string;
          let finalRoll: string;

          if (existingStudents.length > 0) {
            const { rows: updatedStudents } = await db.query(
              `UPDATE org.students SET
                 user_id = $1,
                 program_id = $2,
                 batch_id = $3,
                 roll_number = $4,
                 department = $5,
                 batch_year = $6,
                 track = $7,
                 program_name = $8,
                 class_name = COALESCE($9, class_name),
                 updated_at = now()
               WHERE id = $10
               RETURNING id, roll_number`,
              [
                userRows[0].id,
                programId,
                batchId,
                rollNumber.trim().toUpperCase(),
                department || 'Computer Science & Engineering',
                batchYear,
                programName || department || 'General Track',
                programName || null,
                className || null,
                existingStudents[0].id,
              ]
            );
            studentId = updatedStudents[0].id;
            finalRoll = updatedStudents[0].roll_number;
          } else {
            const { rows: insertedStudents } = await db.query(
              `INSERT INTO org.students (user_id, program_id, batch_id, roll_number, department, batch_year, track, program_name, class_name)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
               RETURNING id, roll_number`,
              [
                userRows[0].id,
                programId,
                batchId,
                rollNumber.trim().toUpperCase(),
                department || 'Computer Science & Engineering',
                batchYear,
                programName || department || 'General Track',
                programName || null,
                className || null,
              ]
            );
            studentId = insertedStudents[0].id;
            finalRoll = insertedStudents[0].roll_number;
          }

          if (className) {
            await db.query(
              `INSERT INTO org.department_classes (institution_id, department, name, batch_year, semester, student_count)
               VALUES ($1, $2, $3, $4, 'Current Semester', 1)
               ON CONFLICT DO NOTHING`,
              [collegeId, department || 'Computer Science & Engineering', className.trim(), batchYear]
            ).catch(() => {});
          }

          await db.query(
            `INSERT INTO identity.role_assignments (user_id, role, institution_id, program_id, batch_id)
             VALUES ($1, 'STUDENT', $2, $3, $4)
             ON CONFLICT DO NOTHING`,
            [userRows[0].id, collegeId, programId, batchId]
          ).catch(() => {});

          imported.push({
            id: studentId,
            name: name.trim(),
            email: email.toLowerCase().trim(),
            rollNumber: finalRoll,
            department: department || 'Computer Science & Engineering',
            className: className || null,
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

      const assignedToDeptCount = imported.filter(s => !!s.department).length;

      sendSuccess(res, {
        count: imported.length,
        students: imported,
        assignedToProgramCount: imported.length,
        assignedToDepartmentCount: assignedToDeptCount,
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
  className: z.string().optional(),
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

      const { name, email, rollNumber, password, batchYear, className } = parsed.data;

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

      // Create or update user
      const passwordHash = await bcrypt.hash(password || 'welcome@2026', 10);
      const { rows: userRows } = await db.query(
        `INSERT INTO identity.users (name, email, password_hash, role, status, institution_id)
         VALUES ($1, $2, $3, 'STUDENT', 'ACTIVE', $4)
         ON CONFLICT (email) DO UPDATE SET
           name = EXCLUDED.name,
           institution_id = EXCLUDED.institution_id
         RETURNING id`,
        [name, email, passwordHash, collegeId]
      );

      // Create or update student safely
      const track = parsed.data.programName
        ? (parsed.data.subProgramName ? `${parsed.data.programName} (${parsed.data.subProgramName})` : parsed.data.programName)
        : (parsed.data.department || 'General Department');

      const { rows: existingStudents } = await db.query(
        `SELECT id FROM org.students 
         WHERE user_id = $1 OR (roll_number IS NOT NULL AND roll_number = $2)
         LIMIT 1`,
        [userRows[0].id, rollNumber]
      );

      let studentId: string;
      let finalRoll: string;

      if (existingStudents.length > 0) {
        const { rows: updatedStudents } = await db.query(
          `UPDATE org.students SET
             user_id = $1,
             program_id = $2,
             batch_id = $3,
             roll_number = $4,
             department = $5,
             batch_year = $6,
             track = $7,
             program_name = $8,
             sub_program_name = $9,
             class_name = COALESCE($10, class_name),
             updated_at = now()
           WHERE id = $11
           RETURNING id, roll_number`,
          [
            userRows[0].id,
            programId,
            batchId,
            rollNumber,
            parsed.data.department || 'Computer Science & Engineering',
            year,
            track,
            parsed.data.programName || null,
            parsed.data.subProgramName || null,
            className || null,
            existingStudents[0].id,
          ]
        );
        studentId = updatedStudents[0].id;
        finalRoll = updatedStudents[0].roll_number;
      } else {
        const { rows: insertedStudents } = await db.query(
          `INSERT INTO org.students (user_id, program_id, batch_id, roll_number, department, batch_year, track, program_name, sub_program_name, class_name)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING id, roll_number`,
          [
            userRows[0].id,
            programId,
            batchId,
            rollNumber,
            parsed.data.department || 'Computer Science & Engineering',
            year,
            track,
            parsed.data.programName || null,
            parsed.data.subProgramName || null,
            className || null,
          ]
        );
        studentId = insertedStudents[0].id;
        finalRoll = insertedStudents[0].roll_number;
      }

      if (className) {
        await db.query(
          `INSERT INTO org.department_classes (institution_id, department, name, batch_year, semester, student_count)
           VALUES ($1, $2, $3, $4, 'Current Semester', 1)
           ON CONFLICT DO NOTHING`,
          [collegeId, parsed.data.department || 'Computer Science & Engineering', className.trim(), year]
        ).catch(() => {});
      }

      await db.query(
        `INSERT INTO identity.role_assignments (user_id, role, institution_id, program_id, batch_id)
         VALUES ($1, 'STUDENT', $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [userRows[0].id, collegeId, programId, batchId]
      ).catch(() => {});

      sendStaffWelcomeEmail({
        to: email,
        name,
        role: 'STUDENT',
        password: password || 'welcome@2026',
        createdBy: (req as AuthRequest).user?.name || 'Administrator',
      }).catch((err) => console.error('[studentBatch] Email failed for single student ' + email + ':', err));

      sendSuccess(res, {
        id: studentId,
        name,
        email,
        rollNumber: finalRoll,
        department: parsed.data.department || 'Computer Science & Engineering',
        className: className || null,
        batchYear: year,
        track,
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
  className: z.string().optional(),
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
      const stuUpdates: string[] = [];
      const stuValues: any[] = [];
      let sIdx = 1;

      if (updates.rollNumber) {
        stuUpdates.push(`roll_number = $${sIdx++}`);
        stuValues.push(updates.rollNumber);
      }
      if (updates.department) {
        stuUpdates.push(`department = $${sIdx++}`);
        stuValues.push(updates.department);
      }
      if (updates.programName) {
        stuUpdates.push(`program_name = $${sIdx++}`);
        stuValues.push(updates.programName);
        stuUpdates.push(`track = $${sIdx++}`);
        stuValues.push(updates.programName);
      }
      if (updates.batchYear) {
        stuUpdates.push(`batch_year = $${sIdx++}`);
        stuValues.push(updates.batchYear);
      }
      if (updates.className) {
        stuUpdates.push(`class_name = $${sIdx++}`);
        stuValues.push(updates.className);
      }

      if (stuUpdates.length > 0) {
        stuUpdates.push(`updated_at = now()`);
        stuValues.push(studentId);
        await db.query(
          `UPDATE org.students SET ${stuUpdates.join(', ')} WHERE id = $${sIdx}`,
          stuValues
        );
      }

      sendSuccess(res, { message: 'Student updated successfully' });
    } catch (err) {
      sendError(res, err);
    }
  }
);

// ── DELETE /api/studentBatch/:collegeId/students/:studentId ──────────────────
studentBatchRouter.delete(
  '/:collegeId/students/:studentId',
  requireAdminOrOwner,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { studentId } = req.params;
      const { rows } = await db.query(`SELECT user_id FROM org.students WHERE id = $1`, [studentId]);
      if (rows.length > 0) {
        await db.query(`DELETE FROM identity.users WHERE id = $1`, [rows[0].user_id]);
      }
      await db.query(`DELETE FROM org.students WHERE id = $1`, [studentId]);
      sendSuccess(res, { success: true, message: 'Student removed successfully' });
    } catch (err) {
      sendError(res, err);
    }
  }
);
