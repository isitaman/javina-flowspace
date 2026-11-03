/* ============================================================
 * FlowSpace - chat.js
 * Chat tim (satu ruang per workspace) + badge belum dibaca.
 *
 * Mode Firebase memakai listener langsung ke koleksi chatMessages
 * dengan batas 50 pesan terakhir. Chat sengaja TIDAK dimasukkan ke
 * Store/SYNC_COLLECTIONS supaya cache localStorage dan kuota baca
 * Firestore tetap kecil. Mode lokal memakai Api (Store).
 * ============================================================ */

(function (global) {
  'use strict';

  var READ_PREFIX = 'flowspace.chatLastRead.';
  var messages = [];
  var workspaceId = '';
  var subscribed = false;
  var unsubscribe = null;
  var chatRetryTimer = null;
  var chatRetryCount = 0;
  var localHandler = null;
  var localTimer = null;
  var knownIds = {};
  var firstLoadDone = false;
  // Status baca per user: high-water mark {lastReadAt, lastReadMessageId}.
  // `readLoaded` false berarti marker belum siap; badge dibuat 0 agar
  // pesan lama tidak sempat berkedip sebagai unread.
  var readState = { lastReadAt: '', lastReadMessageId: '' };
  var readLoaded = false;
  var readTimer = null;
  var pendingRead = null;

  function state() {
    // `State` dideklarasikan dengan const di app.js, jadi tidak menjadi
    // properti window. Akses lewat lexical global, bukan window.State.
    try {
      return typeof State !== 'undefined' ? State : null;
    } catch (e) {
      return null;
    }
  }
  function isFirebaseMode() {
    return !!(global.FlowFirebase && global.FlowFirebase.enabled);
  }
  function currentWorkspaceId() {
    var s = state();
    if (!s || !s.init || !s.init.workspace) return '';
    return String(s.init.workspace.id || '');
  }
  function myEmail() {
    var s = state();
    var email = s && s.init && s.init.currentUser ? s.init.currentUser.email : '';
    return String(email || '').toLowerCase();
  }
  function isMine(msg) {
    return !!msg && String(msg.senderEmail || '').toLowerCase() === myEmail();
  }
  function readKey() {
    return READ_PREFIX + (workspaceId || 'default');
  }
  function getLastRead() {
    try { return localStorage.getItem(readKey()) || ''; } catch (e) { return ''; }
  }
  function setLastRead(value) {
    try { localStorage.setItem(readKey(), value || new Date().toISOString()); } catch (e) {}
  }
  function ts(value) {
    var n = new Date(value || '').getTime();
    return isNaN(n) ? 0 : n;
  }
  function isDeleted(msg) {
    return !!(msg && (msg.isDeleted || msg.deletedAt));
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
  function normalizeAttachments(raw) {
    return parseAttachments(raw).filter(function (a) {
      return a && (a.type === 'task' || a.type === 'workflow') && a.id;
    }).slice(0, 3).map(function (a) {
      return {
        type: a.type,
        id: String(a.id),
        title: String(a.title || ''),
        meta: String(a.meta || ''),
      };
    });
  }

  /* ------------------------------------------------------------
   * Langganan pesan
   * ------------------------------------------------------------ */

  /**
   * Watch chat bisa ditolak sekali saat token auth baru berganti
   * (sign-in / refresh). Ulangi setelah token di-refresh alih-alih
   * langsung menampilkan error ke pengguna.
   */
  function subscribeChat(ws) {
    unsubscribe = global.FlowFirebase.chatSubscribe(50, handleMessages, function (err) {
      var code = String((err && err.code) || '');
      var text = code + ' ' + String((err && err.message) || '');
      var denied = /permission-denied|permission_denied|insufficient permissions/i.test(text);
      var user = global.FlowFirebase.currentUser && global.FlowFirebase.currentUser();
      if (denied && user && workspaceId === ws && chatRetryCount < 2) {
        chatRetryCount++;
        console.warn('[FlowSpace] chat listener ditolak — mencoba lagi (' + chatRetryCount + '/2)');
        if (chatRetryTimer) clearTimeout(chatRetryTimer);
        chatRetryTimer = setTimeout(function () {
          chatRetryTimer = null;
          if (workspaceId !== ws) return;
          var retry = function () { if (workspaceId === ws) subscribeChat(ws); };
          if (typeof user.getIdToken === 'function') user.getIdToken(true).then(retry, retry);
          else retry();
        }, 900 * chatRetryCount);
        return;
      }
      console.error('[FlowSpace] chat listener gagal', err);
      toast('Chat tidak dapat dimuat', 'error', err && err.message ? err.message : '');
    });
  }

  function init() {
    var ws = currentWorkspaceId();
    if (!ws) return;
    if (subscribed && ws === workspaceId) {
      refreshBadge();
      return;
    }
    stop();
    workspaceId = ws;
    subscribed = true;
    knownIds = {};
    firstLoadDone = false;
    readState = { lastReadAt: '', lastReadMessageId: '' };
    readLoaded = false;
    // Cache localStorage lama tetap dipakai sebagai fallback awal supaya
    // badge tidak kosong saat jaringan lambat.
    var legacy = getLastRead();
    if (legacy) readState.lastReadAt = legacy;
    loadReadState(ws);

    if (isFirebaseMode() && global.FlowFirebase && global.FlowFirebase.chatSubscribe) {
      subscribeChat(ws);
      return;
    }

    loadLocal();
    localHandler = function (e) {
      if (!e.detail || e.detail.collection !== 'chatMessages') return;
      if (localTimer) clearTimeout(localTimer);
      localTimer = setTimeout(loadLocal, 120);
    };
    global.addEventListener('fs:change', localHandler);
  }

  function loadLocal() {
    if (!global.Api || typeof global.Api.listChatMessages !== 'function') return;
    var res = global.Api.listChatMessages({ limit: 50 });
    if (!res || !res.success) {
      console.error('[FlowSpace] chat lokal gagal', res && res.message);
      return;
    }
    handleMessages((res.data || []).map(function (m) {
      // Samakan bentuk dengan FlowFirebase.chatSubscribe.
      return {
        message_id: m.id,
        body: m.body,
        sender_uid: m.senderUid,
        sender_email: m.senderEmail,
        sender_name: m.senderName,
        created_at: m.createdAt,
        edited_at: m.editedAt,
        deleted_at: m.deletedAt,
        attachments: m.attachments || [],
        isDeleted: m.isDeleted,
        canEdit: m.canEdit,
        canDelete: m.canDelete,
      };
    }));
  }

  function stop() {
    // Simpan marker yang masih tertunda sebelum workspace/sesi dilepas.
    flushRead();
    if (unsubscribe) {
      try { unsubscribe(); } catch (e) {}
      unsubscribe = null;
    }
    if (localHandler) {
      global.removeEventListener('fs:change', localHandler);
      localHandler = null;
    }
    if (localTimer) {
      clearTimeout(localTimer);
      localTimer = null;
    }
    if (chatRetryTimer) {
      clearTimeout(chatRetryTimer);
      chatRetryTimer = null;
    }
    chatRetryCount = 0;
    subscribed = false;
    workspaceId = '';
    messages = [];
    knownIds = {};
    firstLoadDone = false;
    readState = { lastReadAt: '', lastReadMessageId: '' };
    readLoaded = false;
    pendingRead = null;
  }

  function reset() {
    stop();
    refreshBadge();
  }

  function handleMessages(rows) {
    chatRetryCount = 0;
    var list = (rows || []).map(function (m) {
      var created = m.created_at || m.createdAt || '';
      var edited = m.edited_at || m.editedAt || '';
      var deleted = m.deleted_at || m.deletedAt || '';
      return {
        id: m.message_id || m.id,
        body: m.body || '',
        senderUid: m.sender_uid || m.senderUid || '',
        senderEmail: String(m.sender_email || m.senderEmail || '').toLowerCase(),
        senderName: m.sender_name || m.senderName || m.sender_email || m.senderEmail || '',
        createdAt: created,
        editedAt: edited,
        deletedAt: deleted,
        attachments: normalizeAttachments(m.attachments_json || m.attachmentsJson || m.attachments),
        isDeleted: !!deleted,
        canEdit: typeof m.canEdit === 'boolean' ? m.canEdit : false,
        canDelete: typeof m.canDelete === 'boolean' ? m.canDelete : false,
      };
    });

    var fresh = [];
    list.forEach(function (m) {
      if (!m.id) return;
      // Aturan edit/hapus dihitung lokal supaya mode Firebase dan lokal
      // menampilkan aksi yang sama (data mentah chat tidak membawa flag).
      var mine = isMine(m);
      var admin = !!(state() && state().init && state().init.currentUser && state().init.currentUser.role === 'admin');
      m.canEdit = !m.isDeleted && mine;
      m.canDelete = !m.isDeleted && (mine || admin);
      if (!knownIds[m.id]) {
        knownIds[m.id] = true;
        if (firstLoadDone && !m.isDeleted && !mine) fresh.push(m);
      }
    });

    messages = list;

    if (!firstLoadDone) {
      firstLoadDone = true;
      refreshBadge();
      emitChange();
      return;
    }

    if (fresh.length > 0 && !isChatView()) {
      var latest = fresh[fresh.length - 1];
      var who = latest.senderName || latest.senderEmail || 'Anggota tim';
      var preview = String(latest.body || '').replace(/\s+/g, ' ').trim();
      if (!preview && latest.attachments && latest.attachments.length > 0) {
        preview = '📎 ' + (latest.attachments[0].title || 'Lampiran');
      }
      if (preview.length > 90) preview = preview.slice(0, 90) + '…';
      toast(who + ' mengirim pesan', 'info', preview);
    }

    // Pesan sendiri yang baru terkirim selalu dianggap terbaca supaya
    // penanda tidak tertinggal di belakang (dan badge tidak salah hitung).
    if (isChatView() && messages.length > 0 && isMine(messages[messages.length - 1])) {
      markRead(messages[messages.length - 1]);
    }

    refreshBadge();
    emitChange();
  }

  function emitChange() {
    try {
      global.dispatchEvent(new CustomEvent('fs:chat-change', { detail: { count: messages.length } }));
    } catch (e) {}
  }

  function isChatView() {
    var s = state();
    return !!(s && s.view && s.view.kind === 'chat');
  }

  /* ------------------------------------------------------------
   * Status baca & badge
   * ------------------------------------------------------------ */

  function readReady() {
    return readLoaded;
  }

  function messageById(id) {
    for (var i = 0; i < messages.length; i++) {
      if (String(messages[i].id) === String(id)) return messages[i];
    }
    return null;
  }

  function isUnread(msgOrId) {
    if (!readLoaded) return false;
    var m = typeof msgOrId === 'string' ? messageById(msgOrId) : msgOrId;
    if (!m || !m.id || m.isDeleted) return false;
    if (isMine(m)) return false;
    if (readState.lastReadMessageId && String(m.id) === String(readState.lastReadMessageId)) return false;
    return ts(m.createdAt) > ts(readState.lastReadAt);
  }

  function firstUnreadId() {
    for (var i = 0; i < messages.length; i++) {
      if (isUnread(messages[i])) return String(messages[i].id);
    }
    return '';
  }

  function unreadCount() {
    if (!readLoaded) return 0;
    return messages.filter(function (m) { return isUnread(m); }).length;
  }

  function loadReadState(wsAtLoad) {
    var p = null;
    try {
      if (isFirebaseMode() && global.FlowFirebase && global.FlowFirebase.chatReadGet) {
        p = global.FlowFirebase.chatReadGet();
      } else if (global.Api && typeof global.Api.getChatReadState === 'function') {
        p = Promise.resolve(global.Api.getChatReadState());
      }
    } catch (e) {
      p = Promise.reject(e);
    }
    if (!p || typeof p.then !== 'function') {
      readLoaded = true;
      return;
    }
    p.then(function (res) {
      if (workspaceId !== wsAtLoad) return;
      var data = res && res.success !== undefined ? (res.success ? res.data : null) : res;
      if (data && (data.lastReadAt || data.lastReadMessageId)) {
        readState = {
          lastReadAt: String(data.lastReadAt || ''),
          lastReadMessageId: String(data.lastReadMessageId || ''),
        };
        setLastRead(readState.lastReadAt);
      } else {
        // Kunjungan pertama: 50 pesan lama tidak dihitung sebagai unread.
        var now = new Date().toISOString();
        readState = { lastReadAt: now, lastReadMessageId: '' };
        setLastRead(now);
        persistRead(now, '');
      }
      readLoaded = true;
      refreshBadge();
      emitChange();
    }, function (err) {
      if (workspaceId !== wsAtLoad) return;
      console.error('[FlowSpace] status baca chat gagal', err);
      if (!readState.lastReadAt) readState.lastReadAt = new Date().toISOString();
      readLoaded = true;
      refreshBadge();
      emitChange();
    });
  }

  function persistRead(lastReadAt, lastReadMessageId) {
    pendingRead = {
      lastReadAt: String(lastReadAt || '').slice(0, 40),
      lastReadMessageId: String(lastReadMessageId || '').slice(0, 120),
    };
    setLastRead(pendingRead.lastReadAt);
    if (readTimer) clearTimeout(readTimer);
    readTimer = setTimeout(flushRead, 500);
  }

  function flushRead() {
    if (readTimer) {
      clearTimeout(readTimer);
      readTimer = null;
    }
    var payload = pendingRead;
    pendingRead = null;
    if (!payload || !payload.lastReadAt || !workspaceId) return;
    var p = null;
    try {
      if (isFirebaseMode() && global.FlowFirebase && global.FlowFirebase.chatReadSet) {
        if (!global.FlowFirebase.currentWorkspaceId || !global.FlowFirebase.currentWorkspaceId()) return;
        p = global.FlowFirebase.chatReadSet(payload.lastReadAt, payload.lastReadMessageId);
      } else if (global.Api && typeof global.Api.setChatReadState === 'function') {
        p = Promise.resolve(global.Api.setChatReadState(payload));
      }
    } catch (e) {
      p = Promise.reject(e);
    }
    if (p && typeof p.catch === 'function') {
      p.catch(function (err) { console.error('[FlowSpace] gagal menyimpan status baca chat', err); });
    }
  }

  // Tandai satu pesan (atau pesan terbaru) sudah dibaca. Marker tidak
  // pernah mundur; tulisan ke server di-debounce 500 ms.
  function markRead(msg) {
    if (!readLoaded) return;
    var target = msg;
    if (!target) {
      for (var i = messages.length - 1; i >= 0; i--) {
        if (!messages[i].isDeleted) { target = messages[i]; break; }
      }
    }
    if (typeof target === 'string') target = messageById(target);
    if (!target || target.isDeleted || !target.createdAt) return;
    if (ts(target.createdAt) < ts(readState.lastReadAt)) return;
    if (
      ts(target.createdAt) === ts(readState.lastReadAt)
      && readState.lastReadMessageId
      && String(target.id) === String(readState.lastReadMessageId)
    ) {
      return;
    }
    readState = {
      lastReadAt: String(target.createdAt),
      lastReadMessageId: String(target.id || ''),
    };
    persistRead(readState.lastReadAt, readState.lastReadMessageId);
    refreshBadge();
    emitChange();
  }

  function refreshBadge() {
    var el = document.getElementById('chat-nav-badge');
    if (!el) return;
    var count = unreadCount();
    if (count <= 0) {
      el.textContent = '0';
      el.classList.add('hidden');
      el.classList.remove('inline-flex');
      el.setAttribute('aria-hidden', 'true');
      el.removeAttribute('aria-label');
      el.removeAttribute('title');
      return;
    }
    var label = count > 99 ? '99+' : String(count);
    el.textContent = label;
    el.classList.remove('hidden');
    el.classList.add('inline-flex');
    el.removeAttribute('aria-hidden');
    el.setAttribute('aria-label', label + ' pesan belum dibaca');
    el.title = label + ' pesan belum dibaca';
  }

  /* ------------------------------------------------------------
   * Aksi
   * ------------------------------------------------------------ */

  function send(body, attachments) {
    var text = String(body || '').trim();
    var list = normalizeAttachments(attachments);
    if (!text && list.length === 0) return Promise.resolve({ success: false, message: 'Tulis pesan atau lampirkan task/workflow' });
    if (text.length > 2000) return Promise.resolve({ success: false, message: 'Pesan maksimal 2000 karakter' });
    if (list.length > 3) return Promise.resolve({ success: false, message: 'Maksimal 3 lampiran per pesan' });

    if (isFirebaseMode() && global.FlowFirebase && global.FlowFirebase.chatSend) {
      return global.FlowFirebase.chatSend(text, list)
        .then(function () { return { success: true }; })
        .catch(function (err) { return { success: false, message: (err && err.message) || 'Gagal mengirim pesan' }; });
    }
    return global.callServer('sendChatMessage', { body: text, attachments: list });
  }

  function update(messageId, body) {
    var text = String(body || '').trim();
    if (!text) return Promise.resolve({ success: false, message: 'Pesan tidak boleh kosong' });
    if (text.length > 2000) return Promise.resolve({ success: false, message: 'Pesan maksimal 2000 karakter' });

    if (isFirebaseMode() && global.FlowFirebase && global.FlowFirebase.chatUpdate) {
      return global.FlowFirebase.chatUpdate(messageId, text)
        .then(function () { return { success: true }; })
        .catch(function (err) { return { success: false, message: (err && err.message) || 'Gagal memperbarui pesan' }; });
    }
    return global.callServer('updateChatMessage', { id: messageId, body: text });
  }

  function remove(messageId) {
    if (isFirebaseMode() && global.FlowFirebase && global.FlowFirebase.chatDelete) {
      return global.FlowFirebase.chatDelete(messageId)
        .then(function () { return { success: true }; })
        .catch(function (err) { return { success: false, message: (err && err.message) || 'Gagal menghapus pesan' }; });
    }
    return global.callServer('deleteChatMessage', messageId);
  }

  // Simpan marker terakhir saat tab ditutup/ditinggalkan.
  if (global.addEventListener) {
    global.addEventListener('pagehide', function () { flushRead(); });
  }

  global.Chat = {
    init: init,
    reset: reset,
    stop: stop,
    markRead: markRead,
    refreshBadge: refreshBadge,
    unreadCount: unreadCount,
    isUnread: isUnread,
    firstUnreadId: firstUnreadId,
    isReadReady: readReady,
    getMessages: function () { return messages.slice(); },
    send: send,
    update: update,
    remove: remove,
  };
})(window);
