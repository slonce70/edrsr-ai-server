-- Purpose: Clear Supabase warnings like "RLS disabled in Public" safely.
-- Strategy:
-- 1) Enable RLS only on public tables where it is currently disabled.
-- 2) If a table has a UUID `user_id` column, add owner-scoped CRUD policies.
--    Otherwise, allow SELECT for everyone and restrict writes to `service_role`.
-- Notes: No data is modified, no columns made NOT NULL. Idempotent policy creation.

-- Inspect which tables are currently disabled (for reference)
-- SELECT n.nspname AS schema, c.relname AS table, c.relrowsecurity AS rls_enabled,
--        (SELECT COUNT(*) FROM pg_policies p WHERE p.schemaname=n.nspname AND p.tablename=c.relname) AS policy_count
-- FROM pg_class c
-- JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname='public' AND c.relkind IN ('r','p')
-- ORDER BY 1,2;

DO $$
DECLARE
  r RECORD;
  has_user_id_uuid boolean;
  sch text := 'public';
BEGIN
  FOR r IN
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = sch AND c.relkind IN ('r','p') AND NOT c.relrowsecurity
  LOOP
    -- Enable RLS on the table
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY;', sch, r.table_name);

    -- Detect uuid user_id column
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = sch AND table_name = r.table_name
        AND column_name = 'user_id' AND data_type = 'uuid'
    ) INTO has_user_id_uuid;

    IF has_user_id_uuid THEN
      -- Ensure DEFAULT auth.uid() to help inserts (best-effort, ignore failure)
      BEGIN
        EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN user_id SET DEFAULT auth.uid();', sch, r.table_name);
      EXCEPTION WHEN others THEN
        -- ignore if not applicable
      END;

      -- Index for performance (best-effort)
      BEGIN
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.%I(user_id);',
                       'idx_' || r.table_name || '_user_id', sch, r.table_name);
      EXCEPTION WHEN others THEN
        -- ignore if index exists with another name
      END;

      -- Owner-scoped policies (create only if missing). Use (select ...) wrappers for initplan perf
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = sch AND tablename = r.table_name AND policyname = r.table_name || '_select_own'
      ) THEN
        EXECUTE format(
          'CREATE POLICY %I ON %I.%I FOR SELECT USING (user_id = (select auth.uid()) OR (select auth.role()) = ''service_role'');',
          r.table_name || '_select_own', sch, r.table_name
        );
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = sch AND tablename = r.table_name AND policyname = r.table_name || '_insert_own'
      ) THEN
        EXECUTE format(
          'CREATE POLICY %I ON %I.%I FOR INSERT WITH CHECK (user_id = (select auth.uid()) OR (select auth.role()) = ''service_role'');',
          r.table_name || '_insert_own', sch, r.table_name
        );
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = sch AND tablename = r.table_name AND policyname = r.table_name || '_update_own'
      ) THEN
        EXECUTE format(
          'CREATE POLICY %I ON %I.%I FOR UPDATE USING (user_id = (select auth.uid()) OR (select auth.role()) = ''service_role'') WITH CHECK (user_id = (select auth.uid()) OR (select auth.role()) = ''service_role'');',
          r.table_name || '_update_own', sch, r.table_name
        );
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = sch AND tablename = r.table_name AND policyname = r.table_name || '_delete_own'
      ) THEN
        EXECUTE format(
          'CREATE POLICY %I ON %I.%I FOR DELETE USING (user_id = (select auth.uid()) OR (select auth.role()) = ''service_role'');',
          r.table_name || '_delete_own', sch, r.table_name
        );
      END IF;

    ELSE
      -- Shared/lookup tables: allow read for everyone, writes only by service_role.
      -- Avoid multiple permissive policies on SELECT by scoping write policies to non-SELECT actions.
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = sch AND tablename = r.table_name AND policyname = r.table_name || '_read_all'
      ) THEN
        EXECUTE format(
          'CREATE POLICY %I ON %I.%I FOR SELECT USING (true);',
          r.table_name || '_read_all', sch, r.table_name
        );
      END IF;

      -- Drop legacy ALL-action write policy if present to prevent multiple permissive SELECT policies
      IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = sch AND tablename = r.table_name AND policyname = r.table_name || '_write_service_role'
      ) THEN
        EXECUTE format('DROP POLICY %I ON %I.%I;', r.table_name || '_write_service_role', sch, r.table_name);
      END IF;

      -- Create write policies per action gated to service_role. Use (select ...) wrapper for perf.
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = sch AND tablename = r.table_name AND policyname = r.table_name || '_ins_service_role'
      ) THEN
        EXECUTE format(
          'CREATE POLICY %I ON %I.%I FOR INSERT WITH CHECK ((select auth.role()) = ''service_role'');',
          r.table_name || '_ins_service_role', sch, r.table_name
        );
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = sch AND tablename = r.table_name AND policyname = r.table_name || '_upd_service_role'
      ) THEN
        EXECUTE format(
          'CREATE POLICY %I ON %I.%I FOR UPDATE USING ((select auth.role()) = ''service_role'') WITH CHECK ((select auth.role()) = ''service_role'');',
          r.table_name || '_upd_service_role', sch, r.table_name
        );
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = sch AND tablename = r.table_name AND policyname = r.table_name || '_del_service_role'
      ) THEN
        EXECUTE format(
          'CREATE POLICY %I ON %I.%I FOR DELETE USING ((select auth.role()) = ''service_role'');',
          r.table_name || '_del_service_role', sch, r.table_name
        );
      END IF;
    END IF;
  END LOOP;
END $$;

-- Verify result
SELECT n.nspname AS schema,
       c.relname AS table,
       c.relrowsecurity AS rls_enabled,
       (SELECT COUNT(*) FROM pg_policies p WHERE p.schemaname=n.nspname AND p.tablename=c.relname) AS policy_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname='public' AND c.relkind IN ('r','p')
ORDER BY 1,2;
