/* ============================================================
 * FlowSpace - app.js
 * State, router, util, transport (callServer), dan boot.
 * ============================================================ */

// State management sederhana
const State = {
  view: { kind: 'dashboard' },
  init: null,
  currentWorkflowId: null,
  currentWorkflowName: '',
  canvasDirty: false,
  canvasSaving: false,
  canvasLoading: false,
  canvasVersion: 1,
  editor: null, // Drawflow instance
  kanbanFilters: {},
  workflowFilters: { q: '', dept: '', category: '' },
  teamFilters: { q: '', role: '', status: '' },
  taskDrawer: { taskId: null },
};

// Konstanta frontend
const STATUSES = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'todo', label: 'To Do' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'review', label: 'Review' },
  { id: 'done', label: 'Done' },
];
const PRIORITIES = [
  { id: 'critical', label: 'Critical' },
  { id: 'high', label: 'High' },
  { id: 'medium', label: 'Medium' },
  { id: 'low', label: 'Low' },
];
const NODE_TYPES = [
  { id: 'start_end', label: 'Start/End', icon: 'circle' },
  { id: 'process', label: 'Process', icon: 'square' },
  { id: 'task', label: 'Task', icon: 'check-square' },
  { id: 'decision', label: 'Decision', icon: 'diamond' },
  { id: 'application', label: 'Application', icon: 'app-window' },
  { id: 'note', label: 'Note', icon: 'sticky-note' },
  { id: 'workflow_link', label: 'Workflow Lanjutan', icon: 'link-2' },
];
const APP_CATEGORIES = ['Communication', 'Documentation', 'Internal System', 'Dashboard', 'CRM', 'Form', 'Spreadsheet', 'Other'];
// Departemen tetap untuk workflow (bisa dipilih lebih dari satu).
const WORKFLOW_DEPARTMENTS = ['Breeder', 'Laboratorium', 'Plasma', 'Budidaya', 'Marketing', 'Keuangan', 'Data', 'EDP'];
const STATUS_LABEL = Object.fromEntries(STATUSES.map(s => [s.id, s.label]));
const PRIORITY_LABEL = Object.fromEntries(PRIORITIES.map(p => [p.id, p.label]));
const NODE_TYPE_LABEL = Object.fromEntries(NODE_TYPES.map(t => [t.id, t.label]));

/* ============================================================
 * Utility helpers
 * ============================================================ */

function $(selector, parent = document) { return parent.querySelector(selector); }
function $$(selector, parent = document) { return Array.from(parent.querySelectorAll(selector)); }

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch (e) { return dateStr; }
}

function formatDateTime(iso) {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (e) { return iso; }
}

// Kunci tanggal lokal (YYYY-MM-DD). String tanggal murni ("2026-10-01")
// dipakai apa adanya agar tidak bergeser hari karena konversi UTC.
function dateKey(value) {
  if (!value) return '';
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function localTodayKey() { return dateKey(new Date()); }

function isOverdue(dueDate, status) {
  if (!dueDate || status === 'done') return false;
  return dateKey(dueDate) < localTodayKey();
}

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}

/* ============================================================
 * Transport (callServer) — menggantikan google.script.run.
 * Mode lokal memanggil Api; nanti bisa diganti adapter Firebase.
 * ============================================================ */

const SERVER_ALIASES = {
  archiveWorkflow: (workflowId) => Api.updateWorkflow({ id: workflowId, status: 'archived' }),
  updateTaskStatus: (payload) => Api.updateTask({ id: payload.taskId, status: payload.status, expectedVersion: payload.expectedVersion }),
  updateTaskProgress: (payload) => Api.updateTask({ id: payload.taskId, progress: payload.progress, expectedVersion: payload.expectedVersion }),
};

