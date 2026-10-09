import { Router, Response } from 'express';
import { z } from 'zod';
import { db } from '../shared/db/pool';
import { AppError } from '../shared/errors/AppError';
import { sendSuccess, sendError } from '../shared/helpers/response';
import { AuthRequest } from '../middleware/authenticate';
import { eventBus } from '../shared/events/eventBus';
import { Events, AttemptCompletedPayload } from '../shared/events/events';
import { startLiveInterview } from '../services/interviewSessionService';

export const interviewRouter = Router();

// ── Live interview start schema ───────────────────────────────────────────────
const startLiveSessionSchema = z.object({
  sessionType: z.literal('MOCK_INTERVIEW').default('MOCK_INTERVIEW'),
  topic: z.string().optional(),
  assignmentId: z.string().optional(),
  interviewMode: z.enum(['RESUME_BASED', 'TOPIC']).optional(),
  resume: z.object({
    skills: z.array(z.string().max(80)).max(40).optional(),
    projects: z.array(z.object({
      title: z.string().max(200),
      techStack: z.array(z.string().max(80)).max(20).optional(),
      description: z.string().max(1000).optional(),
    })).max(10).optional(),
  }).optional(),
});

// ── POST /api/interview/sessions — Start live voice interview session ────────
interviewRouter.post('/sessions', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = startLiveSessionSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError(422, 'Only MOCK_INTERVIEW sessions can be started here', 'VALIDATION_ERROR');
    }
    const session = await startLiveInterview(
      req.user!.id,
      parsed.data.resume,
      parsed.data.topic,
      parsed.data.assignmentId,
      parsed.data.interviewMode
    );
    console.log(`[interview] Live session started sessionId=${session.sessionId} attemptId=${session.attemptId}`);
    sendSuccess(res, session, 201);
  } catch (err) {
    sendError(res, err);
  }
});

// ── Validation schemas ────────────────────────────────────────────────────────

const startSessionSchema = z.object({
  studentId: z.string().uuid(),
  goal:      z.string().min(1).max(500).default('Improve technical skills and interview readiness'),
});

const concludeSessionSchema = z.object({
  goal:               z.string().min(1).max(500).optional(),
  overallScore:       z.number().min(0).max(100),
  technicalScore:     z.number().min(0).max(100).optional().nullable(),
  communicationScore: z.number().min(0).max(100).optional().nullable(),
  listeningScore:     z.number().min(0).max(100).optional().nullable(),
});

// ── Helper: look up student org context ──────────────────────────────────────

async function getStudentContext(studentId: string) {
  const { rows } = await db.query(
    `SELECT s.id, s.program_id, s.batch_id, s.subdivision_id
     FROM org.students s WHERE s.id = $1`,
    [studentId]
  );
  if (rows.length === 0) throw new AppError(404, 'Student not found', 'NOT_FOUND');
  return rows[0] as {
    id: string;
    program_id: string;
    batch_id: string;
    subdivision_id: string | null;
  };
}

// ── POST /api/sessions — Start an interview session ──────────────────────────
// Creates a new assessment_attempt linked to the student and returns the session ID.

interviewRouter.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = startSessionSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(422, 'Validation failed', 'VALIDATION_ERROR');
    const { studentId, goal } = parsed.data;

    const student = await getStudentContext(studentId);

    // Use the first active assessment as the template, or auto-create if not yet seeded
    let assessmentId: string;
    const { rows: assessmentRows } = await db.query(
      `SELECT id FROM assessment.assessments WHERE is_active = true ORDER BY created_at LIMIT 1`
    );
    if (assessmentRows.length === 0) {
      const { rows: createdAssessment } = await db.query(
        `INSERT INTO assessment.assessments (name, assessment_type, interview_type, is_active)
         VALUES ('Standard Technical Assessment', 'MOCK_INTERVIEW', 'TECHNICAL', true)
         RETURNING id`
      );
      assessmentId = createdAssessment[0].id;
    } else {
      assessmentId = assessmentRows[0].id;
    }

    // Create attempt
    const { rows: attemptRows } = await db.query(
      `INSERT INTO assessment.assessment_attempts
         (assessment_id, student_id, interview_type, program_id, batch_id,
          subdivision_id, assessment_version, scoring_version, status, started_at)
       VALUES ($1,$2,'TECHNICAL',$3,$4,$5,1,'v1.0','IN_PROGRESS',now())
       RETURNING id`,
      [assessmentId, studentId, student.program_id ?? null, student.batch_id ?? null, student.subdivision_id ?? null]
    );
    const attemptId: string = attemptRows[0].id;

    // Create session record
    const { rows: sessionRows } = await db.query(
      `INSERT INTO session.assessment_sessions
         (attempt_id, current_sequence_no, state, last_activity_at)
       VALUES ($1, 0, 'STARTED', now())
       RETURNING id`,
      [attemptId]
    );
    const sessionId: string = sessionRows[0].id;

    console.log(
      `[interview] Session started sessionId=${sessionId} attemptId=${attemptId} ` +
      `studentId=${studentId} goal="${goal}"`
    );

    sendSuccess(res, { sessionId, attemptId, goal }, 201);
  } catch (err) {
    sendError(res, err);
  }
});

