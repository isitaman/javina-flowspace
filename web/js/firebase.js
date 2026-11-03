/* ============================================================
 * FlowSpace - firebase.js
 * Adapter Firebase untuk mode `firebase`.
 *
 * Peran modul ini:
 *  1. Inisialisasi Firebase Auth + Firestore (memory cache secara default).
 *  2. Menentukan workspace milik user (member / undangan / baru).
 *  3. Menyalin data Firestore -> Store di memori (hydrate) secara realtime.
 *  4. Mengirim setiap perubahan Store lokal -> Firestore (sink).
 *
 * Lapisan UI/API tidak diubah: tetap memakai Store & Api yang sama.
 * ============================================================ */

(function (global) {
  'use strict';

  var CFG = global.FLOWSPACE_CONFIG || {};
  var FB_CFG = CFG.firebaseConfig || {};
  var enabled = CFG.mode === 'firebase' && !!FB_CFG.apiKey;

  // Cache offline Firestore sengaja nonaktif secara default.
  //
  // Persistence IndexedDB (terutama dengan `synchronizeTabs`) adalah jalur
  // yang paling sering memicu `FIRESTORE INTERNAL ASSERTION FAILED:
  // Unexpected state`. Assertion itu membuat klien Firestore mati permanen
  // sampai halaman di-reload, sehingga login terlihat gagal / logout.
  // Data workspace tetap dihidrasi ulang dari server pada setiap sesi,
  // jadi mode default memakai memory cache. Set `offlineCache: true` di
  // FLOWSPACE_CONFIG hanya jika offline cache benar-benar dibutuhkan.
  var offlineCache = CFG.offlineCache === true;

  // Log diagnostik ringan: buka aplikasi dengan `?debug=1`.
  var debug = /(?:^|[?&])debug=1(?:&|$)/.test(String((global.location && global.location.search) || ''));

  function logDebug() {
    if (!debug) return;
    try {
      var args = Array.prototype.slice.call(arguments);
      console.info.apply(console, ['[FlowSpace/Firebase]'].concat(args));
    } catch (e) {}
  }

  // Nama field ID untuk tiap koleksi (juga dipakai sebagai doc ID Firestore).
  var ID_FIELDS = {
    workspaces: 'workspace_id',
    members: 'member_id',
    invites: 'email',
    workflows: 'workflow_id',
    nodes: 'node_id',
    edges: 'edge_id',
    tasks: 'task_id',
    applications: 'app_id',
    taskApplications: 'task_app_id',
    checklist: 'checklist_id',
    activityLogs: 'log_id',
    applicationCategories: 'category_id',
    comments: 'comment_id',
    chatMessages: 'message_id',
    chatReads: 'member_id',
  };

  // Koleksi yang disinkronkan dari workspace aktif.
  var SYNC_COLLECTIONS = [
    'members', 'invites', 'workflows', 'nodes', 'edges', 'tasks',
    'applications', 'taskApplications', 'checklist', 'activityLogs',
    'applicationCategories', 'comments',
  ];

  // Batas dokumen per koleksi untuk listener realtime.
  //
  // `activityLogs` tumbuh tanpa batas dan dulu dibaca SELURUHNYA setiap kali
  // attach. Setiap attach bisa terjadi berkali-kali dalam satu sesi (retry,
  // refresh token, buka tab baru), jadi ini koleksi yang paling cepat
  // menghabiskan kuota reads Spark. 300 log terakhir sudah lebih dari cukup:
  // dashboard hanya butuh 8, drawer task maksimal 50, dan lonceng notifikasi
  // hanya relevan untuk kejadian terbaru.
  //
  // Kalau butuh log yang lebih tua, tambahkan pagination eksplisit — jangan
  // naikkan angka ini tanpa mengukur ulang kuota.
  var COLLECTION_LIMITS = {
    activityLogs: { orderBy: 'created_at', direction: 'desc', limit: 300 },
  };

  var app = null;
  var auth = null;
  var db = null;
  var workspaceId = null;
  var currentMember = null;
  var unsubs = [];
  var onAuthCb = null;
  var initPromise = null;
  var persistenceState = 'memory';

  var localWrites = {};     // "collection/docId" -> timestamp
  var firstSnapshot = {};   // collection -> true setelah snapshot pertama
  var deniedWarned = false; // sudah ada peringatan permission-denied di attach ini
  var deniedThisAttach = false; // ada listener yang ditolak saat attach berjalan
  var emitTimer = null;
  var pendingOps = new Map();
  var flushTimer = null;
  var sinkInstalled = false;
  var lastErrorAt = 0;

  // Siklus hidup auth & workspace.
  //  - `authPending` menyimpan event auth terakhir yang belum dikirim ke
  //    handler, supaya handler tidak dipanggil dua kali saat boot.
  //  - `lastAuthKey` mendeduplikasi event untuk uid yang sama (mis. token
  //    refresh) agar tidak ada dua `get()` paralel ke dokumen yang sama.
  //  - `attachGen` membatalkan attach yang masih berjalan ketika user
  //    berganti / logout.
  var authPending;            // undefined = belum ada event; null = signed-out
  var lastAuthKey;            // undefined = belum ada event
  var explicitSignOut = false;
  var attachGen = 0;
  var attaching = null;
  var attachingWs = null;
  var resolving = null;
  var resolvingUid = null;

  // Penanda sesi di localStorage. Dipakai hanya untuk membedakan
  // "memang belum pernah masuk" dari "sesi tersimpan tapi gagal dibaca"
  // (mis. IndexedDB sempat abort saat reload). Bukan kredensial.
  var SESSION_KEY = 'flowspace.session.v1';
  var nullCheckTimer = null;
  var nullCheckGen = 0;
  var authPersistenceMode = '';
  var storagePersisted = null;

  /* ------------------------------------------------------------
   * Util
   * ------------------------------------------------------------ */

  function nowIso() { return new Date().toISOString(); }

  function isEnabled() { return enabled; }

  function currentUser() { return auth ? auth.currentUser : null; }

  function lowerEmail(email) { return String(email || '').trim().toLowerCase(); }

  function sanitize(value) {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) {
      return value.map(function (v) { return v === undefined ? null : sanitize(v); });
    }
    if (typeof value === 'object') {
      var out = {};
      Object.keys(value).forEach(function (k) {
        if (value[k] === undefined || typeof value[k] === 'function') return;
        out[k] = sanitize(value[k]);
      });
      return out;
    }
    if (typeof value === 'function') return null;
    return value;
  }

  // Pesan Auth dalam bahasa Indonesia (kode dari Firebase JS SDK).
  var AUTH_MESSAGES = {
    'auth/invalid-email': 'Format email tidak valid.',
    'auth/user-disabled': 'Akun ini dinonaktifkan.',
    'auth/user-not-found': 'Email atau kata sandi salah.',
    'auth/wrong-password': 'Email atau kata sandi salah.',
    'auth/invalid-credential': 'Email atau kata sandi salah.',
    'auth/invalid-login-credentials': 'Email atau kata sandi salah.',
    'auth/email-already-in-use': 'Email sudah terdaftar. Silakan masuk.',
    'auth/weak-password': 'Kata sandi minimal 6 karakter.',
    'auth/too-many-requests': 'Terlalu banyak percobaan. Coba lagi beberapa saat lagi.',
    'auth/popup-closed-by-user': 'Jendela Google ditutup sebelum proses selesai.',
    'auth/popup-blocked': 'Popup diblokir browser. Izinkan popup lalu coba lagi.',
    'auth/cancelled-popup-request': 'Proses masuk dengan Google dibatalkan.',
    'auth/account-exists-with-different-credential': 'Email ini sudah terdaftar dengan metode lain. Masuk memakai email & kata sandi.',
    'auth/unauthorized-domain': 'Domain ini belum diizinkan. Tambahkan di Firebase Console → Authentication → Settings → Authorized domains.',
    'auth/operation-not-allowed': 'Metode login ini belum diaktifkan di Firebase Console → Authentication → Sign-in method.',
    'auth/network-request-failed': 'Tidak ada koneksi internet. Periksa jaringan lalu coba lagi.',
    'auth/requires-recent-login': 'Sesi sudah terlalu lama. Silakan keluar lalu masuk kembali.',
    'auth/internal-error': 'Terjadi gangguan pada server autentikasi. Coba lagi.',
  };

  function friendlyError(err) {
    var code = (err && (err.code || err.name)) || '';
    if (code === 'flowspace/membership-denied'
        || code === 'flowspace/session-changed'
        || code === 'flowspace/workspace-denied') {
      return (err && err.message) || 'Akun ini tidak memiliki akses ke workspace tersebut.';
    }
    if (AUTH_MESSAGES[code]) return AUTH_MESSAGES[code];
    if (code.indexOf('permission-denied') !== -1 || code === 'permission_denied') {
      return 'Firestore menolak akses. Jika baru pertama kali menyiapkan, deploy firestore.rules (firebase deploy --only firestore:rules). Jika sudah, pastikan akun Anda masih anggota aktif.';
    }
    if (code.indexOf('unavailable') !== -1) return 'Tidak dapat menghubungi Firestore. Periksa koneksi internet.';
    if (code.indexOf('failed-precondition') !== -1) return 'Firestore belum siap. Pastikan database sudah dibuat dan rules sudah di-deploy.';
    if (code.indexOf('not-found') !== -1) return 'Database Firestore tidak ditemukan untuk project ini.';
    return (err && err.message) || 'Terjadi kesalahan pada Firebase.';
  }

  function errorText(err) {
    if (!err) return '';
    return String((err && err.message) || err || '') + ' ' + String((err && err.code) || '');
  }

  /**
   * Assertion internal Firestore membuat klien mati permanen sampai reload.
   * Tidak ada operasi Firestore lain yang bisa diandalkan setelah ini.
   */
  function isFatalFirestoreError(err) {
    return /INTERNAL ASSERTION FAILED|AsyncQueue is already failed|FIRESTORE \(\d+\.\d+\.\d+\) INTERNAL|\bb815\b|\bca9\b/i
      .test(errorText(err));
  }

  /** Error yang layak dicoba ulang (jaringan / server sementara). */
  function isTransientError(err) {
    if (isFatalFirestoreError(err)) return true;
    var text = errorText(err).toLowerCase();
    if (/permission-denied|permission_denied|unauthenticated/.test(text)) return false;
    return /unavailable|deadline-exceeded|aborted|resource-exhausted|internal|network-request-failed|network error|timed out|timeout|failed to get document|failed to obtain server|transport errored/.test(text);
  }

  /** Server menolak operasi karena aturan keamanan / keanggotaan. */
  function isPermissionDenied(err) {
    return /permission-denied|permission_denied/i.test(errorText(err));
  }

  /**
   * Error yang menandakan akun ini tidak boleh memakai workspace yang
   * sedang dipasang. Dipakai app.js untuk menampilkan layar yang tepat
   * alih-alih menu "buat workspace" yang akan gagal juga.
   */
  function membershipError(message) {
    var err = new Error(message || 'Akun ini tidak memiliki akses ke workspace tersebut. Minta admin mengirim undangan atau mengaktifkan kembali akun Anda.');
    err.code = 'flowspace/membership-denied';
    return err;
  }

  /** Akun berganti di tengah attach (mis. login di tab lain). */
  function sessionChangedError() {
    var err = new Error('Sesi akun berubah saat memuat workspace. Coba lagi atau muat ulang halaman.');
    err.code = 'flowspace/session-changed';
    return err;
  }

  /**
   * Listener ditolak walau keanggotaan baru saja terverifikasi. Biasanya
   * token masih berganti saat watch stream dimulai, jadi pemanggil boleh
   * mencoba lagi setelah token di-refresh.
   */
  function workspaceDeniedError() {
    var err = new Error('Server menolak akses ke data workspace. Mencoba ulang…');
    err.code = 'flowspace/workspace-denied';
    return err;
  }

  function reportError(err, context) {
    console.error('[FlowSpace/Firebase]', context || '', err);
    var fatal = isFatalFirestoreError(err);
    if (fatal) {
      logDebug('FATAL Firestore error', context || '', errorText(err));
      try {
        global.dispatchEvent(new CustomEvent('fs:firebase-fatal', {
          detail: { message: friendlyError(err), context: context || '' },
        }));
      } catch (e) {}
      return; // layar pemulihan sudah menjelaskan; jangan tambah toast
    }
    var now = Date.now();
    if (now - lastErrorAt < 4000) return; // hindari toast beruntun
    lastErrorAt = now;
    try {
      global.dispatchEvent(new CustomEvent('fs:firebase-error', {
        detail: { message: friendlyError(err), code: (err && err.code) || '', context: context || '' },
      }));
    } catch (e) {}
  }

  function docRef(collection, id) {
    var key = String(id);
    if (collection === 'workspaces') return db.collection('workspaces').doc(key);
    if (collection === 'invites') return db.collection('invites').doc(lowerEmail(key));
    if (collection === 'users') return db.collection('users').doc(key);
    return db.collection('workspaces').doc(workspaceId).collection(collection).doc(key);
  }

  function docPath(collection, id) { return collection + '/' + String(id); }

  /**
   * Undangan disimpan di dua lokasi:
   *  - `invites/{email}`                    -> dibaca calon anggota (get, pemilik email)
   *  - `workspaces/{ws}/invites/{email}`    -> dibaca admin lewat collection path
   *
   * Aturan Firestore tidak berperan sebagai filter: query harus bisa
   * dibuktikan lewat path/constraint, bukan isi dokumen. Karena itu
   * daftar undangan dibaca dari subkoleksi (path sudah menyebut ws),
   * sementara penemuan workspace memakai dokumen root.
   */
  function inviteRefs(email) {
    var key = lowerEmail(email);
    return [
      db.collection('invites').doc(key),
      db.collection('workspaces').doc(workspaceId).collection('invites').doc(key),
    ];
  }

  function markLocal(collection, id) {
    localWrites[docPath(collection, id)] = Date.now();
  }

  /* ------------------------------------------------------------
   * Penyimpanan sesi
   * ------------------------------------------------------------ */

  // Tipe persistence yang benar-benar dipakai SDK (LOCAL/SESSION/NONE).
  // Dipakai untuk diagnostik: kalau hasilnya bukan LOCAL, sesi tidak akan
  // bertahan setelah browser ditutup.
  function persistenceType() {
    try {
      var delegate = auth && auth._delegate;
      if (delegate && typeof delegate._getPersistenceType === 'function') {
        var type = delegate._getPersistenceType();
        if (type) return String(type).toLowerCase();
      }
    } catch (e) {}
    return authPersistenceMode || 'unknown';
  }

  // Best-effort: minta browser tidak mengevict IndexedDB (tempat Firebase
  // menyimpan sesi). Chrome/Edge biasanya memberi izin untuk situs yang
  // sering dikunjungi; Firefox dapat menampilkan prompt, jadi hanya diminta
  // sekali per perangkat. Tidak masalah bila ditolak.
  var PERSIST_ASKED_KEY = 'flowspace.storagePersistAsked.v1';

  function requestPersistentStorage() {
    try {
      if (!global.navigator || !navigator.storage || typeof navigator.storage.persist !== 'function') return;
      var asked = false;
      try { asked = global.localStorage.getItem(PERSIST_ASKED_KEY) === '1'; } catch (e) {}
      var check = typeof navigator.storage.persisted === 'function'
        ? navigator.storage.persisted()
        : Promise.resolve(false);
      check.then(function (already) {
        if (already) { storagePersisted = true; return; }
        if (asked) return;
        try { global.localStorage.setItem(PERSIST_ASKED_KEY, '1'); } catch (e) {}
        return navigator.storage.persist().then(function (granted) {
          storagePersisted = !!granted;
          logDebug('persistent storage', storagePersisted ? 'granted' : 'not granted');
        });
      }).catch(function () {});
    } catch (e) {}
  }

  /* ------------------------------------------------------------
   * Inisialisasi
   * ------------------------------------------------------------ */

  function init() {
    if (!enabled) return Promise.resolve(false);
    if (initPromise) return initPromise;

    initPromise = (async function () {
      if (!global.firebase || !global.firebase.initializeApp) {
        throw new Error('SDK Firebase gagal dimuat. Periksa koneksi internet lalu muat ulang halaman.');
      }
      app = (firebase.apps && firebase.apps.length) ? firebase.app() : firebase.initializeApp(FB_CFG);
      auth = firebase.auth();
      db = firebase.firestore();
      logDebug('init', {
        projectId: FB_CFG.projectId,
        offlineCache: offlineCache,
        sdk: firebase.SDK_VERSION || '(compat)',
      });

      // JANGAN memanggil auth.setPersistence() saat boot.
      //
      // Di SDK compat, mengganti persistence akan:
      //   1) membaca user yang tersimpan dari storage lama,
      //   2) MENGHAPUSNYA dari storage lama,
      //   3) menuliskannya ke storage baru.
      // Kalau langkah 1 berjalan sebelum pemulihan sesi selesai (atau
      // IndexedDB sempat tidak tersedia), hasilnya `null` dan langkah 2
      // menghapus sesi yang sebenarnya masih sah. Itu membuat user
      // ter-logout sendiri lalu melihat layar "Sesi tidak terbaca".
      //
      // Firebase Auth versi web sudah memakai `local` (IndexedDB) secara
      // default, jadi tidak ada yang perlu diubah: satu login bertahan
      // sampai tombol Keluar ditekan atau data situs dibersihkan.
      authPersistenceMode = 'local-default';
      logDebug('auth persistence', 'local (default SDK)');

      // Cache offline hanya jika diminta eksplisit. Mode single-tab dipakai
      // (tanpa synchronizeTabs) agar tidak bergantung pada koordinasi
      // localStorage antar-tab yang rawan penuh/race. Jika tab lain sudah
      // memegang persistence, SDK memberi `failed-precondition` dan kita
      // lanjut dengan memory cache.
      if (offlineCache) {
        try {
          await db.enablePersistence();
          persistenceState = 'enabled';
          logDebug('persistence aktif');
        } catch (e) {
          persistenceState = (e && e.code === 'failed-precondition') ? 'another-tab' : 'memory';
          console.warn('[FlowSpace] Cache offline nonaktif:', e && e.code, e && e.message);
        }
      }

      installSink();

      auth.onAuthStateChanged(function (user) {
        handleAuthEvent(user);
      });

      return true;
    })();

    return initPromise;
  }

  function setSession(user) {
    if (!user) {
      global.FlowSession = null;
      return;
    }
    var email = lowerEmail(user.email);
    global.FlowSession = {
      uid: user.uid,
      email: email,
      displayName: user.displayName || email.split('@')[0],
    };
  }

  /* --- Penanda sesi (bukan kredensial) ------------------------- */

  function rememberSession(user) {
    if (!user) return;
    try {
      global.localStorage.setItem(SESSION_KEY, JSON.stringify({
        uid: String(user.uid || ''),
        email: lowerEmail(user.email),
        at: nowIso(),
      }));
    } catch (e) {}
  }

  function readSessionMarker() {
    try {
      var raw = global.localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.uid) return null;
      return parsed;
    } catch (e) { return null; }
  }

  function hasSessionMarker() {
    return !!readSessionMarker();
  }

  function clearSessionMarker() {
    try { global.localStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  /* --- Distribusi event auth ----------------------------------- */

  function emitAuth(value) {
    authPending = value;
    if (!onAuthCb) return;
    var cb = onAuthCb;
    authPending = undefined;
    try { cb(value); } catch (e) { console.error('[FlowSpace] auth handler error', e); }
  }

  function cancelNullCheck() {
    if (nullCheckTimer) { clearTimeout(nullCheckTimer); nullCheckTimer = null; }
    nullCheckGen++;
  }

  // Verifikasi `null` sebelum diumumkan sebagai logout. SDK kadang
  // melaporkan null sesaat saat restore/refresh token gagal (misalnya
  // transaksi IndexedDB ter-abort ketika halaman baru dimuat ulang).
  // Hanya kalau setelah beberapa percobaan tetap tidak ada user, sesi
  // benar-benar dianggap berakhir. Sesi yang sedang live diberi waktu lebih
  // panjang karena null seperti itu hampir selalu sementara.
  var NULL_VERIFY_LIVE = [0, 700, 1800, 3600];
  var NULL_VERIFY_BOOT = [0, 500, 1500];

  function scheduleNullVerify() {
    cancelNullCheck();
    var gen = nullCheckGen;
    var attempt = 0;
    var delays = lastAuthKey ? NULL_VERIFY_LIVE : NULL_VERIFY_BOOT;

    function step() {
      if (gen !== nullCheckGen) return;
      var fresh = auth ? auth.currentUser : null;
      if (fresh) {
        var key = String(fresh.uid);
        logDebug('sesi pulih setelah null sementara', key);
        // Sudah terpasang dan listener masih hidup: jangan emit ulang.
        // Emit ulang memicu resolveMembership + attach baru, yang lalu
        // memicu AbortError beruntun saat kredensial Firestore berganti.
        if (lastAuthKey === key) return;
        handleAuthEvent(fresh);
        return;
      }
      attempt++;
      if (attempt < delays.length) {
        nullCheckTimer = setTimeout(step, delays[attempt]);
        return;
      }
      nullCheckTimer = null;
      if (lastAuthKey === null) return;
      lastAuthKey = null;
      logDebug('sesi berakhir (setelah verifikasi)');
      emitAuth(null);
    }

    nullCheckTimer = setTimeout(step, delays[0]);
  }

  function handleAuthEvent(user) {
    setSession(user);
    var key = user ? String(user.uid) : null;

    if (key) {
      cancelNullCheck();
      // Event berulang untuk user yang sama (mis. refresh token) tidak
      // boleh memicu resolveMembership + attach lagi.
      if (lastAuthKey !== undefined && key === lastAuthKey) {
        logDebug('auth event diabaikan (uid sama)', key);
        return;
      }
      lastAuthKey = key;
      logDebug('auth event', key);

      // Sign-in baru selalu membersihkan penanda logout eksplisit.
      explicitSignOut = false;

      // Minta browser mempertahankan penyimpanan situs (IndexedDB) setelah
      // ada user. Tanpa ini browser boleh mengevict data situs saat
      // penyimpanan menipis, yang membuat sesi Auth hilang tanpa user
      // menyentuh apa pun. Hanya diminta sekali per perangkat.
      requestPersistentStorage();

      emitAuth(user);
      return;
    }

    // Logout eksplisit dari tombol Keluar: langsung, tanpa penundaan.
    if (explicitSignOut) {
      cancelNullCheck();
      if (lastAuthKey === null) return;
      lastAuthKey = null;
      clearSessionMarker();
      logDebug('auth event', 'signed-out (eksplisit)');
      emitAuth(null);
      return;
    }

    // Null tak terduga: verifikasi dulu sebelum menampilkan layar masuk.
    scheduleNullVerify();
  }

  function onAuthChange(cb) {
    onAuthCb = cb;
    // Kalau event auth sudah lewat sebelum handler didaftarkan, kirim
    // sekali saja state terakhir agar layar tidak tertahan di loading.
    if (authPending !== undefined) {
      var pending = authPending;
      authPending = undefined;
      setTimeout(function () {
        try { cb(pending); } catch (e) { console.error('[FlowSpace] auth handler error', e); }
      }, 0);
    }
  }

  /** Apakah logout terakhir dimulai oleh tombol Keluar (bukan sesi hilang). */
  function consumeExplicitSignOut() {
    var value = explicitSignOut;
    explicitSignOut = false;
    return value;
  }

  /* ------------------------------------------------------------
   * Auth
   * ------------------------------------------------------------ */

  function signIn(email, password) {
    return auth.signInWithEmailAndPassword(lowerEmail(email), password);
  }

  function signUp(email, password, displayName) {
    return auth.createUserWithEmailAndPassword(lowerEmail(email), password).then(function (cred) {
      var name = String(displayName || '').trim();
      if (name && cred.user) {
        return cred.user.updateProfile({ displayName: name }).then(function () {
          // Perbarui sesi agar nama tampilan langsung dipakai UI.
          setSession(cred.user);
          return cred.user;
        });
      }
      return cred.user;
    });
  }

  function signInWithGoogle() {
    var provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    return auth.signInWithPopup(provider);
  }

  function sendReset(email) {
    return auth.sendPasswordResetEmail(lowerEmail(email));
  }

  function signOut() {
    explicitSignOut = true;
    cancelNullCheck();
    return auth.signOut().then(function () {
      clearSessionMarker();
    }).catch(function (err) {
      explicitSignOut = false;
      throw err;
    });
  }

  /* ------------------------------------------------------------
   * Penentuan workspace
   * ------------------------------------------------------------ */

  /**
   * Menentukan workspace user:
   *  1. `users/{uid}.workspaceId` (kunjungan berikutnya)
   *  2. `invites/{email}` (undangan dari admin)
   *  3. tidak ada -> perlu onboarding
   */
  /* ------------------------------------------------------------
   * Nama tampilan anggota
   * ------------------------------------------------------------ */

  // Nama dari Auth bisa belum terbaca tepat setelah signUp (updateProfile
  // belum selesai). Reload dulu sebagai cadangan agar dokumen member tidak
  // tersimpan sebagai potongan email.
  async function resolveDisplayName(user, email) {
    var name = String((user && user.displayName) || '').trim();
    if (!name && user) {
      try {
        await user.reload();
        var fresh = auth.currentUser || user;
        name = String(fresh.displayName || '').trim();
      } catch (e) {}
    }
    return name || email.split('@')[0];
  }

  // Dokumen member lama yang namanya terlanjur = potongan email diperbaiki
  // sekali saat pemiliknya login. Nama yang sudah diubah admin tidak disentuh.
  async function repairOwnDisplayName(wsId, member, user, email) {
    if (!member || !user || !user.uid) return member;
    var authName = String(user.displayName || '').trim();
    if (!authName) return member;
    var stored = String(member.display_name || '').trim();
    var prefix = email.split('@')[0];
    if (stored && stored !== prefix) return member;
    if (stored === authName) return member;
    try {
      await db.collection('workspaces').doc(wsId).collection('members').doc(user.uid)
        .update({ display_name: authName, updated_at: nowIso() });
    } catch (e) {
      return member;
    }
    var patched = {};
    Object.keys(member).forEach(function (k) { patched[k] = member[k]; });
    patched.display_name = authName;
    return patched;
  }

  /**
   * Beberapa pemicu auth bisa datang berdekatan (popup + event auth +
   * tombol "Cek undangan"). Permintaan untuk uid yang sama digabung supaya
   * tidak ada dua `get()` paralel ke dokumen yang sama — pola yang memicu
   * race target di SDK Firestore.
   */
  function resolveMembership(user) {
    if (!user) return Promise.resolve({ status: 'none' });
    var uid = String(user.uid || '');
    if (resolving && resolvingUid === uid) {
      logDebug('resolveMembership: gabung permintaan', uid);
      return resolving;
    }
    var promise = resolveMembershipNow(user);
    resolving = promise;
    resolvingUid = uid;
    var clear = function () {
      if (resolving === promise) { resolving = null; resolvingUid = null; }
    };
    promise.then(clear, clear);
    return promise;
  }

  async function resolveMembershipNow(user) {
    if (!user) return { status: 'none' };
    var email = lowerEmail(user.email);
    logDebug('resolveMembership', user.uid, email);

    var userSnap = await db.collection('users').doc(user.uid).get();
    var knownWs = (userSnap.exists && userSnap.data().workspaceId) || '';

    if (knownWs) {
      var knownMember = await db.collection('workspaces').doc(knownWs)
        .collection('members').doc(user.uid).get();
      if (knownMember.exists) {
        var km = knownMember.data();
        if (km.member_status === 'active') {
          km = await repairOwnDisplayName(knownWs, km, user, email);
          return { status: 'active', workspaceId: knownWs, member: km };
        }
        return { status: 'inactive', workspaceId: knownWs, member: km };
      }
      // Dokumen member hilang (dihapus admin) -> lupakan workspace lama.
      await db.collection('users').doc(user.uid).set({ workspaceId: null }, { merge: true }).catch(function () {});
    }

    var inviteSnap = await db.collection('invites').doc(email).get();
    if (inviteSnap.exists) {
      var invite = inviteSnap.data();
      var target = invite.workspace_id;
      if (target) {
        var memberRef = db.collection('workspaces').doc(target).collection('members').doc(user.uid);
        var existing = await memberRef.get();
        if (!existing.exists) {
          await memberRef.set({
            member_id: user.uid,
            workspace_id: target,
            email: email,
            display_name: invite.display_name || await resolveDisplayName(user, email),
            role: invite.role || 'editor',
            member_status: 'active',
            created_at: nowIso(),
          });
        }
        // Undangan dipakai sekali: hapus dokumen root & salinan di workspace.
        await db.collection('invites').doc(email).delete().catch(function () {});
        await db.collection('workspaces').doc(target).collection('invites').doc(email).delete().catch(function () {});
        await db.collection('users').doc(user.uid).set({
          workspaceId: target, email: email, updatedAt: nowIso(),
        }, { merge: true });
        var joined = await memberRef.get();
        return {
          status: joined.data() && joined.data().member_status === 'active' ? 'active' : 'inactive',
          workspaceId: target,
          member: joined.data(),
        };
      }
    }

    return { status: 'none', email: email };
  }

  async function createWorkspace(name) {
    var user = auth.currentUser;
    if (!user) throw new Error('Sesi berakhir. Silakan masuk kembali.');
    var email = lowerEmail(user.email);
    var displayName = await resolveDisplayName(user, email);
    var wsId = 'ws_' + user.uid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 18);
    var now = nowIso();
    var wsRef = db.collection('workspaces').doc(wsId);
    var meRef = wsRef.collection('members').doc(user.uid);

    // Dokumen member milik sendiri selalu bisa dibaca (aturan mengizinkan
    // uid == auth.uid), sedangkan dokumen workspace hanya bisa dibaca
    // anggota aktif. Jadi cek keanggotaan lewat member, bukan workspace.
    var meSnap = await meRef.get();

    if (!meSnap.exists) {
      try {
        await wsRef.set({
          workspace_id: wsId,
          workspace_name: String(name || 'FlowSpace Workspace').trim() || 'FlowSpace Workspace',
          owner_email: email,
          status: 'active',
          created_at: now,
          updated_at: now,
        });
      } catch (err) {
        // Gagal "create" berarti dokumen sudah ada: workspace ini milik akun
        // lain / akun ini sudah pernah terdaftar tetapi bukan anggota.
        if (err && String(err.code || '').indexOf('permission-denied') !== -1) {
          throw new Error('Workspace untuk akun ini sudah terdaftar, tetapi Anda bukan anggotanya. Minta admin mengirim undangan atau mengaktifkan kembali akun Anda.');
        }
        throw err;
      }

      await meRef.set({
        member_id: user.uid,
        workspace_id: wsId,
        email: email,
        display_name: displayName,
        role: 'admin',
        member_status: 'active',
        created_at: now,
      });
    }

    await db.collection('users').doc(user.uid).set({
      workspaceId: wsId, email: email, updatedAt: now,
    }, { merge: true });

    var memberSnap = await meRef.get();
    return { workspaceId: wsId, member: await repairOwnDisplayName(wsId, memberSnap.data(), user, email) };
  }

  /* ------------------------------------------------------------
   * Sink: Store lokal -> Firestore
   * ------------------------------------------------------------ */

  function installSink() {
    if (sinkInstalled) return;
    sinkInstalled = true;
    global.Store.setSink(function (evt) {
      if (!workspaceId) return;

      if (evt.type === 'reset') {
        resetWorkspace().catch(function (err) { reportError(err, 'reset'); });
        return;
      }

      var idField = ID_FIELDS[evt.collection];
      if (!idField) return;

      (evt.rows || []).forEach(function (row) {
        if (!row) return;
        var id = row[idField];
        if (id === undefined || id === null || id === '') return;
        var path = docPath(evt.collection, id);
        pendingOps.set(path, {
          refs: evt.collection === 'invites' ? inviteRefs(id) : [docRef(evt.collection, id)],
          type: evt.type === 'remove' ? 'delete' : 'set',
          data: row,
          context: evt.collection,
        });
        markLocal(evt.collection, id);
      });

      scheduleFlush();
    });
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(flush, 60);
  }

  function flush() {
    flushTimer = null;
    if (!workspaceId || pendingOps.size === 0) return;
    var ops = Array.from(pendingOps.values());
    pendingOps.clear();

    while (ops.length > 0) {
      var chunk = ops.splice(0, 400);
      var batch = db.batch();
      chunk.forEach(function (op) {
        (op.refs || []).forEach(function (ref) {
          if (op.type === 'delete') batch.delete(ref);
          else batch.set(ref, sanitize(op.data));
        });
      });
      batch.commit().catch(function (err) { reportError(err, 'tulis data'); });
    }
  }

  /* ------------------------------------------------------------
   * Realtime: Firestore -> Store lokal
   * ------------------------------------------------------------ */

  function handleSnapshot(collection, snap) {
    var idField = ID_FIELDS[collection];
    var rows = (snap.docs || []).map(function (doc) {
      var data = doc.data() || {};
      if (!data[idField]) data[idField] = doc.id;
      return data;
    });

    var isFirst = !firstSnapshot[collection];
    firstSnapshot[collection] = true;

    var remoteChange = false;
    (snap.docChanges ? snap.docChanges() : []).forEach(function (ch) {
      var key = docPath(collection, ch.doc.id);
      var at = localWrites[key];
      if (!at || Date.now() - at > 4000) remoteChange = true;
    });

    global.Store.hydrate(collection, rows);

    if (!isFirst && remoteChange && !(snap.metadata && snap.metadata.fromCache)) {
      scheduleRemoteEmit(collection);
    }
  }

  function scheduleRemoteEmit(collection) {
    if (emitTimer) clearTimeout(emitTimer);
    emitTimer = setTimeout(function () {
      emitTimer = null;
      try {
        global.dispatchEvent(new CustomEvent('fs:change', {
          detail: { external: true, source: 'firestore', collection: collection },
        }));
      } catch (e) {}
    }, 200);
  }

  function subscribeCollection(collection, wsId, gen) {
    return new Promise(function (resolve) {
      var settled = false;
      function finish() {
        if (settled) return;
        settled = true;
        resolve();
      }

      if (gen !== attachGen) { finish(); return; }

      // Undangan selalu dibaca dari subkoleksi workspace (path-based rules),
      // dan hanya admin yang boleh melihatnya.
      if (collection === 'invites' && !(currentMember && currentMember.role === 'admin')) {
        global.Store.hydrate('invites', []);
        firstSnapshot.invites = true;
        finish();
        return;
      }

      var ref = db.collection('workspaces').doc(wsId).collection(collection);

      // Batasi koleksi yang tumbuh tanpa batas. Query tetap realtime; hanya
      // jendela dokumennya yang dipersempit.
      var limitCfg = COLLECTION_LIMITS[collection];
      if (limitCfg) {
        try {
          ref = ref.orderBy(limitCfg.orderBy, limitCfg.direction).limit(limitCfg.limit);
        } catch (e) {
          // Jangan gagalkan seluruh attach hanya karena query ditolak.
          reportError(e, 'query ' + collection);
        }
      }


      var unsub = ref.onSnapshot(function (snap) {
        if (gen !== attachGen) {
          // Attach sudah usang (logout / pindah workspace): jangan tulis
          // data lama ke Store, langsung lepas listener.
          try { unsub(); } catch (e) {}
          finish();
          return;
        }
        handleSnapshot(collection, snap);
        finish();
      }, function (err) {
        if (err && err.code === 'permission-denied') {
          // Satu baris saja per attach. Sebelumnya setiap koleksi mencetak
          // error sendiri sehingga satu sesi bisa membanjiri console dengan
          // belasan permission-denied saat token auth sedang berganti.
          deniedThisAttach = true;
          if (!deniedWarned) {
            deniedWarned = true;
            console.warn('[FlowSpace] akses workspace ditolak — listener dihentikan. Periksa keanggotaan akun ini.');
          }
          // Attach sudah selesai tetapi listener hidup kemudian ditolak
          // (token refresh / sesi berubah). Beri tahu app.js supaya bisa
          // memasang ulang sekali, bukan menampilkan data beku.
          if (!attaching) {
            try {
              global.dispatchEvent(new CustomEvent('fs:workspace-denied', {
                detail: { collection: collection },
              }));
            } catch (e) {}
          }
        } else {
          reportError(err, 'baca ' + collection);
        }
        finish();
      });

      if (gen !== attachGen) {
        try { unsub(); } catch (e) {}
        finish();
        return;
      }
      unsubs.push(unsub);
    });
  }

  /**
   * Pasang listener realtime untuk workspace aktif dan tunggu data awal.
   * Attach yang lebih baru membatalkan attach lama lewat `attachGen`.
   */
  function attach(wsId, member) {
    // Permintaan untuk workspace yang sama saat attach masih berjalan
    // cukup memakai promise yang sama.
    if (attaching && attachingWs === wsId) return attaching;

    var gen = ++attachGen;
    var promise = doAttach(wsId, member, gen);
    attaching = promise;
    attachingWs = wsId;
    var clear = function () {
      if (attaching === promise) { attaching = null; attachingWs = null; }
    };
    promise.then(clear, clear);
    return promise;
  }

  async function doAttach(wsId, member, gen) {
    detachSubscriptions();
    if (gen !== attachGen) return false;

    // Jangan pasang listener untuk workspace milik uid lain. Ini terjadi
    // saat akun berganti dari tab lain: listener lama sempat hidup dengan
    // kredensial baru dan seluruh koleksi dibalas permission-denied.
    var authUid = auth && auth.currentUser ? String(auth.currentUser.uid) : '';
    var memberUid = member ? String(member.member_id || member.uid || '') : '';
    if (authUid && memberUid && authUid !== memberUid) {
      workspaceId = null;
      currentMember = null;
      detachSubscriptions();
      logDebug('attach dibatalkan: uid tidak cocok', authUid, memberUid);
      throw sessionChangedError();
    }

    workspaceId = wsId;
    currentMember = member || null;
    firstSnapshot = {};
    localWrites = {};
    pendingOps.clear();
    logDebug('attach mulai', wsId, 'gen', gen);

    // Mulai dari data kosong supaya tidak menampilkan cache workspace lain.
    global.Store.collections.forEach(function (c) {
      if (c !== 'workspaces') global.Store.hydrate(c, []);
    });

    // Muat dokumen workspace itu sendiri.
    try {
      var wsSnap = await db.collection('workspaces').doc(wsId).get();
      if (gen !== attachGen) return false;
      if (!wsSnap.exists) {
        workspaceId = null;
        currentMember = null;
        detachSubscriptions();
        throw membershipError();
      }
      global.Store.hydrate('workspaces', [wsSnap.data()]);
    } catch (err) {
      if (gen !== attachGen) return false;
      // Gagal membaca workspace berarti belum aman memasang listener:
      // semuanya akan ditolak dan membanjiri console. Bersihkan state
      // supaya pemanggil bisa menampilkan layar yang tepat.
      workspaceId = null;
      currentMember = null;
      detachSubscriptions();
      logDebug('attach gagal', wsId, err && err.code);
      if (isPermissionDenied(err)) throw membershipError();
      throw err;
    }

    await Promise.all(SYNC_COLLECTIONS.map(function (collection) {
      return subscribeCollection(collection, wsId, gen);
    }));
    if (gen !== attachGen) return false;

    // Ada listener yang langsung ditolak walau workspace tadi terbaca:
    // token Firestore belum siap (credential change setelah sign-in).
    // Jangan simpulkan akun tidak berhak; bersihkan lalu biarkan pemanggil
    // mencoba lagi setelah token di-refresh.
    if (deniedThisAttach) {
      workspaceId = null;
      currentMember = null;
      detachSubscriptions();
      logDebug('attach ditolak listener', wsId);
      throw workspaceDeniedError();
    }

    logDebug('attach selesai', wsId, 'listener', unsubs.length);
    return true;
  }

  function detachSubscriptions() {
    unsubs.forEach(function (u) { try { u(); } catch (e) {} });
    unsubs = [];
    firstSnapshot = {};
    deniedWarned = false;
    deniedThisAttach = false;
  }

  /** Logout / pindah akun: lepas listener dan bersihkan cache lokal. */
  function detach() {
    // Naikkan generasi supaya attach yang masih berjalan berhenti dan
    // tidak menambah listener baru setelah pembersihan.
    attachGen++;
    attaching = null;
    attachingWs = null;
    detachSubscriptions();
    workspaceId = null;
    currentMember = null;
    pendingOps.clear();
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (global.Chat) global.Chat.reset();
    global.Store.clearAllLocal();
    logDebug('detach');
  }

  /* ------------------------------------------------------------
   * Chat tim (tidak lewat Store: hanya 50 pesan terakhir, supaya
   * cache lokal dan kuota baca tetap kecil).
   * ------------------------------------------------------------ */

  function chatRoot() {
    return db.collection('workspaces').doc(workspaceId);
  }

  function isoValue(value) {
    if (!value) return '';
    if (typeof value.toDate === 'function') return value.toDate().toISOString();
    return String(value);
  }

  function chatSubscribe(limit, onMessages, onError) {
    if (!db || !workspaceId) return function () {};
    var q = chatRoot().collection('chatMessages')
      .orderBy('created_at', 'desc')
      .limit(limit || 50);
    return q.onSnapshot(function (snap) {
      var rows = snap.docs.map(function (doc) {
        var d = doc.data() || {};
        d.message_id = d.message_id || doc.id;
        d.created_at = isoValue(d.created_at);
        d.updated_at = isoValue(d.updated_at);
        d.edited_at = isoValue(d.edited_at);
        d.deleted_at = isoValue(d.deleted_at);
        return d;
      }).reverse();
      onMessages(rows);
    }, function (err) {
      if (onError) onError(err);
      else reportError(err, 'chat');
    });
  }

  function sanitizeAttachments(list) {
    if (!Array.isArray(list)) return [];
    var out = [];
    list.forEach(function (a) {
      if (!a) return;
      var type = String(a.type || '');
      if (type !== 'task' && type !== 'workflow') return;
      var id = String(a.id || '').trim();
      if (!id) return;
      out.push({
        type: type,
        id: id,
        title: String(a.title || '').trim().slice(0, 120),
        meta: String(a.meta || '').trim().slice(0, 60),
      });
    });
    return out.slice(0, 3);
  }

  function chatSend(body, attachments) {
    var text = String(body || '').trim();
    if (text.length > 2000) return Promise.reject(new Error('Pesan maksimal 2000 karakter'));
    var list = sanitizeAttachments(attachments);
    var attachmentsJson = list.length > 0 ? JSON.stringify(list) : '';
    if (attachmentsJson.length > 1500) {
      return Promise.reject(new Error('Lampiran terlalu besar'));
    }
    if (!text && list.length === 0) {
      return Promise.reject(new Error('Tulis pesan atau lampirkan task/workflow'));
    }
    if (!db || !workspaceId || !auth.currentUser) {
      return Promise.reject(new Error('Sesi berakhir. Silakan masuk kembali.'));
    }
    var email = lowerEmail(auth.currentUser.email);
    var id = 'msg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    var now = nowIso();
    return chatRoot().collection('chatMessages').doc(id).set({
      message_id: id,
      workspace_id: workspaceId,
      body: text,
      attachments_json: attachmentsJson,
      sender_uid: auth.currentUser.uid,
      sender_email: email,
      sender_name: (global.FlowSession && global.FlowSession.displayName) || email.split('@')[0],
      created_at: now,
      updated_at: now,
      edited_at: '',
      deleted_at: '',
      deleted_by_uid: '',
    }).then(function () { return id; });
  }

  function chatUpdate(messageId, body) {
    var text = String(body || '').trim();
    if (!text) return Promise.reject(new Error('Pesan tidak boleh kosong'));
    if (text.length > 2000) return Promise.reject(new Error('Pesan maksimal 2000 karakter'));
    if (!db || !workspaceId) return Promise.reject(new Error('Workspace belum siap'));
    var now = nowIso();
    return chatRoot().collection('chatMessages').doc(messageId).update({
      body: text, edited_at: now, updated_at: now,
    });
  }

  function chatDelete(messageId) {
    if (!db || !workspaceId || !auth.currentUser) {
      return Promise.reject(new Error('Sesi berakhir. Silakan masuk kembali.'));
    }
    var now = nowIso();
    return chatRoot().collection('chatMessages').doc(messageId).update({
      deleted_at: now,
      deleted_by_uid: auth.currentUser.uid,
      updated_at: now,
    });
  }

  /* Status baca chat: satu dokumen per user (doc ID = uid). Dibaca
   * sekali saat chat dibuka; tulisan di-debounce oleh chat.js. */
  function chatReadDoc() {
    return chatRoot().collection('chatReads').doc(auth.currentUser.uid);
  }

  function chatReadGet() {
    if (!db || !workspaceId || !auth.currentUser) return Promise.resolve(null);
    return chatReadDoc().get().then(function (snap) {
      if (!snap.exists) return null;
      var d = snap.data() || {};
      return {
        lastReadAt: isoValue(d.last_read_at),
        lastReadMessageId: String(d.last_read_message_id || ''),
      };
    });
  }

  function chatReadSet(lastReadAt, lastReadMessageId) {
    if (!db || !workspaceId || !auth.currentUser) {
      return Promise.reject(new Error('Sesi berakhir. Silakan masuk kembali.'));
    }
    var at = String(lastReadAt || '').slice(0, 40);
    var messageId = String(lastReadMessageId || '').slice(0, 120);
    if (!at) return Promise.reject(new Error('Waktu baca tidak valid'));
    return chatReadDoc().set({
      workspace_id: workspaceId,
      member_id: auth.currentUser.uid,
      last_read_at: at,
      last_read_message_id: messageId,
      updated_at: nowIso(),
    }, { merge: true });
  }

  /** Hapus seluruh isi workspace, kecuali dokumen workspace & member sendiri. */
  async function resetWorkspace() {
    if (!workspaceId || !auth.currentUser) return;
    var uid = auth.currentUser.uid;
    var root = db.collection('workspaces').doc(workspaceId);
    var pendingRootDeletes = [];
    // chatMessages tidak ikut disinkronkan ke Store, tetapi tetap harus
    // dibersihkan saat reset workspace.
    var resetCollections = SYNC_COLLECTIONS.concat(['chatMessages', 'chatReads']);

    for (var i = 0; i < resetCollections.length; i++) {
      var collection = resetCollections[i];
      var snap;
      try {
        snap = await root.collection(collection).get();
      } catch (err) {
        reportError(err, 'reset ' + collection);
        continue;
      }
      var docs = snap.docs.filter(function (d) {
        return !(collection === 'members' && d.id === uid);
      });
      // Undangan juga punya pasangan di koleksi root; hapus agar tidak
      // ada undangan menggantung setelah reset.
      if (collection === 'invites') {
        docs.map(function (d) { return d.id; }).forEach(function (emailKey) {
          var ref = db.collection('invites').doc(emailKey);
          pendingRootDeletes.push(ref);
        });
      }
      while (docs.length > 0) {
        var batch = db.batch();
        docs.splice(0, 400).forEach(function (d) { batch.delete(d.ref); });
        await batch.commit().catch(function (err) { reportError(err, 'reset ' + collection); });
      }
      global.Store.hydrate(collection, []);
    }

    if (pendingRootDeletes.length > 0) {
      var rootBatch = db.batch();
      pendingRootDeletes.forEach(function (ref) { rootBatch.delete(ref); });
      await rootBatch.commit().catch(function (err) { reportError(err, 'reset undangan'); });
    }

    // Kembalikan member sendiri ke cache agar UI tidak kosong.
    var meSnap = await root.collection('members').doc(uid).get().catch(function () { return null; });
    if (meSnap && meSnap.exists) global.Store.hydrate('members', [meSnap.data()]);

    // Pasang ulang listener agar state lokal konsisten dengan server.
    detachSubscriptions();
    firstSnapshot = {};
    var gen = attachGen;
    await Promise.all(SYNC_COLLECTIONS.map(function (collection) {
      return subscribeCollection(collection, workspaceId, gen);
    }));
  }

  /* ------------------------------------------------------------
   * Info
   * ------------------------------------------------------------ */

  function info() {
    return {
      enabled: enabled,
      projectId: FB_CFG.projectId || '',
      workspaceId: workspaceId,
      member: currentMember,
      user: global.FlowSession,
      offlineCache: offlineCache,
      persistence: persistenceState,
      authPersistence: persistenceType(),
      storagePersisted: storagePersisted,
      hasSession: hasSessionMarker(),
      listeners: unsubs.length,
    };
  }

  global.FlowFirebase = {
    enabled: enabled,
    init: init,
    info: info,
    onAuthChange: onAuthChange,
    currentUser: currentUser,
    currentWorkspaceId: function () { return workspaceId; },
    resolveMembership: resolveMembership,
    createWorkspace: createWorkspace,
    attach: attach,
    detach: detach,
    resetWorkspace: resetWorkspace,
    signIn: signIn,
    signUp: signUp,
    signInWithGoogle: signInWithGoogle,
    sendReset: sendReset,
    signOut: signOut,
    consumeExplicitSignOut: consumeExplicitSignOut,
    rememberSession: rememberSession,
    hasSessionMarker: hasSessionMarker,
    clearSessionMarker: clearSessionMarker,
    friendlyError: friendlyError,
    isTransientError: isTransientError,
    isFatalFirestoreError: isFatalFirestoreError,
    isPermissionDenied: isPermissionDenied,
    chatSubscribe: chatSubscribe,
    chatSend: chatSend,
    chatUpdate: chatUpdate,
    chatDelete: chatDelete,
    chatReadGet: chatReadGet,
    chatReadSet: chatReadSet,
  };
})(window);
