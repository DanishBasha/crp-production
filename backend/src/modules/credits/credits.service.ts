import { createHash } from 'crypto';
import { db } from '../../shared/db/pool';
import { AppError } from '../../shared/errors/AppError';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function toSafeUuid(val?: string | null): string | null {
  if (!val) return null;
  return UUID_RE.test(val) ? val : null;
}

function ikey(raw: string): string {
  return raw.length <= 100 ? raw : createHash('sha256').update(raw).digest('hex').slice(0, 100);
}

export interface ConsumeResult { newBalance: number; transactionId: string; }
export interface EarnResult    { newBalance: number; transactionId: string; }

export class CreditService {
  // Deduct credits. Uses SELECT FOR UPDATE to prevent double-spend.
  static async consume(
    studentId: string,
    amount: number,
    reason: string,
    referenceId: string
  ): Promise<ConsumeResult> {
    const idempotencyKey = ikey(`consume:${studentId}:${reason}:${referenceId}`);
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      // Idempotency guard
      const { rows: dup } = await client.query(
        'SELECT id, balance_after FROM credit.credit_transactions WHERE idempotency_key = $1',
        [idempotencyKey]
      );
      if (dup.length > 0) {
        await client.query('ROLLBACK');
        return { newBalance: Number(dup[0].balance_after), transactionId: dup[0].id as string };
      }

      // Lock account row
      const { rows: accounts } = await client.query(
        'SELECT id, balance FROM credit.credit_accounts WHERE student_id = $1 FOR UPDATE',
        [studentId]
      );
      if (accounts.length === 0) throw new AppError(404, 'Credit account not found', 'NOT_FOUND');

      const currentBalance = Number(accounts[0].balance);
      if (currentBalance < amount) {
        throw new AppError(402, 'Insufficient credits', 'INSUFFICIENT_CREDITS');
      }

      const newBalance = currentBalance - amount;

      await client.query(
        'UPDATE credit.credit_accounts SET balance = $1, updated_at = now() WHERE id = $2',
        [newBalance, accounts[0].id]
      );

      const safeRefId = toSafeUuid(referenceId);
      const { rows: txn } = await client.query(
        `INSERT INTO credit.credit_transactions
           (account_id, student_id, transaction_type, amount, balance_after, idempotency_key,
            reference_type, reference_id, metadata)
         VALUES ($1,$2,'CONSUME',$3,$4,$5,$6,$7,$8) RETURNING id`,
        [accounts[0].id, studentId, amount, newBalance, idempotencyKey,
         reason, safeRefId, JSON.stringify({ reason, originalReferenceId: referenceId })]
      );

      await client.query('COMMIT');
      return { newBalance, transactionId: txn[0].id as string };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // Award credits. Caps at max_balance from global policy, or optional explicit cap.
  static async earn(
    studentId: string,
    amount: number,
    reason: string,
    referenceId: string,
    cap?: number
  ): Promise<EarnResult> {
    const idempotencyKey = ikey(`earn:${studentId}:${reason}:${referenceId}`);
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const { rows: dup } = await client.query(
        'SELECT id, balance_after FROM credit.credit_transactions WHERE idempotency_key = $1',
        [idempotencyKey]
      );
      if (dup.length > 0) {
        await client.query('ROLLBACK');
        return { newBalance: Number(dup[0].balance_after), transactionId: dup[0].id as string };
      }

      const { rows: accounts } = await client.query(
        'SELECT id, balance FROM credit.credit_accounts WHERE student_id = $1 FOR UPDATE',
        [studentId]
      );
      if (accounts.length === 0) throw new AppError(404, 'Credit account not found', 'NOT_FOUND');

      // Fetch cap from global policy
      const { rows: policies } = await client.query(
        `SELECT max_balance FROM credit.credit_policies
         WHERE scope_type = 'GLOBAL' AND is_active = TRUE ORDER BY created_at ASC LIMIT 1`
      );
      const policyMax = policies.length > 0 && policies[0].max_balance !== null
        ? Number(policies[0].max_balance) : Infinity;
      const effectiveCap = typeof cap === 'number' ? Math.min(cap, policyMax) : policyMax;

      const newBalance = Math.min(Number(accounts[0].balance) + amount, effectiveCap);

      await client.query(
        'UPDATE credit.credit_accounts SET balance = $1, updated_at = now() WHERE id = $2',
        [newBalance, accounts[0].id]
      );

      const safeRefId = toSafeUuid(referenceId);
      const { rows: txn } = await client.query(
        `INSERT INTO credit.credit_transactions
           (account_id, student_id, transaction_type, amount, balance_after, idempotency_key,
            reference_type, reference_id, metadata)
         VALUES ($1,$2,'EARN',$3,$4,$5,$6,$7,$8) RETURNING id`,
        [accounts[0].id, studentId, amount, newBalance, idempotencyKey,
         reason, safeRefId, JSON.stringify({ reason, originalReferenceId: referenceId })]
      );

      await client.query('COMMIT');
      return { newBalance, transactionId: txn[0].id as string };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // Called by USER_REGISTERED handler. Idempotent.
  static async createAccount(studentId: string): Promise<void> {
    const idempotencyKey = `initial:${studentId}`;
    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const { rows: existing } = await client.query(
        'SELECT id FROM credit.credit_accounts WHERE student_id = $1',
        [studentId]
      );
      if (existing.length > 0) { await client.query('ROLLBACK'); return; }

      const { rows: policies } = await client.query(
        `SELECT initial_credit_amount FROM credit.credit_policies
         WHERE scope_type = 'GLOBAL' AND is_active = TRUE ORDER BY created_at ASC LIMIT 1`
      );
      const initialBalance = policies.length > 0
        ? Number(policies[0].initial_credit_amount) : 50;

      const { rows: acct } = await client.query(
        `INSERT INTO credit.credit_accounts (student_id, balance)
         VALUES ($1, $2) RETURNING id`,
        [studentId, initialBalance]
      );

      await client.query(
        `INSERT INTO credit.credit_transactions
           (account_id, student_id, transaction_type, amount, balance_after, idempotency_key, metadata)
         VALUES ($1,$2,'INITIAL',$3,$4,$5,$6)`,
        [acct[0].id, studentId, initialBalance, initialBalance,
         idempotencyKey, JSON.stringify({ reason: 'Account creation' })]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
