-- Migration 124: Independent Candidates Table & Credits Persistence
-- Stores independent candidate profiles and guarantees credit balance persistence

CREATE SCHEMA IF NOT EXISTS candidate;

CREATE TABLE IF NOT EXISTS candidate.independent_candidates (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID        NOT NULL UNIQUE REFERENCES identity.users(id) ON DELETE CASCADE,
    name              VARCHAR(255) NOT NULL,
    email             VARCHAR(255) NOT NULL UNIQUE,
    phone             VARCHAR(50),
    credits           INT         NOT NULL DEFAULT 5 CHECK (credits >= 0),
    target_role       VARCHAR(255) DEFAULT 'Full Stack Developer',
    experience_level  VARCHAR(50) DEFAULT 'Fresher / Entry Level',
    resume_url        TEXT,
    resume_data       JSONB       NOT NULL DEFAULT '{}'::jsonb,
    coding_handles    JSONB       NOT NULL DEFAULT '{"leetcode": null, "leetcodeSolved": 0, "github": null, "githubRepos": 0}'::jsonb,
    zero_credits_at   TIMESTAMPTZ,
    status            VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_indep_cand_email ON candidate.independent_candidates (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_indep_cand_user_id ON candidate.independent_candidates (user_id);

-- Also provide schema compatibility in org schema
CREATE OR REPLACE VIEW org.independent_candidates AS
SELECT * FROM candidate.independent_candidates;

-- Ensure org.students coins column exists and defaults to 5
ALTER TABLE org.students ADD COLUMN IF NOT EXISTS coins INT NOT NULL DEFAULT 5;
