import { StudentProfile, CriteriaTask, TrainerTenure, InterviewAssignment, QuestionTurn, DynamicProgram } from '../types';

export const INITIAL_CRITERIA_TASKS: CriteriaTask[] = [];

export const DEFAULT_CLEAN_STUDENT: StudentProfile = {
  id: '',
  name: '',
  rollNumber: '',
  email: '',
  department: '',
  batchYear: new Date().getFullYear(),
  track: 'General Track',
  mentorName: '',
  mentorEmail: '',
  codingHandles: {
    github: undefined,
    leetcode: undefined,
    hackerrank: undefined,
    codeforces: undefined,
    codechef: undefined,
    leetcodeSolved: 0,
    githubRepos: 0
  },
  resume: null,
  criteriaTasks: [],
  recentReports: [],
  coins: 5
};

export const INITIAL_STUDENT_PROFILE: StudentProfile = {
  ...DEFAULT_CLEAN_STUDENT
};

export const MOCK_INTERVIEW_QUESTIONS: QuestionTurn[] = [
  {
    id: 'q-1',
    questionNumber: 1,
    questionText: 'Please introduce yourself and describe your technical background and key projects.',
    difficulty: 'EASY'
  }
];

export const LISTENING_PASSAGES = [
  {
    id: 'pass-finpay',
    title: 'FinPay Systems: Real-Time Payment Settlement Gateway',
    durationSeconds: 65,
    domain: 'FinTech & Distributed Systems',
    narrativeText: `The client, FinPay Systems, requires a resilient settlement engine processing domestic merchant transactions. Each transaction payload contains a merchant identifier, timestamp in UTC, and an idempotent transaction reference. The system must guarantee a maximum end-to-end latency of 250 milliseconds with ninety-nine point nine nine percent availability. In the event of a banking network partition, the settlement ledger must reject incoming charge requests with error code 503 rather than queuing indefinite retries. All transaction state events must be audited in an immutable append-only ledger before issuing confirmation webhooks to merchants.`,
    questions: [
      {
        id: 'lq-1',
        questionText: 'What is the maximum end-to-end latency specified by FinPay Systems for merchant transactions?',
        expectedAnswer: '250 milliseconds',
        keywords: ['250', 'millisecond', 'latency']
      },
      {
        id: 'lq-2',
        questionText: 'What should the settlement engine do if a banking network partition occurs?',
        expectedAnswer: 'Reject incoming charge requests with error code 503 instead of queuing indefinite retries.',
        keywords: ['reject', '503', 'partition', 'indefinite', 'retry']
      },
      {
        id: 'lq-3',
        questionText: 'What must happen before confirmation webhooks are dispatched to merchants?',
        expectedAnswer: 'All transaction state events must be audited into an immutable append-only ledger.',
        keywords: ['audit', 'immutable', 'append-only', 'ledger', 'events']
      }
    ]
  },
  {
    id: 'pass-cloudscale',
    title: 'CloudScale: Microservices Decoupling & API Gateway Migration',
    durationSeconds: 58,
    domain: 'Cloud Computing & DevOps',
    narrativeText: `CloudScale Infrastructure is decomposing a legacy monolith into event-driven containerized microservices hosted on Kubernetes. To prevent catastrophic cascading failures, the API gateway enforces token-bucket rate limiting capped at 5,000 requests per second per tenant. Inter-service communications must migrate from synchronous REST to asynchronous Apache Kafka topic partitions. In the event of persistent worker node depletion, consumer pods must automatically scale using Horizontal Pod Autoscalers driven by Prometheus lag metrics.`,
    questions: [
      {
        id: 'lq-1',
        questionText: 'What rate-limiting algorithm and throughput limit does the API gateway enforce per tenant?',
        expectedAnswer: 'Token-bucket rate limiting capped at 5,000 requests per second per tenant.',
        keywords: ['token-bucket', '5000', 'rate limit', 'requests per second']
      },
      {
        id: 'lq-2',
        questionText: 'How must inter-service communications be handled during the migration?',
        expectedAnswer: 'Migrate from synchronous REST to asynchronous Apache Kafka topic partitions.',
        keywords: ['kafka', 'asynchronous', 'topic', 'partitions', 'rest']
      },
      {
        id: 'lq-3',
        questionText: 'What metric and mechanism trigger pod autoscaling under heavy worker load?',
        expectedAnswer: 'Horizontal Pod Autoscalers driven by Prometheus lag metrics.',
        keywords: ['horizontal pod autoscaler', 'hpa', 'prometheus', 'lag']
      }
    ]
  },
  {
    id: 'pass-neurodata',
    title: 'NeuroData AI: Low-Latency Feature Store & Model Inference',
    durationSeconds: 62,
    domain: 'AI / Machine Learning',
    narrativeText: `NeuroData AI operates a distributed real-time recommendation pipeline serving online predictions. The feature store separates real-time online features stored in Redis clusters with sub-10-millisecond read SLAs from offline training features maintained in Parquet lakehouses. Model inference servers receive compressed payload vectors via gRPC channels. If the p99 inference latency exceeds 80 milliseconds, the load balancer must fallback to cached pre-computed embeddings and trigger an alert to the telemetry on-call channel.`,
    questions: [
      {
        id: 'lq-1',
        questionText: 'What is the read latency SLA and storage engine used for the online feature store?',
        expectedAnswer: 'Sub-10-millisecond read SLA using Redis clusters.',
        keywords: ['10', 'millisecond', 'redis', 'sub-10']
      },
      {
        id: 'lq-2',
        questionText: 'What communication protocol is mandated for streaming compressed payload vectors to model servers?',
        expectedAnswer: 'gRPC channels.',
        keywords: ['grpc', 'channel', 'protocol']
      },
      {
        id: 'lq-3',
        questionText: 'What fallback action must the load balancer execute if p99 latency breaches 80 milliseconds?',
        expectedAnswer: 'Fallback to cached pre-computed embeddings and alert the telemetry on-call channel.',
        keywords: ['cached', 'embeddings', 'fallback', 'pre-computed', 'alert']
      }
    ]
  },
  {
    id: 'pass-cybershield',
    title: 'CyberShield: Zero-Trust Identity Federation & Token Rotation',
    durationSeconds: 60,
    domain: 'Cybersecurity & Auth',
    narrativeText: `CyberShield is implementing an enterprise-wide Zero Trust access control plane across 15 global satellite offices. User authentication requires hardware-backed FIDO2 security keys paired with mutual TLS device certificates. OAuth access tokens carry an ephemeral lifespan of exactly 15 minutes, after which refresh tokens must perform an atomic single-use exchange. If token replay is detected, the authentication server immediately invalidates all active sessions for that principal and issues a high-priority security event to the SIEM dashboard.`,
    questions: [
      {
        id: 'lq-1',
        questionText: 'What hardware and device requirements are enforced for user authentication?',
        expectedAnswer: 'Hardware-backed FIDO2 security keys paired with mutual TLS device certificates.',
        keywords: ['fido2', 'hardware', 'mutual tls', 'mtls', 'certificate']
      },
      {
        id: 'lq-2',
        questionText: 'What is the exact lifespan of issued OAuth access tokens?',
        expectedAnswer: '15 minutes.',
        keywords: ['15', 'minute', 'ephemeral']
      },
      {
        id: 'lq-3',
        questionText: 'What immediate security remediation occurs if token replay is detected?',
        expectedAnswer: 'Immediately invalidates all active sessions for that principal and dispatches an alert to the SIEM dashboard.',
        keywords: ['invalidate', 'sessions', 'principal', 'siem', 'replay']
      }
    ]
  }
];

