/**
 * FlowSpace - Config.gs
 * Konstanta dan konfigurasi aplikasi.
 */

var CONFIG = {
  // Spreadsheet akan dibuat/dipilih otomatis pada setup pertama
  // Setelah setup, ID disimpan di Script Properties dengan key ini
  SPREADSHEET_PROPERTY_KEY: 'FLOWSPACE_SPREADSHEET_ID',

  // Nama-nama tab (sheet) di spreadsheet database
  SHEETS: {
    WORKSPACES: 'Workspaces',
    MEMBERS: 'Members',
    WORKFLOWS: 'Workflows',
    NODES: 'Nodes',
    EDGES: 'Edges',
    TASKS: 'Tasks',
    APPLICATIONS: 'Applications',
    TASK_APPLICATIONS: 'TaskApplications',
    CHECKLIST: 'Checklist',
    ACTIVITY_LOGS: 'ActivityLogs',
    APP_CATEGORIES: 'AppCategories',
  },

  // Status yang didukung (nilai internal + label UI)
  STATUSES: [
    { id: 'backlog', label: 'Backlog' },
    { id: 'todo', label: 'To Do' },
    { id: 'in_progress', label: 'In Progress' },
    { id: 'review', label: 'Review' },
    { id: 'done', label: 'Done' },
  ],

  // Priority yang didukung
  PRIORITIES: [
    { id: 'critical', label: 'Critical' },
    { id: 'high', label: 'High' },
    { id: 'medium', label: 'Medium' },
    { id: 'low', label: 'Low' },
  ],

  // Jenis node yang didukung
  NODE_TYPES: [
    'start_end',
    'process',
    'task',
    'decision',
    'application',
    'note',
  ],

  // Role yang didukung
  ROLES: ['admin', 'editor', 'viewer'],

  // Kategori aplikasi bawaan (dipakai sebagai seed saat workspace belum punya kategori)
  DEFAULT_APP_CATEGORIES: [
    'Communication',
    'Documentation',
    'Internal System',
    'Dashboard',
    'CRM',
    'Form',
    'Spreadsheet',
    'Other',
  ],

  // Header setiap sheet - JANGAN diubah urutan/nama tanpa update kode
  HEADERS: {
    Workspaces: ['workspace_id', 'workspace_name', 'owner_email', 'status', 'created_at', 'updated_at'],
    Members: ['member_id', 'workspace_id', 'email', 'display_name', 'role', 'member_status', 'created_at'],
    Workflows: ['workflow_id', 'workspace_id', 'workflow_name', 'description', 'canvas_settings_json', 'created_by', 'created_at', 'updated_at', 'status', 'version'],
    Nodes: ['node_id', 'workflow_id', 'node_type', 'title', 'description', 'position_x', 'position_y', 'width', 'height', 'style_json', 'application_id', 'task_id', 'created_at', 'updated_at', 'version'],
    Edges: ['edge_id', 'workflow_id', 'source_node_id', 'target_node_id', 'label', 'condition', 'created_at', 'updated_at', 'source_output', 'target_input'],
    Tasks: ['task_id', 'workspace_id', 'workflow_id', 'node_id', 'title', 'description', 'assignee_email', 'status', 'priority', 'progress', 'progress_mode', 'start_date', 'due_date', 'created_by', 'created_at', 'updated_at', 'version'],
    Applications: ['app_id', 'workspace_id', 'app_name', 'app_url', 'category', 'description', 'icon_url', 'created_by', 'created_at', 'updated_at'],
    TaskApplications: ['task_app_id', 'task_id', 'app_id', 'custom_url', 'link_label', 'created_at'],
    Checklist: ['checklist_id', 'task_id', 'item_title', 'is_completed', 'sort_order', 'created_by', 'created_at', 'updated_at'],
    ActivityLogs: ['log_id', 'workspace_id', 'entity_type', 'entity_id', 'action', 'actor_email', 'old_value_json', 'new_value_json', 'created_at'],
    AppCategories: ['category_id', 'workspace_id', 'category_name', 'sort_order', 'created_at', 'updated_at'],
  },
};

/** Helper: cek apakah status valid */
function isValidStatus(status) {
  return CONFIG.STATUSES.some(function (s) { return s.id === status; });
}

/** Helper: cek apakah priority valid */
function isValidPriority(priority) {
  return CONFIG.PRIORITIES.some(function (p) { return p.id === priority; });
}

/** Helper: cek apakah node type valid */
function isValidNodeType(type) {
  return CONFIG.NODE_TYPES.indexOf(type) !== -1;
}

/** Helper: cek apakah role valid */
function isValidRole(role) {
  return CONFIG.ROLES.indexOf(role) !== -1;
}

/** Helper: validasi URL (hanya http/https) */
function isValidUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    var u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

/** Helper: generate ID unik */
function generateId(prefix) {
  var uuid = Utilities.getUuid();
  if (prefix) return prefix + '_' + uuid.replace(/-/g, '').substring(0, 16);
  return uuid;
}

/** Helper: dapatkan timestamp ISO */
function nowIso() {
  return new Date().toISOString();
}

/** Helper: label status dari id */
function statusLabel(id) {
  for (var i = 0; i < CONFIG.STATUSES.length; i++) {
    if (CONFIG.STATUSES[i].id === id) return CONFIG.STATUSES[i].label;
  }
  return id;
}

/** Helper: label priority dari id */
function priorityLabel(id) {
  for (var i = 0; i < CONFIG.PRIORITIES.length; i++) {
    if (CONFIG.PRIORITIES[i].id === id) return CONFIG.PRIORITIES[i].label;
  }
  return id;
}
