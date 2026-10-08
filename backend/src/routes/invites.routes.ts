import { Router, Request, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../shared/db/pool';
import { AppError } from '../shared/errors/AppError';
import { sendSuccess, sendError } from '../shared/helpers/response';
import { env } from '../config/env';
import { AuthUser } from '../shared/types/auth';

export const invitesRouter = Router();

// ── GET /api/invites ─────────────────────────────────────────────────────────
invitesRouter.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    const { rows } = await db.query(
      `SELECT
        id, token, email, first_name, last_name, name, role,
        institution_id, institution_name, program_id, department,
        permissions, status, created_at, expires_at, accepted_at
      FROM identity.pending_invites
      ORDER BY created_at DESC
      LIMIT 100`
    );

    sendSuccess(res, rows);
  } catch (err) {
    sendError(res, err);
  }
});

// ── GET /api/invites/:token ──────────────────────────────────────────────────
invitesRouter.get('/:token', async (req: Request, res: Response): Promise<void> => {
  try {
    const rawToken = String(req.params.token || '').trim();
    const queryEmail = typeof req.query.email === 'string' ? req.query.email.trim() : '';
    if (!rawToken && !queryEmail) {
      throw new AppError(400, 'Token is required', 'VALIDATION_ERROR');
    }

    let rows: any[] = [];
    if (rawToken) {
      const res1 = await db.query(
        `SELECT
          pi.id, pi.token, pi.email, pi.first_name, pi.last_name, pi.name, pi.role,
          pi.institution_id AS college_id,
          COALESCE(pi.institution_name, inst.name, 'Institution') AS college_name,
          pi.program_id, pi.department, pi.permissions, pi.status, pi.created_at, pi.expires_at
        FROM identity.pending_invites pi
        LEFT JOIN org.institutions inst ON inst.id = pi.institution_id
        WHERE pi.token = $1 OR LOWER(pi.token) = LOWER($1)`,
        [rawToken]
      );
      rows = res1.rows;

      if (rows.length === 0) {
        const decoded = decodeURIComponent(rawToken);
        const res2 = await db.query(
          `SELECT
            pi.id, pi.token, pi.email, pi.first_name, pi.last_name, pi.name, pi.role,
            pi.institution_id AS college_id,
            COALESCE(pi.institution_name, inst.name, 'Institution') AS college_name,
            pi.program_id, pi.department, pi.permissions, pi.status, pi.created_at, pi.expires_at
          FROM identity.pending_invites pi
          LEFT JOIN org.institutions inst ON inst.id = pi.institution_id
          WHERE pi.token = $1 OR LOWER(pi.token) = LOWER($1)`,
          [decoded]
        );
        rows = res2.rows;
      }
    }

    // Fallback: look up by email from identity.pending_invites if not found by raw token
    if (rows.length === 0 && (queryEmail || rawToken.includes('@'))) {
      const lookupEmail = (queryEmail || rawToken).toLowerCase().trim();
      const resEmail = await db.query(
        `SELECT
          pi.id, pi.token, pi.email, pi.first_name, pi.last_name, pi.name, pi.role,
          pi.institution_id AS college_id,
          COALESCE(pi.institution_name, inst.name, 'Institution') AS college_name,
          pi.program_id, pi.department, pi.permissions, pi.status, pi.created_at, pi.expires_at
        FROM identity.pending_invites pi
        LEFT JOIN org.institutions inst ON inst.id = pi.institution_id
        WHERE LOWER(pi.email) = $1
        ORDER BY pi.created_at DESC LIMIT 1`,
        [lookupEmail]
      );
      rows = resEmail.rows;
    }

    // Fallback: check org.department_staff table (supports activation_token generated when adding staff)
    if (rows.length === 0) {
      const staffQuery = await db.query(
        `SELECT
          ds.id, ds.activation_token AS token, ds.email, ds.name, 'COUNSELLOR'::text AS role,
          ds.institution_id AS college_id,
          COALESCE(inst.name, 'Institution') AS college_name,
          ds.department, ds.status, ds.created_at
        FROM org.department_staff ds
        LEFT JOIN org.institutions inst ON inst.id = ds.institution_id
        WHERE ds.activation_token = $1 OR LOWER(ds.email) = LOWER($1) OR ($2::text IS NOT NULL AND LOWER(ds.email) = LOWER($2::text))
        LIMIT 1`,
        [rawToken, queryEmail || null]
      );
      if (staffQuery.rows.length > 0) {
        const s = staffQuery.rows[0];
        rows = [{
          ...s,
          first_name: s.name?.split(' ')[0] || '',
          last_name: s.name?.split(' ').slice(1).join(' ') || '',
          permissions: ['CAN_VIEW_STUDENT_PROGRESS'],
          status: s.status === 'ACTIVE' ? 'PENDING' : s.status,
          expires_at: new Date(Date.now() + 90 * 86400000)
        }];
      }
    }

    if (rows.length === 0) {
      throw new AppError(404, 'Invitation not found or has been replaced by a newer invitation.', 'NOT_FOUND');
    }

    const invite = rows[0];

    // Check if already accepted
    if (invite.status === 'ACCEPTED') {
      sendSuccess(res, {
        ...invite,
        alreadyAccepted: true,
        message: 'This invitation has already been accepted. Please sign in.'
      });
      return;
    }

    sendSuccess(res, invite);
  } catch (err) {
    sendError(res, err);
  }
});