// ── POST /api/sessions/:id/conclude — Conclude session, trigger Module 3 ─────
// Marks the attempt COMPLETED, stores scores, emits ATTEMPT_COMPLETED event.
// The event handler in module3Handlers.ts updates performance data AND triggers
// the Module 3 agent, which calls Groq to generate a personalized roadmap.

interviewRouter.post('/:id/conclude', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const sessionId = req.params.id;
    const parsed = concludeSessionSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(422, 'Validation failed', 'VALIDATION_ERROR');
    const {
      goal,
      overallScore,
      technicalScore,
      communicationScore,
      listeningScore,
    } = parsed.data;

    // Load attempt via session
    const { rows: sessionRows } = await db.query(
      `SELECT ss.attempt_id
       FROM session.assessment_sessions ss
       WHERE ss.id = $1`,
      [sessionId]
    );
    if (sessionRows.length === 0) {
      throw new AppError(404, 'Session not found', 'NOT_FOUND');
    }
    const attemptId: string = sessionRows[0].attempt_id;

    // Load attempt
    const { rows: attemptRows } = await db.query(
      `SELECT student_id, program_id, batch_id, subdivision_id, status
       FROM assessment.assessment_attempts WHERE id = $1`,
      [attemptId]
    );
    if (attemptRows.length === 0) throw new AppError(404, 'Attempt not found', 'NOT_FOUND');
    const attempt = attemptRows[0];

    if (attempt.status === 'COMPLETED') {
      sendSuccess(res, { message: 'Already concluded', attemptId });
      return;
    }

    // Mark attempt complete
    await db.query(
      `UPDATE assessment.assessment_attempts
       SET status='COMPLETED', completed_at=now() WHERE id=$1`,
      [attemptId]
    );

    // Store assessment report with the provided scores
    await db.query(
      `INSERT INTO performance.assessment_reports
         (attempt_id, student_id, assessment_version, scoring_version,
          technical_score, communication_score, listening_score, overall_score,
          component_scores, skill_scores)
       VALUES ($1,$2,1,'v1.0',$3,$4,$5,$6,$7,NULL)
       ON CONFLICT (attempt_id) DO UPDATE
         SET technical_score=$3, communication_score=$4,
             listening_score=$5, overall_score=$6`,
      [
        attemptId,
        attempt.student_id,
        technicalScore ?? null,
        communicationScore ?? null,
        listeningScore ?? null,
        overallScore,
        JSON.stringify({
          TECHNICAL: technicalScore,
          COMMUNICATION: communicationScore,
          LISTENING: listeningScore,
        }),
      ]
    );

    // Update session state
    await db.query(
      `UPDATE session.assessment_sessions SET state='CONCLUDED', last_activity_at=now() WHERE id=$1`,
      [sessionId]
    );

    const resolvedGoal =
      goal ?? 'Improve technical skills, communication skills, and interview readiness';

    console.log(
      `[interview] Session concluded sessionId=${sessionId} attemptId=${attemptId} ` +
      `studentId=${attempt.student_id} overallScore=${overallScore} goal="${resolvedGoal}"`
    );

    // Emit ATTEMPT_COMPLETED — module3Handlers updates performance data
    // and triggers the Module 3 agent (Groq roadmap generation)
    const payload: AttemptCompletedPayload = {
      attemptId,
      studentId:         attempt.student_id,
      programId:         attempt.program_id,
      batchId:           attempt.batch_id,
      subdivisionId:     attempt.subdivision_id,
      overallScore,
      technicalScore:    technicalScore ?? null,
      communicationScore: communicationScore ?? null,
      listeningScore:    listeningScore ?? null,
      goal:              resolvedGoal,
    };
    eventBus.emit(Events.ATTEMPT_COMPLETED, payload);

    sendSuccess(res, { message: 'Session concluded. Module 3 agent triggered.', attemptId });
  } catch (err) {
    sendError(res, err);
  }
});