function callServer(fnName, ...args) {
  return Promise.resolve().then(() => {
    try {
      if (SERVER_ALIASES[fnName]) return SERVER_ALIASES[fnName](...args);
      if (typeof Api[fnName] === 'function') return Api[fnName](...args);
      return { success: false, message: 'Fungsi tidak dikenal: ' + fnName, errorCode: 'NO_FN' };
    } catch (err) {
      console.error('callServer error', fnName, err);
      return { success: false, message: (err && err.message) || String(err), errorCode: 'SERVER_ERROR' };
    }
  });
}

/* ============================================================
 * Toast notifications
 * ============================================================ */

function toast(message, type = 'success', description = '') {
  const container = $('#toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  const icon = type === 'success' ? 'check-circle' : type === 'error' ? 'alert-circle' : 'info';
  el.innerHTML = `<i data-lucide="${icon}" class="h-4 w-4"></i><div><div>${escapeHtml(message)}</div>${description ? `<div class="text-xs opacity-80">${escapeHtml(description)}</div>` : ''}</div>`;
  container.appendChild(el);
  refreshIcons();
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 200); }, 3500);
}

/* ============================================================
 * Navigation
 * ============================================================ */

const NAV_ITEMS = [
  { label: 'Dashboard', icon: 'layout-dashboard', view: { kind: 'dashboard' } },
  { label: 'Workflows', icon: 'workflow', view: { kind: 'workflows' } },
  { label: 'Kanban Board', icon: 'square-kanban', view: { kind: 'kanban' } },
  { label: 'Application Hub', icon: 'app-window', view: { kind: 'applications' } },
  { label: 'Team & Members', icon: 'users', view: { kind: 'team' } },
  { label: 'Chat Tim', icon: 'messages-square', view: { kind: 'chat' } },
  { label: 'Settings', icon: 'settings', view: { kind: 'settings' } },
];

function renderNav() {
  const nav = $('#nav-menu');
  const isActive = (item) => State.view.kind === item.view.kind || (item.view.kind === 'workflows' && State.view.kind === 'canvas');
  nav.innerHTML = `
    <div class="sidebar-label">Workspace</div>
    ${NAV_ITEMS.map(item => `
      <button data-view="${item.view.kind}" class="nav-btn ${isActive(item) ? 'active' : ''}">
        <i data-lucide="${item.icon}" class="h-4 w-4 shrink-0"></i>
        <span class="truncate nav-label">${item.label}</span>
        ${item.view.kind === 'chat' ? '<span id="chat-nav-badge" class="ml-auto hidden items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-berry text-white text-[10px] font-semibold leading-none" aria-hidden="true">0</span>' : ''}
      </button>
    `).join('')}
  `;
  $$('.nav-btn', nav).forEach(btn => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.view;
      const item = NAV_ITEMS.find(i => i.view.kind === v);
      if (item) { setView(item.view); closeSidebar(); }
    });
  });
  refreshIcons();
  if (window.Chat) Chat.refreshBadge();
}

function setView(view) {
  State.view = view;
  if (view.kind !== 'canvas') {
    State.currentWorkflowId = null;
    State.editor = null;
  }
  renderNav();
  renderHeader();
  renderView();
}

