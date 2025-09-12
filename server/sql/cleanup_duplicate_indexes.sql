-- Cleanup/normalize duplicate or legacy index names without touching data
-- Safe to run multiple times (idempotent). No rows are deleted.
-- Strategy:
-- - For admin_audit_log: prefer keeping index name "idx_admin_audit_user_id"
--   If only legacy name exists (idx_admin_audit_log_user_id), rename it.
--   If both exist, drop the legacy one.
-- - For chat_messages: prefer keeping index name "idx_chat_user_id"
--   If only legacy name exists (idx_chat_messages_user_id), rename it.
--   If both exist, drop the legacy one.

DO $$
BEGIN
  -- admin_audit_log: user_id index
  IF to_regclass('public.idx_admin_audit_user_id') IS NULL
     AND to_regclass('public.idx_admin_audit_log_user_id') IS NOT NULL THEN
    -- Only legacy exists: rename to preferred
    EXECUTE 'ALTER INDEX public.idx_admin_audit_log_user_id RENAME TO idx_admin_audit_user_id';
  ELSIF to_regclass('public.idx_admin_audit_user_id') IS NOT NULL
        AND to_regclass('public.idx_admin_audit_log_user_id') IS NOT NULL THEN
    -- Both exist: drop legacy
    EXECUTE 'DROP INDEX public.idx_admin_audit_log_user_id';
  END IF;

  -- chat_messages: user_id index
  IF to_regclass('public.idx_chat_user_id') IS NULL
     AND to_regclass('public.idx_chat_messages_user_id') IS NOT NULL THEN
    -- Only legacy exists: rename to preferred
    EXECUTE 'ALTER INDEX public.idx_chat_messages_user_id RENAME TO idx_chat_user_id';
  ELSIF to_regclass('public.idx_chat_user_id') IS NOT NULL
        AND to_regclass('public.idx_chat_messages_user_id') IS NOT NULL THEN
    -- Both exist: drop legacy
    EXECUTE 'DROP INDEX public.idx_chat_messages_user_id';
  END IF;
END $$;

-- Optional: review unused indexes flagged by advisors before removal.
-- Example (COMMENTED OUT):
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_edrsr_name_search;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_admin_audit_created_at;
-- ... Only after measuring real workload.

