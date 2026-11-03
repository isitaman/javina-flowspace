/* ============================================================
 * FlowSpace - notifications.js
 * Lonceng notifikasi di header.
 *
 * Sumber notifikasi (semuanya berasal dari data yang sudah
 * tersinkron di Store/Firestore, jadi tidak ada read tambahan):
 *   1. Komentar dari orang lain pada task yang PIC-nya saya.
 *   2. Komentar dari orang lain pada workflow / node workflow
 *      yang berisi task saya.
 *   3. Task baru (atau task yang dipindahkan) kepada saya oleh
 *      anggota lain — biasanya admin.
 *   4. Admin: task yang berubah menjadi Done oleh orang lain.
 *
 * Status "sudah dibaca" disimpan per perangkat di localStorage
 * (flowspace.notif.v1.<workspace>.<uid>). Tidak perlu koleksi
 * Firestore baru maupun perubahan security rules.
 * ============================================================ */

(function (global) {
  'use strict';

  var MAX_ITEMS = 80;          // jumlah item yang dirender di panel
  var MAX_READ_IDS = 800;      // batas id "sudah dibaca" yang disimpan
  var STORAGE_PREFIX = 'flowspace.notif.v1.';

  var mounted = false;
  var btnEl = null;
  var badgeEl = null;
  var backdropEl = null;
  var panelEl = null;
  var items = [];
  var refreshTimer = null;
  var tickTimer = null;

  /* --- Konteks ------------------------------------------------- */

  function state() {
    // `State` dideklarasikan dengan const di app.js, jadi bukan
    // properti window. Akses lewat lexical global.
    try { return typeof State !== 'undefined' ? State : null; } catch (e) { return null; }
  }

  function myEmail() {
    var s = state();
    var u = s && s.init && s.init.currentUser;
    return String((u && u.email) || '').toLowerCase();
  }

  function myUid() {
    if (global.FlowSession && global.FlowSession.uid) return String(global.FlowSession.uid);
    var s = state();
    var u = s && s.init && s.init.currentUser;
    if (u && u.uid) return String(u.uid);
    return myEmail();
  }

  function isAdminUser() {
    var s = state();
    var u = s && s.init && s.init.currentUser;
    return !!(u && String(u.role) === 'admin');
  }

  function esc(value) {
    if (typeof global.escapeHtml === 'function') return global.escapeHtml(value);
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c];
    });
  }

  function isoTime(value) {
    if (!value) return '';
    var d = new Date(value);
    return isNaN(d.getTime()) ? '' : d.toISOString();
  }

  function nowIso() { return new Date().toISOString(); }

  function nameForEmail(email) {
    var e = String(email || '').toLowerCase();
    if (!e) return 'Anggota';
    var s = state();
    var members = (s && s.init && s.init.members) || [];
    for (var i = 0; i < members.length; i++) {
      if (String(members[i].email || '').toLowerCase() === e) {
        return members[i].displayName || e.split('@')[0];
      }
    }
    return e.split('@')[0];
  }

  function snippet(value, max) {
    var text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text.length <= max) return text;
    return text.slice(0, max - 1).trim() + '…';
  }

  /* --- Status baca per perangkat ------------------------------- */

  function storageKey() {
    var s = state();
    var ws = (s && s.init && s.init.workspace && s.init.workspace.id) || 'ws';
    return STORAGE_PREFIX + ws + '.' + (myUid() || 'local');
  }

  function readState() {
    try {
      var raw = global.localStorage.getItem(storageKey());
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;

      // Format v2: `since` = batas waktu "sudah dibaca", `read`/`unread`
      // = pengecualian per item. Format lama (seenAt) dimigrasikan.
      if (parsed.since === undefined && parsed.seenAt === undefined) return null;
      var since = String(parsed.since || parsed.seenAt || '');
      var pick = function (list) {
        return Array.isArray(list)
          ? list.filter(function (id) { return typeof id === 'string'; }).slice(-MAX_READ_IDS)
          : [];
      };
      return { since: since, read: pick(parsed.read), unread: pick(parsed.unread) };
    } catch (e) { return null; }
  }

  function writeState(st) {
    try {
      global.localStorage.setItem(storageKey(), JSON.stringify({
        since: st.since || '',
        read: (st.read || []).slice(-MAX_READ_IDS),
        unread: (st.unread || []).slice(-MAX_READ_IDS),
      }));
    } catch (e) {}
  }

  // Pertama kali dipakai (atau setelah upgrade format lama): aktivitas
  // yang lebih tua dari sekarang dianggap sudah dibaca, supaya lonceng
  // tidak menampilkan puluhan notifikasi historis. Item yang masuk
  // setelah ini otomatis belum dibaca. Tidak bergantung pada `items`
  // supaya data yang belum selesai disinkronkan tidak ikut terlanjur
  // ditandai.
  function ensureState() {
    var st = readState();
    if (st) return st;
    st = { since: nowIso(), read: [], unread: [] };
    writeState(st);
    return st;
  }

  function isUnreadItem(it, st) {
    if (!st) return false;
    if ((st.unread || []).indexOf(it.id) !== -1) return true;
    if ((st.read || []).indexOf(it.id) !== -1) return false;
    if (!st.since) return true;
    return String(it.time) > st.since;
  }

  function markAllRead() {
    var st = ensureState();
    var next = {};
    st.read.forEach(function (id) { next[id] = true; });
    items.forEach(function (it) { next[it.id] = true; });
    st.read = Object.keys(next).slice(-MAX_READ_IDS);
    st.unread = [];
    writeState(st);
    updateBadge();
  }

  function markRead(id) {
    if (!id) return;
    var st = ensureState();
    var u = st.unread.indexOf(id);
    if (u !== -1) st.unread.splice(u, 1);
    if (st.read.indexOf(id) === -1) st.read.push(id);
    if (st.read.length > MAX_READ_IDS) st.read = st.read.slice(-MAX_READ_IDS);
    writeState(st);
    updateBadge();
  }

  function markUnread(id) {
    if (!id) return;
    var st = ensureState();
    var r = st.read.indexOf(id);
    if (r !== -1) st.read.splice(r, 1);
    if (st.unread.indexOf(id) === -1) st.unread.push(id);
    if (st.unread.length > MAX_READ_IDS) st.unread = st.unread.slice(-MAX_READ_IDS);
    writeState(st);
    updateBadge();
  }

  function unreadCount() {
    var st = readState();
    var n = 0;
    items.forEach(function (it) { if (isUnreadItem(it, st)) n++; });
    return n;
  }

  /* --- Penyusun notifikasi ------------------------------------- */

  function parseJson(raw) {
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(String(raw)); } catch (e) { return null; }
  }

  function buildItems() {
    var out = [];
    if (!global.Store) return out;
    var s = state();
    if (!s || !s.init) return out;
    var me = myEmail();
    if (!me) return out;
    var admin = isAdminUser();

    var tasks = global.Store.readAll('tasks') || [];
    var taskById = {};
    var myTaskIds = {};
    var myWorkflowIds = {};

    tasks.forEach(function (t) {
      var id = String(t.task_id || '');
      if (!id) return;
      taskById[id] = t;
      if (String(t.assignee_email || '').toLowerCase() !== me) return;
      myTaskIds[id] = true;
      if (t.workflow_id) myWorkflowIds[String(t.workflow_id)] = true;
    });

    var workflowName = {};
    (global.Store.readAll('workflows') || []).forEach(function (w) {
      workflowName[String(w.workflow_id)] = String(w.workflow_name || 'Workflow');
    });

    var nodeById = {};
    (global.Store.readAll('nodes') || []).forEach(function (n) {
      nodeById[String(n.node_id)] = n;
    });

    /* 1 & 2. Komentar dari orang lain. */
    (global.Store.readAll('comments') || []).forEach(function (c) {
      if (!c || c.deleted_at) return;
      if (String(c.created_by_email || '').toLowerCase() === me) return;
      var time = isoTime(c.created_at);
      if (!time) return;
      var author = String(c.created_by_name || c.created_by_email || 'Anggota');
      var body = String(c.body || '');
      var entityId = String(c.entity_id || '');

      if (c.entity_type === 'task') {
        var task = taskById[entityId];
        if (!task || !myTaskIds[entityId]) return;
        out.push({
          id: 'c:' + c.comment_id,
          kind: 'task_comment',
          time: time,
          title: author + ' mengomentari task Anda',
          subtitle: String(task.title || 'Task'),
          body: snippet(body, 150),
          taskId: entityId,
        });
        return;
      }

      if (c.entity_type === 'workflow') {
        if (!myWorkflowIds[entityId]) return;
        out.push({
          id: 'c:' + c.comment_id,
          kind: 'workflow_comment',
          time: time,
          title: author + ' mengomentari workflow',
          subtitle: workflowName[entityId] || 'Workflow',
          body: snippet(body, 150),
          workflowId: entityId,
          workflowName: workflowName[entityId] || '',
        });
        return;
      }

      if (c.entity_type === 'node') {
        var node = nodeById[entityId];
        if (!node) return;
        var wfId = String(node.workflow_id || '');
        if (!wfId || !myWorkflowIds[wfId]) return;
        var wfLabel = workflowName[wfId] || 'Workflow';
        out.push({
          id: 'c:' + c.comment_id,
          kind: 'node_comment',
          time: time,
          title: author + ' mengomentari langkah di workflow Anda',
          subtitle: wfLabel + (node.title ? ' · ' + node.title : ''),
          body: snippet(body, 150),
          workflowId: wfId,
          workflowName: wfLabel,
          nodeId: entityId,
        });
      }
    });

    /* 3 & 4. Penugasan dan task selesai (dari activity log). */
    (global.Store.readAll('activityLogs') || []).forEach(function (l) {
      if (!l || String(l.entity_type) !== 'task') return;
      var actor = String(l.actor_email || '').toLowerCase();
      if (actor === me) return; // aksi sendiri tidak perlu notifikasi
      var task = taskById[String(l.entity_id || '')];
      if (!task) return;
      var time = isoTime(l.created_at);
      if (!time) return;
      var action = String(l.action || '');
      var nv = parseJson(l.new_value_json) || {};
      var ov = parseJson(l.old_value_json) || {};
      var logId = String(l.log_id || (l.entity_id + ':' + time));
      var actorName = nameForEmail(l.actor_email);

      if (action === 'assignee_change' || action === 'create') {
        // Log 'create' lama tidak memuat assignee; hanya dipakai jika ada
        // (task baru setelah fitur ini) agar tidak salah menandai task
        // lama yang kebetulan kini dipegang saya.
        var assignedEmail = String(nv.assignee_email || '').toLowerCase();
        if (!assignedEmail || assignedEmail !== me) return;
        // Form task selalu mengirim ulang assignee walau tidak berubah,
        // jadi pastikan PIC benar-benar berpindah.
        if (action === 'assignee_change'
            && assignedEmail === String(ov.assignee_email || '').toLowerCase()) return;
        out.push({
          id: 'a:' + logId,
          kind: 'task_assigned',
          time: time,
          title: actorName + ' memberi Anda task',
          subtitle: String(task.title || 'Task'),
          body: '',
          taskId: String(task.task_id),
        });
        return;
      }

      if (admin && action === 'status_change' && String(nv.status || '') === 'done') {
        // Abaikan log "status tetap done" saat task disunting ulang.
        if (String(ov.status || '') === 'done') return;
        out.push({
          id: 'd:' + logId,
          kind: 'task_done',
          time: time,
          title: actorName + ' menyelesaikan task',
          subtitle: String(task.title || 'Task'),
          body: '',
          taskId: String(task.task_id),
        });
      }
    });

    // Buang duplikat (id bisa sama bila log ditulis dua kali) lalu
    // urutkan dari yang terbaru.
    var seen = {};
    out = out.filter(function (it) {
      if (!it.id || seen[it.id]) return false;
      seen[it.id] = true;
      return true;
    });
    out.sort(function (a, b) {
      if (a.time === b.time) return a.id < b.id ? 1 : -1;
      return a.time < b.time ? 1 : -1;
    });
    return out.slice(0, MAX_ITEMS);
  }

  /* --- Badge ---------------------------------------------------- */

  function updateBadge() {
    if (!badgeEl || !btnEl) return;
    var n = unreadCount();
    if (n <= 0) {
      badgeEl.textContent = '0';
      badgeEl.classList.add('hidden');
      btnEl.removeAttribute('aria-label');
      btnEl.setAttribute('aria-label', 'Notifikasi');
      btnEl.title = 'Notifikasi';
      return;
    }
    var label = n > 99 ? '99+' : String(n);
    badgeEl.textContent = label;
    badgeEl.classList.remove('hidden');
    btnEl.setAttribute('aria-label', n + ' notifikasi belum dibaca');
    btnEl.title = n + ' notifikasi belum dibaca';
  }

  /* --- Panel ---------------------------------------------------- */

  function dayLabel(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var today = new Date();
    var startOf = function (x) { return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
    var diffDays = Math.round((startOf(today) - startOf(d)) / 86400000);
    if (diffDays <= 0) return 'Hari ini';
    if (diffDays === 1) return 'Kemarin';
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function timeAgo(iso) {
    var t = new Date(iso).getTime();
    if (isNaN(t)) return '';
    var diff = Date.now() - t;
    if (diff < 45000) return 'baru saja';
    if (diff < 3600000) return Math.max(1, Math.floor(diff / 60000)) + ' menit lalu';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' jam lalu';
    if (diff < 7 * 86400000) return Math.floor(diff / 86400000) + ' hari lalu';
    return new Date(t).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
  }

  function kindMeta(kind) {
    switch (kind) {
      case 'task_comment': return { icon: 'message-square', tone: 'comment' };
      case 'workflow_comment':
      case 'node_comment': return { icon: 'workflow', tone: 'flow' };
      case 'task_assigned': return { icon: 'clipboard-list', tone: 'assigned' };
      case 'task_done': return { icon: 'check-circle', tone: 'done' };
      default: return { icon: 'bell', tone: 'comment' };
    }
  }

  function itemHtml(it, unread) {
    var meta = kindMeta(it.kind);
    var toggleLabel = unread ? 'Tandai sudah dibaca' : 'Tandai belum dibaca';
    return `
      <div class="notif-item ${unread ? 'is-unread' : ''}" data-notif-id="${esc(it.id)}"
        role="menuitem" tabindex="0" aria-label="${esc(it.title)} — ${esc(it.subtitle)}">
        <span class="notif-ico notif-tone-${meta.tone}" aria-hidden="true"><i data-lucide="${meta.icon}"></i></span>
        <span class="notif-main">
          <span class="notif-title">${esc(it.title)}</span>
          <span class="notif-sub">${esc(it.subtitle)}</span>
          ${it.body ? `<span class="notif-snippet">${esc(it.body)}</span>` : ''}
          <span class="notif-time">${esc(timeAgo(it.time))}</span>
        </span>
        <button type="button" class="notif-toggle" data-notif-toggle="${esc(it.id)}"
          aria-pressed="${unread ? 'false' : 'true'}" aria-label="${toggleLabel}" title="${toggleLabel}">
          <span class="notif-dot" aria-hidden="true"></span>
        </button>
      </div>
    `;
  }

  function listHtml() {
    if (items.length === 0) {
      return `
        <div class="notif-empty">
          <span class="notif-ico notif-tone-comment"><i data-lucide="bell"></i></span>
          <p class="font-display text-sm font-semibold mt-3">Belum ada notifikasi</p>
          <p class="text-xs text-inksoft mt-1 max-w-[220px] mx-auto">
            Komentar pada task Anda, penugasan baru, dan task selesai akan muncul di sini.
          </p>
        </div>
      `;
    }
    var st = readState();
    var html = '';
    var lastDay = '';
    items.forEach(function (it) {
      var day = String(it.time).slice(0, 10);
      if (day !== lastDay) {
        lastDay = day;
        html += `<div class="notif-day">${esc(dayLabel(it.time))}</div>`;
      }
      html += itemHtml(it, isUnreadItem(it, st));
    });
    return html;
  }

  function panelHtml() {
    return `
      <div id="notif-panel" class="menu-pop notif-panel" role="dialog" aria-modal="false"
        aria-label="Notifikasi" tabindex="-1">
        <div class="notif-head">
          <div class="min-w-0 flex-1">
            <h3 class="font-display text-[15px] font-semibold tracking-tight leading-none">Notifikasi</h3>
            <p id="notif-summary" class="notif-summary"></p>
          </div>
          <button type="button" id="notif-close" class="notif-close" aria-label="Tutup notifikasi" title="Tutup">
            <i data-lucide="x"></i>
          </button>
        </div>
        <div id="notif-list" class="notif-list" role="menu"></div>
        <div id="notif-footer" class="notif-foot hidden">
          <button type="button" id="notif-mark-all" class="notif-mark-all">Tandai semua dibaca</button>
          <span id="notif-foot-note" class="notif-foot-note"></span>
        </div>
      </div>
    `;
  }

  function renderPanel() {
    if (!panelEl) return;
    var list = panelEl.querySelector('#notif-list');
    if (!list) return;
    var scrollTop = list.scrollTop;
    list.innerHTML = listHtml();
    list.scrollTop = scrollTop;

    var unread = unreadCount();
    var summary = panelEl.querySelector('#notif-summary');
    if (summary) {
      if (!items.length) summary.textContent = '';
      else if (unread > 0) summary.textContent = unread + ' belum dibaca';
      else summary.textContent = 'Semua sudah dibaca';
    }

    var footer = panelEl.querySelector('#notif-footer');
    var note = panelEl.querySelector('#notif-foot-note');
    var markAll = panelEl.querySelector('#notif-mark-all');
    if (footer && note) {
      var truncated = items.length >= MAX_ITEMS;
      footer.classList.toggle('hidden', items.length === 0);
      if (markAll) {
        markAll.classList.toggle('hidden', unread === 0);
        markAll.disabled = unread === 0;
      }
      if (truncated) note.textContent = 'Menampilkan ' + MAX_ITEMS + ' terbaru';
      else note.textContent = unread > 0 ? unread + ' belum dibaca' : '';
      note.classList.toggle('hidden', !note.textContent);
    }

    if (typeof global.refreshIcons === 'function') global.refreshIcons();
  }

  function placePanel() {
    if (!panelEl || !btnEl) return;
    var pad = 8;
    var gap = 8;
    var r = btnEl.getBoundingClientRect();
    var w = panelEl.offsetWidth;
    var h = panelEl.offsetHeight;
    var left = r.right - w;
    var top = r.bottom + gap;
    if (top + h > window.innerHeight - pad) {
      var above = r.top - h - gap;
      top = above >= pad ? above : Math.max(pad, window.innerHeight - h - pad);
    }
    left = Math.max(pad, Math.min(left, window.innerWidth - w - pad));
    panelEl.style.left = Math.round(left) + 'px';
    panelEl.style.top = Math.round(top) + 'px';
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); closePanel(); return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].indexOf(e.key) === -1) return;
    e.preventDefault();
    var list = Array.from(panelEl.querySelectorAll('[data-notif-id]'));
    if (list.length === 0) return;
    var active = document.activeElement;
    var activeRow = active && active.closest ? active.closest('[data-notif-id]') : null;
    var idx = list.indexOf(activeRow || active);
    var next = 0;
    if (e.key === 'ArrowUp') next = idx <= 0 ? list.length - 1 : idx - 1;
    else if (e.key === 'End') next = list.length - 1;
    else if (e.key === 'ArrowDown' && idx >= 0) next = (idx + 1) % list.length;
    list[next].focus({ preventScroll: true });
  }

  function onResize() {
    // Rotasi layar / ubah ukuran: cukup reposisi panel, jangan tutup.
    placePanel();
  }

  function onScroll(e) {
    if (panelEl && e.target && panelEl.contains(e.target)) return;
    closePanel({ restoreFocus: false });
  }

  function activateItem(id) {
    var picked = null;
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === id) { picked = items[i]; break; }
    }
    if (!picked) return;
    // Klik item = tandai item itu sudah dibaca (bukan semua).
    markRead(picked.id);
    closePanel({ restoreFocus: false });
    openTarget(picked);
  }

  function findToggle(id) {
    if (!panelEl) return null;
    return panelEl.querySelector('[data-notif-toggle="' + String(id).replace(/"/g, '\\"') + '"]');
  }

  function openPanel() {
    if (!btnEl || panelEl) return;
    ensureState();

    backdropEl = document.createElement('div');
    backdropEl.className = 'fixed inset-0 z-[70]';
    backdropEl.innerHTML = `
      <div class="absolute inset-0" id="notif-bg"></div>
      ${panelHtml()}
    `;
    document.body.appendChild(backdropEl);
    panelEl = backdropEl.querySelector('#notif-panel');

    renderPanel();
    placePanel();
    requestAnimationFrame(function () {
      placePanel();
      if (panelEl) panelEl.classList.add('is-ready');
    });

    btnEl.setAttribute('aria-expanded', 'true');
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    document.addEventListener('scroll', onScroll, true);

    try { panelEl.focus({ preventScroll: true }); } catch (e) {}

    backdropEl.querySelector('#notif-bg').addEventListener('click', function () { closePanel(); });

    var closeBtn = panelEl.querySelector('#notif-close');
    if (closeBtn) closeBtn.addEventListener('click', function () { closePanel(); });

    var markAll = panelEl.querySelector('#notif-mark-all');
    if (markAll) markAll.addEventListener('click', function () {
      markAllRead();
      renderPanel();
    });

    panelEl.addEventListener('click', function (e) {
      var toggle = e.target && e.target.closest ? e.target.closest('[data-notif-toggle]') : null;
      if (toggle) {
        e.preventDefault();
        e.stopPropagation();
        var toggleId = toggle.getAttribute('data-notif-toggle');
        var st = ensureState();
        var currentlyUnread = isUnreadItem({ id: toggleId }, st);
        if (currentlyUnread) markRead(toggleId);
        else markUnread(toggleId);
        renderPanel();
        var again = findToggle(toggleId);
        if (again) { try { again.focus({ preventScroll: true }); } catch (err) {} }
        return;
      }

      var target = e.target && e.target.closest ? e.target.closest('[data-notif-id]') : null;
      if (!target) return;
      activateItem(target.getAttribute('data-notif-id'));
    });

    // Baris memakai div agar tombol toggle di dalamnya tetap valid.
    panelEl.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var el = e.target;
      if (el && el.closest && el.closest('[data-notif-toggle]')) return;
      var row = el && el.closest ? el.closest('[data-notif-id]') : null;
      if (!row) return;
      e.preventDefault();
      activateItem(row.getAttribute('data-notif-id'));
    });
  }

  function closePanel(opts) {
    opts = opts || {};
    if (!panelEl) return;
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('scroll', onScroll, true);
    if (backdropEl) backdropEl.remove();
    panelEl = null;
    backdropEl = null;
    if (btnEl) {
      btnEl.setAttribute('aria-expanded', 'false');
      if (opts.restoreFocus !== false) {
        try { btnEl.focus({ preventScroll: true }); } catch (e) {}
      }
    }
  }

  function openTarget(it) {
    if (it.taskId && typeof global.openTaskDrawer === 'function') {
      global.openTaskDrawer(it.taskId);
      return;
    }
    if (it.workflowId && typeof global.setView === 'function') {
      global.setView({
        kind: 'canvas',
        workflowId: it.workflowId,
        workflowName: it.workflowName || '',
      });
    }
  }

  /* --- Siklus hidup -------------------------------------------- */

  function refresh() {
    items = buildItems();
    updateBadge();
    if (panelEl) renderPanel();
  }

  function scheduleRefresh() {
    if (refreshTimer) return;
    refreshTimer = setTimeout(function () {
      refreshTimer = null;
      refresh();
    }, 180);
  }

  function mount() {
    btnEl = document.getElementById('notif-btn');
    badgeEl = document.getElementById('notif-badge');
    if (!btnEl) return;
    if (!mounted) {
      mounted = true;
      btnEl.addEventListener('click', function () { openPanel(); });
      global.addEventListener('fs:change', scheduleRefresh);
      global.addEventListener('focus', scheduleRefresh);
      // Baca status yang diubah di tab lain (badge ikut bersih).
      global.addEventListener('storage', function (e) {
        if (e && e.key && String(e.key).indexOf(STORAGE_PREFIX) === 0) updateBadge();
      });
      // Perbarui label waktu ("2 jam lalu") tanpa mengganggu panel
      // yang sedang dibuka.
      tickTimer = setInterval(function () { if (!panelEl) refresh(); }, 60000);
    }
    refresh();
  }

  function reset() {
    closePanel({ restoreFocus: false });
    items = [];
    updateBadge();
  }

  global.Notifications = {
    mount: mount,
    refresh: refresh,
    reset: reset,
    unreadCount: unreadCount,
    buildItems: buildItems,
  };
})(window);