function renderHeader() {
  const bc = $('#header-breadcrumb');
  if (State.view.kind === 'canvas') {
    bc.innerHTML = `
      <span class="text-inksoft">FlowSpace</span>
      <i data-lucide="chevron-right" class="h-3 w-3 text-inksoft/50"></i>
      <button class="text-inksoft hover:text-ink" id="back-to-workflows">Workflows</button>
      <i data-lucide="chevron-right" class="h-3 w-3 text-inksoft/50"></i>
      <span class="font-medium truncate max-w-[300px]">${escapeHtml(State.currentWorkflowName)}</span>
    `;
    setTimeout(() => {
      const backBtn = $('#back-to-workflows');
      if (backBtn) backBtn.addEventListener('click', () => setView({ kind: 'workflows' }));
    }, 0);
  } else {
    const titles = { dashboard: 'Dashboard', workflows: 'Workflows', kanban: 'Kanban Board', applications: 'Application Hub', team: 'Team & Members', chat: 'Chat Tim', settings: 'Settings' };
    bc.innerHTML = `<span class="font-medium">${titles[State.view.kind] || 'FlowSpace'}</span>`;
  }
  // User info
  const ui = $('#user-info');
  if (State.init && State.init.currentUser) {
    const u = State.init.currentUser;
    const initials = (u.displayName || 'A').split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();
    ui.title = u.email || '';
    ui.innerHTML = `
      <div class="h-8 w-8 rounded-full bg-fernlight/15 text-fernlight flex items-center justify-center text-xs font-semibold">${initials}</div>
      <div class="hidden sm:flex flex-col">
        <span class="text-xs font-medium leading-tight">${escapeHtml(u.displayName)}</span>
        <span class="text-[10px] text-inksoft/70 capitalize">${u.role}</span>
      </div>
    `;
  }

  // Tombol keluar hanya saat login Firebase aktif.
  if (window.FlowFirebase && FlowFirebase.enabled) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'header-logout';
    btn.className = 'ml-1 h-8 w-8 flex items-center justify-center rounded-md text-inksoft hover:bg-paper hover:text-ink shrink-0';
    btn.title = 'Keluar';
    btn.setAttribute('aria-label', 'Keluar');
    btn.innerHTML = '<i data-lucide="log-out" class="h-4 w-4"></i>';
    btn.addEventListener('click', () => doLogout());
    ui.appendChild(btn);
  }
  refreshIcons();
}

async function doLogout() {
  if (!(window.FlowFirebase && FlowFirebase.enabled)) return;
  const ok = await showConfirmDialog({
    title: 'Keluar dari FlowSpace?',
    message: 'Data yang sudah tersinkron tetap aman di Firestore. Anda perlu masuk kembali untuk melanjutkan.',
    confirmText: 'Keluar',
    cancelText: 'Batal',
  });
  if (!ok) return;
  try {
    await FlowFirebase.signOut();
    toast('Anda telah keluar');
  } catch (err) {
    toast('Gagal keluar dari akun', 'error');
  }
}

/* ============================================================
 * View renderer dispatch
 * ============================================================ */

async function renderView() {
  const container = $('#view-container');
  container.className = 'h-full w-full overflow-hidden';
  switch (State.view.kind) {
    case 'dashboard': return renderDashboard(container);
    case 'workflows': return renderWorkflows(container);
    case 'canvas': return renderCanvas(container);
    case 'kanban': return renderKanban(container);
    case 'applications': return renderApplications(container);
    case 'team': return renderTeam(container);
    case 'chat': return renderChatView(container);
    case 'settings': return renderSettings(container);
    default: container.innerHTML = '<div class="p-6">Unknown view</div>';
  }
}

/* ============================================================
 * Initialize app
 * ============================================================ */

async function initApp() {
  const res = await callServer('getInitialAppData');
  if (!res.success) {
    if (res.errorCode === 'NO_WORKSPACE' && window.FlowFirebase && FlowFirebase.enabled) {
      AuthUI.mount();
      AuthUI.show('onboarding', { notice: 'Workspace tidak dapat dimuat. Pastikan firestore.rules sudah di-deploy lalu coba lagi.' });
      return;
    }
    $('#view-container').innerHTML = `<div class="p-6 text-berry">Gagal memuat: ${escapeHtml(res.message || 'Unknown')}</div>`;
    return;
  }
  State.init = res.data;
  // Tampilkan nama workspace di sidebar
  if (res.data.workspace) $('#ws-name').textContent = res.data.workspace.name;
  if (window.FlowFirebase && window.FlowFirebase.setCurrentMember) {
    var meInit = (res.data.members || []).find(function(m){ return String(m.email).toLowerCase() === String((res.data.currentUser && res.data.currentUser.email)||'').toLowerCase(); });
    if (meInit) window.FlowFirebase.setCurrentMember({ display_name: meInit.displayName, email: meInit.email, role: meInit.role });
  }
  if (window.Chat) Chat.init();
  renderNav();
  renderHeader();
  if (window.Notifications) Notifications.mount();
  renderView();
}

