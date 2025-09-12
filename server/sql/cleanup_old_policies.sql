-- Drop legacy "*_own" policies created earlier to avoid duplicates and initplan warnings
-- on user-scoped tables. Recreates are handled by apply_rls.sql (already applied).

DO $$
DECLARE
  t text;
  p record;
  tables text[] := ARRAY['jobs','job_links','job_results','chat_messages','parsed_cases','user_roles','admin_audit_log'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    FOR p IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname='public' AND tablename=t AND policyname LIKE t || '\\_%\\_own'
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I;', p.policyname, t);
    END LOOP;
  END LOOP;
END $$;

