-- Admin setup for EDRSR-AI
-- Run this in Supabase SQL Editor to set up admin functionality

-- 1. Add user_roles table for role management
CREATE TABLE IF NOT EXISTS user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL DEFAULT 'user',
    granted_by UUID REFERENCES auth.users(id),
    granted_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, role)
);

-- Enable RLS for user_roles
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- Only admins can manage roles (or service role)
CREATE POLICY user_roles_admin_only ON user_roles 
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM user_roles ur 
            WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
        )
    );

-- 2. Create admin_audit_log table for tracking admin actions
CREATE TABLE IF NOT EXISTS admin_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id),
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(50),
    target_id VARCHAR(100),
    details JSONB DEFAULT '{}',
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS for audit log
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

-- Admins can read audit logs
CREATE POLICY admin_audit_read ON admin_audit_log 
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM user_roles ur 
            WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
        )
    );

-- Service role can insert audit logs
CREATE POLICY admin_audit_insert ON admin_audit_log 
    FOR INSERT WITH CHECK (true); -- Service role will handle this

-- 3. Create admin dashboard view
CREATE OR REPLACE VIEW admin_dashboard AS
SELECT 
    -- User statistics
    (SELECT COUNT(*) FROM auth.users WHERE deleted_at IS NULL) as total_users,
    (SELECT COUNT(*) FROM auth.users WHERE created_at > now() - interval '30 days') as new_users_30d,
    (SELECT COUNT(*) FROM user_roles WHERE role = 'admin') as admin_count,
    
    -- Job statistics  
    (SELECT COUNT(*) FROM jobs) as total_jobs,
    (SELECT COUNT(*) FROM jobs WHERE status = 'completed') as completed_jobs,
    (SELECT COUNT(*) FROM jobs WHERE status = 'error') as failed_jobs,
    (SELECT COUNT(*) FROM jobs WHERE created_at > now() - interval '24 hours') as jobs_24h,
    
    -- System statistics
    (SELECT COUNT(*) FROM job_links) as total_links_processed,
    (SELECT AVG(duration) FROM jobs WHERE status = 'completed' AND duration IS NOT NULL) as avg_job_duration,
    (SELECT COUNT(*) FROM chat_messages) as total_chat_messages,
    (SELECT COUNT(*) FROM parsed_cases) as cached_cases,
    
    -- Recent activity
    (SELECT MAX(created_at) FROM jobs) as last_job_created,
    (SELECT MAX(updated_at) FROM jobs) as last_job_updated;

-- 4. Grant admin role to the first user (replace with your email)
-- IMPORTANT: Change 'your-admin-email@example.com' to your actual email
-- INSERT INTO user_roles (user_id, role, granted_by) 
-- SELECT id, 'admin', id 
-- FROM auth.users 
-- WHERE email = 'your-admin-email@example.com' 
-- ON CONFLICT (user_id, role) DO NOTHING;

-- 5. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role);
CREATE INDEX IF NOT EXISTS idx_admin_audit_user_id ON admin_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created_at ON admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit_log(action);

-- Success message
SELECT 'Admin setup completed successfully!' as message;