/* ============================================================
 * Boot: mode lokal atau Firebase
 * ============================================================ */

function setSyncLabel(state) {
  const el = $('#sync-label');
  if (!el) return;
  const labels = {
    local: 'Live · Local',
    connecting: 'Menghubungkan…',
    online: 'Live · Firebase',
    offline: 'Offline',
  };
  el.textContent = labels[state] || labels.local;
  if (state === 'online' && window.FlowFirebase && FlowFirebase.enabled) {
    el.title = 'Tersinkron dengan Firestore · ' + FlowFirebase.info().projectId;
  } else if (state === 'local') {
    el.title = 'Data hanya tersimpan di browser ini';
  } else if (state === 'offline') {
    el.title = 'Tidak ada sesi aktif';
  }
}

async function boot() {
  const fb = window.FlowFirebase;
  if (!fb || !fb.enabled) {
    setSyncLabel('local');
    initApp();
    return;
  }

  setSyncLabel('connecting');
  try {
    await fb.init();
  } catch (err) {
    console.error('[FlowSpace] init Firebase gagal', err);
    if (window.AuthUI) {
      AuthUI.mount();
      AuthUI.showError((err && err.message) || 'Firebase gagal dimuat.');
    }
    return;
  }

  // Catatan: jangan memeriksa `fb.currentUser()` di sini. Pemulihan sesi
  // Auth berjalan asinkron setelah `init()`, jadi nilainya masih null
  // walau sesi tersimpan sah. Pemeriksaan dini di titik ini pernah memicu
  // reload yang justru mengganggu pemulihan sesi. Penanganan sesi hilang
  // dilakukan setelah Auth benar-benar selesai (lihat handleAuthChange).
  AuthUI.mount();
  AuthUI.show('loading');
  fb.onAuthChange(handleAuthChange);
}

// Setiap perubahan status auth menaikkan nomor ini; hasil proses yang
// sudah usang (mis. user logout saat attach berjalan) diabaikan.
let _authRun = 0;
let _hadUser = false;
let _fatalShown = false;
// uid yang listener workspace-nya sedang aktif. Dipakai untuk mendeteksi
// akun yang berganti (mis. login di tab lain) sebelum listener lama
// membanjiri console dengan permission-denied.
let _attachedUid = null;

// Jeda retry untuk gangguan jaringan singkat. Assertion fatal tidak
// di-retry karena klien Firestore sudah tidak bisa dipakai. Jeda pertama
// juga memberi SDK waktu menyelesaikan credential change setelah sign-in /
// refresh token; membaca lebih awal hanya menghasilkan AbortError.
const AUTH_RETRY_DELAYS = [250, 600, 1600, 3000];
const ATTACH_RETRY_DELAYS = [0, 800, 2000];

// Waktu (epoch ms) auto-reload terakhir karena sesi tersimpan gagal dibaca.
// Disimpan di sessionStorage dan dibatasi 1x per menit agar flapping auth
// (dua tab saling menimpa status) tidak berubah menjadi loop reload.
const AUTH_RECOVER_AT = 'flowspace.authRecoveredAt';

function lastAutoRecoverAt() {
  try { return Number(sessionStorage.getItem(AUTH_RECOVER_AT) || 0) || 0; } catch (e) { return 0; }
}

