import database from '../database/connection.js';

class ChatService {
  async addChatMessage(jobId, role, content, userId = null) {
    const sql = `INSERT INTO chat_messages (job_id, role, content, user_id) VALUES ($1, $2, $3, $4) RETURNING id`;
    const result = await database.query(sql, [jobId, role, content, userId]);
    return result.rows?.[0]?.id || null;
  }

  async getChatHistory(jobId, userId = null, limit = 50) {
    const sql = userId
      ? `SELECT role, content FROM chat_messages WHERE job_id = $1 AND user_id = $2 ORDER BY created_at ASC LIMIT $3`
      : `SELECT role, content FROM chat_messages WHERE job_id = $1 ORDER BY created_at ASC LIMIT $2`;
    const params = userId ? [jobId, userId, limit] : [jobId, limit];
    return await database.all(sql, params);
  }

  async getChatHistoryForWorkspace(jobId, workspaceId, limit = 50) {
    return await database.all(
      `SELECT cm.role, cm.content
       FROM chat_messages cm
       JOIN jobs j ON j.id = cm.job_id
       WHERE cm.job_id = $1 AND j.workspace_id = $2
       ORDER BY cm.created_at ASC
       LIMIT $3`,
      [jobId, workspaceId, limit]
    );
  }
}

export default new ChatService();
