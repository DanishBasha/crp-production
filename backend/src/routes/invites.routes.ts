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
    const { token } = req.params;

    const { rows } = await db.query(
      `SELECT
        pi.id, pi.token, pi.email, pi.first_name, pi.last_name, pi.name, pi.role,
        pi.institution_id AS college_id,
        COALESCE(pi.institution_name, inst.name, 'Institution') AS college_name,
        pi.program_id, pi.department, pi.permissions, pi.status, pi.created_at, pi.expires_at
      FROM identity.pending_invites pi
      LEFT JOIN org.institutions inst ON inst.id = pi.institution_id
      WHERE pi.token = $1`,
      [token]
    );

    if (rows.length === 0) {
      throw new AppError(404, 'Invite not found', 'NOT_FOUND');
    }

    const invite = rows[0];

    // Check if expired
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      throw new AppError(410, 'Invite has expired', 'EXPIRED');
    }

    // Check if already accepted
    if (invite.status === 'ACCEPTED') {
      throw new AppError(409, 'Invite already accepted', 'ALREADY_USED');
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
      const { token } = req.params;
      const parsed = completeInviteSchema.safeParse(req.body);

      if (!parsed.success) {
        throw new AppError(422, 'Validation failed', 'VALIDATION_ERROR');
      }

      const { password } = parsed.data;

      // Fetch invite
      const { rows: invites } = await db.query(
        `SELECT
          pi.id, pi.token, pi.email, pi.first_name, pi.last_name, pi.name, pi.role,
          pi.institution_id,
          COALESCE(pi.institution_name, inst.name, 'Institution') AS institution_name,
          pi.program_id, pi.department,
          pi.permissions, pi.status, pi.expires_at
        FROM identity.pending_invites pi
        LEFT JOIN org.institutions inst ON inst.id = pi.institution_id
        WHERE pi.token = $1`,
        [token]
      );

      if (invites.length === 0) {
        throw new AppError(404, 'Invite not found', 'NOT_FOUND');
      }

      const invite = invites[0];

      // Validate invite
      if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
        throw new AppError(410, 'Invite has expired', 'EXPIRED');
      }

      if (invite.status === 'ACCEPTED') {
        throw new AppError(409, 'Invite already accepted', 'ALREADY_USED');
      }

      // Check if user already exists
      const { rows: existingUsers } = await db.query(
        `SELECT id FROM identity.users WHERE email = $1`,
        [invite.email]
      );

      const passwordHash = await bcrypt.hash(password, 10);
      let user: any;

      if (existingUsers.length > 0) {
        const { rows: userRows } = await db.query(
          `UPDATE identity.users
           SET password_hash = $1, role = $2, name = $3, status = 'ACTIVE'
           WHERE id = $4
           RETURNING id, name, email, role, token_version`,
          [passwordHash, invite.role, invite.name, existingUsers[0].id]
        );
        user = userRows[0];
      } else {
        const { rows: userRows } = await db.query(
          `INSERT INTO identity.users (name, email, password_hash, role, token_version, status)
           VALUES ($1, $2, $3, $4, 0, 'ACTIVE')
           RETURNING id, name, email, role, token_version`,
          [invite.name, invite.email, passwordHash, invite.role]
        );
        user = userRows[0];
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
