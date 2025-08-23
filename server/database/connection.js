import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

class Database {
  constructor() {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not set in the environment variables.');
    }
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });

    this.pool.on('connect', () => {
      // Логування тільки при першому підключенні
      if (!this.connected) {
        console.log('✅ Підключено до PostgreSQL бази даних');
        this.connected = true;
      }
    });

    this.pool.on('error', (err) => {
      console.error('Помилка підключення до бази даних:', err.stack);
    });
  }

  async query(sql, params = []) {
    const client = await this.pool.connect();
    try {
      return await client.query(sql, params);
    } finally {
      client.release();
    }
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

    await this.query(jobsTable);
    await this.query(linksTable);
    await this.query(resultsTable);
    await this.query(chatTable);
    await this.query(edrsrTable);
    await this.query(parsedCasesTable);

    // --- Schema Migrations ---
    // This is a simple way to alter tables without a full migration system.
    await this.runMigration_addTitleColumn();
    await this.runMigration_addDecisionDateColumn();
    await this.runMigration_addUserIdColumns();
    await this.runMigration_addJobTitleMeta();
    await this.runMigration_addAdminTables();

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
        const checkColumnSql = `
          SELECT column_name
          FROM information_schema.columns
          WHERE table_name='${table}' AND column_name='user_id';
        `;
        const result = await this.get(checkColumnSql);
        if (!result) {
          console.log(` MIGRATING: Adding 'user_id' column to '${table}' table...`);
          const addColumnSql = `ALTER TABLE ${table} ADD COLUMN user_id UUID NULL;`;
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

      // Job_links table indexes
      'CREATE INDEX IF NOT EXISTS idx_job_links_job_id ON job_links(job_id)',
      'CREATE INDEX IF NOT EXISTS idx_job_links_status ON job_links(status)',
      'CREATE INDEX IF NOT EXISTS idx_job_links_job_status ON job_links(job_id, status)',
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

      // Text search index
      "CREATE INDEX IF NOT EXISTS idx_edrsr_name_search ON edrsr USING GIN(to_tsvector('simple', name))",
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
}

const database = new Database();
export default database;
