-- Development seed disabled: clean production mode. Dummy data removed.
DO $$ BEGIN
  RAISE NOTICE 'Migration 036: Development seed bypassed (dummy data removed).';
END $$;