// ── POST /api/invites/:token/complete ────────────────────────────────────────
const completeInviteSchema = z.object({
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

invitesRouter.post(
  '/:token/complete',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const rawToken = String(req.params.token || '').trim();
      const parsed = completeInviteSchema.safeParse(req.body);

      if (!parsed.success) {
        throw new AppError(422, 'Validation failed', 'VALIDATION_ERROR');
      }

      const { password } = parsed.data;

      // Fetch invite
      let { rows: invites } = await db.query(
        `SELECT
          pi.id, pi.token, pi.email, pi.first_name, pi.last_name, pi.name, pi.role,
          pi.institution_id,
          COALESCE(pi.institution_name, inst.name, 'Institution') AS institution_name,
          pi.program_id, pi.department,
          pi.permissions, pi.status, pi.expires_at
        FROM identity.pending_invites pi
        LEFT JOIN org.institutions inst ON inst.id = pi.institution_id
        WHERE pi.token = $1 OR LOWER(pi.token) = LOWER($1)`,
        [rawToken]
      );

      if (invites.length === 0) {
        const decoded = decodeURIComponent(rawToken);
        const res2 = await db.query(
          `SELECT
            pi.id, pi.token, pi.email, pi.first_name, pi.last_name, pi.name, pi.role,
            pi.institution_id,
            COALESCE(pi.institution_name, inst.name, 'Institution') AS institution_name,
            pi.program_id, pi.department,
            pi.permissions, pi.status, pi.expires_at
          FROM identity.pending_invites pi
          LEFT JOIN org.institutions inst ON inst.id = pi.institution_id
          WHERE pi.token = $1 OR LOWER(pi.token) = LOWER($1)`,
          [decoded]
        );
        invites = res2.rows;
      }

      if (invites.length === 0) {
        // Fallback: look up in pending_invites by email if token was an email
        if (rawToken.includes('@')) {
          const resEmail = await db.query(
            `SELECT
              pi.id, pi.token, pi.email, pi.first_name, pi.last_name, pi.name, pi.role,
              pi.institution_id,
              COALESCE(pi.institution_name, inst.name, 'Institution') AS institution_name,
              pi.program_id, pi.department,
              pi.permissions, pi.status, pi.expires_at
            FROM identity.pending_invites pi
            LEFT JOIN org.institutions inst ON inst.id = pi.institution_id
            WHERE LOWER(pi.email) = LOWER($1)
            ORDER BY pi.created_at DESC LIMIT 1`,
            [rawToken.toLowerCase().trim()]
          );
          invites = resEmail.rows;
        }
      }

      if (invites.length === 0) {
        // Fallback: check org.department_staff
        const staffQuery = await db.query(
          `SELECT
            ds.id, ds.activation_token AS token, ds.email, ds.name, 'COUNSELLOR'::text AS role,
            ds.institution_id,
            COALESCE(inst.name, 'Institution') AS institution_name,
            ds.department, ds.status
          FROM org.department_staff ds
          LEFT JOIN org.institutions inst ON inst.id = ds.institution_id
          WHERE ds.activation_token = $1 OR LOWER(ds.email) = LOWER($1)
          LIMIT 1`,
          [rawToken]
        );
        if (staffQuery.rows.length > 0) {
          const s = staffQuery.rows[0];
          invites = [{
            ...s,
            first_name: s.name?.split(' ')[0] || '',
            last_name: s.name?.split(' ').slice(1).join(' ') || '',
            permissions: ['CAN_VIEW_STUDENT_PROGRESS'],
            status: 'PENDING',
            expires_at: null
          }];
          await db.query(`UPDATE org.department_staff SET status = 'ACTIVE' WHERE id = $1`, [s.id]).catch(() => {});
        }
      }

      if (invites.length === 0) {
        throw new AppError(404, 'Invite not found', 'NOT_FOUND');
      }

      const invite = invites[0];

      // Check if user already exists
      const { rows: existingUsers } = await db.query(
        `SELECT id FROM identity.users WHERE LOWER(email) = LOWER($1)`,
        [invite.email]
      );

      const passwordHash = await bcrypt.hash(password, 10);
      let user: any;

      if (existingUsers.length > 0) {
        const { rows: userRows } = await db.query(
          `UPDATE identity.users
           SET password_hash = $1, role = $2, name = $3, status = 'ACTIVE',
               institution_id = COALESCE($5, institution_id)
           WHERE id = $4
           RETURNING id, name, email, role, token_version`,
          [passwordHash, invite.role, invite.name, existingUsers[0].id, invite.institution_id]
        );
        user = userRows[0];
      } else {
        const { rows: userRows } = await db.query(
          `INSERT INTO identity.users (name, email, password_hash, role, token_version, status, institution_id)
           VALUES ($1, $2, $3, $4, 0, 'ACTIVE', $5)
           RETURNING id, name, email, role, token_version`,
          [invite.name, invite.email.toLowerCase(), passwordHash, invite.role, invite.institution_id]
        );
        user = userRows[0];
      }

      // Ensure role_assignment exists
      if (invite.institution_id) {
        await db.query(
          `INSERT INTO identity.role_assignments (user_id, role, institution_id, program_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING`,
          [user.id, invite.role, invite.institution_id, invite.program_id || null]
        ).catch(() => {});
      }

      // Mark invite as accepted
      await db.query(
        `UPDATE identity.pending_invites
         SET status = 'ACCEPTED', accepted_at = now()
         WHERE id = $1`,
        [invite.id]
      );

      // Generate JWT token
      const authUser: AuthUser = {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        tokenVersion: user.token_version,
      };

      const jwtToken = jwt.sign(
        {
          id: authUser.id,
          email: authUser.email,
          role: authUser.role,
          name: authUser.name,
          tokenVersion: authUser.tokenVersion,
        },
        env.JWT_SECRET,
        { expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] }
      );

      sendSuccess(res, {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          collegeId: invite.institution_id,
          collegeName: invite.institution_name,
          programId: invite.program_id,
          department: invite.department,
          permissions: invite.permissions,
        },
        token: jwtToken,
      }, 201);
    } catch (err) {
      sendError(res, err);
    }
  }
);
