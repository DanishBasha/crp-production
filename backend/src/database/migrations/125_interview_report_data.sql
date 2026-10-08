-- The full diagnostic report of each live mock interview (every question with its score,
-- the key points covered and missed, evaluator notes and delivery metrics), stored with
-- the attempt. Until now only the headline scores were kept.

ALTER TABLE performance.assessment_reports ADD COLUMN IF NOT EXISTS report_data JSONB;
