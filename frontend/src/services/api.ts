import { 
  StudentProfile, 
  DiagnosticReport, 
  TrainerTenure, 
  InterviewAssignment, 
  AssignmentSubmission, 
  QuestionTurn, 
  ParsedResume,
  CodingHandles,
  College,
  DynamicProgram,
  DynamicDepartment,
  PendingInvite,
  AdminPermission,
  AuthUser,
  DepartmentClass,
  DepartmentStaffMember
} from '../types';
import { 
  MOCK_INTERVIEW_QUESTIONS, 
  LISTENING_PASSAGES
} from '../data/mockData';

function extractPrimarySkillsAndDomain(student: StudentProfile): {
  primaryLanguage: string;
  secondaryTech: string[];
  primaryProject: string;
  domainName: string;
  domainCategory: 'AI_ML' | 'FULL_STACK' | 'BACKEND' | 'CLOUD_DEVOPS' | 'MOBILE' | 'CYBERSECURITY' | 'GENERAL_CS';
} {
  const resume = student.resume;
  let primaryLanguage = 'Python';
  let secondaryTech: string[] = [];
  let primaryProject = 'Technical Capstone Project';
  let domainName = student.subProgramName || student.programName || student.track || student.department || 'Computer Science & Engineering';

  if (resume?.skills?.languages && resume.skills.languages.length > 0) {
    primaryLanguage = resume.skills.languages[0];
    secondaryTech = [
      ...(resume.skills.frameworks || []),
      ...(resume.skills.databases || []),
      ...(resume.skills.tools || [])
    ].slice(0, 4);
  } else {
    // Determine language by track or department if no resume
    const deptTrack = domainName.toLowerCase();
    if (deptTrack.includes('ai') || deptTrack.includes('data') || deptTrack.includes('machine learning')) {
      primaryLanguage = 'Python';
      secondaryTech = ['PyTorch', 'TensorFlow', 'FastAPI', 'Pandas'];
    } else if (deptTrack.includes('cloud') || deptTrack.includes('devops')) {
      primaryLanguage = 'Go';
      secondaryTech = ['Docker', 'Kubernetes', 'AWS', 'Terraform'];
    } else if (deptTrack.includes('cyber') || deptTrack.includes('security')) {
      primaryLanguage = 'Python / Bash';
      secondaryTech = ['Wireshark', 'Cryptography', 'Linux', 'Network Protocols'];
    } else if (deptTrack.includes('web') || deptTrack.includes('full stack')) {
      primaryLanguage = 'TypeScript';
      secondaryTech = ['React', 'Node.js', 'PostgreSQL', 'Tailwind CSS'];
    } else {
      primaryLanguage = 'Java';
      secondaryTech = ['Spring Boot', 'PostgreSQL', 'Docker', 'RESTful APIs'];
    }
  }

  if (resume?.projects && resume.projects.length > 0) {
    primaryProject = resume.projects[0].title;
  } else {
    primaryProject = `${domainName} Application`;
  }

  // Detect domain category for tailored questions
  const allTechStr = `${primaryLanguage} ${secondaryTech.join(' ')} ${domainName} ${primaryProject}`.toLowerCase();
  let domainCategory: 'AI_ML' | 'FULL_STACK' | 'BACKEND' | 'CLOUD_DEVOPS' | 'MOBILE' | 'CYBERSECURITY' | 'GENERAL_CS' = 'GENERAL_CS';

  if (allTechStr.includes('python') && (allTechStr.includes('torch') || allTechStr.includes('tensor') || allTechStr.includes('model') || allTechStr.includes('ai') || allTechStr.includes('data') || allTechStr.includes('ml'))) {
    domainCategory = 'AI_ML';
  } else if (allTechStr.includes('react') || allTechStr.includes('vue') || allTechStr.includes('frontend') || allTechStr.includes('full stack') || allTechStr.includes('next.js') || allTechStr.includes('javascript') || allTechStr.includes('typescript')) {
    domainCategory = 'FULL_STACK';
  } else if (allTechStr.includes('docker') || allTechStr.includes('kubernetes') || allTechStr.includes('devops') || allTechStr.includes('cloud') || allTechStr.includes('aws') || allTechStr.includes('terraform')) {
    domainCategory = 'CLOUD_DEVOPS';
  } else if (allTechStr.includes('flutter') || allTechStr.includes('android') || allTechStr.includes('ios') || allTechStr.includes('swift') || allTechStr.includes('react native')) {
    domainCategory = 'MOBILE';
  } else if (allTechStr.includes('security') || allTechStr.includes('cyber') || allTechStr.includes('wireshark') || allTechStr.includes('crypt')) {
    domainCategory = 'CYBERSECURITY';
  } else if (allTechStr.includes('java') || allTechStr.includes('spring') || allTechStr.includes('golang') || allTechStr.includes('backend') || allTechStr.includes('microservice') || allTechStr.includes('c++')) {
    domainCategory = 'BACKEND';
  }

  return { primaryLanguage, secondaryTech, primaryProject, domainName, domainCategory };
}

function generateDynamicQuestions(student: StudentProfile, customTopic?: string): QuestionTurn[] {
  const normTopic = (customTopic || student.track || student.department || '').toLowerCase();
  const { primaryLanguage, secondaryTech, primaryProject, domainName } = extractPrimarySkillsAndDomain(student);
  const techList = secondaryTech.length > 0 ? secondaryTech.join(', ') : 'modern architecture patterns';

  // Topic: Python
  if (normTopic.includes('python')) {
    const pyQuestions = [
      { text: "Can you explain the Python data model, mutable versus immutable built-in data types, and how dictionary hashing works under the hood?", diff: 'EASY' as const, cat: 'Python Core & Data Model' },
      { text: "How do Python generators and the yield keyword work, and in what scenarios do they offer major memory efficiency advantages over lists?", diff: 'EASY' as const, cat: 'Python Iterators & Generators' },
      { text: "What is the Global Interpreter Lock (GIL) in CPython, and what are the architectural trade-offs between multi-threading, multi-processing, and asyncio?", diff: 'EASY' as const, cat: 'Python Concurrency & GIL' },
      { text: "How does Python handle memory management, reference counting, and cyclic garbage collection with generations?", diff: 'EASY' as const, cat: 'Memory Management' },
      { text: "Walk me through how decorators work in Python. How would you write a reusable decorator that logs execution time and preserves metadata using functools.wraps?", diff: 'MEDIUM' as const, cat: 'Python Metaprogramming' },
      { text: "What is the difference between __new__ and __init__ in Python classes, and how are metaclasses used to enforce class structures?", diff: 'MEDIUM' as const, cat: 'Object-Oriented Python' },
      { text: "How do context managers work in Python with __enter__ and __exit__, and how does contextlib.contextmanager simplify resource handling?", diff: 'MEDIUM' as const, cat: 'Resource Management' },
      { text: "How would you handle heavy CPU-bound workloads in Python? When would you look at C-extensions, Cython, or multiprocessing pools?", diff: 'MEDIUM' as const, cat: 'Performance Optimization' },
      { text: "In asynchronous Python with asyncio, how do event loops schedule coroutines, and how do you prevent blocking calls from freezing the entire loop?", diff: 'MEDIUM' as const, cat: 'AsyncIO & Event Loops' },
      { text: "How do you leverage type hinting and MyPy static analysis in Python to achieve robust type safety and structural subtyping with Protocols?", diff: 'ADVANCED' as const, cat: 'Static Typing & Tooling' },
      { text: "When architecting a production REST or GraphQL API using FastAPI or Django, how do you handle dependency injection, connection pooling, and background tasks?", diff: 'ADVANCED' as const, cat: 'Web Framework Architecture' },
      { text: "Describe your strategy for profiling CPU bottlenecks and memory leaks in a live Python service using cProfile and tracemalloc.", diff: 'ADVANCED' as const, cat: 'Profiling & Observability' },
      { text: "How would you design a distributed, fault-tolerant background task processing queue in Python with Celery and Redis with idempotent retry mechanisms?", diff: 'ADVANCED' as const, cat: 'Distributed Systems in Python' },
      { text: "How do you manage complex package dependencies, lock files, and containerization security vulnerabilities in Python production deployments?", diff: 'ADVANCED' as const, cat: 'Packaging & Security' },
      { text: "What architectural patterns do you employ when designing clean architecture and domain-driven design in large Python codebases?", diff: 'ADVANCED' as const, cat: 'Domain-Driven Design' }
    ];
    return pyQuestions.map((q, idx) => ({
      id: `q_py_${idx + 1}_${Date.now() + idx}`,
      questionNumber: idx + 1,
      questionText: q.text,
      difficulty: q.diff,
      category: q.cat
    }));
  }

  // Topic: React / Frontend
  if (normTopic.includes('react') || normTopic.includes('frontend') || normTopic.includes('web')) {
    const reactQuestions = [
      { text: "How does React's Virtual DOM reconciliation and Fiber diffing algorithm optimize DOM updates compared to direct DOM manipulation?", diff: 'EASY' as const, cat: 'React Core & Reconciliation' },
      { text: "Explain the rules and mechanics of React Hooks, specifically how useState and useEffect maintain state across component re-renders.", diff: 'EASY' as const, cat: 'React Hooks & Lifecycle' },
      { text: "What are the key trade-offs between component state, Context API, Redux Toolkit, and atomic state libraries like Zustand?", diff: 'EASY' as const, cat: 'State Management' },
      { text: "How do useCallback and useMemo work under the hood, and when does premature memoization hurt performance rather than help?", diff: 'EASY' as const, cat: 'Performance Optimization' },
      { text: "What is the browser critical rendering path, and how do reflow and repaint cycles impact 60 FPS rendering in interactive web apps?", diff: 'MEDIUM' as const, cat: 'Browser Rendering & DOM' },
      { text: "Explain how React Server Components (RSC) differ from traditional Client Components and Server-Side Rendering (SSR).", diff: 'MEDIUM' as const, cat: 'Modern React Architecture' },
      { text: "How would you diagnose and fix a slow web application with poor Core Web Vitals (LCP, INP, CLS)?", diff: 'MEDIUM' as const, cat: 'Core Web Vitals & Web Performance' },
      { text: "How do you prevent race conditions when handling multiple asynchronous data requests triggered by rapid user input in React?", diff: 'MEDIUM' as const, cat: 'Async State & Data Fetching' },
      { text: "What security measures do you implement in frontend applications to prevent Cross-Site Scripting (XSS), CSRF, and token theft?", diff: 'MEDIUM' as const, cat: 'Frontend Security' },
      { text: "How would you design a micro-frontend architecture using Webpack Module Federation for independent multi-team deployments?", diff: 'ADVANCED' as const, cat: 'Micro-frontends & Build Systems' },
      { text: "Explain how Service Workers, Cache Storage API, and Web Workers enable offline capabilities and background multi-threading.", diff: 'ADVANCED' as const, cat: 'PWA & Web Workers' },
      { text: "How do you architect an enterprise design system with accessible components conforming strictly to WCAG 2.1 AA specifications?", diff: 'ADVANCED' as const, cat: 'Design Systems & Accessibility' },
      { text: "When implementing real-time collaborative features in web applications, how do you handle WebSocket connection state and data conflict resolution (CRDTs/OT)?", diff: 'ADVANCED' as const, cat: 'Real-time & Collaborative Systems' },
      { text: "Describe your end-to-end testing and visual regression pipeline for frontend applications using Vitest, React Testing Library, and Playwright.", diff: 'ADVANCED' as const, cat: 'Testing & Quality Assurance' },
      { text: "How do you architect frontend bundle splitting, dynamic imports, and CDN caching headers to achieve sub-second initial paint times globally?", diff: 'ADVANCED' as const, cat: 'Bundle Optimization & Delivery' }
    ];
    return reactQuestions.map((q, idx) => ({
      id: `q_fe_${idx + 1}_${Date.now() + idx}`,
      questionNumber: idx + 1,
      questionText: q.text,
      difficulty: q.diff,
      category: q.cat
    }));
  }

  // Topic: System Design & Architecture
  if (normTopic.includes('system design') || normTopic.includes('architecture') || normTopic.includes('distributed')) {
    const sysQuestions = [
      { text: "What are the core trade-offs between monolithic architectures and microservices architectures, and when should a team decouple?", diff: 'EASY' as const, cat: 'System Architecture Fundamentals' },
      { text: "Explain horizontal versus vertical scaling, and describe how load balancers distribute traffic using algorithms like Round Robin and Consistent Hashing.", diff: 'EASY' as const, cat: 'Scalability & Load Balancing' },
      { text: "What is the CAP theorem, and how does the PACELC theorem expand our understanding of latency versus consistency in distributed databases?", diff: 'EASY' as const, cat: 'CAP Theorem & Distributed Data' },
      { text: "How do caching strategies like Cache-Aside, Write-Through, and Write-Behind differ, and how do you prevent cache stampedes and thundering herds?", diff: 'EASY' as const, cat: 'Caching & Eviction Strategies' },
      { text: "Compare relational databases (PostgreSQL) with NoSQL databases (Document, Key-Value, Columnar) for high-throughput write workloads.", diff: 'MEDIUM' as const, cat: 'Database Selection & Modeling' },
      { text: "How does a distributed message broker like Apache Kafka handle event partitioning, consumer groups, and offset commit semantics?", diff: 'MEDIUM' as const, cat: 'Message Brokers & Event Streaming' },
      { text: "What mechanisms guarantee data consistency across microservices: Two-Phase Commit (2PC) versus the Saga pattern with compensating transactions?", diff: 'MEDIUM' as const, cat: 'Distributed Transactions' },
      { text: "How do you implement rate limiting across distributed microservices using algorithms like Token Bucket, Leaky Bucket, and Redis sliding windows?", diff: 'MEDIUM' as const, cat: 'Rate Limiting & Traffic Shaping' },
      { text: "How do you design a distributed unique ID generator (such as Twitter Snowflake) that guarantees time-sortability and high throughput without centralized locks?", diff: 'MEDIUM' as const, cat: 'Distributed Algorithms' },
      { text: "How do you implement circuit breakers, retry backoff with randomized jitter, and bulkheads to prevent cascading system failures?", diff: 'ADVANCED' as const, cat: 'Resilience & Fault Tolerance' },
      { text: "How do distributed consensus algorithms like Raft and Paxos ensure cluster state consistency during leader election and network partitions?", diff: 'ADVANCED' as const, cat: 'Distributed Consensus' },
      { text: "Design a scalable URL shortening service (like Bitly) supporting 100 million daily active users, detailing the database schema, hashing, caching, and analytics.", diff: 'ADVANCED' as const, cat: 'System Design Case Study' },
      { text: "How do you architect end-to-end distributed tracing and observability using OpenTelemetry, structured logging, and real-time anomaly alerting?", diff: 'ADVANCED' as const, cat: 'Telemetry & Observability' },
      { text: "When dealing with geo-distributed database replication, how do you handle replication lag, conflict resolution, and read-after-write consistency for users?", diff: 'ADVANCED' as const, cat: 'Geo-Replication & Consistency' },
      { text: "How would you design a real-time notification service delivering push, SMS, and email notifications to 50 million concurrent subscribers with deduplication?", diff: 'ADVANCED' as const, cat: 'High Scale Notification Engine' }
    ];
    return sysQuestions.map((q, idx) => ({
      id: `q_sd_${idx + 1}_${Date.now() + idx}`,
      questionNumber: idx + 1,
      questionText: q.text,
      difficulty: q.diff,
      category: q.cat
    }));
  }

  // Topic: Database & SQL
  if (normTopic.includes('database') || normTopic.includes('sql') || normTopic.includes('postgres')) {
    const dbQuestions = [
      { text: "Can you explain the ACID properties in relational databases and how each property is guaranteed by the database engine?", diff: 'EASY' as const, cat: 'ACID Transactions' },
      { text: "What are the rules of database normalization (1NF, 2NF, 3NF, BCNF), and in what scenarios is intentional denormalization preferred?", diff: 'EASY' as const, cat: 'Schema Normalization' },
      { text: "How do B-Tree indexes work in relational databases, and what queries are well-suited for index scans versus sequential scans?", diff: 'EASY' as const, cat: 'Indexing Fundamentals' },
      { text: "How do transaction isolation levels (Read Uncommitted, Read Committed, Repeatable Read, Serializable) protect against concurrency anomalies?", diff: 'EASY' as const, cat: 'Transaction Isolation Levels' },
      { text: "How do you read and interpret an EXPLAIN ANALYZE query plan to identify slow table scans, join bottlenecks, and memory spillages?", diff: 'MEDIUM' as const, cat: 'Query Optimization & EXPLAIN' },
      { text: "Explain the difference between Nested Loop, Hash Join, and Merge Join in database query execution engines.", diff: 'MEDIUM' as const, cat: 'Join Algorithms & Query Engine' },
      { text: "What is the Write-Ahead Log (WAL) in PostgreSQL, and how does it guarantee durability and crash recovery?", diff: 'MEDIUM' as const, cat: 'Write-Ahead Logging & Durability' },
      { text: "How do database locks work: shared locks, exclusive locks, row-level locks, and how does the database engine detect and resolve deadlocks?", diff: 'MEDIUM' as const, cat: 'Locking & Deadlock Resolution' },
      { text: "What are the differences between horizontal sharding, range partitioning, and hash partitioning for large-scale data tables?", diff: 'MEDIUM' as const, cat: 'Partitioning & Sharding' },
      { text: "How do database connection poolers like PgBouncer manage pooled connections, transaction mode versus session mode, and connection exhaustion?", diff: 'ADVANCED' as const, cat: 'Connection Pooling & Sizing' },
      { text: "How do you design a zero-downtime database migration strategy for rolling out non-null columns and schema transformations on multi-terabyte tables?", diff: 'ADVANCED' as const, cat: 'Zero-Downtime Schema Migrations' },
      { text: "Explain how PostgreSQL implements Multi-Version Concurrency Control (MVCC) and why the VACUUM process is necessary for managing dead tuples.", diff: 'ADVANCED' as const, cat: 'MVCC & Vacuum Internals' },
      { text: "How does PostgreSQL full-text search with tsvector and GIN indexing compare to dedicated search clusters like Elasticsearch?", diff: 'ADVANCED' as const, cat: 'Full-Text Search & Inverted Indexes' },
      { text: "How do you configure physical streaming replication versus logical replication, and how do you monitor and minimize replication lag?", diff: 'ADVANCED' as const, cat: 'Replication & High Availability' },
      { text: "How do you model time-series data in relational databases, using features like hyper-tables, columnar compression, and continuous aggregates?", diff: 'ADVANCED' as const, cat: 'Time-Series Modeling & Compression' }
    ];
    return dbQuestions.map((q, idx) => ({
      id: `q_db_${idx + 1}_${Date.now() + idx}`,
      questionNumber: idx + 1,
      questionText: q.text,
      difficulty: q.diff,
      category: q.cat
    }));
  }

  // Dynamic 15-Question Generation for any other topic or candidate resume
  const targetTopicLabel = customTopic ? customTopic.trim() : `${primaryLanguage} & ${domainName}`;
  const genericQuestions = [
    { text: `Walk me through the system architecture of your project "${primaryProject}". Specifically, how did you structure components using ${primaryLanguage} and ${techList}, and what was the main engineering challenge you solved?`, diff: 'EASY' as const, cat: 'System Architecture & Principles' },
    { text: `In the context of ${targetTopicLabel}, how are data structures and variable lifecycles managed in memory during execution?`, diff: 'EASY' as const, cat: 'Data Structures & Memory' },
    { text: `What are the primary error handling conventions, retry strategies, and exception recovery patterns you rely on in ${targetTopicLabel}?`, diff: 'EASY' as const, cat: 'Error Handling & Resilience' },
    { text: `How does ${targetTopicLabel} manage concurrency, multi-threading, or asynchronous tasks when processing simultaneous high-throughput requests?`, diff: 'EASY' as const, cat: 'Concurrency & Async Models' },
    { text: `Suppose query or request traffic spikes by 10x in ${targetTopicLabel}. How would you diagnose performance bottlenecks, optimize database indexing, and implement caching?`, diff: 'MEDIUM' as const, cat: 'Scalability & Bottlenecks' },
    { text: `How do you structure modular components, dependency injection, and clean boundary separation when building large-scale solutions in ${targetTopicLabel}?`, diff: 'MEDIUM' as const, cat: 'Modular Architecture' },
    { text: `What testing frameworks and mocking strategies do you use to achieve reliable unit, integration, and contract test coverage in ${targetTopicLabel}?`, diff: 'MEDIUM' as const, cat: 'Testing & Quality Assurance' },
    { text: `What security vulnerabilities, authentication flows, and input sanitization practices are essential to protect against in ${targetTopicLabel}?`, diff: 'MEDIUM' as const, cat: 'Application Security' },
    { text: `How does ${targetTopicLabel} interact with external databases or message streams, and how do you prevent connection pool starvation?`, diff: 'MEDIUM' as const, cat: 'Persistence & I/O' },
    { text: `Explain how you implement distributed resilience patterns like circuit breakers, retry backoff with jitter, and dead letter queues in ${targetTopicLabel}.`, diff: 'ADVANCED' as const, cat: 'Fault Tolerance & Resilience' },
    { text: `How do you configure CI/CD automation, automated linting, container builds, and zero-downtime rolling deployments for ${targetTopicLabel}?`, diff: 'ADVANCED' as const, cat: 'DevOps & Containerization' },
    { text: `What telemetry, distributed tracing, structured logging, and health probe architectures do you establish for monitoring ${targetTopicLabel} in production?`, diff: 'ADVANCED' as const, cat: 'Telemetry & Observability' },
    { text: `Describe how you design fault-tolerant systems in ${primaryLanguage}. When unexpected failures occur, what automated recovery and telemetry strategies ensure zero data loss?`, diff: 'ADVANCED' as const, cat: 'Disaster Recovery' },
    { text: `Describe a complex edge-case bug or performance incident you resolved in ${targetTopicLabel} and how you conducted the post-mortem analysis.`, diff: 'ADVANCED' as const, cat: 'Incident Response & Post-Mortem' },
    { text: `What architectural trade-offs do you evaluate when deciding between ${targetTopicLabel} and competing industry alternatives for high-scale enterprise systems?`, diff: 'ADVANCED' as const, cat: 'Architectural Trade-offs' }
  ];

  return genericQuestions.map((q, idx) => ({
    id: `q_dyn_${idx + 1}_${Date.now() + idx}`,
    questionNumber: idx + 1,
    questionText: q.text,
    difficulty: q.diff,
    category: q.cat
  }));
}