function markAutoRecover() {
  try { sessionStorage.setItem(AUTH_RECOVER_AT, String(Date.now())); } catch (e) {}
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sesaat setelah sign-in (popup) atau saat token diperbarui, SDK sempat
 * memakai kredensial lama sehingga `get()` dibalas `permission-denied`.
 * Itu bukan masalah hak akses, jadi layak dicoba lagi selama user masih
 * masuk. Tanpa retry, layar "buat workspace" muncul padahal akun sah.
 */
function isAuthRaceDenied(fb, user, err) {
  if (!user || !user.uid) return false;
  if (!(fb.currentUser && fb.currentUser())) return false;
  const text = String((err && err.code) || '') + ' ' + String((err && err.message) || '');
  return /permission-denied|permission_denied|unauthenticated/i.test(text);
}

async function resolveMembershipWithRetry(fb, user, run) {
  let lastErr = null;
  for (let attempt = 0; attempt < AUTH_RETRY_DELAYS.length; attempt++) {
    if (run !== _authRun) return null;
    if (AUTH_RETRY_DELAYS[attempt] > 0) await wait(AUTH_RETRY_DELAYS[attempt]);
    try {
      return await fb.resolveMembership(user);
    } catch (err) {
      lastErr = err;
      if (fb.isFatalFirestoreError && fb.isFatalFirestoreError(err)) throw err;
      const retryable = (fb.isTransientError && fb.isTransientError(err))
        || isAuthRaceDenied(fb, user, err);
      if (!retryable) throw err;
      console.warn(
        `[FlowSpace] resolveMembership gagal (percobaan ${attempt + 1}/${AUTH_RETRY_DELAYS.length})`,
        (err && (err.code || err.message)) || err
      );
    }
  }
  throw lastErr;
}

/**
 * Pasang listener workspace. Kalau listener langsung ditolak walau
 * keanggotaan sudah terverifikasi, itu tanda token Firestore belum siap:
 * refresh token lalu coba lagi sebelum menyimpulkan akun memang tidak
 * berhak (layar "Akses workspace ditolak").
 */
async function attachWithRetry(fb, res, run) {
  let lastErr = null;
  for (let attempt = 0; attempt < ATTACH_RETRY_DELAYS.length; attempt++) {
    if (run !== _authRun) return false;
    if (ATTACH_RETRY_DELAYS[attempt] > 0) {
      await wait(ATTACH_RETRY_DELAYS[attempt]);
      if (run !== _authRun) return false;
      const user = fb.currentUser && fb.currentUser();
      if (user && typeof user.getIdToken === 'function') {
        try {
          await user.getIdToken(true);
        } catch (err) {
          console.warn('[FlowSpace] refresh token gagal', err && (err.code || err.message));
        }
      }
    }
    try {
      await fb.attach(res.workspaceId, res.member);
      return true;
    } catch (err) {
      lastErr = err;
      const code = String((err && err.code) || '');
      if (code === 'flowspace/session-changed') throw err;
      if (fb.isFatalFirestoreError && fb.isFatalFirestoreError(err)) throw err;
      const retryable = code === 'flowspace/workspace-denied'
        || (fb.isPermissionDenied && fb.isPermissionDenied(err))
        || (fb.isTransientError && fb.isTransientError(err));
      if (!retryable) throw err;
      console.warn(
        `[FlowSpace] attach gagal (percobaan ${attempt + 1}/${ATTACH_RETRY_DELAYS.length})`,
        (err && (err.code || err.message)) || err
      );
    }
  }
  throw lastErr;
}

/**
 * Firestore assertion fatal membuat klien mati permanen. Satu-satunya
 * pemulihan yang andal adalah reload halaman; tampilkan layar yang jelas
 * alih-alih membiarkan aplikasi tampak "logout" atau menggantung.
 */
function showFatalFirestore(err) {
  if (_fatalShown) return;
  _fatalShown = true;
  _authRun++; // batalkan proses auth yang masih berjalan
  console.error('[FlowSpace] Firestore fatal — perlu reload', err);
  setSyncLabel('offline');
  if (window.AuthUI) {
    AuthUI.mount();
    AuthUI.show('recover', {
      fatal: true,
      notice: 'Koneksi data ke Firestore terputus. Muat ulang halaman untuk melanjutkan. Data yang sudah tersimpan tetap aman.',
    });
  }
}

async function handleAuthChange(user) {
  const fb = window.FlowFirebase;
  if (!fb || !fb.enabled) return;
  const run = ++_authRun;

  if (!user) {
    const wasSignedIn = _hadUser;
    _hadUser = false;
    const explicit = fb.consumeExplicitSignOut ? fb.consumeExplicitSignOut() : true;
    const hadSession = fb.hasSessionMarker ? fb.hasSessionMarker() : false;
    fb.detach();
    _attachedUid = null;
    if (window.Chat) Chat.reset();
    if (window.Notifications) Notifications.reset();
    State.init = null;
    setSyncLabel('offline');
    AuthUI.mount();

    // Auth sudah menyatakan tidak ada user (setelah verifikasi ulang di
    // firebase.js). Selama ada penanda sesi, gangguan IndexedDB sesaat
    // masih mungkin: muat ulang halaman supaya sesi dibaca ulang dari
    // penyimpanan. Dibatasi 1x per menit agar tidak menjadi loop.
    if (!explicit && hadSession && Date.now() - lastAutoRecoverAt() > 60000) {
      markAutoRecover();
      console.warn('[FlowSpace] sesi tersimpan belum terbaca — memuat ulang sekali.');
      location.reload();
      return;
    }

    // Jangan pernah menampilkan layar "Sesi tidak terbaca" yang buntu.
    // Kalau sesi memang berakhir, layar masuk biasa + penjelasan singkat
    // sudah cukup; penanda sesi lama dibersihkan supaya tidak memicu
    // pemulihan berulang di kunjungan berikutnya.
    if (!explicit && (wasSignedIn || hadSession)) {
      if (hadSession && fb.clearSessionMarker) fb.clearSessionMarker();
      AuthUI.show('signin', {
        kind: 'info',
        notice: wasSignedIn
          ? 'Sesi berakhir atau tidak dapat dibaca. Silakan masuk kembali — data Anda tetap tersimpan.'
          : 'Sesi yang tersimpan di perangkat ini tidak dapat dibaca. Silakan masuk kembali.',
      });
      return;
    }

    AuthUI.show('signin');
    return;
  }

  _hadUser = true;

  // Akun berganti (login/logout di tab lain). Listener workspace lama masih
  // memakai kredensial baru, jadi semuanya dibalas permission-denied sampai
  // attach baru selesai. Lepas dulu sebelum membaca keanggotaan.
  if (_attachedUid && _attachedUid !== String(user.uid)) {
    console.warn('[FlowSpace] akun berganti — melepas listener workspace lama.');
    fb.detach();
    if (window.Chat) Chat.reset();
    if (window.Notifications) Notifications.reset();
    State.init = null;
    _attachedUid = null;
    setSyncLabel('offline');
    AuthUI.mount();
    AuthUI.show('loading');
  }

  try {
    const res = await resolveMembershipWithRetry(fb, user, run);
    if (!res || run !== _authRun) return;

    if (res.status === 'active') {
      // Hindari memuat ulang saat event auth berulang untuk workspace sama.
      if (fb.currentWorkspaceId() === res.workspaceId && State.init) {
        if (fb.rememberSession) fb.rememberSession(user);
        _attachedUid = String(user.uid);
        AuthUI.hide();
        setSyncLabel('online');
        return;
      }
      AuthUI.mount();
      AuthUI.show('loading');
      await attachWithRetry(fb, res, run);
      if (run !== _authRun) return;
      _attachedUid = String(user.uid);
      if (fb.setCurrentMember) fb.setCurrentMember(res.member);
      if (fb.rememberSession) fb.rememberSession(user);
      AuthUI.hide();
      setSyncLabel('online');
      await initApp();
      return;
    }

    if (res.status === 'inactive') {
      fb.detach();
      _attachedUid = null;
      setSyncLabel('offline');
      AuthUI.mount();
      AuthUI.show('inactive');
      return;
    }

    fb.detach();
    _attachedUid = null;
    setSyncLabel('offline');
    AuthUI.mount();
    AuthUI.show('onboarding');
  } catch (err) {
    if (run !== _authRun) return;
    const code = String((err && err.code) || '');
    const denied = (fb.isPermissionDenied && fb.isPermissionDenied(err))
      || code === 'flowspace/membership-denied'
      || code === 'flowspace/workspace-denied';
    const sessionChanged = code === 'flowspace/session-changed';
    if (denied || sessionChanged) console.warn('[FlowSpace] memuat workspace ditunda', (err && (err.code || err.message)) || err);
    else console.error('[FlowSpace] gagal memuat workspace', err);

    if (fb.isFatalFirestoreError && fb.isFatalFirestoreError(err)) {
      showFatalFirestore(err);
      return;
    }

    setSyncLabel('offline');
    AuthUI.mount();

    if (sessionChanged) {
      fb.detach();
      _attachedUid = null;
      AuthUI.show('recover', { notice: fb.friendlyError(err) });
      return;
    }

    if (fb.isTransientError && fb.isTransientError(err)) {
      AuthUI.show('recover', {
        notice: 'Server tidak dapat dihubungi. Periksa koneksi internet lalu coba lagi.',
      });
      return;
    }

    // Workspace tidak bisa dibaca / akun bukan anggota aktif: jangan tawarkan
    // "buat workspace" karena akan gagal juga. Beri jalan coba lagi & keluar.
    if (denied) {
      fb.detach();
      _attachedUid = null;
      AuthUI.show('access', { notice: fb.friendlyError(err) });
      return;
    }

    fb.detach();
    _attachedUid = null;
    AuthUI.show('onboarding', { notice: fb.friendlyError(err) });
  }
}
window.FlowHandleAuth = handleAuthChange;

// Listener yang sudah aktif bisa ditolak server saat kredensial Firestore
// berganti (refresh token, tab lain, reconnect jaringan). Sebelumnya kondisi
// ini hanya ditulis ke console sehingga aplikasi tampak beku. Refresh token
// lalu pasang ulang listener; dibatasi supaya tidak menjadi loop.
let _deniedTimer = null;
let _deniedRecoverAt = 0;

window.addEventListener('fs:workspace-denied', () => {
  const fb = window.FlowFirebase;
  if (!fb || !fb.enabled) return;
  if (_deniedTimer) clearTimeout(_deniedTimer);
  _deniedTimer = setTimeout(async () => {
    _deniedTimer = null;
    if (Date.now() - _deniedRecoverAt < 30000) return;
    const user = fb.currentUser && fb.currentUser();
    if (!user) return;
    _deniedRecoverAt = Date.now();
    console.warn('[FlowSpace] listener workspace ditolak — menyegarkan token lalu memasang ulang.');
    fb.detach();
    _attachedUid = null;
    try {
      if (typeof user.getIdToken === 'function') await user.getIdToken(true);
    } catch (err) {
      console.warn('[FlowSpace] refresh token gagal', err && (err.code || err.message));
    }
    const fresh = fb.currentUser && fb.currentUser();
    if (!fresh || String(fresh.uid) !== String(user.uid)) return;
    await handleAuthChange(fresh);
  }, 1200);
});

// Jaring pengaman untuk assertion Firestore yang lolos sebagai error global.
window.addEventListener('fs:firebase-fatal', (ev) => {
  showFatalFirestore((ev && ev.detail) || null);
});

// Firestore/WebChannel kadang membatalkan request saat halaman ditinggal
// atau listener dilepas (`AbortError: signal is aborted without reason`).
// Itu bukan kegagalan aplikasi, jadi jangan sampai mengotori console atau
// memicu layar pemulihan.
function isBenignAbort(reason) {
  if (!reason) return false;
  const name = String(reason.name || '');
  const msg = String(reason.message || reason || '');
  return name === 'AbortError' || /signal is aborted|aborted without reason/i.test(msg);
}

window.addEventListener('error', (ev) => {
  const fb = window.FlowFirebase;
  if (fb && fb.isFatalFirestoreError && fb.isFatalFirestoreError(ev.error || ev.message)) {
    showFatalFirestore(ev.error || ev.message);
  }
});

window.addEventListener('unhandledrejection', (ev) => {
  if (isBenignAbort(ev.reason)) {
    ev.preventDefault();
    return;
  }
  const fb = window.FlowFirebase;
  if (fb && fb.isFatalFirestoreError && fb.isFatalFirestoreError(ev.reason)) {
    showFatalFirestore(ev.reason);
  }
});

document.addEventListener('DOMContentLoaded', () => {
  if ('serviceWorker' in navigator) {
    try {
      navigator.serviceWorker.register('/sw.js').catch(function(){});
    } catch (e) {}
  }
  boot();
});

// Sidebar off-canvas (mobile) — buka/tutup
function openSidebar() {
  const sidebar = $('#sidebar');
  const backdrop = $('#sidebar-backdrop');
  if (sidebar) sidebar.classList.remove('-translate-x-full');
  if (backdrop) backdrop.classList.remove('hidden');
}
function closeSidebar() {
  const sidebar = $('#sidebar');
  const backdrop = $('#sidebar-backdrop');
  if (sidebar) sidebar.classList.add('-translate-x-full');
  if (backdrop) backdrop.classList.add('hidden');
}


// Wire up hamburger, close, backdrop, dan toggle collapse sidebar
  document.addEventListener('DOMContentLoaded', () => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      try {
        setTimeout(function(){ Notification.requestPermission().catch(function(){}); }, 1500);
      } catch (e) {}
    }
    const hamburger = document.getElementById('hamburger-btn');
    const close = document.getElementById('sidebar-close');
    const backdrop = document.getElementById('sidebar-backdrop');
    const toggle = document.getElementById('sidebar-toggle');
    const expand = document.getElementById('sidebar-expand');
    const key = 'flowspace.sidebar.collapsed';

    function applyCollapsed(v) {
      if (v) {
        document.body.classList.add('sidebar-collapsed');
      } else {
        document.body.classList.remove('sidebar-collapsed');
      }
      try { localStorage.setItem(key, v ? '1' : '0'); } catch (e) {}
      if (window.lucide && typeof lucide.createIcons === 'function') {
        try { lucide.createIcons(); } catch (e) {}
      }
    }

    try {
      if (localStorage.getItem(key) === '1') {
        document.body.classList.add('sidebar-collapsed');
      }
    } catch (e) {}

    if (toggle) {
      toggle.addEventListener('click', () => applyCollapsed(true));
    }
    if (expand) {
      expand.addEventListener('click', () => applyCollapsed(false));
    }

    if (hamburger) hamburger.addEventListener('click', openSidebar);
    if (close) close.addEventListener('click', closeSidebar);
    if (backdrop) backdrop.addEventListener('click', closeSidebar);
  });

/* Realtime: otomatis refresh view saat ada perubahan dari TAB LAIN.
 * Perubahan dari tab yang sama sudah direfresh oleh handler aksi masing-masing. */
let _rtTimer = null;
window.addEventListener('fs:change', (e) => {
  if (!e.detail || !e.detail.external) return;
  if (!State.init) return;
  const kind = State.view.kind;
  if (['dashboard', 'workflows', 'kanban', 'applications', 'team'].indexOf(kind) === -1) return;
  // Hindari mengganggu drag-and-drop aktif atau dialog yang sedang terbuka.
  if (document.querySelector('.kanban-card.dragging')) return;
  if (document.querySelector('#member-modal, #modal-backdrop, #confirm-dialog-title')) return;
  clearTimeout(_rtTimer);
  // initApp() juga menyegarkan State.init (daftar member/currentUser).
  _rtTimer = setTimeout(() => { if (State.init) initApp(); }, 250);
});

// Kesalahan tulis/baca Firestore ditampilkan sekali per beberapa detik.
window.addEventListener('fs:firebase-error', (e) => {
  const msg = (e.detail && e.detail.message) || 'Gagal menyinkronkan data';
  toast(msg, 'error');
});
