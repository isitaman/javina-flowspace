/* ============================================================
 * FlowSpace - store.js
 * Lapisan database lokal (localStorage) + event realtime.
 *
 * Meniru bentuk Google Sheets: kumpulan "collection" berupa array
 * object. Setiap perubahan memicu event `fs:change` dan disiarkan
 * ke tab lain via BroadcastChannel agar terasa realtime.
 *
 * Pada tahap berikutnya, modul ini bisa diganti dengan adapter
 * Firestore tanpa mengubah lapisan API/UI.
 * ============================================================ */

(function (global) {
  'use strict';

  var CFG = global.FLOWSPACE_CONFIG || {};
  // Mode Firebase memakai kunci terpisah supaya data lokal lama tidak
  // tertimpa dan tetap bisa diimpor/dipertahankan.
  var DB_KEY = CFG.mode === 'firebase'
    ? 'flowspace.db.fb.' + ((CFG.firebaseConfig && CFG.firebaseConfig.projectId) || 'v1')
    : 'flowspace.db.v1';
  var CHANNEL = 'flowspace.realtime';

  // Di mode Firebase, Firestore adalah sumber kebenaran dan seluruh data
  // dihidrasi ulang setiap sesi. Menyimpan salinan penuh di localStorage
  // hanya menambah tekanan kuota (yang bisa mengganggu koordinasi internal
  // SDK Firestore), jadi mode Firebase memakai memori saja.
  var persistEnabled = CFG.mode !== 'firebase';

  // Versi lama menyimpan salinan penuh dataset Firebase di localStorage.
  // Salinan itu tidak dipakai lagi; hapus sekali agar kuota browser lega
  // (Firestore tetap sumber kebenaran).
  if (!persistEnabled) {
    try { global.localStorage.removeItem(DB_KEY); } catch (e) {}
  }

  // Koleksi (mirip sheet) + header/kolom masing-masing.
  var COLLECTIONS = [
    'workspaces',
    'members',
    'invites',
    'workflows',
    'nodes',
    'edges',
    'tasks',
    'applications',
    'taskApplications',
    'checklist',
    'activityLogs',
    'applicationCategories',
    'comments',
    'chatMessages',
    'chatReads',
  ];

  function emptyDb() {
    var db = {};
    COLLECTIONS.forEach(function (c) { db[c] = []; });
    return db;
  }

  function clone(o) {
    if (o === null || o === undefined) return o;
    if (typeof structuredClone === 'function') {
      try { return structuredClone(o); } catch (e) {}
    }
    return JSON.parse(JSON.stringify(o));
  }

  var db = null;

  function load() {
    if (db) return db;
    if (!persistEnabled) {
      db = emptyDb();
      return db;
    }
    try {
      var raw = global.localStorage.getItem(DB_KEY);
      db = raw ? JSON.parse(raw) : emptyDb();
    } catch (e) {
      db = emptyDb();
    }
    // pastikan semua koleksi ada
    COLLECTIONS.forEach(function (c) {
      if (!Array.isArray(db[c])) db[c] = [];
    });
    return db;
  }

  function persist() {
    if (!persistEnabled) return;
    try {
      global.localStorage.setItem(DB_KEY, JSON.stringify(db));
    } catch (e) {
      console.error('Gagal menyimpan ke localStorage', e);
    }
  }

  // Siarkan perubahan ke listener dalam tab yang sama.
  function emit(type, collection, id, external) {
    try {
      global.dispatchEvent(new CustomEvent('fs:change', {
        detail: { type: type, collection: collection, id: id, external: !!external },
      }));
    } catch (e) {}
  }

  // Realtime antar tab pada browser yang sama.
  var channel = null;
  try {
    if ('BroadcastChannel' in global) {
      channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = function (msg) {
        if (msg && msg.data && msg.data.collection) {
          // Muat ulang data dari storage, lalu beri tahu UI.
          reload();
          emit(msg.data.type, msg.data.collection, msg.data.id, true);
        }
      };
    } else {
      global.addEventListener('storage', function (e) {
        if (e.key === DB_KEY) {
          reload();
          emit('external', null, null, true);
        }
      });
    }
  } catch (e) {}

  function broadcast(type, collection, id) {
    if (channel) {
      try { channel.postMessage({ type: type, collection: collection, id: id }); } catch (e) {}
    }
  }

  function commit(type, collection, id) {
    persist();
    emit(type, collection, id);
    broadcast(type, collection, id);
  }

  /* --- Sink (dipakai adapter Firebase) --------------------------
   * Setiap perubahan lokal dikirim ke sink agar bisa ditulis ke
   * Firestore. Mode lokal tidak memasang sink, jadi tidak ada efek. */
  var sinkFn = null;

  function queueSink(type, collection, rows) {
    if (!sinkFn) return;
    try {
      sinkFn({ type: type, collection: collection, rows: rows || [] });
    } catch (e) {
      console.error('Store sink error', e);
    }
  }

  function reload() {
    // Di mode Firebase jangan kosongkan memori: tab lain sudah menerima
    // data lewat listener Firestore masing-masing.
    if (!persistEnabled) return;
    db = null;
    load();
  }

  // --- Util ID & waktu -------------------------------------------

  function uuid() {
    if (global.crypto && global.crypto.randomUUID) {
      return global.crypto.randomUUID();
    }
    var s = 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx';
    return s.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function generateId(prefix) {
    var u = uuid().replace(/-/g, '');
    return (prefix ? prefix + '_' : '') + u.substring(0, 16);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  // --- CRUD generik ----------------------------------------------

  var Store = {
    uuid: uuid,
    generateId: generateId,
    nowIso: nowIso,

    get: function (collection) {
      load();
      return db[collection] || [];
    },

    readAll: function (collection) {
      return clone(this.get(collection));
    },

    findBy: function (collection, field, value) {
      return this.readAll(collection).filter(function (r) {
        return String(r[field]) === String(value);
      });
    },

    findById: function (collection, idField, idValue) {
      var matches = this.findBy(collection, idField, idValue);
      return matches.length > 0 ? matches[0] : null;
    },

    insert: function (collection, data) {
      load();
      if (!Array.isArray(db[collection])) db[collection] = [];
      var row = clone(data);
      db[collection].push(row);
      var idKey = Object.keys(row)[0];
      queueSink('insert', collection, [row]);
      commit('insert', collection, idKey ? row[idKey] : null);
      return clone(row);
    },

    update: function (collection, idField, idValue, patch) {
      load();
      var list = db[collection];
      for (var i = 0; i < list.length; i++) {
        if (String(list[i][idField]) === String(idValue)) {
          Object.keys(patch).forEach(function (k) {
            if (patch[k] !== undefined) list[i][k] = patch[k];
          });
          queueSink('update', collection, [list[i]]);
          commit('update', collection, idValue);
          return true;
        }
      }
      return false;
    },

    remove: function (collection, idField, idValue) {
      load();
      var list = db[collection];
      for (var i = 0; i < list.length; i++) {
        if (String(list[i][idField]) === String(idValue)) {
          var removedRow = list[i];
          list.splice(i, 1);
          queueSink('remove', collection, [removedRow]);
          commit('remove', collection, idValue);
          return true;
        }
      }
      return false;
    },

    removeBy: function (collection, field, value) {
      load();
      var list = db[collection];
      var removedRows = [];
      for (var i = list.length - 1; i >= 0; i--) {
        if (String(list[i][field]) === String(value)) {
          removedRows.push(list[i]);
          list.splice(i, 1);
        }
      }
      if (removedRows.length > 0) {
        queueSink('remove', collection, removedRows);
        commit('remove', collection, value);
      }
      return removedRows.length;
    },

    batchInsert: function (collection, dataArray) {
      if (!dataArray || dataArray.length === 0) return [];
      load();
      var rows = dataArray.map(function (d) { return clone(d); });
      db[collection] = db[collection].concat(rows);
      queueSink('insert', collection, rows);
      commit('insert', collection, null);
      return rows;
    },

    clear: function (collection) {
      load();
      var old = db[collection] || [];
      db[collection] = [];
      queueSink('remove', collection, old);
      commit('remove', collection, null);
    },

    reset: function () {
      db = emptyDb();
      queueSink('reset', null, []);
      commit('reset', null, null);
    },

    /* --- Hydrasi dari sumber eksternal (Firestore) --------------
     * Mengganti isi satu koleksi tanpa memicu sink (agar tidak
     * menulis balik data yang baru saja dibaca). */
    hydrate: function (collection, rows) {
      load();
      db[collection] = (rows || []).map(clone);
      persist();
    },

    /** Kosongkan semua koleksi di memori + storage, tanpa sink. */
    clearAllLocal: function () {
      db = emptyDb();
      persist();
    },

    setSink: function (fn) {
      sinkFn = typeof fn === 'function' ? fn : null;
    },

    /** Daftar nama koleksi (read-only) untuk adapter. */
    collections: COLLECTIONS.slice(),
  };

  global.Store = Store;
})(window);