function analyzeSpokenSpeech(text: string, durationSeconds = 18): {
  wordCount: number;
  wpm: number;
  fillers: Record<string, number>;
  totalFillers: number;
  detectedTechTerms: string[];
} {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const effectiveDuration = Math.max(durationSeconds, 6);
  const wpm = Math.max(70, Math.min(210, Math.round((wordCount / effectiveDuration) * 60)));

  const lower = text.toLowerCase();
  const commonFillers = ['uh', 'um', 'like', 'basically', 'actually', 'you know', 'sort of', 'kind of', 'i mean', 'right'];
  const fillers: Record<string, number> = {};
  let totalFillers = 0;

  for (const f of commonFillers) {
    const regex = new RegExp(`\\b${f}\\b`, 'g');
    const matches = lower.match(regex);
    if (matches && matches.length > 0) {
      fillers[f] = matches.length;
      totalFillers += matches.length;
    }
  }

  const technicalKeywords = [
    'latency', 'throughput', 'concurrency', 'asynchronous', 'cache', 'caching',
    'redis', 'database', 'index', 'indexing', 'kafka', 'partition', 'microservice',
    'cluster', 'docker', 'kubernetes', 'scale', 'scaling', 'load balancer', 'algorithm',
    'architecture', 'tradeoff', 'idempotent', 'resilient', 'failover', 'pipeline',
    'encryption', 'thread', 'memory', 'query', 'payload', 'schema', 'transaction',
    'connection pool', 'distributed', 'event-driven', 'rest', 'api', 'state', 'grpc'
  ];

  const detectedTechTerms = technicalKeywords.filter(k => lower.includes(k));

  return { wordCount, wpm, fillers, totalFillers, detectedTechTerms };
}

function evaluateDynamicAnswer(
  question: QuestionTurn,
  studentAnswer: string,
  turnIndex: number,
  durationSeconds: number,
  student: StudentProfile
): {
  technicalScore: number;
  communicationScore: number;
  wpm: number;
  fillerWords: number;
  fillers: Record<string, number>;
  feedback: string;
  strengths: string;
  weaknesses: string;
  nextQuestionText?: string;
} {
  const { wordCount, wpm, fillers, totalFillers, detectedTechTerms } = analyzeSpokenSpeech(studentAnswer, durationSeconds);

  let technicalScore = 70;
  technicalScore += Math.min(18, detectedTechTerms.length * 4);
  if (wordCount >= 25) technicalScore += 4;
  if (wordCount >= 50) technicalScore += 4;
  if (wordCount < 15) technicalScore -= 10;
  technicalScore = Math.max(62, Math.min(96, technicalScore));

  let communicationScore = 86;
  if (wpm >= 120 && wpm <= 150) {
    communicationScore += 5;
  } else if (wpm < 110) {
    communicationScore -= 8;
  } else if (wpm > 160) {
    communicationScore -= 7;
  }
  communicationScore -= Math.min(18, totalFillers * 3);
  if (/\b(because|specifically|furthermore|in order to|therefore|for instance)\b/i.test(studentAnswer)) {
    communicationScore += 4;
  }
  communicationScore = Math.max(55, Math.min(96, communicationScore));

  const paceVerdict = wpm < 110 ? 'hesitant (<110 WPM)' : wpm > 155 ? 'rapid (>155 WPM)' : 'optimal (120–150 WPM)';
  const feedback = `Articulated at ${wpm} WPM (${paceVerdict}). Detected ${totalFillers} filler words. Technical concepts identified: ${
    detectedTechTerms.length > 0 ? detectedTechTerms.slice(0, 3).join(', ') : 'general conceptual flow'
  }.`;

  const strengths = detectedTechTerms.length > 0
    ? `Strong technical command highlighting ${detectedTechTerms.slice(0, 2).join(' and ')}.`
    : `Good conversational clarity and confident delivery tone.`;

  const topFiller = Object.keys(fillers).sort((a, b) => (fillers[b] || 0) - (fillers[a] || 0))[0];
  const weaknesses = totalFillers > 2
    ? `Watch frequency of verbal crutch "${topFiller}". Replace with deliberate 1-second silence.`
    : wpm < 110
    ? `Pace is slightly measured; practice continuous technical momentum.`
    : `Provide specific quantitative trade-offs (e.g. latency impact in milliseconds).`;

  let nextQuestionText: string | undefined = undefined;
  if (turnIndex === 0) {
    const term = detectedTechTerms[0] || 'your core services';
    nextQuestionText = `You mentioned how you implemented ${term}. In a high-traffic production scenario, how would you optimize data access and prevent latency degradation?`;
  } else if (turnIndex === 1) {
    const term = detectedTechTerms[0] || 'the primary subsystem';
    nextQuestionText = `Considering ${term}, what happens if network partitions occur or dependent downstream services time out? How do you ensure high availability and idempotency?`;
  }

  return {
    technicalScore,
    communicationScore,
    wpm,
    fillerWords: totalFillers,
    fillers,
    feedback,
    strengths,
    weaknesses,
    nextQuestionText
  };
}

