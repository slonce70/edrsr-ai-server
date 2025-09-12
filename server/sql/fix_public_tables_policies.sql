-- Fix existing policies on public tables without user_id to avoid
-- multiple permissive policies and address initplan warnings.
-- Safe: does not touch data rows.

BEGIN;

-- Ensure RLS is enabled
ALTER TABLE IF EXISTS public.edrsr ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.companies ENABLE ROW LEVEL SECURITY;

-- Drop legacy catch-all write policies to avoid SELECT permissive overlap
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='edrsr' AND policyname='edrsr_write_service_role'
  ) THEN
    EXECUTE 'DROP POLICY edrsr_write_service_role ON public.edrsr;';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='companies' AND policyname='companies_write_service_role'
  ) THEN
    EXECUTE 'DROP POLICY companies_write_service_role ON public.companies;';
  END IF;
END $$;

-- Keep/ensure single permissive read policy
CREATE POLICY IF NOT EXISTS edrsr_read_all ON public.edrsr FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS companies_read_all ON public.companies FOR SELECT USING (true);

-- Recreate write policies by action, gating to service_role.
-- Use (select auth.role()) wrapper for initplan performance.

-- edrsr
CREATE POLICY IF NOT EXISTS edrsr_ins_service_role
  ON public.edrsr FOR INSERT
  WITH CHECK ((select auth.role()) = 'service_role');

CREATE POLICY IF NOT EXISTS edrsr_upd_service_role
  ON public.edrsr FOR UPDATE
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

CREATE POLICY IF NOT EXISTS edrsr_del_service_role
  ON public.edrsr FOR DELETE
  USING ((select auth.role()) = 'service_role');

-- companies
CREATE POLICY IF NOT EXISTS companies_ins_service_role
  ON public.companies FOR INSERT
  WITH CHECK ((select auth.role()) = 'service_role');

CREATE POLICY IF NOT EXISTS companies_upd_service_role
  ON public.companies FOR UPDATE
  USING ((select auth.role()) = 'service_role')
  WITH CHECK ((select auth.role()) = 'service_role');

CREATE POLICY IF NOT EXISTS companies_del_service_role
  ON public.companies FOR DELETE
  USING ((select auth.role()) = 'service_role');

COMMIT;

