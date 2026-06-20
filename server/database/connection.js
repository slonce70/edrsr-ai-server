import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

// Small helper for delays
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- SQL Injection Prevention for Dynamic Identifiers ---

/**
 * Allowed table names for migrations.
 * Only these tables can be modified by dynamic migrations.
 */
const ALLOWED_TABLES = new Set([
  'jobs',
  'job_links',
  'job_results',
  'chat_messages',
  'edrsr',
  'parsed_cases',
  'user_prompts',
  'user_roles',
  'admin_audit_log',
  'workspaces',
  'workspace_members',
  'matters',
  'share_links',
  'prompt_definitions',
  'workspace_prompts',
  'prompt_audit_log',
]);

/**
 * Allowed column name pattern.
 * Columns must be alphanumeric with underscores only.
 */
const VALID_IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]*$/i;

/**
 * Validates a SQL identifier (table or column name) against injection attacks.
 * @param {string} identifier - The table or column name
 * @param {'table'|'column'} type - Type of identifier
 * @throws {Error} If identifier is invalid
 * @returns {string} The validated identifier
 */
function validateSqlIdentifier(identifier, type = 'column') {
  if (typeof identifier !== 'string' || identifier.length === 0) {
    throw new Error(`Invalid ${type} name: must be a non-empty string`);
  }

  // Check for SQL injection patterns
  if (identifier.includes(';') || identifier.includes('--') || identifier.includes('/*')) {
    throw new Error(`Invalid ${type} name: contains forbidden characters`);
  }

  // Validate against pattern
  if (!VALID_IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error(
      `Invalid ${type} name "${identifier}": must contain only letters, numbers, and underscores`
    );
  }

  // For tables, check against allowlist
  if (type === 'table' && !ALLOWED_TABLES.has(identifier)) {
    throw new Error(`Invalid table name "${identifier}": not in allowed list`);
  }

  // Additional length check (PostgreSQL max is 63 chars)
  if (identifier.length > 63) {
    throw new Error(`Invalid ${type} name: exceeds maximum length of 63 characters`);
  }

  return identifier;
}

function isTransientPgError(error) {
  if (!error) return false;
  const code = error.code;
  const msg = `${error.message || ''} ${error.stack || ''}`.toLowerCase();
  // Common transient/connection-related conditions (pgBouncer/Supabase restarts, network blips)
  const transientCodes = new Set([
    '57P01', // admin_shutdown
    '57P02', // crash_shutdown
    '57P03', // cannot_connect_now
    '53300', // too_many_connections
    '08000', // connection_exception
    '08003', // connection_does_not_exist
    '08006', // connection_failure
  ]);
  if (code && transientCodes.has(code)) return true;
  // Message-based detection for poolers/clouds
  const substrings = [
    'dbhandler exited',
    'db_termination',
    'terminating connection',
    'server closed the connection unexpectedly',
    'connection terminated',
    'the database system is starting up',
    'could not receive data from server',
    'connection reset by peer',
    'socket hang up',
    'econnreset',
  ];
  return substrings.some((s) => msg.includes(s));
}

class Database {
  constructor() {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set in the environment variables.');
    }

    // Safer pool configuration for Supabase/pgBouncer and cloud envs
    const poolConfig = {
      connectionString: process.env.DATABASE_URL,
      max: parseInt(process.env.PG_POOL_MAX || '10', 10),
      idleTimeoutMillis: parseInt(process.env.PG_IDLE_TIMEOUT_MS || '30000', 10),
      connectionTimeoutMillis: parseInt(process.env.PG_CONN_TIMEOUT_MS || '10000', 10),
      keepAlive: true,
      // rotate connections periodically to avoid stale ones behind NAT/pgBouncer
      maxUses: parseInt(process.env.PG_MAX_USES || '7500', 10),
    };
    // SSL Configuration
    // Determine if SSL is required based on environment variables or Supabase URL
    const wantSSL =
      process.env.PGSSL === 'true' ||
      process.env.PGSSLMODE === 'require' ||
      (process.env.DATABASE_URL || '').includes('supabase.com');

