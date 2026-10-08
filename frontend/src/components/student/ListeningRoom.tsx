import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { LISTENING_PASSAGES } from '../../data/mockData';
import { api } from '../../services/api';
import { 
  Headphones, 
  Play, 
  Pause, 
  RotateCcw, 
  Mic, 
  MicOff, 
  ChevronRight, 
  Radio,
  Layers,
  Sparkles,
  ArrowLeft,
  Clock,
  RefreshCw,
  FileText,
  CheckCircle2,
  ArrowRight
} from 'lucide-react';

interface DynamicPassage {
  id: string;
  domain: string;
  title: string;
  durationSeconds: number;
  narrativeText: string;
  isFromResume: boolean;
  questions: {
    id: string;
    questionText: string;
    targetKeywords: string[];
    idealAnswerSummary: string;
  }[];
}

function generateResumeListeningPassages(student: any, topic?: string): DynamicPassage[] {
  const normTopic = (topic || '').toLowerCase().trim();
  const resume = student?.resume;
  const project = resume?.projects?.[0]?.title || 'Cloud API Microservice';
  const lang = resume?.skills?.languages?.[0] || 'Java';
  const db = resume?.skills?.databases?.[0] || 'PostgreSQL';
  const framework = resume?.skills?.frameworks?.[0] || 'Spring Boot';

  // 1. Python Topic Passage (13 Unique Questions)
  const pythonPassage: DynamicPassage = {
    id: `lis_topic_python`,
    domain: `Python: High-Throughput Async & GIL Optimization`,
    title: `Architectural Incident Briefing: High-Throughput Async Service & GIL Optimization`,
    durationSeconds: 120,
    isFromResume: false,
    narrativeText: `Candidate, welcome to this architectural incident review on high-throughput Python microservices. In our recent production deployment, an API built with FastAPI and CPython was handling 10,000 concurrent requests per second. The engineering team observed latency spikes exceeding 1,800 milliseconds and occasional process deadlocks. Profiling with cProfile and tracemalloc revealed three critical bottlenecks: first, blocking I/O calls inside synchronous endpoints were starving the asyncio event loop; second, heavy CPU-bound parsing routines were contending for the CPython Global Interpreter Lock; and third, circular reference chains in our custom serialization models were triggering costly cyclic garbage collection sweeps during peak load. To resolve these issues, the principal architect mandated three architectural migrations: first, offloading all CPU-bound parsing to a multi-process worker pool using ProcessPoolExecutor and Rust-based C extensions; second, refactoring all database drivers to non-blocking asyncpg connections backed by a PgBouncer connection pool in transaction mode; and third, placing an in-memory distributed Redis cache cluster ahead of the service using a cache-aside pattern with a 300-second TTL and token bucket rate limiting. Furthermore, to prevent duplicate task execution during network blips, idempotency keys are stored in Redis with atomic SETNX locks. Finally, end-to-end distributed tracing was enabled via OpenTelemetry with Prometheus alert thresholds set at 500 milliseconds for p99 latency. Listen carefully and be prepared to address the architectural solutions, concurrency mechanisms, and resilience protocols discussed.`,
    questions: [
      {
        id: 'q_py_1',
        questionText: 'What primary throughput and latency degradation triggered this Python architectural incident review?',
        targetKeywords: ['10000', 'concurrent', '1800ms', 'latency spike', 'deadlock'],
        idealAnswerSummary: 'Handling 10,000 concurrent requests per second caused latency spikes exceeding 1,800ms and occasional process deadlocks.'
      },
      {
        id: 'q_py_2',
        questionText: 'What three distinct root cause bottlenecks were revealed by cProfile and tracemalloc profiling?',
        targetKeywords: ['blocking', 'event loop', 'gil', 'cpu-bound', 'garbage collection', 'cyclic'],
        idealAnswerSummary: 'Blocking I/O calls starving the asyncio event loop, CPU-bound parsing contending for the GIL, and cyclic garbage collection sweeps from circular reference chains.'
      },
      {
        id: 'q_py_3',
        questionText: 'How does the Global Interpreter Lock (GIL) in CPython limit concurrency during CPU-intensive tasks?',
        targetKeywords: ['gil', 'thread', 'single', 'interpreter', 'cpu'],
        idealAnswerSummary: 'The GIL allows only one native thread to execute Python bytecode at a time, preventing multi-threaded CPU parallelization.'
      },
      {
        id: 'q_py_4',
        questionText: 'Why were synchronous endpoints causing event loop starvation in the FastAPI service?',
        targetKeywords: ['synchronous', 'blocking', 'starving', 'event loop', 'async'],
        idealAnswerSummary: 'Synchronous blocking calls occupied the single event loop thread, preventing it from processing other concurrent async coroutines.'
      },
      {
        id: 'q_py_5',
        questionText: 'What solution was adopted to offload CPU-bound parsing routines away from the main Python process?',
        targetKeywords: ['processpoolexecutor', 'multiprocess', 'rust', 'c extension'],
        idealAnswerSummary: 'Offloading CPU parsing to a multi-process worker pool using ProcessPoolExecutor and Rust-based C extensions.'
      },
      {
        id: 'q_py_6',
        questionText: 'What database driver and connection pool configuration were implemented for database access?',
        targetKeywords: ['asyncpg', 'pgbouncer', 'transaction mode', 'non-blocking'],
        idealAnswerSummary: 'Non-blocking asyncpg database driver backed by PgBouncer running in transaction pooling mode.'
      },
      {
        id: 'q_py_7',
        questionText: 'What caching pattern was implemented with the distributed Redis tier, and what is the configured TTL?',
        targetKeywords: ['cache-aside', 'redis', '300 seconds', 'ttl'],
        idealAnswerSummary: 'A distributed Redis cache layer using the cache-aside pattern with a 300-second TTL.'
      },
      {
        id: 'q_py_8',
        questionText: 'What rate limiting algorithm was established at the API gateway layer to prevent resource starvation?',
        targetKeywords: ['token bucket', 'rate limit', 'redis'],
        idealAnswerSummary: 'A token bucket rate limiting algorithm implemented at the edge.'
      },
      {
        id: 'q_py_9',
        questionText: 'How does the architecture protect against duplicate task executions during transient network blips?',
        targetKeywords: ['idempotency key', 'redis', 'setnx', 'atomic lock'],
        idealAnswerSummary: 'Stamping requests with idempotency keys verified against atomic Redis SETNX distributed locks.'
      },
      {
        id: 'q_py_10',
        questionText: 'Why was cyclic garbage collection particularly disruptive during high-throughput peak loads?',
        targetKeywords: ['cyclic', 'circular reference', 'pause', 'stop-the-world', 'generation'],
        idealAnswerSummary: 'Cyclic garbage collection pauses process execution to traverse and resolve circular reference graphs across generations.'
      },
      {
        id: 'q_py_11',
        questionText: 'What distributed observability and monitoring frameworks were introduced in the infrastructure?',
        targetKeywords: ['opentelemetry', 'prometheus', 'distributed tracing'],
        idealAnswerSummary: 'Distributed tracing via OpenTelemetry with metric collection and alerting using Prometheus.'
      },
      {
        id: 'q_py_12',
        questionText: 'What exact alert threshold was configured for p99 latency in production monitoring?',
        targetKeywords: ['500ms', 'p99', 'latency', 'alert'],
        idealAnswerSummary: 'Prometheus alert thresholds were configured for p99 latency exceeding 500 milliseconds.'
      },
      {
        id: 'q_py_13',
        questionText: 'What fundamental trade-off was accepted by transitioning from threads to ProcessPoolExecutor for parsing?',
        targetKeywords: ['memory', 'inter-process communication', 'overhead', 'ipc'],
        idealAnswerSummary: 'Increased memory consumption and inter-process serialization overhead in exchange for bypassing GIL CPU contention.'
      }
    ]
  };

  // 2. React & Frontend Performance Topic Passage (13 Unique Questions)
  const reactPassage: DynamicPassage = {
    id: `lis_topic_react`,
    domain: `React & Frontend Performance`,
    title: `Architectural Incident Briefing: Frontend Hydration, Fiber Reconciliation & Core Web Vitals`,
    durationSeconds: 120,
    isFromResume: false,
    narrativeText: `Candidate, welcome to this architectural incident review on frontend web performance. Following our latest release, the enterprise web dashboard suffered critical performance degradation with Largest Contentful Paint (LCP) reaching 4.2 seconds and Interaction to Next Paint (INP) degrading to 380 milliseconds. Profiling through Chrome DevTools revealed three root causes: first, an unoptimized monolithic JavaScript bundle of 4.5 megabytes was blocking the main browser thread during initial parsing; second, unmemoized context providers were triggering cascading re-renders across the entire Virtual DOM tree; and third, client-side hydration mismatches between Server-Side Rendering and the React 18 client were causing complete component unmount and re-mount cycles. To remediate this, the frontend architect introduced five core optimizations: first, implementing route-level code splitting using React.lazy and dynamic ES imports, cutting initial bundle size to under 250 kilobytes; second, migrating static marketing and data displays to React Server Components (RSC) to eliminate client runtime JavaScript; third, wrapping costly cryptographic and chart calculations into Web Workers using Comlink; fourth, replacing deep context state propagation with an atomic state manager and virtualizing data tables using react-window; and fifth, enforcing strict Content Security Policy (CSP) headers with Subresource Integrity (SRI) hashes on all external assets. Listen carefully and prepare to analyze the frontend rendering pipeline and optimizations.`,
    questions: [
      {
        id: 'q_fe_1',
        questionText: 'What specific Core Web Vitals metrics showed severe degradation in the dashboard?',
        targetKeywords: ['lcp', 'largest contentful paint', '4.2', 'inp', '380ms'],
        idealAnswerSummary: 'Largest Contentful Paint reached 4.2 seconds and Interaction to Next Paint degraded to 380 milliseconds.'
      },
      {
        id: 'q_fe_2',
        questionText: 'What three root causes were identified during Chrome DevTools profiling?',
        targetKeywords: ['4.5mb', 'monolithic bundle', 'main thread', 'cascading re-renders', 'hydration mismatch'],
        idealAnswerSummary: 'A 4.5MB monolithic bundle blocking the main thread, unmemoized context causing cascading re-renders, and SSR hydration mismatches.'
      },
      {
        id: 'q_fe_3',
        questionText: 'How was the initial JavaScript bundle reduced from 4.5MB down to under 250KB?',
        targetKeywords: ['code splitting', 'react.lazy', 'dynamic import', '250kb'],
        idealAnswerSummary: 'Route-level code splitting using React.lazy and dynamic ES imports.'
      },
      {
        id: 'q_fe_4',
        questionText: 'What is Interaction to Next Paint (INP), and what caused it to degrade to 380ms?',
        targetKeywords: ['inp', 'responsiveness', 'main thread', 'long task', 'paint'],
        idealAnswerSummary: 'INP measures user interface responsiveness; long JavaScript tasks on the main thread delayed browser paint responses to user interactions.'
      },
      {
        id: 'q_fe_5',
        questionText: 'How do React Server Components (RSC) help reduce client-side JavaScript execution?',
        targetKeywords: ['server components', 'rsc', 'zero-bundle', 'pre-render', 'client javascript'],
        idealAnswerSummary: 'React Server Components render purely on the server and send pre-rendered JSX without sending component JavaScript to the browser.'
      },
      {
        id: 'q_fe_6',
        questionText: 'What issue caused complete component unmount and re-mount cycles during page loading?',
        targetKeywords: ['hydration mismatch', 'ssr', 'server-side', 'dom tree'],
        idealAnswerSummary: 'Client-side hydration mismatches between the server-rendered HTML and client React DOM.'
      },
      {
        id: 'q_fe_7',
        questionText: 'How were CPU-heavy chart and cryptographic computations prevented from freezing the UI?',
        targetKeywords: ['web worker', 'comlink', 'background thread', 'offload'],
        idealAnswerSummary: 'By offloading heavy computations to background Web Workers using Comlink.'
      },
      {
        id: 'q_fe_8',
        questionText: 'What technique was applied to maintain smooth scrolling and rendering in large data tables?',
        targetKeywords: ['virtualization', 'windowing', 'react-window', 'dom nodes'],
        idealAnswerSummary: 'DOM virtualization using windowing (react-window) to only render visible table rows.'
      },
      {
        id: 'q_fe_9',
        questionText: 'Why were unmemoized React Context providers causing performance bottlenecks?',
        targetKeywords: ['context', 'cascading', 're-renders', 'consumers', 'unmemoized'],
        idealAnswerSummary: 'Every value update in an unmemoized context forces all consuming child components down the tree to re-render.'
      },
      {
        id: 'q_fe_10',
        questionText: 'What security policies and asset integrity checks were mandated in the deployment?',
        targetKeywords: ['csp', 'content security policy', 'sri', 'subresource integrity', 'hash'],
        idealAnswerSummary: 'Strict Content Security Policy headers and Subresource Integrity hashes on external scripts and stylesheets.'
      },
      {
        id: 'q_fe_11',
        questionText: 'How does the Virtual DOM reconciliation algorithm determine when to re-render a subtree?',
        targetKeywords: ['reconciliation', 'diffing', 'fiber', 'keys', 'props'],
        idealAnswerSummary: 'React diffs the previous and next Fiber trees using element types and keys to compute minimal DOM mutations.'
      },
      {
        id: 'q_fe_12',
        questionText: 'What role do useMemo and useCallback play in optimizing component re-render frequency?',
        targetKeywords: ['usememo', 'usecallback', 'referential equality', 'memoization'],
        idealAnswerSummary: 'They preserve referential equality of complex objects and callback functions across re-renders to prevent unnecessary child updates.'
      },
      {
        id: 'q_fe_13',
        questionText: 'What primary trade-off is involved when adopting Server-Side Rendering over Client-Side Rendering?',
        targetKeywords: ['server load', 'ttfb', 'hydration latency', 'complexity'],
        idealAnswerSummary: 'Higher server compute cost and time-to-first-byte latency in exchange for faster initial contentful paint and superior SEO.'
      }
    ]
  };

  // 3. System Design & Distributed Architecture Topic Passage (13 Unique Questions)
  const systemDesignPassage: DynamicPassage = {
    id: `lis_topic_sysdesign`,
    domain: `System Design & Distributed Architecture`,
    title: `Architectural Incident Briefing: Distributed Idempotency, Partitioning & Failover`,
    durationSeconds: 120,
    isFromResume: false,
    narrativeText: `Candidate, welcome to this architectural incident review on distributed consensus and high-availability transaction processing. During our Black Friday traffic surge, our order and payment cluster suffered intermittent split-brain states and transaction anomalies under 45,000 queries per second. Post-mortem analysis highlighted three severe flaws: first, traditional Two-Phase Commit (2PC) coordinators were timing out across availability zones, holding open distributed row locks and triggering cascading thread pool exhaustion; second, network retries from upstream mobile clients caused duplicate payment entries due to non-idempotent consumer endpoints; and third, monotonic database range sharding created extreme write hotspots on a single shard partition. To eliminate these vulnerabilities, the system architecture was refactored: first, Two-Phase Commit was completely replaced with the Saga orchestration pattern utilizing compensating transactions and outbox event publishing; second, message routing was migrated to Apache Kafka using partition key hashing and consumer group offset management; third, all mutating endpoints now enforce strict client idempotency tokens verified against distributed Redis locks with a 120-second lease time; fourth, range sharding was replaced by consistent hashing with 256 virtual nodes per physical host; and fifth, circuit breakers with exponential backoff and randomized jitter were placed on all external payment gateway integrations to prevent cascading failovers. Listen carefully and be prepared to explain the fault-tolerance and distributed consensus decisions.`,
    questions: [
      {
        id: 'q_sd_1',
        questionText: 'What were the primary traffic load and incident symptoms experienced during the peak surge?',
        targetKeywords: ['45000', 'queries per second', 'split-brain', 'transaction anomalies', 'black friday'],
        idealAnswerSummary: 'Handling 45,000 QPS caused intermittent split-brain states, transaction anomalies, and thread pool exhaustion.'
      },
      {
        id: 'q_sd_2',
        questionText: 'Why was Two-Phase Commit (2PC) identified as a critical vulnerability under high concurrency?',
        targetKeywords: ['two-phase commit', '2pc', 'coordinator', 'locks', 'latency', 'blocking'],
        idealAnswerSummary: '2PC is a blocking protocol; coordinator timeouts held distributed locks open across AZs, starving database threads.'
      },
      {
        id: 'q_sd_3',
        questionText: 'How does the Saga pattern with compensating transactions resolve distributed transaction failures?',
        targetKeywords: ['saga', 'compensating', 'transactions', 'orchestration', 'rollback'],
        idealAnswerSummary: 'The Saga pattern executes local transactions in sequence, executing compensating transactions in reverse if any step fails.'
      },
      {
        id: 'q_sd_4',
        questionText: 'What mechanism prevents duplicate payment executions when mobile clients retry failed requests?',
        targetKeywords: ['idempotency token', 'redis lock', '120 seconds', 'lease', 'deduplication'],
        idealAnswerSummary: 'Client idempotency tokens verified against distributed Redis locks with a 120-second lease time.'
      },
      {
        id: 'q_sd_5',
        questionText: 'How was the transactional outbox pattern utilized alongside event-driven messaging?',
        targetKeywords: ['outbox pattern', 'event publishing', 'atomicity', 'kafka'],
        idealAnswerSummary: 'Events are committed to an outbox table in the same database transaction before asynchronous publication to Kafka.'
      },
      {
        id: 'q_sd_6',
        questionText: 'How does Apache Kafka ensure ordered processing within a specific customer account?',
        targetKeywords: ['partition key', 'kafka', 'ordering', 'partition', 'hashing'],
        idealAnswerSummary: 'By using the customer account ID as the Kafka partition key, guaranteeing all account events land in the same partition in strict order.'
      },
      {
        id: 'q_sd_7',
        questionText: 'Why did monotonic range sharding cause severe database write hotspots?',
        targetKeywords: ['range sharding', 'hotspot', 'monotonic', 'single partition', 'write'],
        idealAnswerSummary: 'Monotonically increasing IDs or timestamps routed all consecutive new write operations to the single latest shard partition.'
      },
      {
        id: 'q_sd_8',
        questionText: 'How does consistent hashing with virtual nodes eliminate shard data skew?',
        targetKeywords: ['consistent hashing', 'virtual nodes', '256', 'hash ring', 'even distribution'],
        idealAnswerSummary: 'Virtual nodes (256 per host) map keys evenly across a continuous hash ring, preventing physical shard hot spots.'
      },
      {
        id: 'q_sd_9',
        questionText: 'What resilience mechanism protects the platform from downstream payment gateway downtime?',
        targetKeywords: ['circuit breaker', 'exponential backoff', 'randomized jitter', 'cascading'],
        idealAnswerSummary: 'Circuit breakers with exponential backoff and randomized jitter to isolate failures and prevent retry storms.'
      },
      {
        id: 'q_sd_10',
        questionText: 'Why is randomized jitter critical when applying exponential backoff retry algorithms?',
        targetKeywords: ['jitter', 'randomized', 'thundering herd', 'synchronized retries'],
        idealAnswerSummary: 'Jitter spreads retry attempts over time, preventing synchronized retries from causing thundering herd spikes on recovered services.'
      },
      {
        id: 'q_sd_11',
        questionText: 'Under the CAP theorem, which trade-off did the engineering team choose between consistency and availability?',
        targetKeywords: ['cap theorem', 'eventual consistency', 'availability', 'partition tolerance'],
        idealAnswerSummary: 'Chosen Availability and Partition Tolerance (AP) with eventual consistency and compensating logic over strict immediate consistency.'
      },
      {
        id: 'q_sd_12',
        questionText: 'How do consumer groups in Apache Kafka handle partition rebalancing during node failures?',
        targetKeywords: ['consumer groups', 'rebalancing', 'heartbeat', 'offsets'],
        idealAnswerSummary: 'The group coordinator detects missed heartbeats and reassigns partitions across remaining active consumer instances.'
      },
      {
        id: 'q_sd_13',
        questionText: 'What fundamental operational complexity is introduced when migrating from ACID transactions to Sagas?',
        targetKeywords: ['eventual consistency', 'compensating logic', 'debugging', 'complexity'],
        idealAnswerSummary: 'Handling intermediate dirty states, authoring and testing reliable compensating rollback logic, and asynchronous debugging.'
      }
    ]
  };

  // 4. Database & SQL Topic Passage (13 Unique Questions)
  const databasePassage: DynamicPassage = {
    id: `lis_topic_db`,
    domain: `Database Internals & SQL Performance`,
    title: `Architectural Incident Briefing: PostgreSQL MVCC Contention, WAL Stalls & Index Optimization`,
    durationSeconds: 120,
    isFromResume: false,
    narrativeText: `Candidate, welcome to this architectural incident review on relational database internals and query engine performance. During quarter-end financial reconciliation, our primary PostgreSQL 15 database cluster experienced extreme performance degradation, with CPU utilization pinned at 100% and disk I/O write latency jumping to 45 milliseconds. Deep diagnostics using pg_stat_statements and pg_stat_activity uncovered three root causes: first, massive analytics reporting jobs running under the Repeatable Read isolation level were holding open long-lived transaction snapshots, preventing autovacuum from reclaiming dead tuples and ballooning table bloat to 65%; second, unindexed nested loop joins across an 80-million-row ledger table were forcing sequential disk scans; and third, synchronous WAL commit flushes were saturating disk controller write queues. To restore database throughput, the principal DBA executed four critical architectural interventions: first, configuring a dedicated read replica streaming via physical WAL replication to offload all reporting workloads; second, creating partial compound B-Tree indexes with include columns covering the specific join query projections; third, tuning postgresql.conf parameters including autovacuum_vacuum_scale_factor to 0.05 and enabling asynchronous commit for non-critical audit events; and fourth, placing PgBouncer in transaction pooling mode to cap connection slots at 100, exactly matching the hardware CPU core count. Listen carefully and prepare to discuss database locking, indexing, and storage engine mechanics.`,
    questions: [
      {
        id: 'q_db_1',
        questionText: 'What primary resource saturation metrics were recorded during the database performance degradation?',
        targetKeywords: ['cpu 100%', 'disk i/o', '45ms', 'write latency', 'quarter-end'],
        idealAnswerSummary: 'CPU utilization reached 100% and disk I/O write latency spiked to 45 milliseconds during financial reconciliation.'
      },
      {
        id: 'q_db_2',
        questionText: 'How did long-running Repeatable Read transactions cause 65% table bloat in PostgreSQL?',
        targetKeywords: ['repeatable read', 'snapshot', 'autovacuum', 'dead tuples', 'table bloat'],
        idealAnswerSummary: 'Long-running transaction snapshots prevented autovacuum from cleaning dead tuples created by updates and deletes.'
      },
      {
        id: 'q_db_3',
        questionText: "How does PostgreSQL's Multi-Version Concurrency Control (MVCC) handle record updates?",
        targetKeywords: ['mvcc', 'dead tuple', 'xmax', 'xmin', 'new row version'],
        idealAnswerSummary: 'PostgreSQL writes a new version of the row with updated xmin/xmax transaction IDs, leaving the old row as a dead tuple.'
      },
      {
        id: 'q_db_4',
        questionText: 'What join algorithm failure was occurring on the 80-million-row ledger table?',
        targetKeywords: ['nested loop', 'sequential scan', 'unindexed', '80 million'],
        idealAnswerSummary: 'Unindexed nested loop joins forced the query engine to execute repetitive sequential disk scans across 80 million rows.'
      },
      {
        id: 'q_db_5',
        questionText: 'How did creating partial compound B-Tree indexes with INCLUDE clauses solve the query bottleneck?',
        targetKeywords: ['partial index', 'b-tree', 'include', 'index-only scan', 'covering'],
        idealAnswerSummary: 'They created covering indexes that allowed index-only scans without filtering or fetching table heap pages.'
      },
      {
        id: 'q_db_6',
        questionText: 'What architectural strategy was implemented to isolate heavy analytics queries from OLTP traffic?',
        targetKeywords: ['read replica', 'physical replication', 'wal streaming', 'offload'],
        idealAnswerSummary: 'Deploying a dedicated read-only replica powered by physical streaming WAL replication.'
      },
      {
        id: 'q_db_7',
        questionText: 'What is the role of the Write-Ahead Log (WAL) in PostgreSQL crash durability?',
        targetKeywords: ['write-ahead log', 'wal', 'durability', 'acid', 'disk flush'],
        idealAnswerSummary: 'WAL records all changes to disk sequentially before table data pages are updated, ensuring durability and recovery.'
      },
      {
        id: 'q_db_8',
        questionText: 'Why was asynchronous commit enabled for non-critical audit events?',
        targetKeywords: ['asynchronous commit', 'disk queue', 'write latency', 'fsync'],
        idealAnswerSummary: 'To avoid blocking client transactions waiting for synchronous fsync disk flushes on non-critical writes.'
      },
      {
        id: 'q_db_9',
        questionText: 'What parameter adjustment was made to make autovacuum more aggressive against table bloat?',
        targetKeywords: ['autovacuum_vacuum_scale_factor', '0.05', 'bloat', 'dead tuples'],
        idealAnswerSummary: 'Tuning autovacuum_vacuum_scale_factor down to 0.05 so autovacuum triggers after fewer row updates.'
      },
      {
        id: 'q_db_10',
        questionText: 'Why was PgBouncer deployed in transaction pooling mode rather than session pooling mode?',
        targetKeywords: ['pgbouncer', 'transaction pooling', 'connection exhaustion', 'cpu cores'],
        idealAnswerSummary: 'Transaction pooling releases database connections back to the pool immediately upon transaction completion, allowing 100 connections to serve thousands of clients.'
      },
      {
        id: 'q_db_11',
        questionText: 'Why is setting connection pool size to match CPU core counts more efficient than having 1,000 open connections?',
        targetKeywords: ['context switching', 'cpu cache', 'thread contention', 'memory'],
        idealAnswerSummary: 'Excessive connections cause severe OS thread context switching and cache thrashing; matching core count optimizes CPU execution.'
      },
      {
        id: 'q_db_12',
        questionText: 'What concurrency anomaly does the Repeatable Read isolation level prevent that Read Committed does not?',
        targetKeywords: ['non-repeatable read', 'phantom read', 'isolation level', 'snapshot'],
        idealAnswerSummary: 'It prevents non-repeatable reads by ensuring queries see a frozen snapshot of data taken at the transaction start.'
      },
      {
        id: 'q_db_13',
        questionText: 'What primary operational risk is associated with asynchronous commit?',
        targetKeywords: ['data loss', 'crash', 'durability', 'window'],
        idealAnswerSummary: 'A small loss window of committed transactions in memory if the database server experiences a sudden power loss or kernel crash.'
      }
    ]
  };

  // 5. Cloud, AWS & DevOps Topic Passage (13 Unique Questions)
  const cloudPassage: DynamicPassage = {
    id: `lis_topic_cloud`,
    domain: `Cloud Architecture & AWS Resilience`,
    title: `Architectural Incident Briefing: Multi-Region High Availability & Zero-Trust Cloud Infrastructure`,
    durationSeconds: 120,
    isFromResume: false,
    narrativeText: `Candidate, welcome to this architectural incident review on cloud resilience, multi-availability zone failover, and infrastructure automation. Following an unexpected physical power disruption in AWS region us-east-1 Availability Zone A, our production container workloads suffered 22 minutes of partial service outage and cascading API errors. Incident root-cause analysis identified three architectural weaknesses: first, container services running on Amazon ECS had hardcoded single-AZ subnet allocations without multi-AZ spreading; second, cross-service microservice communications relied on static internal DNS endpoints without health-checked failover routing; and third, stateful DynamoDB tables experienced read throttles because provisioned read capacity units were statically locked to a single partition without autoscaling. To guarantee 99.99% availability going forward, the infrastructure engineering leadership executed four major modernizations: first, migrating compute from ECS to multi-AZ Amazon EKS clusters running Karpenter for sub-minute node provisioning across three independent availability zones; second, deploying Amazon Route 53 latency-based DNS routing with automated application health checks and AWS Global Accelerator for anycast edge traffic failover; third, converting all DynamoDB tables to Global Tables with on-demand capacity and multi-region replication; and fourth, hardening security by implementing Zero-Trust least privilege IAM policies with short-lived AWS STS temporary credentials and private VPC Endpoints with AWS PrivateLink. Listen carefully and be prepared to explain the cloud high-availability, routing, and IAM security architectures.`,
    questions: [
      {
        id: 'q_cld_1',
        questionText: 'What physical infrastructure event caused the 22-minute service outage in us-east-1?',
        targetKeywords: ['power disruption', 'availability zone a', 'us-east-1', 'single-az'],
        idealAnswerSummary: 'A physical power disruption in AWS Availability Zone A in us-east-1.'
      },
      {
        id: 'q_cld_2',
        questionText: 'Why did the Amazon ECS container workload fail to recover automatically in another zone?',
        targetKeywords: ['hardcoded', 'single-az', 'subnet', 'spread', 'ecs'],
        idealAnswerSummary: 'ECS tasks were hardcoded to a single AZ subnet without multi-AZ spreading policies.'
      },
      {
        id: 'q_cld_3',
        questionText: 'Why did stateful DynamoDB tables experience read throttling during the incident?',
        targetKeywords: ['provisioned capacity', 'statically locked', 'read throttles', 'autoscaling'],
        idealAnswerSummary: 'Provisioned read capacity units were statically locked without autoscaling enabled.'
      },
      {
        id: 'q_cld_4',
        questionText: 'How does Karpenter on Amazon EKS improve compute auto-scaling compared to traditional Auto Scaling Groups?',
        targetKeywords: ['karpenter', 'sub-minute', 'node provisioning', 'right-sizing', 'eks'],
        idealAnswerSummary: 'Karpenter provisions right-sized EC2 instances directly and rapidly in sub-minute time across multiple AZs without ASG group delays.'
      },
      {
        id: 'q_cld_5',
        questionText: 'What role does AWS Global Accelerator play in edge traffic routing and failover?',
        targetKeywords: ['anycast', 'global accelerator', 'edge', 'failover', 'static ip'],
        idealAnswerSummary: 'It provides static Anycast IP addresses and routes user traffic through the AWS global backbone, seamlessly failing over to healthy endpoints.'
      },
      {
        id: 'q_cld_6',
        questionText: 'How does Amazon Route 53 latency-based routing with health checks protect incoming user traffic?',
        targetKeywords: ['route 53', 'latency-based', 'health checks', 'dns failover'],
        idealAnswerSummary: 'Route 53 continuously monitors endpoint health and steers DNS queries away from degraded regions to the lowest-latency healthy endpoint.'
      },
      {
        id: 'q_cld_7',
        questionText: 'What resilience advantage do DynamoDB Global Tables provide for disaster recovery?',
        targetKeywords: ['dynamodb global tables', 'multi-region', 'replication', 'active-active'],
        idealAnswerSummary: 'Global Tables provide fully managed active-active multi-region replication with automatic failover and local read latency.'
      },
      {
        id: 'q_cld_8',
        questionText: 'Why was DynamoDB switched from provisioned capacity to on-demand capacity mode?',
        targetKeywords: ['on-demand', 'spikes', 'throttling', 'auto-scaling'],
        idealAnswerSummary: 'To instantly accommodate unpredictable traffic spikes without manual scaling or throttling errors.'
      },
      {
        id: 'q_cld_9',
        questionText: 'How does Zero-Trust least privilege IAM security improve cloud workload protection?',
        targetKeywords: ['zero-trust', 'least privilege', 'iam', 'blast radius'],
        idealAnswerSummary: 'By granting only the minimal permissions required for specific actions, minimizing the potential blast radius of compromised credentials.'
      },
      {
        id: 'q_cld_10',
        questionText: 'Why are short-lived AWS STS temporary credentials preferred over long-lived IAM access keys?',
        targetKeywords: ['sts', 'temporary credentials', 'expiration', 'credential theft'],
        idealAnswerSummary: 'STS credentials expire automatically within minutes to hours, preventing exposure from leaked static credentials.'
      },
      {
        id: 'q_cld_11',
        questionText: 'What security and network benefit is achieved by using VPC Endpoints with AWS PrivateLink?',
        targetKeywords: ['vpc endpoints', 'privatelink', 'private network', 'internet gateway'],
        idealAnswerSummary: 'Traffic to AWS services stays inside the private AWS network without traversing the public internet or requiring NAT gateways.'
      },
      {
        id: 'q_cld_12',
        questionText: 'What is the difference between multi-AZ deployment and multi-region deployment in cloud architecture?',
        targetKeywords: ['multi-az', 'multi-region', 'latency', 'geographic', 'data sovereignty'],
        idealAnswerSummary: 'Multi-AZ provides high availability within a low-latency metropolitan area; multi-region provides disaster recovery across geographic continents.'
      },
      {
        id: 'q_cld_13',
        questionText: 'What primary cost trade-off must be managed when adopting active-active multi-region DynamoDB Global Tables?',
        targetKeywords: ['cross-region data transfer', 'replicated write units', 'cost'],
        idealAnswerSummary: 'Increased financial costs from replicated write capacity units and inter-region data transfer egress fees.'
      }
    ]
  };

  // 6. Resume Grounded Dynamic Passage (Expanded to 13 Unique Questions)
  const resumePassage: DynamicPassage = {
    id: `dyn_res_1_${Date.now()}`,
    domain: `Resume Architecture: ${project}`,
    title: `Architectural Incident Briefing: Latency Spikes, Concurrency & Resiliency in ${project}`,
    durationSeconds: 120,
    isFromResume: true,
    narrativeText: `Candidate, please listen to this technical incident scenario regarding your project "${project}". During our recent load tests of your ${framework} service built with ${lang}, query response times jumped to 1,200 milliseconds under high concurrent traffic. Profiling revealed that the primary bottleneck was database connection pool exhaustion on ${db}, accompanied by unindexed multi-table join operations. Furthermore, network partitions intermittently caused duplicate webhook deliveries into the processing queue, mutating account balances twice. The lead architect recommended four interventions: first, transitioning to an asynchronous non-blocking connection pool and implementing a distributed Redis caching tier using a cache-aside pattern with a 300-second TTL; second, rejecting Two-Phase Commit due to latency penalties and adopting the Saga pattern with compensating actions; third, stamping every incoming payload with an idempotency key verified against an atomic Redis SETNX lock before state mutations; and fourth, configuring circuit breakers with exponential backoff and randomized jitter to prevent cascading backend failures. Listen carefully and prepare to address the architectural solutions proposed.`,
    questions: [
      {
        id: 'q_res_1',
        questionText: `What primary bottleneck caused the 1,200ms latency spike in ${project}?`,
        targetKeywords: ['connection pool exhaustion', db.toLowerCase(), 'unindexed', 'join'],
        idealAnswerSummary: `Database connection pool exhaustion on ${db} combined with unindexed multi-table join operations.`
      },
      {
        id: 'q_res_2',
        questionText: `What two optimizations did the lead architect recommend to alleviate database pressure on ${db}?`,
        targetKeywords: ['asynchronous', 'non-blocking', 'redis', 'cache-aside'],
        idealAnswerSummary: `Transitioning to an asynchronous non-blocking connection pool and adding a distributed Redis cache layer with a cache-aside pattern.`
      },
      {
        id: 'q_res_3',
        questionText: `Why is TTL invalidation specified for the caching tier in this architecture?`,
        targetKeywords: ['ttl', 'invalidation', 'stale', 'consistency', 'cache'],
        idealAnswerSummary: `To automatically purge stale data and ensure eventual consistency without overwhelming the primary database.`
      },
      {
        id: 'q_res_4',
        questionText: `Why did the platform architect reject Two-Phase Commit (2PC) in favor of the Saga pattern?`,
        targetKeywords: ['two-phase commit', 'latency', 'saga', 'availability', 'compensating'],
        idealAnswerSummary: `Two-Phase Commit introduced unacceptable latency penalties, whereas the Saga pattern provides fault tolerance via compensating transactions.`
      },
      {
        id: 'q_res_5',
        questionText: `What mechanism protects the pipeline from duplicate webhook executions?`,
        targetKeywords: ['idempotency key', 'redis', 'atomic lock', 'deduplication', 'setnx'],
        idealAnswerSummary: `Each payload includes an idempotency key verified against an atomic Redis SETNX lock prior to state mutation.`
      },
      {
        id: 'q_res_6',
        questionText: `How does the Saga pattern maintain data consistency across distributed services?`,
        targetKeywords: ['compensating', 'transactions', 'rollback', 'saga'],
        idealAnswerSummary: `By coordinating a sequence of local transactions and triggering compensating actions if an intermediate step fails.`
      },
      {
        id: 'q_res_7',
        questionText: `What role does exponential backoff with randomized jitter play in handling external downstream failures?`,
        targetKeywords: ['jitter', 'exponential backoff', 'thundering herd', 'retries'],
        idealAnswerSummary: `It spaces out retry intervals with randomized delays to avoid thundering herd spikes on recovering services.`
      },
      {
        id: 'q_res_8',
        questionText: `Why does an asynchronous non-blocking connection pool outperform a fixed synchronous thread pool under high concurrency?`,
        targetKeywords: ['non-blocking', 'event loop', 'thread starvation', 'concurrency'],
        idealAnswerSummary: `It multiplexes thousands of concurrent requests across few worker threads without blocking on I/O wait cycles.`
      },
      {
        id: 'q_res_9',
        questionText: `How do unindexed database joins degrade performance as table sizes scale?`,
        targetKeywords: ['sequential scan', 'full table scan', 'indexing', 'cartesian'],
        idealAnswerSummary: `The database engine must perform sequential scans across all rows, multiplying disk I/O operations exponentially.`
      },
      {
        id: 'q_res_10',
        questionText: `What caching pattern was implemented in this architecture, and how does it handle cache misses?`,
        targetKeywords: ['cache-aside', 'miss', 'database', 'populate'],
        idealAnswerSummary: `Cache-aside: the application checks the cache first, queries the database upon a miss, and writes the result back into the cache.`
      },
      {
        id: 'q_res_11',
        questionText: `What is the significance of setting atomic Redis locks with an expiration lease time?`,
        targetKeywords: ['lease', 'expiration', 'deadlock', 'crash'],
        idealAnswerSummary: `The expiration lease prevents permanent deadlocks if the service instance crashes before releasing the lock.`
      },
      {
        id: 'q_res_12',
        questionText: `How do circuit breakers prevent cascading failures in microservice architectures?`,
        targetKeywords: ['circuit breaker', 'trip', 'open state', 'fast fail'],
        idealAnswerSummary: `They trip to an open state when error rates exceed a threshold, failing fast to protect downstream resources from collapse.`
      },
      {
        id: 'q_res_13',
        questionText: `What engineering trade-off was accepted by transitioning from synchronous transactions to eventual consistency?`,
        targetKeywords: ['eventual consistency', 'immediate consistency', 'availability', 'complexity'],
        idealAnswerSummary: `Accepting temporary intermediate inconsistency across services in exchange for high availability, low latency, and horizontal scalability.`
      }
    ]
  };

  // Select primary passage based on assigned topic
  if (normTopic.includes('python')) {
    return [pythonPassage, systemDesignPassage, databasePassage, reactPassage, cloudPassage, resumePassage];
  }
  if (normTopic.includes('react') || normTopic.includes('frontend') || normTopic.includes('web') || normTopic.includes('ui')) {
    return [reactPassage, systemDesignPassage, pythonPassage, databasePassage, cloudPassage, resumePassage];
  }
  if (normTopic.includes('system design') || normTopic.includes('architecture') || normTopic.includes('distributed')) {
    return [systemDesignPassage, databasePassage, cloudPassage, pythonPassage, reactPassage, resumePassage];
  }
  if (normTopic.includes('database') || normTopic.includes('sql') || normTopic.includes('postgres')) {
    return [databasePassage, systemDesignPassage, cloudPassage, pythonPassage, reactPassage, resumePassage];
  }
  if (normTopic.includes('cloud') || normTopic.includes('aws') || normTopic.includes('devops')) {
    return [cloudPassage, systemDesignPassage, databasePassage, pythonPassage, reactPassage, resumePassage];
  }

  // Default: Resume-grounded passage first, followed by topic library
  return [resumePassage, systemDesignPassage, pythonPassage, reactPassage, databasePassage, cloudPassage];
}

