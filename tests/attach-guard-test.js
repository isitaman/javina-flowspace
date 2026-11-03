/* Harness Node (tanpa browser): menjalankan `web/js/firebase.js` di atas
 * mock Firestore/Auth untuk memastikan guard attach tidak pernah bocor
 * listener maupun membaca workspace yang bukan milik sesi ini.
 *
 * Tidak butuh server statis — langsung membaca file sumber. */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CODE = fs.readFileSync(path.join(__dirname, '..', 'web', 'js', 'firebase.js'), 'utf8');
const COLLECTIONS = ['workspaces', 'members', 'invites', 'workflows', 'nodes', 'edges', 'tasks', 'applications', 'taskApplications', 'checklist', 'activityLogs', 'applicationCategories', 'comments'];

function makeEnv(opts) {
  const stats = { wsReads: 0, listeners: 0, hydrated: [], queries: [] };
  const denied = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });

  const snapshot = {
    docs: [],
    docChanges: () => [],
    metadata: { fromCache: false },
  };

  function wsDoc(wsId) {
    return {
      get() {
        stats.wsReads++;
        if (opts.wsDenied) return Promise.reject(denied);
        return Promise.resolve({ exists: true, data: () => ({ workspace_id: wsId, workspace_name: 'WS', status: 'active' }) });
      },
      collection(name) {
        const query = { orderBy: null, limit: null };
        const api = {
          doc() {
            return {
              get: () => Promise.resolve({ exists: true, data: () => ({}) }),
              set: () => Promise.resolve(),
              update: () => Promise.resolve(),
            };
          },
          orderBy(field, dir) { query.orderBy = [field, dir]; return api; },
          limit(n) { query.limit = n; return api; },
          onSnapshot(next) {
            stats.listeners++;
            stats.hydrated.push(name);
            stats.queries.push({ name, orderBy: query.orderBy, limit: query.limit });
            setTimeout(() => next(snapshot), 0);
            return () => {};
          },
        };
        return api;
      },
    };
  }

  const db = {
    collection(name) {
      if (name === 'workspaces') return { doc: wsDoc };
      return { doc: () => ({ get: () => Promise.resolve({ exists: false }), set: () => Promise.resolve() }) };
    },
  };

  const user = opts.user === null ? null : {
    uid: opts.user.uid,
    email: opts.user.email,
    displayName: 'Test User',
    reload: () => Promise.resolve(),
  };

  const authObj = {
    currentUser: user,
    onAuthStateChanged() {},
    signOut: () => Promise.resolve(),
  };

  const window = {
    FLOWSPACE_CONFIG: { mode: 'firebase', firebaseConfig: { apiKey: 'k', projectId: 'p' } },
    firebase: {
      apps: [],
      initializeApp: () => ({}),
      auth: () => authObj,
      firestore: () => db,
      SDK_VERSION: '10.0.0',
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { search: '' },
    navigator: { storage: { persist: () => Promise.resolve(true), persisted: () => Promise.resolve(true) } },
    dispatchEvent() {},
    CustomEvent: function () {},
    Store: {
      collections: COLLECTIONS,
      setSink() {},
      hydrate(c, rows) { stats.hydrated.push(c + ':' + rows.length); },
      clearAllLocal() {},
    },
    console,
    setTimeout,
    clearTimeout,
    Promise,
  };
  window.window = window;

  vm.createContext(window);
  vm.runInContext(CODE, window, { filename: 'firebase.js' });
  return { window, stats };
}

async function run(name, fn) {
  try {
    const out = await fn();
    console.log('PASS', name, out === undefined ? '' : JSON.stringify(out));
    return true;
  } catch (e) {
    console.log('FAIL', name, e && (e.code || e.message));
    return false;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

(async () => {
  let ok = true;

  ok = await run('workspace permission-denied tidak memasang listener', async () => {
    const { window, stats } = makeEnv({ wsDenied: true, user: { uid: 'u1', email: 'a@b.c' } });
    await window.FlowFirebase.init();
    let err = null;
    try {
      await window.FlowFirebase.attach('ws_x', { member_id: 'u1', member_status: 'active' });
    } catch (e) { err = e; }
    assert(err, 'attach seharusnya menolak');
    assert(err.code === 'flowspace/membership-denied', 'kode error salah: ' + (err.code || err.message));
    assert(stats.listeners === 0, 'listener dipasang: ' + stats.listeners);
    assert(window.FlowFirebase.currentWorkspaceId() === null, 'workspaceId tidak dibersihkan');
    return { code: err.code, listeners: stats.listeners };
  });

  ok = await run('uid tidak cocok membatalkan attach tanpa membaca Firestore', async () => {
    const { window, stats } = makeEnv({ user: { uid: 'u2', email: 'b@b.c' } });
    await window.FlowFirebase.init();
    let err = null;
    try {
      await window.FlowFirebase.attach('ws_x', { member_id: 'u1', member_status: 'active' });
    } catch (e) { err = e; }
    assert(err && err.code === 'flowspace/session-changed', 'error tidak sesuai: ' + (err && (err.code || err.message)));
    assert(stats.wsReads === 0, 'workspace tetap dibaca: ' + stats.wsReads);
    assert(stats.listeners === 0, 'listener dipasang: ' + stats.listeners);
    return { code: err.code };
  });

  ok = await run('attach normal memasang listener', async () => {
    const { window, stats } = makeEnv({ user: { uid: 'u1', email: 'a@b.c' } });
    await window.FlowFirebase.init();
    const result = await window.FlowFirebase.attach('ws_x', { member_id: 'u1', member_status: 'active', role: 'admin' });
    assert(result === true, 'attach tidak mengembalikan true');
    assert(stats.listeners >= 10, 'listener kurang: ' + stats.listeners);
    assert(window.FlowFirebase.currentWorkspaceId() === 'ws_x', 'workspaceId tidak diset');
    return { listeners: stats.listeners };
  });

  ok = await run('activityLogs dibatasi 300, koleksi lain tetap penuh', async () => {
    const { window, stats } = makeEnv({ user: { uid: 'u1', email: 'a@b.c' } });
    await window.FlowFirebase.init();
    const result = await window.FlowFirebase.attach('ws_x', { member_id: 'u1', member_status: 'active', role: 'admin' });
    assert(result === true, 'attach tidak mengembalikan true');
    const logs = stats.queries.find((q) => q.name === 'activityLogs');
    assert(logs, 'activityLogs tidak disubscribe');
    assert(logs.limit === 300, 'activityLogs limit salah: ' + JSON.stringify(logs.limit));
    assert(logs.orderBy && logs.orderBy[0] === 'created_at' && logs.orderBy[1] === 'desc', 'orderBy salah: ' + JSON.stringify(logs.orderBy));
    const tasks = stats.queries.find((q) => q.name === 'tasks');
    assert(tasks && tasks.limit === null, 'tasks ikut dibatasi: ' + JSON.stringify(tasks));
    return { logs, tasksLimit: tasks.limit };
  });

  process.exit(ok ? 0 : 1);
})();