// ── Helper: resolve student from identifier or current user ──────────────────
async function resolveStudent(identifier?: string, userId?: string) {
  if (identifier && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(identifier)) {
    const { rows } = await db.query(`SELECT id, user_id, program_id, batch_id, subdivision_id, track, department, resume_data FROM org.students WHERE id = $1`, [identifier]);
    if (rows.length > 0) return rows[0];
    const { rows: byUser } = await db.query(`SELECT id, user_id, program_id, batch_id, subdivision_id, track, department, resume_data FROM org.students WHERE user_id = $1`, [identifier]);
    if (byUser.length > 0) return byUser[0];
  }
  if (userId) {
    const { rows: byAuthUser } = await db.query(`SELECT id, user_id, program_id, batch_id, subdivision_id, track, department, resume_data FROM org.students WHERE user_id = $1`, [userId]);
    if (byAuthUser.length > 0) return byAuthUser[0];
  }
  const { rows } = await db.query(`SELECT id, user_id, program_id, batch_id, subdivision_id, track, department, resume_data FROM org.students ORDER BY created_at DESC LIMIT 1`);
  return rows[0] || null;
}

// ── Topic-Specific 15+ Question Repository Helper ─────────────────────────────
function getTopicQuestionsPool(topic: string, candidateName: string, resumeData?: any): { questionText: string; difficulty: 'EASY' | 'MEDIUM' | 'ADVANCED'; category: string }[] {
  const normTopic = (topic || '').toLowerCase();
  const realProjects = (resumeData?.projects && Array.isArray(resumeData.projects)) ? resumeData.projects : [];
  const primaryProj = realProjects.length > 0 ? realProjects[0].title : 'Core Technical Capstone';

  if (normTopic.includes('python')) {
    return [
      { questionText: "Can you explain the Python data model, mutable versus immutable built-in data types, and how dictionary hashing works under the hood?", difficulty: 'EASY', category: 'Python Core & Data Model' },
      { questionText: "How do Python generators and the yield keyword work, and in what scenarios do they offer major memory efficiency advantages over lists?", difficulty: 'EASY', category: 'Python Iterators & Generators' },
      { questionText: "What is the Global Interpreter Lock (GIL) in CPython, and what are the architectural trade-offs between multi-threading, multi-processing, and asyncio?", difficulty: 'EASY', category: 'Python Concurrency & GIL' },
      { questionText: "How does Python handle memory management, reference counting, and cyclic garbage collection with generations?", difficulty: 'MEDIUM', category: 'Memory Management' },
      { questionText: "Walk me through how decorators work in Python. How would you write a reusable decorator that logs execution time and preserves metadata using functools.wraps?", difficulty: 'MEDIUM', category: 'Python Metaprogramming' },
      { questionText: "What is the difference between __new__ and __init__ in Python classes, and how are metaclasses used to enforce class structures?", difficulty: 'MEDIUM', category: 'Object-Oriented Python' },
      { questionText: "How do context managers work in Python with __enter__ and __exit__, and how does contextlib.contextmanager simplify resource handling?", difficulty: 'MEDIUM', category: 'Resource Management' },
      { questionText: "How would you handle heavy CPU-bound workloads in Python? When would you look at C-extensions, Cython, or multiprocessing pools?", difficulty: 'MEDIUM', category: 'Performance Optimization' },
      { questionText: "In asynchronous Python with asyncio, how do event loops schedule coroutines, and how do you prevent blocking calls from freezing the entire loop?", difficulty: 'ADVANCED', category: 'AsyncIO & Event Loops' },
      { questionText: "How do you leverage type hinting and MyPy static analysis in Python to achieve robust type safety and structural subtyping with Protocols?", difficulty: 'ADVANCED', category: 'Static Typing & Tooling' },
      { questionText: "When architecting a production REST or GraphQL API using FastAPI or Django, how do you handle dependency injection, connection pooling, and background tasks?", difficulty: 'ADVANCED', category: 'Web Framework Architecture' },
      { questionText: "Describe your strategy for profiling CPU bottlenecks and memory leaks in a live Python service using cProfile and tracemalloc.", difficulty: 'ADVANCED', category: 'Profiling & Observability' },
      { questionText: "How would you design a distributed, fault-tolerant background task processing queue in Python with Celery and Redis with idempotent retry mechanisms?", difficulty: 'ADVANCED', category: 'Distributed Systems in Python' },
      { questionText: "How do you manage complex package dependencies, lock files, and containerization security vulnerabilities in Python production deployments?", difficulty: 'ADVANCED', category: 'Packaging & Security' },
      { questionText: "What architectural patterns do you employ when designing clean architecture and domain-driven design in large Python codebases?", difficulty: 'ADVANCED', category: 'Domain-Driven Design' }
    ];
  }

  if (normTopic.includes('react') || normTopic.includes('frontend') || normTopic.includes('web')) {
    return [
      { questionText: "How does React's Virtual DOM reconciliation and Fiber diffing algorithm optimize DOM updates compared to direct DOM manipulation?", difficulty: 'EASY', category: 'React Core & Reconciliation' },
      { questionText: "Explain the rules and mechanics of React Hooks, specifically how useState and useEffect maintain state across component re-renders.", difficulty: 'EASY', category: 'React Hooks & Lifecycle' },
      { questionText: "What are the key trade-offs between component state, Context API, Redux Toolkit, and atomic state libraries like Zustand?", difficulty: 'EASY', category: 'State Management' },
      { questionText: "How do useCallback and useMemo work under the hood, and when does premature memoization hurt performance rather than help?", difficulty: 'MEDIUM', category: 'Performance Optimization' },
      { questionText: "What is the browser critical rendering path, and how do reflow and repaint cycles impact 60 FPS rendering in interactive web apps?", difficulty: 'MEDIUM', category: 'Browser Rendering & DOM' },
      { questionText: "Explain how React Server Components (RSC) differ from traditional Client Components and Server-Side Rendering (SSR).", difficulty: 'MEDIUM', category: 'Modern React Architecture' },
      { questionText: "How would you diagnose and fix a slow web application with poor Core Web Vitals (LCP, INP, CLS)?", difficulty: 'MEDIUM', category: 'Core Web Vitals & Web Performance' },
      { questionText: "How do you prevent race conditions when handling multiple asynchronous data requests triggered by rapid user input in React?", difficulty: 'MEDIUM', category: 'Async State & Data Fetching' },
      { questionText: "What security measures do you implement in frontend applications to prevent Cross-Site Scripting (XSS), CSRF, and token theft?", difficulty: 'ADVANCED', category: 'Frontend Security' },
      { questionText: "How would you design a micro-frontend architecture using Webpack Module Federation for independent multi-team deployments?", difficulty: 'ADVANCED', category: 'Micro-frontends & Build Systems' },
      { questionText: "Explain how Service Workers, Cache Storage API, and Web Workers enable offline capabilities and background multi-threading.", difficulty: 'ADVANCED', category: 'PWA & Web Workers' },
      { questionText: "How do you architect an enterprise design system with accessible components conforming strictly to WCAG 2.1 AA specifications?", difficulty: 'ADVANCED', category: 'Design Systems & Accessibility' },
      { questionText: "When implementing real-time collaborative features in web applications, how do you handle WebSocket connection state and data conflict resolution (CRDTs/OT)?", difficulty: 'ADVANCED', category: 'Real-time & Collaborative Systems' },
      { questionText: "Describe your end-to-end testing and visual regression pipeline for frontend applications using Vitest, React Testing Library, and Playwright.", difficulty: 'ADVANCED', category: 'Testing & Quality Assurance' },
      { questionText: "How do you architect frontend bundle splitting, dynamic imports, and CDN caching headers to achieve sub-second initial paint times globally?", difficulty: 'ADVANCED', category: 'Bundle Optimization & Delivery' }
    ];
  }

  if (normTopic.includes('system design') || normTopic.includes('architecture') || normTopic.includes('distributed')) {
    return [
      { questionText: "What are the core trade-offs between monolithic architectures and microservices architectures, and when should a team decouple?", difficulty: 'EASY', category: 'System Architecture Fundamentals' },
      { questionText: "Explain horizontal versus vertical scaling, and describe how load balancers distribute traffic using algorithms like Round Robin and Consistent Hashing.", difficulty: 'EASY', category: 'Scalability & Load Balancing' },
      { questionText: "What is the CAP theorem, and how does the PACELC theorem expand our understanding of latency versus consistency in distributed databases?", difficulty: 'EASY', category: 'CAP Theorem & Distributed Data' },
      { questionText: "How do caching strategies like Cache-Aside, Write-Through, and Write-Behind differ, and how do you prevent cache stampedes and thundering herds?", difficulty: 'MEDIUM', category: 'Caching & Eviction Strategies' },
      { questionText: "Compare relational databases (PostgreSQL) with NoSQL databases (Document, Key-Value, Columnar) for high-throughput write workloads.", difficulty: 'MEDIUM', category: 'Database Selection & Modeling' },
      { questionText: "How does a distributed message broker like Apache Kafka handle event partitioning, consumer groups, and offset commit semantics?", difficulty: 'MEDIUM', category: 'Message Brokers & Event Streaming' },
      { questionText: "What mechanisms guarantee data consistency across microservices: Two-Phase Commit (2PC) versus the Saga pattern with compensating transactions?", difficulty: 'MEDIUM', category: 'Distributed Transactions' },
      { questionText: "How do you implement rate limiting across distributed microservices using algorithms like Token Bucket, Leaky Bucket, and Redis sliding windows?", difficulty: 'MEDIUM', category: 'Rate Limiting & Traffic Shaping' },
      { questionText: "How do you design a distributed unique ID generator (such as Twitter Snowflake) that guarantees time-sortability and high throughput without centralized locks?", difficulty: 'ADVANCED', category: 'Distributed Algorithms' },
      { questionText: "How do you implement circuit breakers, retry backoff with randomized jitter, and bulkheads to prevent cascading system failures?", difficulty: 'ADVANCED', category: 'Resilience & Fault Tolerance' },
      { questionText: "How do distributed consensus algorithms like Raft and Paxos ensure cluster state consistency during leader election and network partitions?", difficulty: 'ADVANCED', category: 'Distributed Consensus' },
      { questionText: "Design a scalable URL shortening service (like Bitly) supporting 100 million daily active users, detailing the database schema, hashing, caching, and analytics.", difficulty: 'ADVANCED', category: 'System Design Case Study' },
      { questionText: "How do you architect end-to-end distributed tracing and observability using OpenTelemetry, structured logging, and real-time anomaly alerting?", difficulty: 'ADVANCED', category: 'Telemetry & Observability' },
      { questionText: "When dealing with geo-distributed database replication, how do you handle replication lag, conflict resolution, and read-after-write consistency for users?", difficulty: 'ADVANCED', category: 'Geo-Replication & Consistency' },
      { questionText: "How would you design a real-time notification service delivering push, SMS, and email notifications to 50 million concurrent subscribers with deduplication?", difficulty: 'ADVANCED', category: 'High Scale Notification Engine' }
    ];
  }

  if (normTopic.includes('database') || normTopic.includes('sql') || normTopic.includes('postgres')) {
    return [
      { questionText: "Can you explain the ACID properties in relational databases and how each property is guaranteed by the database engine?", difficulty: 'EASY', category: 'ACID Transactions' },
      { questionText: "What are the rules of database normalization (1NF, 2NF, 3NF, BCNF), and in what scenarios is intentional denormalization preferred?", difficulty: 'EASY', category: 'Schema Normalization' },
      { questionText: "How do B-Tree indexes work in relational databases, and what queries are well-suited for index scans versus sequential scans?", difficulty: 'EASY', category: 'Indexing Fundamentals' },
      { questionText: "How do transaction isolation levels (Read Uncommitted, Read Committed, Repeatable Read, Serializable) protect against concurrency anomalies?", difficulty: 'MEDIUM', category: 'Transaction Isolation Levels' },
      { questionText: "How do you read and interpret an EXPLAIN ANALYZE query plan to identify slow table scans, join bottlenecks, and memory spillages?", difficulty: 'MEDIUM', category: 'Query Optimization & EXPLAIN' },
      { questionText: "Explain the difference between Nested Loop, Hash Join, and Merge Join in database query execution engines.", difficulty: 'MEDIUM', category: 'Join Algorithms & Query Engine' },
      { questionText: "What is the Write-Ahead Log (WAL) in PostgreSQL, and how does it guarantee durability and crash recovery?", difficulty: 'MEDIUM', category: 'Write-Ahead Logging & Durability' },
      { questionText: "How do database locks work: shared locks, exclusive locks, row-level locks, and how does the database engine detect and resolve deadlocks?", difficulty: 'MEDIUM', category: 'Locking & Deadlock Resolution' },
      { questionText: "What are the differences between horizontal sharding, range partitioning, and hash partitioning for large-scale data tables?", difficulty: 'ADVANCED', category: 'Partitioning & Sharding' },
      { questionText: "How do database connection poolers like PgBouncer manage pooled connections, transaction mode versus session mode, and connection exhaustion?", difficulty: 'ADVANCED', category: 'Connection Pooling & Sizing' },
      { questionText: "How do you design a zero-downtime database migration strategy for rolling out non-null columns and schema transformations on multi-terabyte tables?", difficulty: 'ADVANCED', category: 'Zero-Downtime Schema Migrations' },
      { questionText: "Explain how PostgreSQL implements Multi-Version Concurrency Control (MVCC) and why the VACUUM process is necessary for managing dead tuples.", difficulty: 'ADVANCED', category: 'MVCC & Vacuum Internals' },
      { questionText: "How does PostgreSQL full-text search with tsvector and GIN indexing compare to dedicated search clusters like Elasticsearch?", difficulty: 'ADVANCED', category: 'Full-Text Search & Inverted Indexes' },
      { questionText: "How do you configure physical streaming replication versus logical replication, and how do you monitor and minimize replication lag?", difficulty: 'ADVANCED', category: 'Replication & High Availability' },
      { questionText: "How do you model time-series data in relational databases, using features like hyper-tables, columnar compression, and continuous aggregates?", difficulty: 'ADVANCED', category: 'Time-Series Modeling & Compression' }
    ];
  }

  // Generic Dynamic 15-Question Pool for any other specialized topic or domain
  const capitalizedTopic = topic ? (topic.charAt(0).toUpperCase() + topic.slice(1)) : 'Software Engineering';
  return [
    { questionText: `Walk me through the fundamental architecture and core syntax patterns of ${capitalizedTopic}. What makes it well suited for modern systems?`, difficulty: 'EASY', category: `${capitalizedTopic} Core Principles` },
    { questionText: `In ${capitalizedTopic}, how are data structures and variable lifecycles managed in memory during execution?`, difficulty: 'EASY', category: `${capitalizedTopic} Data & Memory` },
    { questionText: `What are the primary error handling conventions and exception recovery strategies you rely on in ${capitalizedTopic}?`, difficulty: 'EASY', category: `${capitalizedTopic} Error Handling` },
    { questionText: `How does ${capitalizedTopic} handle concurrency, asynchronous operations, or thread safety when handling multiple simultaneous requests?`, difficulty: 'MEDIUM', category: `${capitalizedTopic} Concurrency & Async` },
    { questionText: `Suppose performance degrades significantly under load in ${capitalizedTopic}. What profiling tools and diagnostic steps would you take to isolate the bottleneck?`, difficulty: 'MEDIUM', category: `${capitalizedTopic} Performance Profiling` },
    { questionText: `How do you structure modular components, dependency management, and package isolation when developing large-scale solutions in ${capitalizedTopic}?`, difficulty: 'MEDIUM', category: `${capitalizedTopic} Modular Architecture` },
    { questionText: `What testing frameworks and mocking strategies ensure robust unit, integration, and contract test coverage in ${capitalizedTopic}?`, difficulty: 'MEDIUM', category: `${capitalizedTopic} Testing & QA` },
    { questionText: `What security risks, input validation concerns, or authentication vulnerabilities are critical to protect against in ${capitalizedTopic}?`, difficulty: 'MEDIUM', category: `${capitalizedTopic} Application Security` },
    { questionText: `How does ${capitalizedTopic} interface with relational or distributed databases, and how do you optimize network payload and connection pooling?`, difficulty: 'ADVANCED', category: `${capitalizedTopic} Data Persistence & I/O` },
    { questionText: `When query traffic or user workloads spike by 10x, how would you scale a service built with ${capitalizedTopic} horizontally across containerized clusters?`, difficulty: 'ADVANCED', category: `${capitalizedTopic} Distributed Scaling` },
    { questionText: `Explain how you implement distributed resilience patterns like circuit breakers, retry backoff with jitter, and dead letter queues in ${capitalizedTopic}.`, difficulty: 'ADVANCED', category: `${capitalizedTopic} Resilience & Fault Tolerance` },
    { questionText: `How do you configure CI/CD automation, automated linting, container builds, and zero-downtime rolling deployments for ${capitalizedTopic}?`, difficulty: 'ADVANCED', category: `${capitalizedTopic} CI/CD & Cloud Deployment` },
    { questionText: `What telemetry, distributed tracing, structured logging, and health probe architectures do you establish for monitoring ${capitalizedTopic} in production?`, difficulty: 'ADVANCED', category: `${capitalizedTopic} Telemetry & Observability` },
    { questionText: `Describe a complex edge-case bug or production incident you might encounter in ${capitalizedTopic} and how you would conduct a rigorous post-mortem root cause analysis.`, difficulty: 'ADVANCED', category: `${capitalizedTopic} Incident Analysis & Hardening` },
    { questionText: `What architectural trade-offs do you evaluate when deciding between ${capitalizedTopic} and competing industry alternatives for high-scale enterprise systems?`, difficulty: 'ADVANCED', category: `${capitalizedTopic} System Trade-offs & Vision` }
  ];
}

