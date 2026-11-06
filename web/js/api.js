/* ============================================================
 * FlowSpace - api.js
 * Lapisan business logic (port dari GAS services ke Store lokal).
 *
 * Setiap fungsi mengembalikan bentuk yang sama dengan backend lama:
 *   { success, data, message, errorCode }
 *
 * Mode lokal tidak punya auth sungguhan; user saat ini dianggap
 * admin. Saat adapter Firebase ditambahkan nanti, lapisan ini
 * tinggal diganti dengan pemanggilan Firestore + Auth.
 * ============================================================ */

(function (global) {
  'use strict';

  /* --- Konstanta (sama dengan Config.gs) ------------------------ */
  var STATUSES = [
    { id: 'backlog', label: 'Backlog' },
    { id: 'todo', label: 'To Do' },
    { id: 'in_progress', label: 'In Progress' },
    { id: 'review', label: 'Review' },
    { id: 'done', label: 'Done' },
  ];
  var PRIORITIES = [
    { id: 'critical', label: 'Critical' },
    { id: 'high', label: 'High' },
    { id: 'medium', label: 'Medium' },
    { id: 'low', label: 'Low' },
  ];
  var NODE_TYPES = ['start_end', 'process', 'task', 'decision', 'application', 'note', 'workflow_link'];
  var ROLES = ['admin', 'editor', 'viewer'];
  var APP_CATEGORIES = ['Communication', 'Documentation', 'Internal System', 'Dashboard', 'CRM', 'Form', 'Spreadsheet', 'Other'];
  // Departemen tetap (bisa dipilih lebih dari satu per workflow).
  var WORKFLOW_DEPARTMENTS = ['Breeder', 'Laboratorium', 'Plasma', 'Budidaya', 'Marketing', 'Keuangan', 'Data', 'EDP'];

  function isValidStatus(s) { return STATUSES.some(function (x) { return x.id === s; }); }
  function isValidPriority(p) { return PRIORITIES.some(function (x) { return x.id === p; }); }
  function isValidNodeType(t) { return NODE_TYPES.indexOf(t) !== -1; }
  function isValidRole(r) { return ROLES.indexOf(r) !== -1; }
  function isValidEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || '')); }
  function isValidDepartment(d) { return WORKFLOW_DEPARTMENTS.indexOf(d) !== -1; }
  function parseDepartments(raw) {
    if (!raw) return [];
    try {
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr.filter(function (d) { return isValidDepartment(d); });
    } catch (e) { return []; }
  }
  function normalizeDepartments(input) {
    if (!Array.isArray(input)) return [];
    var out = [];
    input.forEach(function (d) {
      var v = String(d || '').trim();
      if (isValidDepartment(v) && out.indexOf(v) === -1) out.push(v);
    });
    return out;
  }
  function normalizeCategory(input) {
    return String(input || '').trim().slice(0, 48);
  }

  // Tautan aplikasi ke workflow / node disimpan sebagai JSON di dokumen
  // workflow (kolom `app_links_json`). Tidak ada koleksi baru, jadi kuota
  // dan aturan Firestore yang sudah ada tetap dipakai.
  // Bentuk tiap entri:
  //   { id, app_id, custom_url, link_label, target_type, target_node_id,
  //     created_by, created_at }
  function parseWorkflowAppLinks(raw) {
    if (!raw) return [];
    try {
      var arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!Array.isArray(arr)) return [];
      return arr.filter(function (l) {
        return l && l.app_id;
      }).map(function (l) {
        return {
          id: String(l.id || ''),
          app_id: String(l.app_id),
          custom_url: String(l.custom_url || ''),
          link_label: String(l.link_label || ''),
          target_type: l.target_type === 'node' ? 'node' : 'workflow',
          target_node_id: String(l.target_node_id || ''),
          created_by: String(l.created_by || ''),
          created_at: String(l.created_at || ''),
        };
      });
    } catch (e) { return []; }
  }
  function isValidUrl(u) {
    if (!u || typeof u !== 'string') return false;
    try { var x = new URL(u); return x.protocol === 'http:' || x.protocol === 'https:'; }
    catch (e) { return false; }
  }
  function statusLabel(id) { var s = STATUSES.find(function (x) { return x.id === id; }); return s ? s.label : id; }
  function priorityLabel(id) { var p = PRIORITIES.find(function (x) { return x.id === id; }); return p ? p.label : id; }

  function apiSuccess(data, message) {
    return { success: true, data: data, message: message || null, errorCode: null };
  }
  function apiError(message, errorCode) {
    return { success: false, data: null, message: message, errorCode: errorCode || 'INTERNAL' };
  }

  /* --- Konteks user -------------------------------------------- */
  var LOCAL_USER = { uid: 'local-user', email: 'anda@flowspace.local', name: 'Anda' };

  function isFirebaseMode() {
    return !!(global.FlowFirebase && global.FlowFirebase.enabled);
  }

  function currentEmail() {
    if (isFirebaseMode() && global.FlowSession && global.FlowSession.email) {
      return String(global.FlowSession.email).toLowerCase();
    }
    return LOCAL_USER.email;
  }

  function currentDisplayName() {
    if (isFirebaseMode() && global.FlowSession && global.FlowSession.displayName) {
      return global.FlowSession.displayName;
    }
    return LOCAL_USER.name;
  }

  function ensureDefaultAppCategories() {
    try {
      var ws = currentWorkspace();
      var cats = Store.findBy('applicationCategories', 'workspace_id', ws.workspace_id);
      if (cats.length === 0) {
        var now = Store.nowIso();
        var defaults = ['Communication', 'Documentation', 'Internal System', 'Dashboard', 'CRM', 'Form', 'Spreadsheet', 'Other'];
        defaults.forEach(function (name, idx) {
          try {
            Store.insert('applicationCategories', {
              category_id: Store.generateId('appcat'),
              workspace_id: ws.workspace_id,
              name: name,
              sort_order: idx,
              created_at: now,
              updated_at: now,
            });
          } catch (e) {}
        });
      }
    } catch (e) {
      console.error('ensureDefaultAppCategories error', e);
    }
  }

  function ensureLocalSetup() {
    var wss = Store.readAll('workspaces').filter(function (w) { return w.status === 'active'; });

    if (wss.length === 0) {
      // Mode Firebase: workspace dibuat oleh adapter (admin pertama / onboarding).
      if (isFirebaseMode()) return null;
      var now = Store.nowIso();
      var wsId = Store.generateId('ws');
      Store.insert('workspaces', {
        workspace_id: wsId,
        workspace_name: 'FlowSpace Workspace',
        owner_email: currentEmail(),
        status: 'active',
        created_at: now,
        updated_at: now,
      });
      Store.insert('members', {
        member_id: Store.generateId('mem'),
        workspace_id: wsId,
        email: currentEmail(),
        display_name: LOCAL_USER.name,
        role: 'admin',
        member_status: 'active',
        created_at: now,
      });
      return Store.findById('workspaces', 'workspace_id', wsId);
    }

    var ws = wss[0];
    // Mode Firebase: dokumen member dikelola adapter (ID = uid), jadi
    // jangan pernah membuat baris member lokal dengan ID acak.
    if (isFirebaseMode()) return ws;

    // Pastikan admin lokal ada di members
    var mem = Store.findBy('members', 'workspace_id', ws.workspace_id)
      .filter(function (m) { return String(m.email).toLowerCase() === currentEmail(); });
    if (mem.length === 0) {
      Store.insert('members', {
        member_id: Store.generateId('mem'),
        workspace_id: ws.workspace_id,
        email: currentEmail(),
        display_name: LOCAL_USER.name,
        role: 'admin',
        member_status: 'active',
        created_at: Store.nowIso(),
      });
    }
    return ws;
  }

  function currentWorkspace() {
    var ws = ensureLocalSetup();
    if (!ws) throw new Error('Workspace belum siap. Muat ulang halaman lalu coba lagi.');
    return ws;
  }

  function currentMemberRow() {
    var ws = currentWorkspace();
    var rows = Store.findBy('members', 'workspace_id', ws.workspace_id);
    var email = currentEmail();
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].email).toLowerCase() === email) return rows[i];
    }
    return null;
  }

  function currentRole() {
    if (!isFirebaseMode()) return 'admin';
    var me = currentMemberRow();
    return me ? me.role : 'viewer';
  }

  function requireEditor() {
    var ws = currentWorkspace();
    // Mode lokal tidak punya auth; aturan sebenarnya ada di firestore.rules.
    if (!isFirebaseMode()) return ws;
    var role = currentRole();
    if (role !== 'admin' && role !== 'editor') {
      throw new Error('Peran Anda (viewer) hanya dapat melihat data.');
    }
    return ws;
  }
  function requireAdmin() {
    var ws = currentWorkspace();
    if (!isFirebaseMode()) return ws;
    if (currentRole() !== 'admin') {
      throw new Error('Hanya admin yang dapat melakukan aksi ini.');
    }
    return ws;
  }

  /* --- Date helpers -------------------------------------------- */
  // Kunci tanggal lokal (YYYY-MM-DD). String tanggal murni dipakai apa
  // adanya supaya tidak bergeser hari karena konversi ke UTC.
  function dateKey(value) {
    if (!value) return '';
    var m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    var d = new Date(value);
    if (isNaN(d.getTime())) return '';
    return [d.getFullYear(), ('0' + (d.getMonth() + 1)).slice(-2), ('0' + d.getDate()).slice(-2)].join('-');
  }
  function localTodayKey() { return dateKey(new Date()); }
  function addDaysKey(baseKey, days) {
    var m = String(baseKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return '';
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    d.setDate(d.getDate() + Number(days || 0));
    return dateKey(d);
  }
  function isTaskOverdue(task, today) {
    if (!task || task.status === 'done' || !task.due_date) return false;
    return dateKey(task.due_date) < (today || localTodayKey());
  }
  // Normalisasi email PIC -> uid anggota (dipakai untuk cek kepemilikan).
  function uidForEmail(email) {
    var target = String(email || '').toLowerCase();
    if (!target) return '';
    var ws = currentWorkspace();
    var rows = Store.findBy('members', 'workspace_id', ws.workspace_id);
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].email || '').toLowerCase() === target) return String(rows[i].member_id || '');
    }
    return '';
  }

  /* --- Kepemilikan task ---------------------------------------- */
  // Sumber kebenaran tetap firestore.rules; helper di sini hanya memberi
  // pesan yang jelas sebelum Store menulis optimistis.

  function currentUid() {
    if (isFirebaseMode() && global.FlowSession && global.FlowSession.uid) return String(global.FlowSession.uid);
    return isFirebaseMode() ? '' : LOCAL_USER.uid;
  }
  function isAdminUser() {
    return !isFirebaseMode() || currentRole() === 'admin';
  }
  function taskPicUid(task) {
    if (!task) return '';
    if (task.assignee_uid) return String(task.assignee_uid);
    return uidForEmail(task.assignee_email);
  }
  function isTaskUnassigned(task) {
    if (!task) return false;
    return !taskPicUid(task) && !String(task.assignee_email || '').trim();
  }
  function isTaskPic(task) {
    if (!task) return false;
    if (!isFirebaseMode()) return true;
    var uid = currentUid();
    if (uid && task.assignee_uid && String(task.assignee_uid) === uid) return true;
    var email = String(task.assignee_email || '').toLowerCase();
    return !!email && email === currentEmail();
  }
  function canManageTask(task) {
    if (!task) return false;
    if (isAdminUser()) return true;
    if (currentRole() !== 'editor') return false;
    return !isTaskUnassigned(task) && isTaskPic(task);
  }
  function taskOwnerLabel(task) {
    var member = null;
    if (task && task.assignee_email) {
      var rows = Store.findBy('members', 'workspace_id', currentWorkspace().workspace_id);
      for (var i = 0; i < rows.length; i++) {
        if (String(rows[i].email || '').toLowerCase() === String(task.assignee_email).toLowerCase()) { member = rows[i]; break; }
      }
    }
    return (member && member.display_name) || (task && task.assignee_email) || 'anggota lain';
  }
  // Melempar Error agar tertangkap callServer -> toast yang rapi.
  function requireTaskAccess(task, verb) {
    if (!isFirebaseMode()) return task;
    var role = currentRole();
    if (role === 'admin') return task;
    if (role !== 'editor') throw new Error('Peran Anda (viewer) hanya dapat melihat data.');
    if (isTaskUnassigned(task)) {
      throw new Error('Task ini belum memiliki PIC. Ambil task terlebih dahulu untuk ' + (verb || 'mengubahnya') + '.');
    }
    if (!isTaskPic(task)) {
      throw new Error('Hanya PIC task atau admin yang dapat ' + (verb || 'mengubah task ini') + '. Task ini milik ' + taskOwnerLabel(task) + '.');
    }
    return task;
  }
  function requireNodeTasksAccess(nodeId, actionLabel) {
    if (isAdminUser()) return;
    var blocked = tasksForNode(nodeId).filter(function (t) { return !canManageTask(t); });
    if (blocked.length > 0) {
      var names = blocked.map(taskOwnerLabel);
      var unique = names.filter(function (n, i) { return names.indexOf(n) === i; });
      throw new Error('Tidak dapat ' + (actionLabel || 'mengubah node') + ' karena berisi task milik ' + unique.join(', ') + '. Minta admin memindahkan task tersebut terlebih dahulu.');
    }
  }

  /* --- Komentar & chat ----------------------------------------- */
  // Komentar boleh ditulis semua anggota aktif (termasuk viewer).
  function requireMember() {
    var ws = currentWorkspace();
    if (!isFirebaseMode()) return ws;
    var me = currentMemberRow();
    if (!me || me.member_status !== 'active') {
      throw new Error('Akun Anda tidak aktif di workspace ini.');
    }
    return ws;
  }

  function commentRowsFor(entityType, entityId) {
    var ws = currentWorkspace();
    return Store.findBy('comments', 'workspace_id', ws.workspace_id).filter(function (c) {
      return String(c.entity_type) === String(entityType)
        && String(c.entity_id) === String(entityId)
        && !c.deleted_at;
    });
  }
  function commentCount(entityType, entityId) {
    return commentRowsFor(entityType, entityId).length;
  }
  function commentTargetExists(entityType, entityId) {
    if (!entityId) return false;
    var ws = currentWorkspace();
    if (entityType === 'task') {
      var t = Store.findById('tasks', 'task_id', entityId);
      return !!t && String(t.workspace_id) === String(ws.workspace_id);
    }
    if (entityType === 'workflow') {
      var w = Store.findById('workflows', 'workflow_id', entityId);
      return !!w && String(w.workspace_id) === String(ws.workspace_id);
    }
    if (entityType === 'node') {
      var n = Store.findById('nodes', 'node_id', entityId);
      if (!n) return false;
      var wf = Store.findById('workflows', 'workflow_id', n.workflow_id);
      return !!wf && String(wf.workspace_id) === String(ws.workspace_id);
    }
    return false;
  }
  function isMyComment(c) {
    if (!c) return false;
    if (c.created_by_uid && String(c.created_by_uid) === String(currentUid())) return true;
    return !!c.created_by_email && String(c.created_by_email).toLowerCase() === currentEmail();
  }
  function commentDto(c) {
    var mine = isMyComment(c);
    return {
      id: c.comment_id, entityType: c.entity_type, entityId: c.entity_id,
      body: c.body, authorUid: c.created_by_uid, authorEmail: c.created_by_email,
      authorName: c.created_by_name || c.created_by_email,
      createdAt: String(c.created_at || ''), editedAt: String(c.edited_at || ''),
      isEdited: !!c.edited_at,
      canEdit: mine && !c.deleted_at,
      canDelete: (mine || isAdminUser()) && !c.deleted_at,
    };
  }
  function cleanBody(value, label) {
    var body = String(value || '').trim();
    if (!body) throw new Error((label || 'Komentar') + ' tidak boleh kosong.');
    if (body.length > 2000) throw new Error((label || 'Komentar') + ' maksimal 2000 karakter.');
    return body;
  }

  /* --- Lampiran chat (referensi task/workflow) ------------------ */
  // Disimpan sebagai JSON string di chatMessages.attachments_json agar
  // bentuknya sama dengan kolom *_json lain dan mudah divalidasi rules.
  var MAX_ATTACHMENTS = 3;
  var MAX_ATTACHMENTS_JSON = 1500;

  function chatAttachmentsEnabled(type) {
    return type === 'task' || type === 'workflow';
  }

  function cleanAttachments(value) {
    if (!value) return [];
    if (!Array.isArray(value)) throw new Error('Lampiran tidak valid.');
    if (value.length > MAX_ATTACHMENTS) throw new Error('Maksimal ' + MAX_ATTACHMENTS + ' lampiran per pesan.');
    var out = [];
    var seen = {};
    value.forEach(function (a) {
      if (!a) return;
      var type = String(a.type || '');
      if (!chatAttachmentsEnabled(type)) throw new Error('Jenis lampiran tidak dikenal.');
      var id = String(a.id || '').trim();
      if (!id) throw new Error('Lampiran tidak valid.');
      if (!commentTargetExists(type, id)) throw new Error('Lampiran sudah tidak tersedia.');
      var key = type + ':' + id;
      if (seen[key]) return;
      seen[key] = true;
      out.push({
        type: type,
        id: id,
        title: String(a.title || '').trim().slice(0, 120),
        meta: String(a.meta || '').trim().slice(0, 60),
      });
    });
    if (JSON.stringify(out).length > MAX_ATTACHMENTS_JSON) {
      throw new Error('Lampiran terlalu besar.');
    }
    return out;
  }

  function parseAttachments(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    try {
      var parsed = JSON.parse(String(raw));
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function cleanChatBody(value) {
    var body = String(value || '').trim();
    if (body.length > 2000) throw new Error('Pesan maksimal 2000 karakter.');
    return body;
  }
  function getMemberDisplayName(email) {
    try {
      var ws = currentWorkspace();
      var rows = Store.findBy('members', 'workspace_id', ws.workspace_id);
      var key = String(email || '').toLowerCase();
      for (var i = 0; i < rows.length; i++) {
        if (String(rows[i].email || '').toLowerCase() === key && rows[i].display_name) {
          return rows[i].display_name;
        }
      }
    } catch (e) {}
    return '';
  }

  function chatDto(m) {
    var memberName = getMemberDisplayName(m.sender_email);
    return {
      id: m.message_id, body: m.body || '',
      attachments: parseAttachments(m.attachments_json),
      senderUid: m.sender_uid, senderEmail: m.sender_email,
      senderName: memberName || m.sender_name || m.sender_email,
      createdAt: String(m.created_at || ''), editedAt: String(m.edited_at || ''),
      deletedAt: String(m.deleted_at || ''), isDeleted: !!m.deleted_at,
      canEdit: isMyComment({ created_by_uid: m.sender_uid, created_by_email: m.sender_email }) && !m.deleted_at,
      canDelete: (isMyComment({ created_by_uid: m.sender_uid, created_by_email: m.sender_email }) || isAdminUser()) && !m.deleted_at,
    };
  }

  /* --- Member helpers ------------------------------------------ */
  function memberDto(m) {
    return {
      id: m.member_id,
      email: m.email,
      displayName: m.display_name,
      role: m.role,
      status: m.member_status,
      createdAt: String(m.created_at),
    };
  }
  function findMember(workspaceId, memberId) {
    var rows = Store.findBy('members', 'workspace_id', workspaceId);
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].member_id) === String(memberId)) return rows[i];
    }
    return null;
  }
  function isSelf(member) {
    return String(member.email || '').toLowerCase() === String(currentEmail()).toLowerCase();
  }
  function wouldRemoveLastAdmin(member, workspaceId) {
    if (member.role !== 'admin' || member.member_status !== 'active') return false;
    var activeAdmins = Store.findBy('members', 'workspace_id', workspaceId).filter(function (m) {
      return m.role === 'admin' && m.member_status === 'active';
    });
    return activeAdmins.length <= 1;
  }
  function isInviteId(id) {
    return String(id || '').indexOf('invite:') === 0;
  }
  function findInvite(workspaceId, email) {
    var target = String(email || '').toLowerCase();
    var rows = Store.findBy('invites', 'workspace_id', workspaceId);
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].email).toLowerCase() === target) return rows[i];
    }
    return null;
  }
  function inviteDto(inv) {
    return {
      id: 'invite:' + inv.email,
      email: inv.email,
      displayName: inv.display_name || String(inv.email).split('@')[0],
      role: inv.role,
      status: 'invited',
      createdAt: String(inv.created_at || ''),
      invitedBy: inv.invited_by || '',
    };
  }

  /* --- Relasi node <-> task ------------------------------------ */
  // Satu node boleh menampung beberapa task (maksimal 5).
  // tasks.node_id adalah sumber kebenaran; nodes.task_id hanya cache
  // task pertama agar data lama tetap kompatibel.
  var MAX_TASKS_PER_NODE = 5;

  function tasksForNode(nodeId) {
    if (!nodeId) return [];
    return Store.findBy('tasks', 'node_id', nodeId).slice().sort(function (a, b) {
      var ca = String(a.created_at || '');
      var cb = String(b.created_at || '');
      if (ca !== cb) return ca.localeCompare(cb);
      return String(a.task_id).localeCompare(String(b.task_id));
    });
  }

  function syncNodePrimaryTask(nodeId) {
    if (!nodeId) return;
    var n = Store.findById('nodes', 'node_id', nodeId);
    if (!n) return;
    var list = tasksForNode(nodeId);
    var primary = list.length > 0 ? list[0].task_id : '';
    if (String(n.task_id || '') !== String(primary)) {
      try { Store.update('nodes', 'node_id', nodeId, { task_id: primary, updated_at: Store.nowIso() }); } catch (e) {}
    }
  }

  /* --- Audit log ------------------------------------------------ */
  var Audit = {
    log: function (entry) {
      try {
        Store.insert('activityLogs', {
          log_id: Store.generateId('log'),
          workspace_id: entry.workspace_id || currentWorkspace().workspace_id,
          entity_type: entry.entity_type || '',
          entity_id: entry.entity_id || '',
          action: entry.action || '',
          actor_email: entry.actor_email || currentEmail(),
          old_value_json: entry.old_value_json || '',
          new_value_json: entry.new_value_json || '',
          created_at: Store.nowIso(),
        });
      } catch (e) { console.error('Audit log failed', e); }
    },
  };

  /* ============================================================
   * API publik (mirip fungsi di Code.gs)
   * ============================================================ */
  var Api = {

    /* --- Init --------------------------------------------------- */
    getInitialAppData: function () {
      try {
        var ws = ensureLocalSetup();
        if (!ws) return apiError('Workspace belum siap. Muat ulang halaman.', 'NO_WORKSPACE');

        var members = Store.findBy('members', 'workspace_id', ws.workspace_id).map(memberDto);
        var me = null;
        for (var i = 0; i < members.length; i++) {
          if (String(members[i].email).toLowerCase() === currentEmail()) { me = members[i]; break; }
        }
        return apiSuccess({
          workspace: { id: ws.workspace_id, name: ws.workspace_name, ownerEmail: ws.owner_email, status: ws.status },
          members: members,
          currentUser: {
            email: currentEmail(),
            displayName: me ? me.displayName : currentDisplayName(),
            role: me ? me.role : (isFirebaseMode() ? 'viewer' : 'admin'),
          },
          mode: isFirebaseMode() ? 'firebase' : 'local',
          projectId: isFirebaseMode() && global.FlowFirebase ? global.FlowFirebase.info().projectId : '',
          setupRequired: false,
        });
      } catch (err) {
        return apiError('Gagal memuat init data: ' + err.message, 'INTERNAL');
      }
    },

    /* --- Workflows ---------------------------------------------- */
    listWorkflows: function () {
      var ws = currentWorkspace();
      var workflows = Store.findBy('workflows', 'workspace_id', ws.workspace_id)
        .filter(function (w) { return w.status === 'active'; });
      var tasks = Store.findBy('tasks', 'workspace_id', ws.workspace_id);
      var result = workflows.map(function (w) {
        var wfTasks = tasks.filter(function (t) { return String(t.workflow_id) === String(w.workflow_id); });
        var sum = 0;
        wfTasks.forEach(function (t) { sum += Number(t.progress) || 0; });
        var avg = wfTasks.length > 0 ? Math.round(sum / wfTasks.length) : 0;
        return {
          id: w.workflow_id, name: w.workflow_name, description: w.description,
          departments: parseDepartments(w.departments_json), category: w.category || '',
          createdBy: w.created_by, status: w.status, version: Number(w.version) || 1,
          createdAt: String(w.created_at), updatedAt: String(w.updated_at),
          taskCount: wfTasks.length, progress: avg,
          commentCount: commentCount('workflow', w.workflow_id),
        };
      });
      result.sort(function (a, b) { return a.updatedAt < b.updatedAt ? 1 : -1; });
      return apiSuccess(result);
    },

    // Kategori workflow yang sudah pernah dipakai (untuk datalist di form).
    listWorkflowCategories: function () {
      var ws = currentWorkspace();
      var seen = {};
      var out = [];
      Store.findBy('workflows', 'workspace_id', ws.workspace_id).forEach(function (w) {
        var c = String(w.category || '').trim();
        if (!c) return;
        var key = c.toLowerCase();
        if (seen[key]) return;
        seen[key] = true;
        out.push(c);
      });
      out.sort(function (a, b) { return a.localeCompare(b); });
      return apiSuccess(out);
    },

    // Daftar departemen tetap (dipakai UI supaya tidak hardcode ganda).
    listWorkflowDepartments: function () {
      return apiSuccess(WORKFLOW_DEPARTMENTS.slice());
    },

    createWorkflow: function (payload) {
      requireEditor();
      if (!payload.name || !payload.name.trim()) return apiError('Nama workflow wajib diisi', 'VALIDATION');
      var ws = currentWorkspace();
      var now = Store.nowIso();
      var id = Store.generateId('wf');
      var departments = normalizeDepartments(payload.departments);
      var category = normalizeCategory(payload.category);
      Store.insert('workflows', {
        workflow_id: id, workspace_id: ws.workspace_id, workflow_name: payload.name.trim(),
        description: payload.description || '',
        departments_json: JSON.stringify(departments),
        category: category,
        canvas_settings_json: payload.canvas_settings_json || JSON.stringify({ zoom: 0.85, x: 0, y: 0 }),
        created_by: currentEmail(), created_at: now, updated_at: now, status: 'active', version: 1,
      });
      Audit.log({ entity_type: 'workflow', entity_id: id, action: 'create', new_value_json: JSON.stringify({ name: payload.name, departments: departments, category: category }) });
      return apiSuccess({ id: id }, 'Workflow dibuat');
    },

    updateWorkflow: function (payload) {
      requireEditor();
      var w = Store.findById('workflows', 'workflow_id', payload.id);
      if (!w) return apiError('Workflow tidak ditemukan', 'NOT_FOUND');
      if (payload.expectedVersion !== undefined && Number(payload.expectedVersion) !== Number(w.version)) {
        return apiError('Data berubah sejak terakhir dimuat. Muat ulang sebelum menyimpan.', 'VERSION_CONFLICT');
      }
      var patch = { updated_at: Store.nowIso(), version: Number(w.version) + 1 };
      if (typeof payload.name === 'string') patch.workflow_name = payload.name;
      if (typeof payload.description === 'string') patch.description = payload.description;
      if (payload.departments !== undefined) patch.departments_json = JSON.stringify(normalizeDepartments(payload.departments));
      if (payload.category !== undefined) patch.category = normalizeCategory(payload.category);
      if (payload.canvas_settings_json) patch.canvas_settings_json = payload.canvas_settings_json;
      if (payload.status === 'archived') patch.status = 'archived';
      Store.update('workflows', 'workflow_id', payload.id, patch);
      Audit.log({
        entity_type: 'workflow', entity_id: payload.id,
        action: payload.status === 'archived' ? 'archive' : 'update',
        old_value_json: JSON.stringify({ name: w.workflow_name, description: w.description, departments: parseDepartments(w.departments_json), category: w.category || '' }),
        new_value_json: JSON.stringify({
          name: patch.workflow_name, description: patch.description,
          departments: patch.departments_json ? JSON.parse(patch.departments_json) : parseDepartments(w.departments_json),
          category: patch.category !== undefined ? patch.category : (w.category || ''),
        }),
      });
      return apiSuccess({ id: payload.id, version: patch.version }, 'Workflow diperbarui');
    },

    deleteWorkflow: function (workflowId) {
      requireAdmin();
      var w = Store.findById('workflows', 'workflow_id', workflowId);
      if (!w) return apiError('Workflow tidak ditemukan', 'NOT_FOUND');
      Store.removeBy('edges', 'workflow_id', workflowId);
      var wfTasks = Store.findBy('tasks', 'workflow_id', workflowId);
      wfTasks.forEach(function (t) {
        Store.removeBy('taskApplications', 'task_id', t.task_id);
        Store.removeBy('checklist', 'task_id', t.task_id);
      });
      Store.removeBy('nodes', 'workflow_id', workflowId);
      Store.removeBy('tasks', 'workflow_id', workflowId);
      Store.remove('workflows', 'workflow_id', workflowId);
      Audit.log({ entity_type: 'workflow', entity_id: workflowId, action: 'delete', old_value_json: JSON.stringify({ name: w.workflow_name }) });
      return apiSuccess(null, 'Workflow dihapus');
    },

    duplicateWorkflow: function (workflowId) {
      requireEditor();
      var w = Store.findById('workflows', 'workflow_id', workflowId);
      if (!w) return apiError('Workflow tidak ditemukan', 'NOT_FOUND');
      var ws = currentWorkspace();
      var now = Store.nowIso();
      var newId = Store.generateId('wf');
      Store.insert('workflows', {
        workflow_id: newId, workspace_id: ws.workspace_id, workflow_name: w.workflow_name + ' (Salinan)',
        description: w.description, canvas_settings_json: w.canvas_settings_json,
        departments_json: w.departments_json || '[]', category: w.category || '',
        created_by: currentEmail(), created_at: now, updated_at: now, status: 'active', version: 1,
      });
      var nodeMap = {};
      Store.findBy('nodes', 'workflow_id', workflowId).forEach(function (n) {
        var newNodeId = Store.generateId('node');
        Store.insert('nodes', {
          node_id: newNodeId, workflow_id: newId, node_type: n.node_type, title: n.title,
          description: n.description, position_x: n.position_x, position_y: n.position_y,
          width: n.width, height: n.height, style_json: n.style_json,
          application_id: n.application_id || '', linked_workflow_id: n.linked_workflow_id || '', task_id: '',
          created_at: now, updated_at: now, version: 1,
        });
        nodeMap[n.node_id] = newNodeId;
      });
      Store.findBy('edges', 'workflow_id', workflowId).forEach(function (e) {
        var ns = nodeMap[e.source_node_id];
        var nt = nodeMap[e.target_node_id];
        if (ns && nt) {
          Store.insert('edges', {
            edge_id: Store.generateId('edge'), workflow_id: newId,
            source_node_id: ns, target_node_id: nt, label: e.label || '', condition: e.condition || '',
            source_output: e.source_output || 'output_1', target_input: e.target_input || 'input_1',
            created_at: now, updated_at: now,
          });
        }
      });
      Audit.log({ entity_type: 'workflow', entity_id: newId, action: 'duplicate', new_value_json: JSON.stringify({ name: newId, sourceId: workflowId }) });
      return apiSuccess({ id: newId }, 'Workflow diduplikasi');
    },

    /* --- Canvas ------------------------------------------------- */
    getWorkflowCanvas: function (workflowId) {
      var ws = currentWorkspace();
      var w = Store.findById('workflows', 'workflow_id', workflowId);
      if (!w || String(w.workspace_id) !== String(ws.workspace_id)) return apiError('Workflow tidak ditemukan', 'NOT_FOUND');
      var nodes = Store.findBy('nodes', 'workflow_id', workflowId);
      var edges = Store.findBy('edges', 'workflow_id', workflowId);
      var taskMap = {};
      var tasksByNode = {};
      Store.findBy('tasks', 'workspace_id', ws.workspace_id).forEach(function (t) {
        taskMap[t.task_id] = t;
        if (t.node_id) {
          var key = String(t.node_id);
          if (!tasksByNode[key]) tasksByNode[key] = [];
          tasksByNode[key].push(t);
        }
      });
      var appMap = {};
      Store.findBy('applications', 'workspace_id', ws.workspace_id).forEach(function (a) { appMap[a.app_id] = a; });
      var taskAppsMap = {};
      Object.keys(taskMap).forEach(function (taskId) {
        taskAppsMap[taskId] = Store.findBy('taskApplications', 'task_id', taskId).map(function (ta) {
          var app = appMap[ta.app_id] || {};
          return {
            id: app.app_id, taskAppId: ta.task_app_id, name: app.app_name,
            url: ta.custom_url || app.app_url, category: app.category,
            iconUrl: app.icon_url, linkLabel: ta.link_label,
          };
        });
      });

      var taskPayload = function (t) {
        return {
          id: t.task_id, title: t.title, status: t.status, priority: t.priority,
          progress: Number(t.progress) || 0, assigneeEmail: t.assignee_email, dueDate: t.due_date,
          applications: taskAppsMap[t.task_id] || [],
          commentCount: commentCount('task', t.task_id),
        };
      };

      var nodesPayload = nodes.map(function (n) {
        var nodeTasks = (tasksByNode[String(n.node_id)] || []).slice();
        // Data lama: nodes.task_id mungkin belum tercermin di tasks.node_id.
        if (n.task_id && taskMap[n.task_id]) {
          var legacy = taskMap[n.task_id];
          var already = nodeTasks.some(function (x) { return String(x.task_id) === String(legacy.task_id); });
          if (!already && (!legacy.node_id || String(legacy.node_id) === String(n.node_id))) {
            nodeTasks.unshift(legacy);
          }
        }
        nodeTasks.sort(function (a, b) {
          var ca = String(a.created_at || '');
          var cb = String(b.created_at || '');
          if (ca !== cb) return ca.localeCompare(cb);
          return String(a.task_id).localeCompare(String(b.task_id));
        });
        var mapped = nodeTasks.map(taskPayload);
        var totalProgress = mapped.reduce(function (sum, t) { return sum + (Number(t.progress) || 0); }, 0);
        var avgProgress = mapped.length > 0 ? Math.round(totalProgress / mapped.length) : 0;
        var linkedWf = n.linked_workflow_id ? Store.findById('workflows', 'workflow_id', n.linked_workflow_id) : null;
        return {
          id: n.node_id, nodeType: n.node_type, title: n.title, description: n.description,
          positionX: Number(n.position_x) || 0, positionY: Number(n.position_y) || 0,
          width: Number(n.width) || 180, height: Number(n.height) || 80,
          styleJson: n.style_json || '{}', applicationId: n.application_id || null,
          taskId: mapped.length > 0 ? mapped[0].id : null,
          tasks: mapped, taskCount: mapped.length, progress: avgProgress,
          linkedWorkflowId: (n.node_type === 'workflow_link' && n.linked_workflow_id) ? n.linked_workflow_id : null,
          linkedWorkflowName: linkedWf ? linkedWf.workflow_name : '',
          task: mapped[0] || null,
          commentCount: commentCount('node', n.node_id),
        };
      });

      var edgesPayload = edges.map(function (e) {
        var points = [];
        try {
          if (e.points_json) points = typeof e.points_json === 'string' ? JSON.parse(e.points_json) : e.points_json;
        } catch (ex) {}
        return {
          id: e.edge_id, source: e.source_node_id, target: e.target_node_id,
          label: e.label || '', condition: e.condition || '',
          sourceOutput: e.source_output || 'output_1', targetInput: e.target_input || 'input_1',
          points: Array.isArray(points) ? points : [],
        };
      });

      var wfTaskCount = 0;
      var wfProgressSum = 0;
      Store.findBy('tasks', 'workspace_id', ws.workspace_id).forEach(function (t) {
        if (String(t.workflow_id) !== String(w.workflow_id)) return;
        wfTaskCount++;
        wfProgressSum += Number(t.progress) || 0;
      });
      return apiSuccess({
        workflowId: w.workflow_id, workflowName: w.workflow_name, description: w.description,
        category: w.category || '', departments: parseDepartments(w.departments_json),
        version: Number(w.version) || 1, canvasSettings: w.canvas_settings_json,
        nodes: nodesPayload, edges: edgesPayload,
        taskCount: wfTaskCount,
        progress: wfTaskCount > 0 ? Math.round(wfProgressSum / wfTaskCount) : 0,
        commentCount: commentCount('workflow', w.workflow_id),
      });
    },

    saveCanvasLayout: function (payload) {
      requireEditor();
      var ws = currentWorkspace();
      var w = Store.findById('workflows', 'workflow_id', payload.workflowId);
      if (!w || String(w.workspace_id) !== String(ws.workspace_id)) return apiError('Workflow tidak ditemukan', 'NOT_FOUND');
      if (payload.expectedVersion !== undefined && Number(payload.expectedVersion) !== Number(w.version)) {
        return apiError('Data berubah sejak terakhir dimuat. Muat ulang sebelum menyimpan.', 'VERSION_CONFLICT');
      }

      var now = Store.nowIso();
      var nodes = payload.nodes || [];
      var edges = payload.edges || [];
      var canvasSettings = typeof payload.canvasSettings === 'string'
        ? payload.canvasSettings : JSON.stringify(payload.canvasSettings || {});

      // Cek lebih dulu sebelum ada perubahan: editor tidak boleh melepas
      // task PIC lain dari node (termasuk lewat hapus node).
      var existingNodes = Store.findBy('nodes', 'workflow_id', payload.workflowId);
      var existingIdsMap = {};
      existingNodes.forEach(function (n) { existingIdsMap[n.node_id] = n; });
      var incomingIdsMap = {};
      nodes.forEach(function (n) { incomingIdsMap[n.id] = true; });
      existingNodes.forEach(function (n) {
        if (!incomingIdsMap[n.node_id]) requireNodeTasksAccess(n.node_id, 'menghapus node');
      });

      Store.removeBy('edges', 'workflow_id', payload.workflowId);

      existingNodes.forEach(function (n) {
        if (!incomingIdsMap[n.node_id]) {
          tasksForNode(n.node_id).forEach(function (t) {
            Store.update('tasks', 'task_id', t.task_id, { node_id: '', updated_at: now, version: (Number(t.version) || 1) + 1 });
          });
          Store.remove('nodes', 'node_id', n.node_id);
        }
      });

      nodes.forEach(function (n) {
        var existing = existingIdsMap[n.id];
        var nodeData = {
          workflow_id: payload.workflowId,
          node_type: n.nodeType || 'process',
          title: n.title || 'Untitled',
          description: n.description || '',
          position_x: Number(n.positionX) || 0,
          position_y: Number(n.positionY) || 0,
          width: Number(n.width) || 180,
          height: Number(n.height) || 80,
          style_json: typeof n.styleJson === 'string' ? n.styleJson : JSON.stringify(n.styleJson || {}),
          application_id: n.applicationId || '',
          linked_workflow_id: n.nodeType === 'workflow_link' ? (n.linkedWorkflowId || '') : '',
          task_id: n.taskId || (existing ? existing.task_id : ''),
          updated_at: now,
          version: existing ? (Number(existing.version) || 1) + 1 : 1,
        };
        if (existing) {
          Store.update('nodes', 'node_id', n.id, nodeData);
        } else {
          nodeData.node_id = n.id;
          nodeData.created_at = now;
          Store.insert('nodes', nodeData);
        }
        // Data lama: tautan task mungkin baru tersimpan di nodes.task_id.
        if (n.taskId) {
          var legacyTask = Store.findById('tasks', 'task_id', n.taskId);
          if (legacyTask && !legacyTask.node_id && canManageTask(legacyTask)) {
            Store.update('tasks', 'task_id', n.taskId, { node_id: n.id, updated_at: now, version: (Number(legacyTask.version) || 1) + 1 });
          }
        }
        syncNodePrimaryTask(n.id);
      });

      var newEdges = edges.map(function (e) {
        var pts = Array.isArray(e.points) ? e.points : [];
        return {
          edge_id: e.id || Store.generateId('edge'),
          workflow_id: payload.workflowId,
          source_node_id: e.source, target_node_id: e.target,
          label: e.label || '', condition: e.condition || '',
          source_output: e.sourceOutput || 'output_1', target_input: e.targetInput || 'input_1',
          points_json: JSON.stringify(pts),
          created_at: now, updated_at: now,
        };
      });
      if (newEdges.length > 0) Store.batchInsert('edges', newEdges);

      var newVersion = Number(w.version) + 1;
      Store.update('workflows', 'workflow_id', payload.workflowId, {
        canvas_settings_json: canvasSettings, version: newVersion, updated_at: now,
      });
      Audit.log({ entity_type: 'workflow', entity_id: payload.workflowId, action: 'canvas_save', new_value_json: JSON.stringify({ nodesCount: nodes.length, edgesCount: edges.length }) });
      return apiSuccess({ version: newVersion }, 'Canvas tersimpan');
    },

    createNode: function (payload) {
      requireEditor();
      var id = payload.id || Store.generateId('node');
      var now = Store.nowIso();
      Store.insert('nodes', {
        node_id: id, workflow_id: payload.workflow_id,
        node_type: isValidNodeType(payload.node_type) ? payload.node_type : 'process',
        title: payload.title || 'Node Baru', description: payload.description || '',
        position_x: Number(payload.position_x) || 0, position_y: Number(payload.position_y) || 0,
        width: Number(payload.width) || 180, height: Number(payload.height) || 80,
        style_json: payload.style_json || '{}', application_id: payload.application_id || '',
        linked_workflow_id: payload.node_type === 'workflow_link' ? (payload.linked_workflow_id || '') : '',
        task_id: payload.task_id || '', created_at: now, updated_at: now, version: 1,
      });
      return apiSuccess({ id: id }, 'Node dibuat');
    },

    updateNode: function (payload) {
      requireEditor();
      var n = Store.findById('nodes', 'node_id', payload.id);
      if (!n) return apiError('Node tidak ditemukan', 'NOT_FOUND');
      var patch = { updated_at: Store.nowIso(), version: (Number(n.version) || 1) + 1 };
      if (typeof payload.title === 'string') patch.title = payload.title;
      if (typeof payload.description === 'string') patch.description = payload.description;
      var nt = payload.node_type || payload.nodeType;
      if (nt && isValidNodeType(nt)) patch.node_type = nt;
      if (typeof payload.position_x === 'number') patch.position_x = payload.position_x;
      if (typeof payload.position_y === 'number') patch.position_y = payload.position_y;
      if (typeof payload.positionX === 'number') patch.position_x = payload.positionX;
      if (typeof payload.positionY === 'number') patch.position_y = payload.positionY;
      if (typeof payload.width === 'number') patch.width = payload.width;
      if (typeof payload.height === 'number') patch.height = payload.height;
      if (payload.task_id !== undefined) patch.task_id = payload.task_id;
      if (payload.taskId !== undefined) patch.task_id = payload.taskId || '';
      if (payload.application_id !== undefined) patch.application_id = payload.application_id;
      if (payload.applicationId !== undefined) patch.application_id = payload.applicationId || '';
      if (payload.linked_workflow_id !== undefined) patch.linked_workflow_id = payload.linked_workflow_id || '';
      if (payload.linkedWorkflowId !== undefined) patch.linked_workflow_id = payload.linkedWorkflowId || '';
      // Fitur tautan workflow hanya berlaku untuk tipe node workflow_link.
      var effectiveType = patch.node_type || n.node_type;
      if (effectiveType !== 'workflow_link') patch.linked_workflow_id = '';
      Store.update('nodes', 'node_id', payload.id, patch);
      return apiSuccess({ id: payload.id }, 'Node diperbarui');
    },

    linkTaskToNode: function (payload) {
      requireEditor();
      if (!payload.taskId || !payload.nodeId) return apiError('taskId dan nodeId wajib diisi', 'VALIDATION');
      var ws = currentWorkspace();
      var t = Store.findById('tasks', 'task_id', payload.taskId);
      var n = Store.findById('nodes', 'node_id', payload.nodeId);
      if (!t || !n) return apiError('Task/Node tidak ditemukan', 'NOT_FOUND');
      requireTaskAccess(t, 'menautkan task ini ke node');
      if (!t.workspace_id) {
        try { Store.update('tasks', 'task_id', t.task_id, { workspace_id: ws.workspace_id }); } catch (e) {}
        t.workspace_id = ws.workspace_id;
      }
      if (String(t.workspace_id) !== String(ws.workspace_id)) return apiError('Task tidak ditemukan', 'NOT_FOUND');
      if (!n.workspace_id) {
        try { Store.update('nodes', 'node_id', n.node_id, { workspace_id: ws.workspace_id }); } catch (e) {}
        n.workspace_id = ws.workspace_id;
      }
      // Sudah menempel di node ini: tidak ada yang perlu diubah.
      if (String(t.node_id || '') === String(payload.nodeId)) {
        return apiSuccess({ ok: true, alreadyLinked: true, taskCount: tasksForNode(payload.nodeId).length });
      }
      var existingOnNode = tasksForNode(payload.nodeId);
      if (existingOnNode.length >= MAX_TASKS_PER_NODE) {
        return apiError('Maksimal ' + MAX_TASKS_PER_NODE + ' task per node', 'LIMIT');
      }
      var previousNodeId = t.node_id || '';
      if (n.workflow_id && (!t.workflow_id || String(t.workflow_id) !== String(n.workflow_id))) {
        try { Store.update('tasks', 'task_id', t.task_id, { workflow_id: n.workflow_id, updated_at: Store.nowIso() }); } catch (e) {}
        t.workflow_id = n.workflow_id;
      }
      try {
        Store.update('tasks', 'task_id', t.task_id, {
          node_id: payload.nodeId, updated_at: Store.nowIso(), version: (Number(t.version) || 1) + 1,
        });
      } catch (e) {}
      // Task pindah node: sinkronkan cache task pertama di node lama & baru.
      if (previousNodeId && String(previousNodeId) !== String(payload.nodeId)) syncNodePrimaryTask(previousNodeId);
      syncNodePrimaryTask(payload.nodeId);
      try { Audit.log({ entity_type: 'task', entity_id: payload.taskId, action: 'link_node', new_value_json: JSON.stringify({ nodeId: payload.nodeId }) }); } catch (e) {}
      return apiSuccess({ ok: true, taskCount: existingOnNode.length + 1 });
    },

    unlinkTaskFromNode: function (payload) {
      requireEditor();
      if (!payload.taskId) return apiError('taskId wajib diisi', 'VALIDATION');
      var ws = currentWorkspace();
      var t = Store.findById('tasks', 'task_id', payload.taskId);
      if (!t || String(t.workspace_id) !== String(ws.workspace_id)) return apiError('Task tidak ditemukan', 'NOT_FOUND');
      requireTaskAccess(t, 'melepas task ini dari node');
      var oldNodeId = t.node_id || '';
      Store.update('tasks', 'task_id', t.task_id, { node_id: '', updated_at: Store.nowIso(), version: (Number(t.version) || 1) + 1 });
      if (oldNodeId) syncNodePrimaryTask(oldNodeId);
      Audit.log({ entity_type: 'task', entity_id: payload.taskId, action: 'unlink_node', old_value_json: JSON.stringify({ nodeId: oldNodeId }) });
      return apiSuccess({ ok: true, taskCount: oldNodeId ? tasksForNode(oldNodeId).length : 0 });
    },

    deleteNode: function (nodeId) {
      requireEditor();
      var n = Store.findById('nodes', 'node_id', nodeId);
      if (!n) return apiError('Node tidak ditemukan', 'NOT_FOUND');
      requireNodeTasksAccess(nodeId, 'menghapus node');
      tasksForNode(nodeId).forEach(function (t) {
        Store.update('tasks', 'task_id', t.task_id, { node_id: '', updated_at: Store.nowIso(), version: (Number(t.version) || 1) + 1 });
      });
      Store.removeBy('edges', 'source_node_id', nodeId);
      Store.removeBy('edges', 'target_node_id', nodeId);
      Store.remove('nodes', 'node_id', nodeId);
      return apiSuccess(null, 'Node dihapus');
    },

    createEdge: function (payload) {
      requireEditor();
      var s = Store.findById('nodes', 'node_id', payload.source_node_id);
      var t = Store.findById('nodes', 'node_id', payload.target_node_id);
      if (!s || !t) return apiError('Node tidak ditemukan', 'NOT_FOUND');
      if (String(s.workflow_id) !== String(t.workflow_id)) return apiError('Node asal dan tujuan harus dari workflow yang sama', 'VALIDATION');
      if (String(payload.source_node_id) === String(payload.target_node_id)) return apiError('Node tidak bisa terhubung ke dirinya sendiri', 'VALIDATION');
      var id = payload.id || Store.generateId('edge');
      var now = Store.nowIso();
      Store.insert('edges', {
        edge_id: id, workflow_id: s.workflow_id,
        source_node_id: payload.source_node_id, target_node_id: payload.target_node_id,
        label: payload.label || '', condition: payload.condition || '',
        source_output: payload.source_output || 'output_1', target_input: payload.target_input || 'input_1',
        created_at: now, updated_at: now,
      });
      return apiSuccess({ id: id }, 'Koneksi dibuat');
    },

    deleteEdge: function (edgeId) {
      requireEditor();
      Store.remove('edges', 'edge_id', edgeId);
      return apiSuccess(null, 'Koneksi dihapus');
    },

    /* --- Tasks -------------------------------------------------- */
    listTasks: function (filters) {
      var ws = currentWorkspace();
      var tasks = Store.findBy('tasks', 'workspace_id', ws.workspace_id);
      var workflowMap = {};
      Store.findBy('workflows', 'workspace_id', ws.workspace_id).forEach(function (w) { workflowMap[w.workflow_id] = w; });
      var appMap = {};
      Store.findBy('applications', 'workspace_id', ws.workspace_id).forEach(function (a) { appMap[a.app_id] = a; });
      var allTaskApps = Store.readAll('taskApplications');

      filters = filters || {};
      if (filters.workflowId) tasks = tasks.filter(function (t) { return String(t.workflow_id) === String(filters.workflowId); });
      if (filters.status) tasks = tasks.filter(function (t) { return String(t.status) === String(filters.status); });
      if (filters.assigneeEmail) tasks = tasks.filter(function (t) { return String(t.assignee_email) === String(filters.assigneeEmail); });
      if (filters.priority) tasks = tasks.filter(function (t) { return String(t.priority) === String(filters.priority); });
      if (filters.q) {
        var q = String(filters.q).toLowerCase();
        tasks = tasks.filter(function (t) { return String(t.title).toLowerCase().indexOf(q) !== -1; });
      }

      var result = tasks.map(function (t) {
        var wf = workflowMap[t.workflow_id] || {};
        var apps = allTaskApps.filter(function (ta) { return String(ta.task_id) === String(t.task_id); }).map(function (ta) {
          var app = appMap[ta.app_id] || {};
          return {
            id: app.app_id, taskAppId: ta.task_app_id, name: app.app_name,
            url: ta.custom_url || app.app_url, category: app.category,
            iconUrl: app.icon_url, linkLabel: ta.link_label,
          };
        });
        return {
          id: t.task_id, title: t.title, description: t.description,
          workflowId: t.workflow_id, workflowName: wf.workflow_name || '',
          nodeId: t.node_id || null, assigneeEmail: t.assignee_email || null,
          assigneeUid: t.assignee_uid || '', canEdit: canManageTask(t),
          status: t.status, priority: t.priority, progress: Number(t.progress) || 0,
          progressMode: t.progress_mode, startDate: t.start_date || null, dueDate: t.due_date || null,
          version: Number(t.version) || 1, createdAt: String(t.created_at), updatedAt: String(t.updated_at),
          applications: apps,
          commentCount: commentCount('task', t.task_id),
        };
      });
      return apiSuccess(result);
    },

    getTask: function (taskId) {
      var ws = currentWorkspace();
      var t = Store.findById('tasks', 'task_id', taskId);
      if (!t || String(t.workspace_id) !== String(ws.workspace_id)) return apiError('Task tidak ditemukan', 'NOT_FOUND');
      var wf = Store.findById('workflows', 'workflow_id', t.workflow_id) || {};
      var node = null;
      if (t.node_id) {
        var n = Store.findById('nodes', 'node_id', t.node_id);
        if (n) node = { id: n.node_id, title: n.title };
      }
      var apps = Store.findBy('taskApplications', 'task_id', taskId).map(function (ta) {
        var app = Store.findById('applications', 'app_id', ta.app_id) || {};
        return {
          id: app.app_id, taskAppId: ta.task_app_id, name: app.app_name,
          url: ta.custom_url || app.app_url, category: app.category,
          iconUrl: app.icon_url, linkLabel: ta.link_label,
        };
      });
      var checklist = Store.findBy('checklist', 'task_id', taskId).map(function (c) {
        return { id: c.checklist_id, title: c.item_title, isCompleted: String(c.is_completed) === 'true', sortOrder: Number(c.sort_order) || 0 };
      });
      checklist.sort(function (a, b) { return a.sortOrder - b.sortOrder; });
      return apiSuccess({
        id: t.task_id, title: t.title, description: t.description,
        workflowId: t.workflow_id, workflowName: wf.workflow_name || '',
        nodeId: t.node_id || null, nodeTitle: node ? node.title : '',
        assigneeEmail: t.assignee_email || null, assigneeUid: t.assignee_uid || '',
        canEdit: canManageTask(t), isUnassigned: isTaskUnassigned(t),
        status: t.status, priority: t.priority,
        progress: Number(t.progress) || 0, progressMode: t.progress_mode,
        startDate: t.start_date || null, dueDate: t.due_date || null,
        version: Number(t.version) || 1, createdAt: String(t.created_at), updatedAt: String(t.updated_at),
        applications: apps, checklist: checklist,
        commentCount: commentCount('task', t.task_id),
      });
    },

    createTask: function (payload) {
      requireEditor();
      if (!payload.title) return apiError('Judul task wajib diisi', 'VALIDATION');
      if (payload.status && !isValidStatus(payload.status)) return apiError('Status tidak valid', 'VALIDATION');
      if (payload.priority && !isValidPriority(payload.priority)) return apiError('Priority tidak valid', 'VALIDATION');
      var ws = currentWorkspace();
      // Editor hanya boleh membuat task untuk dirinya sendiri; penugasan ke
      // anggota lain adalah hak admin.
      var assigneeEmail = String(payload.assignee_email || '').trim().toLowerCase();
      if (isFirebaseMode() && !isAdminUser()) {
        if (assigneeEmail && assigneeEmail !== currentEmail()) {
          return apiError('Anda hanya dapat membuat task untuk diri sendiri. Penugasan ke anggota lain dilakukan oleh admin.', 'FORBIDDEN');
        }
        assigneeEmail = currentEmail();
      }
      var assigneeUid = uidForEmail(assigneeEmail);
      // Workflow opsional: task boleh berdiri sendiri (mis. dibuat dari Kanban)
      // dan tetap bisa dihubungkan ke node/workflow nanti.
      var workflowId = payload.workflow_id || '';
      if (payload.node_id && !workflowId) {
        var linkedNode = Store.findById('nodes', 'node_id', payload.node_id);
        if (linkedNode && linkedNode.workflow_id) workflowId = linkedNode.workflow_id;
      }
      if (workflowId) {
        var wf = Store.findById('workflows', 'workflow_id', workflowId);
        if (!wf) return apiError('Workflow tidak ditemukan', 'NOT_FOUND');
      }
      // Batasi jumlah task per node (maksimal 5).
      var targetNode = payload.node_id ? Store.findById('nodes', 'node_id', payload.node_id) : null;
      if (targetNode && tasksForNode(payload.node_id).length >= MAX_TASKS_PER_NODE) {
        return apiError('Maksimal ' + MAX_TASKS_PER_NODE + ' task per node', 'LIMIT');
      }
      // Siapkan aplikasi terkait (dari modal "Tautkan Aplikasi") lebih dulu
      // supaya validasi tidak meninggalkan task setengah jadi.
      var rawAppLinks = Array.isArray(payload.appLinks) ? payload.appLinks : [];
      if (rawAppLinks.length === 0 && Array.isArray(payload.appIds)) {
        rawAppLinks = payload.appIds.map(function (appId) { return { appId: appId }; });
      }
      var resolvedApps = [];
      var seenApps = {};
      var seenUrls = {};
      var appLinksError = '';
      rawAppLinks.forEach(function (item) {
        var isObj = item && typeof item === 'object';
        var linkLabel = isObj && item.linkLabel ? String(item.linkLabel).trim() : '';
        // Link aplikasi baru: dibuatkan entri Application Hub saat task disimpan.
        if (isObj && item.newApp) {
          var newName = String(item.newApp.name || '').trim();
          var newUrl = String(item.newApp.url || '').trim();
          if (!newName || !newUrl) { appLinksError = 'Nama dan URL aplikasi baru wajib diisi'; return; }
          if (!isValidUrl(newUrl)) { appLinksError = 'URL aplikasi baru tidak valid (hanya http/https)'; return; }
          var urlKey = newUrl.toLowerCase();
          if (seenUrls[urlKey]) return;
          seenUrls[urlKey] = true;
          resolvedApps.push({
            newApp: { name: newName, url: newUrl, category: item.newApp.category || 'Other' },
            linkLabel: linkLabel,
          });
          return;
        }
        var appId = isObj ? item.appId : item;
        if (!appId || seenApps[String(appId)]) return;
        var app = Store.findById('applications', 'app_id', appId);
        if (!app || String(app.workspace_id) !== String(ws.workspace_id)) return;
        var customUrl = isObj && item.customUrl ? String(item.customUrl).trim() : '';
        if (customUrl && !isValidUrl(customUrl)) { appLinksError = 'Custom URL tidak valid'; return; }
        seenApps[String(appId)] = true;
        resolvedApps.push({
          appId: app.app_id,
          customUrl: customUrl,
          linkLabel: linkLabel,
        });
      });
      if (appLinksError) return apiError(appLinksError, 'VALIDATION');
      var id = Store.generateId('task');
      var now = Store.nowIso();
      var progress = Number(payload.progress) || 0;
      if (progress < 0) progress = 0;
      if (progress > 100) progress = 100;
      if (payload.status === 'done' && payload.progress === undefined) progress = 100;

      Store.insert('tasks', {
        task_id: id, workspace_id: ws.workspace_id, workflow_id: workflowId,
        node_id: payload.node_id || '', title: payload.title, description: payload.description || '',
        assignee_email: assigneeEmail, assignee_uid: assigneeUid,
        status: payload.status || 'backlog',
        priority: payload.priority || 'medium', progress: progress,
        progress_mode: payload.progress_mode || 'manual',
        start_date: payload.start_date || '', due_date: payload.due_date || '',
        completed_at: (payload.status === 'done') ? now : '',
        created_by: currentEmail(), created_at: now, updated_at: now,
        updated_by_uid: currentUid(), version: 1,
      });
      if (payload.node_id) syncNodePrimaryTask(payload.node_id);

      // Checklist awal (todolist) yang diisi saat membuat task.
      var checklistItems = Array.isArray(payload.checklist) ? payload.checklist : [];
      checklistItems.forEach(function (title, idx) {
        var clean = String(title || '').trim();
        if (!clean) return;
        Store.insert('checklist', {
          checklist_id: Store.generateId('cli'), task_id: id, item_title: clean,
          is_completed: 'false', sort_order: idx,
          created_by: currentEmail(), created_at: now, updated_at: now,
        });
      });

      // Aplikasi terkait yang sudah dipilih lewat modal.
      var linkedAppIds = {};
      resolvedApps.forEach(function (link) {
        var app = link.newApp
          ? ensureApplicationFromLink(link.newApp)
          : Store.findById('applications', 'app_id', link.appId);
        if (!app) return;
        if (linkedAppIds[String(app.app_id)]) return;
        linkedAppIds[String(app.app_id)] = true;
        Store.insert('taskApplications', {
          task_app_id: Store.generateId('ta'), task_id: id, app_id: app.app_id,
          custom_url: link.customUrl || '', link_label: link.linkLabel || '',
          created_by: currentEmail(), created_at: now,
        });
      });

      Audit.log({
        entity_type: 'task', entity_id: id, action: 'create',
        new_value_json: JSON.stringify({
          title: payload.title, status: payload.status || 'backlog', priority: payload.priority || 'medium',
          // assignee disimpan agar notifikasi "task baru untuk saya" bisa
          // diturunkan dari activity log, bukan hanya dari tebakan tasks.
          assignee_email: assigneeEmail || '', assignee_uid: assigneeUid || '',
          workflow_id: workflowId || null, checklist: checklistItems.length, applications: resolvedApps.length,
        }),
      });
      return apiSuccess({ id: id, version: 1 }, 'Task dibuat');
    },

    updateTask: function (payload) {
      requireEditor();
      var t = Store.findById('tasks', 'task_id', payload.id);
      if (!t) return apiError('Task tidak ditemukan', 'NOT_FOUND');
      if (payload.expectedVersion !== undefined && Number(payload.expectedVersion) !== Number(t.version)) {
        return apiError('Data berubah sejak terakhir dimuat. Muat ulang sebelum menyimpan.', 'VERSION_CONFLICT');
      }
      if (payload.status && !isValidStatus(payload.status)) return apiError('Status tidak valid', 'VALIDATION');
      if (payload.priority && !isValidPriority(payload.priority)) return apiError('Priority tidak valid', 'VALIDATION');

      // Admin bebas; editor hanya boleh mengubah task miliknya (PIC).
      requireTaskAccess(t, 'mengubah task ini');

      // Perpindahan PIC: hanya admin. PIC sendiri boleh melepas ke "Tanpa PIC".
      if (payload.assigneeEmail !== undefined) {
        var requestedEmail = String(payload.assigneeEmail || '').trim().toLowerCase();
        var currentPicEmail = String(t.assignee_email || '').toLowerCase();
        if (requestedEmail !== currentPicEmail && !isAdminUser()
            && requestedEmail !== '' && requestedEmail !== currentEmail()) {
          return apiError('Hanya admin yang dapat memindahkan PIC ke anggota lain. Anda hanya dapat melepas task menjadi "Tanpa PIC".', 'FORBIDDEN');
        }
      }

      var patch = { updated_at: Store.nowIso(), version: Number(t.version) + 1, updated_by_uid: currentUid() };
      var oldValue = {};
      var fields = ['title', 'description', 'assignee_email', 'status', 'priority', 'progress', 'progress_mode', 'start_date', 'due_date', 'node_id'];
      var fieldMap = { title: 'title', description: 'description', assignee_email: 'assigneeEmail', status: 'status', priority: 'priority', progress: 'progress', progress_mode: 'progressMode', start_date: 'startDate', due_date: 'dueDate', node_id: 'nodeId' };
      fields.forEach(function (f) {
        var camelKey = fieldMap[f];
        if (payload[camelKey] !== undefined) { patch[f] = payload[camelKey]; oldValue[f] = t[f]; }
      });
      if (patch.progress !== undefined) {
        var p = Number(patch.progress);
        if (isNaN(p)) p = 0;
        if (p < 0) p = 0;
        if (p > 100) p = 100;
        patch.progress = p;
      }
      if (patch.status === 'done' && patch.progress === undefined && Number(t.progress) < 100) {
        patch.progress = 100; oldValue.progress = t.progress;
      }

      // Simpan uid PIC agar rules memakai auth.uid (bukan hanya email),
      // dan catat kapan task benar-benar selesai.
      if (patch.assignee_email !== undefined) {
        patch.assignee_email = String(patch.assignee_email || '').trim().toLowerCase();
        patch.assignee_uid = uidForEmail(patch.assignee_email);
        oldValue.assignee_uid = t.assignee_uid || '';
      }
      if (patch.status !== undefined) {
        if (patch.status === 'done' && String(t.status) !== 'done') patch.completed_at = Store.nowIso();
        else if (patch.status !== 'done' && String(t.status) === 'done') patch.completed_at = '';
      }

      Store.update('tasks', 'task_id', payload.id, patch);

      if (patch.node_id !== undefined) {
        if (t.node_id) Store.update('nodes', 'node_id', t.node_id, { task_id: '', updated_at: Store.nowIso() });
        if (patch.node_id) Store.update('nodes', 'node_id', patch.node_id, { task_id: payload.id, updated_at: Store.nowIso() });
      }

      var actionMap = { status: 'status_change', priority: 'priority_change', assignee_email: 'assignee_change', progress: 'progress_update', due_date: 'due_date_change' };
      Object.keys(oldValue).forEach(function (f) {
        var o = {}; o[f] = oldValue[f];
        var n2 = {}; n2[f] = patch[f];
        Audit.log({ entity_type: 'task', entity_id: payload.id, action: actionMap[f] || 'update', old_value_json: JSON.stringify(o), new_value_json: JSON.stringify(n2) });
      });

      return apiSuccess({ id: payload.id, version: patch.version }, 'Task diperbarui');
    },

    deleteTask: function (taskId) {
      requireEditor();
      var t = Store.findById('tasks', 'task_id', taskId);
      if (!t) return apiError('Task tidak ditemukan', 'NOT_FOUND');
      requireTaskAccess(t, 'menghapus task ini');
      var oldNodeId = t.node_id || '';
      Store.removeBy('taskApplications', 'task_id', taskId);
      Store.removeBy('checklist', 'task_id', taskId);
      Store.remove('tasks', 'task_id', taskId);
      if (oldNodeId) syncNodePrimaryTask(oldNodeId);
      Audit.log({ entity_type: 'task', entity_id: taskId, action: 'delete', old_value_json: JSON.stringify({ title: t.title }) });
      return apiSuccess(null, 'Task dihapus');
    },

    // Editor mengambil task yang belum punya PIC. Setelah ini hanya dia
    // (dan admin) yang bisa mengubah task tersebut.
    claimTask: function (taskId) {
      requireEditor();
      var ws = currentWorkspace();
      var t = Store.findById('tasks', 'task_id', taskId);
      if (!t || String(t.workspace_id) !== String(ws.workspace_id)) return apiError('Task tidak ditemukan', 'NOT_FOUND');
      if (!isTaskUnassigned(t)) {
        return apiError('Task ini sudah memiliki PIC (' + taskOwnerLabel(t) + '). Minta admin memindahkannya kepada Anda.', 'CONFLICT');
      }
      if (isFirebaseMode() && currentRole() === 'viewer') {
        return apiError('Peran Anda (viewer) hanya dapat melihat data.', 'FORBIDDEN');
      }
      var now = Store.nowIso();
      var nextVersion = (Number(t.version) || 1) + 1;
      Store.update('tasks', 'task_id', taskId, {
        assignee_email: currentEmail(), assignee_uid: currentUid(),
        updated_at: now, updated_by_uid: currentUid(), version: nextVersion,
      });
      Audit.log({
        entity_type: 'task', entity_id: taskId, action: 'claim',
        new_value_json: JSON.stringify({ assignee_email: currentEmail() }),
      });
      return apiSuccess({ id: taskId, version: nextVersion }, 'Task berhasil diambil');
    },

    /* --- Applications ------------------------------------------- */
    listApplicationCategories: function () {
      try {
        var ws = currentWorkspace();
        ensureDefaultAppCategories();
        if (!Store.get || typeof Store.get !== 'function') return apiSuccess([]);
        var allCats = Store.get('applicationCategories') || [];
        var cats = allCats.filter(function (c) { return String(c.workspace_id) === String(ws.workspace_id); })
          .sort(function (a, b) { return (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0); });
        var result = cats.map(function (c) {
          return { id: c.category_id, name: c.name, sortOrder: Number(c.sort_order) || 0 };
        });
        return apiSuccess(result);
      } catch (e) {
        console.error('listApplicationCategories error', e);
        return apiError('Gagal memuat kategori aplikasi: ' + (e.message || e), 'INTERNAL');
      }
    },

    createApplicationCategory: function (payload) {
      requireEditor();
      if (!payload.name || !payload.name.trim()) return apiError('Nama kategori wajib diisi', 'VALIDATION');
      var ws = currentWorkspace();
      ensureDefaultAppCategories();
      var name = payload.name.trim();
      var exists = Store.findBy('applicationCategories', 'workspace_id', ws.workspace_id)
        .some(function (c) { return String(c.name).toLowerCase() === name.toLowerCase(); });
      if (exists) return apiError('Kategori dengan nama tersebut sudah ada', 'VALIDATION');
      var now = Store.nowIso();
      var cats = Store.findBy('applicationCategories', 'workspace_id', ws.workspace_id);
      var maxSort = 0;
      cats.forEach(function (c) { if ((Number(c.sort_order) || 0) > maxSort) maxSort = Number(c.sort_order) || 0; });
      Store.insert('applicationCategories', {
        category_id: Store.generateId('appcat'),
        workspace_id: ws.workspace_id,
        name: name,
        sort_order: maxSort + 1,
        created_at: now,
        updated_at: now,
      });
      Audit.log({ entity_type: 'applicationCategory', entity_id: name, action: 'create', new_value_json: JSON.stringify({ name: name }) });
      return apiSuccess({ ok: true }, 'Kategori ditambahkan');
    },

    updateApplicationCategory: function (payload) {
      requireEditor();
      if (!payload.id) return apiError('id wajib diisi', 'VALIDATION');
      var ws = currentWorkspace();
      var c = Store.findById('applicationCategories', 'category_id', payload.id);
      if (!c || String(c.workspace_id) !== String(ws.workspace_id)) return apiError('Kategori tidak ditemukan', 'NOT_FOUND');
      var patch = { updated_at: Store.nowIso() };
      if (payload.name && payload.name.trim()) {
        var name = payload.name.trim();
        var exists = Store.findBy('applicationCategories', 'workspace_id', ws.workspace_id)
          .some(function (x) { return String(x.category_id) !== String(payload.id) && String(x.name).toLowerCase() === name.toLowerCase(); });
        if (exists) return apiError('Kategori dengan nama tersebut sudah ada', 'VALIDATION');
        patch.name = name;
      }
      if (payload.sortOrder !== undefined) patch.sort_order = Number(payload.sortOrder);
      Store.update('applicationCategories', 'category_id', payload.id, patch);
      Audit.log({ entity_type: 'applicationCategory', entity_id: payload.id, action: 'update', new_value_json: JSON.stringify(patch) });
      return apiSuccess({ ok: true }, 'Kategori diperbarui');
    },

    deleteApplicationCategory: function (categoryId) {
      requireEditor();
      var ws = currentWorkspace();
      var c = Store.findById('applicationCategories', 'category_id', categoryId);
      if (!c || String(c.workspace_id) !== String(ws.workspace_id)) return apiError('Kategori tidak ditemukan', 'NOT_FOUND');
      var apps = Store.findBy('applications', 'workspace_id', ws.workspace_id).filter(function (a) { return a.category === c.name; });
      if (apps.length > 0) return apiError('Kategori masih digunakan oleh aplikasi. Pindahkan atau hapus aplikasinya terlebih dahulu.', 'VALIDATION');
      Store.remove('applicationCategories', 'category_id', categoryId);
      Audit.log({ entity_type: 'applicationCategory', entity_id: categoryId, action: 'delete', old_value_json: JSON.stringify({ name: c.name }) });
      return apiSuccess(null, 'Kategori dihapus');
    },

    listApplications: function () {
      var ws = currentWorkspace();
      ensureDefaultAppCategories();
      var apps = Store.findBy('applications', 'workspace_id', ws.workspace_id);
      var taskApps = Store.readAll('taskApplications');
      var result = apps.map(function (a) {
        var count = taskApps.filter(function (ta) { return String(ta.app_id) === String(a.app_id); }).length;
        return {
          id: a.app_id, name: a.app_name, url: a.app_url, category: a.category,
          description: a.description, iconUrl: a.icon_url, createdBy: a.created_by,
          createdAt: String(a.created_at), updatedAt: String(a.updated_at), taskCount: count,
        };
      });
      result.sort(function (a, b) { return a.name < b.name ? -1 : 1; });
      return apiSuccess(result);
    },

    createApplication: function (payload) {
      requireEditor();
      if (!payload.name || !payload.url) return apiError('Nama dan URL wajib diisi', 'VALIDATION');
      if (!isValidUrl(payload.url)) return apiError('URL tidak valid (hanya http/https)', 'VALIDATION');
      var ws = currentWorkspace();
      var id = Store.generateId('app');
      var now = Store.nowIso();
      Store.insert('applications', {
        app_id: id, workspace_id: ws.workspace_id, app_name: payload.name, app_url: payload.url,
        category: payload.category || 'Other', description: payload.description || '',
        icon_url: payload.icon_url || '', created_by: currentEmail(), created_at: now, updated_at: now,
      });
      Audit.log({ entity_type: 'application', entity_id: id, action: 'create', new_value_json: JSON.stringify({ name: payload.name, url: payload.url }) });
      return apiSuccess({ id: id }, 'Aplikasi dibuat');
    },

    updateApplication: function (payload) {
      requireEditor();
      var a = Store.findById('applications', 'app_id', payload.id);
      if (!a) return apiError('Aplikasi tidak ditemukan', 'NOT_FOUND');
      var patch = { updated_at: Store.nowIso() };
      if (typeof payload.name === 'string') patch.app_name = payload.name;
      if (typeof payload.url === 'string') {
        if (!isValidUrl(payload.url)) return apiError('URL tidak valid', 'VALIDATION');
        patch.app_url = payload.url;
      }
      if (typeof payload.category === 'string') patch.category = payload.category;
      if (typeof payload.description === 'string') patch.description = payload.description;
      if (payload.icon_url !== undefined) patch.icon_url = payload.icon_url;
      Store.update('applications', 'app_id', payload.id, patch);
      Audit.log({ entity_type: 'application', entity_id: payload.id, action: 'update', old_value_json: JSON.stringify({ name: a.app_name, url: a.app_url }), new_value_json: JSON.stringify({ name: patch.app_name, url: patch.app_url }) });
      return apiSuccess({ id: payload.id }, 'Aplikasi diperbarui');
    },

    deleteApplication: function (appId) {
      requireAdmin();
      var a = Store.findById('applications', 'app_id', appId);
      if (!a) return apiError('Aplikasi tidak ditemukan', 'NOT_FOUND');
      Store.removeBy('taskApplications', 'app_id', appId);
      Store.remove('applications', 'app_id', appId);
      Audit.log({ entity_type: 'application', entity_id: appId, action: 'delete', old_value_json: JSON.stringify({ name: a.app_name }) });
      return apiSuccess(null, 'Aplikasi dihapus');
    },

    linkApplicationToTask: function (payload) {
      requireEditor();
      if (!payload.taskId || !payload.appId) return apiError('taskId dan appId wajib diisi', 'VALIDATION');
      if (payload.customUrl && !isValidUrl(payload.customUrl)) return apiError('Custom URL tidak valid', 'VALIDATION');
      var ws = currentWorkspace();
      var t = Store.findById('tasks', 'task_id', payload.taskId);
      if (!t || String(t.workspace_id) !== String(ws.workspace_id)) return apiError('Task tidak ditemukan', 'NOT_FOUND');
      requireTaskAccess(t, 'mengubah aplikasi task ini');
      var app = Store.findById('applications', 'app_id', payload.appId);
      if (!app || String(app.workspace_id) !== String(ws.workspace_id)) return apiError('Aplikasi tidak ditemukan', 'NOT_FOUND');
      var existing = Store.findBy('taskApplications', 'task_id', payload.taskId).filter(function (ta) { return String(ta.app_id) === String(payload.appId); });
      if (existing.length > 0) return apiError('Aplikasi sudah ditautkan ke task ini', 'DUPLICATE');
      var id = Store.generateId('ta');
      Store.insert('taskApplications', {
        task_app_id: id, task_id: payload.taskId, app_id: payload.appId,
        custom_url: payload.customUrl || '', link_label: payload.linkLabel || '',
        created_by: currentEmail(), created_at: Store.nowIso(),
      });
      Audit.log({ entity_type: 'task', entity_id: payload.taskId, action: 'link_application', new_value_json: JSON.stringify({ appId: app.app_id, name: app.app_name }) });
      return apiSuccess({ id: id }, 'Aplikasi ditautkan');
    },

    // Tautkan link aplikasi baru: daftarkan dulu ke Application Hub (atau pakai
    // yang URL-nya sama), lalu hubungkan ke task.
    linkNewApplicationToTask: function (payload) {
      requireEditor();
      if (!payload.taskId || !payload.name || !payload.url) return apiError('Task, nama, dan URL aplikasi wajib diisi', 'VALIDATION');
      if (!isValidUrl(payload.url)) return apiError('URL tidak valid (hanya http/https)', 'VALIDATION');
      var ws = currentWorkspace();
      var t = Store.findById('tasks', 'task_id', payload.taskId);
      if (!t || String(t.workspace_id) !== String(ws.workspace_id)) return apiError('Task tidak ditemukan', 'NOT_FOUND');
      requireTaskAccess(t, 'mengubah aplikasi task ini');
      var app = ensureApplicationFromLink({ name: payload.name, url: payload.url, category: payload.category });
      var already = Store.findBy('taskApplications', 'task_id', payload.taskId).filter(function (ta) {
        return String(ta.app_id) === String(app.app_id);
      });
      if (already.length > 0) return apiError('Aplikasi sudah ditautkan ke task ini', 'DUPLICATE');
      var id = Store.generateId('ta');
      Store.insert('taskApplications', {
        task_app_id: id, task_id: payload.taskId, app_id: app.app_id,
        custom_url: '', link_label: payload.linkLabel || '',
        created_by: currentEmail(), created_at: Store.nowIso(),
      });
      Audit.log({ entity_type: 'task', entity_id: payload.taskId, action: 'link_application', new_value_json: JSON.stringify({ appId: app.app_id, name: app.app_name }) });
      return apiSuccess({ id: id, appId: app.app_id }, 'Aplikasi ditautkan');
    },

    unlinkApplicationFromTask: function (taskAppId) {
      requireEditor();
      var ta = Store.findById('taskApplications', 'task_app_id', taskAppId);
      if (!ta) return apiError('Link tidak ditemukan', 'NOT_FOUND');
      var parentTask = Store.findById('tasks', 'task_id', ta.task_id);
      if (parentTask) requireTaskAccess(parentTask, 'mengubah aplikasi task ini');
      Store.remove('taskApplications', 'task_app_id', taskAppId);
      Audit.log({ entity_type: 'task', entity_id: ta.task_id, action: 'unlink_application', old_value_json: JSON.stringify({ appId: ta.app_id }) });
      return apiSuccess(null, 'Link dihapus');
    },

    /* --- Aplikasi pada workflow & node --------------------------
     * Satu aplikasi bisa ditautkan langsung ke workflow, atau ke node
     * tertentu di dalam workflow. Keduanya disimpan di kolom JSON
     * `app_links_json` pada dokumen workflow.
     * ---------------------------------------------------------- */
    getWorkflowAppLinks: function (workflowId) {
      var ws = currentWorkspace();
      var w = Store.findById('workflows', 'workflow_id', workflowId);
      if (!w || String(w.workspace_id) !== String(ws.workspace_id)) {
        return apiError('Workflow tidak ditemukan', 'NOT_FOUND');
      }
      var nodes = {};
      Store.findBy('nodes', 'workflow_id', workflowId).forEach(function (n) {
        nodes[String(n.node_id)] = n;
      });
      var apps = {};
      Store.findBy('applications', 'workspace_id', ws.workspace_id).forEach(function (a) {
        apps[String(a.app_id)] = a;
      });
      var result = parseWorkflowAppLinks(w.app_links_json).map(function (l) {
        var app = apps[String(l.app_id)] || null;
        var node = l.target_type === 'node' ? (nodes[String(l.target_node_id)] || null) : null;
        return {
          id: l.id,
          appId: l.app_id,
          name: app ? app.app_name : '(Aplikasi dihapus)',
          url: l.custom_url || (app ? app.app_url : ''),
          category: app ? (app.category || '') : '',
          iconUrl: app ? (app.icon_url || '') : '',
          linkLabel: l.link_label,
          customUrl: l.custom_url,
          targetType: l.target_type,
          targetNodeId: l.target_node_id,
          targetNodeTitle: node ? node.title : '',
          missing: !app,
          createdBy: l.created_by,
          createdAt: l.created_at,
        };
      });
      return apiSuccess(result);
    },

    linkApplicationToWorkflow: function (payload) {
      requireEditor();
      var ws = currentWorkspace();
      var w = Store.findById('workflows', 'workflow_id', payload.workflowId);
      if (!w || String(w.workspace_id) !== String(ws.workspace_id)) {
        return apiError('Workflow tidak ditemukan', 'NOT_FOUND');
      }
      if (!payload.appId) return apiError('Aplikasi wajib dipilih', 'VALIDATION');
      var app = Store.findById('applications', 'app_id', payload.appId);
      if (!app || String(app.workspace_id) !== String(ws.workspace_id)) {
        return apiError('Aplikasi tidak ditemukan', 'NOT_FOUND');
      }
      if (payload.customUrl && !isValidUrl(payload.customUrl)) {
        return apiError('Custom URL tidak valid (hanya http/https)', 'VALIDATION');
      }
      var targetType = payload.targetType === 'node' ? 'node' : 'workflow';
      var targetNodeId = '';
      if (targetType === 'node') {
        targetNodeId = String(payload.targetNodeId || '');
        if (!targetNodeId) return apiError('Pilih node tujuan', 'VALIDATION');
        var node = Store.findById('nodes', 'node_id', targetNodeId);
        if (!node || String(node.workflow_id) !== String(payload.workflowId)) {
          return apiError('Node tidak ditemukan di workflow ini', 'NOT_FOUND');
        }
      }
      var links = parseWorkflowAppLinks(w.app_links_json);
      var duplicate = links.some(function (l) {
        return String(l.app_id) === String(payload.appId)
          && l.target_type === targetType
          && String(l.target_node_id || '') === targetNodeId;
      });
      if (duplicate) return apiError('Aplikasi ini sudah ditautkan ke target tersebut', 'DUPLICATE');
      var now = Store.nowIso();
      var link = {
        id: Store.generateId('wfa'),
        app_id: String(payload.appId),
        custom_url: String(payload.customUrl || ''),
        link_label: String(payload.linkLabel || ''),
        target_type: targetType,
        target_node_id: targetNodeId,
        created_by: currentEmail(),
        created_at: now,
      };
      links.push(link);
      Store.update('workflows', 'workflow_id', payload.workflowId, {
        app_links_json: JSON.stringify(links),
        updated_at: now,
        version: (Number(w.version) || 1) + 1,
      });
      Audit.log({
        entity_type: 'workflow', entity_id: payload.workflowId, action: 'link_application',
        new_value_json: JSON.stringify({ appId: app.app_id, name: app.app_name, target: targetType, nodeId: targetNodeId }),
      });
      return apiSuccess({ id: link.id }, 'Aplikasi ditautkan');
    },

    // Daftarkan URL baru ke Application Hub bila belum ada, lalu tautkan.
    linkNewApplicationToWorkflow: function (payload) {
      requireEditor();
      if (!payload.workflowId || !payload.name || !payload.url) {
        return apiError('Workflow, nama, dan URL aplikasi wajib diisi', 'VALIDATION');
      }
      if (!isValidUrl(payload.url)) return apiError('URL tidak valid (hanya http/https)', 'VALIDATION');
      var app = ensureApplicationFromLink({
        name: payload.name, url: payload.url, category: payload.category,
      });
      var res = Api.linkApplicationToWorkflow({
        workflowId: payload.workflowId,
        appId: app.app_id,
        targetType: payload.targetType,
        targetNodeId: payload.targetNodeId,
        linkLabel: payload.linkLabel,
      });
      if (!res.success) return res;
      return apiSuccess({ id: res.data.id, appId: app.app_id }, 'Aplikasi ditambahkan & ditautkan');
    },

    unlinkWorkflowAppLink: function (payload) {
      requireEditor();
      var ws = currentWorkspace();
      var w = Store.findById('workflows', 'workflow_id', payload.workflowId);
      if (!w || String(w.workspace_id) !== String(ws.workspace_id)) {
        return apiError('Workflow tidak ditemukan', 'NOT_FOUND');
      }
      var links = parseWorkflowAppLinks(w.app_links_json);
      var next = links.filter(function (l) { return String(l.id) !== String(payload.linkId); });
      if (next.length === links.length) return apiError('Tautan aplikasi tidak ditemukan', 'NOT_FOUND');
      Store.update('workflows', 'workflow_id', payload.workflowId, {
        app_links_json: JSON.stringify(next),
        updated_at: Store.nowIso(),
        version: (Number(w.version) || 1) + 1,
      });
      Audit.log({
        entity_type: 'workflow', entity_id: payload.workflowId, action: 'unlink_application',
        old_value_json: JSON.stringify({ linkId: payload.linkId }),
      });
      return apiSuccess(null, 'Tautan aplikasi dilepas');
    },

    /* --- Checklist ---------------------------------------------- */
    listChecklist: function (taskId) {
      var items = Store.findBy('checklist', 'task_id', taskId).map(function (c) {
        return { id: c.checklist_id, title: c.item_title, isCompleted: String(c.is_completed) === 'true', sortOrder: Number(c.sort_order) || 0 };
      });
      items.sort(function (a, b) { return a.sortOrder - b.sortOrder; });
      return apiSuccess(items);
    },

    createChecklistItem: function (payload) {
      requireEditor();
      if (!payload.taskId || !payload.title) return apiError('taskId dan title wajib diisi', 'VALIDATION');
      var t = Store.findById('tasks', 'task_id', payload.taskId);
      if (!t) return apiError('Task tidak ditemukan', 'NOT_FOUND');
      requireTaskAccess(t, 'mengubah checklist task ini');
      var existing = Store.findBy('checklist', 'task_id', payload.taskId);
      var id = Store.generateId('cli');
      Store.insert('checklist', {
        checklist_id: id, task_id: payload.taskId, item_title: payload.title, is_completed: 'false',
        sort_order: payload.sortOrder !== undefined ? Number(payload.sortOrder) : existing.length,
        created_by: currentEmail(), created_at: Store.nowIso(), updated_at: Store.nowIso(),
      });
      if (String(t.progress_mode) === 'checklist') recomputeChecklistProgress(payload.taskId);
      return apiSuccess({ id: id }, 'Item ditambahkan');
    },

    updateChecklistItem: function (payload) {
      requireEditor();
      var c = Store.findById('checklist', 'checklist_id', payload.id);
      if (!c) return apiError('Item tidak ditemukan', 'NOT_FOUND');
      var parent = Store.findById('tasks', 'task_id', c.task_id);
      if (parent) requireTaskAccess(parent, 'mengubah checklist task ini');
      var patch = { updated_at: Store.nowIso() };
      if (typeof payload.title === 'string') patch.item_title = payload.title;
      if (typeof payload.isCompleted === 'boolean') patch.is_completed = payload.isCompleted ? 'true' : 'false';
      if (typeof payload.sortOrder === 'number') patch.sort_order = payload.sortOrder;
      Store.update('checklist', 'checklist_id', payload.id, patch);
      var t = parent;
      if (t && String(t.progress_mode) === 'checklist') recomputeChecklistProgress(c.task_id);
      return apiSuccess({ id: payload.id }, 'Item diperbarui');
    },

    deleteChecklistItem: function (itemId) {
      requireEditor();
      var c = Store.findById('checklist', 'checklist_id', itemId);
      if (!c) return apiError('Item tidak ditemukan', 'NOT_FOUND');
      var parent = Store.findById('tasks', 'task_id', c.task_id);
      if (parent) requireTaskAccess(parent, 'menghapus checklist task ini');
      Store.remove('checklist', 'checklist_id', itemId);
      var t = parent;
      if (t && String(t.progress_mode) === 'checklist') recomputeChecklistProgress(c.task_id);
      return apiSuccess(null, 'Item dihapus');
    },

    /* --- Komentar (task / node / workflow) ----------------------- */
    listComments: function (payload) {
      try {
        requireMember();
        payload = payload || {};
        var type = String(payload.entityType || '');
        var id = String(payload.entityId || '');
        if (['task', 'node', 'workflow'].indexOf(type) === -1 || !id) {
          return apiError('Target komentar tidak valid', 'VALIDATION');
        }
        var rows = commentRowsFor(type, id).slice().sort(function (a, b) {
          var ca = String(a.created_at || '');
          var cb = String(b.created_at || '');
          if (ca !== cb) return ca < cb ? -1 : 1;
          return String(a.comment_id).localeCompare(String(b.comment_id));
        });
        return apiSuccess(rows.map(commentDto));
      } catch (err) {
        return apiError(err.message, 'FORBIDDEN');
      }
    },

    createComment: function (payload) {
      try {
        requireMember();
        payload = payload || {};
        var type = String(payload.entityType || '');
        var id = String(payload.entityId || '');
        if (['task', 'node', 'workflow'].indexOf(type) === -1) return apiError('Target komentar tidak valid', 'VALIDATION');
        if (!commentTargetExists(type, id)) return apiError('Task/node/workflow tidak ditemukan', 'NOT_FOUND');
        var body = cleanBody(payload.body);
        var ws = currentWorkspace();
        var now = Store.nowIso();
        var row = {
          comment_id: Store.generateId('cmt'),
          workspace_id: ws.workspace_id,
          entity_type: type,
          entity_id: id,
          body: body,
          created_by_uid: currentUid(),
          created_by_email: currentEmail(),
          created_by_name: currentDisplayName(),
          created_at: now,
          updated_at: now,
          edited_at: '',
          deleted_at: '',
          deleted_by_uid: '',
        };
        Store.insert('comments', row);
        return apiSuccess(commentDto(row), 'Komentar ditambahkan');
      } catch (err) {
        return apiError(err.message, 'FORBIDDEN');
      }
    },

    updateComment: function (payload) {
      try {
        requireMember();
        var c = Store.findById('comments', 'comment_id', payload.id);
        if (!c || c.deleted_at) return apiError('Komentar tidak ditemukan', 'NOT_FOUND');
        if (!isMyComment(c)) throw new Error('Hanya penulis komentar yang dapat mengedit komentar ini.');
        var body = cleanBody(payload.body);
        var now = Store.nowIso();
        Store.update('comments', 'comment_id', payload.id, { body: body, edited_at: now, updated_at: now });
        return apiSuccess(commentDto(Store.findById('comments', 'comment_id', payload.id)), 'Komentar diperbarui');
      } catch (err) {
        return apiError(err.message, 'FORBIDDEN');
      }
    },

    deleteComment: function (commentId) {
      try {
        requireMember();
        var c = Store.findById('comments', 'comment_id', commentId);
        if (!c || c.deleted_at) return apiError('Komentar tidak ditemukan', 'NOT_FOUND');
        if (!isMyComment(c) && !isAdminUser()) throw new Error('Hanya penulis komentar atau admin yang dapat menghapus komentar ini.');
        var now = Store.nowIso();
        Store.update('comments', 'comment_id', commentId, {
          deleted_at: now, deleted_by_uid: currentUid(), updated_at: now,
        });
        return apiSuccess(null, 'Komentar dihapus');
      } catch (err) {
        return apiError(err.message, 'FORBIDDEN');
      }
    },

    /* --- Chat tim (mode lokal) -----------------------------------
     * Di mode Firebase, UI memakai FlowFirebase.chat* dengan listener
     * terbatas 50 pesan. Fungsi di sini untuk mode lokal (Store).
     * ------------------------------------------------------------ */
    listChatMessages: function (payload) {
      try {
        requireMember();
        var ws = currentWorkspace();
        var limit = Math.max(1, Math.min(200, Number((payload && payload.limit) || 50)));
        var rows = Store.findBy('chatMessages', 'workspace_id', ws.workspace_id).slice().sort(function (a, b) {
          var ca = String(a.created_at || '');
          var cb = String(b.created_at || '');
          if (ca !== cb) return ca < cb ? -1 : 1;
          return String(a.message_id).localeCompare(String(b.message_id));
        });
        return apiSuccess(rows.slice(-limit).map(chatDto));
      } catch (err) {
        return apiError(err.message, 'FORBIDDEN');
      }
    },

    sendChatMessage: function (payload) {
      try {
        requireMember();
        payload = payload || {};
        var body = cleanChatBody(payload.body);
        var attachments = cleanAttachments(payload.attachments);
        if (!body && attachments.length === 0) {
          throw new Error('Tulis pesan atau lampirkan task/workflow.');
        }
        var ws = currentWorkspace();
        var now = Store.nowIso();
        var row = {
          message_id: Store.generateId('msg'),
          workspace_id: ws.workspace_id,
          body: body,
          attachments_json: JSON.stringify(attachments),
          sender_uid: currentUid(),
          sender_email: currentEmail(),
          sender_name: currentDisplayName(),
          created_at: now,
          updated_at: now,
          edited_at: '',
          deleted_at: '',
          deleted_by_uid: '',
        };
        Store.insert('chatMessages', row);
        return apiSuccess(chatDto(row), 'Pesan terkirim');
      } catch (err) {
        return apiError(err.message, 'FORBIDDEN');
      }
    },

    updateChatMessage: function (payload) {
      try {
        requireMember();
        var m = Store.findById('chatMessages', 'message_id', payload.id);
        if (!m || m.deleted_at) return apiError('Pesan tidak ditemukan', 'NOT_FOUND');
        if (!isMyComment({ created_by_uid: m.sender_uid, created_by_email: m.sender_email })) {
          throw new Error('Hanya pengirim pesan yang dapat mengedit pesan ini.');
        }
        var body = cleanBody(payload.body, 'Pesan');
        var now = Store.nowIso();
        Store.update('chatMessages', 'message_id', payload.id, { body: body, edited_at: now, updated_at: now });
        return apiSuccess(chatDto(Store.findById('chatMessages', 'message_id', payload.id)), 'Pesan diperbarui');
      } catch (err) {
        return apiError(err.message, 'FORBIDDEN');
      }
    },

    deleteChatMessage: function (messageId) {
      try {
        requireMember();
        var m = Store.findById('chatMessages', 'message_id', messageId);
        if (!m || m.deleted_at) return apiError('Pesan tidak ditemukan', 'NOT_FOUND');
        var mine = isMyComment({ created_by_uid: m.sender_uid, created_by_email: m.sender_email });
        if (!mine && !isAdminUser()) throw new Error('Hanya pengirim pesan atau admin yang dapat menghapus pesan ini.');
        var now = Store.nowIso();
        Store.update('chatMessages', 'message_id', messageId, {
          deleted_at: now, deleted_by_uid: currentUid(), updated_at: now,
        });
        return apiSuccess(null, 'Pesan dihapus');
      } catch (err) {
        return apiError(err.message, 'FORBIDDEN');
      }
    },

    /* Status baca chat (mode lokal). Satu baris per anggota per
     * workspace; di mode Firebase data ini ada di chatReads/{uid}. */
    getChatReadState: function () {
      try {
        requireMember();
        var ws = currentWorkspace();
        var uid = currentUid();
        var rows = Store.findBy('chatReads', 'workspace_id', ws.workspace_id).filter(function (r) {
          return String(r.member_id) === String(uid);
        });
        if (rows.length === 0) return apiSuccess(null);
        var row = rows[rows.length - 1];
        return apiSuccess({
          lastReadAt: row.last_read_at || '',
          lastReadMessageId: row.last_read_message_id || '',
        });
      } catch (err) {
        return apiError(err.message, 'FORBIDDEN');
      }
    },

    setChatReadState: function (payload) {
      try {
        requireMember();
        payload = payload || {};
        var ws = currentWorkspace();
        var uid = currentUid();
        var lastReadAt = String(payload.lastReadAt || '').slice(0, 40);
        if (!lastReadAt) throw new Error('Waktu baca tidak valid.');
        var lastReadMessageId = String(payload.lastReadMessageId || '').slice(0, 120);
        var now = Store.nowIso();
        var existing = Store.findBy('chatReads', 'workspace_id', ws.workspace_id).filter(function (r) {
          return String(r.member_id) === String(uid);
        })[0];
        if (existing) {
          Store.update('chatReads', 'member_id', uid, {
            last_read_at: lastReadAt,
            last_read_message_id: lastReadMessageId,
            updated_at: now,
          });
        } else {
          Store.insert('chatReads', {
            workspace_id: ws.workspace_id,
            member_id: uid,
            last_read_at: lastReadAt,
            last_read_message_id: lastReadMessageId,
            updated_at: now,
          });
        }
        return apiSuccess({ lastReadAt: lastReadAt, lastReadMessageId: lastReadMessageId });
      } catch (err) {
        return apiError(err.message, 'FORBIDDEN');
      }
    },

    /* --- Dashboard ---------------------------------------------- */
    getDashboardData: function (payload) {
      payload = payload || {};
      var scope = payload.scope === 'me' ? 'me' : 'team';
      var ws = currentWorkspace();
      var allTasks = Store.findBy('tasks', 'workspace_id', ws.workspace_id);
      var myEmail = currentEmail();
      var myUid = currentUid();
      var tasks = scope === 'me'
        ? allTasks.filter(function (t) {
            if (t.assignee_uid && myUid && String(t.assignee_uid) === myUid) return true;
            return String(t.assignee_email || '').toLowerCase() === myEmail && !!t.assignee_email;
          })
        : allTasks;
      var allWorkflows = Store.findBy('workflows', 'workspace_id', ws.workspace_id);
      var activeWorkflows = allWorkflows.filter(function (w) { return w.status === 'active'; });
      var members = Store.findBy('members', 'workspace_id', ws.workspace_id);
      var today = localTodayKey();

      // Nama workflow dicari dari SEMUA workflow (termasuk arsip) supaya
      // task dari workflow arsip tidak tampil tanpa nama.
      var workflowInfo = {};
      allWorkflows.forEach(function (w) {
        workflowInfo[String(w.workflow_id)] = { name: w.workflow_name || '', status: w.status || '' };
      });
      function workflowName(id) {
        if (!id) return '';
        var info = workflowInfo[String(id)];
        return info ? info.name : '';
      }

      var total = tasks.length;
      var done = 0, inProgress = 0, todo = 0, review = 0, backlog = 0, overdue = 0;
      var dueSoon = 0, unassigned = 0;
      var statusCounts = { backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0 };
      var priority = { critical: 0, high: 0, medium: 0, low: 0 };
      var criticalHigh = [];
      var weekAhead = addDaysKey(today, 7);

      tasks.forEach(function (t) {
        if (t.status === 'done') done++;
        else if (t.status === 'in_progress') inProgress++;
        else if (t.status === 'todo') todo++;
        else if (t.status === 'review') review++;
        else if (t.status === 'backlog') backlog++;
        statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
        priority[t.priority] = (priority[t.priority] || 0) + 1;
        if (isTaskUnassigned(t)) unassigned++;
        if (isTaskOverdue(t, today)) overdue++;
        else if (t.status !== 'done') {
          var dueKey = dateKey(t.due_date);
          if (dueKey && dueKey >= today && dueKey <= weekAhead) dueSoon++;
        }
        if ((t.priority === 'critical' || t.priority === 'high') && t.status !== 'done') {
          criticalHigh.push({
            id: t.task_id, title: t.title, priority: t.priority, assigneeEmail: t.assignee_email,
            dueDate: t.due_date, workflow: { id: t.workflow_id || '', name: workflowName(t.workflow_id) },
          });
        }
      });

      // Critical dulu, lalu tenggat terdekat; task tanpa tenggat di bawah.
      var priorityRank = { critical: 0, high: 1 };
      criticalHigh.sort(function (a, b) {
        var pr = (priorityRank[a.priority] || 9) - (priorityRank[b.priority] || 9);
        if (pr !== 0) return pr;
        var da = dateKey(a.dueDate) || '9999-12-31';
        var db = dateKey(b.dueDate) || '9999-12-31';
        if (da !== db) return da < db ? -1 : 1;
        return String(a.title).localeCompare(String(b.title));
      });

      var sum = 0;
      tasks.forEach(function (t) { sum += Number(t.progress) || 0; });
      var avgProgress = total > 0 ? Math.round(sum / total) : 0;

      var byPicMap = {};
      tasks.forEach(function (t) {
        var pic = t.assignee_email || 'Unassigned';
        if (!byPicMap[pic]) byPicMap[pic] = { email: pic, total: 0, done: 0, inProgress: 0, overdue: 0 };
        byPicMap[pic].total++;
        if (t.status === 'done') byPicMap[pic].done++;
        if (t.status === 'in_progress') byPicMap[pic].inProgress++;
        if (isTaskOverdue(t, today)) byPicMap[pic].overdue++;
      });
      var byPic = Object.keys(byPicMap).map(function (k) { return byPicMap[k]; });
      byPic.sort(function (a, b) {
        if (a.email === 'Unassigned') return 1;
        if (b.email === 'Unassigned') return -1;
        if (b.total !== a.total) return b.total - a.total;
        return String(a.email).localeCompare(String(b.email));
      });

      // Task tanpa workspace workflow dikelompokkan sebagai "Tanpa workflow",
      // bukan baris kosong. Baris ini tidak bisa dibuka sebagai kanvas.
      var byWfMap = {};
      tasks.forEach(function (t) {
        var key = t.workflow_id ? String(t.workflow_id) : '__none__';
        if (!byWfMap[key]) {
          var info = t.workflow_id ? workflowInfo[String(t.workflow_id)] : null;
          byWfMap[key] = {
            id: t.workflow_id || '',
            name: t.workflow_id ? (info ? info.name : '') : 'Tanpa workflow',
            archived: !!(info && info.status === 'archived'),
            isWorkflow: !!t.workflow_id,
            total: 0, done: 0, progress: 0,
          };
        }
        byWfMap[key].total++;
        if (t.status === 'done') byWfMap[key].done++;
        byWfMap[key].progress += Number(t.progress) || 0;
      });
      var byWorkflow = Object.keys(byWfMap).map(function (k) {
        var w = byWfMap[k];
        w.progress = w.total === 0 ? 0 : Math.round(w.progress / w.total);
        return w;
      });
      byWorkflow.sort(function (a, b) {
        if (a.isWorkflow !== b.isWorkflow) return a.isWorkflow ? -1 : 1;
        if (b.total !== a.total) return b.total - a.total;
        return String(a.name).localeCompare(String(b.name));
      });

      // Daftar fokus pribadi: overdue & tenggat 7 hari ke depan.
      var focus = [];
      tasks.forEach(function (t) {
        if (t.status === 'done') return;
        var dueKey = dateKey(t.due_date);
        if (!dueKey || dueKey > weekAhead) return;
        focus.push({
          id: t.task_id, title: t.title, priority: t.priority, status: t.status,
          dueDate: t.due_date, overdue: dueKey < today,
          workflow: { id: t.workflow_id || '', name: workflowName(t.workflow_id) },
        });
      });
      focus.sort(function (a, b) {
        var da = dateKey(a.dueDate) || '9999-12-31';
        var db = dateKey(b.dueDate) || '9999-12-31';
        if (da !== db) return da < db ? -1 : 1;
        return (priorityRank[a.priority] || 9) - (priorityRank[b.priority] || 9);
      });

      var logs = Store.findBy('activityLogs', 'workspace_id', ws.workspace_id);
      function recentActivity(forEmail) {
        var rows = logs.filter(function (l) {
          return !forEmail || String(l.actor_email || '').toLowerCase() === forEmail;
        });
        rows.sort(function (a, b) { return String(a.created_at) < String(b.created_at) ? 1 : -1; });
        return rows.slice(0, 8).map(function (l) {
          var title = '';
          try {
            if (l.entity_type === 'task') {
              var t = Store.findById('tasks', 'task_id', l.entity_id);
              title = t ? t.title : '';
            } else if (l.entity_type === 'workflow') {
              var w = Store.findById('workflows', 'workflow_id', l.entity_id);
              title = w ? w.workflow_name : '';
            } else if (l.entity_type === 'application') {
              var a = Store.findById('applications', 'app_id', l.entity_id);
              title = a ? a.app_name : '';
            }
          } catch (e) {}
          return {
            id: l.log_id, entityType: l.entity_type, entityId: l.entity_id, entityTitle: title,
            action: l.action, actorEmail: l.actor_email, createdAt: String(l.created_at),
          };
        });
      }

      return apiSuccess({
        scope: scope,
        total: total, done: done, inProgress: inProgress, todo: todo, review: review, backlog: backlog,
        overdue: overdue, dueSoon: dueSoon, unassigned: unassigned,
        avgProgress: avgProgress, priority: priority, statusCounts: statusCounts,
        criticalHigh: criticalHigh, focus: focus,
        byPic: byPic, byWorkflow: byWorkflow, workflowCount: activeWorkflows.length,
        archivedWorkflowCount: allWorkflows.length - activeWorkflows.length,
        memberCount: members.length,
        recentActivity: recentActivity(scope === 'me' ? myEmail : ''),
      });
    },

    /* --- Activity log ------------------------------------------- */
    listActivityLogs: function (filters) {
      var ws = currentWorkspace();
      var logs = Store.findBy('activityLogs', 'workspace_id', ws.workspace_id);
      filters = filters || {};
      if (filters.entityType) logs = logs.filter(function (l) { return String(l.entity_type) === String(filters.entityType); });
      if (filters.entityId) logs = logs.filter(function (l) { return String(l.entity_id) === String(filters.entityId); });
      var result = logs.map(function (l) {
        var oldV = null, newV = null;
        try { if (l.old_value_json) oldV = JSON.parse(l.old_value_json); } catch (e) {}
        try { if (l.new_value_json) newV = JSON.parse(l.new_value_json); } catch (e) {}
        return { id: l.log_id, entityType: l.entity_type, entityId: l.entity_id, action: l.action, actorEmail: l.actor_email, oldValue: oldV, newValue: newV, createdAt: String(l.created_at) };
      });
      result.sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
      var limit = (filters && filters.limit) || 50;
      return apiSuccess(result.slice(0, limit));
    },

    /* --- Members ------------------------------------------------ */
    listMembers: function () {
      var ws = currentWorkspace();
      var rows = Store.findBy('members', 'workspace_id', ws.workspace_id).map(memberDto);

      // Undangan yang belum diterima ditampilkan sebagai status "invited".
      if (isFirebaseMode()) {
        Store.findBy('invites', 'workspace_id', ws.workspace_id).forEach(function (inv) {
          rows.push({
            id: 'invite:' + inv.email,
            email: inv.email,
            displayName: inv.display_name || String(inv.email).split('@')[0],
            role: inv.role || 'editor',
            status: 'invited',
            createdAt: String(inv.created_at || ''),
            invitedBy: inv.invited_by || '',
          });
        });
      }

      // Admin dulu, lalu aktif, lalu nama.
      rows.sort(function (a, b) {
        var sa = (a.role === 'admin' ? 0 : 1) * 10 + (a.status === 'active' ? 0 : a.status === 'invited' ? 1 : 2);
        var sb = (b.role === 'admin' ? 0 : 1) * 10 + (b.status === 'active' ? 0 : b.status === 'invited' ? 1 : 2);
        if (sa !== sb) return sa - sb;
        return String(a.displayName || '').localeCompare(String(b.displayName || ''));
      });
      return apiSuccess(rows);
    },

    addMember: function (payload) {
      requireAdmin();
      var displayName = String(payload.displayName || payload.display_name || '').trim();
      var email = String(payload.email || '').trim().toLowerCase();
      if (!email || !displayName) return apiError('Email dan nama wajib diisi', 'VALIDATION');
      if (!isValidEmail(email)) return apiError('Format email tidak valid', 'VALIDATION');
      if (displayName.length > 60) return apiError('Nama maksimal 60 karakter', 'VALIDATION');
      if (payload.role && !isValidRole(payload.role)) return apiError('Role tidak valid', 'VALIDATION');
      var ws = currentWorkspace();
      var role = payload.role || 'editor';

      var existing = Store.findBy('members', 'workspace_id', ws.workspace_id).filter(function (m) { return String(m.email).toLowerCase() === email; });
      var pending = findInvite(ws.workspace_id, email);
      if (existing.length > 0) return apiError('Email sudah terdaftar di workspace', 'DUPLICATE');
      if (pending) return apiError('Email sudah diundang dan menunggu login', 'DUPLICATE');

      // Mode Firebase: buat undangan, bukan member. Dokumen member baru
      // dibuat saat orang tersebut login (ID dokumen = uid).
      if (isFirebaseMode()) {
        Store.insert('invites', {
          email: email,
          workspace_id: ws.workspace_id,
          display_name: displayName,
          role: role,
          invited_by: currentEmail(),
          created_at: Store.nowIso(),
        });
        Audit.log({ entity_type: 'member', entity_id: email, action: 'invite', new_value_json: JSON.stringify({ email: email, displayName: displayName, role: role }) });
        return apiSuccess({ id: 'invite:' + email, email: email, invited: true }, 'Undangan dibuat untuk ' + email);
      }

      var id = Store.generateId('mem');
      Store.insert('members', {
        member_id: id, workspace_id: ws.workspace_id, email: email,
        display_name: displayName, role: role, member_status: 'active', created_at: Store.nowIso(),
      });
      Audit.log({ entity_type: 'member', entity_id: id, action: 'create', new_value_json: JSON.stringify({ email: email, displayName: displayName, role: role }) });
      return apiSuccess({ id: id }, 'Member ditambahkan');
    },

    updateMember: function (payload) {
      requireAdmin();
      var ws = currentWorkspace();

      // --- Undangan yang belum diterima ---
      if (isInviteId(payload.id)) {
        var invEmail = String(payload.id).slice('invite:'.length);
        var inv = findInvite(ws.workspace_id, invEmail);
        if (!inv) return apiError('Undangan tidak ditemukan', 'NOT_FOUND');

        var invPatch = {};
        if (payload.displayName !== undefined) {
          var invName = String(payload.displayName).trim();
          if (!invName) return apiError('Nama tidak boleh kosong', 'VALIDATION');
          if (invName.length > 60) return apiError('Nama maksimal 60 karakter', 'VALIDATION');
          if (invName !== inv.display_name) invPatch.display_name = invName;
        }
        if (payload.role !== undefined && payload.role !== inv.role) {
          if (!isValidRole(payload.role)) return apiError('Role tidak valid', 'VALIDATION');
          invPatch.role = payload.role;
        }
        if (Object.keys(invPatch).length === 0) return apiSuccess(inviteDto(inv), 'Tidak ada perubahan');
        invPatch.updated_at = Store.nowIso();
        Store.update('invites', 'email', inv.email, invPatch);
        Audit.log({
          entity_type: 'member', entity_id: inv.email, action: 'update',
          old_value_json: JSON.stringify({ displayName: inv.display_name, role: inv.role, status: 'invited' }),
          new_value_json: JSON.stringify({ displayName: invPatch.display_name || inv.display_name, role: invPatch.role || inv.role, status: 'invited' }),
        });
        return apiSuccess(inviteDto(findInvite(ws.workspace_id, inv.email)), 'Undangan diperbarui');
      }

      var member = findMember(ws.workspace_id, payload.id);
      if (!member) return apiError('Member tidak ditemukan', 'NOT_FOUND');

      var patch = {};
      var displayName = payload.displayName !== undefined ? String(payload.displayName).trim() : member.display_name;
      if (!displayName) return apiError('Nama tidak boleh kosong', 'VALIDATION');
      if (displayName.length > 60) return apiError('Nama maksimal 60 karakter', 'VALIDATION');
      if (displayName !== member.display_name) patch.display_name = displayName;

      if (payload.role !== undefined && payload.role !== member.role) {
        if (!isValidRole(payload.role)) return apiError('Role tidak valid', 'VALIDATION');
        if (isSelf(member)) return apiError('Anda tidak bisa mengubah peran akun sendiri', 'SELF_PROTECT');
        if (wouldRemoveLastAdmin(member, ws.workspace_id)) return apiError('Minimal harus ada satu admin aktif', 'LAST_ADMIN');
        patch.role = payload.role;
      }

      if (Object.keys(patch).length === 0) return apiSuccess(memberDto(member), 'Tidak ada perubahan');
      patch.updated_at = Store.nowIso();
      Store.update('members', 'member_id', member.member_id, patch);
      Audit.log({
        entity_type: 'member', entity_id: member.member_id, action: 'update',
        old_value_json: JSON.stringify({ displayName: member.display_name, role: member.role }),
        new_value_json: JSON.stringify({ displayName: patch.display_name || member.display_name, role: patch.role || member.role }),
      });
      return apiSuccess(memberDto(findMember(ws.workspace_id, member.member_id)), 'Member diperbarui');
    },

    setMemberStatus: function (payload) {
      requireAdmin();
      var ws = currentWorkspace();
      if (isInviteId(payload.id)) {
        return apiError('Undangan belum aktif. Batalkan undangan jika tidak diperlukan.', 'VALIDATION');
      }
      var member = findMember(ws.workspace_id, payload.id);
      if (!member) return apiError('Member tidak ditemukan', 'NOT_FOUND');
      var status = payload.status;
      if (status !== 'active' && status !== 'inactive') return apiError('Status member tidak valid', 'VALIDATION');
      if (status === member.member_status) return apiSuccess(memberDto(member), 'Tidak ada perubahan');
      if (isSelf(member)) return apiError('Anda tidak bisa menonaktifkan akun sendiri', 'SELF_PROTECT');
      if (status === 'inactive' && wouldRemoveLastAdmin(member, ws.workspace_id)) {
        return apiError('Minimal harus ada satu admin aktif', 'LAST_ADMIN');
      }
      // Mode Firebase: menonaktifkan member akan memblokir aksesnya lewat rules.
      Store.update('members', 'member_id', member.member_id, { member_status: status, updated_at: Store.nowIso() });
      Audit.log({
        entity_type: 'member', entity_id: member.member_id, action: 'status_change',
        old_value_json: JSON.stringify({ status: member.member_status }),
        new_value_json: JSON.stringify({ status: status }),
      });
      return apiSuccess(memberDto(findMember(ws.workspace_id, member.member_id)), status === 'inactive' ? 'Member dinonaktifkan' : 'Member diaktifkan kembali');
    },

    removeMember: function (payload) {
      requireAdmin();
      var ws = currentWorkspace();

      // --- Batalkan undangan ---
      if (isInviteId(payload.id)) {
        var invEmail = String(payload.id).slice('invite:'.length);
        var inv = findInvite(ws.workspace_id, invEmail);
        if (!inv) return apiError('Undangan tidak ditemukan', 'NOT_FOUND');
        Store.remove('invites', 'email', inv.email);
        Audit.log({
          entity_type: 'member', entity_id: inv.email, action: 'invite_cancel',
          old_value_json: JSON.stringify({ email: inv.email, displayName: inv.display_name, role: inv.role }),
        });
        return apiSuccess({ id: payload.id }, 'Undangan dibatalkan');
      }

      var member = findMember(ws.workspace_id, payload.id);
      if (!member) return apiError('Member tidak ditemukan', 'NOT_FOUND');
      if (isSelf(member)) return apiError('Anda tidak bisa menghapus akun sendiri', 'SELF_PROTECT');
      if (wouldRemoveLastAdmin(member, ws.workspace_id)) return apiError('Minimal harus ada satu admin aktif', 'LAST_ADMIN');
      Store.remove('members', 'member_id', member.member_id);
      Audit.log({
        entity_type: 'member', entity_id: member.member_id, action: 'delete',
        old_value_json: JSON.stringify({ email: member.email, displayName: member.display_name, role: member.role }),
      });
      return apiSuccess({ id: member.member_id }, 'Member dihapus');
    },

    /* --- Setup ------------------------------------------------ */
    getSetupStatus: function () {
      var ws = ensureLocalSetup();
      return apiSuccess({
        setupRequired: !ws,
        mode: isFirebaseMode() ? 'firebase' : 'local',
        projectId: isFirebaseMode() && global.FlowFirebase ? global.FlowFirebase.info().projectId : '',
        spreadsheetId: null,
        spreadsheetUrl: null,
        sheets: [],
      });
    },

    setupDatabase: function () {
      ensureLocalSetup();
      return apiSuccess({ ok: true }, 'Setup berhasil');
    },

    seedDemoData: function () {
      ensureLocalSetup();
      // Di Firebase, data demo membuat anggota & task untuk orang lain:
      // hanya admin yang boleh menjalankannya.
      if (isFirebaseMode()) requireAdmin();
      var ws = currentWorkspace();
      var wsId = ws.workspace_id;
      var now = Store.nowIso();
      var email = currentEmail();
      // Di Firebase, PIC harus member aktif yang benar-benar ada.
      var demoA = isFirebaseMode() ? email : 'siti@flowspace.id';
      var demoB = isFirebaseMode() ? email : 'budi@flowspace.id';

      // Members demo hanya di mode lokal. Di mode Firebase dokumen member
      // harus memakai uid pengguna sungguhan (aturan Firestore).
      var existing = Store.findBy('members', 'workspace_id', wsId);
      var demoMembers = isFirebaseMode() ? [] : [
        { email: 'siti@flowspace.id', displayName: 'Siti Rahayu', role: 'editor' },
        { email: 'budi@flowspace.id', displayName: 'Budi Santoso', role: 'editor' },
        { email: 'maya@flowspace.id', displayName: 'Maya Wijaya', role: 'viewer' },
      ];
      demoMembers.forEach(function (m) {
        if (!existing.some(function (e) { return e.email === m.email; })) {
          Store.insert('members', { member_id: Store.generateId('mem'), workspace_id: wsId, email: m.email, display_name: m.displayName, role: m.role, member_status: 'active', created_at: now });
        }
      });

      // Workflows
      function addWorkflow(name, desc, by, departments, category) {
        var id = Store.generateId('wf');
        Store.insert('workflows', {
          workflow_id: id, workspace_id: wsId, workflow_name: name, description: desc,
          departments_json: JSON.stringify(departments || []), category: category || '',
          canvas_settings_json: JSON.stringify({ zoom: 0.85, x: 0, y: 0 }),
          created_by: by, created_at: now, updated_at: now, status: 'active', version: 1,
        });
        return id;
      }
      var wfOnb = addWorkflow('Onboarding Karyawan Baru', 'Alur onboarding karyawan baru dari hari pertama hingga selesai probasi.', email, ['Data', 'EDP'], 'Onboarding');
      addWorkflow('Pengadaan Barang', 'Alur pengajuan, persetujuan, dan penerimaan barang pengadaan.', email, ['Keuangan', 'EDP'], 'Procurement');
      addWorkflow('Produksi Konten Marketing', 'Pipeline produksi konten mulai dari ide hingga publikasi.', 'siti@flowspace.id', ['Marketing', 'Breeder'], 'Marketing');

      // Nodes Onboarding
      function addNode(wfId, type, title, desc, x, y, w, h) {
        var id = Store.generateId('node');
        Store.insert('nodes', { node_id: id, workflow_id: wfId, node_type: type, title: title, description: desc, position_x: x, position_y: y, width: w, height: h, style_json: '{}', application_id: '', task_id: '', created_at: now, updated_at: now, version: 1 });
        return id;
      }
      var n1 = addNode(wfOnb, 'start_end', 'Mulai', 'Hari pertama karyawan', 0, 200, 140, 60);
      var n2 = addNode(wfOnb, 'process', 'Persiapan Akun & Email', 'Buatkan akun email dan akses sistem', 220, 200, 180, 80);
      var n3 = addNode(wfOnb, 'task', 'Induksi Budaya & Kebijakan', 'Sesi induksi kebijakan perusahaan', 440, 120, 180, 80);
      var n4 = addNode(wfOnb, 'task', 'Setup Workstation', 'Pasang laptop, akses VPN, dan tools', 440, 300, 180, 80);
      var n5 = addNode(wfOnb, 'decision', 'Lulus Probasi?', 'Keputusan setelah 3 bulan', 680, 200, 160, 80);
      var n6 = addNode(wfOnb, 'process', 'Evaluasi Mingguan', 'Check-in mingguan dengan mentor', 680, 380, 160, 80);
      var n7 = addNode(wfOnb, 'start_end', 'Selesai', 'Konfirmasi karyawan tetap', 900, 200, 140, 60);
      addNode(wfOnb, 'note', 'Catatan: Dokumen Wajib', 'KTP, NPWP, rekening, foto 3x4', 220, 40, 200, 70);

      function addEdge(wfId, s, t, label, so, ti) {
        Store.insert('edges', { edge_id: Store.generateId('edge'), workflow_id: wfId, source_node_id: s, target_node_id: t, label: label, condition: '', source_output: so || 'output_1', target_input: ti || 'input_1', created_at: now, updated_at: now });
      }
      addEdge(wfOnb, n1, n2, '', 'output_1', 'input_1');
      addEdge(wfOnb, n2, n3, '', 'output_1', 'input_1');
      addEdge(wfOnb, n2, n4, '', 'output_1', 'input_1');
      addEdge(wfOnb, n3, n5, '', 'output_1', 'input_1');
      addEdge(wfOnb, n4, n5, '', 'output_1', 'input_2');
      addEdge(wfOnb, n5, n7, 'Ya', 'output_1', 'input_1');
      addEdge(wfOnb, n5, n6, 'Belum', 'output_2', 'input_2');
      addEdge(wfOnb, n6, n5, 'Re-evaluasi', 'output_1', 'input_1');

      // Tasks
      function addTask(wfId, nodeId, title, desc, assignee, status, priority, progress, due) {
        var id = Store.generateId('task');
        Store.insert('tasks', { task_id: id, workspace_id: wsId, workflow_id: wfId, node_id: nodeId, title: title, description: desc, assignee_email: assignee, assignee_uid: uidForEmail(assignee), status: status, priority: priority, progress: progress, progress_mode: 'manual', start_date: '', due_date: due, completed_at: status === 'done' ? now : '', created_by: email, created_at: now, updated_at: now, updated_by_uid: currentUid(), version: 1 });
        if (nodeId) Store.update('nodes', 'node_id', nodeId, { task_id: id, updated_at: now });
        return id;
      }
      var t1 = addTask(wfOnb, n3, 'Induksi Budaya & Kebijakan', 'Sesi induksi kebijakan perusahaan oleh HRD.', demoA, 'in_progress', 'high', 65, '2026-10-25');
      var t2 = addTask(wfOnb, n4, 'Setup Workstation', 'Pasang laptop, akses VPN, dan tools dev.', demoB, 'review', 'critical', 80, '2026-10-15');
      var t3 = addTask(wfOnb, n2, 'Buatkan Akun Email & Akses', 'Buatkan email perusahaan dan akun SSO.', demoA, 'done', 'high', 100, '2026-10-05');
      var t4 = addTask(wfOnb, n6, 'Evaluasi Mingguan Minggu 1', 'Check-in mingguan dengan mentor.', demoB, 'todo', 'medium', 0, '2026-10-29');
      addTask(wfOnb, n5, 'Keputusan Probasi Final', 'Rapat final keputusan status karyawan tetap.', email, 'backlog', 'critical', 0, '2026-12-28');

      // Applications
      var appsData = [
        { name: 'Google Workspace', url: 'https://workspace.google.com', category: 'Communication', desc: 'Email, Dokumen, Spreadsheet perusahaan' },
        { name: 'Slack', url: 'https://slack.com', category: 'Communication', desc: 'Komunikasi tim' },
        { name: 'Jira', url: 'https://atlassian.com/jira', category: 'Internal System', desc: 'Issue tracking' },
        { name: 'Notion', url: 'https://notion.so', category: 'Documentation', desc: 'Wiki dan dokumentasi' },
        { name: 'Figma', url: 'https://figma.com', category: 'Internal System', desc: 'Desain kolaboratif' },
        { name: 'Google Forms', url: 'https://forms.google.com', category: 'Form', desc: 'Formulir dan survei' },
        { name: 'Looker Studio', url: 'https://lookerstudio.google.com', category: 'Dashboard', desc: 'Dashboard analitik' },
        { name: 'HubSpot CRM', url: 'https://hubspot.com', category: 'CRM', desc: 'CRM sales' },
      ];
      var appIds = {};
      appsData.forEach(function (a) {
        var aid = Store.generateId('app');
        appIds[a.name] = aid;
        Store.insert('applications', { app_id: aid, workspace_id: wsId, app_name: a.name, app_url: a.url, category: a.category, description: a.desc, icon_url: '', created_by: email, created_at: now, updated_at: now });
      });

      Store.insert('taskApplications', { task_app_id: Store.generateId('ta'), task_id: t3, app_id: appIds['Google Workspace'], custom_url: '', link_label: 'Buat Akun', created_by: email, created_at: now });
      Store.insert('taskApplications', { task_app_id: Store.generateId('ta'), task_id: t1, app_id: appIds['Slack'], custom_url: '', link_label: 'Channel Onboarding', created_by: email, created_at: now });
      Store.insert('taskApplications', { task_app_id: Store.generateId('ta'), task_id: t1, app_id: appIds['Notion'], custom_url: '', link_label: 'Handbook Karyawan', created_by: email, created_at: now });

      // Checklist
      var checklistData = [
        [t1, 'Jadwalkan sesi induksi', true], [t1, 'Siapkan slide presentasi kebijakan', true],
        [t1, 'Bagikan handbook karyawan', true], [t1, 'Sesi tanya jawab', false],
        [t1, 'Tanda tangan receipt kebijakan', false],
        [t2, 'Pesan laptop dari IT', true], [t2, 'Konfigurasi VPN', true],
        [t2, 'Install IDE & tools dev', true], [t2, 'Akses repo GitHub', true],
        [t2, 'Verifikasi akses CI/CD', false],
      ];
      checklistData.forEach(function (c, idx) {
        Store.insert('checklist', { checklist_id: Store.generateId('cli'), task_id: c[0], item_title: c[1], is_completed: c[2] ? 'true' : 'false', sort_order: idx, created_by: email, created_at: now, updated_at: now });
      });

      Audit.log({ entity_type: 'workflow', entity_id: wfOnb, action: 'create', new_value_json: JSON.stringify({ name: 'Onboarding Karyawan Baru' }) });
      Audit.log({ entity_type: 'task', entity_id: t1, action: 'create', new_value_json: JSON.stringify({ title: 'Induksi Budaya & Kebijakan' }) });

      return apiSuccess({ tasksCreated: 5, workflowsCreated: 3, appsCreated: appsData.length }, 'Demo data berhasil dimuat.');
    },

    resetDatabase: function () {
      requireAdmin();

      // Mode Firebase: hapus dokumen workspace satu per satu (kecuali
      // workspace & member sendiri) lalu muat ulang listener.
      if (isFirebaseMode() && global.FlowFirebase) {
        return global.FlowFirebase.resetWorkspace().then(function () {
          return apiSuccess(null, 'Database workspace direset');
        }).catch(function (err) {
          return apiError(global.FlowFirebase.friendlyError(err), 'RESET_FAILED');
        });
      }

      Store.reset();
      ensureLocalSetup();
      return apiSuccess(null, 'Database direset');
    },
  };

  // Helper recompute checklist progress (diakses internal)
  function recomputeChecklistProgress(taskId) {
    var items = Store.findBy('checklist', 'task_id', taskId);
    if (items.length === 0) {
      Store.update('tasks', 'task_id', taskId, { progress: 0, updated_at: Store.nowIso() });
      return;
    }
    var done = 0;
    items.forEach(function (i) { if (String(i.is_completed) === 'true') done++; });
    var progress = Math.round((done / items.length) * 100);
    Store.update('tasks', 'task_id', taskId, { progress: progress, updated_at: Store.nowIso() });
  }

  // Cari aplikasi berdasarkan URL; kalau belum ada, buat baru di Application Hub.
  // Dipakai saat user menautkan "link aplikasi baru" langsung dari task.
  function ensureApplicationFromLink(info) {
    var ws = currentWorkspace();
    var url = String((info && info.url) || '').trim();
    var name = String((info && info.name) || '').trim();
    var urlKey = url.toLowerCase();
    var existing = Store.findBy('applications', 'workspace_id', ws.workspace_id).filter(function (a) {
      return String(a.app_url || '').trim().toLowerCase() === urlKey;
    })[0];
    if (existing) return existing;
    var now = Store.nowIso();
    var rec = {
      app_id: Store.generateId('app'), workspace_id: ws.workspace_id,
      app_name: name || url, app_url: url,
      category: (info && info.category) || 'Other', description: '', icon_url: '',
      created_by: currentEmail(), created_at: now, updated_at: now,
    };
    Store.insert('applications', rec);
    Audit.log({
      entity_type: 'application', entity_id: rec.app_id, action: 'create',
      new_value_json: JSON.stringify({ name: rec.app_name, url: rec.app_url, source: 'task_link' }),
    });
    return rec;
  }

  global.Api = Api;
  global.Store = Store;
})(window);
