-- Create point-in-time snapshot copies of important tables into a dedicated
-- non-exposed schema `backup`. Table data only; no constraints/rls copied.
-- Safe to run multiple times (names are timestamped).

DO $$
DECLARE
  ts text := to_char(timezone('UTC', now()), 'YYYYMMDD_HH24MISS');
BEGIN
  EXECUTE 'CREATE SCHEMA IF NOT EXISTS backup';

  EXECUTE format('CREATE TABLE %I.%I AS TABLE public.jobs',          'backup', 'jobs_'||ts);
  EXECUTE format('CREATE TABLE %I.%I AS TABLE public.job_links',     'backup', 'job_links_'||ts);
  EXECUTE format('CREATE TABLE %I.%I AS TABLE public.job_results',   'backup', 'job_results_'||ts);
  EXECUTE format('CREATE TABLE %I.%I AS TABLE public.chat_messages', 'backup', 'chat_messages_'||ts);
  EXECUTE format('CREATE TABLE %I.%I AS TABLE public.parsed_cases',  'backup', 'parsed_cases_'||ts);
  EXECUTE format('CREATE TABLE %I.%I AS TABLE public.user_roles',    'backup', 'user_roles_'||ts);
  EXECUTE format('CREATE TABLE %I.%I AS TABLE public.admin_audit_log','backup','admin_audit_log_'||ts);
  EXECUTE format('CREATE TABLE %I.%I AS TABLE public.edrsr',         'backup', 'edrsr_'||ts);
  EXECUTE format('CREATE TABLE %I.%I AS TABLE public.companies',     'backup', 'companies_'||ts);
END $$;