    if (wantSSL) {
      // SSL certificate validation configuration
      // In production: validate certificates by default for security (MITM protection)
      // Can be overridden with PG_SSL_REJECT_UNAUTHORIZED=false for specific cloud providers
      const rejectUnauthorized =
        process.env.PG_SSL_REJECT_UNAUTHORIZED !== 'false' && process.env.NODE_ENV === 'production';

      poolConfig.ssl = { rejectUnauthorized };

      // Log SSL configuration for transparency
      if (!rejectUnauthorized) {
        console.warn(
          '⚠️ [SECURITY] SSL certificate validation is DISABLED. ' +
            'This is acceptable for trusted cloud providers like Supabase, ' +
            'but reduces MITM protection. Set PG_SSL_REJECT_UNAUTHORIZED=true in production for stricter security.'
        );
      } else {
        console.log('✅ [SECURITY] SSL certificate validation is ENABLED');
      }
    }

    this.pool = new Pool(poolConfig);

    this.pool.on('connect', () => {
      // Логування тільки при першому підключенні
      if (!this.connected) {
        console.log('✅ Підключено до PostgreSQL бази даних');
        this.connected = true;
      }
    });

    this.pool.on('error', (err) => {
      console.error('Помилка підключення до бази даних:', err.stack || err.message);
    });
  }

  async withRetry(executor, { attempts = 3, delays = [200, 500, 1000] } = {}) {
    let lastError;
    for (let i = 0; i < attempts; i++) {
      try {
        return await executor();
      } catch (err) {
        lastError = err;
        if (isTransientPgError(err) && i < attempts - 1) {
          const delay = delays[i] || delays[delays.length - 1] || 500;
          // Light log only; upstream caller may also log
          console.warn(`⚠️ PG transient error, retrying in ${delay}ms:`, err.message);
          await sleep(delay);
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  }

  async query(sql, params = []) {
    // Use pool.query directly (no explicit client) and add retry logic
    return await this.withRetry(() => this.pool.query(sql, params));
  }

  async run(sql, params = []) {
    const result = await this.query(sql, params);
    return { changes: result.rowCount };
  }

  async get(sql, params = []) {
    const result = await this.query(sql, params);
    return result.rows[0];
  }

  async all(sql, params = []) {
    const result = await this.query(sql, params);
    return result.rows;
  }

  async withClientTransaction(work) {
    const client = await this.pool.connect();
    const onClientError = (err) => {
      console.error('[DB] Transaction client error:', err);
    };
    client.on('error', onClientError);

    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('[DB] ROLLBACK failed:', rollbackErr);
      }
      throw error;
    } finally {
      try {
        client.removeListener('error', onClientError);
      } catch {
        // noop
      }
      client.release();
    }
  }

  async withTransaction(callback) {
    const client = await this.pool.connect();
    const tx = {
      query: async (sql, params = []) => client.query(sql, params),
      run: async (sql, params = []) => {
        const result = await client.query(sql, params);
        return { changes: result.rowCount };
      },
      get: async (sql, params = []) => {
        const result = await client.query(sql, params);
        return result.rows[0];
      },
      all: async (sql, params = []) => {
        const result = await client.query(sql, params);
        return result.rows;
      },
    };

    try {
      await client.query('BEGIN');
      const result = await callback(tx, client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Transaction rollback error:', rollbackError.message);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async initializeTables() {
    const jobsTable = `
            CREATE TABLE IF NOT EXISTS jobs (
                id VARCHAR(36) PRIMARY KEY,
                title VARCHAR(255),
                status VARCHAR(20) NOT NULL,
                progress INTEGER DEFAULT 0,
                total_links INTEGER,
                processed_links INTEGER DEFAULT 0,
                start_time TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                end_time TIMESTAMPTZ,
                duration INTEGER,
                error_message TEXT,
                prompt TEXT,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            )
        `;

    const linksTable = `
            CREATE TABLE IF NOT EXISTS job_links (
                id SERIAL PRIMARY KEY,
                job_id VARCHAR(36) REFERENCES jobs(id) ON DELETE CASCADE,
                url TEXT NOT NULL,
                status VARCHAR(20) DEFAULT 'pending',
                content TEXT,
                error_message TEXT,
                processed_at TIMESTAMPTZ,
                -- Legal metadata columns
                law_articles JSONB DEFAULT '[]'::JSONB,
                claim_amount JSONB DEFAULT NULL,
                case_type VARCHAR(100) DEFAULT NULL,
                parties JSONB DEFAULT '{}'::JSONB,
                metadata_extracted_at TIMESTAMPTZ DEFAULT NULL
            )
        `;

    const resultsTable = `
            CREATE TABLE IF NOT EXISTS job_results (
                id SERIAL PRIMARY KEY,
                job_id VARCHAR(36) REFERENCES jobs(id) ON DELETE CASCADE,
                analysis_text TEXT NOT NULL,
                analysis_type VARCHAR(50) DEFAULT 'full',
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            )
        `;

    const chatTable = `
            CREATE TABLE IF NOT EXISTS chat_messages (
                id SERIAL PRIMARY KEY,
                job_id VARCHAR(36) REFERENCES jobs(id) ON DELETE CASCADE,
                role VARCHAR(20) NOT NULL, -- 'user' or 'model'
                content TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            )
        `;

    const edrsrTable = `
            CREATE TABLE IF NOT EXISTS edrsr (
                id SERIAL PRIMARY KEY,
                name TEXT,
                description TEXT,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            )
        `;

    const parsedCasesTable = `
            CREATE TABLE IF NOT EXISTS parsed_cases (
              url TEXT PRIMARY KEY,
              case_data JSONB NOT NULL,
              created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            )
        `;

    const userPromptsTable = `
            CREATE TABLE IF NOT EXISTS user_prompts (
              id UUID PRIMARY KEY,
              user_id UUID NOT NULL,
              name VARCHAR(120) NOT NULL,
              content TEXT NOT NULL,
              created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            )
        `;

    const promptDefinitionsTable = `
            CREATE TABLE IF NOT EXISTS prompt_definitions (
              id SERIAL PRIMARY KEY,
              version INTEGER NOT NULL DEFAULT 1,
              payload JSONB NOT NULL,
              created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            )
        `;

    const workspacePromptsTable = `
            CREATE TABLE IF NOT EXISTS workspace_prompts (
              id UUID PRIMARY KEY,
              workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
              name VARCHAR(120) NOT NULL,
              content TEXT NOT NULL,
              created_by UUID NOT NULL,
              updated_by UUID,
              created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
              UNIQUE(workspace_id, name)
            )
        `;

    const promptAuditLogTable = `
            CREATE TABLE IF NOT EXISTS prompt_audit_log (
              id SERIAL PRIMARY KEY,
              user_id UUID,
              workspace_id UUID,
              prompt_id UUID,
              prompt_scope VARCHAR(20) NOT NULL,
              action VARCHAR(50) NOT NULL,
              details JSONB DEFAULT '{}'::JSONB,
              created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            )
        `;

    const appUsersTable = `
            CREATE TABLE IF NOT EXISTS app_users (
              user_id UUID PRIMARY KEY,
              email TEXT,
              email_lower TEXT,
              first_seen_at TIMESTAMPTZ,
              last_seen_at TIMESTAMPTZ
            )
        `;

    const workspacesTable = `
            CREATE TABLE IF NOT EXISTS workspaces (
              id UUID PRIMARY KEY,
              name TEXT NOT NULL,
              owner_user_id UUID NOT NULL,
              created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            )
        `;

    const workspaceMembersTable = `
            CREATE TABLE IF NOT EXISTS workspace_members (
              id SERIAL PRIMARY KEY,
              workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
              user_id UUID NOT NULL,
              role VARCHAR(20) NOT NULL DEFAULT 'member',
              invited_by UUID,
              created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
              UNIQUE(workspace_id, user_id)
            )
        `;

    const mattersTable = `
            CREATE TABLE IF NOT EXISTS matters (
              id UUID PRIMARY KEY,
              workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
              title VARCHAR(255) NOT NULL,
              description TEXT,
              client_name TEXT,
              tags JSONB DEFAULT '[]'::JSONB,
              created_by UUID,
              created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            )
        `;

    const shareLinksTable = `
            CREATE TABLE IF NOT EXISTS share_links (
              id UUID PRIMARY KEY,
              job_id VARCHAR(36) REFERENCES jobs(id) ON DELETE CASCADE,
              token_hash TEXT NOT NULL,
              share_url TEXT,
              expires_at TIMESTAMPTZ NOT NULL,
              created_by UUID,
              created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
              revoked_at TIMESTAMPTZ
            )
        `;

    await this.query(jobsTable);
    await this.query(linksTable);
    await this.query(resultsTable);
    await this.query(chatTable);
    await this.query(edrsrTable);
    await this.query(parsedCasesTable);
    await this.query(userPromptsTable);
    await this.query(promptDefinitionsTable);
    await this.query(promptAuditLogTable);
    await this.query(appUsersTable);
    await this.query(workspacesTable);
    await this.query(workspacePromptsTable);
    await this.query(workspaceMembersTable);
    await this.query(mattersTable);
    await this.query(shareLinksTable);

    // --- Schema Migrations ---
    // This is a simple way to alter tables without a full migration system.
    await this.runMigration_addTitleColumn();
    await this.runMigration_addDecisionDateColumn();
    await this.runMigration_addUserIdColumns();
    await this.runMigration_addJobTitleMeta();
    await this.runMigration_addAdminTables();
    await this.runMigration_addQueueColumns();
    await this.runMigration_addWorkspaceColumns();
    await this.runMigration_addEvidenceColumns();
    await this.runMigration_addShareLinkUrl();
    await this.runMigration_addShareViewColumns();
    await this.runMigration_normalizeWorkspaceRoles();
    await this.runMigration_scrubShareLinkUrls();

    // Create performance indexes
    await this.createIndexes();

    console.log('✅ Таблиці бази даних ініціалізовано/оновлено');
  }

  async runMigration_addTitleColumn() {
    try {
      // Check if the column exists
      const checkColumnSql = `
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name='jobs' AND column_name='title';
      `;
      const result = await this.get(checkColumnSql);

      // If the column doesn't exist, add it
      if (!result) {
        console.log(" MIGRATING: Adding 'title' column to 'jobs' table...");
        const addColumnSql = `ALTER TABLE jobs ADD COLUMN title VARCHAR(255);`;
        await this.query(addColumnSql);
        console.log('    ...done.');
      }
    } catch (error) {
      console.error('Migration error (addTitleColumn):', error.message);
      // We don't re-throw here to allow the server to start,
      // but the error is logged for debugging.
    }
  }

  async runMigration_addDecisionDateColumn() {
    try {
      const checkColumnSql = `
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name='job_links' AND column_name='decision_date';
      `;
      const result = await this.get(checkColumnSql);

      if (!result) {
        console.log(" MIGRATING: Adding 'decision_date' column to 'job_links' table...");
        const addColumnSql = `ALTER TABLE job_links ADD COLUMN decision_date TEXT;`;
        await this.query(addColumnSql);
        console.log('    ...done.');
      }
    } catch (error) {
      console.error('Migration error (addDecisionDateColumn):', error.message);
    }
  }

  async runMigration_addUserIdColumns() {
    // Adds user_id column (uuid, nullable) to user-scoped tables if missing
    const tables = ['jobs', 'job_links', 'job_results', 'chat_messages', 'parsed_cases'];

    for (const table of tables) {
      try {
        // Validate table name against allowlist to prevent SQL injection
        const safeTable = validateSqlIdentifier(table, 'table');

        // Use parameterized query for the check
        const checkColumnSql = `
          SELECT column_name
          FROM information_schema.columns
          WHERE table_name = $1 AND column_name = 'user_id';
        `;
        const result = await this.get(checkColumnSql, [safeTable]);
        if (!result) {
          console.log(` MIGRATING: Adding 'user_id' column to '${safeTable}' table...`);
          // Safe to use validated identifier in DDL (ALTER TABLE doesn't support parameters)
          const addColumnSql = `ALTER TABLE "${safeTable}" ADD COLUMN user_id UUID NULL;`;
          await this.query(addColumnSql);
          console.log('    ...done.');
        }
      } catch (error) {
        console.error(`Migration error (addUserIdColumns:${table}):`, error.message);
      }
    }
  }

  async createIndexes() {
    const indexes = [
      // Jobs table indexes for performance
      'CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)',
      'CREATE INDEX IF NOT EXISTS idx_jobs_updated_at ON jobs(updated_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_jobs_status_updated ON jobs(status, updated_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_jobs_workspace_id ON jobs(workspace_id)',
      'CREATE INDEX IF NOT EXISTS idx_jobs_matter_id ON jobs(matter_id)',

      // Job_links table indexes
      'CREATE INDEX IF NOT EXISTS idx_job_links_job_id ON job_links(job_id)',
      'CREATE INDEX IF NOT EXISTS idx_job_links_status ON job_links(status)',
      'CREATE INDEX IF NOT EXISTS idx_job_links_job_status ON job_links(job_id, status)',
      'CREATE INDEX IF NOT EXISTS idx_job_links_url ON job_links(url)',
      'CREATE INDEX IF NOT EXISTS idx_job_links_user_id ON job_links(user_id)',

      // Job_results table indexes
      'CREATE INDEX IF NOT EXISTS idx_job_results_job_id ON job_results(job_id)',
      'CREATE INDEX IF NOT EXISTS idx_job_results_user_id ON job_results(user_id)',

      // Chat_messages table indexes
      'CREATE INDEX IF NOT EXISTS idx_chat_job_id ON chat_messages(job_id)',
      'CREATE INDEX IF NOT EXISTS idx_chat_created_at ON chat_messages(created_at)',
      'CREATE INDEX IF NOT EXISTS idx_chat_user_id ON chat_messages(user_id)',

      // JSONB indexes for metadata search
      'CREATE INDEX IF NOT EXISTS idx_job_links_law_articles ON job_links USING GIN(law_articles)',
      'CREATE INDEX IF NOT EXISTS idx_job_links_parties ON job_links USING GIN(parties)',

      // Index for the new parsed_cases table
      'CREATE INDEX IF NOT EXISTS idx_parsed_cases_url ON parsed_cases(url)',
      'CREATE INDEX IF NOT EXISTS idx_parsed_cases_user_id ON parsed_cases(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_parsed_cases_updated_at ON parsed_cases(updated_at DESC)',

      // User prompts indexes
      'CREATE INDEX IF NOT EXISTS idx_user_prompts_user_id ON user_prompts(user_id)',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_user_prompts_user_name ON user_prompts(user_id, name)',
      'CREATE INDEX IF NOT EXISTS idx_user_prompts_updated_at ON user_prompts(updated_at DESC)',

      // Prompt definitions indexes
      'CREATE INDEX IF NOT EXISTS idx_prompt_definitions_updated_at ON prompt_definitions(updated_at DESC)',

      // Workspace prompts indexes
      'CREATE INDEX IF NOT EXISTS idx_workspace_prompts_workspace ON workspace_prompts(workspace_id)',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_prompts_name ON workspace_prompts(workspace_id, name)',
      'CREATE INDEX IF NOT EXISTS idx_workspace_prompts_updated_at ON workspace_prompts(updated_at DESC)',

      // Prompt audit log indexes
      'CREATE INDEX IF NOT EXISTS idx_prompt_audit_workspace ON prompt_audit_log(workspace_id)',
      'CREATE INDEX IF NOT EXISTS idx_prompt_audit_user ON prompt_audit_log(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_prompt_audit_prompt ON prompt_audit_log(prompt_id)',
      'CREATE INDEX IF NOT EXISTS idx_prompt_audit_created_at ON prompt_audit_log(created_at DESC)',

      // App users indexes (admin filtering/metrics)
      'CREATE INDEX IF NOT EXISTS idx_app_users_email_lower ON app_users(email_lower)',
      'CREATE INDEX IF NOT EXISTS idx_app_users_first_seen_at ON app_users(first_seen_at DESC)',
      'CREATE INDEX IF NOT EXISTS idx_app_users_last_seen_at ON app_users(last_seen_at DESC)',

      // Workspace indexes
      'CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON workspaces(owner_user_id)',
      'CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace ON workspace_members(workspace_id)',
      'CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_workspace_members_role ON workspace_members(role)',

      // Matters indexes
      'CREATE INDEX IF NOT EXISTS idx_matters_workspace ON matters(workspace_id)',
      'CREATE INDEX IF NOT EXISTS idx_matters_created_by ON matters(created_by)',
      'CREATE INDEX IF NOT EXISTS idx_matters_updated_at ON matters(updated_at DESC)',

      // Share links indexes
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_share_links_token_hash ON share_links(token_hash)',
      'CREATE INDEX IF NOT EXISTS idx_share_links_job_id ON share_links(job_id)',
      'CREATE INDEX IF NOT EXISTS idx_share_links_expires ON share_links(expires_at)',

      // Text search index
      "CREATE INDEX IF NOT EXISTS idx_edrsr_name_search ON edrsr USING GIN(to_tsvector('simple', name))",

      // Queue/locking related indexes
      'CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs(status, created_at)',
      'CREATE INDEX IF NOT EXISTS idx_jobs_lease_until ON jobs(lease_until)',
      'CREATE INDEX IF NOT EXISTS idx_jobs_locked_by ON jobs(locked_by)',

      // Job evidence columns
      'CREATE INDEX IF NOT EXISTS idx_job_links_evidence_extracted ON job_links(evidence_extracted_at)',
    ];

    for (const indexSql of indexes) {
      try {
        await this.query(indexSql);
        console.log(`✅ Створено індекс: ${indexSql.split(' ')[5]}`);
      } catch (error) {
        if (!error.message.includes('already exists')) {
          console.warn(`⚠️ Помилка створення індексу: ${error.message}`);
        }
      }
    }
  }

  async runMigration_addJobTitleMeta() {
    try {
      // title_source
      const checkTitleSource = `
        SELECT column_name FROM information_schema.columns
        WHERE table_name='jobs' AND column_name='title_source';
      `;
      const ts = await this.get(checkTitleSource);
      if (!ts) {
        console.log(" MIGRATING: Adding 'title_source' to 'jobs'...");
        await this.query("ALTER TABLE jobs ADD COLUMN title_source VARCHAR(20) DEFAULT 'default';");
      }
    } catch (e) {
      console.error('Migration error (addJobTitleMeta:title_source):', e.message);
    }

    try {
      // user_edited
      const checkUserEdited = `
        SELECT column_name FROM information_schema.columns
        WHERE table_name='jobs' AND column_name='user_edited';
      `;
      const ue = await this.get(checkUserEdited);
      if (!ue) {
        console.log(" MIGRATING: Adding 'user_edited' to 'jobs'...");
        await this.query('ALTER TABLE jobs ADD COLUMN user_edited BOOLEAN DEFAULT false;');
      }
    } catch (e) {
      console.error('Migration error (addJobTitleMeta:user_edited):', e.message);
    }

    try {
      // auto_title_enabled
      const checkAuto = `
        SELECT column_name FROM information_schema.columns
        WHERE table_name='jobs' AND column_name='auto_title_enabled';
      `;
      const at = await this.get(checkAuto);
      if (!at) {
        console.log(" MIGRATING: Adding 'auto_title_enabled' to 'jobs'...");
        await this.query('ALTER TABLE jobs ADD COLUMN auto_title_enabled BOOLEAN DEFAULT true;');
      }
    } catch (e) {
      console.error('Migration error (addJobTitleMeta:auto_title_enabled):', e.message);
    }
  }

  async runMigration_addAdminTables() {
    try {
      // Check if user_roles table exists
      const checkUserRoles = `
        SELECT table_name FROM information_schema.tables 
        WHERE table_name='user_roles';
      `;
      const userRolesExists = await this.get(checkUserRoles);

      if (!userRolesExists) {
        console.log(' MIGRATING: Creating admin tables (user_roles, admin_audit_log)...');

        // Create user_roles table (simplified for PostgreSQL without Supabase auth functions)
        const userRolesTable = `
          CREATE TABLE user_roles (
            id SERIAL PRIMARY KEY,
            user_id UUID NOT NULL,
            role VARCHAR(20) NOT NULL DEFAULT 'user',
            granted_by UUID,
            granted_at TIMESTAMPTZ DEFAULT now(),
            UNIQUE(user_id, role)
          )
        `;
        await this.query(userRolesTable);

        // Create admin_audit_log table
        const auditLogTable = `
          CREATE TABLE admin_audit_log (
            id SERIAL PRIMARY KEY,
            user_id UUID NOT NULL,
            action VARCHAR(100) NOT NULL,
            target_type VARCHAR(50),
            target_id VARCHAR(100),
            details JSONB DEFAULT '{}',
            ip_address INET,
            user_agent TEXT,
            created_at TIMESTAMPTZ DEFAULT now()
          )
        `;
        await this.query(auditLogTable);

        // Create indexes
        await this.query(
          'CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id)'
        );
        await this.query('CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role)');
        await this.query(
          'CREATE INDEX IF NOT EXISTS idx_admin_audit_user_id ON admin_audit_log(user_id)'
        );
        await this.query(
          'CREATE INDEX IF NOT EXISTS idx_admin_audit_created_at ON admin_audit_log(created_at DESC)'
        );

        console.log('    ...admin tables created.');
      }
    } catch (e) {
      console.error('Migration error (addAdminTables):', e.message);
    }
  }

  async runMigration_addQueueColumns() {
    // Adds columns used for DB-backed leasing/queueing
    // Allowed type definitions for queue columns (prevents injection via typeSql)
    const ALLOWED_TYPES = new Set([
      'TEXT NULL',
      'TIMESTAMPTZ NULL',
      'INTEGER DEFAULT 0',
      'INTEGER DEFAULT 3',
    ]);

    const addColumnIfMissing = async (table, column, typeSql) => {
      try {
        // Validate all identifiers
        const safeTable = validateSqlIdentifier(table, 'table');
        const safeColumn = validateSqlIdentifier(column, 'column');

        // Validate type against allowlist
        if (!ALLOWED_TYPES.has(typeSql)) {
          throw new Error(`Invalid column type: ${typeSql}`);
        }

        const exists = await this.get(
          `SELECT column_name FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`,
          [safeTable, safeColumn]
        );
        if (!exists) {
          await this.query(`ALTER TABLE "${safeTable}" ADD COLUMN "${safeColumn}" ${typeSql}`);
          console.log(`✅ Added column ${safeColumn} to ${safeTable}`);
        }
      } catch (e) {
        console.error(`Migration error (addQueueColumn ${table}.${column}):`, e.message);
      }
    };

    await addColumnIfMissing('jobs', 'locked_by', 'TEXT NULL');
    await addColumnIfMissing('jobs', 'locked_at', 'TIMESTAMPTZ NULL');
    await addColumnIfMissing('jobs', 'lease_until', 'TIMESTAMPTZ NULL');
    await addColumnIfMissing('jobs', 'heartbeat_at', 'TIMESTAMPTZ NULL');
    await addColumnIfMissing('jobs', 'attempt', 'INTEGER DEFAULT 0');
    await addColumnIfMissing('jobs', 'max_attempts', 'INTEGER DEFAULT 3');
    await addColumnIfMissing('jobs', 'priority', 'INTEGER DEFAULT 0');
  }

  async runMigration_addWorkspaceColumns() {
    const addColumnIfMissing = async (table, column, typeSql) => {
      try {
        const safeTable = validateSqlIdentifier(table, 'table');
        const safeColumn = validateSqlIdentifier(column, 'column');
        const exists = await this.get(
          `SELECT column_name FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`,
          [safeTable, safeColumn]
        );
        if (!exists) {
          await this.query(`ALTER TABLE "${safeTable}" ADD COLUMN "${safeColumn}" ${typeSql}`);
          console.log(`✅ Added column ${safeColumn} to ${safeTable}`);
        }
      } catch (e) {
        console.error(`Migration error (addWorkspaceColumn ${table}.${column}):`, e.message);
      }
    };

    await addColumnIfMissing('jobs', 'workspace_id', 'UUID NULL');
    await addColumnIfMissing('jobs', 'matter_id', 'UUID NULL');
  }

  async runMigration_addEvidenceColumns() {
    const addColumnIfMissing = async (table, column, typeSql) => {
      try {
        const safeTable = validateSqlIdentifier(table, 'table');
        const safeColumn = validateSqlIdentifier(column, 'column');
        const exists = await this.get(
          `SELECT column_name FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`,
          [safeTable, safeColumn]
        );
        if (!exists) {
          await this.query(`ALTER TABLE "${safeTable}" ADD COLUMN "${safeColumn}" ${typeSql}`);
          console.log(`✅ Added column ${safeColumn} to ${safeTable}`);
        }
      } catch (e) {
        console.error(`Migration error (addEvidenceColumn ${table}.${column}):`, e.message);
      }
    };

    await addColumnIfMissing('job_links', 'evidence_snippet', 'TEXT NULL');
    await addColumnIfMissing('job_links', 'evidence_extracted_at', 'TIMESTAMPTZ NULL');
  }

  async runMigration_addShareLinkUrl() {
    const addColumnIfMissing = async (table, column, typeSql) => {
      try {
        const safeTable = validateSqlIdentifier(table, 'table');
        const safeColumn = validateSqlIdentifier(column, 'column');
        const exists = await this.get(
          `SELECT column_name FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`,
          [safeTable, safeColumn]
        );
        if (!exists) {
          await this.query(`ALTER TABLE "${safeTable}" ADD COLUMN "${safeColumn}" ${typeSql}`);
          console.log(`✅ Added column ${safeColumn} to ${safeTable}`);
        }
      } catch (e) {
        console.error(`Migration error (addShareLinkUrl ${table}.${column}):`, e.message);
      }
    };

    await addColumnIfMissing('share_links', 'share_url', 'TEXT NULL');
  }

  async runMigration_addShareViewColumns() {
    const addColumnIfMissing = async (table, column, typeSql) => {
      try {
        const safeTable = validateSqlIdentifier(table, 'table');
        const safeColumn = validateSqlIdentifier(column, 'column');
        const exists = await this.get(
          `SELECT column_name FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`,
          [safeTable, safeColumn]
        );
        if (!exists) {
          await this.query(`ALTER TABLE "${safeTable}" ADD COLUMN "${safeColumn}" ${typeSql}`);
          console.log(`✅ Added column ${safeColumn} to ${safeTable}`);
        }
      } catch (e) {
        console.error(`Migration error (addShareViewColumns ${table}.${column}):`, e.message);
      }
    };

    await addColumnIfMissing('share_links', 'view_count', 'INTEGER DEFAULT 0');
    await addColumnIfMissing('share_links', 'first_viewed_at', 'TIMESTAMPTZ NULL');
    await addColumnIfMissing('share_links', 'last_viewed_at', 'TIMESTAMPTZ NULL');
  }

  async runMigration_normalizeWorkspaceRoles() {
    try {
      await this.query(
        `UPDATE workspace_members
         SET role = 'member', updated_at = CURRENT_TIMESTAMP
         WHERE role NOT IN ('owner', 'admin', 'member')`
      );

      await this.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, invited_by, created_at, updated_at)
         SELECT w.id, w.owner_user_id, 'owner', w.owner_user_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
         FROM workspaces w
         WHERE NOT EXISTS (
           SELECT 1
           FROM workspace_members wm
           WHERE wm.workspace_id = w.id AND wm.user_id = w.owner_user_id
         )`
      );

      await this.query(
        `UPDATE workspace_members wm
         SET role = CASE WHEN wm.user_id = w.owner_user_id THEN 'owner' ELSE 'admin' END,
             updated_at = CURRENT_TIMESTAMP
         FROM workspaces w
         WHERE wm.workspace_id = w.id
           AND wm.role = 'owner'
           AND wm.user_id <> w.owner_user_id`
      );

      await this.query(
        `UPDATE workspace_members wm
         SET role = 'owner', updated_at = CURRENT_TIMESTAMP
         FROM workspaces w
         WHERE wm.workspace_id = w.id
           AND wm.user_id = w.owner_user_id
           AND wm.role <> 'owner'`
      );

      const constraintExists = await this.get(
        `SELECT conname
         FROM pg_constraint
         WHERE conname = 'workspace_members_role_valid'`
      );
      if (!constraintExists) {
        await this.query(
          `ALTER TABLE workspace_members
           ADD CONSTRAINT workspace_members_role_valid
           CHECK (role IN ('owner', 'admin', 'member'))`
        );
      }
    } catch (error) {
      console.error('Migration error (normalizeWorkspaceRoles):', error.message);
    }
  }

  async runMigration_scrubShareLinkUrls() {
    try {
      const result = await this.run(
        `UPDATE share_links
         SET share_url = NULL
         WHERE share_url IS NOT NULL`
      );
      if (result.changes > 0) {
        console.log(`✅ Scrubbed ${result.changes} persisted share link URL(s)`);
      }
    } catch (error) {
      console.error('Migration error (scrubShareLinkUrls):', error.message);
    }
  }
}

const database = new Database();
export default database;
