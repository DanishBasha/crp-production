-- Migration 122: Add type column to org.institutions for campus/institution type
ALTER TABLE org.institutions ADD COLUMN IF NOT EXISTS type VARCHAR(255) DEFAULT 'COLLEGE';
