import database from '../database/connection.js';
import { logger } from '../utils.js';

/**
 * Middleware для проверки административных прав
 * Требует чтобы пользователь был авторизован и имел роль 'admin'
 */
export async function requireAdmin(req, res, next) {
  try {
    // Проверяем что пользователь авторизован
    if (!req.user || !req.user.id) {
      return res.status(401).json({ 
        error: 'Необходима авторизация для доступа к админской панели' 
      });
    }

    // Проверяем административные права
    const adminRole = await database.get(
      'SELECT role FROM user_roles WHERE user_id = $1 AND role = $2',
      [req.user.id, 'admin']
    );

    if (!adminRole) {
      logger.warn(`[ADMIN_ACCESS_DENIED] User ${req.user.email} (${req.user.id}) attempted admin access`);
      return res.status(403).json({ 
        error: 'Доступ запрещен. Требуются права администратора.' 
      });
    }

    // Пользователь является администратором
    req.isAdmin = true;
    logger.debug(`[ADMIN_ACCESS] Admin ${req.user.email} accessing ${req.method} ${req.path}`);
    next();
  } catch (error) {
    logger.error('Error checking admin rights:', error);
    res.status(500).json({ 
      error: 'Ошибка проверки прав доступа' 
    });
  }
}

/**
 * Логирование административных действий
 */
export async function logAdminAction(userId, action, targetType = null, targetId = null, details = {}, req = null) {
  try {
    const logData = {
      user_id: userId,
      action,
      target_type: targetType,
      target_id: targetId,
      details: JSON.stringify(details),
      ip_address: req?.ip || null,
      user_agent: req?.get('User-Agent') || null
    };

    await database.run(
      `INSERT INTO admin_audit_log (user_id, action, target_type, target_id, details, ip_address, user_agent) 
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [logData.user_id, logData.action, logData.target_type, logData.target_id, logData.details, logData.ip_address, logData.user_agent]
    );

    logger.info(`[ADMIN_AUDIT] ${action} by ${userId} on ${targetType || 'system'}:${targetId || 'N/A'}`);
  } catch (error) {
    logger.error('Failed to log admin action:', error);
    // Не прерываем выполнение если логирование не удалось
  }
}

/**
 * Проверка является ли пользователь администратором (без middleware)
 */
export async function isUserAdmin(userId) {
  try {
    const adminRole = await database.get(
      'SELECT role FROM user_roles WHERE user_id = $1 AND role = $2',
      [userId, 'admin']
    );
    return !!adminRole;
  } catch (error) {
    logger.error('Error checking if user is admin:', error);
    return false;
  }
}

/**
 * Получение всех администраторов
 */
export async function getAdminUsers() {
  try {
    const admins = await database.all(`
      SELECT ur.user_id, ur.granted_at, ur.granted_by 
      FROM user_roles ur 
      WHERE ur.role = 'admin'
      ORDER BY ur.granted_at DESC
    `);
    return admins;
  } catch (error) {
    logger.error('Error getting admin users:', error);
    return [];
  }
}

/**
 * Назначение роли администратора
 */
export async function grantAdminRole(targetUserId, grantedByUserId) {
  try {
    await database.run(
      `INSERT INTO user_roles (user_id, role, granted_by) 
       VALUES ($1, 'admin', $2) 
       ON CONFLICT (user_id, role) DO NOTHING`,
      [targetUserId, grantedByUserId]
    );
    
    await logAdminAction(grantedByUserId, 'GRANT_ADMIN_ROLE', 'user', targetUserId);
    return true;
  } catch (error) {
    logger.error('Error granting admin role:', error);
    return false;
  }
}

/**
 * Отзыв роли администратора
 */
export async function revokeAdminRole(targetUserId, revokedByUserId) {
  try {
    const result = await database.run(
      'DELETE FROM user_roles WHERE user_id = $1 AND role = $2',
      [targetUserId, 'admin']
    );
    
    if (result.changes > 0) {
      await logAdminAction(revokedByUserId, 'REVOKE_ADMIN_ROLE', 'user', targetUserId);
      return true;
    }
    return false;
  } catch (error) {
    logger.error('Error revoking admin role:', error);
    return false;
  }
}
