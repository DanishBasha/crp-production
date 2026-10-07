-- Development seed disabled: clean production mode. Dummy data removed.
DO $$ BEGIN
  RAISE NOTICE 'Migration 037: Development seed charlie bypassed (dummy data removed).';
END $$;