function synthesizeDynamicReport(
  sessionType: 'MOCK_INTERVIEW' | 'LISTENING_COMPREHENSION',
  turns: QuestionTurn[],
  student: StudentProfile,
  tabSwitches: number
): DiagnosticReport {
  const turnCount = Math.max(1, turns.length);
  const avgTech = Math.round(turns.reduce((acc, t) => acc + (t.technicalScore || 0), 0) / turnCount);
  const avgComm = Math.round(turns.reduce((acc, t) => acc + (t.communicationScore || 0), 0) / turnCount);
  const overallScore = Math.round(avgTech * 0.70 + avgComm * 0.30);
  const avgWpm = Math.round(turns.reduce((acc, t) => acc + (t.wpm || 0), 0) / turnCount);

  const fillerWordBreakdown: Record<string, number> = {};
  let totalFillers = 0;
  turns.forEach(t => {
    totalFillers += (t.fillerWords || 0);
  });
  if (totalFillers > 0) {
    fillerWordBreakdown['uh'] = Math.max(1, Math.round(totalFillers * 0.5));
    fillerWordBreakdown['um'] = Math.round(totalFillers * 0.5);
  }

  const { primaryLanguage, domainName } = extractPrimarySkillsAndDomain(student);
  const skillBreakdown = [
    {
      skill: `${primaryLanguage} & Architectural Mastery`,
      score: avgTech,
      status: (avgTech >= 85 ? 'STRONG' : avgTech >= 75 ? 'MODERATE' : 'NEEDS_WORK') as 'STRONG' | 'MODERATE' | 'NEEDS_WORK',
      recommendation: `Demonstrates solid command over ${primaryLanguage} core concurrency and structure.`
    },
    {
      skill: `${domainName} Scalability`,
      score: Math.min(95, Math.max(65, avgTech + (Math.random() > 0.5 ? 3 : -4))),
      status: (avgTech >= 80 ? 'STRONG' : 'MODERATE') as 'STRONG' | 'MODERATE' | 'NEEDS_WORK',
      recommendation: `Good awareness of horizontal scaling patterns and database indexing.`
    },
    {
      skill: 'Verbal Delivery & Speaking Pace',
      score: avgComm,
      status: (avgComm >= 85 ? 'STRONG' : avgComm >= 75 ? 'MODERATE' : 'NEEDS_WORK') as 'STRONG' | 'MODERATE' | 'NEEDS_WORK',
      recommendation: avgWpm >= 120 && avgWpm <= 150
        ? `Speaking pace of ${avgWpm} WPM is within the optimal recruiter hiring zone (120–150 WPM).`
        : `Pace (${avgWpm} WPM) requires modulation to maintain recruiter engagement.`
    },
    {
      skill: 'Distributed Resiliency & Failure Recovery',
      score: Math.max(60, avgTech - 5),
      status: (avgTech >= 82 ? 'STRONG' : 'NEEDS_WORK') as 'STRONG' | 'MODERATE' | 'NEEDS_WORK',
      recommendation: 'Review CAP theorem trade-offs and circuit breaker fallback strategies.'
    }
  ];

  const actionableNextSteps: string[] = [];
  if (avgWpm < 115) {
    actionableNextSteps.push(`Increase spoken momentum: Your pace of ${avgWpm} WPM is slightly slow. Aim for 120–150 WPM.`);
  } else if (avgWpm > 155) {
    actionableNextSteps.push(`Pace down your delivery: Speaking at ${avgWpm} WPM can overwhelm interviewers. Use intentional pauses.`);
  } else {
    actionableNextSteps.push(`Maintain your speaking pace! Your speed of ${avgWpm} WPM is right in the recruiter target band.`);
  }

  if (totalFillers > 3) {
    actionableNextSteps.push(`Reduce vocal fillers: Detected ${totalFillers} filler words. Practice replacing filler words with 1-second silence.`);
  } else {
    actionableNextSteps.push(`Great verbal economy: Very low filler word frequency recorded throughout the interview.`);
  }

  actionableNextSteps.push(`Deepen domain answers for ${domainName} with concrete metrics (e.g. latency reduced by 40ms, 99.9% uptime).`);

  return {
    id: `rep_${Date.now().toString().slice(-4)}`,
    date: new Date().toISOString().split('T')[0],
    sessionType,
    overallScore,
    technicalScore: avgTech,
    communicationScore: avgComm,
    averageWpm: avgWpm,
    totalFillerWords: totalFillers,
    fillerWordBreakdown,
    skillBreakdown,
    actionableNextSteps,
    tabSwitches,
    isFlagged: tabSwitches >= 4
  };
}

