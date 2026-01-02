import dbService from '../services/dbService.js';

export async function attachWorkspace(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Необходима авторизация' });

    const paramId = req.params?.workspaceId;
    const requestedId =
      typeof req.query.workspaceId === 'string'
        ? req.query.workspaceId
        : typeof paramId === 'string'
          ? paramId
          : req.headers['x-workspace-id'];

    if (requestedId) {
      const role = await dbService.getWorkspaceRole(userId, requestedId);
      if (!role) return res.status(403).json({ error: 'Недостаточно прав доступа' });
      req.workspace = { id: requestedId, role };
      return next();
    }

    const workspace = await dbService.ensureWorkspaceForUser(userId, req.user?.email || null);
    req.workspace = { id: workspace.id, role: workspace.role };
    return next();
  } catch (error) {
    return next(error);
  }
}

export function requireWorkspaceRole(roles = []) {
  const allowed = new Set(roles);
  return (req, res, next) => {
    if (!req.workspace?.role) {
      return res.status(403).json({ error: 'Недостаточно прав доступа' });
    }
    if (allowed.size === 0 || allowed.has(req.workspace.role)) return next();
    return res.status(403).json({ error: 'Недостаточно прав доступа' });
  };
}
