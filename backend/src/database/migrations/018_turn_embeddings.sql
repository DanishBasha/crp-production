-- Migration 018: pgvector interview embeddings for long-term semantic retrieval
-- Stores summarized turn content per session so the LLM can retrieve
-- semantically relevant past context across turns.
--
-- Dimensions: 384 (all-MiniLM-L6-v2, local, no API key required)
-- Index: HNSW (better recall than IVFFlat; works immediately with any row count)

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector extension not installed on this system; using fallback FLOAT8[] array.';
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vector') THEN
    CREATE TABLE IF NOT EXISTS session.interview_embeddings (
        id                 BIGSERIAL   PRIMARY KEY,
        session_id         UUID        NOT NULL,
        speaker            VARCHAR(10) NOT NULL DEFAULT 'candidate', -- 'candidate' | 'interviewer'
        topic_tag          VARCHAR(50),
        turn_number        INTEGER,
        summarized_content TEXT        NOT NULL,
        embedding          vector(384),
        created_at         TIMESTAMPTZ DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_interview_embeddings_hnsw
        ON session.interview_embeddings
        USING hnsw (embedding vector_cosine_ops);
  ELSE
    CREATE TABLE IF NOT EXISTS session.interview_embeddings (
        id                 BIGSERIAL   PRIMARY KEY,
        session_id         UUID        NOT NULL,
        speaker            VARCHAR(10) NOT NULL DEFAULT 'candidate',
        topic_tag          VARCHAR(50),
        turn_number        INTEGER,
        summarized_content TEXT        NOT NULL,
        embedding          FLOAT8[],
        created_at         TIMESTAMPTZ DEFAULT now()
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_interview_embeddings_session
    ON session.interview_embeddings (session_id);
