/* ============================================================
 * FlowSpace - auth-ui.js
 * Layar masuk / daftar / lupa kata sandi / onboarding workspace.
 * Hanya aktif ketika mode `firebase`.
 * ============================================================ */

(function (global) {
  'use strict';

  var root = null;
  var screen = 'loading';
  var busy = false;
  var notice = '';
  var noticeKind = 'error';
  var fatal = false;

  /* ------------------------------------------------------------
   * Kerangka
   * ------------------------------------------------------------ */

  function mount() {
    if (root) return root;
    root = document.createElement('div');
    root.id = 'auth-screen';
    root.className = 'fixed inset-0 z-[100] bg-paper overflow-auto';
    document.body.appendChild(root);
    render();
    return root;
  }

  function hide() {
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null;
  }

  function show(next, opts) {
    opts = opts || {};
    screen = next || 'signin';
    notice = opts.notice || '';
    noticeKind = opts.kind || 'error';
    fatal = !!opts.fatal;
    busy = false;
    if (!root) mount();
    render();
  }

  function showError(message) {
    show('fatal', { notice: message || 'Terjadi kesalahan.' });
  }

  function setBusy(on, label, selector) {
    busy = on;
    var btn = root && root.querySelector(selector || '[data-auth-submit]');
    if (!btn) return;
    btn.disabled = on;
    if (on) {
      btn.dataset.label = btn.dataset.label || btn.innerHTML;
      btn.innerHTML = '<span class="spinner"></span>' + escapeHtml(label || 'Memproses...');
    } else if (btn.dataset.label) {
      btn.innerHTML = btn.dataset.label;
      delete btn.dataset.label;
    }
  }

  function setNotice(message, kind) {
    notice = message || '';
    noticeKind = kind || 'error';
    var el = root && root.querySelector('#auth-notice');
    if (!el) return;
    if (!notice) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    el.classList.remove('hidden');
    el.className = 'auth-notice ' + (noticeKind === 'error' ? 'is-error' : 'is-info');
    el.innerHTML = '<i data-lucide="' + (noticeKind === 'error' ? 'alert-circle' : 'info') + '" class="h-4 w-4 shrink-0"></i><span>' + escapeHtml(notice) + '</span>';
    refreshIcons();
  }

  function brand() {
    return `
      <div class="flex items-center gap-2.5">
        <div class="h-9 w-9 rounded-lg bg-forest text-fernlight flex items-center justify-center">
          <i data-lucide="boxes" class="h-5 w-5"></i>
        </div>
        <div class="leading-tight">
          <p class="font-display text-[17px] font-semibold tracking-tight">FlowSpace</p>
          <p class="text-[10px] font-mono uppercase tracking-[0.18em] text-inksoft">Workflow canvas</p>
        </div>
      </div>
    `;
  }

  function noticeHtml() {
    if (!notice) return '<div id="auth-notice" class="auth-notice hidden" role="alert"></div>';
    return `<div id="auth-notice" class="auth-notice ${noticeKind === 'error' ? 'is-error' : 'is-info'}" role="alert">
      <i data-lucide="${noticeKind === 'error' ? 'alert-circle' : 'info'}" class="h-4 w-4 shrink-0"></i>
      <span>${escapeHtml(notice)}</span>
    </div>`;
  }

  function googleButton() {
    return `
      <button type="button" class="btn btn-secondary w-full justify-center" data-auth-google>
        <svg viewBox="0 0 24 24" class="h-4 w-4" aria-hidden="true">
          <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-8.9z"/>
          <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2a7 7 0 0 1-6.6-4.8H1.4v3.1A12 12 0 0 0 12 24z"/>
          <path fill="#FBBC05" d="M5.4 14.5a7.2 7.2 0 0 1 0-4.6V6.8H1.4a12 12 0 0 0 0 10.8l4-3.1z"/>
          <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.5 1.8l3.4-3.4A12 12 0 0 0 1.4 6.8l4 3.1A7 7 0 0 1 12 4.8z"/>
        </svg>
        <span>Lanjutkan dengan Google</span>
      </button>
    `;
  }

  function shell(inner) {
    return `
      <div class="min-h-full w-full flex items-center justify-center px-4 py-10">
        <div class="w-full max-w-[420px]">
          <div class="bg-card border border-line rounded-xl shadow-soft overflow-hidden">
            <div class="px-6 pt-6 pb-5 border-b border-line">
              ${brand()}
            </div>
            <div class="px-6 py-6">
              ${inner}
            </div>
          </div>
          <p class="text-center text-[10px] font-mono uppercase tracking-[0.16em] text-inksoft mt-5">
            Data tersinkron · ${escapeHtml((global.FlowFirebase && FlowFirebase.info().projectId) || 'firebase')}
          </p>
        </div>
      </div>
    `;
  }

  /* ------------------------------------------------------------
   * Layar
   * ------------------------------------------------------------ */

  function viewLoading() {
    return shell(`
      <div class="flex items-center gap-2 text-sm text-inksoft py-6">
        <span class="spinner spinner-dark"></span>
        <span>Menyiapkan sesi…</span>
      </div>
    `);
  }

  function viewSignIn() {
    return shell(`
      <h1 class="font-display text-xl font-semibold tracking-tight">Masuk ke workspace</h1>
      <p class="text-sm text-inksoft mt-1">Masuk untuk melanjutkan, atau daftar untuk membuat workspace baru.</p>
      ${noticeHtml()}
      <form id="auth-form" class="mt-5 space-y-3.5" novalidate>
        <div>
          <label class="form-label" for="auth-email">Email</label>
          <input id="auth-email" type="email" class="form-input" autocomplete="email" placeholder="nama@perusahaan.com" required>
        </div>
        <div>
          <div class="flex items-center justify-between">
            <label class="form-label" for="auth-password">Kata sandi</label>
            <button type="button" class="text-[11px] text-fern hover:underline mb-1" data-auth-reset>Lupa?</button>
          </div>
          <input id="auth-password" type="password" class="form-input" autocomplete="current-password" placeholder="••••••••" required>
        </div>
        <button type="submit" class="btn btn-primary w-full justify-center mt-1" data-auth-submit>Masuk</button>
      </form>
      <div class="flex items-center gap-3 my-5">
        <div class="h-px flex-1 bg-line"></div>
        <span class="text-[10px] font-mono uppercase tracking-[0.16em] text-inksoft">atau</span>
        <div class="h-px flex-1 bg-line"></div>
      </div>
      ${googleButton()}
      <p class="text-sm text-inksoft text-center mt-5">
        Belum punya akun?
        <button type="button" class="text-fern font-medium hover:underline" data-auth-goto="signup">Daftar</button>
      </p>
    `);
  }

  function viewSignUp() {
    return shell(`
      <h1 class="font-display text-xl font-semibold tracking-tight">Buat akun</h1>
      <p class="text-sm text-inksoft mt-1">Akun baru perlu undangan admin, atau Anda bisa membuat workspace sendiri.</p>
      ${noticeHtml()}
      <form id="auth-form" class="mt-5 space-y-3.5" novalidate>
        <div>
          <label class="form-label" for="auth-name">Nama tampilan</label>
          <input id="auth-name" type="text" class="form-input" autocomplete="name" placeholder="Andi Pratama" maxlength="60" required>
        </div>
        <div>
          <label class="form-label" for="auth-email">Email</label>
          <input id="auth-email" type="email" class="form-input" autocomplete="email" placeholder="nama@perusahaan.com" required>
        </div>
        <div>
          <label class="form-label" for="auth-password">Kata sandi</label>
          <input id="auth-password" type="password" class="form-input" autocomplete="new-password" placeholder="Minimal 6 karakter" required>
        </div>
        <button type="submit" class="btn btn-primary w-full justify-center mt-1" data-auth-submit>Daftar</button>
      </form>
      <div class="flex items-center gap-3 my-5">
        <div class="h-px flex-1 bg-line"></div>
        <span class="text-[10px] font-mono uppercase tracking-[0.16em] text-inksoft">atau</span>
        <div class="h-px flex-1 bg-line"></div>
      </div>
      ${googleButton()}
      <p class="text-sm text-inksoft text-center mt-5">
        Sudah punya akun?
        <button type="button" class="text-fern font-medium hover:underline" data-auth-goto="signin">Masuk</button>
      </p>
    `);
  }

  function viewReset() {
    return shell(`
      <button type="button" class="btn btn-ghost btn-sm -ml-2 mb-2" data-auth-goto="signin">
        <i data-lucide="arrow-left" class="h-4 w-4"></i>Kembali
      </button>
      <h1 class="font-display text-xl font-semibold tracking-tight">Atur ulang kata sandi</h1>
      <p class="text-sm text-inksoft mt-1">Kami kirim tautan reset ke email Anda.</p>
      ${noticeHtml()}
      <form id="auth-form" class="mt-5 space-y-3.5" novalidate>
        <div>
          <label class="form-label" for="auth-email">Email</label>
          <input id="auth-email" type="email" class="form-input" autocomplete="email" placeholder="nama@perusahaan.com" required>
        </div>
        <button type="submit" class="btn btn-primary w-full justify-center" data-auth-submit>Kirim tautan</button>
      </form>
    `);
  }

  function viewOnboarding() {
    var email = (global.FlowSession && global.FlowSession.email) || '';
    return shell(`
      <h1 class="font-display text-xl font-semibold tracking-tight">Hubungkan akun</h1>
      <p class="text-sm text-inksoft mt-1">
        Masuk sebagai <span class="font-medium text-ink">${escapeHtml(email)}</span>, tetapi belum terhubung ke workspace.
      </p>
      ${noticeHtml()}
      <div class="mt-5 space-y-3">
        <div class="rounded-lg border border-line p-4">
          <p class="text-sm font-medium flex items-center gap-2"><i data-lucide="mail" class="h-4 w-4 text-fern"></i>Sudah diundang admin?</p>
          <p class="text-xs text-inksoft mt-1">Pastikan admin memakai email ini, lalu periksa undangan.</p>
          <button type="button" class="btn btn-secondary btn-sm mt-3" data-auth-recheck>Cek undangan</button>
        </div>
        <div class="rounded-lg border border-line p-4">
          <p class="text-sm font-medium flex items-center gap-2"><i data-lucide="plus" class="h-4 w-4 text-fern"></i>Buat workspace baru</p>
          <p class="text-xs text-inksoft mt-1">Anda akan menjadi admin workspace ini.</p>
          <input id="auth-ws-name" type="text" class="form-input mt-3" maxlength="60" placeholder="Nama workspace" value="FlowSpace Workspace">
          <button type="button" class="btn btn-primary btn-sm mt-3" data-auth-create-ws>Buat workspace</button>
        </div>
      </div>
      <button type="button" class="btn btn-ghost btn-sm w-full justify-center mt-4" data-auth-signout>Keluar</button>
    `);
  }

  function viewInactive() {
    return shell(`
      <h1 class="font-display text-xl font-semibold tracking-tight">Akun dinonaktifkan</h1>
      <p class="text-sm text-inksoft mt-1">
        Akses akun <span class="font-medium text-ink">${escapeHtml((global.FlowSession && FlowSession.email) || '')}</span>
        sedang dinonaktifkan oleh admin workspace.
      </p>
      <div class="auth-notice is-info mt-4">
        <i data-lucide="info" class="h-4 w-4 shrink-0"></i>
        <span>Hubungi admin untuk mengaktifkan kembali akun Anda.</span>
      </div>
      <button type="button" class="btn btn-secondary w-full justify-center mt-4" data-auth-signout>Keluar</button>
    `);
  }

  function viewAccess() {
    return shell(`
      <h1 class="font-display text-xl font-semibold tracking-tight">Akses workspace ditolak</h1>
      <p class="text-sm text-inksoft mt-1">
        Akun <span class="font-medium text-ink">${escapeHtml((global.FlowSession && FlowSession.email) || '')}</span>
        belum terdaftar sebagai anggota aktif di workspace ini.
      </p>
      ${noticeHtml()}
      <div class="auth-notice is-info mt-4">
        <i data-lucide="info" class="h-4 w-4 shrink-0"></i>
        <span>
          Minta admin workspace mengirim undangan ke email ini, atau masuk
          memakai akun lain yang sudah menjadi anggota.
        </span>
      </div>
      <button type="button" class="btn btn-primary w-full justify-center mt-4" data-auth-retry>Coba lagi</button>
      <button type="button" class="btn btn-secondary w-full justify-center mt-2" data-auth-reload>Muat ulang</button>
      <button type="button" class="btn btn-ghost w-full justify-center mt-2" data-auth-signout>Keluar</button>
    `);
  }

  function viewFatal() {
    return shell(`
      <h1 class="font-display text-xl font-semibold tracking-tight">Tidak bisa terhubung</h1>
      <p class="text-sm text-inksoft mt-1">Aplikasi gagal menyiapkan Firebase.</p>
      ${noticeHtml()}
      <button type="button" class="btn btn-primary w-full justify-center mt-4" data-auth-reload>Muat ulang</button>
      <button type="button" class="btn btn-ghost w-full justify-center mt-2" data-auth-signout>Keluar</button>
    `);
  }

  function viewRecover() {
    return shell(`
      <h1 class="font-display text-xl font-semibold tracking-tight">Koneksi data terputus</h1>
      <p class="text-sm text-inksoft mt-1">
        ${fatal
          ? 'Sesi data Firestore perlu dimuat ulang. Data yang sudah tersimpan tetap aman.'
          : 'Aplikasi tidak dapat menghubungi server. Periksa koneksi internet Anda.'}
      </p>
      ${noticeHtml()}
      ${fatal
        ? ''
        : '<button type="button" class="btn btn-primary w-full justify-center mt-4" data-auth-retry>Coba lagi</button>'}
      <button type="button" class="btn ${fatal ? 'btn-primary' : 'btn-secondary'} w-full justify-center mt-4" data-auth-reload>Muat ulang</button>
      <button type="button" class="btn btn-ghost w-full justify-center mt-2" data-auth-signout>Keluar</button>
    `);
  }

  function viewSessionLost() {
    return shell(`
      <h1 class="font-display text-xl font-semibold tracking-tight">Sesi tidak terbaca</h1>
      <p class="text-sm text-inksoft mt-1">
        Browser tidak menemukan sesi login yang tersimpan di perangkat ini.
      </p>
      ${noticeHtml()}
      <div class="auth-notice is-info mt-4">
        <i data-lucide="info" class="h-4 w-4 shrink-0"></i>
        <span>
          Sesi biasanya hanya hilang jika data situs dibersihkan, memakai mode
          Incognito/InPrivate, atau membuka FlowSpace dari browser/alamat berbeda.
          Setelah masuk sekali lagi, sesi disimpan permanen di perangkat ini.
        </span>
      </div>
      <button type="button" class="btn btn-primary w-full justify-center mt-4" data-auth-goto="signin">Masuk kembali</button>
      <button type="button" class="btn btn-secondary w-full justify-center mt-2" data-auth-reload>Muat ulang dulu</button>
    `);
  }

  /* ------------------------------------------------------------
   * Render
   * ------------------------------------------------------------ */

  function render() {
    if (!root) return;
    var html;
    switch (screen) {
      case 'signin': html = viewSignIn(); break;
      case 'signup': html = viewSignUp(); break;
      case 'reset': html = viewReset(); break;
      case 'onboarding': html = viewOnboarding(); break;
      case 'inactive': html = viewInactive(); break;
      case 'access': html = viewAccess(); break;
      case 'recover': html = viewRecover(); break;
      case 'sessionlost': html = viewSessionLost(); break;
      case 'fatal': html = viewFatal(); break;
      default: html = viewLoading();
    }
    root.innerHTML = html;
    refreshIcons();
    wire();
  }

  function wire() {
    var form = root.querySelector('#auth-form');
    if (form) form.addEventListener('submit', onSubmit);

    root.querySelectorAll('[data-auth-goto]').forEach(function (btn) {
      btn.addEventListener('click', function () { show(btn.dataset.authGoto); });
    });

    var google = root.querySelector('[data-auth-google]');
    if (google) google.addEventListener('click', onGoogle);

    var reset = root.querySelector('[data-auth-reset]');
    if (reset) reset.addEventListener('click', function () { show('reset'); });

    var recheck = root.querySelector('[data-auth-recheck]');
    if (recheck) recheck.addEventListener('click', onRecheck);

    var retry = root.querySelector('[data-auth-retry]');
    if (retry) retry.addEventListener('click', onRetry);

    var createWs = root.querySelector('[data-auth-create-ws]');
    if (createWs) createWs.addEventListener('click', onCreateWorkspace);

    root.querySelectorAll('[data-auth-signout]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        FlowFirebase.signOut().catch(function (e) { setNotice(FlowFirebase.friendlyError(e)); });
      });
    });

    var reload = root.querySelector('[data-auth-reload]');
    if (reload) reload.addEventListener('click', function () { global.location.reload(); });

    var first = root.querySelector('#auth-name') || root.querySelector('#auth-email');
    if (first && screen !== 'loading') setTimeout(function () { first.focus(); }, 30);
  }

  function field(id) {
    var el = root.querySelector('#' + id);
    return el ? el.value.trim() : '';
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (busy) return;
    setNotice('');

    var email = field('auth-email');
    var password = root.querySelector('#auth-password') ? root.querySelector('#auth-password').value : '';
    var name = field('auth-name');

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      setNotice('Format email tidak valid.');
      return;
    }

    try {
      if (screen === 'reset') {
        setBusy(true, 'Mengirim…');
        await FlowFirebase.sendReset(email);
        setBusy(false);
        setNotice('Tautan reset dikirim ke ' + email + '. Periksa kotak masuk (dan folder spam).', 'info');
        return;
      }

      if (!password) { setNotice('Kata sandi wajib diisi.'); return; }
      if (screen === 'signup' && password.length < 6) { setNotice('Kata sandi minimal 6 karakter.'); return; }
      if (screen === 'signup' && !name) { setNotice('Nama tampilan wajib diisi.'); return; }

      setBusy(true, screen === 'signup' ? 'Mendaftar…' : 'Masuk…');
      if (screen === 'signup') await FlowFirebase.signUp(email, password, name);
      else await FlowFirebase.signIn(email, password);
      // Setelah sukses, onAuthStateChanged di app.js yang melanjutkan.
    } catch (err) {
      setBusy(false);
      setNotice(FlowFirebase.friendlyError(err));
    }
  }

  async function onGoogle() {
    if (busy) return;
    setNotice('');
    setBusy(true, 'Membuka Google…', '[data-auth-google]');
    try {
      await FlowFirebase.signInWithGoogle();
    } catch (err) {
      setBusy(false, '', '[data-auth-google]');
      setNotice(FlowFirebase.friendlyError(err));
    }
  }

  async function onRetry() {
    if (busy) return;
    var btn = root.querySelector('[data-auth-retry]');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Mencoba…'; }
    setNotice('');
    try {
      await global.FlowHandleAuth(FlowFirebase.currentUser());
    } catch (err) {
      setNotice(FlowFirebase.friendlyError(err));
      if (btn) { btn.disabled = false; btn.textContent = 'Coba lagi'; }
    }
  }

  async function onRecheck() {
    if (busy) return;
    var btn = root.querySelector('[data-auth-recheck]');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Memeriksa…'; }
    try {
      await global.FlowHandleAuth(FlowFirebase.currentUser());
    } catch (err) {
      setNotice(FlowFirebase.friendlyError(err));
      if (btn) { btn.disabled = false; btn.textContent = 'Cek undangan'; }
    }
  }

  async function onCreateWorkspace() {
    if (busy) return;
    var nameInput = root.querySelector('#auth-ws-name');
    var name = nameInput ? nameInput.value.trim() : '';
    if (!name) { setNotice('Nama workspace wajib diisi.'); return; }

    var btn = root.querySelector('[data-auth-create-ws]');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Membuat…'; }
    setNotice('');
    try {
      await FlowFirebase.createWorkspace(name);
      await global.FlowHandleAuth(FlowFirebase.currentUser());
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = 'Buat workspace'; }
      setNotice(FlowFirebase.friendlyError(err));
    }
  }

  global.AuthUI = {
    mount: mount,
    hide: hide,
    show: show,
    showError: showError,
    setNotice: setNotice,
  };
})(window);
