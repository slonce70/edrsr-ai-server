-- Idempotent RLS setup for user-scoped tables
-- Enables RLS and recreates policies with fixed names

BEGIN;

-- Enable RLS (idempotent)
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE parsed_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_prompts ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if exist (to ensure latest definitions)
DROP POLICY IF EXISTS jobs_select   ON jobs;
DROP POLICY IF EXISTS jobs_insert   ON jobs;
DROP POLICY IF EXISTS jobs_update   ON jobs;
DROP POLICY IF EXISTS jobs_delete   ON jobs;

DROP POLICY IF EXISTS job_links_select ON job_links;
DROP POLICY IF EXISTS job_links_insert ON job_links;
DROP POLICY IF EXISTS job_links_update ON job_links;
DROP POLICY IF EXISTS job_links_delete ON job_links;

DROP POLICY IF EXISTS job_results_select ON job_results;
DROP POLICY IF EXISTS job_results_insert ON job_results;
DROP POLICY IF EXISTS job_results_update ON job_results;
DROP POLICY IF EXISTS job_results_delete ON job_results;

DROP POLICY IF EXISTS chat_messages_select ON chat_messages;
DROP POLICY IF EXISTS chat_messages_insert ON chat_messages;
DROP POLICY IF EXISTS chat_messages_update ON chat_messages;
DROP POLICY IF EXISTS chat_messages_delete ON chat_messages;

DROP POLICY IF EXISTS parsed_cases_select ON parsed_cases;
DROP POLICY IF EXISTS parsed_cases_insert ON parsed_cases;
DROP POLICY IF EXISTS parsed_cases_update ON parsed_cases;
DROP POLICY IF EXISTS parsed_cases_delete ON parsed_cases;

DROP POLICY IF EXISTS user_prompts_select ON user_prompts;
DROP POLICY IF EXISTS user_prompts_insert ON user_prompts;
DROP POLICY IF EXISTS user_prompts_update ON user_prompts;
DROP POLICY IF EXISTS user_prompts_delete ON user_prompts;

-- Create policies enforcing user ownership
CREATE POLICY jobs_select ON jobs FOR SELECT USING (user_id = (select auth.uid()));
CREATE POLICY jobs_insert ON jobs FOR INSERT WITH CHECK (user_id = (select auth.uid()));
CREATE POLICY jobs_update ON jobs FOR UPDATE USING (user_id = (select auth.uid()));
CREATE POLICY jobs_delete ON jobs FOR DELETE USING (user_id = (select auth.uid()));

CREATE POLICY job_links_select ON job_links FOR SELECT USING (user_id = (select auth.uid()));
CREATE POLICY job_links_insert ON job_links FOR INSERT WITH CHECK (user_id = (select auth.uid()));
CREATE POLICY job_links_update ON job_links FOR UPDATE USING (user_id = (select auth.uid()));
CREATE POLICY job_links_delete ON job_links FOR DELETE USING (user_id = (select auth.uid()));

CREATE POLICY job_results_select ON job_results FOR SELECT USING (user_id = (select auth.uid()));
CREATE POLICY job_results_insert ON job_results FOR INSERT WITH CHECK (user_id = (select auth.uid()));
CREATE POLICY job_results_update ON job_results FOR UPDATE USING (user_id = (select auth.uid()));
CREATE POLICY job_results_delete ON job_results FOR DELETE USING (user_id = (select auth.uid()));

CREATE POLICY chat_messages_select ON chat_messages FOR SELECT USING (user_id = (select auth.uid()));
CREATE POLICY chat_messages_insert ON chat_messages FOR INSERT WITH CHECK (user_id = (select auth.uid()));
CREATE POLICY chat_messages_update ON chat_messages FOR UPDATE USING (user_id = (select auth.uid()));
CREATE POLICY chat_messages_delete ON chat_messages FOR DELETE USING (user_id = (select auth.uid()));

CREATE POLICY parsed_cases_select ON parsed_cases FOR SELECT USING (user_id = (select auth.uid()));
CREATE POLICY parsed_cases_insert ON parsed_cases FOR INSERT WITH CHECK (user_id = (select auth.uid()));
CREATE POLICY parsed_cases_update ON parsed_cases FOR UPDATE USING (user_id = (select auth.uid()));
CREATE POLICY parsed_cases_delete ON parsed_cases FOR DELETE USING (user_id = (select auth.uid()));

CREATE POLICY user_prompts_select ON user_prompts FOR SELECT USING (user_id = (select auth.uid()));
CREATE POLICY user_prompts_insert ON user_prompts FOR INSERT WITH CHECK (user_id = (select auth.uid()));
CREATE POLICY user_prompts_update ON user_prompts FOR UPDATE USING (user_id = (select auth.uid()));
CREATE POLICY user_prompts_delete ON user_prompts FOR DELETE USING (user_id = (select auth.uid()));

COMMIT;
