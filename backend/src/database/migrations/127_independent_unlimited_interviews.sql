-- Migration 127: Independent Candidates Unlimited Access
-- Ensures independent candidates are not bound to institutions and have unlimited practice access.

UPDATE identity.users 
SET institution_id = NULL 
WHERE id IN (SELECT user_id FROM candidate.independent_candidates);

UPDATE org.students 
SET program_id = NULL, batch_id = NULL, subdivision_id = NULL, coins = 999 
WHERE user_id IN (SELECT user_id FROM candidate.independent_candidates);
