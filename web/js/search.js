/* ============================================================
 * FlowSpace — Command palette (Ctrl/Cmd+K)
 * ------------------------------------------------------------
 * Pencarian cepat lintas data yang SUDAH ada di memori (Store):
 * task, workflow, node, aplikasi, anggota, plus navigasi antar view.
 *
 * Tidak ada query Firestore dan tidak ada read tambahan — semua
 * baris sudah disinkronkan oleh adapter (firebase.js) atau dimuat
 * oleh mode lokal.
 * ============================================================ */

(function (global) {
  'use strict';

  const NAV = [
    { kind: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard', hint: 'Ringkasan workspace' },
    { kind: 'workflows', label: 'Workflows', icon: 'workflow', hint: 'Daftar workflow & kanvas' },
    { kind: 'kanban', label: 'Kanban Board', icon: 'square-kanban', hint: 'Papan task per status' },
    { kind: 'applications', label: 'Application Hub', icon: 'app-window', hint: 'Katalog aplikasi tim' },
    { kind: 'team', label: 'Team & Members', icon: 'users', hint: 'Anggota dan undangan' },
    { kind: 'chat', label: 'Chat Tim', icon: 'messages-square', hint: 'Percakapan tim' },
    { kind: 'settings', label: 'Settings', icon: 'settings', hint: 'Workspace, backup, diagnostik' },
  ];

  const MAX_PER_GROUP = 6;
  const MAX_TOTAL = 30;

  const state = {
    open: false,
    modal: null,
    input: null,
    items: [],
    active: -1,
    previousFocus: null,
  };

  /* ---------------------------------------------------------- */
  /* Data helpers                                               */
  /* ---------------------------------------------------------- */

  function readRows(collection) {
    try {
      if (!global.Store || typeof Store.readAll !== 'function') return [];
      return Store.readAll(collection) || [];
    } catch (e) {
      return [];
    }
  }

  function text(value) {
    return String(value === null || value === undefined ? '' : value);
  }

  function stamp(row) {
    return text(row.updated_at || row.created_at || '');
  }

  // Skor sederhana: awalan kata > awal kata > potongan di tengah.
  function score(haystack, needle) {
    const textValue = text(haystack).toLowerCase();
    if (!textValue || !needle) return 0;
    const idx = textValue.indexOf(needle);
    if (idx === -1) return 0;
    if (idx === 0) return 100;
    const prev = textValue.charAt(idx - 1);
    if (prev === ' ' || prev === '-' || prev === '_' || prev === '/' || prev === '@' || prev === '·') return 70;
    return 40;
  }

  function bestScore(fields, needle) {
    let best = 0;
    fields.forEach(([value, weight]) => {
      const s = score(value, needle) * (weight === undefined ? 1 : weight);
      if (s > best) best = s;
    });
    return best;
  }

  function snippet(value, max) {
    const clean = text(value).replace(/\s+/g, ' ').trim();
    if (clean.length <= max) return clean;
    return clean.slice(0, max - 1).trimEnd() + '…';
  }

  function workflowNameById() {
    const map = {};
    readRows('workflows').forEach((w) => {
      if (!w || w.deleted_at) return;
      map[text(w.workflow_id)] = text(w.workflow_name) || 'Workflow';
    });
    return map;
  }

  /* ---------------------------------------------------------- */
  /* Result builders                                            */
  /* ---------------------------------------------------------- */

  function buildGroups(rawQuery) {
    const q = text(rawQuery).trim().toLowerCase();
    const groups = [];

    const navItems = NAV.map((n, index) => {
      const s = q ? score(n.label, q) : 0;
      if (q && !s) return null;
      return {
        type: 'nav', id: n.kind, title: n.label, subtitle: n.hint, icon: n.icon,
        badge: 'Buka', score: q ? s : 1, order: index,
      };
    }).filter(Boolean);

    if (navItems.length) {
      groups.push({
        key: 'nav', label: q ? 'Navigasi' : 'Lompat ke', icon: 'compass',
        // Navigasi selalu lengkap: ini pintasan, bukan hasil pencarian.
        items: navItems.sort((a, b) => (b.score - a.score) || (a.order - b.order)).slice(0, NAV.length),
      });
    }

    if (!q) return groups;

    const taskItems = readRows('tasks')
      .filter((t) => t && !t.deleted_at)
      .map((t) => {
        const s = bestScore([[t.title, 1], [t.description, 0.6], [t.assignee_email, 0.5]], q);
        if (!s) return null;
        const status = text(t.status) || 'todo';
        return {
          type: 'task', id: text(t.task_id), title: text(t.title) || 'Task tanpa judul',
          subtitle: [status, text(t.assignee_email)].filter(Boolean).join(' · '),
          icon: 'list-todo', badge: 'Task', score: s, stamp: stamp(t),
        };
      })
      .filter(Boolean);

    const workflowItems = readRows('workflows')
      .filter((w) => w && !w.deleted_at)
      .map((w) => {
        const s = bestScore([[w.workflow_name, 1], [w.description, 0.6], [w.category, 0.5]], q);
        if (!s) return null;
        return {
          type: 'workflow', id: text(w.workflow_id), title: text(w.workflow_name) || 'Workflow',
          subtitle: [text(w.category), snippet(w.description, 60)].filter(Boolean).join(' · '),
          icon: 'workflow', badge: 'Workflow', score: s, stamp: stamp(w),
        };
      })
      .filter(Boolean);

    const wfNames = workflowNameById();
    const nodeItems = readRows('nodes')
      .filter((n) => n && !n.deleted_at)
      .map((n) => {
        const s = bestScore([[n.title, 1], [n.description, 0.6]], q);
        if (!s) return null;
        const wfName = wfNames[text(n.workflow_id)] || 'Workflow';
        return {
          type: 'node', id: text(n.node_id), title: text(n.title) || 'Node',
          subtitle: `${text(n.node_type).replace(/_/g, ' ') || 'node'} · ${wfName}`,
          icon: 'square-dashed', badge: 'Node', score: s, stamp: stamp(n),
          workflowId: text(n.workflow_id), workflowName: wfName,
        };
      })
      .filter(Boolean);

    const appItems = readRows('applications')
      .filter((a) => a && !a.deleted_at)
      .map((a) => {
        const s = bestScore([[a.app_name, 1], [a.description, 0.6], [a.category, 0.5], [a.app_url, 0.4]], q);
        if (!s) return null;
        return {
          type: 'app', id: text(a.app_id), title: text(a.app_name) || 'Aplikasi',
          subtitle: [text(a.category), snippet(a.description, 60)].filter(Boolean).join(' · '),
          icon: 'app-window', badge: 'Aplikasi', score: s, stamp: stamp(a),
        };
      })
      .filter(Boolean);

    const memberItems = readRows('members')
      .filter((m) => m && !m.deleted_at)
      .map((m) => {
        const s = bestScore([[m.display_name, 1], [m.email, 0.9], [m.role, 0.4]], q);
        if (!s) return null;
        return {
          type: 'member', id: text(m.member_id), email: text(m.email),
          title: text(m.display_name) || text(m.email) || 'Anggota',
          subtitle: [text(m.email), text(m.role), text(m.member_status)].filter(Boolean).join(' · '),
          icon: 'user-round', badge: 'Anggota', score: s, stamp: stamp(m),
        };
      })
      .filter(Boolean);

    [
      { key: 'task', label: 'Task', icon: 'list-todo', items: taskItems },
      { key: 'workflow', label: 'Workflow', icon: 'workflow', items: workflowItems },
      { key: 'node', label: 'Node kanvas', icon: 'square-dashed', items: nodeItems },
      { key: 'app', label: 'Aplikasi', icon: 'app-window', items: appItems },
      { key: 'member', label: 'Anggota', icon: 'user-round', items: memberItems },
    ].forEach((group) => {
      if (!group.items.length) return;
      group.items.sort((a, b) => (b.score - a.score) || String(b.stamp).localeCompare(String(a.stamp)));
      groups.push({ ...group, items: group.items.slice(0, MAX_PER_GROUP) });
    });

    return groups;
  }

  /* ---------------------------------------------------------- */
  /* Rendering                                                  */
  /* ---------------------------------------------------------- */

  function escapeHtml(value) {
    if (typeof global.escapeHtml === 'function') return global.escapeHtml(value);
    return text(value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  function render(query) {
    if (!state.open) return;
    const groups = buildGroups(query);
    const results = state.modal.querySelector('#search-results');
    if (!results) return;

    state.items = [];
    state.active = -1;

    if (!groups.length) {
      const trimmed = text(query).trim();
      results.innerHTML = `
        <div class="search-empty">
          <span class="search-empty-ico"><i data-lucide="${trimmed ? 'search-x' : 'search'}"></i></span>
          <p class="font-medium">${trimmed ? 'Tidak ada hasil' : 'Mulai mengetik'}</p>
          <p class="text-xs mt-1">${trimmed
            ? `Tidak ada task, workflow, node, aplikasi, atau anggota yang cocok dengan “${escapeHtml(trimmed)}”.`
            : 'Cari task, workflow, node, aplikasi, atau anggota.'}</p>
        </div>`;
      refreshIconsSafely();
      return;
    }

    let index = 0;
    let html = '';
    groups.forEach((group) => {
      html += `
        <div class="search-group">
          <div class="search-group-label">
            <i data-lucide="${group.icon}"></i>
            <span>${escapeHtml(group.label)}</span>
            <span class="search-group-count">${group.items.length}</span>
          </div>
          ${group.items.map((item) => {
            const i = index++;
            state.items.push(item);
            return `
              <button type="button" role="option" id="search-item-${i}" data-search-index="${i}"
                aria-selected="false" class="search-item">
                <span class="search-item-ico"><i data-lucide="${item.icon}"></i></span>
                <span class="search-item-body">
                  <span class="search-item-title">${escapeHtml(item.title)}</span>
                  ${item.subtitle ? `<span class="search-item-sub">${escapeHtml(item.subtitle)}</span>` : ''}
                </span>
                <span class="search-item-badge">${escapeHtml(item.badge || '')}</span>
              </button>`;
          }).join('')}
        </div>`;
    });

    results.innerHTML = html;
    refreshIconsSafely();

    results.querySelectorAll('[data-search-index]').forEach((btn) => {
      btn.addEventListener('mousemove', () => setActive(Number(btn.dataset.searchIndex), false));
      btn.addEventListener('click', () => {
        const item = state.items[Number(btn.dataset.searchIndex)];
        if (item) run(item);
      });
    });

    if (state.items.length) setActive(0, true);
  }

  function refreshIconsSafely() {
    try {
      if (typeof global.refreshIcons === 'function') global.refreshIcons();
    } catch (e) { /* ikon bukan hal kritis */ }
  }

  function setActive(index, scroll) {
    if (index < 0 || index >= state.items.length) return;
    const results = state.modal && state.modal.querySelector('#search-results');
    if (!results) return;
    state.active = index;
    results.querySelectorAll('[data-search-index]').forEach((btn) => {
      const isActive = Number(btn.dataset.searchIndex) === index;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    const input = state.input;
    if (input) input.setAttribute('aria-activedescendant', 'search-item-' + index);
    if (scroll) {
      const el = results.querySelector('#search-item-' + index);
      if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
    }
  }

  function moveActive(step) {
    if (!state.items.length) return;
    const next = (state.active + step + state.items.length) % state.items.length;
    setActive(next, true);
  }

  /* ---------------------------------------------------------- */
  /* Actions                                                    */
  /* ---------------------------------------------------------- */

  function flashElement(el) {
    if (!el || !el.classList) return;
    el.classList.add('search-flash');
    setTimeout(() => { try { el.classList.remove('search-flash'); } catch (e) {} }, 1800);
  }

  function revealLater(find, triesLeft) {
    const el = find();
    if (el) {
      if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      flashElement(el);
      return;
    }
    if (triesLeft > 0) setTimeout(() => revealLater(find, triesLeft - 1), 120);
  }

  function revealSelector(selector) {
    revealLater(() => {
      try { return document.querySelector(selector); } catch (e) { return null; }
    }, 25);
  }

  function revealCanvasNode(customId) {
    const target = text(customId);
    revealLater(() => {
      const editor = global.State && State.editor;
      const data = editor && editor.drawflow && editor.drawflow.drawflow
        && editor.drawflow.drawflow.Home && editor.drawflow.drawflow.Home.data;
      if (!data) return null;
      const key = Object.keys(data).find((k) => text(data[k].custom_id) === target);
      return key ? document.getElementById('node-' + key) : null;
    }, 30);
  }

  function attrValue(id) {
    return text(id).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function run(item) {
    if (!item) return;
    close();
    try {
      if (item.type === 'nav') {
        setView({ kind: item.id });
        return;
      }
      if (item.type === 'task') {
        global.openTaskDrawer(item.id);
        return;
      }
      if (item.type === 'workflow') {
        setView({ kind: 'canvas', workflowId: item.id, workflowName: item.title });
        return;
      }
      if (item.type === 'node') {
        setView({ kind: 'canvas', workflowId: item.workflowId, workflowName: item.workflowName });
        revealCanvasNode(item.id);
        return;
      }
      if (item.type === 'app') {
        setView({ kind: 'applications' });
        revealSelector('[data-app-card="' + attrValue(item.id) + '"]');
        return;
      }
      if (item.type === 'member') {
        setView({ kind: 'team' });
        revealSelector('[data-member-id="' + attrValue(item.id) + '"]');
      }
    } catch (err) {
      console.error('[FlowSpace] aksi pencarian gagal', err);
      if (typeof global.toast === 'function') global.toast('Tidak bisa membuka hasil', 'error');
    }
  }

  /* ---------------------------------------------------------- */
  /* Open / close                                               */
  /* ---------------------------------------------------------- */

  function open(initialQuery) {
    if (state.open) {
      if (state.input) state.input.focus();
      return;
    }
    state.open = true;
    state.previousFocus = document.activeElement;

    const modal = document.createElement('div');
    modal.id = 'search-palette';
    modal.className = 'search-backdrop';
    modal.innerHTML = `
      <div class="search-panel" role="dialog" aria-modal="true" aria-labelledby="search-palette-title">
        <h2 id="search-palette-title" class="sr-only">Pencarian FlowSpace</h2>
        <div class="search-input-row">
          <i data-lucide="search" class="search-input-ico"></i>
          <input id="search-palette-input" type="text" autocomplete="off" spellcheck="false"
            class="search-input" placeholder="Cari task, workflow, node, aplikasi, anggota…"
            role="combobox" aria-expanded="true" aria-controls="search-results" aria-autocomplete="list"
            aria-label="Cari di FlowSpace">
          <kbd class="search-kbd">Esc</kbd>
        </div>
        <div id="search-results" class="search-results" role="listbox" aria-label="Hasil pencarian"></div>
        <div class="search-foot">
          <span><kbd class="search-kbd">↑</kbd><kbd class="search-kbd">↓</kbd> pilih</span>
          <span><kbd class="search-kbd">↵</kbd> buka</span>
          <span class="ml-auto hidden sm:inline">Tidak ada read Firestore tambahan</span>
        </div>
      </div>`;

    document.body.appendChild(modal);
    state.modal = modal;
    state.input = modal.querySelector('#search-palette-input');
    refreshIconsSafely();

    modal.addEventListener('mousedown', (e) => {
      if (e.target === modal) close();
    });
    modal.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); moveActive(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); moveActive(-1); return; }
      if (e.key === 'Enter') {
        const item = state.items[state.active];
        if (item) { e.preventDefault(); run(item); }
      }
    });
    if (state.input) {
      state.input.addEventListener('input', () => render(state.input.value));
      state.input.value = text(initialQuery);
      state.input.focus();
      const caret = state.input.value.length;
      try { state.input.setSelectionRange(caret, caret); } catch (e) {}
    }

    render(text(initialQuery));
  }

  function close() {
    if (!state.open) return;
    state.open = false;
    const modal = state.modal;
    state.modal = null;
    state.input = null;
    state.items = [];
    state.active = -1;
    if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
    const back = state.previousFocus;
    state.previousFocus = null;
    if (back && typeof back.focus === 'function' && document.body.contains(back)) {
      try { back.focus(); } catch (e) {}
    }
  }

  /* ---------------------------------------------------------- */
  /* Wiring                                                     */
  /* ---------------------------------------------------------- */

  function wire() {
    // Kotak pencarian di header cuma pemicu; hasilnya di palette.
    const headerInput = document.getElementById('search-input');
    if (headerInput) {
      headerInput.setAttribute('readonly', 'readonly');
      headerInput.setAttribute('aria-keyshortcuts', 'Control+K Meta+K');
      headerInput.addEventListener('focus', () => {
        headerInput.blur();
        open('');
      });
      headerInput.addEventListener('click', () => open(''));
    }

    const mobileBtn = document.getElementById('search-mobile-btn');
    if (mobileBtn) {
      mobileBtn.addEventListener('click', () => open(''));
      mobileBtn.setAttribute('aria-keyshortcuts', 'Control+K Meta+K');
    }

    document.addEventListener('keydown', (e) => {
      const key = text(e.key).toLowerCase();
      if (key === 'k' && (e.ctrlKey || e.metaKey) && !e.altKey) {
        e.preventDefault();
        if (state.open) close(); else open('');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }

  global.FlowSearch = {
    open: open,
    close: close,
    isOpen: () => state.open,
    // Untuk pengujian: hasil yang akan ditampilkan tanpa harus render.
    resultsFor: (query) => buildGroups(query),
  };
})(window);
