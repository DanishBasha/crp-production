import { Router } from 'express';
import { healthRouter } from './health';
import { authRouter } from './auth.routes';
import { logsRouter } from './logs.route';
import { studentRouter } from './student.routes';
import { interviewRouter } from './interview.routes';
import { portalRouter } from './portal.routes';
import { orgRouter } from './org.routes';
import { mentorRouter } from './mentor.routes';
import { trainerRouter } from './trainer.routes';
import { adminRouter } from './admin.routes';
import { skillsRouter } from './skills.routes';
import { performanceRouter } from './performance.routes';
import { listeningRouter } from './listening.routes';
import { learningRouter } from './learning.routes';
import { authenticate } from '../middleware/authenticate';
// New routes for frontend integration
import { ownerRouter } from './owner.routes';
import { collegeRouter } from './college.routes';
import { invitesRouter } from './invites.routes';
import { studentBatchRouter } from './studentBatch.routes';

// Module 2 & 4 routers
import { assessmentsRouter } from '../modules/assessments/assessments.routes';
import { attemptsRouter } from '../modules/attempts/attempts.routes';
import { checklistRouter } from '../modules/checklist/checklist.routes';
import { creditPoliciesRouter } from '../modules/credits/credit-policies.routes';
import { creditsRouter } from '../modules/credits/credits.routes';
import { placementRouter } from '../modules/placement/placement.routes';
import { questionBankRouter } from '../modules/question-bank/question-bank.routes';
import { reportsRouter } from '../modules/reports/reports.routes';
import { responsesRouter } from '../modules/responses/responses.routes';
import { sessionsRouter } from '../modules/sessions/sessions.routes';
import { verificationsRouter } from '../modules/verifications/verifications.routes';

export const router = Router();

// Public
router.use('/health', healthRouter);
router.use('/auth', authRouter);
router.use('/logs', logsRouter);

// Org lookup endpoints are read-only and needed before login (e.g. batch list on registration form).
router.use('/org', orgRouter);

// Invites - public endpoint for accepting invitations
router.use('/invites', invitesRouter);

// Protected — authenticate on every request; individual routes add authorize() as needed
router.use('/students', authenticate, studentRouter);
router.use('/interview', authenticate, interviewRouter);
router.use('/sessions', authenticate, interviewRouter);
router.use('/sessions', authenticate, sessionsRouter);
router.use('/portals', authenticate, portalRouter);
router.use('/mentors', authenticate, mentorRouter);
router.use('/trainers', authenticate, trainerRouter);
router.use('/admin', authenticate, adminRouter);

// Module 2 — Assessments, Attempts, Responses, Reports, Question Bank, Verifications
router.use('/assessments', authenticate, assessmentsRouter);
router.use('/attempts', authenticate, attemptsRouter);
router.use('/responses', authenticate, responsesRouter);
router.use('/reports', authenticate, reportsRouter);
router.use('/question-bank', authenticate, questionBankRouter);
router.use('/verifications', authenticate, verificationsRouter);

// Module 4 — Credits, Credit Policies, Placement, Checklist
router.use('/credits', authenticate, creditsRouter);
router.use('/credit-policies', authenticate, creditPoliciesRouter);
router.use('/placement', authenticate, placementRouter);
router.use('/checklist', authenticate, checklistRouter);

// Module 3 — Skills, Performance, Listening, Learning & Agent
router.use('/skills', authenticate, skillsRouter);
router.use('/performance', authenticate, performanceRouter);
router.use('/listening', authenticate, listeningRouter);
router.use('/learning', authenticate, learningRouter);

// New routes — Platform Owner, College Management, Student Batch Operations
router.use('/owner', authenticate, ownerRouter);
router.use('/college', authenticate, collegeRouter);
router.use('/studentBatch', authenticate, studentBatchRouter);