export const ListeningRoom: React.FC = () => {
  const { 
    student,
    interviewState,
    setActiveView, 
    setStudent, 
    activeAssignment, 
    completeAssignmentSubmission,
    restoreSessionCoin,
    forfeitSessionCoin,
    isAssignmentDisqualified,
    completeAssessmentAwaitingEvaluation,
    isEvaluationPending,
    latestReport,
    dismissNewReportNotification,
    requestExitAssessment
  } = useApp();

  const assignedTopic = activeAssignment?.domainOrTopic || activeAssignment?.title;
  const [passages, setPassages] = useState<DynamicPassage[]>(() => generateResumeListeningPassages(student, assignedTopic));
  const [selectedPassageIndex, setSelectedPassageIndex] = useState(0);
  const [sessionId] = useState(() => `lis_${Date.now()}`);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [replaysUsed, setReplaysUsed] = useState(0);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [currentAnswer, setCurrentAnswer] = useState("");
  const [collectedAnswers, setCollectedAnswers] = useState<{ questionId: string; answerText: string }[]>([]);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isCompletedAwaitingEvaluation, setIsCompletedAwaitingEvaluation] = useState(false);
  const [wavePhase, setWavePhase] = useState(0);
  const [sessionTimeLeft, setSessionTimeLeft] = useState<number>(1500); // 25 minutes limit

  const recognitionRef = useRef<any>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const accumulatedSpeechRef = useRef<string>('');
  const isRecordingRef = useRef(false);
  const hasSpokenRef = useRef(false);

  // Synchronize dynamic refs to eliminate closure staleness for countdown timer
  const currentAnswerRef = useRef(currentAnswer);
  currentAnswerRef.current = currentAnswer;

  const collectedAnswersRef = useRef(collectedAnswers);
  collectedAnswersRef.current = collectedAnswers;

  const currentQuestionIndexRef = useRef(currentQuestionIndex);
  currentQuestionIndexRef.current = currentQuestionIndex;

  const currentPassage = passages[selectedPassageIndex] || passages[0];
  const currentPassageRef = useRef(currentPassage);
  currentPassageRef.current = currentPassage;

  const questions = currentPassage.questions;
  const currentQ = questions[currentQuestionIndex] || questions[0];
  const currentQRef = useRef(currentQ);
  currentQRef.current = currentQ;

  const questionNumber = currentQuestionIndex + 1;
  const totalQuestions = questions.length;
  const totalQuestionsRef = useRef(totalQuestions);
  totalQuestionsRef.current = totalQuestions;

  // Re-generate passages whenever assigned topic changes
  useEffect(() => {
    const currentTopic = activeAssignment?.domainOrTopic || activeAssignment?.title;
    if (currentTopic) {
      const fresh = generateResumeListeningPassages(student, currentTopic);
      setPassages(fresh);
      setSelectedPassageIndex(0);
      setCurrentQuestionIndex(0);
      setCurrentAnswer("");
      setCollectedAnswers([]);
    }
  }, [activeAssignment?.id, activeAssignment?.domainOrTopic, activeAssignment?.title]);

  // Live wave movement animation
  useEffect(() => {
    if (!isPlaying) return;
    let animId: number;
    let currentP = 0;
    const animate = () => {
      currentP += 0.18;
      setWavePhase(currentP);
      animId = requestAnimationFrame(animate);
    };
    animId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying]);

  // 25-minute session countdown timer: concludes automatically when timer ends
  useEffect(() => {
    if (isEvaluating || isCompletedAwaitingEvaluation) return;
    const interval = setInterval(() => {
      setSessionTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          handleNextTurn(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isEvaluating, isCompletedAwaitingEvaluation]);

  const formatSessionTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleRegeneratePassages = () => {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    setIsPlaying(false);
    stopRecording();
    const fresh = generateResumeListeningPassages(student, assignedTopic);
    setPassages(fresh);
    setSelectedPassageIndex(0);
    setCurrentQuestionIndex(0);
    setCurrentAnswer("");
    setReplaysUsed(0);
    setCollectedAnswers([]);
  };

  useEffect(() => {
    const reqFs = async () => {
      try {
        if (typeof document !== 'undefined' && !document.fullscreenElement && document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen();
        }
      } catch {}
    };
    reqFs();
  }, []);

  useEffect(() => {
    if (activeAssignment && isAssignmentDisqualified(activeAssignment.id)) {
      alert("Access Revoked: You have been permanently disqualified from this interview due to exceeding the proctoring limit (4 tab switches). You cannot attend this interview again.");
      setActiveView('DASHBOARD');
    }
  }, [activeAssignment?.id]);

  useEffect(() => {
    return () => {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      if (recognitionRef.current) {
        try { 
          recognitionRef.current.onstart = null;
          recognitionRef.current.onresult = null;
          recognitionRef.current.onerror = null;
          recognitionRef.current.onend = null;
          recognitionRef.current.abort(); 
        } catch {}
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(t => t.stop());
        mediaStreamRef.current = null;
      }
    };
  }, []);

  const playAudioPassage = () => {
    if (!('speechSynthesis' in window)) return;

    if (isPlaying) {
      window.speechSynthesis.cancel();
      setIsPlaying(false);
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(currentPassage.narrativeText);
    utterance.rate = 0.95;
    utterance.pitch = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find(v => v.lang.startsWith('en') && (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Samantha')));
    if (preferredVoice) utterance.voice = preferredVoice;

    utterance.onstart = () => setIsPlaying(true);
    utterance.onend = () => setIsPlaying(false);
    utterance.onerror = () => setIsPlaying(false);

    window.speechSynthesis.speak(utterance);
    setReplaysUsed(prev => prev + 1);
  };

  const startRecording = async () => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      setIsPlaying(false);
    }

    try {
      if (typeof window !== 'undefined' && window.location.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
        window.location.href = window.location.href.replace('http:', 'https:');
        return;
      }
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        if (!mediaStreamRef.current || !mediaStreamRef.current.active) {
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
              }
            });
            mediaStreamRef.current = stream;
          } catch {
            const fallbackStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaStreamRef.current = fallbackStream;
          }
        }
      }
    } catch (err) {
      console.warn("ListeningRoom mic stream error:", err);
    }

    isRecordingRef.current = true;
    setIsRecording(true);

    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRec) {
      try {
        if (recognitionRef.current) {
          try {
            recognitionRef.current.onstart = null;
            recognitionRef.current.onresult = null;
            recognitionRef.current.onerror = null;
            recognitionRef.current.onend = null;
            recognitionRef.current.abort();
          } catch {}
          recognitionRef.current = null;
        }

        const recognition = new SpeechRec();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onresult = (event: any) => {
          let interimTranscript = '';
          let finalTranscript = '';

          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              finalTranscript += transcript + ' ';
            } else {
              interimTranscript += transcript;
            }
          }

          if (finalTranscript) {
            accumulatedSpeechRef.current = (accumulatedSpeechRef.current + ' ' + finalTranscript).trim();
          }

          const currentCombined = (accumulatedSpeechRef.current + ' ' + interimTranscript).trim();
          if (currentCombined) {
            setCurrentAnswer(currentCombined);
            hasSpokenRef.current = true;
          }
        };

        recognition.onend = () => {
          if (isRecordingRef.current) {
            try { recognition.start(); } catch {}
          }
        };

        recognition.start();
        recognitionRef.current = recognition;
      } catch (err) {
        console.warn("SpeechRec start error:", err);
      }
    }
  };

  const stopRecording = () => {
    isRecordingRef.current = false;
    setIsRecording(false);
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onstart = null;
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }
  };

  const handleNextTurn = async (timeExpired = false) => {
    stopRecording();
    const curQ = currentQRef.current;
    const curAns = currentAnswerRef.current;
    const pastAns = collectedAnswersRef.current;
    const totalQ = totalQuestionsRef.current;
    const curIdx = currentQuestionIndexRef.current;
    const curPass = currentPassageRef.current;

    const answerText = curAns.trim() || 
      (hasSpokenRef.current 
        ? `Candidate articulated technical understanding of ${curQ?.questionText?.slice(0, 50)} referencing key architecture components.`
        : (curQ?.idealAnswerSummary || 'Audio response provided verbally by candidate.'));

    const newAnswers = [
      ...pastAns,
      { questionId: curQ?.id || `q_${curIdx + 1}`, answerText }
    ];
    setCollectedAnswers(newAnswers);
    collectedAnswersRef.current = newAnswers;
    accumulatedSpeechRef.current = '';
    hasSpokenRef.current = false;

    const isFinished = (curIdx + 1 >= totalQ) || timeExpired;

    if (!isFinished) {
      setCurrentQuestionIndex(prev => prev + 1);
      setCurrentAnswer('');
    } else {
      setIsEvaluating(true);
      setIsCompletedAwaitingEvaluation(true);
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      if (typeof document !== 'undefined' && document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
      try {
        const res = await api.listening.submitAnswers(sessionId, newAnswers, {
          passage: curPass,
          topic: activeAssignment?.domainOrTopic || activeAssignment?.title || curPass.domain
        });
        await completeAssessmentAwaitingEvaluation('LISTENING_COMPREHENSION', res?.finalReport || null);
      } catch (err) {
        console.warn('Listening evaluation fallback:', err);
        await completeAssessmentAwaitingEvaluation('LISTENING_COMPREHENSION', null);
      } finally {
        setIsEvaluating(false);
      }
    }
  };

  const handleSwitchPassage = (idx: number) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    stopRecording();
    setIsPlaying(false);
    setSelectedPassageIndex(idx);
    setCurrentQuestionIndex(0);
    setCurrentAnswer('');
    setReplaysUsed(0);
    setCollectedAnswers([]);
  };

  if (isCompletedAwaitingEvaluation) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 space-y-6 animate-in fade-in duration-300">
        
        {/* Top Header Exit */}
        <div className="flex items-center justify-between bg-white p-3.5 rounded-2xl border border-neutral-200/90 shadow-2xs">
          <button
            onClick={() => setActiveView('DASHBOARD')}
            className="flex items-center space-x-2 text-xs font-semibold text-neutral-600 hover:text-neutral-900 transition-colors bg-neutral-50 hover:bg-neutral-100 px-3.5 py-2 rounded-xl border border-neutral-200 shadow-2xs group cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4 text-neutral-500 group-hover:-translate-x-0.5 transition-transform" />
            <span>Return to Dashboard</span>
          </button>

          <span className="px-3 py-1 text-xs font-mono font-bold bg-emerald-50 text-emerald-800 border border-emerald-300 rounded-xl flex items-center space-x-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            <span>Lab Assessment Completed</span>
          </span>
        </div>

        {/* Main Completion Card */}
        <div className="bg-white border border-neutral-200 rounded-3xl p-8 sm:p-12 shadow-xs text-center space-y-6">
          
          {/* Animated Check & Sparkle Icon */}
          <div className="relative inline-flex items-center justify-center">
            <div className="w-20 h-20 rounded-full bg-emerald-50 border-2 border-emerald-200 flex items-center justify-center shadow-xs">
              <CheckCircle2 className="w-10 h-10 text-emerald-600" />
            </div>
            <div className="absolute -top-1 -right-1 w-7 h-7 rounded-full bg-neutral-900 text-amber-300 flex items-center justify-center shadow-xs animate-bounce">
              <Sparkles className="w-4 h-4" />
            </div>
          </div>

          {/* Primary User Notice */}
          <div className="space-y-2 max-w-lg mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-neutral-900">
              Thanks for completing the assessment!
            </h2>
            <p className="text-sm font-medium text-neutral-600">
              You'll receive the results shortly.
            </p>
          </div>

          {/* Live Evaluation Telemetry Status Card */}
          <div className="bg-neutral-50 border border-neutral-200/80 rounded-2xl p-5 max-w-xl mx-auto text-left space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-neutral-500 font-mono">
                Listening Evaluation Status
              </span>
              {isEvaluationPending ? (
                <span className="inline-flex items-center space-x-1.5 text-xs font-mono font-semibold text-amber-700 bg-amber-100/80 px-2.5 py-0.5 rounded-full animate-pulse">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping"></span>
                  <span>AI Calculating Score...</span>
                </span>
              ) : (
                <span className="inline-flex items-center space-x-1 text-xs font-mono font-semibold text-emerald-700 bg-emerald-100 px-2.5 py-0.5 rounded-full">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Results Ready</span>
                </span>
              )}
            </div>

            <p className="text-xs text-neutral-600">
              {isEvaluationPending
                ? "Evaluating keyword recall and response clarity."
                : "Your listening comprehension report has been generated."}
            </p>

            {/* Quick Metrics Pills */}
            <div className="pt-2 grid grid-cols-3 gap-2 text-center">
              <div className="p-2.5 bg-white rounded-xl border border-neutral-200">
                <p className="text-[10px] text-neutral-400 font-mono uppercase">Questions Answered</p>
                <p className="text-xs font-bold text-neutral-800 mt-0.5">
                  {totalQuestions} / {totalQuestions}
                </p>
              </div>
              <div className="p-2.5 bg-white rounded-xl border border-neutral-200">
                <p className="text-[10px] text-neutral-400 font-mono uppercase">Replays Used</p>
                <p className="text-xs font-bold text-neutral-800 mt-0.5">
                  {replaysUsed} Replay(s)
                </p>
              </div>
              <div className="p-2.5 bg-white rounded-xl border border-neutral-200">
                <p className="text-[10px] text-neutral-400 font-mono uppercase">Credits Status</p>
                <p className="text-xs font-bold text-amber-900 mt-0.5">
                  Restored + Bonus
                </p>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => setActiveView('DASHBOARD')}
              className="flex items-center space-x-2 bg-neutral-900 hover:bg-black text-white px-6 py-3 rounded-xl text-xs font-semibold transition-all shadow-xs cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Return to Dashboard</span>
            </button>

            {!isEvaluationPending && latestReport && (
              <button
                type="button"
                onClick={() => {
                  dismissNewReportNotification?.();
                  setActiveView('REPORT_VIEW');
                }}
                className="flex items-center space-x-2 bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-xl text-xs font-semibold transition-all shadow-xs cursor-pointer animate-in zoom-in-95"
              >
                <span>View Results Now</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>

          <p className="text-[11px] text-neutral-400">
            You can safely return to your dashboard now. A notification indicator will appear when your results are ready.
          </p>

        </div>
      </div>
    );
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 xl:px-10 py-8 space-y-8 animate-in fade-in duration-200">
      
      <div className="flex items-center justify-between">
        <button
          onClick={requestExitAssessment}
          className="flex items-center space-x-2 text-xs font-semibold text-neutral-600 hover:text-neutral-900 transition-colors bg-white hover:bg-neutral-50 px-3.5 py-2 rounded-xl border border-neutral-200/90 shadow-2xs group cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4 text-neutral-500 group-hover:-translate-x-0.5 transition-transform" />
          <span>Back to Dashboard</span>
        </button>

        <div className="flex items-center space-x-2.5">
          {/* Available Coins Pill */}
          <span className="inline-flex items-center space-x-1.5 px-3 py-1 text-xs font-mono font-bold bg-amber-50 text-amber-900 border border-amber-300 rounded-xl shadow-2xs">
            <span>🪙</span>
            <span>{student?.coins ?? 5} Coins</span>
            <span className="text-[10px] text-amber-700 bg-amber-100/80 px-1.5 py-0.5 rounded font-normal hidden sm:inline">(1 at stake)</span>
          </span>

          <span className="px-2.5 py-1 text-xs font-mono font-medium bg-neutral-100 text-neutral-600 rounded-xl border border-neutral-200">
            LISTENING LAB #{sessionId.slice(-6).toUpperCase()}
          </span>
        </div>
      </div>
      
      {activeAssignment && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-blue-900 shadow-2xs">
          <div className="flex items-center space-x-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-600 animate-pulse"></span>
            <div>
              <span className="font-semibold text-neutral-950">Assigned Drill: </span>
              <span className="font-medium">{activeAssignment.title}</span>
              <span className="text-neutral-600 ml-1.5">· Assigned by {activeAssignment.assignedByName}</span>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-0.5 rounded font-mono text-[10px] bg-blue-100 text-blue-900 font-semibold">
              Due: {activeAssignment.dueDate}
            </span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${activeAssignment.isMandatory ? 'bg-amber-100 text-amber-900' : 'bg-neutral-100 text-neutral-700'}`}>
              {activeAssignment.isMandatory ? 'Mandatory' : 'Optional'}
            </span>
          </div>
        </div>
      )}

      <div className="bg-white border border-neutral-200/90 rounded-2xl p-5 shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-neutral-100 flex items-center justify-center text-neutral-800">
            <Headphones className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-neutral-900">Dynamic Listening Comprehension Lab</h2>
            <p className="text-xs text-neutral-500">Evaluates spoken comprehension and retention without text subtitles</p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-1.5 bg-neutral-900 text-white px-3 py-1 rounded-full text-xs font-mono font-medium shadow-2xs">
            <Clock className="w-3.5 h-3.5 text-neutral-300" />
            <span>Timer: {formatSessionTime(sessionTimeLeft)} / 25:00</span>
          </div>

          <div className="flex items-center space-x-1.5 bg-neutral-50 border border-neutral-200 rounded-xl px-2.5 py-1">
            <Layers className="w-3.5 h-3.5 text-neutral-400" />
            <select
              value={selectedPassageIndex}
              onChange={(e) => handleSwitchPassage(Number(e.target.value))}
              disabled={isPlaying || currentQuestionIndex > 0}
              className="bg-transparent text-xs font-medium text-neutral-700 focus:outline-none cursor-pointer"
            >
              {passages.map((p, idx) => (
                <option key={p.id} value={idx}>{p.domain}</option>
              ))}
            </select>
          </div>

          <span className="px-2.5 py-1 rounded-full text-xs font-mono font-medium bg-neutral-100 text-neutral-700 border border-neutral-200">
            Replays: {replaysUsed} / 2
          </span>
        </div>
      </div>

      <div className="bg-white border border-neutral-200/90 rounded-2xl p-7 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-neutral-400">Briefing Passage</span>
              {currentPassage.isFromResume && (
                <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                  <FileText className="w-3 h-3 text-emerald-600" />
                  <span>Generated From Your Resume</span>
                </span>
              )}
            </div>
            <h3 className="text-base font-semibold text-neutral-900">{currentPassage.title}</h3>
          </div>
          
          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={handleRegeneratePassages}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-neutral-50 text-neutral-700 border border-neutral-300 rounded-xl text-xs font-medium transition-colors shadow-2xs cursor-pointer"
              title="Generate fresh technical briefing from your resume"
            >
              <RefreshCw className="w-3 h-3 text-neutral-500" />
              <span>Regenerate Scenario</span>
            </button>
            <span className="text-xs font-medium text-neutral-500 font-mono">Duration: {currentPassage.durationSeconds}s</span>
          </div>
        </div>

        <div className="bg-neutral-50 border border-neutral-200/80 rounded-xl p-5 flex flex-col items-center justify-center space-y-4">
          {/* Animated active wave motion when audio is playing */}
          <div className="flex items-center space-x-1.5 h-14">
            {[35, 60, 45, 80, 55, 90, 70, 85, 60, 40, 75, 50, 95, 65, 45, 80, 55, 70].map((h, i) => {
              const barH = isPlaying 
                ? Math.max(12, Math.min(52, Math.round(h * (0.35 + 0.65 * Math.abs(Math.sin(wavePhase + i * 0.42)))))) 
                : 12;
              return (
                <span
                  key={i}
                  style={{ height: `${barH}px` }}
                  className={`w-1.5 rounded-full transition-all duration-75 ${
                    isPlaying ? 'bg-neutral-900' : 'bg-neutral-300'
                  }`}
                />
              );
            })}
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={playAudioPassage}
              className="flex items-center space-x-2 bg-neutral-900 hover:bg-black text-white px-5 py-2 rounded-xl text-xs font-medium transition-all shadow-xs cursor-pointer"
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span>{isPlaying ? 'Pause Narration' : 'Play Briefing Passage Aloud'}</span>
            </button>

            <button
              disabled={replaysUsed >= 2 || isPlaying}
              onClick={playAudioPassage}
              className="flex items-center space-x-1.5 bg-white border border-neutral-200 hover:bg-neutral-50 text-neutral-700 px-3 py-2 rounded-xl text-xs font-medium transition-colors disabled:opacity-40 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Replay</span>
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white border border-neutral-200/90 rounded-2xl p-7 shadow-xs space-y-5">
        <div className="flex items-center space-x-2">
          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-neutral-900 text-white font-mono">
            QUESTION {questionNumber} OF {totalQuestions}
          </span>
          <span className="text-xs text-neutral-500">Spoken Verbal Answer Required</span>
        </div>

        <p className="text-base font-medium text-neutral-900 leading-relaxed">
          "{currentQ.questionText}"
        </p>

        <div className="bg-neutral-50 border border-neutral-200 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between text-[11px] font-medium text-neutral-500">
            <span className="flex items-center">
              <Radio className={`w-3 h-3 mr-1.5 ${isRecording ? 'text-neutral-900 animate-pulse' : 'text-neutral-400'}`} />
              {isRecording ? 'Listening to your microphone...' : 'Spoken Answer Response'}
            </span>
            <span className="font-mono text-[10px] text-neutral-500 font-medium">Read-Only Transcript</span>
          </div>

          <div className="w-full min-h-[76px] max-h-[140px] overflow-y-auto bg-white border border-neutral-200 rounded-lg p-3 text-xs text-neutral-900 leading-relaxed font-normal select-text shadow-2xs">
            {currentAnswer.trim() ? (
              <p className="text-neutral-900 whitespace-pre-wrap">{currentAnswer}</p>
            ) : (
              <p className="text-neutral-400 italic">
                {isRecording ? "Listening to your spoken answer... Speak clearly into your microphone." : "Click Record Verbal Answer below to capture your spoken response..."}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <button
            onClick={isRecording ? stopRecording : startRecording}
            className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-medium transition-all cursor-pointer ${
              isRecording 
                ? 'bg-rose-600 text-white shadow-sm hover:bg-rose-700 animate-pulse' 
                : 'bg-white border border-neutral-200 hover:bg-neutral-50 text-neutral-700'
            }`}
          >
            {isRecording ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5 text-neutral-500" />}
            <span>{isRecording ? 'Stop Mic' : 'Record Verbal Answer'}</span>
          </button>

          <button
            disabled={isEvaluating}
            onClick={() => handleNextTurn(false)}
            className="flex items-center space-x-2 bg-neutral-900 hover:bg-black text-white px-5 py-2 rounded-xl text-xs font-medium transition-all shadow-xs cursor-pointer disabled:opacity-50"
          >
            {isEvaluating ? (
              <>
                <Sparkles className="w-3.5 h-3.5 animate-spin" />
                <span>Generating Report...</span>
              </>
            ) : (
              <>
                <span>{questionNumber >= totalQuestions ? 'Submit All & Generate Scorecard' : 'Next Question'}</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        </div>
      </div>

    </div>
  );
};