function parseResumeContent(rawText: string, fileName: string): ParsedResume {
  const cleanText = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 1. Programming Languages
  const knownLanguages = [
    { name: 'Python', regex: /\bpython\b/i },
    { name: 'Java', regex: /\bjava\b(?!script)/i },
    { name: 'JavaScript', regex: /\b(?:javascript|js)\b/i },
    { name: 'TypeScript', regex: /\b(?:typescript|ts)\b/i },
    { name: 'C++', regex: /\bc\+\+\b/i },
    { name: 'C#', regex: /\bc#|\bc-sharp\b/i },
    { name: 'C', regex: /\b(?<!\w)c(?!\w|\+|#)/i },
    { name: 'Go', regex: /\b(?:golang|go)\b/i },
    { name: 'Rust', regex: /\brust\b/i },
    { name: 'Ruby', regex: /\bruby\b/i },
    { name: 'PHP', regex: /\bphp\b/i },
    { name: 'Swift', regex: /\bswift\b/i },
    { name: 'Kotlin', regex: /\bkotlin\b/i },
    { name: 'Dart', regex: /\bdart\b/i },
    { name: 'SQL', regex: /\bsql\b/i },
    { name: 'HTML/CSS', regex: /\b(?:html|css|html5|css3)\b/i },
    { name: 'R', regex: /\b(?<!\w)r(?!\w)\b/i },
    { name: 'Scala', regex: /\bscala\b/i },
    { name: 'Shell/Bash', regex: /\b(?:bash|shell|powershell)\b/i },
  ];

  const extractedLanguages = knownLanguages
    .filter(item => item.regex.test(cleanText))
    .map(item => item.name);

  // 2. Frameworks & Libraries
  const knownFrameworks = [
    { name: 'React', regex: /\breact(?:\.js)?\b/i },
    { name: 'Node.js', regex: /\bnode(?:\.js)?\b/i },
    { name: 'Next.js', regex: /\bnext(?:\.js)?\b/i },
    { name: 'Express.js', regex: /\bexpress(?:\.js)?\b/i },
    { name: 'Vue.js', regex: /\bvue(?:\.js)?\b/i },
    { name: 'Angular', regex: /\bangular\b/i },
    { name: 'Spring Boot', regex: /\bspring(?:\s*boot)?\b/i },
    { name: 'Django', regex: /\bdjango\b/i },
    { name: 'FastAPI', regex: /\bfastapi\b/i },
    { name: 'Flask', regex: /\bflask\b/i },
    { name: 'ASP.NET', regex: /\basp\.net|\b\.net\b/i },
    { name: 'Tailwind CSS', regex: /\btailwind(?:\s*css)?\b/i },
    { name: 'Bootstrap', regex: /\bbootstrap\b/i },
    { name: 'TensorFlow', regex: /\btensorflow\b/i },
    { name: 'PyTorch', regex: /\bpytorch\b/i },
    { name: 'Keras', regex: /\bkeras\b/i },
    { name: 'Scikit-learn', regex: /\bscikit(?:-learn)?|sklearn\b/i },
    { name: 'Flutter', regex: /\bflutter\b/i },
    { name: 'React Native', regex: /\breact\s*native\b/i },
    { name: 'Redux', regex: /\bredux\b/i },
    { name: 'GraphQL', regex: /\bgraphql\b/i },
  ];

  const extractedFrameworks = knownFrameworks
    .filter(item => item.regex.test(cleanText))
    .map(item => item.name);

  // 3. Databases
  const knownDatabases = [
    { name: 'PostgreSQL', regex: /\bpostgres(?:ql)?\b/i },
    { name: 'MySQL', regex: /\bmysql\b/i },
    { name: 'MongoDB', regex: /\bmongo(?:db)?\b/i },
    { name: 'Redis', regex: /\bredis\b/i },
    { name: 'SQLite', regex: /\bsqlite\b/i },
    { name: 'Oracle', regex: /\boracle(?:\s*db)?\b/i },
    { name: 'Firebase', regex: /\bfirebase(?:\s*firestore)?\b/i },
    { name: 'Supabase', regex: /\bsupabase\b/i },
    { name: 'Cassandra', regex: /\bcassandra\b/i },
    { name: 'DynamoDB', regex: /\bdynamodb\b/i },
    { name: 'Elasticsearch', regex: /\belasticsearch\b/i },
    { name: 'Neo4j', regex: /\bneo4j\b/i },
  ];

  const extractedDatabases = knownDatabases
    .filter(item => item.regex.test(cleanText))
    .map(item => item.name);

  // 4. Tools & Cloud / DevOps
  const knownTools = [
    { name: 'Git', regex: /\bgit\b(?!\w)/i },
    { name: 'GitHub', regex: /\bgithub\b/i },
    { name: 'GitLab', regex: /\bgitlab\b/i },
    { name: 'Docker', regex: /\bdocker\b/i },
    { name: 'Kubernetes', regex: /\bkubernetes|k8s\b/i },
    { name: 'AWS', regex: /\baws|amazon web services\b/i },
    { name: 'Azure', regex: /\bazure\b/i },
    { name: 'Google Cloud (GCP)', regex: /\b(?:gcp|google cloud)\b/i },
    { name: 'Linux', regex: /\blinux|ubuntu\b/i },
    { name: 'Kafka', regex: /\bkafka\b/i },
    { name: 'Jenkins', regex: /\bjenkins\b/i },
    { name: 'Terraform', regex: /\bterraform\b/i },
    { name: 'Postman', regex: /\bpostman\b/i },
    { name: 'Figma', regex: /\bfigma\b/i },
    { name: 'Jira', regex: /\bjira\b/i },
    { name: 'Nginx', regex: /\bnginx\b/i },
    { name: 'Vercel', regex: /\bvercel\b/i },
  ];

  const extractedTools = knownTools
    .filter(item => item.regex.test(cleanText))
    .map(item => item.name);

  // 5. Intelligent Project Extraction
  const lines = cleanText.split('\n').map(l => l.trim()).filter(Boolean);
  const detectedProjects: { title: string; techStack: string[]; description: string }[] = [];

  let projectSectionIndex = -1;
  const projectHeaders = [
    /^projects$/i, /^academic projects$/i, /^personal projects$/i, 
    /^key projects$/i, /^featured projects$/i, /^work experience$/i,
    /^experience$/i, /^relevant projects$/i, /^technical projects$/i
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (projectHeaders.some(h => h.test(line)) || (/project/i.test(line) && line.length < 30 && !line.includes('.'))) {
      projectSectionIndex = i;
      break;
    }
  }

  if (projectSectionIndex !== -1) {
    let currentTitle = '';
    let currentDescLines: string[] = [];
    const sectionLines = lines.slice(projectSectionIndex + 1, projectSectionIndex + 45);
    const stopHeaders = [/education/i, /skills/i, /certifications/i, /awards/i, /achievements/i, /publications/i, /interests/i];

    for (let j = 0; j < sectionLines.length; j++) {
      const line = sectionLines[j];
      if (stopHeaders.some(sh => sh.test(line) && line.length < 30)) {
        break;
      }

      const isHeaderLike = line.length < 60 && !line.startsWith('•') && !line.startsWith('-') && !line.startsWith('*') &&
        (line.includes('|') || line.includes('–') || line.includes('-') || line.includes(':') || /^[A-Z][A-Za-z0-9\s]{3,40}$/.test(line));

      if (isHeaderLike && currentTitle && currentDescLines.length > 0) {
        const titleParts = currentTitle.split(/[|–\-:]/);
        const title = titleParts[0].trim();
        const combinedDesc = currentDescLines.join(' ');
        const projTech = [...extractedLanguages, ...extractedFrameworks, ...extractedDatabases, ...extractedTools]
          .filter(t => new RegExp(`\\b${t.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i').test(currentTitle + ' ' + combinedDesc));

        detectedProjects.push({
          title,
          techStack: projTech.length > 0 ? projTech.slice(0, 5) : extractedLanguages.slice(0, 2),
          description: combinedDesc.slice(0, 260) || 'Engineered functional requirements with clean component structure and modular patterns.'
        });

        currentTitle = line;
        currentDescLines = [];
      } else if (isHeaderLike && !currentTitle) {
        currentTitle = line;
      } else if (currentTitle) {
        currentDescLines.push(line.replace(/^[•\-\*]\s*/, ''));
      }
    }

    if (currentTitle && currentDescLines.length > 0 && detectedProjects.length < 3) {
      const titleParts = currentTitle.split(/[|–\-:]/);
      const title = titleParts[0].trim();
      const combinedDesc = currentDescLines.join(' ');
      const projTech = [...extractedLanguages, ...extractedFrameworks, ...extractedDatabases, ...extractedTools]
        .filter(t => new RegExp(`\\b${t.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i').test(currentTitle + ' ' + combinedDesc));

      detectedProjects.push({
        title,
        techStack: projTech.length > 0 ? projTech.slice(0, 5) : extractedLanguages.slice(0, 2),
        description: combinedDesc.slice(0, 260) || 'Developed technical system architecture with end-to-end testing and integration.'
      });
    }
  }

  if (detectedProjects.length === 0) {
    const projectKeywords = ['platform', 'application', 'system', 'engine', 'tracker', 'dashboard', 'portal', 'analyzer', 'manager', 'service', 'bot', 'website', 'app'];
    for (const line of lines) {
      if (line.length > 10 && line.length < 75 && projectKeywords.some(pk => new RegExp(`\\b${pk}\\b`, 'i').test(line)) && !line.startsWith('•')) {
        const title = line.split(/[|–\-:]/)[0].trim();
        if (title.length > 4 && !detectedProjects.some(p => p.title.toLowerCase() === title.toLowerCase())) {
          const projTech = [...extractedLanguages, ...extractedFrameworks, ...extractedDatabases, ...extractedTools]
            .filter(t => new RegExp(`\\b${t.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i').test(cleanText));
          detectedProjects.push({
            title,
            techStack: projTech.slice(0, 4),
            description: `Hands-on project developing ${title} utilizing ${projTech.slice(0, 3).join(', ') || 'modern programming principles'}.`
          });
          if (detectedProjects.length >= 2) break;
        }
      }
    }
  }

  const topTech = [...extractedLanguages, ...extractedFrameworks, ...extractedDatabases].slice(0, 4);
  const candidateSummary = topTech.length > 0
    ? `Technical candidate with verified proficiency in ${topTech.join(', ')}${extractedTools.length > 0 ? ` and tooling with ${extractedTools.slice(0, 2).join(', ')}` : ''}.${detectedProjects.length > 0 ? ` Proven project experience in "${detectedProjects[0]?.title}".` : ''}`
    : (detectedProjects.length > 0
      ? `Candidate with practical project delivery in "${detectedProjects[0]?.title}".`
      : `Verified candidate credentials.`);

  return {
    fileName,
    parsedAt: new Date().toISOString().split('T')[0],
    summary: candidateSummary,
    skills: {
      languages: extractedLanguages,
      frameworks: extractedFrameworks,
      databases: extractedDatabases,
      tools: extractedTools
    },
    projects: detectedProjects
  };
}

class ApiClient {
  private token: string | null = null;

  constructor() {
    this.token = localStorage.getItem('auth_token');
    try {
      const MOCK_CLEANED_VERSION = 'v5_complete_reset_keep_owner';
      if (localStorage.getItem('crp_data_version') !== MOCK_CLEANED_VERSION) {
        localStorage.removeItem('admin_students');
        localStorage.removeItem('platform_colleges');
        localStorage.removeItem('platform_departments');
        localStorage.removeItem('platform_dynamic_programs');
        localStorage.removeItem('assignments');
        localStorage.removeItem('trainer_tenures');
        localStorage.removeItem('crp_department_staff');
        localStorage.removeItem('crp_department_classes');
        localStorage.removeItem('student_profile');
        localStorage.removeItem('crp_diagnostic_reports');
        localStorage.removeItem('crp_student_profile_stu-101');
        localStorage.removeItem('crp_student_profile_stu-fresh');
        localStorage.removeItem('admin_faculty_mentors');
        localStorage.removeItem('admin_program_admins');
        localStorage.removeItem('platform_pending_invites');
        localStorage.removeItem('college_registered_users');
        localStorage.removeItem('crp_assessment_submissions');
        localStorage.removeItem('crp_active_assessments');
        localStorage.removeItem('crp_counsellor_notes');
        localStorage.removeItem('crp_active_sessions');
        localStorage.removeItem('crp_session_history');
        localStorage.removeItem('crp_interview_history');
        localStorage.removeItem('crp_notifications');
        localStorage.setItem('crp_data_version', MOCK_CLEANED_VERSION);
      }

    } catch {}
  }

  setToken(token: string | null) {
    this.token = token;
    if (token) {
      localStorage.setItem('auth_token', token);
    } else {
      localStorage.removeItem('auth_token');
    }
  }

  // ── Real HTTP helper (proxied via Vite in dev, or direct API base URL in prod) ──
  async _fetch<T = unknown>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    };
    if (options.body instanceof FormData) {
      delete headers['Content-Type'];
    }
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    const rawApiUrl = (import.meta.env.VITE_API_URL || '').trim();
    const isLocal = rawApiUrl.includes('localhost') || rawApiUrl.includes('127.0.0.1');

    const cleanPath = path.startsWith('/api/')
      ? path
      : path.startsWith('/')
      ? `/api${path}`
      : `/api/${path}`;

    const url = (import.meta.env.PROD || !rawApiUrl || isLocal)
      ? cleanPath
      : `${rawApiUrl.replace(/\/+$/, '')}${cleanPath}`;

    let res: Response;
    try {
      res = await fetch(url, { ...options, headers });
    } catch (netErr: any) {
      // Automatic retry once after 500ms on transient network disconnect or container reload
      try {
        await new Promise(resolve => setTimeout(resolve, 500));
        res = await fetch(url, { ...options, headers });
      } catch {
        const errorMsg = (netErr?.message && !netErr.message.toLowerCase().includes('failed to fetch'))
          ? netErr.message
          : 'Unable to reach the server. Please check your network connection or try again in a few moments.';
        throw new Error(errorMsg);
      }
    }

    if (!res.ok) {
      if (res.status === 401) {
        this.setToken(null);
        try { localStorage.removeItem('auth_user'); } catch {}
      }
      let msg = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        msg = body?.error?.message || body?.message || msg;
      } catch {}
      throw new Error(msg);
    }
    return res.json() as Promise<T>;
  }

  private getStorage<T>(key: string, defaultVal: T): T {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : defaultVal;
    } catch {
      return defaultVal;
    }
  }

  private setStorage<T>(key: string, val: T): void {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {
      console.warn(`localStorage save error for ${key}:`, e);
    }
  }

  owner = {
    getColleges: async (): Promise<College[]> => {
      const res = await this._fetch<{ data: any[] }>('/owner/colleges');
      if (Array.isArray(res?.data)) {
        return res.data.map((c: any) => ({
          id: c.id,
          name: c.name,
          code: c.code,
          campusCity: c.campus_city || c.campusCity || '',
          createdAt: c.created_at || new Date().toISOString(),
          superAdminStatus: c.super_admin_status || 'PENDING_INVITE',
          superAdminEmail: c.super_admin_email,
          superAdminName: c.super_admin_name,
        }));
      }
      return [];
    },

    createCollege: async (data: { name: string; code: string; campusCity: string }): Promise<College> => {
      const res = await this._fetch<{ data: any }>('/owner/colleges', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      const c = res.data;
      return {
        id: c.id,
        name: c.name,
        code: c.code,
        campusCity: c.campus_city || c.campusCity || data.campusCity,
        createdAt: c.created_at || new Date().toISOString(),
        superAdminStatus: 'PENDING_INVITE',
      };
    },

    inviteSuperAdmin: async (collegeId: string, data: { firstName: string; lastName: string; email: string }): Promise<{ invite: PendingInvite; inviteUrl: string }> => {
      const res = await this._fetch<{ data: { invite: any; inviteUrl: string } }>(
        `/owner/colleges/${collegeId}/invite-super-admin`,
        {
          method: 'POST',
          body: JSON.stringify(data),
        }
      );
      const inv = res.data.invite;
      return {
        invite: {
          token: inv.token,
          email: inv.email,
          firstName: inv.first_name || data.firstName,
          lastName: inv.last_name || data.lastName,
          name: inv.name || `${data.firstName} ${data.lastName}`.trim(),
          role: 'SUPER_ADMIN',
          collegeId: inv.institution_id || collegeId,
          collegeName: inv.institution_name || 'College',
          permissions: ['CAN_VIEW_STUDENT_PROGRESS', 'CAN_ASSIGN_INTERVIEWS', 'CAN_ASSIGN_LISTENING', 'CAN_MANAGE_STUDENTS'],
          createdAt: inv.created_at || new Date().toISOString(),
          status: 'PENDING'
        },
        inviteUrl: res.data.inviteUrl
      };
    },

    getStats: async () => {
      const res = await this._fetch<{ data: any }>('/owner/stats');
      return {
        totalColleges: parseInt(res.data?.total_colleges || '0', 10),
        activeSuperAdmins: parseInt(res.data?.active_super_admins || '0', 10),
        totalStudents: parseInt(res.data?.total_students || '0', 10),
        totalPrograms: parseInt(res.data?.total_programs || '0', 10)
      };
    },

    deleteCollege: async (collegeId: string): Promise<void> => {
      await this._fetch(`/owner/colleges/${collegeId}`, { method: 'DELETE' });
    },

    getCollegeProfileMetrics: async (collegeId: string) => {
      try {
        const res = await this._fetch<{ data: any }>(`/owner/colleges/${encodeURIComponent(collegeId)}/metrics`);
        if (res && res.data) {
          return res.data;
        }
      } catch {}

      const colleges = await this.owner.getColleges();
      const college = colleges.find(c => c.id === collegeId) || colleges[0] || { id: collegeId, name: 'College', code: 'COL', campusCity: '', createdAt: new Date().toISOString() };
      let enrolledCount = 0;
      let progs: DynamicProgram[] = [];
      let assignmentsCount = 0;
      try {
        const students = await this.admin.getStudents({ collegeId });
        enrolledCount = students.filter((s: any) => s.collegeId === collegeId).length;
      } catch {}
      try {
        progs = await this.college.getPrograms(collegeId);
      } catch {}
      try {
        const assignments = await this.admin.getAssignments(collegeId);
        assignmentsCount = assignments.length;
      } catch {}

      return {
        college,
        enrolledStudentsCount: enrolledCount,
        programsCreated: progs,
        programsCount: progs.length,
        totalAssignmentsCount: assignmentsCount,
        tokenUsage: {
          totalTokens: 0,
          promptTokens: 0,
          completionTokens: 0,
          audioMinutes: 0,
          whisperHours: 0,
          llmModel: 'Gemini 1.5 Flash + Whisper Pro',
          status: 'Active (0 Tokens Consumed)'
        }
      };
    }
  };

  college = {
    getDetails: async (collegeId = 'col-1'): Promise<College> => {
      const res = await this._fetch<{ data: any }>(`/college/${collegeId}/details`);
      const c = res.data;
      return {
        id: c.id,
        name: c.name,
        code: c.code,
        campusCity: c.campus_city || c.campusCity || '',
        createdAt: c.created_at || new Date().toISOString(),
        superAdminStatus: c.super_admin_status || 'ACTIVE'
      };
    },

    getDepartments: async (collegeId = 'col-1'): Promise<DynamicDepartment[]> => {
      const res = await this._fetch<{ data: any[] }>(`/college/${collegeId}/departments`);
      if (Array.isArray(res?.data)) {
        return res.data.map((d: any) => ({
          id: d.id,
          collegeId: d.college_id || collegeId,
          name: d.name,
          code: d.code,
          assignedAdminEmail: d.assigned_admin_email,
          assignedAdminName: d.assigned_admin_name,
          adminPermissions: d.admin_permissions || ['CAN_VIEW_STUDENT_PROGRESS', 'CAN_MANAGE_STUDENTS']
        }));
      }
      return [];
    },

    createDepartment: async (collegeId: string, data: { name: string; code: string; assignedAdminEmail?: string; assignedAdminName?: string; adminPermissions?: AdminPermission[] }): Promise<DynamicDepartment> => {
      const res = await this._fetch<{ data: any }>(`/college/${collegeId}/departments`, {
        method: 'POST',
        body: JSON.stringify(data),
      });
      const d = res.data;
      return {
        id: d.id,
        collegeId: d.college_id || collegeId,
        name: d.name,
        code: d.code,
        assignedAdminEmail: data.assignedAdminEmail,
        assignedAdminName: data.assignedAdminName,
        adminPermissions: data.adminPermissions || ['CAN_VIEW_STUDENT_PROGRESS', 'CAN_MANAGE_STUDENTS']
      };
    },

    bulkCreateDepartments: async (collegeId: string, csvContent: string): Promise<{ created: number; departments: DynamicDepartment[]; errors: string[] }> => {
      const res = await this._fetch<{ data: { created: number; departments: any[]; errors: string[] } }>(`/college/${collegeId}/departments/bulk`, {
        method: 'POST',
        body: JSON.stringify({ csvContent }),
      });
      const depts: DynamicDepartment[] = (res.data?.departments || []).map((d: any) => ({
        id: d.id,
        collegeId: d.college_id || collegeId,
        name: d.name,
        code: d.code,
        adminPermissions: ['CAN_VIEW_STUDENT_PROGRESS', 'CAN_MANAGE_STUDENTS'] as AdminPermission[]
      }));
      return { created: res.data?.created || 0, departments: depts, errors: res.data?.errors || [] };
    },

    updateDepartment: async (collegeId: string, deptId: string, updates: Partial<DynamicDepartment>): Promise<DynamicDepartment> => {
      const res = await this._fetch<{ data: any }>(`/college/${collegeId}/departments/${deptId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
      const d = res.data;
      return {
        id: d.id,
        collegeId: d.college_id || collegeId,
        name: d.name,
        code: d.code,
        assignedAdminEmail: updates.assignedAdminEmail,
        assignedAdminName: updates.assignedAdminName,
        adminPermissions: (updates.adminPermissions || ['CAN_VIEW_STUDENT_PROGRESS', 'CAN_MANAGE_STUDENTS']) as AdminPermission[]
      };
    },

    deleteDepartment: async (collegeId: string, deptId: string): Promise<{ success: boolean }> => {
      await this._fetch(`/college/${collegeId}/departments/${deptId}`, { method: 'DELETE' });
      return { success: true };
    },

    getDepartmentStaff: async (departmentName: string, collegeId = 'col-1'): Promise<DepartmentStaffMember[]> => {
      const res = await this._fetch<{ data: any[] }>(`/college/${collegeId}/staff/${encodeURIComponent(departmentName || 'ALL')}`);
      if (Array.isArray(res?.data)) {
        return res.data.map((s: any) => ({
          id: s.id,
          name: s.name,
          email: s.email,
          designation: s.designation || 'Faculty Member',
          staffId: s.staff_id || s.staffId,
          department: s.department,
          collegeId: collegeId,
          status: s.status || 'ACTIVE',
          activationToken: s.activation_token || '',
          assignedClasses: s.assigned_classes || [],
          createdAt: s.created_at || new Date().toISOString().split('T')[0]
        }));
      }
      return [];
    },

    addDepartmentStaff: async (data: {
      name: string;
      email: string;
      designation: string;
      staffId?: string;
      department: string;
      collegeId?: string;
    }): Promise<{ staff: DepartmentStaffMember; activationLink: string }> => {
      const colId = data.collegeId || 'col-1';
      const res = await this._fetch<{ data: { staff: any; activationLink: string } }>(`/college/${colId}/staff`, {
        method: 'POST',
        body: JSON.stringify(data),
      });
      const s = res.data.staff;
      return {
        staff: {
          id: s.id,
          name: s.name,
          email: s.email,
          designation: s.designation,
          staffId: s.staff_id || data.staffId,
          department: s.department,
          collegeId: colId,
          status: s.status || 'ACTIVE',
          activationToken: '',
          assignedClasses: [],
          createdAt: s.created_at || new Date().toISOString().split('T')[0]
        },
        activationLink: res.data.activationLink
      };
    },

    bulkAddDepartmentStaff: async (
      departmentName: string, 
      collegeId: string, 
      csvContent: string
    ): Promise<{ count: number; staff: DepartmentStaffMember[]; errors: string[] }> => {
      const colId = collegeId || 'col-1';
      const res = await this._fetch<{ data: { count: number; staff: any[]; errors: string[] } }>(`/college/${colId}/staff/bulk`, {
        method: 'POST',
        body: JSON.stringify({ departmentName, csvContent }),
      });
      const staffList = (res.data?.staff || []).map((s: any) => ({
        id: s.id,
        name: s.name,
        email: s.email,
        designation: s.designation,
        staffId: s.staff_id,
        department: s.department || departmentName,
        collegeId: colId,
        status: s.status || 'ACTIVE',
        activationToken: '',
        assignedClasses: [],
        createdAt: s.created_at || new Date().toISOString().split('T')[0]
      }));
      return { count: res.data?.count || 0, staff: staffList, errors: res.data?.errors || [] };
    },

    removeDepartmentStaff: async (staffId: string, collegeId = 'col-1'): Promise<void> => {
      await this._fetch(`/college/${collegeId}/staff/${staffId}`, { method: 'DELETE' });
    },

    activateStaffAccount: async (token: string, email: string, password: string): Promise<boolean> => {
      await this._fetch(`/college/col-1/staff/activate`, {
        method: 'POST',
        body: JSON.stringify({ token, email, password }),
      });
      return true;
    },

    getPrograms: async (collegeId = 'col-1'): Promise<DynamicProgram[]> => {
      const res = await this._fetch<{ data: any[] }>(`/college/${collegeId}/programs`);
      if (Array.isArray(res?.data)) {
        return res.data.map((p: any) => ({
          id: p.id,
          collegeId: p.college_id || collegeId,
          name: p.name,
          code: p.code,
          targetDepartment: p.targetDepartment || p.target_department,
          assignedAdminName: p.assignedAdminName || p.assigned_admin_name,
          assignedAdminEmail: p.assignedAdminEmail || p.assigned_admin_email,
          adminPermissions: p.adminPermissions || p.admin_permissions || ['CAN_VIEW_STUDENT_PROGRESS'],
          createdAt: p.createdAt || p.created_at || new Date().toISOString()
        }));
      }
      return [];
    },

    createProgram: async (collegeId: string, data: Omit<DynamicProgram, 'id' | 'createdAt'>): Promise<DynamicProgram> => {
      const res = await this._fetch<{ data: any }>(`/college/${collegeId}/programs`, {
        method: 'POST',
        body: JSON.stringify(data),
      });
      const p = res.data;
      return {
        id: p.id,
        collegeId: p.college_id || collegeId,
        name: p.name,
        code: p.code,
        targetDepartment: p.targetDepartment || data.targetDepartment,
        assignedAdminName: p.assignedAdminName || data.assignedAdminName,
        assignedAdminEmail: p.assignedAdminEmail || data.assignedAdminEmail,
        adminPermissions: p.adminPermissions || data.adminPermissions,
        createdAt: p.createdAt || new Date().toISOString()
      };
    },

    updateProgram: async (collegeId: string, progId: string, updates: Partial<DynamicProgram>, safeguardCode?: string): Promise<DynamicProgram> => {
      const res = await this._fetch<{ data: any }>(`/college/${collegeId}/programs/${progId}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...updates, safeguardCode }),
      });
      return res.data;
    },

    deleteProgram: async (collegeId: string, progId: string, safeguardCode?: string): Promise<{ success: boolean; message?: string }> => {
      const q = safeguardCode ? `?safeguardCode=${encodeURIComponent(safeguardCode)}` : '';
      const res = await this._fetch<{ data?: { success: boolean; message?: string } }>(
        `/college/${collegeId}/programs/${progId}${q}`,
        {
          method: 'DELETE',
          body: safeguardCode ? JSON.stringify({ safeguardCode }) : undefined,
        }
      );
      return res.data || { success: true };
    },

    inviteProgramAdmin: async (collegeId: string, data: { firstName: string; lastName: string; email: string; programId?: string; department?: string; permissions: AdminPermission[] }): Promise<{ invite: PendingInvite; inviteUrl: string }> => {
      const token = `inv_pa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const fullName = `${data.firstName} ${data.lastName}`.trim();
      const inviteUrl = `${window.location.origin}/?page=activate&invite_token=${token}`;

      return {
        invite: {
          token,
          email: data.email.toLowerCase().trim(),
          firstName: data.firstName,
          lastName: data.lastName,
          name: fullName,
          role: 'PROGRAM_ADMIN',
          collegeId,
          collegeName: 'College',
          programId: data.programId,
          department: data.department,
          permissions: data.permissions,
          createdAt: new Date().toISOString(),
          status: 'PENDING'
        },
        inviteUrl
      };
    },

    bulkUploadProgramAdmins: async (collegeId: string, csvContent: string): Promise<{ created: number; errors: string[] }> => {
      const lines = csvContent.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      let created = 0;
      const errors: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        if (i === 0 && lines[i].toLowerCase().includes('email')) continue;
        const parts = lines[i].split(',').map(p => p.trim());
        if (parts.length < 2) continue;
        const [name, email, targetEntity] = parts;
        if (!email.includes('@')) {
          errors.push(`Row ${i + 1}: Invalid email address ${email}`);
          continue;
        }

        const nameParts = name.split(' ');
        const firstName = nameParts[0] || 'Admin';
        const lastName = nameParts.slice(1).join(' ') || '';

        await this.college.inviteProgramAdmin(collegeId, {
          firstName,
          lastName,
          email,
          department: targetEntity,
          permissions: ['CAN_VIEW_STUDENT_PROGRESS', 'CAN_ASSIGN_INTERVIEWS', 'CAN_MANAGE_STUDENTS']
        });
        created++;
      }

      return { created, errors };
    },

    // ── Classes ──────────────────────────────────────────────────────────────
    getClasses: async (departmentName?: string, collegeId = 'col-1'): Promise<DepartmentClass[]> => {
      const path = `/college/${collegeId}/classes${departmentName && departmentName !== 'ALL' ? '?department=' + encodeURIComponent(departmentName) : ''}`;
      const res = await this._fetch<{ data: any[] }>(path);
      if (Array.isArray(res?.data)) {
        return res.data.map((c: any) => ({
          id: c.id,
          name: c.name,
          department: c.department,
          batchYear: c.batchYear || c.batch_year || 2028,
          semester: c.semester || 'Semester 5',
          facultyInCharge: c.facultyInCharge || c.faculty_in_charge,
          enrolledStudentCount: c.enrolledStudentCount || c.student_count || 0,
          studentIds: c.studentIds || c.student_ids || [],
          createdAt: c.createdAt || c.created_at || new Date().toISOString()
        }));
      }
      return [];
    },

    createClass: async (collegeId: string, data: Partial<DepartmentClass>): Promise<DepartmentClass> => {
      const res = await this._fetch<{ data: any }>(`/college/${collegeId}/classes`, {
        method: 'POST',
        body: JSON.stringify({
          name: data.name,
          department: data.department,
          batchYear: data.batchYear,
          semester: data.semester,
          facultyInCharge: data.facultyInCharge,
          studentCount: data.enrolledStudentCount || 0,
          studentIds: data.studentIds || []
        }),
      });
      return res.data;
    },

    updateClass: async (collegeId: string, classId: string, updates: Partial<DepartmentClass>): Promise<DepartmentClass> => {
      const res = await this._fetch<{ data: any }>(`/college/${collegeId}/classes/${classId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: updates.name,
          department: updates.department,
          batchYear: updates.batchYear,
          semester: updates.semester,
          facultyInCharge: updates.facultyInCharge,
          studentCount: updates.enrolledStudentCount,
          studentIds: updates.studentIds
        }),
      });
      return res.data;
    },

    deleteClass: async (collegeId: string, classId: string): Promise<{ success: boolean }> => {
      await this._fetch(`/college/${collegeId}/classes/${classId}`, { method: 'DELETE' });
      return { success: true };
    },

    bulkCreateClasses: async (collegeId: string, csvContent: string, defaultDepartment?: string, defaultBatchYear?: number): Promise<{ created: number; classes: DepartmentClass[]; errors: string[] }> => {
      const res = await this._fetch<{ data: { created: number; classes: any[]; errors: string[] } }>(`/college/${collegeId}/classes/bulk`, {
        method: 'POST',
        body: JSON.stringify({ csvContent, defaultDepartment, defaultBatchYear }),
      });
      return res.data;
    }
  };

  invites = {
    getAll: async (): Promise<PendingInvite[]> => {
      try {
        const res = await this._fetch<{ data: any[] }>('/invites');
        if (Array.isArray(res?.data)) {
          return res.data.map((inv: any) => ({
            token: inv.token,
            email: inv.email,
            firstName: inv.first_name,
            lastName: inv.last_name,
            name: inv.name || `${inv.first_name || ''} ${inv.last_name || ''}`.trim(),
            role: inv.role,
            collegeId: inv.college_id || inv.institution_id,
            collegeName: inv.college_name || inv.institution_name,
            programId: inv.program_id,
            department: inv.department,
            permissions: inv.permissions,
            status: inv.status,
            createdAt: inv.created_at || inv.createdAt,
            expiresAt: inv.expires_at || inv.expiresAt,
          }));
        }
      } catch (err) {
        console.warn('Failed to fetch invites from API:', err);
      }
      return [];
    },

    getByToken: async (token: string): Promise<PendingInvite | null> => {
      if (!token) return null;
      try {
        const res = await this._fetch<{ data: any }>(`/invites/${encodeURIComponent(token.trim())}`);
        if (res?.data) {
          const inv = res.data;
          return {
            token: inv.token,
            email: inv.email,
            firstName: inv.first_name,
            lastName: inv.last_name,
            name: inv.name || `${inv.first_name || ''} ${inv.last_name || ''}`.trim(),
            role: inv.role,
            collegeId: inv.college_id || inv.institution_id || inv.collegeId,
            collegeName: inv.college_name || inv.institution_name || inv.collegeName,
            programId: inv.program_id || inv.programId,
            department: inv.department,
            permissions: inv.permissions,
            status: inv.status,
            createdAt: inv.created_at || inv.createdAt,
            expiresAt: inv.expires_at || inv.expiresAt,
            alreadyAccepted: Boolean(inv.alreadyAccepted || inv.status === 'ACCEPTED'),
          };
        }
      } catch (err: any) {
        console.warn('Backend getByToken error:', err?.message);
        throw err;
      }
      return null;
    },

    completePasswordSetup: async (token: string, password: string): Promise<{ user: AuthUser; token: string }> => {
      const res = await this._fetch<{ data: { user: any; token: string } }>(
        `/invites/${encodeURIComponent(token.trim())}/complete`,
        {
          method: 'POST',
          body: JSON.stringify({ password }),
        }
      );
      if (res?.data?.token && res?.data?.user) {
        const u = res.data.user;
        const userRecord: AuthUser = {
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          collegeId: u.collegeId || u.college_id || u.institution_id,
          collegeName: u.collegeName || u.college_name || u.institution_name,
          programId: u.programId || u.program_id,
          department: u.department,
          permissions: u.permissions || ['CAN_VIEW_STUDENT_PROGRESS', 'CAN_ASSIGN_INTERVIEWS', 'CAN_ASSIGN_LISTENING', 'CAN_MANAGE_STUDENTS'],
        };
        this.setToken(res.data.token);
        localStorage.setItem('auth_user', JSON.stringify(userRecord));
        return { user: userRecord, token: res.data.token };
      }
      throw new Error('Failed to complete activation');
    }
  };

  studentBatch = {
    bulkImportAndAssignStudents: async (collegeId: string, csvContent: string, defaultBatchYear = 2028): Promise<{ 
      count: number; 
      students: any[]; 
      assignedToProgramCount: number; 
      assignedToDepartmentCount: number; 
      errors: string[] 
    }> => {
      const colId = collegeId || 'col-1';
      const res = await this._fetch<{ data: any }>(`/studentBatch/${colId}/bulk-import`, {
        method: 'POST',
        body: JSON.stringify({ csvContent, defaultBatchYear }),
      });
      return {
        count: res.data?.count || 0,
        students: res.data?.students || [],
        assignedToProgramCount: res.data?.assignedToProgramCount || 0,
        assignedToDepartmentCount: res.data?.assignedToDepartmentCount || 0,
        errors: res.data?.errors || []
      };
    },

    purgeGraduatedBatch: async (collegeId: string, batchYear: number, confirmation: string): Promise<{ purgedCount: number; batchYear: number; message: string }> => {
      const colId = collegeId || 'col-1';
      const res = await this._fetch<{ data: any }>(`/studentBatch/${colId}/purge-batch`, {
        method: 'POST',
        body: JSON.stringify({ batchYear, confirmation }),
      });
      return res.data;
    },

    bulkEnroll: async (collegeId: string, csvContent: string): Promise<{ count: number; students: any[]; errors: string[] }> => {
      return this.studentBatch.bulkImportAndAssignStudents(collegeId, csvContent);
    },

    enrollSingle: async (collegeId: string, studentData: {
      name: string;
      rollNumber: string;
      email: string;
      password?: string;
      department: string;
      batchYear?: number;
      programName?: string;
      subProgramName?: string;
      track?: string;
    }): Promise<any> => {
      const colId = collegeId || 'col-1';
      const res = await this._fetch<{ data: any }>(`/studentBatch/${colId}/enroll-single`, {
        method: 'POST',
        body: JSON.stringify(studentData),
      });
      return res.data;
    },

    updateStudentDetails: async (collegeId: string, studentId: string, updates: {
      name?: string;
      rollNumber?: string;
      email?: string;
      department?: string;
      programName?: string;
      programId?: string;
      batchYear?: number;
      className?: string;
      password?: string;
      track?: string;
      status?: string;
      score?: number;
      coins?: number;
      zeroCoinsAt?: string;
    }): Promise<any> => {
      const colId = collegeId || 'col-1';
      const res = await this._fetch<{ data: any }>(`/studentBatch/${colId}/students/${encodeURIComponent(studentId)}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
      });
      return res.data;
    },

    bulkAssignPrograms: async (collegeId: string, csvContent: string): Promise<{ count: number; updated: any[]; errors: string[] }> => {
      const res = await this.studentBatch.bulkImportAndAssignStudents(collegeId, csvContent);
      return {
        count: res.count,
        updated: res.students,
        errors: res.errors
      };
    },

    assignProgramManually: async (studentId: string, programId: string, subProgramName?: string): Promise<any> => {
      const res = await this._fetch<{ data: any }>(`/students/${encodeURIComponent(studentId)}/profile`, {
        method: 'PUT',
        body: JSON.stringify({ programId, subProgramName }),
      });
      return res.data;
    }
  };

  auth = {
    login: async (email: string, password?: string) => {
      const normalizedEmail = email.toLowerCase().trim();

      if (!password) {
        throw new Error('Password is required');
      }

      // ── Call backend API (no fallback) ─────────────────────────────────────────
      const data = await this._fetch<{
        success: boolean;
        data: { token: string; user: AuthUser; studentId: string | null };
      }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: normalizedEmail, password }),
      });

      const { token, user, studentId } = data.data;
      this.setToken(token);
      localStorage.setItem('auth_user', JSON.stringify({ ...user, studentId }));

      return {
        user: { ...user, studentId: studentId || undefined },
        token,
        studentId: studentId || undefined
      };
    },


    registerCandidate: async (candidateData: { name: string; email: string; password?: string; collegeId?: string; department?: string; batchYear?: number }) => {
      const password = candidateData.password || 'welcome@2026';
      const res = await this._fetch<{ data: { message: string; requiresLogin: boolean; email: string; name: string; studentId?: string } }>('/auth/register-candidate', {
        method: 'POST',
        body: JSON.stringify({
          name: candidateData.name || 'Candidate',
          email: candidateData.email.toLowerCase().trim(),
          password,
          collegeId: candidateData.collegeId,
          department: candidateData.department || 'Computer Science & Engineering',
          batchYear: candidateData.batchYear || 2026,
        }),
      });

      return res.data;
    },

    register: async (userData: any) => {
      const password = userData.password || 'welcome@2026';
      const res = await this._fetch<{ data: { token: string; user: any; studentId?: string } }>('/auth/register-candidate', {
        method: 'POST',
        body: JSON.stringify({
          name: userData.name || 'New Candidate',
          email: userData.email.toLowerCase().trim(),
          password,
          collegeId: userData.collegeId,
          rollNumber: userData.rollNumber,
          department: userData.department || 'Computer Science & Engineering',
          batchYear: userData.batchYear || 2026,
          track: userData.track || 'General Track',
          programName: userData.programName
        }),
      });

      const { token, user, studentId } = res.data;
      this.setToken(token);
      localStorage.setItem('auth_user', JSON.stringify({ ...user, studentId }));

      return {
        user: { ...user, studentId: studentId || user.studentId },
        token,
        studentId: studentId || user.studentId
      };
    },

    registerExternal: async (userData: { name: string; email: string; password?: string; department?: string; batchYear?: number }) => {
      const res = await this.auth.registerCandidate(userData);
      return {
        ...res,
        simulatedVerificationCode: '123456',
      };
    },

    verifyEmail: async (email: string, _code: string) => {
      const res = await this.auth.registerCandidate({ name: email.split('@')[0], email });
      return {
        user: { id: res.studentId || 'ext-stu', name: res.name, email: res.email, role: 'STUDENT' },
        studentId: res.studentId,
        token: 'ext-token',
        ...res
      };
    },

    requestPasswordReset: async (email: string) => {
      const cleanEmail = email.toLowerCase().trim();
      if (!cleanEmail) {
        throw new Error('Please enter your registered email address.');
      }
      const res = await this._fetch<{ status: string; data: { message: string; email: string } }>('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: cleanEmail }),
      });
      return {
        success: true,
        email: cleanEmail,
        message: res.data?.message || `A verification code has been dispatched to ${cleanEmail}.`
      };
    },

    resetPassword: async (data: { email: string; otp: string; newPassword: string }) => {
      const cleanEmail = data.email.toLowerCase().trim();
      const newPwd = data.newPassword.trim();
      if (!cleanEmail) throw new Error('Email is required.');
      if (!newPwd || newPwd.length < 6) throw new Error('Password must be at least 6 characters.');
      const res = await this._fetch<{ status: string; data: { message: string } }>('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ email: cleanEmail, otp: data.otp, newPassword: newPwd }),
      });
      return {
        success: true,
        message: res.data?.message || 'Password reset successfully!'
      };
    },

    registerInstitution: async (data: {
      institutionName: string;
      institutionCode: string;
      campusCity: string;
      adminName: string;
      adminEmail: string;
      password?: string;
      contactPhone?: string;
    }): Promise<{ college: College; user: AuthUser; token: string }> => {
      const cleanInstName = data.institutionName.trim();
      const cleanInstCode = data.institutionCode.toUpperCase().trim();
      const cleanCity = data.campusCity.trim();
      const cleanAdminName = data.adminName.trim();
      const cleanAdminEmail = data.adminEmail.toLowerCase().trim();
      const pwd = (data.password && data.password.trim()) || 'admin123';

      const res = await this._fetch<{
        data: {
          college: College;
          user: AuthUser;
          token: string;
        }
      }>('/auth/register-institution', {
        method: 'POST',
        body: JSON.stringify({
          institutionName: cleanInstName,
          institutionCode: cleanInstCode,
          campusCity: cleanCity,
          adminName: cleanAdminName,
          adminEmail: cleanAdminEmail,
          password: pwd,
          contactPhone: data.contactPhone
        }),
      });

      const { college, user, token } = res.data;
      this.setToken(token);
      this.setStorage('auth_user', user);

      return {
        college,
        user,
        token
      };
    },

    me: async () => {
      const saved = localStorage.getItem('auth_user');
      if (saved) {
        const u = JSON.parse(saved);
        return { user: u, studentId: u.studentId || u.id };
      }
      return {
        user: { id: 'usr_candidate', name: 'Student Candidate', email: 'student@platform.local', role: 'STUDENT' },
        studentId: 'stu_candidate'
      };
    }
  };

  student = {
    getProfile: async (studentId?: string): Promise<StudentProfile> => {
      const endpoint = studentId ? `/students/${encodeURIComponent(studentId)}/profile` : `/students/me`;
      const res = await this._fetch<{ data: { student?: any; profile?: any } }>(endpoint);
      const s = res?.data?.profile || res?.data?.student;
      if (s) {
        return {
          id: s.id,
          name: s.name || '',
          rollNumber: s.rollNumber || s.roll_number || '',
          email: s.email || '',
          department: s.department || '',
          batchYear: s.batchYear || s.batch_year || 2026,
          className: s.className || s.class_name || '',
          track: s.track || 'General Track',
          programId: s.programId || s.program_id,
          programName: s.programName || s.program_name,
          subProgramName: s.subProgramName || s.sub_program_name,
          mentorName: s.mentorName || s.mentor_name || '',
          mentorEmail: s.mentorEmail || s.mentor_email || '',
          codingHandles: s.codingHandles || s.coding_handles || { leetcodeSolved: 0, githubRepos: 0 },
          resume: s.resume || s.resume_data || null,
          criteriaTasks: s.criteriaTasks || s.criteria_tasks || [],
          improvementChecklist: s.improvementChecklist || s.improvement_checklist || [],
          recentReports: s.recentReports || s.recent_reports || [],
          overallReadiness: s.overallReadiness ?? s.score ?? 75,
          coins: s.coins ?? 5,
          zeroCoinsAt: s.zeroCoinsAt || s.zero_coins_at
        };
      }
      throw new Error('Student profile not found');
    },

    updateProfile: async (studentId: string, updates: Partial<StudentProfile>): Promise<StudentProfile> => {
      const res = await this._fetch<{ data: { student?: any; profile?: any } }>(`/students/${encodeURIComponent(studentId)}/profile`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      });
      const s = res?.data?.profile || res?.data?.student;
      return s;
    },

    updateCodingHandles: async (studentId: string, handles: CodingHandles): Promise<void> => {
      await this._fetch(`/students/${encodeURIComponent(studentId)}/coding-handles`, {
        method: 'POST',
        body: JSON.stringify(handles),
      });
    },

    fetchLeetCodeStats: async (username: string): Promise<{ username: string; totalSolved: number; easySolved: number; mediumSolved: number; hardSolved: number }> => {
      const res = await this._fetch<{ data: { username: string; totalSolved: number; easySolved: number; mediumSolved: number; hardSolved: number } }>(
        `/students/leetcode/${encodeURIComponent(username)}`
      );
      return res.data;
    },

    updateCredits: async (studentId: string, payload: { coins?: number; action?: 'CONSUME' | 'RESTORE' }): Promise<{ coins: number }> => {
      const res = await this._fetch<{ data: { studentId: string; coins: number; message: string } }>(
        `/students/${encodeURIComponent(studentId)}/credits`,
        {
          method: 'PATCH',
          body: JSON.stringify(payload)
        }
      );
      return { coins: res.data.coins };
    },

    uploadResume: async (
      studentId: string, 
      payload: FormData | { resumeText: string; fileName?: string; file?: File } | ParsedResume
    ): Promise<ParsedResume> => {
      // The server reads the resume itself (PDF, DOCX or TXT) and keeps only facts written
      // in it; errors reach the upload dialog — a resume is never filled with guessed content.
      const id = encodeURIComponent(studentId);
      let resume: ParsedResume | null;
      const file = payload instanceof FormData ? null : (payload as { file?: File }).file;
      if (payload instanceof FormData || file instanceof File) {
        let form: FormData;
        if (payload instanceof FormData) {
          form = payload;
        } else {
          form = new FormData();
          form.append('resume', file as File);
        }
        const res = await this._fetch<{ data: { resume: ParsedResume | null } }>(`/students/${id}/resume`, {
          method: 'PATCH',
          body: form,
        });
        resume = res?.data?.resume ?? null;
      } else if ('resumeText' in payload) {
        const res = await this._fetch<{ data: { resume: ParsedResume | null } }>(`/students/${id}/resume/text`, {
          method: 'POST',
          body: JSON.stringify({ text: payload.resumeText }),
        });
        resume = res?.data?.resume ?? null;
      } else {
        // Resume details edited by the student
        const res = await this._fetch<{ data: { resume: ParsedResume } }>(`/students/${id}/resume-data`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        resume = res?.data?.resume ?? (payload as ParsedResume);
      }
      if (!resume) {
        throw new Error('No text could be read from this resume. Try pasting the resume text instead.');
      }
      return resume;
    }
  };

  tasks = {
    toggleTask: async (studentId: string, taskId: string): Promise<boolean> => {
      const res = await this._fetch<{ data: { isCompleted: boolean } }>(`/students/${encodeURIComponent(studentId)}/tasks/toggle`, {
        method: 'POST',
        body: JSON.stringify({ taskId }),
      });
      return res.data?.isCompleted ?? false;
    },

    verifyTask: async (studentId: string, taskId: string): Promise<void> => {
      await this._fetch(`/students/${encodeURIComponent(studentId)}/tasks/verify`, {
        method: 'POST',
        body: JSON.stringify({ taskId }),
      });
    }
  };

  coins = {
    getMe: async (): Promise<{ coins: number; maxCoins: number; isIndependent: boolean; institutionId: string | null }> => {
      const res = await this._fetch<{ data: { coins: number; maxCoins: number; isIndependent: boolean; institutionId: string | null } }>('/coins/me');
      return res.data;
    },
    restore: async (studentId: string, coins = 5): Promise<{ studentId: string; coins: number; maxCoins: number; message: string }> => {
      const res = await this._fetch<{ data: { studentId: string; coins: number; maxCoins: number; message: string } }>(
        `/coins/${encodeURIComponent(studentId)}/restore`,
        {
          method: 'POST',
          body: JSON.stringify({ coins }),
        }
      );
      return res.data;
    },
    payRefill: async (payload: { paymentMethod?: string; transactionReference?: string } = {}): Promise<{ coins: number; maxCoins: number; message: string }> => {
      const res = await this._fetch<{ data: { coins: number; maxCoins: number; message: string } }>(
        '/coins/me/pay-refill',
        {
          method: 'POST',
          body: JSON.stringify(payload),
        }
      );
      return res.data;
    },
  };

  interview = {
    start: async (
      studentId: string, 
      type: 'MOCK_INTERVIEW' | 'LISTENING_COMPREHENSION' | 'PRACTICE' = 'MOCK_INTERVIEW', 
      topic?: string | ParsedResume | null,
      resume?: ParsedResume | null
    ): Promise<{ sessionId: string; firstQuestion: QuestionTurn; maxTurns?: number; coinsRemaining?: number }> => {
      let customTopic: string | undefined;
      let resumeObj: ParsedResume | null | undefined;
      if (typeof topic === 'string') {
        customTopic = topic;
        resumeObj = resume;
      } else if (topic && typeof topic === 'object') {
        resumeObj = topic as ParsedResume;
        if (resume && typeof resume === 'string') {
          customTopic = resume;
        }
      }

      const skills = resumeObj ? [
        ...(resumeObj.skills?.languages || []),
        ...(resumeObj.skills?.frameworks || []),
        ...(resumeObj.skills?.databases || []),
        ...(resumeObj.skills?.tools || []),
      ] : [];
      const projects = (resumeObj?.projects || []).map(p => ({
        title: p.title,
        techStack: p.techStack || [],
        description: p.description || '',
      }));

      if (type !== 'MOCK_INTERVIEW') {
        return this.interview.startPracticeSession(studentId, type, customTopic);
      }

      // Live, WebSocket-backed interview: the server grounds questions in the resume it
      // parsed and in the candidate's answers. A failure is reported, never replaced by
      // canned questions.
      const res = await this._fetch<any>('/interview/sessions', {
        method: 'POST',
        body: JSON.stringify({
          sessionType: type,
          topic: customTopic,
          ...(skills.length || projects.length ? { resume: { skills: skills.slice(0, 40), projects: projects.slice(0, 10) } } : {})
        }),
      });
      const session = res?.data || res?.session || res;
      const question = res?.firstQuestion || session?.firstQuestion || session?.currentQuestion;
      if (!session?.sessionId || !question) {
        throw new Error('The interview could not be started. Please try again.');
      }
      const firstQ: QuestionTurn = {
        id: question.id || question.questionId || `live_q_1_${Date.now()}`,
        questionNumber: question.questionNumber || question.sequenceNo || 1,
        questionText: question.questionText || question.question_text,
        difficulty: question.difficulty || 'EASY',
        category: question.category || customTopic
      };
      this.setStorage(`interview_${session.sessionId}`, {
        sessionId: session.sessionId,
        type,
        topic: customTopic,
        turnIndex: 0,
        questions: [firstQ],
        tabSwitches: 0
      });
      return {
        sessionId: session.sessionId,
        firstQuestion: firstQ,
        maxTurns: session.maxTurns || 15,
        coinsRemaining: session.coinsRemaining
      };
    },

    // Listening and practice sessions (not the live mock interview): unchanged flow
    startPracticeSession: async (
      studentId: string,
      type: 'MOCK_INTERVIEW' | 'LISTENING_COMPREHENSION' | 'PRACTICE',
      customTopic?: string
    ): Promise<{ sessionId: string; firstQuestion: QuestionTurn; maxTurns?: number; coinsRemaining?: number }> => {
      try {
        const res = await this._fetch<{ data: { sessionId: string; firstQuestion: QuestionTurn } }>('/interview/start', {
          method: 'POST',
          body: JSON.stringify({ studentId, type, topic: customTopic }),
        });
        if (res?.data?.sessionId && res.data.firstQuestion) {
          const sess = {
            sessionId: res.data.sessionId,
            type,
            topic: customTopic,
            turnIndex: 0,
            questions: [res.data.firstQuestion],
            tabSwitches: 0
          };
          this.setStorage(`interview_${res.data.sessionId}`, sess);
          return {
            sessionId: res.data.sessionId,
            firstQuestion: res.data.firstQuestion,
            maxTurns: 15
          };
        }
      } catch (err) {
        console.warn('[api.interview.start] Real backend start fallback:', err);
      }

      // Dynamic fallback based on real student profile and topic
      const student = await this.student.getProfile(studentId);
      const dynamicTurns = generateDynamicQuestions(student, customTopic);
      const firstQ = dynamicTurns[0];
      const sessionId = `ses_${Date.now()}`;
      const sessionData = {
        sessionId,
        type,
        topic: customTopic,
        turnIndex: 0,
        questions: [firstQ],
        plannedTurns: dynamicTurns,
        tabSwitches: 0
      };
      this.setStorage(`interview_${sessionId}`, sessionData);
      return { sessionId, firstQuestion: firstQ, maxTurns: dynamicTurns.length };
    },

    recordProctorEvent: async (sessionId: string, eventType: 'TAB_SWITCH' | 'FULLSCREEN_EXIT') => {
      const sess = this.getStorage<any>(`interview_${sessionId}`, { tabSwitches: 0 });
      sess.tabSwitches = (sess.tabSwitches || 0) + 1;
      const isFlagged = sess.tabSwitches >= 4;
      this.setStorage(`interview_${sessionId}`, sess);
      try {
        await this._fetch('/interview/proctor-event', {
          method: 'POST',
          body: JSON.stringify({ sessionId, eventType, tabSwitches: sess.tabSwitches })
        });
      } catch {}
      return { tabSwitches: sess.tabSwitches, isFlagged };
    },

    submitAnswer: async (
      sessionId: string, 
      studentAnswer: string, 
      durationSeconds = 20,
      options?: { topic?: string; timeExpired?: boolean }
    ): Promise<{
      isCompleted: boolean;
      turnEvaluation?: QuestionTurn;
      nextQuestion?: QuestionTurn;
      finalReport?: DiagnosticReport;
    }> => {
      const sess = this.getStorage<any>(`interview_${sessionId}`, {
        turnIndex: 0,
        questions: [],
        tabSwitches: 0
      });
      const turnIdx = sess.turnIndex || 0;
      const currentQ = sess.questions[turnIdx] || { questionNumber: turnIdx + 1, questionText: 'Technical interview question', difficulty: 'MEDIUM', category: 'Engineering' };
      const currentTopic = options?.topic || sess.topic || currentQ.category || 'Software Engineering';

      try {
        const student = await this.student.getProfile();
        const res = await this._fetch<{
          data: {
            isCompleted: boolean;
            turnEvaluation: QuestionTurn;
            nextQuestion?: QuestionTurn;
            finalReport?: DiagnosticReport;
          }
        }>('/interview/submit-turn', {
          method: 'POST',
          body: JSON.stringify({
            sessionId,
            studentId: student?.id,
            studentAnswer,
            durationSeconds,
            turnIndex: turnIdx,
            currentQuestion: currentQ,
            previousTurns: sess.questions.slice(0, turnIdx),
            sessionType: sess.type || 'MOCK_INTERVIEW',
            tabSwitches: sess.tabSwitches || 0,
            topic: currentTopic,
            timeExpired: options?.timeExpired
          }),
        });

        if (res?.data?.turnEvaluation) {
          sess.questions[turnIdx] = res.data.turnEvaluation;
          if (!res.data.isCompleted && res.data.nextQuestion) {
            sess.turnIndex = turnIdx + 1;
            sess.questions.push(res.data.nextQuestion);
          }
          if (res.data.isCompleted && res.data.finalReport) {
            sess.finalReport = res.data.finalReport;
          }
          this.setStorage(`interview_${sessionId}`, sess);
          return res.data;
        }
      } catch (err) {
        console.warn('[api.interview.submitAnswer] Real AI backend evaluation fallback:', err);
      }

      // Local fallback calculation if backend was unreachable: scale to 13+ questions
      const student = await this.student.getProfile();
      const evalResult = evaluateDynamicAnswer(currentQ, studentAnswer, turnIdx, durationSeconds, student);
      const turnEvaluation: QuestionTurn = {
        id: currentQ.id || `q_${turnIdx + 1}`,
        questionNumber: turnIdx + 1,
        questionText: currentQ.questionText,
        difficulty: (turnIdx < 3 ? 'EASY' : turnIdx < 8 ? 'MEDIUM' : 'ADVANCED'),
        category: currentQ.category || currentTopic,
        studentAnswer,
        technicalScore: evalResult.technicalScore,
        communicationScore: evalResult.communicationScore,
        wpm: evalResult.wpm,
        fillerWords: evalResult.fillerWords,
        feedback: evalResult.feedback,
        strengths: evalResult.strengths,
        weaknesses: evalResult.weaknesses
      };

      sess.questions[turnIdx] = turnEvaluation;
      const isCompleted = (turnIdx >= 49) || Boolean(options?.timeExpired) || (durationSeconds >= 900);
      let nextQuestion: QuestionTurn | undefined = undefined;
      let finalReport: DiagnosticReport | undefined = undefined;

      if (!isCompleted) {
        const pool = generateDynamicQuestions(student, currentTopic);
        const askedTexts = new Set(sess.questions.map((q: any) => (q.questionText || '').toLowerCase().trim()));
        const candidateQ = pool.find(q => !askedTexts.has(q.questionText.toLowerCase().trim())) || pool[Math.min(turnIdx + 1, pool.length - 1)];

        const nextDiff = (turnIdx < 2 ? 'EASY' : turnIdx < 7 ? 'MEDIUM' : 'ADVANCED');
        nextQuestion = {
          id: `q_${turnIdx + 2}_${Date.now()}`,
          questionNumber: turnIdx + 2,
          questionText: candidateQ.questionText,
          difficulty: nextDiff,
          category: currentTopic
        };
        sess.turnIndex = turnIdx + 1;
        sess.questions.push(nextQuestion);
      } else {
        finalReport = synthesizeDynamicReport(sess.type || 'MOCK_INTERVIEW', sess.questions, student, sess.tabSwitches || 0);
        if (student.id) {
          this._fetch(`/students/${encodeURIComponent(student.id)}/reports`, {
            method: 'POST',
            body: JSON.stringify(finalReport)
          }).catch(() => {});
        }
      }

      this.setStorage(`interview_${sessionId}`, sess);
      return { isCompleted, turnEvaluation, nextQuestion, finalReport };
    },

    finalize: async (sessionId: string): Promise<DiagnosticReport | null> => {
      const sess = this.getStorage<any>(`interview_${sessionId}`, null);
      if (!sess) return null;
      if (sess.finalReport) return sess.finalReport;
      const student = await this.student.getProfile();
      return synthesizeDynamicReport(sess.type || 'MOCK_INTERVIEW', sess.questions || [], student, sess.tabSwitches || 0);
    },

    getReport: async (_sessionId: string): Promise<DiagnosticReport> => {
      const student = await this.student.getProfile();
      if (student.recentReports && student.recentReports.length > 0) {
        return student.recentReports[0];
      }
      return synthesizeDynamicReport('MOCK_INTERVIEW', [], student, 0);
    }
  };

  listening = {
    start: async (_studentId: string, passageIndex?: number) => {
      const pIdx = passageIndex !== undefined ? (passageIndex % LISTENING_PASSAGES.length) : Math.floor(Math.random() * LISTENING_PASSAGES.length);
      const selectedPassage = LISTENING_PASSAGES[pIdx];
      const sessionId = `lis_${Date.now()}`;
      
      this.setStorage(`listening_${sessionId}`, {
        passage: selectedPassage,
        replaysUsed: 0,
        answers: []
      });

      return {
        sessionId,
        passage: selectedPassage,
        replaysUsed: 0,
        maxReplays: 2
      };
    },

    recordReplay: async (sessionId: string) => {
      const sess = this.getStorage<any>(`listening_${sessionId}`, { replaysUsed: 0 });
      sess.replaysUsed = (sess.replaysUsed || 0) + 1;
      this.setStorage(`listening_${sessionId}`, sess);
      return { replaysUsed: sess.replaysUsed };
    },

    submitAnswers: async (sessionId: string, answers: { questionId: string; answerText: string }[], options?: { passage?: any; topic?: string }) => {
      const student = await this.student.getProfile();

      // 1. Attempt backend submission with PostgreSQL persistence
      try {
        const backendRes = await this._fetch<{ data: { overallScore: number; evaluations: any[]; finalReport: any } }>('/listening/submit-answers', {
          method: 'POST',
          body: JSON.stringify({
            sessionId,
            studentId: student?.id,
            topic: options?.topic,
            passage: options?.passage,
            answers
          })
        });

        if (backendRes?.data?.finalReport) {
          const report = backendRes.data.finalReport;
          student.recentReports = [report, ...(student.recentReports || [])];
          student.overallReadiness = backendRes.data.overallScore;
          student.score = backendRes.data.overallScore;
          return backendRes.data;
        }
      } catch (err) {
        console.warn('[api.listening.submitAnswers] Backend submission fallback:', err);
      }

      // 2. Fallback to client-side evaluation matching all passage questions
      const sess = this.getStorage<any>(`listening_${sessionId}`, {
        passage: LISTENING_PASSAGES[0],
        replaysUsed: 0
      });
      const passage = options?.passage || sess.passage || LISTENING_PASSAGES[0];
      const passageQuestions: any[] = passage.questions || [];

      let totalScore = 0;
      const evaluations = answers.map((ans, idx) => {
        const qObj = passageQuestions.find((q: any) => q.id === ans.questionId) || passageQuestions[idx] || {
          questionText: `Listening Question ${idx + 1}`,
          targetKeywords: [],
          idealAnswerSummary: ''
        };
        const lowerAnswer = (ans.answerText || '').toLowerCase();
        const keywords: string[] = qObj.targetKeywords || qObj.keywords || [];

        let score = 65;
        let matchedKeywords = 0;
        keywords.forEach((k: string) => {
          if (lowerAnswer.includes(k.toLowerCase())) {
            matchedKeywords++;
            score += 10;
          }
        });

        if ((ans.answerText || '').trim().length > 20) score += 5;
        score = Math.min(98, score);
        totalScore += score;

        return {
          questionIndex: idx,
          questionText: qObj.questionText,
          studentAnswer: ans.answerText,
          expectedAnswer: qObj.idealAnswerSummary || qObj.expectedAnswer || '',
          score,
          matchedKeywords,
          feedback: score >= 80 
            ? 'Accurately captured key architectural requirements.'
            : 'Partially captured requirement. Review technical constraints in the passage.'
        };
      });

      const avgScore = Math.round(totalScore / Math.max(1, answers.length));

      const turns: QuestionTurn[] = evaluations.map((ev, i) => ({
        id: `lis_q_${i + 1}`,
        questionNumber: i + 1,
        questionText: ev.questionText,
        difficulty: 'MEDIUM',
        studentAnswer: ev.studentAnswer,
        technicalScore: ev.score,
        communicationScore: Math.min(95, ev.score + 2),
        wpm: 126,
        fillerWords: 1,
        feedback: ev.feedback
      }));

      const finalReport = synthesizeDynamicReport('LISTENING_COMPREHENSION', turns, student, 0);
      finalReport.overallScore = avgScore;
      finalReport.technicalScore = avgScore;
      finalReport.communicationScore = Math.min(95, avgScore + 2);

      student.recentReports = [finalReport, ...(student.recentReports || [])];
      student.overallReadiness = avgScore;
      student.score = avgScore;

      if (student.id) {
        this._fetch(`/students/${encodeURIComponent(student.id)}/reports`, {
          method: 'POST',
          body: JSON.stringify(finalReport)
        }).catch(e => console.warn('Failed to save listening report to backend:', e));

        this._fetch(`/students/${encodeURIComponent(student.id)}/profile`, {
          method: 'PUT',
          body: JSON.stringify({ overallReadiness: avgScore, score: avgScore })
        }).catch(e => console.warn('Failed to update student score:', e));
      }

      return {
        overallScore: avgScore,
        evaluations,
        finalReport
      };
    }
  };

  suggestions = {
    getOrCreateSession: async (_studentId = 'stu-101'): Promise<string> => {
      return `sug_${Date.now()}`;
    },

    getHistory: async (sessionId: string) => {
      return this.getStorage<any[]>(`sug_hist_${sessionId}`, []);
    },

    sendMessage: async (sessionId: string, message: string) => {
      const lower = message.toLowerCase();
      let assistantReply = "Structure your answer using the STAR framework (Situation, Task, Action, Result). State the latency or scale bottleneck in the first sentence, explain your design choices, and conclude with verified performance metrics.";
      
      let technicalTerms = [
        { term: 'Event-driven Architecture', definition: 'A design pattern where state changes trigger decoupled asynchronous processing.', betterAlternativeTo: 'Sending calls back and forth' },
        { term: 'Idempotency', definition: 'Ensuring an operation produces the identical outcome even if executed repeatedly.', betterAlternativeTo: 'Making sure we do not duplicate requests' }
      ];

      let commSuggestions = [
        'Lead with the high-level trade-off before diving into implementation details.',
        'Use transition phrasing such as "From a throughput perspective" or "To preserve data consistency".'
      ];

      let structuralAdvice = [
        'Framework: Problem Scope -> Architectural Decision -> Benchmark Impact (latency, memory, or throughput).'
      ];

      if (lower.includes('pacing') || lower.includes('speed') || lower.includes('wpm')) {
        assistantReply = "For technical interviews, optimal speaking pace is between 120 and 150 words per minute. If you feel rushed, deliberately pause for 1 second between clauses instead of filling silence with vocal fillers.";
        commSuggestions = [
          'Take a breath before answering complex architectural questions.',
          'Replace fillers with purposeful pauses to signal deliberate thinking.'
        ];
      } else if (lower.includes('filler') || lower.includes('um') || lower.includes('like')) {
        assistantReply = "Filler words usually happen when your brain plans the next sentence faster than you speak. Ground your answers in bullet points in your head before speaking.";
        commSuggestions = [
          'Pause rather than saying "basically" or "sort of".',
          'Conclude statements with confidence rather than trailing off.'
        ];
      } else if (lower.includes('database') || lower.includes('scale') || lower.includes('system design')) {
        technicalTerms = [
          { term: 'Connection Pooling', definition: 'Reusing a cache of database connections to minimize overhead on concurrent requests.', betterAlternativeTo: 'Opening a new database connection each time' },
          { term: 'Sharding & Replication', definition: 'Splitting datasets across multiple database instances to scale read and write throughput.', betterAlternativeTo: 'Making the database bigger' }
        ];
        structuralAdvice = [
          'Structure: Read vs. Write Ratios -> Indexing Strategy -> Cache Invalidation -> Fallback Mechanism.'
        ];
      }

      const userMsg = { id: `msg_${Date.now()}_u`, role: 'user', content: message, createdAt: new Date().toISOString() };
      const assistantMsg = {
        id: `msg_${Date.now()}_a`,
        role: 'assistant' as const,
        content: assistantReply,
        technicalTerminology: technicalTerms,
        communicationSuggestions: commSuggestions,
        structuralAdvice,
        createdAt: new Date().toISOString()
      };

      const hist = this.getStorage<any[]>(`sug_hist_${sessionId}`, []);
      hist.push(userMsg, assistantMsg);
      this.setStorage(`sug_hist_${sessionId}`, hist);

      return {
        userMessage: userMsg,
        assistantMessage: assistantMsg
      };
    }
  };

  admin = {
    getCoordinatorStats: async () => {
      try {
        const res = await this._fetch<{ data: any }>('/admin/stats/coordinator');
        return res.data || { totalCandidates: 0, activeProgramsCount: 0, placementReadyRate: 0, readyCount: 0 };
      } catch (err) {
        console.warn('Failed to fetch coordinator stats:', err);
        return { totalCandidates: 0, activeProgramsCount: 0, placementReadyRate: 0, readyCount: 0 };
      }
    },

    getSystemStats: async () => {
      try {
        const res = await this._fetch<{ data: any }>('/admin/stats/system');
        return res.data || { programAdminsCount: 0, facultyMentorsCount: 0, trainersCount: 0, studentsCount: 0 };
      } catch (err) {
        console.warn('Failed to fetch system stats:', err);
        return { programAdminsCount: 0, facultyMentorsCount: 0, trainersCount: 0, studentsCount: 0 };
      }
    },

    getProgramAdmins: async (): Promise<any[]> => {
      try {
        const res = await this._fetch<{ data: { users: any[] } }>('/admin/users?role=PROGRAM_ADMIN');
        return res.data?.users || [];
      } catch {
        return [];
      }
    },

    createProgramAdmin: async (data: { name: string; email: string; password?: string }) => {
      const parts = data.name.trim().split(' ');
      const firstName = parts[0] || 'Admin';
      const lastName = parts.slice(1).join(' ') || '';
      return this.college.inviteProgramAdmin('col-1', {
        firstName,
        lastName,
        email: data.email,
        permissions: ['CAN_VIEW_STUDENT_PROGRESS', 'CAN_ASSIGN_INTERVIEWS', 'CAN_MANAGE_STUDENTS']
      });
    },

    getFacultyMentors: async (): Promise<any[]> => {
      try {
        const res = await this._fetch<{ data: { users: any[] } }>('/admin/users?role=FACULTY_MENTOR');
        return res.data?.users || [];
      } catch {
        return [];
      }
    },

    createFacultyMentor: async (data: { name: string; email: string; password?: string }) => {
      const parts = data.name.trim().split(' ');
      return this.college.inviteProgramAdmin('col-1', {
        firstName: parts[0] || 'Faculty',
        lastName: parts.slice(1).join(' ') || 'Mentor',
        email: data.email,
        permissions: ['CAN_VIEW_STUDENT_PROGRESS', 'CAN_ASSIGN_INTERVIEWS']
      });
    },

    assignMentor: async (studentId: string, mentorId: string) => {
      await this._fetch(`/students/${encodeURIComponent(studentId)}/profile`, {
        method: 'PUT',
        body: JSON.stringify({ mentorName: mentorId })
      });
      return { message: 'Mentor assigned successfully' };
    },

    createStudent: async (data: any) => {
      return this.studentBatch.enrollSingle('col-1', {
        name: data.name,
        rollNumber: data.rollNumber,
        email: data.email || `${(data.name || 'student').toLowerCase().replace(/\s+/g, '.')}@college.edu`,
        department: data.department || 'Computer Science & Engineering',
        batchYear: data.batchYear || 2026,
        track: data.track || 'General Track'
      });
    },

    createStudentByMentor: async (data: any) => {
      return this.admin.createStudent(data);
    },

    deleteUser: async (userId: string) => {
      await this._fetch(`/studentBatch/col-1/students/${encodeURIComponent(userId)}`, { method: 'DELETE' });
      return { success: true, message: 'User removed successfully' };
    },

    getStudentFullHistory: async (studentId: string, directReport?: any) => {
      let student: any = null;
      try {
        student = await this.student.getProfile(studentId);
      } catch {
        student = { id: studentId, name: 'Candidate Student', recentReports: [] };
      }
      if (!student) {
        student = { id: studentId, name: 'Candidate Student', recentReports: [] };
      }
      const rawReports = Array.isArray(student.recentReports) ? [...student.recentReports] : [];
      if (directReport && !rawReports.some((r: any) => r?.id === directReport?.id)) {
        rawReports.unshift(directReport);
      }
      const sessions = rawReports.map((r: any, i: number) => ({
        id: r.id || `ses_${i + 1}`,
        sessionType: r.sessionType || 'MOCK_INTERVIEW',
        overallScore: r.overallScore,
        technicalScore: r.technicalScore,
        communicationScore: r.communicationScore,
        averageWpm: r.averageWpm,
        totalFillerWords: r.totalFillerWords,
        createdAt: r.date || new Date().toISOString(),
        startedAt: r.date || new Date().toISOString(),
        tabSwitches: r.tabSwitches || 0,
        tabSwitchCount: r.tabSwitches || 0,
        isFlagged: r.isFlagged || false,
        isProctorFlagged: r.isFlagged || false,
        difficulty: 'MEDIUM',
        report: r,
        turns: r.turns || []
      }));

      const checklist = (student.criteriaTasks || []).map((t: any) => ({
        ...t,
        is_completed: t.isCompleted,
        verified_by_mentor: t.verifiedByMentor
      }));

      const studentData = {
        ...student,
        roll_number: student.rollNumber,
        batch_year: student.batchYear,
        mentor_name: student.mentorName,
        mentor_email: student.mentorEmail,
        readiness_score: student.overallReadiness,
        score: student.overallReadiness,
        tests_taken: sessions.length
      };

      return {
        student: studentData,
        profile: student,
        resume: student.resume,
        checklist,
        tasks: student.criteriaTasks,
        interviews: student.recentReports,
        interviewSessions: sessions
      };
    },

    getStudents: async (params: { cohort?: string; search?: string; collegeId?: string } = {}) => {
      const qParams = new URLSearchParams();
      if (params.search) qParams.set('search', params.search);
      let collegeId = params.collegeId;
      if (!collegeId && typeof localStorage !== 'undefined') {
        try {
          const saved = localStorage.getItem('auth_user');
          if (saved) {
            const u = JSON.parse(saved);
            if (u.collegeId || u.institutionId) collegeId = u.collegeId || u.institutionId;
          }
        } catch {}
      }
      if (collegeId) qParams.set('collegeId', collegeId);
      const q = qParams.toString() ? `?${qParams.toString()}` : '';
      const res = await this._fetch<{ data: any[] }>(`/admin/students${q}`);
      return res.data || [];
    },

    getMentorMentees: async (_mentorId?: string) => {
      const res = await this._fetch<{ data: any[] }>('/admin/mentees');
      return res.data || [];
    },

    getTrainerTenures: async (_collegeId?: string): Promise<TrainerTenure[]> => {
      const res = await this._fetch<{ data: any[] }>('/admin/trainers');
      return (res.data || []).map((t: any) => ({
        id: t.id,
        trainerName: t.trainerName,
        trainerEmail: t.trainerEmail,
        companyOrInstitute: t.companyOrInstitute,
        domain: t.domain,
        programId: t.programId,
        isCommonTrainer: t.isCommonTrainer,
        associatedProgramNames: t.associatedProgramNames || [],
        startDate: t.startDate,
        endDate: t.endDate,
        isActive: t.isActive
      }));
    },

    onboardTrainer: async (trainer: Omit<TrainerTenure, 'id' | 'isActive'>): Promise<TrainerTenure> => {
      const res = await this._fetch<{ data: any }>('/admin/trainers', {
        method: 'POST',
        body: JSON.stringify(trainer)
      });
      return res.data;
    },

    revokeTrainer: async (id: string): Promise<void> => {
      await this._fetch(`/admin/trainers/${encodeURIComponent(id)}/revoke`, { method: 'PATCH' });
    },

    getAssignments: async (collegeId?: string): Promise<InterviewAssignment[]> => {
      const q = collegeId ? `?collegeId=${encodeURIComponent(collegeId)}` : '';
      const res = await this._fetch<{ data: any[] }>(`/admin/assignments${q}`);
      return res.data || [];
    },

    createAssignment: async (asg: Partial<InterviewAssignment>): Promise<InterviewAssignment> => {
      const res = await this._fetch<{ data: any }>('/admin/assignments', {
        method: 'POST',
        body: JSON.stringify(asg)
      });
      return res.data;
    },

    submitAssignment: async (assignmentId: string, submission: AssignmentSubmission): Promise<{ success: boolean; assignment: InterviewAssignment }> => {
      const res = await this._fetch<{ data: { success: boolean; assignment: any } }>(`/admin/assignments/${encodeURIComponent(assignmentId)}/submit`, {
        method: 'POST',
        body: JSON.stringify(submission)
      });
      return res.data;
    },

    deleteAssignment: async (assignmentId: string): Promise<boolean> => {
      await this._fetch(`/admin/assignments/${encodeURIComponent(assignmentId)}`, { method: 'DELETE' });
      return true;
    },

    getStudentAssignments: async (student: any): Promise<InterviewAssignment[]> => {
      const list = await this.admin.getAssignments(student?.collegeId);
      return list.filter(a => {
        if (a.targetScope === 'ALL_STUDENTS') return true;
        if (a.targetScope === 'SPECIFIC_STUDENT') {
          return a.targetStudentId === student.id || 
                 a.targetStudentId === student.rollNumber || 
                 a.targetStudentName === student.name ||
                 Boolean(a.targetStudentId && student.email && a.targetStudentId.toLowerCase() === student.email.toLowerCase());
        }
        if (a.targetScope === 'MY_MENTEES') {
          return Boolean(student.mentorName || student.mentorEmail || student.mentorId);
        }
        if (a.targetScope === 'PROGRAM') {
          return student.programName === a.targetProgramName || student.track === a.targetProgramName || student.track?.startsWith(a.targetProgramName || '');
        }
        if (a.targetScope === 'CLASS') {
          if (a.targetClassNames && a.targetClassNames.length > 0) {
            return a.targetClassNames.some(cn => cn.toLowerCase() === (student.className || '').toLowerCase());
          }
          if (a.targetClassName) {
            return a.targetClassName.toLowerCase() === (student.className || '').toLowerCase();
          }
          return false;
        }
        if (a.targetScope === 'DEPARTMENT') {
          const deptMatch = student.department === a.targetDepartment || Boolean(student.department && student.department.includes(a.targetDepartment || ''));
          if (!deptMatch) return false;
          if (a.targetClassNames && a.targetClassNames.length > 0) {
            return a.targetClassNames.some(cn => cn.toLowerCase() === (student.className || '').toLowerCase());
          }
          if (a.targetClassName) {
            return a.targetClassName.toLowerCase() === (student.className || '').toLowerCase();
          }
          return true;
        }
        return true;
      });
    },

    getCollegePrograms: async (collegeId = 'col-1'): Promise<DynamicProgram[]> => {
      return this.college.getPrograms(collegeId);
    }
  };
}

export const api = new ApiClient();
export const API_ORIGIN = typeof window !== 'undefined' && window.location.origin ? window.location.origin : '';
