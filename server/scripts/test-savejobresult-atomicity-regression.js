import assert from 'node:assert/strict';

// connection.js constructor requires DATABASE_URL; a dummy is fine — we override DB methods
// on the singleton before any real query is issued (the Pool never connects in this test).
process.env.DATABASE_URL = 'postgresql://user:pass@127.0.0.1:1/edrsr_test_atomicity';

const database = (await import('../database/connection.js')).default;
const jobWriteService = (await import('../services/jobWriteService.js')).default;

// Core data-integrity property: if INSERT fails mid-save, the previously-saved result must
// survive (atomic DELETE+INSERT) and the failure must propagate (no silent false success).
async function testSaveJobResultRollsBackOnInsertFailurePreservingPriorResult() {
  let stored = 'OLD-RESULT'; // a previously-saved report already exists for this job

  database.get = async () => ({ id: 'job1', user_id: 'u1' });

  // Non-atomic path used by the OLD code: standalone autocommit statements.
  // DELETE commits immediately, then INSERT fails → the old result is gone for good (data loss).
  database.run = async (sql) => {
    if (/DELETE/i.test(sql)) {
      stored = null;
      return { changes: 1 };
    }
    if (/INSERT/i.test(sql)) {
      throw new Error('insert failed');
    }
    return { changes: 0 };
  };

  // Atomic path the FIXED code must use: real BEGIN/COMMIT/ROLLBACK semantics.
  database.withTransaction = async (callback) => {
    const snapshot = stored;
    const tx = {
      run: async (sql) => {
        if (/DELETE/i.test(sql)) {
          stored = null;
          return { changes: 1 };
        }
        if (/INSERT/i.test(sql)) {
          throw new Error('insert failed');
        }
        return { changes: 0 };
      },
      get: async () => undefined,
      all: async () => [],
      query: async () => ({ rows: [], rowCount: 0 }),
    };
    try {
      return await callback(tx);
    } catch (error) {
      stored = snapshot; // ROLLBACK restores the prior result
      throw error;
    }
  };

  let thrown = null;
  try {
    await jobWriteService.saveJobResult('job1', 'NEW-RESULT');
  } catch (error) {
    thrown = error;
  }

  assert(thrown, 'a failed INSERT must propagate (worker must not report a false success)');
  assert.match(thrown.message, /insert failed/);
  assert.equal(
    stored,
    'OLD-RESULT',
    'on INSERT failure the previously-saved result must survive (atomic rollback), not be destroyed'
  );
}

async function run() {
  await testSaveJobResultRollsBackOnInsertFailurePreservingPriorResult();
  console.log('saveJobResult atomicity regression passed.');
}

run();