// ── POST /api/interview/start ────────────────────────────────────────────────
interviewRouter.post('/start', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { studentId, domain, topic, difficulty = 'EASY', type = 'MOCK_INTERVIEW' } = req.body;
    const student = await resolveStudent(studentId, req.user?.id);

    const candidateName = req.user?.name || 'Candidate';
    const targetTopic = (topic || domain || req.body.domainOrTopic || student?.track || student?.department || 'Full Stack Development').trim();

    const resume = student?.resume_data || {};
    const questionsPool = getTopicQuestionsPool(targetTopic, candidateName, resume);

    let firstQuestionText = '';
    let category = questionsPool[0]?.category || `${targetTopic} Assessment`;

    // 1. Try real AI question generation grounded specifically on the topic
    try {
      const { generateQuestion } = await import('../modules/evaluation/ai-client');
      const domainContext = `Assigned Topic: "${targetTopic}". Generate a highly relevant, technically precise opening question focused exclusively on ${targetTopic}.`;

      const aiResult = await generateQuestion({
        student_name: candidateName,
        difficulty: (difficulty.toUpperCase() as any) || 'EASY',
        domain: domainContext,
        previous_turns: []
      });

      if (aiResult && !aiResult.unreachable && aiResult.question_text) {
        firstQuestionText = aiResult.question_text;
        category = aiResult.category || category;
      }
    } catch (e) {
      console.warn('[interview.routes] AI generation warning:', e);
    }

    // 2. Fallback to topic question repository if AI was unreachable
    if (!firstQuestionText) {
      firstQuestionText = questionsPool[0].questionText;
    }

    const sessionId = `ses_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    sendSuccess(res, {
      sessionId,
      firstQuestion: {
        id: `q_1_${Date.now()}`,
        questionNumber: 1,
        questionText: firstQuestionText,
        difficulty: difficulty || 'EASY',
        category
      }
    }, 201);
  } catch (err) {
    sendError(res, err);
  }
});

// ── POST /api/interview/submit-turn ──────────────────────────────────────────
interviewRouter.post('/submit-turn', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      sessionId,
      studentId,
      studentAnswer,
      durationSeconds = 25,
      turnIndex = 0,
      currentQuestion,
      previousTurns = [],
      sessionType = 'MOCK_INTERVIEW',
      tabSwitches = 0,
      topic,
      timeExpired,
      forceConclude
    } = req.body;

    const student = await resolveStudent(studentId, req.user?.id);
    const targetTopic = (topic || req.body.domainOrTopic || req.body.domain || currentQuestion?.category || student?.track || student?.department || 'Software Engineering').trim();

    // Call Real AI evaluation service
    const { evaluateResponse, generateQuestion } = await import('../modules/evaluation/ai-client');

    const evalRes = await evaluateResponse({
      question_text: currentQuestion?.questionText || 'Technical Question',
      student_answer: studentAnswer || '',
      difficulty: (currentQuestion?.difficulty?.toUpperCase() as any) || 'MEDIUM',
      turn_number: turnIndex + 1,
      domain: targetTopic
    });

    const isAIWorking = !evalRes.unreachable && evalRes.model_used !== 'unavailable';

    const turnEvaluation = {
      id: currentQuestion?.id || `q_${turnIndex + 1}`,
      questionNumber: turnIndex + 1,
      questionText: currentQuestion?.questionText || '',
      difficulty: currentQuestion?.difficulty || 'MEDIUM',
      category: currentQuestion?.category || targetTopic,
      studentAnswer: studentAnswer || '',
      technicalScore: evalRes.technical_score,
      communicationScore: evalRes.communication_score,
      wpm: evalRes.wpm,
      fillerWords: evalRes.filler_count,
      feedback: evalRes.feedback || (isAIWorking ? '' : 'Good conceptual structure. Articulate trade-offs with explicit space-time complexity analysis.'),
      strengths: evalRes.strengths || 'Clear articulation and relevant technical terminology.',
      weaknesses: evalRes.weaknesses || 'Elaborate further on concurrency constraints and system resilience.'
    };

    // Continuous questions until the 15-minute timer ends or candidate concludes
    const isCompleted = (turnIndex >= 49) || Boolean(timeExpired) || Boolean(forceConclude);
    let nextQuestion: any = null;
    let finalReport: any = null;

    if (!isCompleted) {
      // Progressive difficulty scaling
      const nextDiff: 'EASY' | 'MEDIUM' | 'ADVANCED' = turnIndex < 3 ? 'EASY' : turnIndex < 8 ? 'MEDIUM' : 'ADVANCED';
      const history = [...previousTurns, {
        question_text: currentQuestion?.questionText,
        student_answer: studentAnswer,
        difficulty: currentQuestion?.difficulty,
        technical_score: evalRes.technical_score,
        feedback: evalRes.feedback
      }];

      const askedTexts = new Set(
        [...previousTurns.map((t: any) => (t.question_text || '').toLowerCase().trim()), (currentQuestion?.questionText || '').toLowerCase().trim()]
      );

      // 1. Try real AI question generation on specific topic
      let nextQuestionText = '';
      try {
        const nextAI = await generateQuestion({
          student_name: req.user?.name || 'Candidate',
          difficulty: nextDiff,
          previous_turns: history,
          domain: `Topic: ${targetTopic}. Must be a unique technical question strictly on ${targetTopic} without repeating previously asked questions.`
        });
        if (nextAI && !nextAI.unreachable && nextAI.question_text && !askedTexts.has(nextAI.question_text.toLowerCase().trim())) {
          nextQuestionText = nextAI.question_text;
        }
      } catch (err) {
        console.warn('[interview.routes] AI next question generation warning:', err);
      }

      // 2. Fallback to topic question repository: pick next unasked question
      if (!nextQuestionText) {
        const resume = student?.resume_data || {};
        const pool = getTopicQuestionsPool(targetTopic, req.user?.name || 'Candidate', resume);
        const candidateQ = pool.find(q => !askedTexts.has(q.questionText.toLowerCase().trim())) || pool[Math.min(turnIndex + 1, pool.length - 1)];
        nextQuestionText = candidateQ.questionText;
      }

      nextQuestion = {
        id: `q_${turnIndex + 2}_${Date.now()}`,
        questionNumber: turnIndex + 2,
        questionText: nextQuestionText,
        difficulty: nextDiff,
        category: targetTopic
      };
    } else {
      // 13+ Turns Complete or Time Expired — Synthesize Final Diagnostic Report
      const allTurns = [...previousTurns, turnEvaluation];
      const count = Math.max(1, allTurns.length);
      const avgTech = Math.round(allTurns.reduce((acc, t) => acc + (t.technicalScore || 0), 0) / count);
      const avgComm = Math.round(allTurns.reduce((acc, t) => acc + (t.communicationScore || 0), 0) / count);
      const avgWpm = Math.round(allTurns.reduce((acc, t) => acc + (t.wpm || 0), 0) / count);
      const totalFillers = allTurns.reduce((acc, t) => acc + (t.fillerWords || 0), 0);
      const overallScore = Math.round(avgTech * 0.70 + avgComm * 0.30);

      finalReport = {
        id: `rep_${Date.now().toString().slice(-6)}`,
        date: new Date().toISOString().split('T')[0],
        sessionType,
        overallScore,
        technicalScore: avgTech,
        communicationScore: avgComm,
        averageWpm: avgWpm,
        totalFillerWords: totalFillers,
        fillerWordBreakdown: totalFillers > 0 ? { 'uh': Math.round(totalFillers * 0.5), 'um': Math.round(totalFillers * 0.5) } : {},
        skillBreakdown: [
          { skill: `${targetTopic} Competency`, score: avgTech, status: avgTech >= 80 ? 'STRONG' : 'MODERATE', recommendation: allTurns[0]?.feedback || 'Demonstrated consistent conceptual depth.' },
          { skill: 'Verbal Delivery & Articulation', score: avgComm, status: avgComm >= 80 ? 'STRONG' : 'MODERATE', recommendation: `Speaking pace averaged ${avgWpm} WPM across ${count} turns.` }
        ],
        actionableNextSteps: [
          `Pacing averaged ${avgWpm} WPM across ${count} technical questions. ${avgWpm >= 120 && avgWpm <= 150 ? 'Maintain this recruiter tempo.' : 'Aim for 120-150 WPM.'}`,
          totalFillers > 0 ? `Observed ${totalFillers} verbal fillers. Replace fillers with intentional pauses.` : `Fluent delivery with minimal verbal fillers.`,
          allTurns[allTurns.length - 1]?.weaknesses || `Deepen architectural mastery of ${targetTopic} production trade-offs.`
        ],
        tabSwitches,
        isFlagged: tabSwitches >= 4
      };

      // Persist directly to PostgreSQL database
      if (student?.id) {
        await db.query(
          `UPDATE org.students
           SET recent_reports = jsonb_set(
             COALESCE(recent_reports, '[]'::jsonb),
             '{0}',
             $1::jsonb,
             true
           ),
           overall_readiness = $2,
           score = $2,
           updated_at = now()
           WHERE id = $3`,
          [JSON.stringify(finalReport), overallScore, student.id]
        ).catch((err) => console.error('[interview.routes] Failed to save report to org.students:', err));
      }
    }

    sendSuccess(res, {
      isCompleted,
      turnEvaluation,
      nextQuestion,
      finalReport
    });
  } catch (err) {
    sendError(res, err);
  }
});

// ── POST /api/interview/proctor-event ────────────────────────────────────────
interviewRouter.post('/proctor-event', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { sessionId, eventType, tabSwitches = 1 } = req.body;
    sendSuccess(res, {
      sessionId,
      eventType,
      tabSwitches,
      isFlagged: tabSwitches >= 4
    });
  } catch (err) {
    sendError(res, err);
  }
});
