-- Run in Supabase SQL Editor. Ensure tables exist and include a user_id uuid column.

-- Enable RLS on all relevant tables
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE parsed_cases ENABLE ROW LEVEL SECURITY;

-- Jobs
CREATE POLICY jobs_select ON jobs FOR SELECT USING (user_id = (select auth.uid()));
CREATE POLICY jobs_insert ON jobs FOR INSERT WITH CHECK (user_id = (select auth.uid()));
CREATE POLICY jobs_update ON jobs FOR UPDATE USING (user_id = (select auth.uid()));
CREATE POLICY jobs_delete ON jobs FOR DELETE USING (user_id = (select auth.uid()));

-- Job links
CREATE POLICY job_links_select ON job_links FOR SELECT USING (user_id = (select auth.uid()));
CREATE POLICY job_links_insert ON job_links FOR INSERT WITH CHECK (user_id = (select auth.uid()));
CREATE POLICY job_links_update ON job_links FOR UPDATE USING (user_id = (select auth.uid()));
CREATE POLICY job_links_delete ON job_links FOR DELETE USING (user_id = (select auth.uid()));

-- Job results
CREATE POLICY job_results_select ON job_results FOR SELECT USING (user_id = (select auth.uid()));
CREATE POLICY job_results_insert ON job_results FOR INSERT WITH CHECK (user_id = (select auth.uid()));
CREATE POLICY job_results_update ON job_results FOR UPDATE USING (user_id = (select auth.uid()));
CREATE POLICY job_results_delete ON job_results FOR DELETE USING (user_id = (select auth.uid()));

-- Chat messages
CREATE POLICY chat_messages_select ON chat_messages FOR SELECT USING (user_id = (select auth.uid()));
CREATE POLICY chat_messages_insert ON chat_messages FOR INSERT WITH CHECK (user_id = (select auth.uid()));
CREATE POLICY chat_messages_update ON chat_messages FOR UPDATE USING (user_id = (select auth.uid()));
CREATE POLICY chat_messages_delete ON chat_messages FOR DELETE USING (user_id = (select auth.uid()));

-- Parsed cases
CREATE POLICY parsed_cases_select ON parsed_cases FOR SELECT USING (user_id = (select auth.uid()));
CREATE POLICY parsed_cases_insert ON parsed_cases FOR INSERT WITH CHECK (user_id = (select auth.uid()));
CREATE POLICY parsed_cases_update ON parsed_cases FOR UPDATE USING (user_id = (select auth.uid()));
CREATE POLICY parsed_cases_delete ON parsed_cases FOR DELETE USING (user_id = (select auth.uid()));

-- Note: If email confirmation is enabled, auth.uid() reflects authenticated users only.
-- To drop policies, use: DROP POLICY policy_name ON table_name;
