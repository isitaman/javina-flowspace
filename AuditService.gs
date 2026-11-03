/**
 * FlowSpace - AuditService.gs
 * Activity log untuk audit.
 */

var AuditService = {
  /** Catat perubahan penting */
  log: function (entry) {
    try {
      var data = {
        log_id: generateId('log'),
        workspace_id: entry.workspace_id || '',
        entity_type: entry.entity_type || '',
        entity_id: entry.entity_id || '',
        action: entry.action || '',
        actor_email: entry.actor_email || '',
        old_value_json: entry.old_value_json || '',
        new_value_json: entry.new_value_json || '',
        created_at: nowIso(),
      };
      DatabaseService.insert(CONFIG.SHEETS.ACTIVITY_LOGS, data);
    } catch (e) {
      // Jangan gagalkan operasi utama jika log gagal
      console.error('Audit log failed:', e);
    }
  },

  /** List activity log dengan filter */
  listLogs: function (filters) {
    var ctx = AuthService.getCurrentContext();
    if (!ctx.workspace) return apiSuccess([]);
    var logs = DatabaseService.findBy(CONFIG.SHEETS.ACTIVITY_LOGS, 'workspace_id', ctx.workspace.workspace_id);
    if (filters && filters.entityType) {
      logs = logs.filter(function (l) { return String(l.entity_type) === String(filters.entityType); });
    }
    if (filters && filters.entityId) {
      logs = logs.filter(function (l) { return String(l.entity_id) === String(filters.entityId); });
    }
    var result = logs.map(function (l) {
      return {
        id: l.log_id,
        entityType: l.entity_type,
        entityId: l.entity_id,
        action: l.action,
        actorEmail: l.actor_email,
        oldValue: l.old_value_json ? JSON.parse(l.old_value_json) : null,
        newValue: l.new_value_json ? JSON.parse(l.new_value_json) : null,
        createdAt: String(l.created_at),
      };
    });
    result.sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
    var limit = (filters && filters.limit) || 50;
    return apiSuccess(result.slice(0, limit));
  },
};
