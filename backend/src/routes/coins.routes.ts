import { Router, Response } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { db } from '../shared/db/pool';
import { AppError } from '../shared/errors/AppError';
import { sendSuccess, sendError } from '../shared/helpers/response';
import { AuthRequest } from '../middleware/authenticate';
import { requireRole } from '../middleware/authorize';
import { getCoins, spendCoin, rewardCompletion, setCoins, MAX_COINS } from '../services/coinService';
import { CreditService } from '../modules/credits/credits.service';

// Session coins (see services/coinService.ts). Mock interviews are charged and
// rewarded by the interview service itself; these routes cover the student's own
// wallet, sessions scored in the browser (listening), and admin restores.
export const coinsRouter = Router();

async function ownStudentId(req: AuthRequest): Promise<string> {
  const { rows } = await db.query<{ id: string }>('SELECT id FROM org.students WHERE user_id = $1 OR id = $1', [req.user!.id]);
  if (rows.length > 0) return rows[0].id;
  return req.user!.id;
}

// GET /api/coins/me
coinsRouter.get('/me', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const studentId = await ownStudentId(req);
    const wallet = await getCoins(studentId);
    const { rows } = await db.query<{ institution_id: string | null }>(
      'SELECT institution_id FROM identity.users WHERE id = $1',
      [req.user!.id]
    );
    const institutionId = rows[0]?.institution_id ?? null;
    sendSuccess(res, {
      ...wallet,
      institutionId,
      isIndependent: !institutionId,
    });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /api/coins/me/pay-refill — Independent candidates pay to refill lost credits
const payRefillSchema = z.object({
  paymentMethod: z.enum(['UPI', 'CARD', 'NETBANKING']).default('UPI'),
  transactionReference: z.string().optional(),
});

coinsRouter.post('/me/pay-refill', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    payRefillSchema.parse(req.body ?? {});
    const studentId = await ownStudentId(req);

    // Verify whether this candidate is institutional or independent
    const { rows } = await db.query<{ institution_id: string | null }>(
      'SELECT institution_id FROM identity.users WHERE id = $1',
      [req.user!.id]
    );
    const institutionId = rows[0]?.institution_id;
    if (institutionId) {
      throw new AppError(
        400,
        "Institutional students cannot purchase credits. Your credits can only be restored by your College's Super Admin.",
        'INSTITUTIONAL_STUDENT_CANNOT_PURCHASE'
      );
    }

    const price = 10;
    const ref = req.body?.transactionReference || `PAY_${Date.now()}`;
    await CreditService.earn(studentId, MAX_COINS * price, 'INDEPENDENT_PAYMENT_REFILL', ref, MAX_COINS * price);
    await db.query('UPDATE org.students SET coins = $1, updated_at = now() WHERE id = $2', [MAX_COINS, studentId]).catch(() => {});
    await db.query(
      'UPDATE candidate.independent_candidates SET credits = $1, zero_credits_at = NULL, updated_at = now() WHERE user_id = $2',
      [MAX_COINS, req.user!.id]
    ).catch(() => {});

    sendSuccess(res, { coins: MAX_COINS, maxCoins: MAX_COINS, message: 'Payment verified. 5 credits restored to your wallet.' });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /api/coins/me/spend — charge one coin for a session scored in the browser (listening)
const spendSchema = z.object({ purpose: z.enum(['LISTENING_COMPREHENSION']) });

coinsRouter.post('/me/spend', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!spendSchema.safeParse(req.body).success) throw new AppError(422, 'Unknown session type', 'VALIDATION_ERROR');
    const sessionRef = randomUUID();
    const coins = await spendCoin(await ownStudentId(req), sessionRef);
    sendSuccess(res, { sessionRef, coins, maxCoins: MAX_COINS }, 201);
  } catch (err) {
    sendError(res, err);
  }
});

// POST /api/coins/me/complete — reward a finished browser-scored session.
const completeSchema = z.object({ sessionRef: z.string().uuid() });

coinsRouter.post('/me/complete', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = completeSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(422, 'sessionRef is required', 'VALIDATION_ERROR');
    const coins = await rewardCompletion(await ownStudentId(req), parsed.data.sessionRef);
    sendSuccess(res, { coins, maxCoins: MAX_COINS });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /api/coins/:studentId/restore — College Super Admin restores an institutional student's credits
const restoreSchema = z.object({ coins: z.number().int().min(0).max(MAX_COINS).default(MAX_COINS) });

coinsRouter.post(
  '/:studentId/restore',
  requireRole('PLATFORM_OWNER', 'SUPER_ADMIN'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const studentId = req.params.studentId as string;
      const parsed = restoreSchema.safeParse(req.body ?? {});
      if (!parsed.success) throw new AppError(422, `coins must be 0-${MAX_COINS}`, 'VALIDATION_ERROR');

      // College Super Admin can ONLY restore credits for institutional students of their own college
      const { rows } = await db.query<{ student_institution: string | null; caller_institution: string | null }>(
        `SELECT su.institution_id AS student_institution,
                (SELECT institution_id FROM identity.users WHERE id = $2) AS caller_institution
         FROM org.students s JOIN identity.users su ON su.id = s.user_id
         WHERE s.id::text = $1 OR su.id::text = $1`,
        [studentId, req.user!.id]
      );
      const row = rows[0];
      if (!row) {
        throw new AppError(404, 'Student not found', 'NOT_FOUND');
      }
      if (!row.student_institution) {
        throw new AppError(
          400,
          "This candidate is an independent candidate. College Super Admins can only restore credits for their institutional students. Independent candidates must pay to refill credits.",
          'INDEPENDENT_CANDIDATE'
        );
      }
      if (req.user!.role !== 'PLATFORM_OWNER' && row.student_institution !== row.caller_institution) {
        throw new AppError(403, 'You can only restore credits for students belonging to your college.', 'FORBIDDEN');
      }

      const coins = await setCoins(studentId, parsed.data.coins, req.user!.id);
      await db.query('UPDATE org.students SET coins = $1, updated_at = now() WHERE id = $2 OR user_id = $2', [coins, studentId]).catch(() => {});
      sendSuccess(res, { studentId, coins, maxCoins: MAX_COINS, message: `Successfully restored ${coins} credits for student.` });
    } catch (err) {
      sendError(res, err);
    }
  }
);
