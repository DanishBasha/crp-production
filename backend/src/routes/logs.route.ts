import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

export const logsRouter = Router();

const LOG_FILE = path.resolve(__dirname, '../../../logs/app.log');

logsRouter.post('/', (req: Request, res: Response): void => {
  const { line } = req.body;
  if (typeof line === 'string' && line.trim()) {
    try {
      fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
      fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
    } catch {
      // Non-fatal — never let a log write crash the server
    }
  }
  res.json({ ok: true });
});