export const LISTENING_PASSAGE = LISTENING_PASSAGES[0];

export const MOCK_TRAINER_TENURES: TrainerTenure[] = [];

export const MOCK_ASSIGNMENTS: InterviewAssignment[] = [];

export const MOCK_MENTEES_LIST: any[] = [];

export const MOCK_COLLEGES: any[] = [];

export const MOCK_DYNAMIC_DEPARTMENTS: any[] = [];

export const MOCK_DYNAMIC_PROGRAMS: DynamicProgram[] = [];

export const ADMIN_PERMISSION_LABELS: Record<string, { label: string; desc: string }> = {
  'CAN_VIEW_STUDENT_PROGRESS': {
    label: 'View Students’ Progress',
    desc: 'Access live performance reports, speaking speed (WPM), and filler word analytics.'
  },
  'CAN_ASSIGN_INTERVIEWS': {
    label: 'Assign Mock Technical Interviews',
    desc: 'Schedule and assign AI mock interview practice sessions with deadlines for students.'
  },
  'CAN_ASSIGN_LISTENING': {
    label: 'Assign Listening Labs',
    desc: 'Assign audio listening comprehension practice sessions to students.'
  },
  'CAN_MANAGE_STUDENTS': {
    label: 'Manage Students & Program Assignment',
    desc: 'Enroll students, assign tracks/programs, and verify placement checklist.'
  }
};

export const MOCK_DEPARTMENT_CLASSES: any[] = [];

export const MOCK_DEPARTMENT_STAFF: any[] = [];
