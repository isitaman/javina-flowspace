/* ============================================================
 * FlowSpace - ui.js
 * Semua view renderer (port dari Index.html + fitur yang dilengkapi).
 * ============================================================ */

/* Apakah aplikasi berjalan dengan login + sinkronisasi Firebase? */
function isFirebaseLive() {
  return !!(window.FlowFirebase && FlowFirebase.enabled);
}

/* ============================================================
 * Dashboard View
 * ============================================================ */

const DASHBOARD_TAB_KEY = 'flowspace.dashboardTab';

function dashboardTab() {
  try {
    return localStorage.getItem(DASHBOARD_TAB_KEY) === 'me' ? 'me' : 'team';
  } catch (e) { return 'team'; }
}

function setDashboardTab(tab) {
  try { localStorage.setItem(DASHBOARD_TAB_KEY, tab === 'me' ? 'me' : 'team'); } catch (e) {}
}

function activityActionLabel(action) {
  const map = {
    create: 'Dibuat', update: 'Diperbarui', delete: 'Dihapus',
    status_change: 'Status', progress_update: 'Progress', priority_change: 'Priority',
    assignee_change: 'PIC', due_date_change: 'Tenggat', canvas_save: 'Kanvas',
    claim: 'Diambil', link_application: 'Aplikasi', unlink_application: 'Aplikasi',
    link_node: 'Node', unlink_node: 'Node', archive: 'Arsip', duplicate: 'Duplikat',
  };
  return map[action] || action;
}

function activityEntityLabel(type) {
  const map = {
    task: 'Task', workflow: 'Workflow', application: 'Aplikasi',
    applicationCategory: 'Kategori', node: 'Node', edge: 'Koneksi',
  };
  return map[type] || (type || 'item');
}

function dashboardActivityHtml(d, memberMap) {
  const list = d.recentActivity || [];
  return `
    <div class="bg-card border border-line rounded-xl">
      <div class="px-4 py-3 border-b border-line">
        <h3 class="text-sm font-medium flex items-center gap-2">
          <i data-lucide="history" class="h-4 w-4 text-fern"></i>
          ${d.scope === 'me' ? 'Aktivitas Saya' : 'Aktivitas Terbaru'}
        </h3>
      </div>
      ${list.length === 0 ? `<div class="px-6 py-6 text-center text-sm text-inksoft">Belum ada aktivitas.</div>` : `
        <div class="divide-y border-t border-line">
          ${list.map(a => `
            <div class="flex items-center gap-3 px-4 py-2.5">
              <span class="badge badge-todo shrink-0">${escapeHtml(activityActionLabel(a.action))}</span>
              <div class="flex-1 min-w-0">
                <p class="text-xs truncate">${escapeHtml(activityEntityLabel(a.entityType))} <span class="text-inksoft">${escapeHtml(a.entityTitle || a.entityId || '')}</span></p>
                <p class="text-[10px] text-inksoft truncate">${escapeHtml(memberMap[a.actorEmail] || a.actorEmail || '')} · ${formatDateTime(a.createdAt)}</p>
              </div>
            </div>
          `).join('')}
        </div>
      `}
    </div>
  `;
}

function dashboardTaskRow(t, memberMap, showPic) {
  const memberName = (t.assigneeEmail && memberMap[t.assigneeEmail]) || t.assigneeEmail || 'Unassigned';
  const initials = memberName.split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();
  const overdue = isOverdue(t.dueDate, t.status === 'done' ? 'done' : 'active');
  return `
    <button class="task-row-${escapeHtml(t.id)} flex items-center gap-3 w-full px-4 py-3 hover:bg-paper text-left" data-task-id="${escapeHtml(t.id)}">
      <span class="priority-dot ${escapeHtml(t.priority)}"></span>
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium truncate">${escapeHtml(t.title)}</p>
        <p class="text-xs text-inksoft truncate">${t.workflow && t.workflow.name ? escapeHtml(t.workflow.name) : 'Tanpa workflow'}${t.status ? ' · ' + escapeHtml(STATUS_LABEL[t.status] || t.status) : ''}</p>
      </div>
      ${showPic ? `<span class="badge badge-${escapeHtml(t.priority)}">${escapeHtml(PRIORITY_LABEL[t.priority])}</span>` : ''}
      <span class="text-xs ${overdue ? 'text-berry font-medium' : 'text-inksoft'} flex items-center gap-1">
        <i data-lucide="${overdue ? 'alert-circle' : 'clock'}" class="h-3 w-3"></i>
        ${formatDate(t.dueDate)}
      </span>
      ${showPic ? `<span class="h-7 w-7 rounded-full bg-fernlight/15 text-ferndeep flex items-center justify-center text-[10px] font-semibold">${initials}</span>` : ''}
    </button>
  `;
}

function dashboardWorkflowRow(w) {
  const isReal = w.isWorkflow !== false && !!w.id;
  const inner = `
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-1.5">
        <p class="text-sm font-medium truncate">${escapeHtml(w.name || 'Tanpa workflow')}</p>
        ${w.archived ? '<span class="badge badge-todo shrink-0">Arsip</span>' : ''}
        ${!isReal ? '<span class="badge badge-todo shrink-0">Mandiri</span>' : ''}
      </div>
      <div class="flex items-center gap-2 mt-1">
        <div class="flex-1 bg-line rounded-full h-1.5"><div class="bg-fern h-1.5 rounded-full" style="width:${w.progress}%"></div></div>
        <span class="text-[10px] text-inksoft">${w.done}/${w.total} done</span>
      </div>
    </div>
    <span class="text-xs font-semibold text-fern">${w.progress}%</span>
  `;
  return isReal
    ? `<button class="workflow-row-${escapeHtml(w.id)} flex items-center gap-3 w-full px-4 py-3 hover:bg-paper text-left" data-workflow-id="${escapeHtml(w.id)}" data-workflow-name="${escapeHtml(w.name)}">${inner}</button>`
    : `<div class="flex items-center gap-3 w-full px-4 py-3">${inner}</div>`;
}

function dashboardStatusBars(counts, total) {
  const rows = [
    { id: 'backlog', label: 'Backlog' },
    { id: 'todo', label: 'To Do' },
    { id: 'in_progress', label: 'In Progress' },
    { id: 'review', label: 'Review' },
    { id: 'done', label: 'Done' },
  ];
  return rows.map(r => {
    const value = (counts && counts[r.id]) || 0;
    const pct = total > 0 ? Math.round((value / total) * 100) : 0;
    return `
      <div class="flex items-center gap-3">
        <span class="text-xs text-inksoft w-20 shrink-0">${r.label}</span>
        <div class="flex-1 bg-line rounded-full h-1.5"><div class="bg-fern h-1.5 rounded-full" style="width:${pct}%"></div></div>
        <span class="text-xs tabular-nums text-ink w-10 text-right">${value}</span>
      </div>
    `;
  }).join('');
}

async function renderDashboard(container) {
  container.className = 'h-full w-full overflow-auto p-6 space-y-6';
  const tab = dashboardTab();
  container.innerHTML = `
    <div class="flex items-start justify-between gap-4 flex-wrap">
      <div>
        <h1 class="font-display text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p class="text-sm text-inksoft mt-1">${tab === 'team'
          ? 'Ringkasan seluruh workspace — semua anggota melihat angka yang sama.'
          : 'Ringkasan task yang menjadi tanggung jawab Anda.'}</p>
      </div>
      <div class="inline-flex rounded-lg border border-line bg-card p-0.5" role="tablist" aria-label="Pilih dashboard">
        <button data-dash-tab="team" class="px-3 py-1.5 rounded-md text-xs font-medium ${tab === 'team' ? 'bg-ink text-paper' : 'text-inksoft hover:text-ink'}">Dashboard Tim</button>
        <button data-dash-tab="me" class="px-3 py-1.5 rounded-md text-xs font-medium ${tab === 'me' ? 'bg-ink text-paper' : 'text-inksoft hover:text-ink'}">Dashboard Saya</button>
      </div>
    </div>
    <div id="dash-body" class="space-y-6"></div>
  `;
  $$('[data-dash-tab]', container).forEach(btn => btn.addEventListener('click', () => {
    if (btn.dataset.dashTab === dashboardTab()) return;
    setDashboardTab(btn.dataset.dashTab);
    renderDashboard(container);
  }));
  const panel = $('#dash-body', container);
  if (tab === 'me') await renderMyDashboard(panel);
  else await renderTeamDashboard(panel);
}

async function renderMyDashboard(panel) {
  panel.innerHTML = `<div class="flex items-center gap-2 text-inksoft"><div class="spinner spinner-dark"></div>Memuat dashboard...</div>`;
  const res = await callServer('getDashboardData', { scope: 'me' });
  if (!res.success) {
    panel.innerHTML = `<div class="text-berry p-4">${escapeHtml(res.message || 'Gagal memuat')}</div>`;
    return;
  }
  const d = res.data;
  const memberMap = {};
  if (State.init && State.init.members) State.init.members.forEach(m => memberMap[m.email] = m.displayName);
  const activeCount = Math.max(0, d.total - d.done);
  const myEmail = (State.init && State.init.currentUser && State.init.currentUser.email) || '';

  if (d.total === 0) {
    panel.innerHTML = `
      <div class="bg-card border border-line rounded-xl">
        <div class="empty-state">
          <div class="empty-icon"><i data-lucide="inbox" class="h-6 w-6 text-inksoft/50"></i></div>
          <h3 class="text-lg font-medium mb-1">Belum ada task untuk Anda</h3>
          <p class="text-sm text-inksoft mb-4">Task yang PIC-nya Anda akan muncul di sini, termasuk yang diambil dari Kanban.</p>
          <div class="flex items-center justify-center gap-2">
            <button id="dash-my-new" class="btn btn-primary btn-sm"><i data-lucide="plus" class="h-3.5 w-3.5"></i>Buat task untuk saya</button>
            <button id="dash-my-kanban" class="btn btn-secondary btn-sm">Buka Kanban</button>
          </div>
        </div>
      </div>`;
    refreshIcons();
    $('#dash-my-new').addEventListener('click', () => showTaskDialog({}));
    $('#dash-my-kanban').addEventListener('click', () => {
      State.kanbanFilters = State.kanbanFilters || {};
      State.kanbanFilters.assigneeEmail = myEmail;
      setView({ kind: 'kanban' });
    });
    return;
  }

  const kpis = [
    { label: 'Tugas Aktif', value: activeCount, icon: 'circle-dashed', color: 'bg-sage/20 text-ferndeep' },
    { label: 'Selesai', value: d.done, icon: 'check-circle-2', color: 'bg-fernlight/15 text-ferndeep' },
    { label: 'Overdue', value: d.overdue, icon: 'alert-triangle', color: 'bg-berry/10 text-berry' },
    { label: 'Jatuh Tempo ≤7 Hari', value: d.dueSoon, icon: 'calendar-clock', color: 'bg-clay/10 text-clay' },
  ];

  panel.innerHTML = `
    <div class="stat-strip">
      ${kpis.map(s => `
        <div class="p-4">
          <div class="flex items-center justify-between">
            <div>
              <p class="label-mono">${s.label}</p>
              <p class="font-display text-3xl font-semibold mt-1 tnum">${s.value}</p>
            </div>
            <div class="h-10 w-10 rounded-xl flex items-center justify-center ${s.color}">
              <i data-lucide="${s.icon}" class="h-5 w-5"></i>
            </div>
          </div>
        </div>
      `).join('')}
    </div>

    <div class="flex items-center gap-2 flex-wrap">
      <button id="dash-my-new" class="btn btn-primary btn-sm"><i data-lucide="plus" class="h-3.5 w-3.5"></i>Buat task untuk saya</button>
      <button id="dash-my-kanban" class="btn btn-secondary btn-sm"><i data-lucide="square-kanban" class="h-3.5 w-3.5"></i>Kanban saya</button>
      <span class="text-xs text-inksoft ml-auto">Rata-rata progress Anda: <span class="font-medium text-ink">${d.avgProgress}%</span></span>
    </div>

    <div class="bg-card border border-line rounded-xl">
      <div class="px-4 py-3 border-b border-line flex items-center justify-between gap-3">
        <h3 class="text-sm font-medium flex items-center gap-2">
          <i data-lucide="target" class="h-4 w-4 text-clay"></i>
          Fokus Saya
          <span class="text-xs font-normal text-inksoft">(${d.focus.length})</span>
        </h3>
        ${d.focus.length > 8 ? '<button id="focus-toggle" class="text-xs font-medium text-fern hover:text-ferndeep shrink-0" data-open="0">Lihat semua</button>' : ''}
      </div>
      ${d.focus.length === 0 ? `<div class="px-6 py-8 text-center text-sm text-inksoft">Tidak ada tenggat dalam 7 hari ke depan. Kerja bagus!</div>` : `
        <div class="divide-y border-t border-line">
          ${d.focus.map((t, idx) => `
            <button class="task-row-${escapeHtml(t.id)} flex items-center gap-3 w-full px-4 py-3 hover:bg-paper text-left ${idx >= 8 ? 'hidden focus-extra' : ''}" data-task-id="${escapeHtml(t.id)}">
              <span class="priority-dot ${escapeHtml(t.priority)}"></span>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium truncate">${escapeHtml(t.title)}</p>
                <p class="text-xs text-inksoft truncate">${t.workflow && t.workflow.name ? escapeHtml(t.workflow.name) : 'Tanpa workflow'} · ${escapeHtml(STATUS_LABEL[t.status] || t.status)}</p>
              </div>
              <span class="text-xs ${t.overdue ? 'text-berry font-medium' : 'text-inksoft'} flex items-center gap-1">
                <i data-lucide="${t.overdue ? 'alert-circle' : 'clock'}" class="h-3 w-3"></i>
                ${formatDate(t.dueDate)}
              </span>
            </button>
          `).join('')}
        </div>
      `}
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div class="bg-card border border-line rounded-xl p-4">
        <h3 class="text-sm font-medium mb-3">Distribusi Status</h3>
        <div class="space-y-2.5">${dashboardStatusBars(d.statusCounts, d.total)}</div>
      </div>
      <div class="bg-card border border-line rounded-xl">
        <div class="px-4 py-3 border-b border-line">
          <h3 class="text-sm font-medium flex items-center gap-2">
            <i data-lucide="workflow" class="h-4 w-4 text-fern"></i>
            Workflow yang Saya Kerjakan
          </h3>
        </div>
        ${d.byWorkflow.length === 0 ? `<div class="px-6 py-8 text-center text-sm text-inksoft">Belum ada workflow.</div>` : `
          <div class="divide-y border-t border-line">
            ${d.byWorkflow.map(w => dashboardWorkflowRow(w)).join('')}
          </div>
        `}
      </div>
    </div>

    ${dashboardActivityHtml(d, memberMap)}
  `;
  refreshIcons();

  const focusToggle = $('#focus-toggle', panel);
  if (focusToggle) {
    focusToggle.addEventListener('click', () => {
      const open = focusToggle.dataset.open === '1';
      $$('.focus-extra', panel).forEach(row => row.classList.toggle('hidden', open));
      focusToggle.dataset.open = open ? '0' : '1';
      focusToggle.textContent = open ? 'Lihat semua' : 'Ringkas';
    });
  }
  $$('[class*="task-row-"]', panel).forEach(btn => btn.addEventListener('click', () => openTaskDrawer(btn.dataset.taskId)));
  $$('[class*="workflow-row-"]', panel).forEach(btn => btn.addEventListener('click', () => {
    setView({ kind: 'canvas', workflowId: btn.dataset.workflowId, workflowName: btn.dataset.workflowName });
  }));
  $('#dash-my-new').addEventListener('click', () => showTaskDialog({}));
  $('#dash-my-kanban').addEventListener('click', () => {
    State.kanbanFilters = State.kanbanFilters || {};
    State.kanbanFilters.assigneeEmail = myEmail;
    setView({ kind: 'kanban' });
  });
}

async function renderTeamDashboard(panel) {
  panel.innerHTML = `<div class="flex items-center gap-2 text-inksoft"><div class="spinner spinner-dark"></div>Memuat dashboard...</div>`;
  const res = await callServer('getDashboardData', { scope: 'team' });
  if (!res.success) {
    panel.innerHTML = `<div class="text-berry p-4">${escapeHtml(res.message || 'Gagal memuat')}</div>`;
    return;
  }
  const d = res.data;
  const memberMap = {};
  if (State.init && State.init.members) State.init.members.forEach(m => memberMap[m.email] = m.displayName);

  const stats = [
    { label: 'Total Task', value: d.total, icon: 'list-todo', color: 'bg-paper text-ink' },
    { label: 'Selesai', value: d.done, icon: 'check-circle-2', color: 'bg-fernlight/15 text-ferndeep' },
    { label: 'Sedang Dikerjakan', value: d.inProgress, icon: 'circle-dashed', color: 'bg-sage/20 text-ferndeep' },
    { label: 'Overdue', value: d.overdue, icon: 'alert-triangle', color: 'bg-berry/10 text-berry' },
  ];

  const priorityStats = [
    { label: 'Critical', value: d.priority.critical, dot: 'bg-berry' },
    { label: 'High', value: d.priority.high, dot: 'bg-clay' },
    { label: 'Medium', value: d.priority.medium, dot: 'bg-amber' },
    { label: 'Low', value: d.priority.low, dot: 'bg-sage' },
  ];

  panel.innerHTML = `
    <div class="stat-strip">
      ${stats.map(s => `
        <div class="p-4">
          <div class="flex items-center justify-between">
            <div>
              <p class="label-mono">${s.label}</p>
              <p class="font-display text-3xl font-semibold mt-1 tnum">${s.value}</p>
            </div>
            <div class="h-10 w-10 rounded-xl flex items-center justify-center ${s.color}">
              <i data-lucide="${s.icon}" class="h-5 w-5"></i>
            </div>
          </div>
        </div>
      `).join('')}
    </div>

    <div class="stat-strip">
      ${[
        { label: 'To Do', value: d.statusCounts ? d.statusCounts.todo : d.todo, icon: 'circle-dashed' },
        { label: 'Review', value: d.statusCounts ? d.statusCounts.review : d.review, icon: 'eye' },
        { label: 'Backlog', value: d.statusCounts ? d.statusCounts.backlog : d.backlog, icon: 'archive' },
        { label: 'Tanpa PIC', value: d.unassigned || 0, icon: 'user-x' },
      ].map(s => `
        <div class="p-4">
          <div class="flex items-center justify-between">
            <div>
              <p class="label-mono">${s.label}</p>
              <p class="font-display text-2xl font-semibold mt-1 tnum">${s.value}</p>
            </div>
            <div class="h-8 w-8 rounded-lg flex items-center justify-center bg-paper text-inksoft">
              <i data-lucide="${s.icon}" class="h-4 w-4"></i>
            </div>
          </div>
        </div>
      `).join('')}
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div class="bg-card border border-line rounded-xl p-4">
        <h3 class="text-sm font-medium flex items-center gap-2 mb-3">
          <i data-lucide="trending-up" class="h-4 w-4 text-fern"></i>
          Rata-rata Progress
        </h3>
        <div class="flex items-end gap-2 mb-2">
          <span class="font-display text-3xl font-semibold tnum">${d.avgProgress}%</span>
          <span class="text-xs text-inksoft pb-1">dari ${d.total} task</span>
        </div>
        <div class="w-full bg-line rounded-full h-2"><div class="bg-fern h-2 rounded-full transition-all" style="width:${d.avgProgress}%"></div></div>
      </div>
      <div class="bg-card border border-line rounded-xl p-4 lg:col-span-2">
        <h3 class="text-sm font-medium mb-3">Distribusi Priority</h3>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          ${priorityStats.map(p => `
            <div class="flex flex-col items-center justify-center p-3 rounded-xl bg-paper">
              <div class="flex items-center gap-1.5 mb-1">
                <span class="inline-block h-2 w-2 rounded-full ${p.dot}"></span>
                <span class="text-xs text-inksoft">${p.label}</span>
              </div>
              <span class="font-display text-2xl font-semibold tnum">${p.value}</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>

    <div class="bg-card border border-line rounded-xl">
      <div class="px-4 py-3 border-b border-line flex items-center justify-between gap-3">
        <h3 class="text-sm font-medium flex items-center gap-2">
          <i data-lucide="alert-triangle" class="h-4 w-4 text-clay"></i>
          Task Critical/High yang belum selesai
          <span class="text-xs font-normal text-inksoft">(${d.criticalHigh.length})</span>
        </h3>
        ${d.criticalHigh.length > 8 ? `
          <button id="ch-toggle" class="text-xs font-medium text-fern hover:text-ferndeep shrink-0" data-open="0">Lihat semua</button>
        ` : ''}
      </div>
      ${d.criticalHigh.length === 0 ? `
        <div class="px-6 py-8 text-center text-sm text-inksoft">Tidak ada task critical/high yang tertunda.</div>
      ` : `
        <div class="divide-y border-t border-line">
          ${d.criticalHigh.map((t, idx) => {
            const memberName = (t.assigneeEmail && memberMap[t.assigneeEmail]) || t.assigneeEmail || 'Unassigned';
            const initials = memberName.split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();
            const overdue = isOverdue(t.dueDate, 'active');
            return `
              <button class="task-row-${escapeHtml(t.id)} flex items-center gap-3 w-full px-4 py-3 hover:bg-paper text-left ${idx >= 8 ? 'hidden ch-extra' : ''}" data-task-id="${escapeHtml(t.id)}">
                <span class="priority-dot ${escapeHtml(t.priority)}"></span>
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium truncate">${escapeHtml(t.title)}</p>
                  <p class="text-xs text-inksoft truncate">${t.workflow && t.workflow.name ? escapeHtml(t.workflow.name) : 'Tanpa workflow'}</p>
                </div>
                <span class="badge badge-${escapeHtml(t.priority)}">${escapeHtml(PRIORITY_LABEL[t.priority])}</span>
                <span class="text-xs ${overdue ? 'text-berry font-medium' : 'text-inksoft'} flex items-center gap-1">
                  <i data-lucide="${overdue ? 'alert-circle' : 'clock'}" class="h-3 w-3"></i>
                  ${formatDate(t.dueDate)}
                </span>
                <span class="h-7 w-7 rounded-full bg-fernlight/15 text-ferndeep flex items-center justify-center text-[10px] font-semibold">${initials}</span>
              </button>
            `;
          }).join('')}
        </div>
      `}
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div class="bg-card border border-line rounded-xl">
        <div class="px-4 py-3 border-b border-line">
          <h3 class="text-sm font-medium flex items-center gap-2">
            <i data-lucide="users" class="h-4 w-4 text-fern"></i>
            Ringkasan per PIC
          </h3>
        </div>
        ${d.byPic.length === 0 ? `<div class="px-6 py-8 text-center text-sm text-inksoft">Belum ada PIC.</div>` : `
          <div class="divide-y border-t border-line">
            ${d.byPic.slice(0, 6).map(p => {
              const name = memberMap[p.email] || p.email;
              const completion = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
              const initials = name.split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();
              return `
                <div class="flex items-center gap-3 px-4 py-3">
                  <span class="h-8 w-8 rounded-full bg-fernlight/15 text-ferndeep flex items-center justify-center text-xs font-semibold">${initials}</span>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium truncate">${escapeHtml(name)}</p>
                    <div class="flex items-center gap-2 mt-1">
                      <div class="flex-1 bg-line rounded-full h-1.5"><div class="bg-fern h-1.5 rounded-full" style="width:${completion}%"></div></div>
                      <span class="text-[10px] text-inksoft">${p.done}/${p.total}</span>
                    </div>
                  </div>
                  ${p.overdue > 0 ? `<span class="text-[10px] text-berry font-medium bg-berry/10 px-1.5 py-0.5 rounded">${p.overdue} overdue</span>` : ''}
                </div>
              `;
            }).join('')}
          </div>
        `}
      </div>

      <div class="bg-card border border-line rounded-xl">
        <div class="px-4 py-3 border-b border-line">
          <h3 class="text-sm font-medium flex items-center gap-2">
            <i data-lucide="workflow" class="h-4 w-4 text-fern"></i>
            Progress per Workflow
          </h3>
        </div>
        ${d.byWorkflow.length === 0 ? `<div class="px-6 py-8 text-center text-sm text-inksoft">Belum ada workflow.</div>` : `
          <div class="divide-y border-t border-line">
            ${d.byWorkflow.map(w => {
              const isReal = w.isWorkflow !== false && !!w.id;
              const inner = `
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-1.5">
                    <p class="text-sm font-medium truncate">${escapeHtml(w.name || 'Tanpa workflow')}</p>
                    ${w.archived ? '<span class="badge badge-todo shrink-0">Arsip</span>' : ''}
                    ${!isReal ? '<span class="badge badge-todo shrink-0">Mandiri</span>' : ''}
                  </div>
                  <div class="flex items-center gap-2 mt-1">
                    <div class="flex-1 bg-line rounded-full h-1.5"><div class="bg-fern h-1.5 rounded-full" style="width:${w.progress}%"></div></div>
                    <span class="text-[10px] text-inksoft">${w.done}/${w.total} done</span>
                  </div>
                </div>
                <span class="text-xs font-semibold text-fern">${w.progress}%</span>
              `;
              // Task tanpa workflow tidak punya kanvas: render sebagai baris biasa.
              return isReal
                ? `<button class="workflow-row-${escapeHtml(w.id)} flex items-center gap-3 w-full px-4 py-3 hover:bg-paper text-left" data-workflow-id="${escapeHtml(w.id)}" data-workflow-name="${escapeHtml(w.name)}">${inner}</button>`
                : `<div class="flex items-center gap-3 w-full px-4 py-3" title="Task ini tidak terhubung ke workflow mana pun">${inner}</div>`;
            }).join('')}
          </div>
        `}
      </div>
    </div>

    ${dashboardActivityHtml(d, memberMap)}
  `;
  refreshIcons();
  const chToggle = $('#ch-toggle', panel);
  if (chToggle) {
    chToggle.addEventListener('click', () => {
      const open = chToggle.dataset.open === '1';
      $$('.ch-extra', panel).forEach(row => row.classList.toggle('hidden', open));
      chToggle.dataset.open = open ? '0' : '1';
      chToggle.textContent = open ? 'Lihat semua' : 'Ringkas';
    });
  }
  $$('[class*="task-row-"]', panel).forEach(btn => btn.addEventListener('click', () => openTaskDrawer(btn.dataset.taskId)));
  $$('[class*="workflow-row-"]', panel).forEach(btn => btn.addEventListener('click', () => {
    setView({ kind: 'canvas', workflowId: btn.dataset.workflowId, workflowName: btn.dataset.workflowName });
  }));
}

/* ============================================================
 * Workflows View
 * ============================================================ */

function wfDeptBadges(departments) {
  const list = Array.isArray(departments) ? departments.filter(Boolean) : [];
  if (list.length === 0) return '';
  const shown = list.slice(0, 2);
  const extra = list.length - shown.length;
  return shown.map(d => `<span class="badge badge-dept">${escapeHtml(d)}</span>`).join('')
    + (extra > 0 ? `<span class="badge badge-dept" title="${escapeHtml(list.join(', '))}">+${extra}</span>` : '');
}

let workflowCache = [];

async function renderWorkflows(container) {
  container.className = 'h-full w-full overflow-auto p-5';
  if (!State.workflowFilters || typeof State.workflowFilters !== 'object') {
    State.workflowFilters = { q: '', dept: '', category: '' };
  }
  const f = State.workflowFilters;
  container.innerHTML = `
    <div class="flex items-start justify-between gap-3 mb-4 flex-wrap">
      <div>
        <h1 class="font-display text-2xl font-semibold tracking-tight">Workflows</h1>
        <p class="text-sm text-inksoft mt-0.5">Kelola alur kerja tim, departemen terkait, dan kategori.</p>
      </div>
      <button id="new-wf-btn" class="btn btn-primary btn-sm"><i data-lucide="plus" class="h-4 w-4"></i>Buat Workflow</button>
    </div>

    <div class="bg-card border border-line rounded-xl px-2 py-2 mb-3 flex flex-wrap items-center gap-2">
      <div class="relative flex-1 min-w-[200px]">
        <i data-lucide="search" class="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-inksoft/60 pointer-events-none"></i>
        <input id="wf-search" type="text" class="form-input h-9 pl-8 text-sm" placeholder="Cari nama, deskripsi, kategori, departemen..." value="${escapeHtml(f.q)}">
      </div>
      <select id="wf-filter-dept" class="form-select h-9 text-xs w-auto min-w-[150px]">
        <option value="">Semua departemen</option>
      </select>
      <select id="wf-filter-cat" class="form-select h-9 text-xs w-auto min-w-[130px]">
        <option value="">Semua kategori</option>
      </select>
      <button id="wf-filter-reset" class="btn btn-ghost btn-sm text-xs"><i data-lucide="rotate-ccw" class="h-3 w-3"></i>Reset</button>
      <span id="wf-count" class="text-[11px] text-inksoft tabular-nums ml-auto"></span>
    </div>

    <div id="wf-list"></div>
  `;
  refreshIcons();

  $('#new-wf-btn').addEventListener('click', () => showWorkflowDialog());

  $('#wf-search').addEventListener('input', (e) => {
    State.workflowFilters.q = e.target.value;
    renderWorkflowRows();
  });
  $('#wf-filter-dept').addEventListener('change', (e) => {
    State.workflowFilters.dept = e.target.value;
    renderWorkflowRows();
  });
  $('#wf-filter-cat').addEventListener('change', (e) => {
    State.workflowFilters.category = e.target.value;
    renderWorkflowRows();
  });
  $('#wf-filter-reset').addEventListener('click', () => {
    State.workflowFilters = { q: '', dept: '', category: '' };
    renderWorkflows(container);
  });

  await loadWorkflowsList();
}

async function loadWorkflowsList() {
  const list = $('#wf-list');
  if (!list) return;
  const res = await callServer('listWorkflows');
  workflowCache = (res.success && Array.isArray(res.data)) ? res.data : [];
  renderWorkflowFilterOptions();
  renderWorkflowRows();
}

function renderWorkflowFilterOptions() {
  const deptSel = $('#wf-filter-dept');
  const catSel = $('#wf-filter-cat');
  if (!deptSel || !catSel) return;
  const depts = [];
  const cats = [];
  workflowCache.forEach((w) => {
    (w.departments || []).forEach((d) => { if (!depts.includes(d)) depts.push(d); });
    const c = String(w.category || '').trim();
    if (c && !cats.some((x) => x.toLowerCase() === c.toLowerCase())) cats.push(c);
  });
  depts.sort((a, b) => a.localeCompare(b));
  cats.sort((a, b) => a.localeCompare(b));

  const f = State.workflowFilters;
  if (f.dept && !depts.includes(f.dept)) f.dept = '';
  if (f.category && !cats.some((c) => c.toLowerCase() === f.category.toLowerCase())) f.category = '';

  deptSel.innerHTML = '<option value="">Semua departemen</option>' + depts.map((d) =>
    `<option value="${escapeHtml(d)}" ${d === f.dept ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('');
  catSel.innerHTML = '<option value="">Semua kategori</option>' + cats.map((c) =>
    `<option value="${escapeHtml(c)}" ${c.toLowerCase() === String(f.category).toLowerCase() ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
}

function renderWorkflowRows() {
  const list = $('#wf-list');
  if (!list) return;
  const f = State.workflowFilters;
  const q = String(f.q || '').trim().toLowerCase();

  const rows = workflowCache.filter((w) => {
    if (f.dept && !(w.departments || []).includes(f.dept)) return false;
    if (f.category && String(w.category || '').toLowerCase() !== String(f.category).toLowerCase()) return false;
    if (!q) return true;
    const hay = [w.name, w.description, w.category, (w.departments || []).join(' ')].join(' ').toLowerCase();
    return hay.includes(q);
  });

  const countEl = $('#wf-count');
  if (countEl) countEl.textContent = workflowCache.length === 0 ? '' : `${rows.length} dari ${workflowCache.length} workflow`;

  if (workflowCache.length === 0) {
    list.innerHTML = `
      <div class="bg-card border border-line rounded-xl">
        <div class="empty-state">
          <div class="empty-icon"><i data-lucide="workflow" class="h-6 w-6 text-inksoft/50"></i></div>
          <h3 class="text-lg font-medium mb-1">Belum ada workflow</h3>
          <p class="text-sm mb-4">Buat workflow pertama untuk mulai memetakan alur kerja tim.</p>
          <button class="btn btn-primary" id="empty-new-wf"><i data-lucide="plus" class="h-4 w-4"></i>Buat Workflow Pertamamu</button>
        </div>
      </div>
    `;
    const b = $('#empty-new-wf');
    if (b) b.addEventListener('click', () => showWorkflowDialog());
    refreshIcons();
    return;
  }

  if (rows.length === 0) {
    list.innerHTML = `
      <div class="bg-card border border-line rounded-xl px-6 py-10 text-center">
        <i data-lucide="search-x" class="h-6 w-6 text-inksoft/50 mx-auto mb-2"></i>
        <p class="text-sm font-medium mb-1">Tidak ada workflow yang cocok</p>
        <p class="text-xs text-inksoft mb-3">Coba kata kunci lain atau reset filter.</p>
        <button class="btn btn-secondary btn-sm" id="wf-empty-reset"><i data-lucide="rotate-ccw" class="h-3.5 w-3.5"></i>Reset filter</button>
      </div>
    `;
    const rb = $('#wf-empty-reset');
    if (rb) rb.addEventListener('click', () => {
      State.workflowFilters = { q: '', dept: '', category: '' };
      const search = $('#wf-search'); if (search) search.value = '';
      renderWorkflowFilterOptions();
      renderWorkflowRows();
    });
    refreshIcons();
    return;
  }

  list.innerHTML = `
    <div class="bg-card border border-line rounded-xl overflow-hidden">
      <div class="flex items-center gap-3 px-3 py-1.5 border-b border-line bg-paper/40 text-[10px] uppercase tracking-wider text-inksoft">
        <span class="flex-1 min-w-0">Workflow</span>
        <span class="hidden sm:block w-32 shrink-0">Progress</span>
        <span class="hidden md:block w-16 shrink-0">Task</span>
        <span class="hidden lg:block w-24 shrink-0">Diperbarui</span>
        <span class="w-14 shrink-0"></span>
      </div>
      <div class="divide-y divide-line">
        ${rows.map((w) => `
          <div class="flex items-center gap-3 px-3 py-2.5 hover:bg-paper/60 transition-colors group">
            <button type="button" class="flex-1 min-w-0 text-left" data-wf-open data-wf-id="${escapeHtml(w.id)}" data-wf-name="${escapeHtml(w.name)}">
              <div class="flex flex-wrap items-center gap-1.5 min-w-0">
                <span class="text-sm font-medium truncate max-w-full w-full sm:w-auto sm:max-w-[55%] group-hover:text-fern">${escapeHtml(w.name)}</span>
                ${w.category ? `<span class="badge badge-cat shrink-0"><i data-lucide="tag" class="h-2.5 w-2.5"></i>${escapeHtml(w.category)}</span>` : ''}
                <span class="flex items-center gap-1 shrink-0">${wfDeptBadges(w.departments)}</span>
                ${Number(w.commentCount) > 0 ? `<span class="inline-flex items-center gap-0.5 shrink-0 text-[10px] text-inksoft" title="${Number(w.commentCount)} komentar"><i data-lucide="message-square" class="h-2.5 w-2.5"></i>${Number(w.commentCount)}</span>` : ''}
              </div>
              <p class="text-xs text-inksoft truncate mt-0.5">${escapeHtml(w.description || 'Tanpa deskripsi')}</p>
            </button>
            <button type="button" class="btn btn-ghost btn-sm shrink-0" data-wf-detail data-wf-id="${escapeHtml(w.id)}" data-wf-name="${escapeHtml(w.name)}" title="Lihat detail workflow (info & aplikasi terkait)">
              <i data-lucide="info" class="h-3.5 w-3.5"></i><span class="hidden lg:inline">Lihat detail</span>
            </button>
            <div class="hidden sm:flex items-center gap-2 w-32 shrink-0">
              <div class="flex-1 bg-line rounded-full h-1"><div class="bg-fern h-1 rounded-full" style="width:${Math.max(0, Math.min(100, Number(w.progress) || 0))}%"></div></div>
              <span class="text-[10px] tabular-nums text-inksoft w-8 text-right">${Number(w.progress) || 0}%</span>
            </div>
            <span class="hidden md:flex items-center gap-1 text-[11px] text-inksoft w-16 shrink-0" title="Jumlah task">
              <i data-lucide="list-todo" class="h-3 w-3"></i>${w.taskCount}
            </span>
            <span class="hidden lg:block text-[11px] text-inksoft w-24 shrink-0 truncate" title="${escapeHtml(formatDate(w.updatedAt))}">${escapeHtml(formatDate(w.updatedAt))}</span>
            <div class="flex items-center gap-0.5 shrink-0">
              <button class="btn btn-ghost btn-sm h-7 w-7 p-0" data-wf-open data-wf-id="${escapeHtml(w.id)}" data-wf-name="${escapeHtml(w.name)}" title="Buka canvas untuk edit alur kerja">
                <i data-lucide="arrow-up-right" class="h-3.5 w-3.5"></i>
              </button>
              <button class="btn btn-ghost btn-sm h-7 w-7 p-0" data-wf-menu aria-haspopup="menu" aria-expanded="false" data-wf-id="${escapeHtml(w.id)}" data-wf-name="${escapeHtml(w.name)}" data-wf-version="${w.version}" title="Menu workflow">
                <i data-lucide="more-vertical" class="h-4 w-4"></i>
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  refreshIcons();

  $$('[data-wf-open]', list).forEach((btn) => {
    btn.addEventListener('click', () => {
      setView({ kind: 'canvas', workflowId: btn.dataset.wfId, workflowName: btn.dataset.wfName });
    });
  });
  $$('[data-wf-detail]', list).forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showWorkflowDetailModal(btn.dataset.wfId, btn.dataset.wfName);
    });
  });
  $$('[data-wf-menu]', list).forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      showWorkflowMenu(btn, btn.dataset.wfId, btn.dataset.wfName, parseInt(btn.dataset.wfVersion, 10));
    });
  });
}

function renderWfDeptChips(box, selected) {
  if (!box) return;
  box.innerHTML = WORKFLOW_DEPARTMENTS.map((d) => {
    const on = selected.has(d);
    return `<button type="button" data-wf-dept="${escapeHtml(d)}" aria-pressed="${on}"
      class="px-2 py-1 rounded-md border text-[11px] transition-colors ${on
        ? 'bg-fernlight/20 border-fern text-ferndeep font-medium'
        : 'bg-paper border-line text-inksoft hover:border-sage'}">${escapeHtml(d)}</button>`;
  }).join('');
}

function workflowFormFieldsHtml({ name, description, category, categories }) {
  return `
    <div>
      <label class="form-label">Nama Workflow</label>
      <input type="text" id="wf-name-input" class="form-input" placeholder="Contoh: Onboarding Karyawan Baru" value="${escapeHtml(name || '')}">
    </div>
    <div>
      <label class="form-label">Deskripsi</label>
      <textarea id="wf-desc-input" class="form-textarea" rows="2" placeholder="Deskripsikan tujuan workflow...">${escapeHtml(description || '')}</textarea>
    </div>
    <div>
      <div class="flex items-center justify-between mb-1.5">
        <label class="form-label mb-0">Departemen Terkait</label>
        <div class="flex items-center gap-1.5 text-[10px]">
          <button type="button" id="wf-dept-all" class="text-ferndeep hover:underline">Pilih semua</button>
          <span class="text-inksoft/40">·</span>
          <button type="button" id="wf-dept-none" class="text-inksoft hover:underline">Kosongkan</button>
        </div>
      </div>
      <div id="wf-dept-chips" class="flex flex-wrap gap-1.5"></div>
      <p class="text-[10px] text-inksoft mt-1.5">Bisa pilih lebih dari satu, atau seluruhnya.</p>
    </div>
    <div>
      <label class="form-label">Kategori</label>
      <input type="text" id="wf-cat-input" class="form-input" list="wf-cat-options" placeholder="Contoh: Onboarding" value="${escapeHtml(category || '')}">
      <datalist id="wf-cat-options">${(categories || []).map(c => `<option value="${escapeHtml(c)}"></option>`).join('')}</datalist>
      <p class="text-[10px] text-inksoft mt-1">Ketik kategori baru, atau pilih yang sudah pernah dibuat.</p>
    </div>
  `;
}

function setupWorkflowFormFields(selected) {
  const chips = $('#wf-dept-chips');
  renderWfDeptChips(chips, selected);
  if (chips) {
    chips.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-wf-dept]');
      if (!btn) return;
      const d = btn.dataset.wfDept;
      if (selected.has(d)) selected.delete(d); else selected.add(d);
      renderWfDeptChips(chips, selected);
    });
  }
  $('#wf-dept-all').addEventListener('click', () => {
    WORKFLOW_DEPARTMENTS.forEach((d) => selected.add(d));
    renderWfDeptChips(chips, selected);
  });
  $('#wf-dept-none').addEventListener('click', () => {
    selected.clear();
    renderWfDeptChips(chips, selected);
  });
}

async function showWorkflowDialog() {
  const catRes = await callServer('listWorkflowCategories');
  const categories = catRes.success ? (catRes.data || []) : [];
  const selected = new Set();
  const html = `
    <div class="fixed inset-0 z-40 bg-ink/40 flex items-center justify-center p-4" id="modal-backdrop">
      <div class="bg-card rounded-xl shadow-soft max-w-md w-full max-h-[92vh] flex flex-col" onclick="event.stopPropagation()">
        <div class="px-5 py-4 border-b border-line shrink-0">
          <h3 class="text-base font-semibold">Buat Workflow Baru</h3>
        </div>
        <div class="p-5 space-y-4 overflow-y-auto">
          ${workflowFormFieldsHtml({ categories })}
        </div>
        <div class="px-5 py-3 border-t border-line flex justify-end gap-2 shrink-0">
          <button class="btn btn-secondary" id="wf-cancel">Batal</button>
          <button class="btn btn-primary" id="wf-save">Buat</button>
        </div>
      </div>
    </div>
  `;
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  document.body.appendChild(wrap.firstElementChild);
  const nameInput = $('#wf-name-input');
  nameInput.focus();
  setupWorkflowFormFields(selected);
  $('#wf-cancel').addEventListener('click', () => $('#modal-backdrop').remove());
  $('#wf-save').addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) { toast('Nama workflow wajib diisi', 'error'); return; }
    const desc = $('#wf-desc-input').value.trim();
    const category = $('#wf-cat-input').value.trim();
    const btn = $('#wf-save');
    btn.disabled = true; btn.innerHTML = '<div class="spinner"></div>';
    const res = await callServer('createWorkflow', {
      name, description: desc, category, departments: Array.from(selected),
    });
    btn.disabled = false; btn.innerHTML = 'Buat';
    if (res.success) {
      toast('Workflow dibuat');
      $('#modal-backdrop').remove();
      loadWorkflowsList();
    } else toast(res.message || 'Gagal', 'error');
  });
}

/* Menu kontekstual yang menempel pada tombol pemicu (bukan posisi tetap).
   Dipakai menu workflow & Application Hub. */
let activeMenuClose = null;

function openAnchorMenu(anchor, innerHtml, options = {}) {
  if (activeMenuClose) activeMenuClose({ restoreFocus: false });

  const backdrop = document.createElement('div');
  backdrop.className = 'fixed inset-0 z-[70]';
  backdrop.id = 'menu-backdrop';
  backdrop.innerHTML = `
    <div class="absolute inset-0" id="menu-bg"></div>
    <div id="pop-menu" role="menu" tabindex="-1"
      class="menu-pop fixed bg-card border border-line rounded-lg shadow-soft py-1 ${options.widthClass || 'w-56'}">${innerHtml}</div>`;
  document.body.appendChild(backdrop);
  refreshIcons();

  const menu = backdrop.querySelector('#pop-menu');
  const anchorEl = anchor && anchor.nodeType === 1 ? anchor : null;

  const place = () => {
    const pad = 8;
    const gap = 6;
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    let left;
    let top;
    if (anchorEl) {
      const r = anchorEl.getBoundingClientRect();
      left = options.align === 'start' ? r.left : r.right - mw;
      top = r.bottom + gap;
      if (top + mh > window.innerHeight - pad) {
        const above = r.top - mh - gap;
        top = above >= pad ? above : Math.max(pad, window.innerHeight - mh - pad);
      }
    } else {
      left = (window.innerWidth - mw) / 2;
      top = 80;
    }
    left = Math.max(pad, Math.min(left, window.innerWidth - mw - pad));
    menu.style.left = Math.round(left) + 'px';
    menu.style.top = Math.round(top) + 'px';
  };

  place();
  requestAnimationFrame(() => { place(); menu.classList.add('is-ready'); });

  // Tailwind Play CDN kadang menerapkan ukuran setelah elemen dipasang;
  // ResizeObserver memastikan posisi dihitung ulang saat ukuran menu berubah.
  let resizeObserver = null;
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => place());
    resizeObserver.observe(menu);
  }

  const items = () => Array.from(menu.querySelectorAll('[role="menuitem"]')).filter((el) => !el.disabled);
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].indexOf(e.key) === -1) return;
    e.preventDefault();
    const list = items();
    if (list.length === 0) return;
    const idx = list.indexOf(document.activeElement);
    let next = 0;
    if (e.key === 'ArrowUp') next = idx <= 0 ? list.length - 1 : idx - 1;
    else if (e.key === 'End') next = list.length - 1;
    else if (e.key === 'ArrowDown' && idx >= 0) next = (idx + 1) % list.length;
    list[next].focus({ preventScroll: true });
  };
  const onResize = () => close({ restoreFocus: false });
  const onScroll = (e) => {
    if (menu.contains(e.target)) return;
    close({ restoreFocus: false });
  };

  let closed = false;
  const close = (opts = {}) => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('scroll', onScroll, true);
    if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
    backdrop.remove();
    if (anchorEl) {
      anchorEl.setAttribute('aria-expanded', 'false');
      if (opts.restoreFocus !== false) anchorEl.focus({ preventScroll: true });
    }
    if (activeMenuClose === close) activeMenuClose = null;
  };

  activeMenuClose = close;
  if (anchorEl) anchorEl.setAttribute('aria-expanded', 'true');
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);
  document.addEventListener('scroll', onScroll, true);
  backdrop.querySelector('#menu-bg').addEventListener('click', () => close());

  const first = items()[0];
  if (options.focusFirst && first) first.focus({ preventScroll: true });
  else menu.focus({ preventScroll: true });

  return { element: menu, close };
}

function showWorkflowMenu(anchor, wfId, wfName, version) {
  const html = `
    <div class="menu-head">
      <div class="menu-head-title" title="${escapeHtml(wfName)}">${escapeHtml(wfName)}</div>
      <div class="menu-head-meta">${escapeHtml(wfId)} · v${escapeHtml(String(version))}</div>
    </div>
    <div class="menu-sep"></div>
    <button type="button" role="menuitem" class="menu-item" data-wf-action="edit">
      <i data-lucide="pencil"></i><span>Edit detail</span>
    </button>
    <button type="button" role="menuitem" class="menu-item" data-wf-action="comments">
      <i data-lucide="message-square"></i><span>Diskusi workflow</span>
    </button>
    <button type="button" role="menuitem" class="menu-item" data-wf-action="duplicate">
      <i data-lucide="copy"></i><span>Duplikasi</span>
    </button>
    <button type="button" role="menuitem" class="menu-item" data-wf-action="archive">
      <i data-lucide="archive"></i><span>Arsipkan</span>
    </button>
    <div class="menu-sep"></div>
    <button type="button" role="menuitem" class="menu-item danger" data-wf-action="delete">
      <i data-lucide="trash-2"></i><span>Hapus permanen</span>
    </button>
  `;
  const menu = openAnchorMenu(anchor, html);
  menu.element.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-wf-action]');
    if (!btn) return;
    menu.close();
    const action = btn.dataset.wfAction;
    if (action === 'edit') {
      showEditWorkflowDialog(wfId, wfName, version);
      return;
    }
    if (action === 'comments') {
      showCommentsDialog({
        entityType: 'workflow',
        entityId: wfId,
        title: 'Diskusi Workflow',
        subtitle: wfName,
      });
      return;
    }
    if (action === 'duplicate') {
      const res = await callServer('duplicateWorkflow', wfId);
      if (res.success) { toast('Workflow diduplikasi'); loadWorkflowsList(); }
      else toast(res.message || 'Gagal', 'error');
      return;
    }
    if (action === 'archive') {
      const ok = await showConfirmDialog({
        title: 'Arsipkan workflow?',
        message: `"${wfName}" akan dipindahkan ke arsip. Workflow bisa dipulihkan kapan saja dari filter Arsip.`,
        confirmText: 'Arsipkan',
        cancelText: 'Batal',
        danger: false,
      });
      if (!ok) return;
      const res = await callServer('archiveWorkflow', wfId);
      if (res.success) { toast('Workflow diarsipkan'); loadWorkflowsList(); }
      else toast(res.message || 'Gagal', 'error');
      return;
    }
    if (action === 'delete') {
      const ok = await showConfirmDialog({
        title: 'Hapus workflow permanen?',
        message: `"${wfName}" beserta node, edge, dan task di dalamnya akan dihapus. Tindakan ini tidak bisa dibatalkan.`,
        confirmText: 'Hapus Permanen',
        cancelText: 'Batal',
        danger: true,
      });
      if (!ok) return;
      const res = await callServer('deleteWorkflow', wfId);
      if (res.success) { toast('Workflow dihapus'); loadWorkflowsList(); }
      else toast(res.message || 'Gagal', 'error');
    }
  });
}

async function showEditWorkflowDialog(wfId, name, version) {
  let description = '';
  let category = '';
  let departments = [];
  const wfRes = await callServer('listWorkflows');
  if (wfRes.success && Array.isArray(wfRes.data)) {
    const wf = wfRes.data.find(w => String(w.id) === String(wfId));
    if (wf) {
      description = wf.description || '';
      category = wf.category || '';
      departments = Array.isArray(wf.departments) ? wf.departments : [];
    }
  }
  const catRes = await callServer('listWorkflowCategories');
  const categories = catRes.success ? (catRes.data || []) : [];
  const selected = new Set(departments);
  const html = `
    <div class="fixed inset-0 z-40 bg-ink/40 flex items-center justify-center p-4" id="modal-backdrop">
      <div class="bg-card rounded-xl shadow-soft max-w-md w-full max-h-[92vh] flex flex-col" onclick="event.stopPropagation()">
        <div class="px-5 py-4 border-b border-line shrink-0"><h3 class="text-base font-semibold">Edit Workflow</h3></div>
        <div class="p-5 space-y-4 overflow-y-auto">
          <div class="flex items-center justify-between gap-2 text-[10px] text-inksoft font-mono border border-line bg-paper/60 rounded-md px-2 py-1">
            <span class="truncate">ID: ${escapeHtml(wfId)}</span>
            <span class="shrink-0">v${escapeHtml(String(version))}</span>
          </div>
          ${workflowFormFieldsHtml({ name, description, category, categories })}
        </div>
        <div class="px-5 py-3 border-t border-line flex justify-end gap-2 shrink-0">
          <button class="btn btn-secondary" id="wf-cancel">Batal</button>
          <button class="btn btn-primary" id="wf-save" data-wf-id="${escapeHtml(wfId)}" data-wf-version="${version}">Simpan</button>
        </div>
      </div>
    </div>
  `;
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  document.body.appendChild(wrap.firstElementChild);
  $('#wf-name-input').focus();
  setupWorkflowFormFields(selected);
  $('#wf-cancel').addEventListener('click', () => $('#modal-backdrop').remove());
  $('#modal-backdrop').addEventListener('click', () => $('#modal-backdrop').remove());
  $('#wf-save').addEventListener('click', async (e) => {
    const id = e.currentTarget.dataset.wfId;
    const expectedVersion = parseInt(e.currentTarget.dataset.wfVersion, 10);
    const newName = $('#wf-name-input').value.trim();
    if (!newName) { toast('Nama workflow wajib diisi', 'error'); return; }
    const desc = $('#wf-desc-input').value.trim();
    const newCategory = $('#wf-cat-input').value.trim();
    const res = await callServer('updateWorkflow', {
      id, name: newName, description: desc, category: newCategory,
      departments: Array.from(selected), expectedVersion,
    });
    if (res.success) { toast('Workflow diperbarui'); $('#modal-backdrop').remove(); loadWorkflowsList(); }
    else if (res.errorCode === 'VERSION_CONFLICT') {
      toast('Konflik versi', 'error', 'Memuat ulang...');
      setTimeout(() => loadWorkflowsList(), 1500);
      $('#modal-backdrop').remove();
    } else toast(res.message || 'Gagal', 'error');
  });
}

/* ============================================================
 * Canvas View (Drawflow)
 * ============================================================ */

async function renderCanvas(container) {
  container.className = 'h-full w-full relative bg-paper';
  const wfId = State.view.workflowId;
  const wfName = State.view.workflowName;
  State.currentWorkflowId = wfId;
  State.currentWorkflowName = wfName;
  container.innerHTML = `
    <div class="canvas-toolbar absolute top-0 left-0 right-0 z-10 bg-card/80 backdrop-blur border-b border-line">
      <div class="canvas-toolbar-row flex items-center justify-between px-4 py-2 gap-3 flex-wrap">
        <div class="flex items-center gap-3 min-w-0">
          <h2 class="text-sm font-semibold truncate">${escapeHtml(wfName)}</h2>
          <span id="save-indicator" class="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-fernlight/15 text-ferndeep">
            <span class="h-1.5 w-1.5 rounded-full bg-fern"></span>Tersimpan
          </span>
        </div>
        <div class="flex items-center gap-2">
          <div class="relative canvas-search">
            <i data-lucide="search" class="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-inksoft/50"></i>
            <input id="canvas-search" class="pl-8 h-8 w-44 text-xs border border-line rounded-md" placeholder="Cari node...">
          </div>
          <input type="file" id="drawio-import-input" accept=".drawio,.xml,text/xml" class="hidden">
          <button id="canvas-comments-btn" class="btn btn-secondary btn-sm" title="Diskusi workflow ini" aria-label="Diskusi workflow"><i data-lucide="message-square" class="h-3.5 w-3.5"></i><span class="hidden sm:inline">Diskusi</span></button>
          <button id="drawio-import-btn" class="btn btn-secondary btn-sm" title="Impor draw.io" aria-label="Impor draw.io"><i data-lucide="upload" class="h-3.5 w-3.5"></i><span class="hidden sm:inline">Impor draw.io</span></button>
          <button id="clear-canvas-btn" class="btn btn-ghost btn-sm text-berry hover:bg-berry/5" title="Kosongkan canvas" aria-label="Kosongkan canvas"><i data-lucide="trash-2" class="h-3.5 w-3.5"></i><span class="hidden sm:inline">Kosongkan canvas</span></button>
          <button id="save-canvas-btn" class="btn btn-secondary btn-sm"><i data-lucide="save" class="h-3.5 w-3.5"></i>Simpan</button>
        </div>
      </div>
    </div>
    <div class="canvas-palette absolute top-12 left-0 bottom-0 z-10 w-48 bg-card border-r border-line overflow-y-auto">
      <div class="p-3">
        <p class="text-[10px] font-semibold uppercase tracking-wide text-inksoft mb-2">Palette Node</p>
        <div class="space-y-1" id="node-palette">
          ${NODE_TYPES.map(t => `
            <button class="palette-btn-${t.id} flex items-center gap-2 w-full rounded-md border border-line bg-card px-2 py-1.5 text-xs hover:border-fern hover:bg-fernlight/10 text-left" data-type="${t.id}">
              <i data-lucide="${t.icon}" class="h-3.5 w-3.5"></i>
              <span class="truncate">${t.label}</span>
              <i data-lucide="plus" class="h-3 w-3 ml-auto text-inksoft/50"></i>
            </button>
          `).join('')}
        </div>
        <div class="border-t border-line mt-3 pt-3">
          <p class="text-[10px] text-inksoft leading-relaxed">Klik untuk menambah node. Tarik titik mana pun (kiri/atas/kanan/bawah) ke titik node lain untuk menyambung — semua titik bisa jadi awal maupun tujuan.</p>
        </div>
      </div>
    </div>
    <div id="drawflow-container" class="canvas-stage absolute top-12 left-48 right-80 bottom-0">
      <div id="drawflow" class="h-full w-full"></div>
    </div>
    <div class="canvas-detail absolute top-12 right-0 bottom-0 z-10 w-80 bg-card border-l border-line overflow-y-auto" id="node-detail-panel">
      <div class="canvas-detail-head md:hidden">
        <span class="text-xs font-semibold">Detail Node</span>
        <button type="button" id="node-panel-close" class="btn btn-ghost btn-sm h-7 w-7 p-0" aria-label="Tutup detail node">
          <i data-lucide="x" class="h-4 w-4"></i>
        </button>
      </div>
      <div id="node-detail-body" class="p-4">
        <p class="text-xs text-inksoft text-center mt-8">Pilih node untuk melihat detail, atau tambah node baru dari <span class="md:hidden">panel bawah</span><span class="hidden md:inline">panel kiri</span>.</p>
      </div>
    </div>
    <div class="canvas-mobile-palette md:hidden">
      <div class="flex items-center gap-1.5 overflow-x-auto px-3 py-2" id="node-palette-mobile">
        ${NODE_TYPES.map(t => `
          <button class="palette-btn-${t.id} flex items-center gap-1.5 shrink-0 rounded-md border border-line bg-card px-2.5 py-1.5 text-[11px] hover:border-fern hover:bg-fernlight/10" data-type="${t.id}">
            <i data-lucide="${t.icon}" class="h-3.5 w-3.5"></i>
            <span class="whitespace-nowrap">${escapeHtml(t.label)}</span>
          </button>
        `).join('')}
      </div>
    </div>
  `;
  refreshIcons();

  // Init Drawflow
  const el = $('#drawflow');
  State.editor = new Drawflow(el);
  State.editor.reroute = true;
  State.editor.reroute_fix_curvature = true;
  State.editor.force_first_input = false;
  State.editor.curvature = 0.25;
  State.editor.reroute_curvature = 0.25;
  State.editor.reroute_curvature_start_end = 0.25;
  State.editor.start();

  // Semua titik node bisa menjadi awal maupun tujuan koneksi.
  setupPortDragging(el);

  State.selectedNode = null;

  function captureCanvasSnapshot() {
    try {
      if (!State.editor) return null;
      const exp = State.editor.export();
      return JSON.parse(JSON.stringify(exp));
    } catch (e) { return null; }
  }
  function pushCanvasUndo() {
    if (State.canvasLoading || State.canvasUndoBusy) return;
    const snap = captureCanvasSnapshot();
    if (!snap) return;
    State.canvasUndoStack.push(snap);
    if (State.canvasUndoStack.length > 50) State.canvasUndoStack.shift();
  }
  function clearCanvasModule(editor) {
    if (!editor) return;
    try {
      if (typeof editor.clearModule === 'function') {
        editor.clearModule('Home');
        return;
      }
      if (typeof editor.clear === 'function') {
        editor.clear();
        return;
      }
      if (editor.drawflow && editor.drawflow.drawflow && editor.drawflow.drawflow.Home) {
        const data = editor.drawflow.drawflow.Home.data || {};
        const ids = Object.keys(data);
        for (let i = ids.length - 1; i >= 0; i--) {
          try { editor.removeNodeId('node-' + ids[i]); } catch (e) {}
        }
        editor.drawflow.drawflow.Home.data = {};
      }
      if (editor.precanvas) {
        editor.precanvas.querySelectorAll('.drawflow-node').forEach((n) => { try { n.remove(); } catch (e) {} });
        editor.precanvas.querySelectorAll('.connection').forEach((c) => { try { c.remove(); } catch (e) {} });
      }
    } catch (e) {}
  }

  function undoCanvas() {
    if (State.canvasLoading || State.canvasUndoBusy) return;
    if (!State.canvasUndoStack.length) { toast('Tidak ada yang bisa di-undo', 'info'); return; }
    try {
      State.canvasUndoBusy = true;
      const prev = State.canvasUndoStack.pop();
      if (!prev) return;
      State.canvasLoading = true;
      clearCanvasModule(State.editor);
      if (prev.drawflow && prev.drawflow.Home) {
        try { State.editor.import(prev); } catch (e) {}
      }
      setTimeout(() => {
        State.canvasLoading = false;
        State.canvasUndoBusy = false;
        setCanvasDirty();
        refreshEdgeLabels();
        requestAnimationFrame(() => {
          if (!State.editor || !State.editor.drawflow) return;
          const data = State.editor.drawflow.drawflow.Home.data || {};
          Object.keys(data).forEach(id => {
            try { State.editor.updateConnectionNodes('node-' + id); } catch(e){}
          });
          refreshEdgeLabels();
        });
      }, 50);
    } catch (e) {
      State.canvasLoading = false;
      State.canvasUndoBusy = false;
      toast('Gagal undo', 'error');
    }
  }

  // Autosave & panel events
  pushCanvasUndo();
  State.editor.on('nodeMoved', () => { if (!State.canvasLoading) { pushCanvasUndo(); setCanvasDirty(); refreshEdgeLabels(); } });
  State.editor.on('nodeCreated', () => { if (!State.canvasLoading) { pushCanvasUndo(); setCanvasDirty(); } });
  State.editor.on('nodeRemoved', (id) => { if (!State.canvasLoading) { pushCanvasUndo(); if (State.selectedNode && String(State.selectedNode.drawflowId) === String(id)) { State.selectedNode = null; showNodePanelEmpty(); } setCanvasDirty(); } });
  State.editor.on('connectionCreated', () => { if (!State.canvasLoading) { pushCanvasUndo(); setCanvasDirty(); refreshEdgeLabels(); } });
  State.editor.on('connectionRemoved', () => { if (!State.canvasLoading) { pushCanvasUndo(); setCanvasDirty(); refreshEdgeLabels(); } });
  // Edit edge label on double click
  el.addEventListener('dblclick', (e) => {
    const labelGroup = e.target.closest('.edge-label-group');
    if (labelGroup) {
      const conn = labelGroup.closest('.connection');
      if (conn) {
        e.stopPropagation();
        e.preventDefault();
        showEdgeLabelModal(conn);
        return;
      }
    }
    // Biarkan Drawflow handle double-click di garis kosong untuk menambah titik tekuk (reroute)
  });

  // Context menu untuk garis: tambah/ubah label & hapus koneksi.
  el.addEventListener('contextmenu', (e) => {
    const conn = e.target.closest('.connection');
    if (!conn) return;
    e.preventDefault();
    e.stopPropagation();
    showEdgeContextMenu(e, conn);
  });
  el.addEventListener('click', (e) => {
    const path = e.target.closest('.connection .main-path');
    if (!path) return;
    const conn = path.parentElement;
    // single click focus not required, dblclick to edit
  });
  // nodeRemoved already handled above with undo
  State.editor.on('nodeSelected', (id) => {
    const data = State.editor.drawflow.drawflow.Home.data[id];
    if (!data) return;
    State.selectedNode = { drawflowId: id, customId: data.custom_id || data.data.id };
    renderNodePanel(data.data);
  });
  State.editor.on('nodeUnselected', () => {
    State.selectedNode = null;
    showNodePanelEmpty();
  });

  // Palette buttons
  $$('[class*="palette-btn-"]', container).forEach(btn => {
    btn.addEventListener('click', () => { pushCanvasUndo(); addNode(btn.dataset.type); });
  });

  // Save button
  $('#save-canvas-btn').addEventListener('click', () => saveCanvas());
  const clearCanvasBtn = $('#clear-canvas-btn');
  if (clearCanvasBtn) {
    clearCanvasBtn.addEventListener('click', async () => {
      const ok = await showConfirmDialog({
        title: 'Kosongkan canvas',
        message: 'Semua node dan koneksi akan dihapus dari canvas ini. Tindakan ini bisa di-undo dengan Ctrl+Z.',
        confirmText: 'Kosongkan',
        cancelText: 'Batal',
        danger: true,
      });
      if (!ok) return;
      if (!State.editor) return;
      pushCanvasUndo();
      State.canvasLoading = true;
      try {
        clearCanvasModule(State.editor);
        State.selectedNode = null;
        showNodePanelEmpty();
        setCanvasDirty();
        refreshEdgeLabels();
        toast('Canvas dikosongkan', 'info');
      } finally {
        State.canvasLoading = false;
      }
    });
  }
  $('#canvas-comments-btn').addEventListener('click', () => {
    showCommentsDialog({
      entityType: 'workflow',
      entityId: wfId,
      title: 'Diskusi Workflow',
      subtitle: wfName,
    });
  });

  // Tutup panel detail node (tombol ini hanya tampil di layar kecil).
  const closePanelBtn = $('#node-panel-close');
  if (closePanelBtn) {
    closePanelBtn.addEventListener('click', () => {
      State.selectedNode = null;
      const ed = State.editor;
      if (ed && ed.node_selected) {
        ed.node_selected.classList.remove('selected');
        ed.node_selected = null;
      }
      showNodePanelEmpty();
    });
  }
  // Impor draw.io
  const importBtn = $('#drawio-import-btn');
  const importInput = $('#drawio-import-input');
  if (importBtn && importInput) {
    importBtn.addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        pushCanvasUndo();
        await importDrawioDiagram(text);
        toast('Diagram draw.io berhasil diimpor', 'success');
      } catch (err) {
        console.error(err);
        toast(err && err.message ? err.message : 'Gagal mengimpor diagram draw.io', 'error');
      } finally {
        importInput.value = '';
      }
    });
  }
  $('#canvas-search').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    $$('.drawflow-node', el).forEach(node => {
      const title = (node.querySelector('.node-title')?.textContent || '').toLowerCase();
      node.style.outline = q && title.includes(q) ? '2px solid #2F7D5B' : '';
    });
  });

  // Load canvas data
  const res = await callServer('getWorkflowCanvas', wfId);
  if (!res.success) {
    container.innerHTML = `<div class="p-6 text-berry">${escapeHtml(res.message || 'Gagal memuat canvas')}</div>`;
    return;
  }
  State.canvasVersion = res.data.version;
  State.canvasLoading = true;
  State.canvasUndoStack = [];
  const nodeIdMap = {};
  res.data.nodes.forEach(n => {
    nodeIdMap[n.id] = addNodeToCanvas(n);
  });
  res.data.edges.forEach(e => {
    try {
      const fromId = nodeIdMap[e.source];
      const toId = nodeIdMap[e.target];
      if (fromId != null && toId != null) {
        State.editor.addConnection(fromId, toId, e.sourceOutput || 'output_1', e.targetInput || 'input_1');
        // attach label
        const conn = State.editor.container.querySelector(`.connection.node_in_node-${toId}.node_out_node-${fromId}.${e.sourceOutput || 'output_1'}.${e.targetInput || 'input_1'}`);
        if (conn && e.label) {
          conn.dataset.label = e.label;
        }
      }
    } catch (err) { /* skip */ }
  });
  if (res.data.canvasSettings) {
    try {
      const cs = typeof res.data.canvasSettings === 'string' ? JSON.parse(res.data.canvasSettings) : res.data.canvasSettings;
      const zoom = Number(cs.zoom) || 1;
      const x = Number(cs.x) || 0;
      const y = Number(cs.y) || 0;
      State.editor.zoom = zoom;
      State.editor.zoom_last_value = zoom;
      State.editor.canvas_x = x;
      State.editor.canvas_y = y;
      if (State.editor.precanvas) {
        State.editor.precanvas.style.transform = 'translate(' + x + 'px, ' + y + 'px) scale(' + zoom + ')';
      }
    } catch (e) {}
  }
  State.canvasLoading = false;
  try { showNodePanelEmpty(); } catch (e) {}

  // Fix: garis koneksi
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!State.editor || !State.editor.drawflow) return;
      const data = State.editor.drawflow.drawflow.Home.data;
      Object.keys(data).forEach(id => {
        State.editor.updateConnectionNodes('node-' + id);
      });
      // apply labels again after update
      res.data.edges.forEach(e => {
        try {
          const fromId = nodeIdMap[e.source];
          const toId = nodeIdMap[e.target];
          if (fromId != null && toId != null && e.label) {
            const conn2 = State.editor.container.querySelector(`.connection.node_in_node-${toId}.node_out_node-${fromId}.${e.sourceOutput || 'output_1'}.${e.targetInput || 'input_1'}`);
            if (conn2) conn2.dataset.label = e.label;
          }
        } catch(ex) {}
      });
      refreshEdgeLabels();
    });
  });
}

function nodeHtml(n) {
  return `<div class="drawflow-node-custom type-${escapeHtml(n.nodeType)}">
    <div class="node-meta">${escapeHtml((n.nodeType || '').replace('_', ' '))}</div>
    <div class="node-title">${escapeHtml(n.title || 'Untitled')}</div>
    ${n.description ? `<div class="node-desc">${escapeHtml(n.description)}</div>` : ''}
    ${n.nodeType === 'workflow_link' ? `
      <div class="node-task">
        <button class="linked-wf-badge inline-flex items-center gap-1 rounded-md border border-line bg-paper px-1.5 py-0.5 text-[10px] hover:border-fern hover:text-ferndeep ${n.linkedWorkflowId ? 'text-inksoft' : 'text-inksoft/60'}" data-linked-workflow="${escapeHtml(n.linkedWorkflowId || '')}" title="Buka workflow lanjutan">
          <i data-lucide="link-2" class="h-2.5 w-2.5"></i>
          <span class="truncate max-w-[120px]">${escapeHtml(n.linkedWorkflowName || (n.linkedWorkflowId ? 'Workflow' : 'Belum ditautkan'))}</span>
          ${n.linkedWorkflowId ? '<i data-lucide="arrow-up-right" class="h-2.5 w-2.5"></i>' : ''}
        </button>
      </div>
    ` : ''}
    ${n.taskCount > 1 ? `
      <div class="node-task">
        <span class="badge bg-paper text-ink border border-line">${n.taskCount} task</span>
        <span class="text-[10px] text-inksoft">${Math.round(Number(n.progress) || 0)}%</span>
        <button class="open-task h-5 w-5 rounded-full bg-fern text-white flex items-center justify-center hover:bg-ferndeep" data-open-node-panel="1" title="Lihat semua task node ini">
          <i data-lucide="list-todo" class="h-3 w-3"></i>
        </button>
      </div>
    ` : n.task ? `
      <div class="node-task">
        <span class="badge badge-${escapeHtml(n.task.status)}">${escapeHtml(STATUS_LABEL[n.task.status])}</span>
        <span class="badge badge-${escapeHtml(n.task.priority)}">${escapeHtml(PRIORITY_LABEL[n.task.priority])}</span>
        ${n.task.progress > 0 ? `<span class="text-[10px] text-inksoft">${n.task.progress}%</span>` : ''}
        <button class="open-task h-5 w-5 rounded-full bg-fern text-white flex items-center justify-center hover:bg-ferndeep" data-task-id="${escapeHtml(n.task.id)}" title="Buka detail task">
          <i data-lucide="list-todo" class="h-3 w-3"></i>
        </button>
      </div>
    ` : ''}
  </div>`;
}

function addNodeToCanvas(n) {
  // 4 titik koneksi; tiap titik punya pasangan input & output.
  const inputs = 4, outputs = 4;
  const coordOr = (value, fallback) => {
    if (value === null || value === undefined || value === '') return fallback;
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  };
  const drawflowId = State.editor.addNode(n.nodeType, inputs, outputs, coordOr(n.positionX, 100), coordOr(n.positionY, 100), 'type-' + n.nodeType, {
    id: n.id, nodeType: n.nodeType, title: n.title, description: n.description, task: n.task,
    tasks: Array.isArray(n.tasks) ? n.tasks : (n.task ? [n.task] : []),
    taskCount: typeof n.taskCount === 'number' ? n.taskCount : (Array.isArray(n.tasks) ? n.tasks.length : (n.task ? 1 : 0)),
    progress: typeof n.progress === 'number' ? n.progress : (n.task ? Number(n.task.progress) || 0 : 0),
    linkedWorkflowId: n.linkedWorkflowId || '', linkedWorkflowName: n.linkedWorkflowName || '',
  }, nodeHtml(n));
  State.editor.drawflow.drawflow.Home.data[drawflowId].custom_id = n.id;
  attachNodeTaskButton(drawflowId);
  decorateNodePorts(drawflowId);
  return drawflowId;
}

function attachNodeTaskButton(drawflowId) {
  const nodeEl = document.getElementById('node-' + drawflowId);
  if (!nodeEl) return;
  const btn = nodeEl.querySelector('[data-task-id]');
  if (btn) btn.addEventListener('click', (e) => {
    e.stopPropagation();
    openTaskDrawer(btn.dataset.taskId);
  });
  const panelBtn = nodeEl.querySelector('[data-open-node-panel]');
  if (panelBtn) panelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const d = State.editor.drawflow.drawflow.Home.data[drawflowId];
    if (!d) return;
    State.selectedNode = { drawflowId: drawflowId, customId: d.custom_id || d.data.id };
    renderNodePanel(d.data);
  });
  const linkBtn = nodeEl.querySelector('[data-linked-workflow]');
  if (linkBtn) linkBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const wfId = linkBtn.dataset.linkedWorkflow;
    if (wfId) openLinkedWorkflow(wfId);
    else toast('Node ini belum ditautkan ke workflow lain', 'info');
  });
}

/* ------------------------------------------------------------
 * Koneksi bebas arah.
 * Tiap node punya 4 titik: kiri, atas, kanan, bawah. Setiap titik
 * dirender sebagai sepasang input+output di posisi yang sama,
 * sehingga titik mana pun bisa menjadi awal maupun tujuan garis.
 * ---------------------------------------------------------- */
const PORT_INPUT_BY_POINT = ['input_1', 'input_2', 'input_3', 'input_4'];
const PORT_OUTPUT_BY_POINT = ['output_3', 'output_4', 'output_1', 'output_2'];
const PORT_POINT_BY_INPUT = { input_1: 1, input_2: 2, input_3: 3, input_4: 4 };
const PORT_POINT_BY_OUTPUT = { output_1: 3, output_2: 4, output_3: 1, output_4: 2 };

function portInfo(el) {
  if (!el || typeof el.closest !== 'function') return null;
  const portEl = el.closest('.input, .output');
  if (!portEl) return null;
  const nodeEl = portEl.closest('.drawflow-node');
  if (!nodeEl) return null;
  const classes = Array.from(portEl.classList);
  const inputCls = classes.find((c) => PORT_POINT_BY_INPUT[c]);
  const outputCls = classes.find((c) => PORT_POINT_BY_OUTPUT[c]);
  const point = inputCls
    ? PORT_POINT_BY_INPUT[inputCls]
    : (outputCls ? PORT_POINT_BY_OUTPUT[outputCls] : 0);
  if (!point) return null;
  return { el: portEl, nodeEl, nodeId: nodeEl.id.replace('node-', ''), point };
}

function setupPortDragging(container) {
  const editor = State.editor;
  if (!editor || !editor.precanvas) return;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  let drag = null;

  function zoomInfo() {
    const pre = editor.precanvas;
    const zoom = editor.zoom || 1;
    return {
      w: pre.clientWidth / (pre.clientWidth * zoom) || 1,
      h: pre.clientHeight / (pre.clientHeight * zoom) || 1,
      rect: pre.getBoundingClientRect(),
    };
  }

  function portCenter(port) {
    const z = zoomInfo();
    const r = port.getBoundingClientRect();
    return {
      x: port.offsetWidth / 2 + (r.x - z.rect.x) * z.w,
      y: port.offsetHeight / 2 + (r.y - z.rect.y) * z.h,
    };
  }

  function eventPoint(ev) {
    if (ev.touches && ev.touches.length) {
      return { x: ev.touches[0].clientX, y: ev.touches[0].clientY };
    }
    if (ev.changedTouches && ev.changedTouches.length) {
      return { x: ev.changedTouches[0].clientX, y: ev.changedTouches[0].clientY };
    }
    return { x: ev.clientX, y: ev.clientY };
  }

  function cursorPoint(point) {
    const z = zoomInfo();
    return {
      x: point.x * z.w - z.rect.x * z.w,
      y: point.y * z.h - z.rect.y * z.h,
    };
  }

  function updateTempPath(ev) {
    if (!drag) return;
    const p = cursorPoint(eventPoint(ev));
    drag.path.setAttributeNS(null, 'd',
      editor.createCurvature(drag.start.x, drag.start.y, p.x, p.y, editor.curvature, 'openclose'));
  }

  function stopDrag() {
    if (!drag) return;
    drag.svg.remove();
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('mouseup', onUp, true);
    window.removeEventListener('touchmove', onMove, true);
    window.removeEventListener('touchend', onUp, true);
    window.removeEventListener('touchcancel', onUp, true);
    document.body.classList.remove('is-connecting');
    drag = null;
  }

  // Cari titik terdekat dari posisi kursor (toleransi default 24px)
  // supaya koneksi tetap jadi walau lepasnya sedikit meleset dari titik.
  function nearestPort(x, y, excludeNodeId, radius) {
    let best = null;
    let bestDist = radius || 24;
    container.querySelectorAll('.drawflow-node .output').forEach((el) => {
      const info = portInfo(el);
      if (!info) return;
      if (excludeNodeId && String(info.nodeId) === String(excludeNodeId)) return;
      const r = el.getBoundingClientRect();
      const d = Math.hypot(r.x + r.width / 2 - x, r.y + r.height / 2 - y);
      if (d < bestDist) {
        bestDist = d;
        best = info;
      }
    });
    return best;
  }

  function nearestPointOfNode(nodeEl, x, y) {
    let point = 3;
    let bestDist = Infinity;
    PORT_INPUT_BY_POINT.forEach((cls, idx) => {
      const el = nodeEl.querySelector('.' + cls);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const d = Math.hypot(r.x + r.width / 2 - x, r.y + r.height / 2 - y);
      if (d < bestDist) { bestDist = d; point = idx + 1; }
    });
    return { nodeEl, nodeId: nodeEl.id.replace('node-', ''), point };
  }

  function onMove(ev) {
    ev.preventDefault();
    updateTempPath(ev);
  }

  function onUp(ev) {
    if (!drag) return;
    const session = drag;
    const point = eventPoint(ev);
    const hit = document.elementFromPoint(point.x, point.y);
    // Bersihkan garis sementara sebelum addConnection memicu refresh label.
    stopDrag();

    let target = portInfo(hit);
    if (target && String(target.nodeId) === String(session.nodeId)) target = null;
    if (!target) target = nearestPort(point.x, point.y, session.nodeId);
    if (!target) {
      const nodeEl = hit && typeof hit.closest === 'function' ? hit.closest('.drawflow-node') : null;
      if (nodeEl && String(nodeEl.id.replace('node-', '')) !== String(session.nodeId)) {
        target = nearestPointOfNode(nodeEl, point.x, point.y);
      }
    }
    if (!target || String(target.nodeId) === String(session.nodeId)) return;

    const sourceOutput = PORT_OUTPUT_BY_POINT[session.point - 1];
    const targetInput = PORT_INPUT_BY_POINT[target.point - 1];
    const srcData = editor.getNodeFromId(session.nodeId);
    const dstData = editor.getNodeFromId(target.nodeId);
    if (!srcData || !srcData.outputs || !srcData.outputs[sourceOutput]) return;
    if (!dstData || !dstData.inputs || !dstData.inputs[targetInput]) return;
    editor.addConnection(session.nodeId, target.nodeId, sourceOutput, targetInput);
  }

  function beginDrag(info) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.classList.add('connection', 'connection-reverse');
    const path = document.createElementNS(SVG_NS, 'path');
    path.classList.add('main-path');
    path.style.pointerEvents = 'none';
    svg.appendChild(path);
    editor.precanvas.appendChild(svg);

    const start = portCenter(info.el);
    drag = { svg, path, start, nodeId: info.nodeId, point: info.point };
    path.setAttributeNS(null, 'd',
      editor.createCurvature(start.x, start.y, start.x, start.y, editor.curvature, 'openclose'));
    document.body.classList.add('is-connecting');
  }

  // Cari titik yang akan dipakai saat mulai drag. Port di bawah kursor
  // diutamakan; kalau tertutup garis/label/node lain, pakai titik terdekat
  // dalam radius 12px. Klik pada isi node yang sama tetap untuk geser node.
  function portFromEvent(ev) {
    const point = eventPoint(ev);
    let info = portInfo(ev.target);
    if (!info) {
      const near = nearestPort(point.x, point.y, null, 12);
      if (near) {
        const hitNode = ev.target.closest ? ev.target.closest('.drawflow-node') : null;
        const hitNodeId = hitNode ? hitNode.id.replace('node-', '') : '';
        if (!hitNodeId || String(hitNodeId) !== String(near.nodeId)) info = near;
      }
    }
    return info;
  }

  // Capture: hentikan event sebelum Drawflow memulai garis versinya sendiri.
  container.addEventListener('mousedown', (ev) => {
    if (ev.button !== 0) return;
    const info = portFromEvent(ev);
    if (!info) return;

    ev.preventDefault();
    ev.stopPropagation();
    beginDrag(info);
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', onUp, true);
  }, true);

  // Dukungan sentuh (tablet/mobile) dengan perilaku yang sama.
  container.addEventListener('touchstart', (ev) => {
    if (ev.touches.length !== 1) return;
    const info = portFromEvent(ev);
    if (!info) return;

    ev.preventDefault();
    ev.stopPropagation();
    beginDrag(info);
    window.addEventListener('touchmove', onMove, { capture: true, passive: false });
    window.addEventListener('touchend', onUp, true);
    window.addEventListener('touchcancel', onUp, true);
  }, { capture: true, passive: false });
}

function decorateNodePorts(drawflowId) {
  const nodeEl = document.getElementById('node-' + drawflowId);
  if (!nodeEl) return;
  nodeEl.querySelectorAll('.outputs .output').forEach((p) => {
    p.title = 'Titik koneksi — tarik ke titik mana pun di node lain';
  });
}

async function openLinkedWorkflow(wfId) {
  if (!wfId) return;
  const res = await callServer('getWorkflowCanvas', wfId);
  if (!res.success) { toast(res.message || 'Workflow tujuan tidak ditemukan', 'error'); return; }
  if (State.canvasDirty) await saveCanvas();
  setView({ kind: 'canvas', workflowId: wfId, workflowName: res.data.workflowName || 'Workflow' });
}

function setNodeCustomHtml(drawflowId, html) {
  const d = State.editor.drawflow.drawflow.Home.data[drawflowId];
  if (d) d.html = html;
  const nodeEl = document.getElementById('node-' + drawflowId);
  if (nodeEl) {
    const custom = nodeEl.querySelector('.drawflow-node-custom');
    if (custom) custom.outerHTML = html;
    else nodeEl.insertAdjacentHTML('beforeend', html);
  }
}

function addNode(nodeType) {
  const titles = { start_end: 'Mulai', process: 'Proses Baru', task: 'Task Baru', decision: 'Keputusan?', application: 'Aplikasi', note: 'Catatan Baru', workflow_link: 'Lanjut ke Workflow' };
  const n = {
    id: Store.generateId('node'),
    nodeType: nodeType,
    title: titles[nodeType] || 'Node Baru',
    description: '',
    positionX: 100 + Math.random() * 200,
    positionY: 100 + Math.random() * 100,
    task: null,
    linkedWorkflowId: '',
    linkedWorkflowName: '',
  };
  const drawflowId = addNodeToCanvas(n);
  if (nodeType === 'workflow_link') {
    // Langsung buka panel supaya user bisa memilih workflow tujuan.
    if (State.editor && State.editor.drawflow) {
      const d = State.editor.drawflow.drawflow.Home.data[drawflowId];
      if (d) {
        State.selectedNode = { drawflowId: drawflowId, customId: n.id, nodeType: n.nodeType, title: n.title };
        renderNodePanel(d.data);
      }
    }
  }
  setCanvasDirty();
  toast(`Node ${NODE_TYPE_LABEL[nodeType] || nodeType} ditambahkan`, 'info');
}

// Canvas keyboard shortcuts
document.addEventListener('keydown', (e) => {
  try {
    const s = (typeof State !== 'undefined') ? State : null;
    if (!s || !s.view || s.view.kind !== 'canvas') return;
    const target = e.target;
    if (target) {
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && String(e.key).toLowerCase() === 'z') {
      e.preventDefault();
      if (typeof undoCanvas === 'function') undoCanvas();
    }
  } catch (ex) {}
});

function setCanvasDirty() {
  State.canvasDirty = true;
  const ind = $('#save-indicator');
  if (ind) {
    ind.className = 'inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber/15 text-[#8A5F10]';
    ind.innerHTML = '<span class="h-1.5 w-1.5 rounded-full bg-amber"></span>Belum tersimpan';
  }
  if (window._canvasSaveTimer) clearTimeout(window._canvasSaveTimer);
  window._canvasSaveTimer = setTimeout(() => saveCanvas(), 3000);
}

async function saveCanvas() {
  if (!State.editor || !State.currentWorkflowId) return;
  const btn = $('#save-canvas-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<div class="spinner"></div>Menyimpan...'; }
  const ind = $('#save-indicator');
  if (ind) {
    ind.className = 'inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-sage/20 text-ferndeep';
    ind.innerHTML = '<div class="spinner"></div>Menyimpan...';
  }

  const exportData = State.editor.export();
  const nodesArr = [];
  const edgesArr = [];
  const homeData = exportData.drawflow.Home.data;
  for (const drawflowId in homeData) {
    const node = homeData[drawflowId];
    const customId = node.data.id || ('tmp_' + drawflowId);
    nodesArr.push({
      id: customId,
      nodeType: node.data.nodeType,
      title: node.data.title,
      description: node.data.description || '',
      positionX: Math.round(node.pos_x),
      positionY: Math.round(node.pos_y),
      width: 180,
      height: 80,
      taskId: node.data.task ? node.data.task.id : null,
      linkedWorkflowId: node.data.linkedWorkflowId || '',
    });
    if (node.outputs) {
      for (const outKey in node.outputs) {
        for (const conn of node.outputs[outKey].connections) {
          const targetNode = homeData[conn.node];
          if (targetNode) {
            const targetDrawflowId = conn.node;
            const connSvg = State.editor.container.querySelector(`.connection.node_in_node-${targetDrawflowId}.node_out_node-${drawflowId}.${outKey}.${conn.output || 'input_1'}`);
            edgesArr.push({
              id: 'edge_' + drawflowId + '_' + outKey + '_' + conn.node,
              source: customId,
              target: targetNode.data.id || ('tmp_' + conn.node),
              sourceOutput: outKey || 'output_1',
              targetInput: conn.output || 'input_1',
              label: (connSvg && connSvg.dataset) ? (connSvg.dataset.label || '') : '',
              condition: '',
            });
          }
        }
      }
    }
  }

  const payload = {
    workflowId: State.currentWorkflowId,
    nodes: nodesArr,
    edges: edgesArr,
    canvasSettings: JSON.stringify({ zoom: State.editor.zoom || 0.85, x: State.editor.canvas_x, y: State.editor.canvas_y }),
    expectedVersion: State.canvasVersion,
  };

  const res = await callServer('saveCanvasLayout', payload);
  if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="save" class="h-3.5 w-3.5"></i>Simpan'; refreshIcons(); }
  if (res.success) {
    State.canvasDirty = false;
    if (res.data && res.data.version) State.canvasVersion = res.data.version;
    if (ind) {
      ind.className = 'inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-fernlight/15 text-ferndeep';
      ind.innerHTML = '<span class="h-1.5 w-1.5 rounded-full bg-fern"></span>Tersimpan';
    }
  } else if (res.errorCode === 'VERSION_CONFLICT') {
    toast('Konflik versi', 'error', 'Memuat ulang...');
    setTimeout(() => setView({ kind: 'canvas', workflowId: State.currentWorkflowId, workflowName: State.currentWorkflowName }), 1500);
  } else {
    toast(res.message || 'Gagal menyimpan', 'error');
    if (ind) {
      ind.className = 'inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-berry/10 text-berry';
      ind.innerHTML = '<span class="h-1.5 w-1.5 rounded-full bg-berry"></span>Gagal';
    }
  }
}

/* --- Panel detail node --- */

const NODE_PANEL_EMPTY_HINT = 'Pilih node untuk melihat detail, atau tambah node baru dari '
  + '<span class="md:hidden">panel bawah</span><span class="hidden md:inline">panel kiri</span>.';

/* --- Detail workflow: panel kanan + modal -------------------- */

const WF_PREVIEW_COLORS = {
  start_end: '#2F7D5B', process: '#4B6B8A', task: '#8A6D3B',
  decision: '#A15C3E', application: '#5A4B8A', note: '#7A7A6A', workflow_link: '#3E7C7C',
};

function wfAppTargetLabel(link) {
  if (link && link.targetType === 'node') {
    return link.targetNodeTitle ? 'Node · ' + link.targetNodeTitle : 'Node';
  }
  return 'Workflow';
}

// Aplikasi yang menempel lewat task di tiap node (data lama / dari task).
function wfTaskAppsByNode(nodes) {
  return (nodes || []).map((n) => {
    const seen = {};
    const apps = [];
    (n.tasks || []).forEach((t) => {
      (t.applications || []).forEach((a) => {
        const key = String(a.taskAppId || a.id || a.url || a.name);
        if (seen[key]) return;
        seen[key] = true;
        apps.push(a);
      });
    });
    return { nodeId: n.id, nodeTitle: n.title || 'Tanpa judul', apps };
  }).filter((x) => x.apps.length > 0);
}

function workflowAppLinkRow(link, editable) {
  const isNode = link.targetType === 'node';
  const initial = String(link.name || '?').charAt(0).toUpperCase();
  return `
    <div class="flex items-center gap-2 rounded-lg border border-line bg-card px-2 py-1.5">
      <div class="h-7 w-7 rounded-md bg-fernlight/15 text-ferndeep flex items-center justify-center text-[11px] font-semibold shrink-0">${escapeHtml(initial)}</div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-1.5 min-w-0">
          <a href="${escapeHtml(link.url || '#')}" target="_blank" rel="noopener" class="text-xs font-medium truncate hover:text-fern ${link.missing ? 'pointer-events-none line-through text-inksoft' : ''}">${escapeHtml(link.name || 'Aplikasi')}</a>
          <span class="badge ${isNode ? 'badge-dept' : 'badge-cat'} shrink-0" title="Jenis koneksi">${escapeHtml(wfAppTargetLabel(link))}</span>
        </div>
        ${link.linkLabel ? `<p class="text-[10px] text-inksoft truncate">${escapeHtml(link.linkLabel)}</p>` : ''}
      </div>
      ${editable ? `<button type="button" class="btn btn-ghost btn-sm h-6 w-6 p-0 text-berry hover:bg-berry/10 shrink-0" data-wf-app-unlink="${escapeHtml(link.id || '')}" title="Lepas tautan aplikasi" aria-label="Lepas tautan aplikasi"><i data-lucide="unlink" class="h-3 w-3"></i></button>` : ''}
    </div>
  `;
}

function workflowAppsSectionHtml(detail, opts) {
  opts = opts || {};
  const editable = opts.editable !== false;
  const links = detail.links || [];
  const wfLinks = links.filter((l) => l.targetType !== 'node');
  const nodeLinks = links.filter((l) => l.targetType === 'node');
  const nodeTaskApps = wfTaskAppsByNode(detail.wf && detail.wf.nodes);
  const total = links.length + nodeTaskApps.reduce((sum, g) => sum + g.apps.length, 0);

  const group = (title, rowsHtml) => rowsHtml ? `
    <div class="space-y-1.5">
      <p class="text-[10px] font-semibold uppercase tracking-wide text-inksoft">${escapeHtml(title)}</p>
      ${rowsHtml}
    </div>` : '';

  return `
    <div class="rounded-lg border border-line bg-paper/40 p-3 space-y-2.5">
      <div class="flex items-center justify-between gap-2">
        <p class="text-xs font-semibold">Aplikasi terkait</p>
        <span class="text-[10px] text-inksoft">${total} aplikasi</span>
      </div>
      ${total === 0 ? `<p class="text-[11px] text-inksoft">Belum ada aplikasi yang ditautkan.<br><span class="text-[10px]">Tautkan aplikasi yang sudah ada atau tambahkan yang baru untuk mempermudah akses tim.</span></p>` : ''}
      ${group('Langsung ke workflow', wfLinks.map((l) => workflowAppLinkRow(l, editable)).join(''))}
      ${group('Ke node', nodeLinks.map((l) => workflowAppLinkRow(l, editable)).join(''))}
      ${nodeTaskApps.length ? `
        <div class="space-y-1.5">
          <p class="text-[10px] font-semibold uppercase tracking-wide text-inksoft">Dari task di node</p>
          ${nodeTaskApps.map((g) => `
            <div class="space-y-1">
              <p class="text-[10px] text-inksoft truncate">${escapeHtml(g.nodeTitle)}</p>
              ${g.apps.map((a) => workflowAppLinkRow({ name: a.name, url: a.url, linkLabel: a.linkLabel, targetType: 'node', targetNodeTitle: g.nodeTitle }, false)).join('')}
            </div>
          `).join('')}
        </div>` : ''}
      ${editable ? `
        <div class="flex flex-col gap-1.5 pt-1">
          <button type="button" class="btn btn-primary btn-sm w-full justify-start" data-wf-app-link-existing><i data-lucide="link" class="h-3.5 w-3.5"></i>Tautkan aplikasi yang sudah ada</button>
          <button type="button" class="btn btn-secondary btn-sm w-full justify-start" data-wf-app-link-new><i data-lucide="plus" class="h-3.5 w-3.5"></i>Tambah aplikasi baru & tautkan</button>
        </div>` : ''}
    </div>
  `;
}

// Pratinjau diagram sederhana (SVG) dari data node & edge canvas.
function workflowMiniDiagramSvg(nodes, edges) {
  const list = nodes || [];
  if (list.length === 0) {
    return `<div class="h-[200px] flex flex-col items-center justify-center text-center text-inksoft">
      <i data-lucide="layout-dashboard" class="h-6 w-6 text-inksoft/40"></i>
      <p class="text-xs mt-1.5">Canvas masih kosong</p>
    </div>`;
  }
  const byId = {};
  list.forEach((n) => { byId[String(n.id)] = n; });
  const sizeOf = (n) => ({
    x: Number(n.positionX) || 0,
    y: Number(n.positionY) || 0,
    w: Number(n.width) || 180,
    h: Number(n.height) || 80,
  });
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  list.forEach((n) => {
    const s = sizeOf(n);
    minX = Math.min(minX, s.x); minY = Math.min(minY, s.y);
    maxX = Math.max(maxX, s.x + s.w); maxY = Math.max(maxY, s.y + s.h);
  });
  const pad = 44;
  const vbX = minX - pad;
  const vbY = minY - pad;
  const vbW = Math.max(260, maxX - minX + pad * 2);
  const vbH = Math.max(170, maxY - minY + pad * 2);

  const edgeSvg = (edges || []).map((e) => {
    const a = byId[String(e.source)];
    const b = byId[String(e.target)];
    if (!a || !b) return '';
    const sa = sizeOf(a), sb = sizeOf(b);
    const ax = sa.x + sa.w / 2, ay = sa.y + sa.h / 2;
    const bx = sb.x + sb.w / 2, by = sb.y + sb.h / 2;
    const mx = (ax + bx) / 2;
    return `<path d="M ${ax} ${ay} C ${mx} ${ay}, ${mx} ${by}, ${bx} ${by}" fill="none" stroke="#B7C3BB" stroke-width="2" marker-end="url(#wf-preview-arrow)"/>`;
  }).join('');

  const nodeSvg = list.map((n) => {
    const s = sizeOf(n);
    const color = WF_PREVIEW_COLORS[n.nodeType] || '#4B6B8A';
    const title = String(n.title || 'Untitled');
    const short = title.length > 24 ? title.slice(0, 23) + '…' : title;
    return `<g>
      <rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="10" fill="#FFFFFF" stroke="${color}" stroke-width="2"/>
      <rect x="${s.x}" y="${s.y}" width="6" height="${s.h}" rx="3" fill="${color}"/>
      <text x="${s.x + 16}" y="${s.y + s.h / 2 + 5}" font-size="13" fill="#24312B" font-family="ui-sans-serif, system-ui, sans-serif">${escapeHtml(short)}</text>
    </g>`;
  }).join('');

  return `<svg viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="100%" height="220" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Pratinjau diagram workflow">
    <defs>
      <marker id="wf-preview-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#B7C3BB"/>
      </marker>
    </defs>
    ${edgeSvg}${nodeSvg}
  </svg>`;
}

async function fetchWorkflowDetail(workflowId) {
  const [canvasRes, linksRes] = await Promise.all([
    callServer('getWorkflowCanvas', workflowId),
    callServer('getWorkflowAppLinks', workflowId),
  ]);
  if (!canvasRes.success) return { error: canvasRes.message || 'Gagal memuat detail workflow' };
  return { wf: canvasRes.data || {}, links: linksRes.success ? (linksRes.data || []) : [] };
}

/* Dialog untuk menautkan aplikasi ke workflow atau node. */
function openWorkflowAppLinkDialog(options) {
  options = options || {};
  const workflowId = options.workflowId;
  const nodes = options.nodes || [];
  const onDone = options.onDone;
  let mode = options.mode === 'new' ? 'new' : 'existing';
  let apps = [];
  const previouslyFocused = document.activeElement;

  const targetOptions = `<option value="workflow">Workflow ini (langsung)</option>`
    + nodes.map((n) => `<option value="node:${escapeHtml(n.id)}">Node · ${escapeHtml(n.title || 'Tanpa judul')}</option>`).join('');

  const backdrop = document.createElement('div');
  backdrop.className = 'fixed inset-0 z-[85] bg-ink/40 flex items-center justify-center p-4';
  backdrop.innerHTML = `
    <div class="bg-card rounded-xl shadow-soft max-w-md w-full max-h-[92vh] flex flex-col" role="dialog" aria-modal="true" aria-labelledby="wf-app-link-title">
      <div class="px-5 py-3 border-b border-line flex items-center justify-between gap-3 shrink-0">
        <h3 id="wf-app-link-title" class="text-base font-semibold">Tautkan aplikasi</h3>
        <button type="button" class="btn btn-ghost btn-sm h-7 w-7 p-0" data-wf-app-cancel aria-label="Tutup"><i data-lucide="x" class="h-4 w-4"></i></button>
      </div>
      <div class="p-4 overflow-y-auto space-y-3">
        <div class="flex rounded-md border border-line p-0.5 bg-paper text-xs">
          <button type="button" class="flex-1 px-2 py-1.5 rounded" data-wf-app-tab="existing">Aplikasi yang ada</button>
          <button type="button" class="flex-1 px-2 py-1.5 rounded" data-wf-app-tab="new">Aplikasi baru</button>
        </div>
        <div data-wf-app-mode="existing" class="space-y-1.5">
          <label class="form-label">Pilih aplikasi</label>
          <select id="wf-app-pick" class="form-select text-sm"><option value="">Memuat aplikasi...</option></select>
          <p class="text-[10px] text-inksoft">Belum ada aplikasi? Pindah ke tab "Aplikasi baru".</p>
        </div>
        <div data-wf-app-mode="new" class="space-y-2">
          <div><label class="form-label">Nama aplikasi</label><input id="wf-app-name" class="form-input text-sm" placeholder="Contoh: Google Drive"></div>
          <div><label class="form-label">URL</label><input id="wf-app-url" class="form-input text-sm" placeholder="https://..."></div>
          <div><label class="form-label">Kategori</label><input id="wf-app-cat" class="form-input text-sm" placeholder="Other"></div>
        </div>
        <div>
          <label class="form-label">Jenis koneksi</label>
          <select id="wf-app-target" class="form-select text-sm">${targetOptions}</select>
          <p class="text-[10px] text-inksoft mt-1">Pilih "Workflow ini" untuk tautan langsung, atau node tertentu.</p>
        </div>
        <div>
          <label class="form-label">Label tautan <span class="text-inksoft font-normal">(opsional)</span></label>
          <input id="wf-app-label" class="form-input text-sm" placeholder="Contoh: Template onboarding">
        </div>
      </div>
      <div class="px-5 py-3 border-t border-line flex justify-end gap-2 shrink-0">
        <button type="button" class="btn btn-secondary btn-sm" data-wf-app-cancel>Batal</button>
        <button type="button" class="btn btn-primary btn-sm" id="wf-app-submit"><i data-lucide="link" class="h-3.5 w-3.5"></i>Tautkan</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  refreshIcons();

  const pickEl = backdrop.querySelector('#wf-app-pick');
  const submitBtn = backdrop.querySelector('#wf-app-submit');

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    backdrop.remove();
    if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus({ preventScroll: true });
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  document.addEventListener('keydown', onKey, true);

  const renderMode = () => {
    backdrop.querySelectorAll('[data-wf-app-tab]').forEach((b) => {
      const active = b.dataset.wfAppTab === mode;
      b.className = `flex-1 px-2 py-1.5 rounded ${active ? 'bg-ink text-paper font-medium' : 'text-inksoft hover:text-ink'}`;
    });
    backdrop.querySelectorAll('[data-wf-app-mode]').forEach((el) => {
      el.classList.toggle('hidden', el.dataset.wfAppMode !== mode);
    });
  };
  backdrop.querySelectorAll('[data-wf-app-tab]').forEach((b) => {
    b.addEventListener('click', () => { mode = b.dataset.wfAppTab; renderMode(); });
  });
  backdrop.querySelectorAll('[data-wf-app-cancel]').forEach((b) => b.addEventListener('click', close));
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  renderMode();

  (async () => {
    const res = await callServer('listApplications');
    apps = res.success ? (res.data || []) : [];
    if (!pickEl) return;
    if (apps.length === 0) {
      pickEl.innerHTML = '<option value="">Belum ada aplikasi di Application Hub</option>';
      return;
    }
    pickEl.innerHTML = '<option value="">— Pilih aplikasi —</option>' + apps.map((a) =>
      `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}${a.category ? ' · ' + escapeHtml(a.category) : ''}</option>`).join('');
  })();

  submitBtn.addEventListener('click', async () => {
    const targetVal = (backdrop.querySelector('#wf-app-target') || {}).value || 'workflow';
    const targetType = targetVal.indexOf('node:') === 0 ? 'node' : 'workflow';
    const targetNodeId = targetType === 'node' ? targetVal.slice(5) : '';
    const labelEl = backdrop.querySelector('#wf-app-label');
    const linkLabel = labelEl ? labelEl.value.trim() : '';

    submitBtn.disabled = true;
    let res;
    if (mode === 'existing') {
      const appId = pickEl ? pickEl.value : '';
      if (!appId) {
        submitBtn.disabled = false;
        toast('Pilih aplikasi terlebih dahulu', 'error');
        return;
      }
      res = await callServer('linkApplicationToWorkflow', {
        workflowId, appId, targetType, targetNodeId, linkLabel,
      });
    } else {
      const nameEl = backdrop.querySelector('#wf-app-name');
      const urlEl = backdrop.querySelector('#wf-app-url');
      const catEl = backdrop.querySelector('#wf-app-cat');
      const name = nameEl ? nameEl.value.trim() : '';
      const url = urlEl ? urlEl.value.trim() : '';
      const category = catEl ? catEl.value.trim() : '';
      if (!name || !url) {
        submitBtn.disabled = false;
        toast('Nama dan URL aplikasi wajib diisi', 'error');
        return;
      }
      res = await callServer('linkNewApplicationToWorkflow', {
        workflowId, name, url, category, targetType, targetNodeId, linkLabel,
      });
    }
    submitBtn.disabled = false;
    if (!res || !res.success) {
      toast((res && res.message) || 'Gagal menautkan aplikasi', 'error');
      return;
    }
    toast(res.message || 'Aplikasi ditautkan');
    close();
    if (typeof onDone === 'function') onDone();
  });
}

// Aksi pada bagian aplikasi (dipakai panel kanan dan modal detail).
function wireWorkflowDetailActions(root, detail, refresh) {
  if (!root || !detail || !detail.wf) return;
  const workflowId = detail.wf.workflowId;
  const nodes = detail.wf.nodes || [];

  root.querySelectorAll('[data-wf-app-link-existing]').forEach((btn) => {
    btn.addEventListener('click', () => openWorkflowAppLinkDialog({
      workflowId, nodes, mode: 'existing', onDone: refresh,
    }));
  });
  root.querySelectorAll('[data-wf-app-link-new]').forEach((btn) => {
    btn.addEventListener('click', () => openWorkflowAppLinkDialog({
      workflowId, nodes, mode: 'new', onDone: refresh,
    }));
  });
  root.querySelectorAll('[data-wf-app-unlink]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const linkId = btn.dataset.wfAppUnlink;
      const link = (detail.links || []).find((l) => String(l.id) === String(linkId));
      const ok = await showConfirmDialog({
        title: 'Lepas tautan aplikasi?',
        message: `"${link ? link.name : 'Aplikasi'}" akan dilepas dari ${link ? wfAppTargetLabel(link) : 'workflow'}. Aplikasinya tetap tersimpan di Application Hub.`,
        confirmText: 'Lepas',
        cancelText: 'Batal',
        danger: true,
      });
      if (!ok) return;
      const res = await callServer('unlinkWorkflowAppLink', { workflowId, linkId });
      if (!res.success) {
        toast(res.message || 'Gagal melepas tautan', 'error');
        return;
      }
      toast('Tautan aplikasi dilepas');
      if (typeof refresh === 'function') refresh();
    });
  });
}

let wfPanelDetail = null;

function renderWorkflowDetailPanelContent(detail) {
  wfPanelDetail = detail;
  const panel = $('#node-detail-panel');
  const body = $('#node-detail-body');
  if (!body) return;
  if (panel) panel.classList.add('is-open');
  const wf = detail.wf || {};
  const depts = (wf.departments || []).map((d) => `<span class="badge badge-dept">${escapeHtml(d)}</span>`).join('');
  body.innerHTML = `
    <div class="space-y-4">
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="badge bg-paper text-ink">Workflow</span>
        ${wf.category ? `<span class="badge badge-cat"><i data-lucide="tag" class="h-2.5 w-2.5"></i>${escapeHtml(wf.category)}</span>` : ''}
        ${depts}
      </div>
      <div>
        <h3 class="text-sm font-semibold">${escapeHtml(wf.workflowName || '')}</h3>
        <p class="text-xs text-inksoft mt-1 leading-relaxed">${escapeHtml(wf.description || 'Tanpa deskripsi')}</p>
      </div>
      <div class="grid grid-cols-3 gap-1.5 text-center">
        <div class="rounded-md border border-line bg-paper/50 py-1.5"><p class="text-sm font-semibold tabular-nums">${Number(wf.taskCount) || 0}</p><p class="text-[9px] text-inksoft uppercase tracking-wide">Task</p></div>
        <div class="rounded-md border border-line bg-paper/50 py-1.5"><p class="text-sm font-semibold tabular-nums">${Number(wf.progress) || 0}%</p><p class="text-[9px] text-inksoft uppercase tracking-wide">Progress</p></div>
        <div class="rounded-md border border-line bg-paper/50 py-1.5"><p class="text-sm font-semibold tabular-nums">${(wf.nodes || []).length}</p><p class="text-[9px] text-inksoft uppercase tracking-wide">Node</p></div>
      </div>
      ${workflowAppsSectionHtml(detail, { editable: true })}
      <button type="button" class="btn btn-secondary w-full justify-start" data-wf-detail-modal><i data-lucide="info" class="h-3.5 w-3.5"></i>Lihat detail lengkap</button>
    </div>
  `;
  refreshIcons();
  wireWorkflowDetailActions(body, detail, refreshWorkflowPanel);
  const modalBtn = body.querySelector('[data-wf-detail-modal]');
  if (modalBtn) {
    modalBtn.addEventListener('click', () => showWorkflowDetailModal(wf.workflowId, wf.workflowName, detail));
  }
}

async function refreshWorkflowPanel() {
  const current = wfPanelDetail && wfPanelDetail.wf;
  if (!current || !current.workflowId) return;
  const detail = await fetchWorkflowDetail(current.workflowId);
  if (detail.wf) renderWorkflowDetailPanelContent(detail);
}

async function showWorkflowDetailPanel(workflowId) {
  const panel = $('#node-detail-panel');
  const body = $('#node-detail-body');
  if (!panel || !body || !workflowId) return;
  panel.classList.add('is-open');
  body.innerHTML = `<div class="text-xs text-inksoft text-center mt-8">Memuat detail workflow...</div>`;
  const detail = await fetchWorkflowDetail(workflowId);
  if (!detail.wf) {
    body.innerHTML = `<p class="text-xs text-berry text-center mt-8">${escapeHtml(detail.error || 'Gagal memuat detail workflow')}</p>`;
    return;
  }
  renderWorkflowDetailPanelContent(detail);
}

// Modal detail workflow lengkap (dibuka dari daftar workflow).
async function showWorkflowDetailModal(workflowId, workflowName, initialDetail) {
  let detail = initialDetail || await fetchWorkflowDetail(workflowId);
  if (!detail || !detail.wf) {
    toast((detail && detail.error) || 'Gagal memuat detail workflow', 'error');
    return;
  }
  const previouslyFocused = document.activeElement;
  const backdrop = document.createElement('div');
  backdrop.className = 'fixed inset-0 z-[75] bg-ink/40 flex items-center justify-center p-4';
  backdrop.innerHTML = `
    <div class="bg-card rounded-xl shadow-soft max-w-3xl w-full max-h-[92vh] flex flex-col" role="dialog" aria-modal="true" aria-labelledby="wf-detail-title">
      <div class="px-5 py-3 border-b border-line flex items-start justify-between gap-3 shrink-0">
        <div class="min-w-0">
          <h3 id="wf-detail-title" class="text-base font-semibold truncate">${escapeHtml(detail.wf.workflowName || workflowName || 'Detail Workflow')}</h3>
          <p class="text-[11px] text-inksoft">Detail workflow & aplikasi terkait</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm h-7 w-7 p-0" data-wf-detail-close aria-label="Tutup"><i data-lucide="x" class="h-4 w-4"></i></button>
      </div>
      <div class="p-5 overflow-y-auto space-y-4" id="wf-detail-body"></div>
      <div class="px-5 py-3 border-t border-line flex items-center justify-between gap-2 shrink-0">
        <button type="button" class="btn btn-ghost btn-sm" data-wf-detail-close>Tutup</button>
        <button type="button" class="btn btn-primary btn-sm" data-wf-detail-open-canvas><i data-lucide="layout-dashboard" class="h-3.5 w-3.5"></i>Buka canvas</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  refreshIcons();

  const bodyEl = backdrop.querySelector('#wf-detail-body');
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    backdrop.remove();
    if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus({ preventScroll: true });
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  document.addEventListener('keydown', onKey, true);
  backdrop.querySelectorAll('[data-wf-detail-close]').forEach((b) => b.addEventListener('click', close));
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector('[data-wf-detail-open-canvas]').addEventListener('click', () => {
    const wf = detail.wf;
    close();
    setView({ kind: 'canvas', workflowId: wf.workflowId, workflowName: wf.workflowName });
  });

  const renderBody = () => {
    const wf = detail.wf || {};
    const depts = (wf.departments || []).map((d) => `<span class="badge badge-dept">${escapeHtml(d)}</span>`).join('');
    const linkCount = (detail.links || []).length + wfTaskAppsByNode(wf.nodes).reduce((s, g) => s + g.apps.length, 0);
    bodyEl.innerHTML = `
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="badge bg-paper text-ink">Workflow</span>
        ${wf.category ? `<span class="badge badge-cat"><i data-lucide="tag" class="h-2.5 w-2.5"></i>${escapeHtml(wf.category)}</span>` : ''}
        ${depts}
      </div>
      <div>
        <p class="text-sm text-inksoft leading-relaxed whitespace-pre-wrap">${escapeHtml(wf.description || 'Tanpa deskripsi')}</p>
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
        <div class="rounded-lg border border-line bg-paper/50 py-2"><p class="text-base font-semibold tabular-nums">${Number(wf.taskCount) || 0}</p><p class="text-[9px] text-inksoft uppercase tracking-wide">Task</p></div>
        <div class="rounded-lg border border-line bg-paper/50 py-2"><p class="text-base font-semibold tabular-nums">${Number(wf.progress) || 0}%</p><p class="text-[9px] text-inksoft uppercase tracking-wide">Progress</p></div>
        <div class="rounded-lg border border-line bg-paper/50 py-2"><p class="text-base font-semibold tabular-nums">${(wf.nodes || []).length}</p><p class="text-[9px] text-inksoft uppercase tracking-wide">Node</p></div>
        <div class="rounded-lg border border-line bg-paper/50 py-2"><p class="text-base font-semibold tabular-nums">${linkCount}</p><p class="text-[9px] text-inksoft uppercase tracking-wide">Tautan app</p></div>
      </div>
      ${workflowAppsSectionHtml(detail, { editable: true })}
      <div>
        <div class="flex items-center justify-between mb-2 gap-2">
          <p class="text-xs font-semibold">Pratinjau diagram</p>
          <span class="text-[10px] text-inksoft">${(wf.nodes || []).length} node · ${(wf.edges || []).length} koneksi</span>
        </div>
        <div class="rounded-lg border border-line bg-paper/40 overflow-hidden">
          ${workflowMiniDiagramSvg(wf.nodes, wf.edges)}
        </div>
      </div>`;
    refreshIcons();
    wireWorkflowDetailActions(bodyEl, detail, async () => {
      const next = await fetchWorkflowDetail(wf.workflowId);
      if (next.wf) {
        detail = next;
        renderBody();
      }
      if (State.currentWorkflowId && String(State.currentWorkflowId) === String(wf.workflowId)) {
        refreshWorkflowPanel();
      }
    });
  };

  renderBody();
}

function showNodePanelEmpty() {
  const panel = $('#node-detail-panel');
  const body = $('#node-detail-body');
  if (!panel || !body) return;
  panel.classList.remove('is-open');
  if (State.view && State.view.kind === 'canvas' && State.currentWorkflowId) {
    showWorkflowDetailPanel(State.currentWorkflowId);
    return;
  }
  body.innerHTML = `
    <div class="text-center mt-8 px-3">
      <div class="h-9 w-9 mx-auto rounded-full bg-paper border border-line flex items-center justify-center mb-2">
        <i data-lucide="mouse-pointer-click" class="h-4 w-4 text-inksoft"></i>
      </div>
      <p class="text-xs font-medium">Pilih node untuk melihat detail</p>
      <p class="text-[11px] text-inksoft mt-1 leading-relaxed">${NODE_PANEL_EMPTY_HINT}</p>
    </div>
  `;
  refreshIcons();
}

/* Modal konfirmasi buatan sendiri (tanpa confirm() bawaan browser). */
function showConfirmDialog(options = {}) {
  return new Promise((resolve) => {
    const title = options.title || 'Konfirmasi';
    const message = options.message || '';
    const confirmText = options.confirmText || 'Ya';
    const cancelText = options.cancelText || 'Batal';
    const danger = options.danger !== false;
    const previouslyFocused = document.activeElement;
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 z-[80] bg-ink/40 flex items-center justify-center p-4';
    modal.innerHTML = `
      <div class="bg-card rounded-xl shadow-soft max-w-sm w-full" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-message">
        <div class="px-5 py-4 border-b border-line flex items-start justify-between gap-3">
          <h3 id="confirm-dialog-title" class="text-base font-semibold">${escapeHtml(title)}</h3>
          <button type="button" class="btn btn-ghost btn-sm h-7 w-7 p-0" data-confirm-cancel aria-label="Tutup"><i data-lucide="x" class="h-4 w-4"></i></button>
        </div>
        <div class="px-5 py-4">
          <p id="confirm-dialog-message" class="text-sm text-inksoft leading-relaxed">${escapeHtml(message)}</p>
        </div>
        <div class="px-5 py-3 border-t border-line flex justify-end gap-2">
          <button type="button" class="btn btn-secondary btn-sm" data-confirm-cancel>${escapeHtml(cancelText)}</button>
          <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'} btn-sm" data-confirm-ok>${escapeHtml(confirmText)}</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    refreshIcons();

    let done = false;
    const close = (value) => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      modal.remove();
      if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus({ preventScroll: true });
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(false); return; }
      if (e.key !== 'Tab') return;
      const focusables = Array.from(modal.querySelectorAll('button')).filter(b => !b.disabled);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(false); });
    modal.querySelectorAll('[data-confirm-cancel]').forEach(b => b.addEventListener('click', () => close(false)));
    modal.querySelector('[data-confirm-ok]').addEventListener('click', () => close(true));
    // Fokus awal ke "Batal" agar aksi berbahaya tidak terpicu tanpa sengaja.
    const cancelBtn = modal.querySelector('.border-t [data-confirm-cancel]');
    if (cancelBtn) cancelBtn.focus({ preventScroll: true });
  });
}

function renderNodePanel(node) {
  const panel = $('#node-detail-panel');
  const body = $('#node-detail-body');
  if (!panel || !body) return;
  panel.classList.add('is-open');
  const linkedTasks = Array.isArray(node.tasks) ? node.tasks : (node.task ? [node.task] : []);
  const taskCount = linkedTasks.length;
  const atTaskLimit = taskCount >= 5;
  const avgTaskProgress = taskCount
    ? Math.round(linkedTasks.reduce((sum, t) => sum + (Number(t.progress) || 0), 0) / taskCount)
    : 0;
  const linkedApps = [];
  const seenLinkedApps = {};
  linkedTasks.forEach(t => (t.applications || []).forEach(a => {
    const key = String(a.id || a.url || a.name || '');
    if (seenLinkedApps[key]) return;
    seenLinkedApps[key] = true;
    linkedApps.push(a);
  }));
  body.innerHTML = `
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <span class="badge bg-paper text-ink capitalize">${escapeHtml(NODE_TYPE_LABEL[node.nodeType] || node.nodeType)}</span>
        <button id="panel-delete-node" class="btn btn-ghost btn-sm text-berry hover:bg-berry/10" title="Hapus node"><i data-lucide="trash-2" class="h-3.5 w-3.5"></i></button>
      </div>
      <div>
        <label class="form-label">Tipe Node</label>
        <select id="panel-node-type" class="form-select">
          ${NODE_TYPES.map(t => `<option value="${t.id}" ${t.id === node.nodeType ? 'selected' : ''}>${escapeHtml(t.label)}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="form-label">Judul Node</label>
        <input type="text" id="panel-node-title" class="form-input" value="${escapeHtml(node.title || '')}">
      </div>
      <div>
        <label class="form-label">Deskripsi</label>
        <textarea id="panel-node-desc" class="form-textarea" rows="3">${escapeHtml(node.description || '')}</textarea>
      </div>
      <div class="p-3 rounded-md border border-fernlight/40 bg-fernlight/10">
        <div class="flex items-center justify-between mb-1.5">
          <p class="text-xs font-medium text-ferndeep">Task terkait</p>
          <span class="text-[10px] font-mono text-inksoft" title="Maksimal 5 task per node">${taskCount}/5</span>
        </div>
        ${taskCount > 0 ? `
          <div class="flex items-center justify-between text-[10px] text-inksoft mb-2">
            <span>${taskCount} task</span>
            <span>Rata-rata ${avgTaskProgress}%</span>
          </div>
          <div class="space-y-1.5">
            ${linkedTasks.map(t => `
              <div class="group relative rounded-md border border-line bg-card transition-colors hover:border-fern/40 hover:bg-fernlight/5">
                <button type="button" class="absolute inset-0 z-0 w-full rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-fern/40 focus-visible:ring-inset" data-task-card="${escapeHtml(t.id)}" aria-label="Buka detail task ${escapeHtml(t.title)}" title="Buka detail task"></button>
                <div class="relative z-10 pointer-events-none flex items-start gap-2 p-2">
                  <div class="flex-1 min-w-0">
                    <p class="text-xs font-medium truncate transition-colors group-hover:text-ferndeep" title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</p>
                    <div class="flex items-center gap-1.5 mt-1">
                      <span class="badge badge-${escapeHtml(t.status)}">${escapeHtml(STATUS_LABEL[t.status] || t.status)}</span>
                      <span class="text-[10px] text-inksoft">${Number(t.progress) || 0}%</span>
                    </div>
                  </div>
                  <div class="shrink-0 border-l border-line pl-2 pointer-events-auto">
                    <button type="button" class="btn btn-ghost btn-sm h-7 w-7 p-0 text-berry hover:bg-berry/10" data-unlink-task="${escapeHtml(t.id)}" title="Lepas task dari node" aria-label="Lepas task dari node"><i data-lucide="unlink" class="h-3.5 w-3.5"></i></button>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        ` : `
          <p class="text-[11px] text-inksoft mb-2">Node ini belum punya task. Bisa buat baru atau hubungkan yang sudah ada.</p>
        `}
        ${atTaskLimit ? `
          <p class="text-[10px] text-inksoft mt-2 flex items-center gap-1"><i data-lucide="info" class="h-3 w-3 shrink-0"></i>Batas 5 task per node sudah tercapai.</p>
        ` : `
          <div class="flex flex-col gap-1.5 ${taskCount > 0 ? 'mt-2' : ''}">
            <button id="panel-create-task" class="btn btn-primary btn-sm w-full justify-start"><i data-lucide="plus" class="h-3.5 w-3.5"></i>Buat Task baru untuk node ini</button>
            <button id="panel-link-existing-task" class="btn btn-secondary btn-sm w-full justify-start"><i data-lucide="link" class="h-3.5 w-3.5"></i>Hubungkan task yang sudah ada</button>
          </div>
        `}
        ${linkedApps.length > 0 ? `
          <div class="mt-3 pt-3 border-t border-fernlight/30 space-y-1.5">
            <p class="label-mono text-[9px] text-ferndeep/80">Aplikasi Terkait</p>
            ${linkedApps.map(a => `
              <a href="${escapeHtml(a.url)}" target="_blank" rel="noopener" class="flex items-center gap-2 p-1.5 rounded-md border border-line bg-card hover:bg-paper transition-colors group">
                <div class="h-6 w-6 rounded-md bg-fernlight/15 text-ferndeep flex items-center justify-center text-[10px] font-semibold shrink-0">${escapeHtml((a.name || '?').charAt(0).toUpperCase())}</div>
                <div class="flex-1 min-w-0">
                  <p class="text-xs font-medium truncate">${escapeHtml(a.name || '')}</p>
                  ${a.linkLabel ? `<p class="text-[10px] text-inksoft truncate">${escapeHtml(a.linkLabel)}</p>` : ''}
                </div>
                <i data-lucide="external-link" class="h-3 w-3 text-inksoft/60 group-hover:text-fern shrink-0"></i>
              </a>
            `).join('')}
          </div>
        ` : ''}
      </div>
      ${node.nodeType === 'workflow_link' ? `
        <div class="p-3 rounded-md border border-clay/40 bg-clay/5">
          <p class="text-xs font-medium text-clay mb-1 flex items-center gap-1"><i data-lucide="link-2" class="h-3 w-3"></i>Workflow Lanjutan</p>
          <p class="text-[11px] text-inksoft mb-2">Saat node ini diklik, workflow tujuan akan dibuka.</p>
          <select id="panel-link-workflow" class="form-select text-xs">
            <option value="">— Belum ditautkan —</option>
          </select>
          <button id="panel-open-linked" class="btn btn-secondary btn-sm w-full justify-start mt-2 ${node.linkedWorkflowId ? '' : 'opacity-50 pointer-events-none'}">
            <i data-lucide="external-link" class="h-3.5 w-3.5"></i>Buka Workflow Tujuan
          </button>
        </div>
      ` : ''}
      <div id="node-comments" class="pt-1 border-t border-line"></div>
      <button id="panel-save-node" class="btn btn-primary w-full"><i data-lucide="save" class="h-3.5 w-3.5"></i>Simpan Perubahan</button>
      <p class="text-[10px] text-inksoft/50 leading-relaxed">Tips: tekan <kbd class="px-1 border rounded bg-paper">Delete</kbd> untuk menghapus node/koneksi yang dipilih.</p>
    </div>
  `;
  refreshIcons();
  $('#panel-save-node').addEventListener('click', saveNodeFromPanel);
  $('#panel-delete-node').addEventListener('click', deleteSelectedNode);
  const typeSel = document.getElementById('panel-node-type');
  if (typeSel) {
    typeSel.addEventListener('change', async (e) => {
      const sel = State.selectedNode;
      if (!sel) return;
      const newType = e.target.value;
      const d = State.editor.drawflow.drawflow.Home.data[sel.drawflowId];
      if (d) {
        d.data.nodeType = newType;
        if (newType !== 'workflow_link') {
          d.data.linkedWorkflowId = '';
          d.data.linkedWorkflowName = '';
        }
        const nodeEl = document.getElementById('node-' + sel.drawflowId);
        if (nodeEl) {
          nodeEl.classList.remove('type-start_end', 'type-process', 'type-task', 'type-decision', 'type-application', 'type-note', 'type-workflow_link');
          nodeEl.classList.add('type-' + newType);
        }
        setNodeCustomHtml(sel.drawflowId, nodeHtml(d.data));
        refreshIcons();
        attachNodeTaskButton(sel.drawflowId);
        renderNodePanel(d.data);
      }
      setCanvasDirty();
      await callServer('updateNode', { id: sel.customId, nodeType: newType });
      toast('Tipe node diperbarui');
    });
  }
  panel.querySelectorAll('[data-task-card]').forEach(btn => {
    btn.addEventListener('click', () => openTaskDrawer(btn.dataset.taskCard));
  });
  panel.querySelectorAll('[data-unlink-task]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (btn.disabled) return;
      const taskId = btn.dataset.unlinkTask;
      const task = linkedTasks.find(t => String(t.id) === String(taskId));
      const ok = await showConfirmDialog({
        title: 'Lepas task dari node?',
        message: `Task "${task ? task.title : 'ini'}" akan dilepas dari node "${node.title || ''}". Task tetap tersimpan di daftar task dan bisa dihubungkan lagi kapan saja.`,
        confirmText: 'Lepas Task',
        cancelText: 'Batal',
      });
      if (!ok) return;
      btn.disabled = true;
      const res = await callServer('unlinkTaskFromNode', { taskId });
      if (!res.success) {
        btn.disabled = false;
        toast(res.message || 'Gagal melepas task', 'error');
        return;
      }
      toast('Task dilepas dari node');
      await refreshSelectedNodeFromServer();
      setCanvasDirty();
    });
  });
  document.getElementById('panel-create-task')?.addEventListener('click', () => showTaskDialog({ workflowId: State.currentWorkflowId, nodeId: node.id, nodeTitle: node.title }));
  document.getElementById('panel-link-existing-task')?.addEventListener('click', () => showLinkExistingTaskToNodeModal(node));

  if (node.nodeType === 'workflow_link') {
    const wfSel = document.getElementById('panel-link-workflow');
    const openBtn = document.getElementById('panel-open-linked');
    if (wfSel) {
      (async () => {
        const wfRes = await callServer('listWorkflows');
        if (!wfRes.success) return;
        const opts = (wfRes.data || []).filter(w => String(w.id) !== String(State.currentWorkflowId));
        wfSel.innerHTML = `<option value="">— Belum ditautkan —</option>` +
          opts.map(w => `<option value="${escapeHtml(w.id)}" ${String(w.id) === String(node.linkedWorkflowId) ? 'selected' : ''}>${escapeHtml(w.name)}</option>`).join('');
        if (node.linkedWorkflowId && !opts.some(w => String(w.id) === String(node.linkedWorkflowId))) {
          wfSel.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(node.linkedWorkflowId)}" selected>Workflow tujuan (tidak aktif)</option>`);
        }
      })();
      wfSel.addEventListener('change', async () => {
        const sel2 = State.selectedNode;
        if (!sel2) return;
        const wfId = wfSel.value;
        const d2 = State.editor.drawflow.drawflow.Home.data[sel2.drawflowId];
        let wfName = '';
        if (wfId) {
          const canvasRes = await callServer('getWorkflowCanvas', wfId);
          if (canvasRes.success) wfName = canvasRes.data.workflowName || '';
        }
        if (d2) {
          d2.data.linkedWorkflowId = wfId;
          d2.data.linkedWorkflowName = wfName;
          setNodeCustomHtml(sel2.drawflowId, nodeHtml(d2.data));
          refreshIcons();
          attachNodeTaskButton(sel2.drawflowId);
          renderNodePanel(d2.data);
        }
        setCanvasDirty();
        await callServer('updateNode', { id: sel2.customId, linkedWorkflowId: wfId });
        toast(wfId ? 'Workflow tujuan ditautkan' : 'Tautan workflow dilepas');
      });
    }
    if (openBtn) {
      openBtn.addEventListener('click', () => {
        const wfId = (wfSel && wfSel.value) || node.linkedWorkflowId;
        if (wfId) openLinkedWorkflow(wfId);
      });
    }
  }
  mountCommentThread($('#node-comments'), 'node', node.id);
}

async function saveNodeFromPanel() {
  const sel = State.selectedNode;
  if (!sel) return;
  const title = $('#panel-node-title').value.trim();
  const desc = $('#panel-node-desc').value;
  if (!title) { toast('Judul node wajib diisi', 'error'); return; }
  // Update canvas lokal dulu agar UI langsung responsif.
  const d = State.editor.drawflow.drawflow.Home.data[sel.drawflowId];
  if (d) {
    d.data.title = title;
    d.data.description = desc;
    setNodeCustomHtml(sel.drawflowId, nodeHtml(d.data));
    refreshIcons();
    attachNodeTaskButton(sel.drawflowId);
  }
  setCanvasDirty();
  const res = await callServer('updateNode', { id: sel.customId, title, description: desc });
  if (res.success) {
    toast('Node diperbarui');
  } else if (res.errorCode === 'NOT_FOUND') {
    // Node baru yang belum tersimpan; autosave akan membuatnya.
    toast('Node diperbarui (tersimpan otomatis)');
  } else {
    toast(res.message || 'Gagal', 'error');
  }
}

async function deleteSelectedNode() {
  const sel = State.selectedNode;
  if (!sel) return;
  const ok = await showConfirmDialog({
    title: 'Hapus node?',
    message: 'Task yang tertaut tetap tersimpan; hanya relasinya ke node ini yang dilepas.',
    confirmText: 'Hapus Node',
    cancelText: 'Batal',
    danger: true,
  });
  if (!ok) return;
  // Hapus dari canvas dulu agar UI responsif (nodeRemoved memicu autosave).
  try { State.editor.removeNodeId('node-' + sel.drawflowId); } catch (e) {}
  State.selectedNode = null;
  showNodePanelEmpty();
  setCanvasDirty();
  const res = await callServer('deleteNode', sel.customId);
  if (res.success) {
    toast('Node dihapus');
  } else if (res.errorCode === 'NOT_FOUND') {
    // Node baru yang belum tersimpan; sudah hilang dari canvas.
    toast('Node dihapus');
  } else {
    toast(res.message || 'Gagal', 'error');
  }
}

async function refreshSelectedNodeFromServer() {
  const sel = State.selectedNode;
  if (!sel || !State.currentWorkflowId) return null;
  const res = await callServer('getWorkflowCanvas', State.currentWorkflowId);
  if (!res.success) return null;
  const nodeData = (res.data.nodes || []).find(n => String(n.id) === String(sel.customId));
  if (!nodeData) return null;
  const d = State.editor && State.editor.drawflow && State.editor.drawflow.drawflow.Home.data[sel.drawflowId];
  if (!d) return null;
  d.data.task = nodeData.task || null;
  d.data.tasks = nodeData.tasks || [];
  d.data.taskCount = nodeData.taskCount || 0;
  d.data.progress = nodeData.progress || 0;
  d.data.taskId = nodeData.taskId || null;
  setNodeCustomHtml(sel.drawflowId, nodeHtml(d.data));
  refreshIcons();
  attachNodeTaskButton(sel.drawflowId);
  renderNodePanel(d.data);
  return nodeData;
}

async function refreshSelectedNodeTask() {
  return refreshSelectedNodeFromServer();
}

function getUnlinkedTasksForWorkflow(workflowId) {
  const tasks = (typeof Store.get === 'function' ? Store.get('tasks') : (typeof Store.readAll === 'function' ? Store.readAll('tasks') : [])) || [];
  return tasks
    // Task dari workflow ini + task mandiri (tanpa workflow) yang belum
    // menempel ke node mana pun. Task mandiri akan otomatis ikut workflow
    // node saat dihubungkan (lihat linkTaskToNode).
    .filter(t => String(t.workflow_id) === String(workflowId) || !t.workflow_id)
    .filter(t => !t.node_id)
    .sort((a,b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
}

function showLinkExistingTaskToNodeModal(node) {
  if (!State.currentWorkflowId) return toast('Workflow tidak ditemukan', 'error');
  const realNodeId = (State.selectedNode && State.selectedNode.customId) || node.id || node.node_id;
  if (!realNodeId) return toast('Node tidak valid', 'error');
  const initialTasks = Array.isArray(node.tasks) ? node.tasks : (node.task ? [node.task] : []);
  let linkedCount = initialTasks.length;
  let tasks = getUnlinkedTasksForWorkflow(State.currentWorkflowId);
  const remaining = () => Math.max(0, 5 - linkedCount);

  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-[60] bg-ink/40 flex items-center justify-center p-4';
  modal.id = 'link-existing-task-backdrop';
  modal.innerHTML = `
    <div class="bg-card rounded-xl shadow-soft max-w-md w-full" id="link-existing-task-card">
      <div class="px-5 py-4 border-b border-line flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 class="text-base font-semibold">Hubungkan task yang sudah ada</h3>
          <p class="text-xs text-inksoft mt-0.5 truncate">Ke node: ${escapeHtml(node.title || node.nodeType || '')}</p>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <span class="text-[10px] font-mono text-inksoft" id="link-existing-task-counter"></span>
          <button type="button" class="btn btn-ghost btn-sm" id="link-existing-task-close"><i data-lucide="x" class="h-4 w-4"></i></button>
        </div>
      </div>
      <p class="px-5 pt-3 text-[11px] text-inksoft" id="link-existing-task-hint"></p>
      <div class="p-5 max-h-[60vh] overflow-auto space-y-1.5" id="link-existing-task-list"></div>
      <div class="px-5 py-3 border-t border-line flex justify-end">
        <button type="button" class="btn btn-secondary btn-sm" id="link-existing-task-cancel">Selesai</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  refreshIcons();

  const close = () => { if (modal && modal.parentNode) modal.parentNode.removeChild(modal); };
  const updateUi = () => {
    const counter = document.getElementById('link-existing-task-counter');
    if (counter) counter.textContent = `${linkedCount}/5 task`;
    const hint = document.getElementById('link-existing-task-hint');
    if (hint) {
      hint.classList.toggle('hidden', remaining() === 0);
      hint.textContent = remaining() === 0
        ? ''
        : `Bisa menambahkan ${remaining()} task lagi. Form tetap terbuka agar bisa menautkan beberapa task sekaligus.`;
    }
    const list = document.getElementById('link-existing-task-list');
    if (!list) return;
    if (remaining() === 0) {
      list.innerHTML = `<p class="text-sm text-inksoft text-center py-6">Batas 5 task per node sudah tercapai.</p>`;
    } else if (tasks.length === 0) {
      list.innerHTML = `<p class="text-sm text-inksoft text-center py-6">Tidak ada task yang belum terhubung ke node.<br><span class="text-[11px]">Task tanpa workflow juga muncul di sini dan akan ikut workflow node saat dihubungkan.</span></p>`;
    } else {
      list.innerHTML = tasks.map(t => `
        <button type="button" class="w-full text-left flex items-center gap-2 p-2 rounded-md border border-line hover:bg-paper transition-colors" data-task-id="${escapeHtml(t.task_id)}">
          <div class="h-7 w-7 rounded-md bg-paper text-inksoft flex items-center justify-center"><i data-lucide="check-square" class="h-3.5 w-3.5"></i></div>
          <div class="flex-1 min-w-0">
            <p class="text-xs font-medium truncate">${escapeHtml(t.title)}</p>
            <p class="text-[10px] text-inksoft capitalize">${escapeHtml(t.status)} · ${escapeHtml(t.priority)}${t.workflow_id ? '' : ' · tanpa workflow'}</p>
          </div>
          <i data-lucide="link" class="h-3.5 w-3.5 text-inksoft"></i>
        </button>
      `).join('');
    }
    refreshIcons();
  };
  updateUi();

  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });
  document.getElementById('link-existing-task-close').onclick = close;
  document.getElementById('link-existing-task-cancel').onclick = close;
  const list = document.getElementById('link-existing-task-list');
  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-task-id]');
    if (!btn) return;
    if (remaining() === 0) { toast('Maksimal 5 task per node', 'error'); return; }
    const taskId = btn.getAttribute('data-task-id');
    list.querySelectorAll('button[data-task-id]').forEach(b => { b.disabled = true; b.classList.add('opacity-60'); });
    const res = await callServer('linkTaskToNode', { taskId, nodeId: realNodeId });
    if (!res.success) {
      list.querySelectorAll('button[data-task-id]').forEach(b => { b.disabled = false; b.classList.remove('opacity-60'); });
      toast(res.message || 'Gagal menghubungkan', 'error');
      return;
    }
    tasks = tasks.filter(t => String(t.task_id) !== String(taskId));
    linkedCount = Number(res.data && res.data.taskCount) || (linkedCount + 1);
    toast('Task terhubung ke node');
    await refreshSelectedNodeFromServer();
    setCanvasDirty();
    updateUi();
  });
}

/* ============================================================
 * Dialog Buat Task (dari node maupun Kanban)
 * ============================================================ */

async function showTaskDialog(ctx = {}) {
  ctx = ctx || {};
  const wfRes = await callServer('listWorkflows');
  const workflows = wfRes.success ? wfRes.data : [];
  // Task dari node wajib punya workflow (mengikuti workflow node).
  // Task dari Kanban boleh berdiri sendiri tanpa workflow.
  const allowStandalone = !ctx.nodeId;
  if (workflows.length === 0 && !allowStandalone) { toast('Buat workflow dulu sebelum membuat task', 'error'); return; }
  const members = ((State.init && State.init.members) || []).filter(m => m.status === 'active');
  const currentUser = (State.init && State.init.currentUser) || {};
  const isAdminRole = currentUser.role === 'admin';
  const selfEmail = String(currentUser.email || '').toLowerCase();
  const wfOptions = workflows.map(w => `<option value="${escapeHtml(w.id)}" ${String(w.id) === String(ctx.workflowId) ? 'selected' : ''}>${escapeHtml(w.name)}</option>`).join('');
  const memberOptions = members.map(m => `<option value="${escapeHtml(m.email)}" ${(!isAdminRole && String(m.email).toLowerCase() === selfEmail) ? 'selected' : ''}>${escapeHtml(m.displayName)}</option>`).join('');
  const html = `
    <div class="fixed inset-0 z-40 bg-ink/40 flex items-center justify-center p-4" id="modal-backdrop">
      <div class="bg-card rounded-xl shadow-soft max-w-md w-full max-h-[90vh] overflow-y-auto" onclick="event.stopPropagation()">
        <div class="px-5 py-4 border-b border-line"><h3 class="text-base font-semibold">Buat Task Baru</h3></div>
        <div class="p-5 space-y-4">
          <div>
            <label class="form-label">Judul Task</label>
            <input type="text" id="task-new-title" class="form-input" value="${escapeHtml(ctx.nodeTitle || '')}" placeholder="Nama task...">
          </div>
          <div>
            <label class="form-label">Workflow</label>
            <select id="task-new-wf" class="form-select" ${allowStandalone ? '' : 'disabled'}>
              ${allowStandalone ? '<option value="">Tanpa workflow (berdiri sendiri)</option>' : ''}
              ${wfOptions}
            </select>
            <p class="text-[10px] text-inksoft mt-1">${allowStandalone
              ? 'Boleh dikosongkan. Task tanpa workflow tetap bisa dihubungkan ke node/workflow nanti.'
              : 'Task akan menempel pada node ini dan mengikuti workflow-nya.'}</p>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="form-label">PIC</label>
              <select id="task-new-pic" class="form-select" ${isAdminRole ? '' : 'disabled'}>
                ${isAdminRole ? '<option value="">Tidak ada</option>' : ''}
                ${memberOptions}
              </select>
              ${isAdminRole ? '' : '<p class="text-[10px] text-inksoft mt-1">Task otomatis menjadi milik Anda. Admin dapat memindahkannya ke anggota lain.</p>'}
            </div>
            <div>
              <label class="form-label">Priority</label>
              <select id="task-new-prio" class="form-select">${PRIORITIES.map(p => `<option value="${p.id}" ${p.id === 'medium' ? 'selected' : ''}>${p.label}</option>`).join('')}</select>
            </div>
            <div>
              <label class="form-label">Status</label>
              <select id="task-new-status" class="form-select">${STATUSES.map(s => `<option value="${s.id}" ${s.id === 'backlog' ? 'selected' : ''}>${s.label}</option>`).join('')}</select>
            </div>
            <div>
              <label class="form-label">Due Date</label>
              <input type="date" id="task-new-due" class="form-input">
            </div>
          </div>
          <div>
            <div class="flex items-center justify-between"><label class="form-label">Progress</label><span class="text-xs font-medium text-fern" id="task-new-progress-val">0%</span></div>
            <input type="range" id="task-new-progress" min="0" max="100" step="5" value="0" class="w-full mt-2">
          </div>
          <div>
            <label class="form-label">Deskripsi</label>
            <textarea id="task-new-desc" class="form-textarea" rows="2"></textarea>
          </div>
          <hr class="border-line">
          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="form-label flex items-center gap-1 mb-0"><i data-lucide="check-square" class="h-3 w-3"></i>Checklist</label>
              <span class="text-[10px] text-inksoft" id="task-new-checklist-count">0 item</span>
            </div>
            <div id="task-new-checklist" class="space-y-1.5"></div>
            <div class="flex gap-2 mt-2">
              <input type="text" id="task-new-checklist-input" class="form-input h-8 text-xs" placeholder="Tambah item todo...">
              <button type="button" id="task-new-checklist-add" class="btn btn-secondary btn-sm"><i data-lucide="plus" class="h-3.5 w-3.5"></i></button>
            </div>
          </div>
          <hr class="border-line">
          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="form-label flex items-center gap-1 mb-0"><i data-lucide="link-2" class="h-3 w-3"></i>Aplikasi Terkait</label>
              <button type="button" id="task-new-app-add" class="btn btn-ghost btn-sm text-xs"><i data-lucide="plus" class="h-3 w-3"></i>Tambah</button>
            </div>
            <div id="task-new-apps" class="space-y-1.5"></div>
          </div>
        </div>
        <div class="px-5 py-3 border-t border-line flex justify-end gap-2">
          <button class="btn btn-secondary" id="task-new-cancel">Batal</button>
          <button class="btn btn-primary" id="task-new-save">Buat</button>
        </div>
      </div>
    </div>`;
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  document.body.appendChild(wrap.firstElementChild);
  refreshIcons();
  $('#task-new-title').focus();
  $('#task-new-progress').addEventListener('input', (e) => {
    $('#task-new-progress-val').textContent = e.target.value + '%';
  });

  // --- Checklist awal ---
  const checklistItems = [];
  const renderChecklistDraft = () => {
    const box = $('#task-new-checklist');
    if (!box) return;
    box.innerHTML = checklistItems.length === 0
      ? '<p class="text-xs text-inksoft">Belum ada item. Tambahkan langkah kecil yang harus dikerjakan.</p>'
      : checklistItems.map((item, idx) => `
          <div class="flex items-center gap-2 px-2 py-1 rounded-md border border-line bg-paper">
            <i data-lucide="square" class="h-3 w-3 text-inksoft/60 shrink-0"></i>
            <span class="text-xs flex-1 min-w-0 truncate">${escapeHtml(item)}</span>
            <button type="button" class="btn btn-ghost btn-sm h-6 w-6 p-0" data-remove-idx="${idx}"><i data-lucide="x" class="h-3 w-3"></i></button>
          </div>`).join('');
    const count = $('#task-new-checklist-count');
    if (count) count.textContent = checklistItems.length + ' item';
    refreshIcons();
  };
  const addChecklistDraft = () => {
    const input = $('#task-new-checklist-input');
    if (!input) return;
    const value = input.value.trim();
    if (!value) return;
    checklistItems.push(value);
    input.value = '';
    renderChecklistDraft();
    input.focus();
  };
  $('#task-new-checklist-add').addEventListener('click', addChecklistDraft);
  $('#task-new-checklist-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addChecklistDraft(); }
  });
  $('#task-new-checklist').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove-idx]');
    if (!btn) return;
    checklistItems.splice(parseInt(btn.dataset.removeIdx, 10), 1);
    renderChecklistDraft();
  });
  renderChecklistDraft();

  // --- Aplikasi terkait (lewat modal, sama seperti di task drawer) ---
  const pendingApps = [];
  const renderPendingApps = () => {
    const box = $('#task-new-apps');
    if (!box) return;
    box.innerHTML = pendingApps.length === 0
      ? '<p class="text-xs text-inksoft">Belum ada aplikasi terkait. Klik "Tambah" untuk menautkan.</p>'
      : pendingApps.map((a, idx) => `
          <div class="flex items-center gap-2 p-2 rounded-md border border-line bg-paper">
            <div class="h-7 w-7 rounded-md bg-fernlight/15 text-ferndeep flex items-center justify-center text-xs font-semibold shrink-0">${escapeHtml((a.name || '?').charAt(0).toUpperCase())}</div>
            <div class="flex-1 min-w-0">
              <p class="text-xs font-medium truncate">${escapeHtml(a.name || '')}</p>
              ${a.linkLabel ? `<p class="text-[10px] text-inksoft truncate">${escapeHtml(a.linkLabel)}</p>` : ''}
              ${a.newApp ? '<p class="text-[10px] text-clay truncate">Link baru · ditambahkan ke Application Hub</p>' : ''}
            </div>
            <button type="button" class="btn btn-ghost btn-sm h-7 w-7 p-0" data-app-remove="${idx}"><i data-lucide="x" class="h-3 w-3"></i></button>
          </div>`).join('');
    refreshIcons();
  };
  $('#task-new-app-add').addEventListener('click', async () => {
    const pick = await showAppPickerDialog({
      excludeAppIds: pendingApps.map(a => a.appId).filter(Boolean),
      excludeUrls: pendingApps.map(a => (a.newApp ? a.newApp.url : a.customUrl) || '').filter(Boolean),
    });
    if (!pick) return;
    // Jaga-jaga kalau modal mengembalikan entri yang sudah ada di daftar.
    const isDuplicate = pendingApps.some(a => (a.appId && pick.appId && String(a.appId) === String(pick.appId))
      || (a.newApp && pick.newApp && String(a.newApp.url).toLowerCase() === String(pick.newApp.url).toLowerCase()));
    if (isDuplicate) { toast('Aplikasi ini sudah ditambahkan', 'info'); return; }
    pendingApps.push(pick);
    renderPendingApps();
  });
  $('#task-new-apps').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-app-remove]');
    if (!btn) return;
    pendingApps.splice(parseInt(btn.dataset.appRemove, 10), 1);
    renderPendingApps();
  });
  renderPendingApps();

  $('#task-new-cancel').addEventListener('click', () => $('#modal-backdrop').remove());
  $('#modal-backdrop').addEventListener('click', () => $('#modal-backdrop').remove());
  $('#task-new-save').addEventListener('click', async (e) => {
    const title = $('#task-new-title').value.trim();
    if (!title) { toast('Judul task wajib diisi', 'error'); return; }
    const btn = e.currentTarget;
    btn.disabled = true; btn.innerHTML = '<div class="spinner"></div>';
    const payload = {
      title,
      description: $('#task-new-desc').value.trim(),
      workflow_id: $('#task-new-wf').value || '',
      node_id: ctx.nodeId || '',
      assignee_email: $('#task-new-pic').value || '',
      priority: $('#task-new-prio').value,
      status: $('#task-new-status').value,
      progress: parseInt($('#task-new-progress').value, 10),
      due_date: $('#task-new-due').value || '',
      progress_mode: 'manual',
      checklist: checklistItems.slice(),
      appLinks: pendingApps.map(a => a.appId
        ? { appId: a.appId, customUrl: a.customUrl || '', linkLabel: a.linkLabel || '' }
        : { newApp: a.newApp, linkLabel: a.linkLabel || '' }),
    };
    const res = await callServer('createTask', payload);
    btn.disabled = false; btn.innerHTML = 'Buat';
    if (res.success) {
      toast('Task dibuat');
      $('#modal-backdrop').remove();
      if (ctx.nodeId) {
        await refreshSelectedNodeTask(res.data.id);
        setCanvasDirty();
      } else {
        renderView();
      }
    } else {
      toast(res.message || 'Gagal', 'error');
    }
  });
}

/* ============================================================
 * Kanban View (native drag & drop)
 * ============================================================ */

async function renderKanban(container) {
  container.className = 'h-full flex flex-col overflow-hidden';
  container.innerHTML = `
    <div class="px-4 py-3 border-b border-line bg-card flex items-center gap-2 flex-wrap">
      <div class="relative flex-1 max-w-sm">
        <i data-lucide="search" class="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-inksoft/50"></i>
        <input id="kanban-search" class="pl-8 h-9 w-full text-sm border border-line rounded-md" placeholder="Cari judul task...">
      </div>
      <select id="kanban-wf" class="form-select h-9 w-48"><option value="">Semua workflow</option></select>
      <select id="kanban-pic" class="form-select h-9 w-44"><option value="">Semua PIC</option></select>
      <select id="kanban-prio" class="form-select h-9 w-36">
        <option value="">Semua priority</option>
        ${PRIORITIES.map(p => `<option value="${p.id}">${p.label}</option>`).join('')}
      </select>
      <div class="flex-1"></div>
      <span id="kanban-count" class="text-xs text-inksoft"></span>
      <button id="kanban-new-task" class="btn btn-primary btn-sm"><i data-lucide="plus" class="h-3.5 w-3.5"></i>Tambah Task</button>
    </div>
    <div class="flex-1 overflow-x-auto overflow-y-hidden p-4" id="kanban-board">
      <div class="flex gap-3 h-full min-w-max items-stretch">
        ${STATUSES.map(col => `
          <div class="kanban-col" data-status="${col.id}">
            <div class="flex items-center justify-between mb-2 px-1">
              <div class="flex items-center gap-2"><span class="text-sm font-semibold">${col.label}</span><span class="col-count-${col.id} text-[10px] bg-paper px-1.5 py-0.5 rounded">0</span></div>
            </div>
            <div class="kanban-col-body" data-status="${col.id}">
              <div class="text-xs text-inksoft/50 text-center py-8">Tarik kartu ke sini</div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  refreshIcons();
  $('#kanban-new-task').addEventListener('click', () => showTaskDialog({ workflowId: (State.kanbanFilters && State.kanbanFilters.workflowId) || '' }));

  if (State.init) {
    const wfSel = $('#kanban-wf');
    State.init.members.filter(m => m.status === 'active').forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.email; opt.textContent = m.displayName;
      $('#kanban-pic').appendChild(opt);
    });
    callServer('listWorkflows').then(res => {
      if (res.success) res.data.forEach(w => {
        const opt = document.createElement('option');
        opt.value = w.id; opt.textContent = w.name;
        wfSel.appendChild(opt);
      });
    });
  }

  // Sinkronkan kontrol filter dengan filter aktif (mis. dari Dashboard Saya).
  if (State.kanbanFilters) {
    if (State.kanbanFilters.assigneeEmail) $('#kanban-pic').value = State.kanbanFilters.assigneeEmail;
    if (State.kanbanFilters.workflowId) $('#kanban-wf').value = State.kanbanFilters.workflowId;
    if (State.kanbanFilters.priority) $('#kanban-prio').value = State.kanbanFilters.priority;
    if (State.kanbanFilters.q) $('#kanban-search').value = State.kanbanFilters.q;
  }

  $('#kanban-search').addEventListener('input', (e) => { State.kanbanFilters.q = e.target.value; loadKanbanTasks(); });
  $('#kanban-wf').addEventListener('change', (e) => { State.kanbanFilters.workflowId = e.target.value; loadKanbanTasks(); });
  $('#kanban-pic').addEventListener('change', (e) => { State.kanbanFilters.assigneeEmail = e.target.value; loadKanbanTasks(); });
  $('#kanban-prio').addEventListener('change', (e) => { State.kanbanFilters.priority = e.target.value; loadKanbanTasks(); });

  await loadKanbanTasks();
}

async function loadKanbanTasks() {
  const filters = State.kanbanFilters || {};
  const res = await callServer('listTasks', filters);
  if (!res.success) return;
  const tasks = res.data;
  const memberMap = {};
  if (State.init && State.init.members) State.init.members.forEach(m => memberMap[m.email] = m.displayName);

  STATUSES.forEach(col => {
    const colTasks = tasks.filter(t => t.status === col.id);
    const body = $(`.kanban-col-body[data-status="${col.id}"]`);
    const count = $(`.col-count-${col.id}`);
    if (count) count.textContent = colTasks.length;
    if (colTasks.length === 0) {
      body.innerHTML = '<div class="text-xs text-inksoft/50 text-center py-8">Tarik kartu ke sini</div>';
    } else {
      body.innerHTML = colTasks.map(t => {
        const memberName = (t.assigneeEmail && memberMap[t.assigneeEmail]) || 'Unassigned';
        const initials = memberName.split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();
        const overdue = isOverdue(t.dueDate, t.status);
        return `
          <div class="kanban-card mb-2" draggable="${t.canEdit ? 'true' : 'false'}" data-can-edit="${t.canEdit ? '1' : '0'}" data-task-id="${escapeHtml(t.id)}" data-status="${escapeHtml(t.status)}" data-version="${t.version}" ${t.canEdit ? '' : 'title="Hanya PIC task atau admin yang dapat memindahkan kartu ini"'}>
            <div class="flex items-start">
              <div class="px-1.5 py-2 text-inksoft/50 ${t.canEdit ? 'cursor-grab' : 'cursor-not-allowed'}"><i data-lucide="${t.canEdit ? 'grip-vertical' : 'lock'}" class="h-3.5 w-3.5"></i></div>
              <div class="flex-1 text-left p-2 pl-0 min-w-0">
                <div class="flex items-start justify-between gap-2 mb-1">
                  <span class="priority-dot ${escapeHtml(t.priority)}"></span>
                </div>
                <p class="text-xs font-medium leading-tight line-clamp-2 mb-1">${escapeHtml(t.title)}</p>
                <span class="badge badge-${escapeHtml(t.priority)}">${escapeHtml(PRIORITY_LABEL[t.priority])}</span>
                ${t.progress > 0 ? `<div class="mt-1.5"><div class="bg-line rounded-full h-1"><div class="bg-fern h-1 rounded-full" style="width:${t.progress}%"></div></div></div>` : ''}
                <div class="flex items-center justify-between text-[10px] text-inksoft mt-1.5">
                  <span class="truncate">${t.workflowName ? escapeHtml(t.workflowName) : 'Tanpa workflow'}</span>
                </div>
                <div class="flex items-center justify-between mt-1.5">
                  <span class="h-5 w-5 rounded-full bg-fernlight/15 text-ferndeep flex items-center justify-center text-[8px] font-semibold">${initials}</span>
                  <span class="text-[10px] ${overdue ? 'text-berry font-medium' : 'text-inksoft'} flex items-center gap-1">
                    <i data-lucide="${overdue ? 'alert-circle' : 'clock'}" class="h-3 w-3"></i>
                    ${formatDate(t.dueDate)}
                  </span>
                </div>
                ${t.applications && t.applications.length > 0 ? `<div class="flex items-center gap-1 mt-1.5"><i data-lucide="link-2" class="h-3 w-3 text-inksoft/50"></i><span class="text-[10px] text-inksoft">${t.applications.length} apps</span></div>` : ''}
              </div>
            </div>
          </div>
        `;
      }).join('');
    }
  });
  refreshIcons();
  $('#kanban-count').textContent = `${tasks.length} task`;

  $$('.kanban-card').forEach(card => {
    card.addEventListener('dragstart', (e) => {
      if (card.dataset.canEdit !== '1') { e.preventDefault(); return; }
      card.classList.add('dragging');
      e.dataTransfer.setData('text/plain', JSON.stringify({ taskId: card.dataset.taskId, fromStatus: card.dataset.status, version: parseInt(card.dataset.version, 10) }));
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
    card.addEventListener('click', (e) => {
      if (!e.target.closest('button')) openTaskDrawer(card.dataset.taskId);
    });
  });

  $$('.kanban-col-body').forEach(col => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); });
    col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const data = JSON.parse(e.dataTransfer.getData('text/plain'));
      const { taskId, fromStatus, version } = data;
      const targetStatus = col.dataset.status;
      if (fromStatus === targetStatus) return;
      const card = $(`.kanban-card[data-task-id="${CSS.escape(taskId)}"]`);
      if (card && card.dataset.canEdit !== '1') {
        toast('Hanya PIC task atau admin yang dapat memindahkan task ini.', 'error');
        return;
      }
      if (card) {
        card.dataset.status = targetStatus;
        col.appendChild(card);
      }
      const oldCount = $(`.col-count-${fromStatus}`);
      if (oldCount) oldCount.textContent = Math.max(0, parseInt(oldCount.textContent, 10) - 1);
      const newCount = $(`.col-count-${targetStatus}`);
      if (newCount) newCount.textContent = parseInt(newCount.textContent, 10) + 1;

      const res = await callServer('updateTaskStatus', { taskId, status: targetStatus, expectedVersion: version });
      if (res.success) {
        if (card && res.data && res.data.version != null) card.dataset.version = res.data.version;
        toast(`Dipindahkan ke ${STATUS_LABEL[targetStatus]}`);
        if (targetStatus === 'done') setTimeout(() => loadKanbanTasks(), 600);
      } else if (res.errorCode === 'VERSION_CONFLICT') {
        toast('Konflik versi', 'error', 'Memuat ulang...');
        setTimeout(() => loadKanbanTasks(), 1500);
      } else {
        toast(res.message || 'Gagal memindahkan', 'error');
        setTimeout(() => loadKanbanTasks(), 600);
      }
    });
  });
}

/* ============================================================
 * Applications View
 * ============================================================ */

async function renderApplications(container) {
  container.className = 'h-full w-full overflow-auto p-4 sm:p-6';
  container.innerHTML = `
    <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5">
      <div>
        <h1 class="font-display text-2xl font-semibold tracking-tight">Application Hub</h1>
        <p class="text-sm text-inksoft mt-1">Katalog aplikasi yang dapat ditautkan ke task.</p>
      </div>
      <div class="flex items-center gap-2 w-full sm:w-auto flex-wrap justify-end">
        <div class="inline-flex items-center rounded-md border border-line bg-card p-0.5">
          <button id="apps-view-list" class="h-8 w-8 flex items-center justify-center rounded-sm text-inksoft hover:text-ink" title="Tampilan daftar" aria-label="Tampilan daftar"><i data-lucide="list" class="h-4 w-4"></i></button>
          <button id="apps-view-grid" class="h-8 w-8 flex items-center justify-center rounded-sm text-inksoft hover:text-ink" title="Tampilan grid" aria-label="Tampilan grid"><i data-lucide="grid-3x3" class="h-4 w-4"></i></button>
        </div>
        <button id="manage-cat-btn" class="btn btn-secondary flex-1 sm:flex-none justify-center"><i data-lucide="tags" class="h-4 w-4"></i><span class="hidden sm:inline">Kelola Kategori</span><span class="sm:hidden">Kategori</span></button>
        <button id="new-app-btn" class="btn btn-primary flex-1 sm:flex-none justify-center"><i data-lucide="plus" class="h-4 w-4"></i><span class="hidden sm:inline">Tambah Aplikasi</span><span class="sm:hidden">Tambah</span></button>
      </div>
    </div>
    <div id="apps-list"></div>
  `;
  refreshIcons();
  $('#new-app-btn').addEventListener('click', () => showAppDialog());
  $('#manage-cat-btn').addEventListener('click', () => showManageCategoriesDialog());

  const key = 'flowspace.apps.view';
  let view = 'grid';
  try { const v = localStorage.getItem(key); if (v === 'list' || v === 'grid') view = v; } catch(e){}
  function applyView(v){
    view = v;
    try { localStorage.setItem(key, v); } catch(e){}
    const listBtn = $('#apps-view-list');
    const gridBtn = $('#apps-view-grid');
    if(listBtn){
      listBtn.classList.toggle('bg-paper', v === 'list');
      listBtn.classList.toggle('text-ink', v === 'list');
    }
    if(gridBtn){
      gridBtn.classList.toggle('bg-paper', v === 'grid');
      gridBtn.classList.toggle('text-ink', v === 'grid');
    }
    loadApplicationsList();
  }
  const listBtn = $('#apps-view-list');
  const gridBtn = $('#apps-view-grid');
  if (listBtn) listBtn.addEventListener('click', () => applyView('list'));
  if (gridBtn) gridBtn.addEventListener('click', () => applyView('grid'));
  applyView(view);
}

async function loadApplicationsList() {
  const list = $('#apps-list');
  if (!list) return;
  list.innerHTML = '<div class="flex items-center gap-2 text-inksoft"><div class="spinner spinner-dark"></div>Memuat...</div>';
  const [resApps, resCats] = await Promise.all([
    callServer('listApplications'),
    callServer('listApplicationCategories')
  ]);
  if (!resApps.success) { list.innerHTML = `<div class="text-berry">${escapeHtml(resApps.message || 'Gagal')}</div>`; return; }
  const apps = resApps.data || [];
  const cats = resCats.success ? (resCats.data || []).map(c => c.name) : APP_CATEGORIES.slice();
  if (apps.length === 0) {
    list.innerHTML = `
      <div class="bg-card border border-line rounded-xl">
        <div class="empty-state">
          <div class="empty-icon"><i data-lucide="app-window" class="h-6 w-6 text-inksoft/50"></i></div>
          <h3 class="text-lg font-medium mb-1">Tidak ada aplikasi</h3>
          <p class="text-sm mb-4">Tambahkan aplikasi pertama Anda.</p>
        </div>
      </div>`;
    refreshIcons();
    return;
  }
  const grouped = {};
  cats.forEach(c => grouped[c] = []);
  apps.forEach(a => { if (!grouped[a.category]) grouped[a.category] = []; grouped[a.category].push(a); });
  const key = 'flowspace.apps.view';
  let view = 'grid';
  try { const v = localStorage.getItem(key); if (v === 'list' || v === 'grid') view = v; } catch(e){}

  if (view === 'list') {
    list.innerHTML = Object.keys(grouped).filter(c => grouped[c].length > 0).map(cat => `
      <div class="mb-5 sm:mb-6">
        <h2 class="text-base font-medium text-ink mb-2 flex items-center gap-2">
          <span>${escapeHtml(cat)}</span>
          <span class="text-xs text-inksoft font-normal">${grouped[cat].length}</span>
        </h2>
        <div class="bg-card border border-line rounded-xl overflow-hidden divide-y divide-line">
          ${grouped[cat].map(a => `
            <div class="flex items-center gap-3 p-3 hover:bg-paper/60" data-app-card="${escapeHtml(a.id)}">
              <div class="h-9 w-9 rounded-md bg-fernlight/15 text-ferndeep flex items-center justify-center text-xs font-bold shrink-0">${escapeHtml(a.name.charAt(0).toUpperCase())}</div>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <h3 class="text-sm font-medium truncate">${escapeHtml(a.name)}</h3>
                  <span class="text-[10px] text-inksoft">${a.taskCount} task</span>
                </div>
                <p class="text-xs text-inksoft truncate">${escapeHtml(a.description || 'Tanpa deskripsi')}</p>
              </div>
              <a href="${escapeHtml(a.url)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm hidden sm:flex"><i data-lucide="external-link" class="h-3.5 w-3.5"></i>Buka</a>
              <button class="app-menu-${escapeHtml(a.id)} btn btn-ghost btn-sm" aria-haspopup="menu" aria-expanded="false" data-app-id="${escapeHtml(a.id)}" data-app-name="${escapeHtml(a.name)}" title="Menu aplikasi"><i data-lucide="more-vertical" class="h-3.5 w-3.5"></i></button>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');
  } else {
    list.innerHTML = Object.keys(grouped).filter(c => grouped[c].length > 0).map(cat => `
      <div class="mb-5 sm:mb-6">
        <h2 class="text-base font-medium text-ink mb-2 flex items-center gap-2">
          <span>${escapeHtml(cat)}</span>
          <span class="text-xs text-inksoft font-normal">${grouped[cat].length}</span>
        </h2>
        <div class="grid grid-cols-2 xs:grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-2 sm:gap-3">
          ${grouped[cat].map(a => `
            <div class="bg-card border border-line rounded-lg p-3 flex flex-col items-center text-center gap-2 group hover:border-fern/40 hover:shadow-sm transition-all relative" data-app-card="${escapeHtml(a.id)}">
              <button class="app-menu-${escapeHtml(a.id)} absolute top-1 right-1 btn btn-ghost btn-xs" aria-haspopup="menu" aria-expanded="false" data-app-id="${escapeHtml(a.id)}" data-app-name="${escapeHtml(a.name)}" title="Menu aplikasi"><i data-lucide="more-vertical" class="h-3.5 w-3.5"></i></button>
              <div class="h-12 w-12 rounded-lg bg-fernlight/15 text-ferndeep flex items-center justify-center text-base font-bold">${escapeHtml(a.name.charAt(0).toUpperCase())}</div>
              <div class="w-full min-w-0">
                <h3 class="text-sm font-medium leading-tight truncate" title="${escapeHtml(a.name)}">${escapeHtml(a.name)}</h3>
                <p class="text-[10px] text-inksoft mt-0.5 line-clamp-2 min-h-[1.8rem]">${escapeHtml(a.description || 'Tanpa deskripsi')}</p>
              </div>
              <div class="w-full flex items-center justify-between text-[10px] text-inksoft pt-1.5 border-t border-line">
                <span>${a.taskCount} task</span>
                <a href="${escapeHtml(a.url)}" target="_blank" rel="noopener" class="text-fern hover:underline flex items-center gap-1">Buka</a>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');
  }
  refreshIcons();
  $$('[class*="app-menu-"]').forEach(btn => btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); showAppMenu(btn, btn.dataset.appId, btn.dataset.appName); }));
}

async function showAppDialog() {
  const catRes = await callServer('listApplicationCategories');
  const cats = catRes.success ? (catRes.data || []).map(c => c.name) : APP_CATEGORIES.slice();
  const html = `
    <div class="fixed inset-0 z-40 bg-ink/40 flex items-center justify-center p-4" id="modal-backdrop">
      <div class="bg-card rounded-xl shadow-soft max-w-md w-full" onclick="event.stopPropagation()">
        <div class="px-5 py-4 border-b border-line"><h3 class="text-base font-semibold">Tambah Aplikasi</h3></div>
        <div class="p-5 space-y-4">
          <div><label class="form-label">Nama</label><input type="text" id="app-name" class="form-input" placeholder="Google Workspace"></div>
          <div><label class="form-label">URL</label><input type="text" id="app-url" class="form-input" placeholder="https://..."></div>
          <div><label class="form-label">Kategori</label><select id="app-cat" class="form-select">${cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}</select></div>
          <div><label class="form-label">Deskripsi</label><textarea id="app-desc" class="form-textarea" rows="2"></textarea></div>
        </div>
        <div class="px-5 py-3 border-t border-line flex justify-end gap-2">
          <button class="btn btn-secondary" id="app-cancel">Batal</button>
          <button class="btn btn-primary" id="app-save">Simpan</button>
        </div>
      </div>
    </div>`;
  const wrap = document.createElement('div'); wrap.innerHTML = html;
  document.body.appendChild(wrap.firstElementChild);
  $('#app-name').focus();
  $('#app-cancel').addEventListener('click', () => $('#modal-backdrop').remove());
  $('#modal-backdrop').addEventListener('click', () => $('#modal-backdrop').remove());
  $('#app-save').addEventListener('click', async () => {
    const name = $('#app-name').value.trim();
    const url = $('#app-url').value.trim();
    if (!name || !url) { toast('Nama dan URL wajib diisi', 'error'); return; }
    const res = await callServer('createApplication', { name, url, category: $('#app-cat').value, description: $('#app-desc').value.trim() });
    if (res.success) { toast('Aplikasi ditambahkan'); $('#modal-backdrop').remove(); loadApplicationsList(); }
    else toast(res.message || 'Gagal', 'error');
  });
}

function showAppMenu(anchor, appId, appName) {
  const html = `
    <div class="menu-head">
      <div class="menu-head-title" title="${escapeHtml(appName || '')}">${escapeHtml(appName || 'Aplikasi')}</div>
      <div class="menu-head-meta">Application Hub</div>
    </div>
    <div class="menu-sep"></div>
    <button type="button" role="menuitem" class="menu-item" data-app-action="edit">
      <i data-lucide="pencil"></i><span>Edit detail</span>
    </button>
    <div class="menu-sep"></div>
    <button type="button" role="menuitem" class="menu-item danger" data-app-action="delete">
      <i data-lucide="trash-2"></i><span>Hapus</span>
    </button>
  `;
  const menu = openAnchorMenu(anchor, html, { widthClass: 'w-52' });
  menu.element.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-app-action]');
    if (!btn) return;
    menu.close();
    if (btn.dataset.appAction === 'edit') {
      const list = await callServer('listApplications');
      if (!list.success) return;
      const app = list.data.find(a => a.id === appId);
      if (app) showEditAppDialog(app);
      return;
    }
    if (!(await showConfirmDialog({
      title: 'Hapus aplikasi?',
      message: 'Aplikasi akan dihapus dari Application Hub dan dilepas dari task yang memakainya.',
      confirmText: 'Hapus',
      cancelText: 'Batal',
      danger: true,
    }))) return;
    const res = await callServer('deleteApplication', appId);
    if (res.success) { toast('Aplikasi dihapus'); loadApplicationsList(); }
    else toast(res.message || 'Gagal', 'error');
  });
}

async function showEditAppDialog(app) {
  const catRes = await callServer('listApplicationCategories');
  const cats = catRes.success ? (catRes.data || []).map(c => c.name) : APP_CATEGORIES.slice();
  const html = `
    <div class="fixed inset-0 z-40 bg-ink/40 flex items-center justify-center p-4" id="modal-backdrop">
      <div class="bg-card rounded-xl shadow-soft max-w-md w-full" onclick="event.stopPropagation()">
        <div class="px-5 py-4 border-b border-line"><h3 class="text-base font-semibold">Edit Aplikasi</h3></div>
        <div class="p-5 space-y-4">
          <div><label class="form-label">Nama</label><input type="text" id="app-name" class="form-input" value="${escapeHtml(app.name)}"></div>
          <div><label class="form-label">URL</label><input type="text" id="app-url" class="form-input" value="${escapeHtml(app.url)}"></div>
          <div><label class="form-label">Kategori</label><select id="app-cat" class="form-select">${cats.map(c => `<option value="${escapeHtml(c)}" ${c === app.category ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}</select></div>
          <div><label class="form-label">Deskripsi</label><textarea id="app-desc" class="form-textarea" rows="2">${escapeHtml(app.description || '')}</textarea></div>
        </div>
        <div class="px-5 py-3 border-t border-line flex justify-end gap-2">
          <button class="btn btn-secondary" id="app-cancel">Batal</button>
          <button class="btn btn-primary" id="app-save" data-app-id="${app.id}">Simpan</button>
        </div>
      </div>
    </div>`;
  const wrap = document.createElement('div'); wrap.innerHTML = html;
  document.body.appendChild(wrap.firstElementChild);
  $('#app-cancel').addEventListener('click', () => $('#modal-backdrop').remove());
  $('#modal-backdrop').addEventListener('click', () => $('#modal-backdrop').remove());
  $('#app-save').addEventListener('click', async (e) => {
    const id = e.currentTarget.dataset.appId;
    const res = await callServer('updateApplication', {
      id, name: $('#app-name').value.trim(),
      url: $('#app-url').value.trim(),
      category: $('#app-cat').value,
      description: $('#app-desc').value.trim(),
    });
    if (res.success) { toast('Aplikasi diperbarui'); $('#modal-backdrop').remove(); loadApplicationsList(); }
    else toast(res.message || 'Gagal', 'error');
  });
}

async function showManageCategoriesDialog() {
  const html = `
    <div class="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4" id="cat-manage-backdrop">
      <div class="bg-card rounded-xl shadow-soft max-w-md w-full max-h-[85vh] flex flex-col" onclick="event.stopPropagation()">
        <div class="px-5 py-4 border-b border-line flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h3 class="text-base font-semibold flex items-center gap-2"><i data-lucide="tags" class="h-4 w-4 text-fern"></i>Kelola Kategori</h3>
            <p class="text-xs text-inksoft mt-1">Kategori dipakai untuk mengelompokkan aplikasi di Application Hub.</p>
          </div>
          <button id="cat-manage-close" class="btn btn-ghost btn-sm shrink-0" title="Tutup" aria-label="Tutup"><i data-lucide="x" class="h-4 w-4"></i></button>
        </div>
        <div class="p-5 overflow-y-auto">
          <div class="flex items-center justify-between gap-3 mb-3">
            <span class="label-mono text-[10px] text-inksoft">Daftar Kategori</span>
            <button id="cat-manage-add" class="btn btn-secondary btn-sm shrink-0"><i data-lucide="plus" class="h-3.5 w-3.5"></i>Tambah Kategori</button>
          </div>
          <div id="cat-manage-list" class="space-y-2"></div>
        </div>
      </div>
    </div>`;
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  document.body.appendChild(wrap.firstElementChild);
  refreshIcons();
  const close = () => document.getElementById('cat-manage-backdrop').remove();
  document.getElementById('cat-manage-close').onclick = close;
  document.getElementById('cat-manage-backdrop').onclick = close;
  document.getElementById('cat-manage-add').onclick = showAddAppCategoryDialog;
  await loadAppCategoriesSettings('cat-manage-list');
}

/* ============================================================
 * Team View
 * ============================================================ */

let teamMembersCache = [];

async function renderTeam(container) {
  container.className = 'h-full w-full overflow-auto p-6 space-y-6';
  container.innerHTML = `
    <div class="flex items-start justify-between gap-4 flex-wrap">
      <div>
        <h1 class="font-display text-2xl font-semibold tracking-tight">Team &amp; Members</h1>
        <p class="text-sm text-inksoft mt-1">Kelola anggota workspace dan peran mereka.</p>
      </div>
      <button id="new-mem-btn" class="btn btn-primary"><i data-lucide="${isFirebaseLive() ? 'mail-plus' : 'plus'}" class="h-4 w-4"></i>${isFirebaseLive() ? 'Undang Member' : 'Tambah Member'}</button>
    </div>

    <div class="flex items-start gap-3 rounded-lg border px-4 py-3 ${isFirebaseLive() ? 'border-fern/30 bg-fern/5' : 'border-amber/40 bg-amber/10'}">
      <i data-lucide="${isFirebaseLive() ? 'shield-check' : 'info'}" class="h-4 w-4 mt-0.5 shrink-0 ${isFirebaseLive() ? 'text-ferndeep' : 'text-[#8A5F10]'}"></i>
      <div class="min-w-0">
        <p class="text-sm font-medium">${isFirebaseLive() ? 'Tersambung ke Firebase' : 'Mode lokal — belum ada login'}</p>
        <p class="text-xs text-inksoft mt-0.5 leading-relaxed">${isFirebaseLive()
          ? 'Anggota dan data tersinkron antar perangkat. Tambah member = kirim undangan; akses aktif setelah orang tersebut masuk dengan email yang sama.'
          : 'Daftar anggota ini tersimpan hanya di browser ini. Login, undangan, dan sinkronisasi antar perangkat akan aktif setelah Firebase tersambung.'}</p>
      </div>
    </div>

    <div class="bg-card border border-line rounded-xl p-3 flex flex-col md:flex-row md:items-center gap-2">
      <div class="relative flex-1 min-w-[180px]">
        <i data-lucide="search" class="h-4 w-4 text-inksoft absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"></i>
        <input id="mem-search" type="search" class="form-input pl-9" placeholder="Cari nama atau email..." aria-label="Cari anggota">
      </div>
      <select id="mem-role-filter" class="form-select md:w-40" aria-label="Filter peran">
        <option value="">Semua peran</option>
        <option value="admin">Admin</option>
        <option value="editor">Editor</option>
        <option value="viewer">Viewer</option>
      </select>
      <select id="mem-status-filter" class="form-select md:w-40" aria-label="Filter status">
        <option value="">Semua status</option>
        <option value="active">Aktif</option>
        <option value="invited">Diundang</option>
        <option value="inactive">Nonaktif</option>
      </select>
      <span id="mem-count" class="text-xs text-inksoft font-mono whitespace-nowrap md:ml-auto md:pl-2"></span>
    </div>

    <div id="mem-list" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"></div>
    <div id="activity-list" class="bg-card border border-line rounded-xl p-5"></div>
  `;
  refreshIcons();

  $('#new-mem-btn').addEventListener('click', () => showMemberDialog());
  $('#mem-search').value = State.teamFilters.q || '';
  $('#mem-role-filter').value = State.teamFilters.role || '';
  $('#mem-status-filter').value = State.teamFilters.status || '';
  $('#mem-search').addEventListener('input', (e) => { State.teamFilters.q = e.target.value; applyTeamFilters(); });
  $('#mem-role-filter').addEventListener('change', (e) => { State.teamFilters.role = e.target.value; applyTeamFilters(); });
  $('#mem-status-filter').addEventListener('change', (e) => { State.teamFilters.status = e.target.value; applyTeamFilters(); });

  await loadMembersList();
  await loadActivityList();
}

async function loadMembersList() {
  const list = $('#mem-list');
  if (!list) return;
  if (teamMembersCache.length === 0) {
    list.innerHTML = '<div class="col-span-full text-inksoft flex items-center gap-2 py-4"><div class="spinner spinner-dark"></div>Memuat anggota...</div>';
  }
  const res = await callServer('listMembers');
  if (!res.success) {
    list.innerHTML = `<div class="col-span-full text-sm text-berry py-4">${escapeHtml(res.message || 'Gagal memuat anggota')}</div>`;
    return;
  }
  teamMembersCache = res.data || [];
  if (State.init) State.init.members = teamMembersCache;
  applyTeamFilters();
}

function memberRoleLabel(role) {
  return { admin: 'Admin', editor: 'Editor', viewer: 'Viewer' }[role] || role;
}

function isCurrentMember(member) {
  const me = State.init && State.init.currentUser;
  return !!(me && member && String(member.email).toLowerCase() === String(me.email).toLowerCase());
}

function applyTeamFilters() {
  const list = $('#mem-list');
  if (!list) return;
  const f = State.teamFilters || { q: '', role: '', status: '' };
  const q = String(f.q || '').trim().toLowerCase();
  const filtered = teamMembersCache.filter((m) => {
    if (f.role && m.role !== f.role) return false;
    if (f.status && m.status !== f.status) return false;
    if (!q) return true;
    return (String(m.displayName || '') + ' ' + String(m.email || '')).toLowerCase().indexOf(q) !== -1;
  });
  renderMemberCards(filtered);
  renderMemberCount(filtered);
}

function renderMemberCount(filtered) {
  const el = $('#mem-count');
  if (!el) return;
  const total = teamMembersCache.length;
  const inactive = teamMembersCache.filter(m => m.status === 'inactive').length;
  const invited = teamMembersCache.filter(m => m.status === 'invited').length;
  const filtering = !!(State.teamFilters.q || State.teamFilters.role || State.teamFilters.status);
  if (filtering) {
    el.textContent = `${filtered.length} dari ${total} anggota`;
  } else {
    el.textContent = `${total} anggota${invited > 0 ? ` · ${invited} diundang` : ''}${inactive > 0 ? ` · ${inactive} nonaktif` : ''}`;
  }
}

function renderMemberCards(filtered) {
  const list = $('#mem-list');
  if (!list) return;
  if (teamMembersCache.length === 0) {
    list.innerHTML = `
      <div class="col-span-full bg-card border border-dashed border-line rounded-xl p-10 text-center">
        <span class="inline-flex h-11 w-11 items-center justify-center rounded-full bg-fernlight/15 text-ferndeep mb-3"><i data-lucide="users" class="h-5 w-5"></i></span>
        <p class="text-sm font-medium">Belum ada anggota</p>
        <p class="text-xs text-inksoft mt-1">Tambahkan anggota pertama untuk mulai menugaskan task.</p>
        <button type="button" class="btn btn-primary btn-sm mt-4" data-member-empty-add><i data-lucide="plus" class="h-3.5 w-3.5"></i>Tambah Member</button>
      </div>`;
    const add = list.querySelector('[data-member-empty-add]');
    if (add) add.addEventListener('click', () => showMemberDialog());
    refreshIcons();
    return;
  }
  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="col-span-full bg-card border border-dashed border-line rounded-xl p-8 text-center">
        <p class="text-sm font-medium">Tidak ada anggota yang cocok</p>
        <p class="text-xs text-inksoft mt-1">Coba ubah kata kunci atau filter.</p>
        <button type="button" class="btn btn-secondary btn-sm mt-4" data-member-reset>Reset filter</button>
      </div>`;
    const reset = list.querySelector('[data-member-reset]');
    if (reset) reset.addEventListener('click', resetTeamFilters);
    refreshIcons();
    return;
  }

  list.innerHTML = filtered.map((m) => {
    const initials = (m.displayName || '?').split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();
    const isMe = isCurrentMember(m);
    const inactive = m.status === 'inactive';
    const invited = m.status === 'invited';
    const roleClass = m.role === 'admin' ? 'bg-berry/10 text-berry' : m.role === 'editor' ? 'bg-fernlight/15 text-ferndeep' : 'bg-paper text-inksoft';
    const statusBadge = invited
      ? '<span class="badge bg-amber/20 text-[#8A5F10]">Diundang</span>'
      : `<span class="badge ${inactive ? 'bg-paper text-inksoft' : 'bg-fern/10 text-ferndeep'}">${inactive ? 'Nonaktif' : 'Aktif'}</span>`;
    const muted = inactive || invited;
    return `
      <article class="member-card bg-card border border-line rounded-xl p-4 ${inactive ? 'is-inactive' : ''} ${invited ? 'is-invited' : ''}" data-member-id="${escapeHtml(m.id)}">
        <div class="flex items-start justify-between gap-2">
          <div class="flex items-center gap-3 min-w-0">
            <span class="h-10 w-10 shrink-0 rounded-full bg-fernlight/15 text-ferndeep flex items-center justify-center text-sm font-semibold ${muted ? 'opacity-60' : ''}">${escapeHtml(initials)}</span>
            <div class="min-w-0">
              <div class="flex items-center gap-1.5 min-w-0">
                <p class="font-medium leading-tight truncate ${muted ? 'text-inksoft' : ''}">${escapeHtml(m.displayName)}</p>
                ${isMe ? '<span class="badge bg-fernlight/15 text-ferndeep shrink-0">Anda</span>' : ''}
              </div>
              <p class="text-xs text-inksoft flex items-center gap-1 truncate mt-0.5"><i data-lucide="mail" class="h-3 w-3 shrink-0"></i><span class="truncate">${escapeHtml(m.email)}</span></p>
            </div>
          </div>
          <button type="button" class="btn btn-ghost btn-sm h-8 w-8 p-0 shrink-0" data-member-menu aria-haspopup="menu" aria-expanded="false" aria-label="Aksi untuk ${escapeHtml(m.displayName)}" title="Aksi member"><i data-lucide="more-vertical" class="h-4 w-4"></i></button>
        </div>
        <div class="flex items-center gap-1.5 flex-wrap mt-3">
          <span class="badge ${roleClass}">${escapeHtml(memberRoleLabel(m.role))}</span>
          ${statusBadge}
        </div>
        <div class="mt-3 pt-3 border-t border-line flex items-center justify-between gap-2 text-[10px] text-inksoft">
          <span>${invited ? 'Diundang' : 'Bergabung'} ${escapeHtml(formatDate(m.createdAt))}</span>
          ${invited
            ? '<span class="font-mono uppercase tracking-wide">Menunggu login</span>'
            : isMe ? '<span class="font-mono uppercase tracking-wide">Akun Anda</span>' : ''}
        </div>
      </article>`;
  }).join('');

  list.querySelectorAll('[data-member-menu]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const card = btn.closest('[data-member-id]');
      const member = teamMembersCache.find(x => String(x.id) === String(card && card.dataset.memberId));
      if (member) openMemberMenu(btn, member);
    });
  });
  refreshIcons();
}

function resetTeamFilters() {
  State.teamFilters = { q: '', role: '', status: '' };
  const q = $('#mem-search');
  const role = $('#mem-role-filter');
  const status = $('#mem-status-filter');
  if (q) q.value = '';
  if (role) role.value = '';
  if (status) status.value = '';
  applyTeamFilters();
}

function openMemberMenu(anchor, member) {
  const isMe = isCurrentMember(member);
  const invited = member.status === 'invited';
  const active = member.status === 'active';
  const selfNote = 'Tidak bisa dilakukan untuk akun sendiri';
  const html = `
    <div class="menu-head">
      <div class="menu-head-title" title="${escapeHtml(member.displayName)}">${escapeHtml(member.displayName)}</div>
      <div class="menu-head-meta">${escapeHtml(member.email)}${invited ? ' · diundang' : ''}</div>
    </div>
    <div class="menu-sep"></div>
    <button type="button" role="menuitem" class="menu-item" data-member-action="edit">
      <i data-lucide="pencil"></i><span>Ubah nama &amp; peran</span>
    </button>
    ${invited ? '' : `
    <button type="button" role="menuitem" class="menu-item" data-member-action="toggle" ${isMe ? `disabled title="${selfNote}"` : ''}>
      <i data-lucide="${active ? 'user-x' : 'user-check'}"></i><span>${active ? 'Nonaktifkan' : 'Aktifkan kembali'}</span>
    </button>`}
    <div class="menu-sep"></div>
    <button type="button" role="menuitem" class="menu-item danger" data-member-action="remove" ${isMe ? `disabled title="${selfNote}"` : ''}>
      <i data-lucide="${invited ? 'mail-x' : 'trash-2'}"></i><span>${invited ? 'Batalkan undangan' : 'Hapus member'}</span>
    </button>
  `;
  const menu = openAnchorMenu(anchor, html);
  menu.element.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-member-action]');
    if (!btn || btn.disabled) return;
    menu.close();
    const action = btn.dataset.memberAction;

    if (action === 'edit') {
      showMemberDialog(member);
      return;
    }

    if (action === 'toggle') {
      const deactivate = active;
      const ok = await showConfirmDialog({
        title: deactivate ? 'Nonaktifkan member?' : 'Aktifkan kembali member?',
        message: deactivate
          ? `"${member.displayName}" tidak akan muncul di pilihan PIC task baru. Data, task, dan riwayatnya tetap tersimpan dan bisa diaktifkan lagi kapan saja.`
          : `"${member.displayName}" akan kembali muncul di pilihan PIC task baru.`,
        confirmText: deactivate ? 'Nonaktifkan' : 'Aktifkan',
        cancelText: 'Batal',
        danger: deactivate,
      });
      if (!ok) return;
      const res = await callServer('setMemberStatus', { id: member.id, status: deactivate ? 'inactive' : 'active' });
      if (!res.success) { toast(res.message || 'Gagal mengubah status', 'error'); return; }
      toast(res.message || 'Status member diperbarui');
      await refreshMemberContext();
      await loadMembersList();
      await loadActivityList();
      return;
    }

    if (action === 'remove') {
      const ok = await showConfirmDialog({
        title: invited ? 'Batalkan undangan?' : 'Hapus member?',
        message: invited
          ? `Undangan untuk "${member.displayName}" (${member.email}) akan dibatalkan. Orang tersebut tidak akan bisa bergabung lewat undangan ini.`
          : `"${member.displayName}" (${member.email}) akan dihapus dari workspace. Task yang pernah ditugaskan tetap tersimpan, tetapi tidak lagi terhubung ke member ini. Tindakan ini tidak bisa dibatalkan.`,
        confirmText: invited ? 'Batalkan Undangan' : 'Hapus Member',
        cancelText: 'Batal',
        danger: true,
      });
      if (!ok) return;
      const res = await callServer('removeMember', { id: member.id });
      if (!res.success) { toast(res.message || 'Gagal memproses', 'error'); return; }
      toast(res.message || (invited ? 'Undangan dibatalkan' : 'Member dihapus'));
      await refreshMemberContext();
      await loadMembersList();
      await loadActivityList();
    }
  });
}

async function refreshMemberContext() {
  const res = await callServer('getInitialAppData');
  if (!res.success) return;
  State.init = res.data;
  if (res.data.workspace) $('#ws-name').textContent = res.data.workspace.name;
  renderHeader();
}

async function loadActivityList() {
  const list = $('#activity-list');
  if (!list) return;
  list.innerHTML = '<div class="flex items-center gap-2 text-inksoft"><div class="spinner spinner-dark"></div>Memuat aktivitas...</div>';
  const res = await callServer('listActivityLogs', { limit: 15 });
  if (!res.success) return;
  const logs = res.data;
  list.innerHTML = `
    <div class="flex items-center gap-2 mb-3"><i data-lucide="activity" class="h-4 w-4 text-fern"></i><h3 class="text-sm font-medium">Aktivitas Terbaru</h3></div>
    ${logs.length === 0 ? '<p class="text-sm text-inksoft text-center py-4">Belum ada aktivitas.</p>' : `
      <div class="space-y-2 max-h-72 overflow-y-auto">
        ${logs.map(l => {
          const actionLabel = { create: 'membuat', update: 'memperbarui', delete: 'menghapus', status_change: 'mengubah status', priority_change: 'mengubah priority', assignee_change: 'mengganti PIC', progress_update: 'memperbarui progress', due_date_change: 'mengubah deadline', archive: 'mengarsipkan', duplicate: 'menduplikasi', canvas_save: 'menyimpan canvas', link_application: 'menautkan aplikasi', unlink_application: 'melepas aplikasi' }[l.action] || l.action;
          const entityLabel = { task: 'task', workflow: 'workflow', node: 'node', edge: 'edge', application: 'aplikasi', member: 'member' }[l.entityType] || l.entityType;
          const detailValue = (l.newValue && (l.newValue.displayName || l.newValue.name || l.newValue.title || l.newValue.email)) || (l.oldValue && (l.oldValue.displayName || l.oldValue.name || l.oldValue.title || l.oldValue.email)) || '';
          return `
            <div class="flex items-start gap-3 text-xs">
              <span class="inline-block h-1.5 w-1.5 rounded-full bg-fern mt-1.5 shrink-0"></span>
              <div class="flex-1 min-w-0">
                <p><span class="font-medium">${escapeHtml(l.actorEmail)}</span> <span class="text-inksoft">${actionLabel}</span> <span class="font-medium">${entityLabel}</span>${detailValue ? `: ${escapeHtml(detailValue)}` : ''}</p>
                <p class="text-[10px] text-inksoft">${formatDateTime(l.createdAt)}</p>
              </div>
            </div>`;
        }).join('')}
      </div>
    `}
  `;
  refreshIcons();
}

function showMemberDialog(member) {
  const editing = !!member;
  const isMe = editing && isCurrentMember(member);
  const invited = editing && member.status === 'invited';
  const live = isFirebaseLive();
  const previouslyFocused = document.activeElement;
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-[75] bg-ink/40 flex items-center justify-center p-4';
  modal.id = 'member-modal';
  modal.innerHTML = `
    <div class="bg-card rounded-xl shadow-soft max-w-md w-full" role="dialog" aria-modal="true" aria-labelledby="member-modal-title">
      <div class="px-5 py-4 border-b border-line flex items-start justify-between gap-3">
        <div>
          <h3 id="member-modal-title" class="text-base font-semibold">${editing ? 'Ubah Member' : (live ? 'Undang Member' : 'Tambah Member')}</h3>
          <p class="text-xs text-inksoft mt-0.5">${editing
            ? (invited ? 'Perbarui nama atau peran pada undangan.' : 'Perbarui nama atau peran anggota.')
            : (live ? 'Undangan aktif setelah orang tersebut masuk dengan email yang sama.' : 'Tambahkan anggota ke workspace ini.')}</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm h-8 w-8 p-0" data-member-close aria-label="Tutup"><i data-lucide="x" class="h-4 w-4"></i></button>
      </div>
      <div class="p-5 space-y-4">
        <div>
          <label class="form-label" for="mem-name">Nama Tampilan</label>
          <input type="text" id="mem-name" class="form-input" maxlength="60" placeholder="Andi Pratama" value="${escapeHtml(editing ? member.displayName : '')}" autocomplete="off">
        </div>
        <div>
          <label class="form-label" for="mem-email">Email</label>
          <input type="email" id="mem-email" class="form-input" placeholder="member@email.com" value="${escapeHtml(editing ? member.email : '')}" ${editing ? 'disabled' : ''} autocomplete="off">
          ${editing
            ? '<p class="text-[10px] text-inksoft mt-1">Email tidak bisa diubah. Hapus lalu tambahkan ulang jika perlu.</p>'
            : (live ? '<p class="text-[10px] text-inksoft mt-1">Undangan dikirim ke email ini. Minta orang tersebut mendaftar/masuk dengan email yang sama.</p>' : '')}
        </div>
        <div>
          <label class="form-label" for="mem-role">Peran</label>
          <select id="mem-role" class="form-select" ${isMe ? 'disabled' : ''}>
            <option value="admin" ${editing && member.role === 'admin' ? 'selected' : ''}>Admin — kelola anggota, workflow, dan data</option>
            <option value="editor" ${(!editing || member.role === 'editor') ? 'selected' : ''}>Editor — buat &amp; ubah workflow, task, aplikasi</option>
            <option value="viewer" ${editing && member.role === 'viewer' ? 'selected' : ''}>Viewer — hanya melihat</option>
          </select>
          ${isMe ? '<p class="text-[10px] text-inksoft mt-1">Peran akun sendiri tidak bisa diubah dari sini.</p>' : '<p class="text-[10px] text-inksoft mt-1">Peran menentukan akses setelah login aktif.</p>'}
        </div>
        <p id="member-form-error" class="text-xs text-berry hidden" role="alert"></p>
      </div>
      <div class="px-5 py-3 border-t border-line flex justify-end gap-2">
        <button type="button" class="btn btn-secondary" data-member-close>Batal</button>
        <button type="button" class="btn btn-primary" data-member-save>${editing ? 'Simpan Perubahan' : (live ? 'Kirim Undangan' : 'Tambah Member')}</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  refreshIcons();

  const errorEl = modal.querySelector('#member-form-error');
  const showError = (msg) => {
    errorEl.textContent = msg;
    errorEl.classList.remove('hidden');
  };
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    modal.remove();
    if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus({ preventScroll: true });
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    const focusables = Array.from(modal.querySelectorAll('button, input, select')).filter(el => !el.disabled);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', onKey, true);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  modal.querySelectorAll('[data-member-close]').forEach(b => b.addEventListener('click', close));

  const nameInput = modal.querySelector('#mem-name');
  const emailInput = modal.querySelector('#mem-email');
  const roleSelect = modal.querySelector('#mem-role');
  const saveBtn = modal.querySelector('[data-member-save]');
  nameInput.focus();
  nameInput.select();

  saveBtn.addEventListener('click', async () => {
    errorEl.classList.add('hidden');
    const displayName = nameInput.value.trim();
    const email = emailInput.value.trim().toLowerCase();
    const role = isMe ? member.role : roleSelect.value;
    if (!displayName) { showError('Nama wajib diisi.'); nameInput.focus(); return; }
    if (!editing && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { showError('Format email tidak valid.'); emailInput.focus(); return; }

    saveBtn.disabled = true;
    const originalLabel = saveBtn.textContent;
    saveBtn.textContent = 'Menyimpan...';
    const res = editing
      ? await callServer('updateMember', { id: member.id, displayName, role })
      : await callServer('addMember', { email, displayName, role });
    if (!res.success) {
      saveBtn.disabled = false;
      saveBtn.textContent = originalLabel;
      showError(res.message || 'Gagal menyimpan member.');
      return;
    }
    close();
    toast(res.message || (editing ? 'Member diperbarui' : 'Member ditambahkan'));
    await refreshMemberContext();
    await loadMembersList();
    await loadActivityList();
  });
}

/* ============================================================
 * Settings View
 * ============================================================ */

/* ------------------------------------------------------------
 * Backup & diagnostik (Settings)
 * ------------------------------------------------------------ */

// Koleksi yang ikut diekspor + labelnya untuk ringkasan jumlah.
const BACKUP_COLLECTIONS = [
  ['members', 'Anggota'],
  ['invites', 'Undangan'],
  ['workflows', 'Workflow'],
  ['nodes', 'Node kanvas'],
  ['edges', 'Koneksi kanvas'],
  ['tasks', 'Task'],
  ['applications', 'Aplikasi'],
  ['taskApplications', 'Link task-aplikasi'],
  ['checklist', 'Checklist'],
  ['applicationCategories', 'Kategori aplikasi'],
  ['comments', 'Komentar'],
  ['activityLogs', 'Activity log'],
  ['chatMessages', 'Pesan chat'],
  ['chatReads', 'Status baca chat'],
];

function backupCounts() {
  const out = {};
  BACKUP_COLLECTIONS.forEach(([key]) => {
    out[key] = (Store.readAll(key) || []).length;
  });
  return out;
}

function buildBackupPayload() {
  const collections = {};
  BACKUP_COLLECTIONS.forEach(([key]) => {
    collections[key] = Store.readAll(key) || [];
  });
  const ws = (State.init && State.init.workspace) || null;
  const me = (State.init && State.init.currentUser) || null;
  const fbInfo = (window.FlowFirebase && FlowFirebase.info) ? FlowFirebase.info() : null;
  return {
    format: 'flowspace-backup',
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    projectId: fbInfo ? fbInfo.projectId : '',
    workspace: ws,
    exportedBy: me ? { email: me.email, role: me.role } : null,
    counts: backupCounts(),
    collections: collections,
  };
}

function backupFileName(payload) {
  const name = (payload.workspace && payload.workspace.name) || 'workspace';
  const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'workspace';
  const stamp = payload.exportedAt.replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `flowspace-${slug}-${stamp}.json`;
}

function downloadBackup() {
  const payload = buildBackupPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = backupFileName(payload);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return payload;
}

function buildDiagnostics() {
  const fb = window.FlowFirebase;
  const live = isFirebaseLive();
  // Di mode lokal FlowFirebase tidak diinisialisasi; nilainya default dan
  // menyesatkan kalau ditampilkan apa adanya.
  const info = (live && fb && fb.info) ? fb.info() : null;
  const counts = backupCounts();
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const user = (live && fb && fb.currentUser) ? fb.currentUser() : null;
  return {
    time: new Date().toISOString(),
    mode: live ? 'firebase' : 'local',
    sdk: (window.firebase && firebase.SDK_VERSION) || '(compat/lokal)',
    projectId: info ? info.projectId : '',
    authPersistence: info ? info.authPersistence : '',
    firestoreCache: info ? info.persistence : '',
    storagePersisted: info ? !!info.storagePersisted : null,
    hasSessionMarker: info ? !!info.hasSession : null,
    listeners: info ? info.listeners : 0,
    workspaceId: (State.init && State.init.workspace && State.init.workspace.id) || '',
    uid: user ? user.uid : '',
    online: navigator.onLine,
    visibility: document.visibilityState,
    totalDocuments: total,
    collections: counts,
  };
}

function renderDiagnosticsPanel() {
  const el = $('#settings-diag');
  if (!el) return;
  const d = buildDiagnostics();
  const rows = [
    ['Mode', d.mode === 'firebase' ? 'Firebase' : 'Lokal'],
    ['SDK', d.sdk],
    ['Project', d.projectId || '-'],
    ['Auth persistence', d.authPersistence || '-'],
    ['Cache Firestore', d.firestoreCache || '-'],
    ['Listener aktif', d.mode === 'firebase' ? String(d.listeners) : '-'],
    ['Penanda sesi', d.hasSessionMarker === null ? '-' : (d.hasSessionMarker ? 'ada' : 'tidak ada')],
    ['Koneksi', d.online ? 'online' : 'offline'],
    ['Workspace', d.workspaceId || '-'],
    ['Dokumen lokal', String(d.totalDocuments)],
  ];
  el.innerHTML = rows.map(([k, v]) => `
    <div class="flex items-baseline justify-between gap-2 min-w-0">
      <dt class="text-inksoft shrink-0">${escapeHtml(k)}</dt>
      <dd class="font-medium text-right truncate" title="${escapeHtml(v)}">${escapeHtml(v)}</dd>
    </div>`).join('');
}

async function renderSettings(container) {
  container.className = 'h-full w-full overflow-auto p-6 space-y-6';
  const setupRes = await callServer('getSetupStatus');
  const setup = setupRes.success ? setupRes.data : { setupRequired: true };
  const counts = backupCounts();
  const totalDocs = Object.values(counts).reduce((a, b) => a + b, 0);
  const role = (State.init && State.init.currentUser && State.init.currentUser.role) || 'viewer';
  const canExport = role === 'admin';
  container.innerHTML = `
    <div>
      <h1 class="font-display text-2xl font-semibold tracking-tight">Settings</h1>
      <p class="text-sm text-inksoft mt-1">Konfigurasi workspace dan informasi sistem.</p>
    </div>
    <div class="bg-card border border-line rounded-xl p-5">
      <h3 class="text-base font-medium flex items-center gap-2 mb-3"><i data-lucide="building-2" class="h-4 w-4 text-fern"></i>Workspace</h3>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div class="min-w-0"><label class="form-label">Nama Workspace</label><p class="text-sm font-medium mt-0.5 break-words">${State.init && State.init.workspace ? escapeHtml(State.init.workspace.name) : '-'}</p></div>
        <div class="min-w-0"><label class="form-label">Owner Email</label><p class="text-sm font-medium mt-0.5 break-all">${State.init && State.init.workspace ? escapeHtml(State.init.workspace.ownerEmail) : '-'}</p></div>
        <div class="min-w-0"><label class="form-label">Mode Data</label><p class="text-sm font-medium mt-0.5">${isFirebaseLive() ? 'Firebase Firestore' : 'Lokal (localStorage)'}</p></div>
        <div class="min-w-0"><label class="form-label">Project</label><p class="text-sm font-medium mt-0.5 font-mono text-xs break-all">${escapeHtml(setup.projectId || '-')}</p></div>
        <div class="min-w-0"><label class="form-label">Status</label><p class="text-sm font-medium mt-0.5">${setup.setupRequired ? 'Belum siap' : (isFirebaseLive() ? 'Tersinkron' : 'Siap')}</p></div>
      </div>
    </div>
    <div class="bg-card border border-line rounded-xl p-5">
      <h3 class="text-base font-medium flex items-center gap-2 mb-3"><i data-lucide="user" class="h-4 w-4 text-fern"></i>Pengguna Saat Ini</h3>
      ${State.init && State.init.currentUser ? `
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="min-w-0"><label class="form-label">Nama</label><p class="text-sm font-medium mt-0.5 break-words">${escapeHtml(State.init.currentUser.displayName)}</p></div>
          <div class="min-w-0"><label class="form-label">Email</label><p class="text-sm font-medium mt-0.5 break-all">${escapeHtml(State.init.currentUser.email)}</p></div>
          <div><label class="form-label">Role</label><p class="mt-0.5"><span class="badge ${State.init.currentUser.role === 'admin' ? 'bg-berry/10 text-berry' : State.init.currentUser.role === 'editor' ? 'bg-fernlight/15 text-ferndeep' : 'bg-paper text-ink'} capitalize">${escapeHtml(State.init.currentUser.role)}</span></p></div>
        </div>
        ${isFirebaseLive() ? '<div class="mt-4 pt-4 border-t border-line"><button id="settings-logout" class="btn btn-secondary btn-sm"><i data-lucide="log-out" class="h-3.5 w-3.5"></i>Keluar dari akun</button></div>' : ''}
      ` : '<p class="text-sm text-inksoft">Tidak ada user terautentikasi.</p>'}
    </div>
    <div class="bg-card border border-line rounded-xl p-5">
      <h3 class="text-base font-medium flex items-center gap-2 mb-3"><i data-lucide="shield" class="h-4 w-4 text-fern"></i>Matriks Hak Akses</h3>
      <div class="overflow-x-auto">
      <table class="table min-w-[420px]">
        <thead><tr><th>Aksi</th><th class="text-center">Admin</th><th class="text-center">Editor</th><th class="text-center">Viewer</th></tr></thead>
        <tbody>
          ${[
            ['Lihat workflow & task', 'Ya', 'Ya', 'Ya'],
            ['Membuat workflow', 'Ya', 'Ya', 'Tidak'],
            ['Mengubah canvas', 'Ya', 'Ya', 'Tidak'],
            ['Membuat/mengubah task', 'Ya', 'Ya', 'Tidak'],
            ['Mengelola Application Hub', 'Ya', 'Ya', 'Tidak'],
            ['Mengelola anggota', 'Ya', 'Tidak', 'Tidak'],
            ['Mengarsipkan/hapus workflow', 'Ya', 'Tidak', 'Tidak'],
          ].map(row => `
            <tr>
              <td>${row[0]}</td>
              <td class="text-center"><span class="badge bg-paper text-ink">${row[1]}</span></td>
              <td class="text-center"><span class="badge bg-paper text-ink">${row[2]}</span></td>
              <td class="text-center"><span class="badge bg-paper text-ink">${row[3]}</span></td>
            </tr>`).join('')}
        </tbody>
      </table>
      </div>
    </div>
    <div class="bg-card border border-line rounded-xl p-5">
      <h3 class="text-base font-medium flex items-center gap-2 mb-3"><i data-lucide="database" class="h-4 w-4 text-fern"></i>Manajemen Data</h3>
      <div class="space-y-3">
        <div class="flex items-center justify-between gap-3 p-3 rounded-md border border-line bg-paper">
          <div class="flex items-start gap-2 min-w-0">
            <i data-lucide="refresh-cw" class="h-4 w-4 text-fern mt-0.5 shrink-0"></i>
            <div class="min-w-0">
              <p class="text-sm font-medium">Muat Ulang Konteks Workspace</p>
              <p class="text-xs text-inksoft">Sinkronkan data workspace dari penyimpanan.</p>
            </div>
          </div>
          <button id="settings-refresh" class="btn btn-secondary btn-sm"><i data-lucide="refresh-cw" class="h-3.5 w-3.5"></i>Refresh</button>
        </div>
        <div class="flex items-center justify-between gap-3 p-3 rounded-md border border-line bg-paper">
          <div class="flex items-start gap-2 min-w-0">
            <i data-lucide="sparkles" class="h-4 w-4 text-fern mt-0.5 shrink-0"></i>
            <div class="min-w-0">
              <p class="text-sm font-medium">Seed Data Demo</p>
              <p class="text-xs text-inksoft">Tambahkan workflow, task, dan aplikasi contoh untuk testing.</p>
            </div>
          </div>
          <button id="settings-seed" class="btn btn-secondary btn-sm"><i data-lucide="sparkles" class="h-3.5 w-3.5"></i>Seed</button>
        </div>
        <div class="flex items-center justify-between gap-3 p-3 rounded-md border border-amber/40 bg-amber/10">
          <div class="flex items-start gap-2 min-w-0">
            <i data-lucide="alert-triangle" class="h-4 w-4 text-[#8A5F10] mt-0.5 shrink-0"></i>
            <div class="min-w-0">
              <p class="text-sm font-medium">Reset Database</p>
              <p class="text-xs text-inksoft">Hapus SEMUA data. Hati-hati!</p>
            </div>
          </div>
          <button id="settings-reset" class="btn btn-danger btn-sm"><i data-lucide="trash-2" class="h-3.5 w-3.5"></i>Reset</button>
        </div>
      </div>
    </div>
    <div class="bg-card border border-line rounded-xl p-5">
      <h3 class="text-base font-medium flex items-center gap-2 mb-3"><i data-lucide="download" class="h-4 w-4 text-fern"></i>Backup &amp; Export</h3>
      <div class="flex items-center justify-between gap-3 p-3 rounded-md border border-line bg-paper">
        <div class="flex items-start gap-2 min-w-0">
          <i data-lucide="file-json" class="h-4 w-4 text-fern mt-0.5 shrink-0"></i>
          <div class="min-w-0">
            <p class="text-sm font-medium">Unduh Backup JSON</p>
            <p class="text-xs text-inksoft">Snapshot semua data workspace yang sedang tersinkron di perangkat ini.</p>
          </div>
        </div>
        <button id="settings-backup" class="btn btn-secondary btn-sm"${canExport ? '' : ' disabled title="Hanya admin workspace"'}>
          <i data-lucide="download" class="h-3.5 w-3.5"></i>Unduh
        </button>
      </div>
      <p class="text-xs text-inksoft mt-3">
        ${canExport
          ? `Akan mengekspor <span class="font-medium text-ink">${totalDocs}</span> dokumen (${counts.tasks} task, ${counts.workflows} workflow, ${counts.applications} aplikasi, ${counts.activityLogs} activity log). Simpan file di tempat aman.`
          : 'Hanya admin workspace yang dapat mengunduh backup.'}
      </p>
    </div>
    <div class="bg-card border border-line rounded-xl p-5">
      <div class="flex items-start justify-between gap-3 mb-3">
        <h3 class="text-base font-medium flex items-center gap-2"><i data-lucide="activity" class="h-4 w-4 text-fern"></i>Diagnostik</h3>
        <button id="settings-diag-copy" class="btn btn-ghost btn-sm"><i data-lucide="copy" class="h-3.5 w-3.5"></i>Salin</button>
      </div>
      <dl id="settings-diag" class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm"></dl>
      <p class="text-xs text-inksoft mt-3">Tempelkan hasil <span class="font-medium text-ink">Salin</span> saat melaporkan bug — berisi versi SDK, jumlah listener, dan kondisi sesi.</p>
    </div>
    <p class="text-center text-xs text-inksoft pt-4">FlowSpace · Satu sumber data, banyak tampilan</p>
  `;
  refreshIcons();
  renderDiagnosticsPanel();
  $('#settings-refresh').addEventListener('click', () => initApp());

  const backupBtn = $('#settings-backup');
  if (backupBtn) backupBtn.addEventListener('click', () => {
    if (backupBtn.disabled) return;
    try {
      const payload = downloadBackup();
      toast('Backup diunduh', 'success', backupFileName(payload));
    } catch (err) {
      console.error('[FlowSpace] export gagal', err);
      toast('Gagal membuat backup', 'error', err && err.message ? err.message : '');
    }
  });

  const diagCopy = $('#settings-diag-copy');
  if (diagCopy) diagCopy.addEventListener('click', async () => {
    const text = JSON.stringify(buildDiagnostics(), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      toast('Diagnostik disalin', 'success', 'Tempelkan saat melaporkan bug.');
    } catch (err) {
      console.warn('[FlowSpace] clipboard gagal', err);
      toast('Tidak bisa menyalin otomatis', 'error', 'Buka ?debug=1 lalu salin dari console.');
    }
  });

  const logoutBtn = $('#settings-logout');
  if (logoutBtn) logoutBtn.addEventListener('click', () => doLogout());

  $('#settings-seed').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const ok = await showConfirmDialog({
      title: 'Muat data demo?',
      message: isFirebaseLive()
        ? 'Workflow, task, dan aplikasi contoh akan ditambahkan ke workspace ini dan tersinkron ke semua perangkat.'
        : 'Workflow, task, dan aplikasi contoh akan ditambahkan ke workspace lokal ini.',
      confirmText: 'Muat Demo',
      cancelText: 'Batal',
    });
    if (!ok) return;
    btn.disabled = true; btn.innerHTML = '<div class="spinner spinner-dark"></div>Memuat...';
    const res = await callServer('seedDemoData');
    btn.disabled = false; btn.innerHTML = '<i data-lucide="sparkles" class="h-3.5 w-3.5"></i>Seed';
    refreshIcons();
    if (res.success) { toast('Demo data dimuat', 'success', 'Menyegarkan tampilan...'); initApp(); }
    else toast(res.message || 'Gagal', 'error');
  });

  $('#settings-reset').addEventListener('click', async () => {
    const ok = await showConfirmDialog({
      title: 'Reset seluruh data workspace?',
      message: isFirebaseLive()
        ? 'Semua workflow, task, aplikasi, dan log akan dihapus dari Firestore. Akun anggota tetap ada. Tindakan ini tidak bisa dibatalkan.'
        : 'Semua data workspace lokal akan dihapus. Tindakan ini tidak bisa dibatalkan.',
      confirmText: 'Reset Data',
      cancelText: 'Batal',
      danger: true,
    });
    if (!ok) return;
    const res = await callServer('resetDatabase');
    if (res.success) { toast(res.message || 'Database direset', 'success'); initApp(); }
    else toast(res.message || 'Gagal', 'error');
  });
}

async function loadAppCategoriesSettings(listId = 'cat-manage-list') {
  const list = document.getElementById(listId);
  if (!list) return;
  list.innerHTML = '<div class="flex items-center gap-2 text-inksoft text-sm"><div class="spinner spinner-dark"></div>Memuat...</div>';
  const res = await callServer('listApplicationCategories');
  if (!res.success) {
    list.innerHTML = `<div class="text-berry text-sm">${escapeHtml(res.message || 'Gagal memuat kategori')}</div>`;
    return;
  }
  const cats = res.data || [];
  if (cats.length === 0) {
    list.innerHTML = '<p class="text-sm text-inksoft">Belum ada kategori.</p>';
    refreshIcons();
    return;
  }
  list.innerHTML = cats.map(c => `
    <div class="flex items-center justify-between gap-2 p-2 rounded-md border border-line bg-paper">
      <div class="flex items-center gap-2 min-w-0">
        <i data-lucide="tag" class="h-3.5 w-3.5 text-inksoft shrink-0"></i>
        <span class="text-sm truncate">${escapeHtml(c.name)}</span>
      </div>
      <div class="flex items-center gap-1">
        <button class="btn btn-ghost btn-sm" data-cat-edit data-cat-id="${escapeHtml(c.id)}" data-cat-name="${escapeHtml(c.name)}" title="Edit kategori" aria-label="Edit kategori"><i data-lucide="pencil" class="h-3.5 w-3.5"></i></button>
        <button class="btn btn-ghost btn-sm text-berry" data-cat-del data-cat-id="${escapeHtml(c.id)}" data-cat-name="${escapeHtml(c.name)}" title="Hapus kategori" aria-label="Hapus kategori"><i data-lucide="trash-2" class="h-3.5 w-3.5"></i></button>
      </div>
    </div>
  `).join('');
  refreshIcons();
  list.querySelectorAll('[data-cat-edit]').forEach(btn => {
    btn.addEventListener('click', () => showEditAppCategoryDialog(btn.dataset.catId, btn.dataset.catName));
  });
  list.querySelectorAll('[data-cat-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await showConfirmDialog({
        title: 'Hapus kategori?',
        message: `Kategori "${btn.dataset.catName}" akan dihapus dari daftar pilihan. Aplikasi yang memakainya tetap ada.`,
        confirmText: 'Hapus',
        cancelText: 'Batal',
        danger: true,
      });
      if (!ok) return;
      const resDel = await callServer('deleteApplicationCategory', btn.dataset.catId);
      if (resDel.success) {
        toast('Kategori dihapus');
        refreshAppCategoryViews();
      } else {
        toast(resDel.message || 'Gagal menghapus', 'error');
      }
    });
  });
}

function refreshAppCategoryViews() {
  if (document.getElementById('cat-manage-list')) loadAppCategoriesSettings('cat-manage-list');
  if (document.getElementById('apps-list')) loadApplicationsList();
}

function showAddAppCategoryDialog() {
  const html = `
    <div class="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4" id="cat-modal-backdrop">
      <div class="bg-card rounded-xl shadow-soft max-w-sm w-full" onclick="event.stopPropagation()">
        <div class="px-5 py-4 border-b border-line"><h3 class="text-base font-semibold">Tambah Kategori</h3></div>
        <div class="p-5 space-y-3">
          <div>
            <label class="form-label">Nama Kategori</label>
            <input type="text" id="cat-name-input" class="form-input" placeholder="Contoh: Finance">
          </div>
        </div>
        <div class="px-5 py-3 border-t border-line flex justify-end gap-2">
          <button class="btn btn-secondary btn-sm" id="cat-cancel">Batal</button>
          <button class="btn btn-primary btn-sm" id="cat-save">Simpan</button>
        </div>
      </div>
    </div>`;
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  document.body.appendChild(wrap.firstElementChild);
  const input = document.getElementById('cat-name-input');
  input.focus();
  const close = () => document.getElementById('cat-modal-backdrop').remove();
  document.getElementById('cat-cancel').onclick = close;
  document.getElementById('cat-modal-backdrop').onclick = close;
  document.getElementById('cat-save').onclick = async () => {
    const name = input.value.trim();
    if (!name) { toast('Nama kategori wajib diisi', 'error'); return; }
    const res = await callServer('createApplicationCategory', { name });
    if (res.success) {
      toast('Kategori ditambahkan');
      close();
      refreshAppCategoryViews();
    } else {
      toast(res.message || 'Gagal', 'error');
    }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('cat-save').click(); }
    if (e.key === 'Escape') close();
  });
}

function showEditAppCategoryDialog(id, currentName) {
  const html = `
    <div class="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4" id="cat-modal-backdrop">
      <div class="bg-card rounded-xl shadow-soft max-w-sm w-full" onclick="event.stopPropagation()">
        <div class="px-5 py-4 border-b border-line"><h3 class="text-base font-semibold">Edit Kategori</h3></div>
        <div class="p-5 space-y-3">
          <div>
            <label class="form-label">Nama Kategori</label>
            <input type="text" id="cat-name-input" class="form-input" value="${escapeHtml(currentName)}">
          </div>
        </div>
        <div class="px-5 py-3 border-t border-line flex justify-end gap-2">
          <button class="btn btn-secondary btn-sm" id="cat-cancel">Batal</button>
          <button class="btn btn-primary btn-sm" id="cat-save">Simpan</button>
        </div>
      </div>
    </div>`;
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  document.body.appendChild(wrap.firstElementChild);
  const input = document.getElementById('cat-name-input');
  input.focus();
  input.select();
  const close = () => document.getElementById('cat-modal-backdrop').remove();
  document.getElementById('cat-cancel').onclick = close;
  document.getElementById('cat-modal-backdrop').onclick = close;
  document.getElementById('cat-save').onclick = async () => {
    const name = input.value.trim();
    if (!name) { toast('Nama kategori wajib diisi', 'error'); return; }
    const res = await callServer('updateApplicationCategory', { id, name });
    if (res.success) {
      toast('Kategori diperbarui');
      close();
      refreshAppCategoryViews();
    } else {
      toast(res.message || 'Gagal', 'error');
    }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('cat-save').click(); }
    if (e.key === 'Escape') close();
  });
}

/* ============================================================
 * Task Detail Drawer
 * ============================================================ */

async function openTaskDrawer(taskId) {
  State.taskDrawer.taskId = taskId;
  const drawer = $('#task-drawer');
  drawer.classList.remove('hidden');
  bindDrawerEscape();
  const content = $('#drawer-content');
  content.innerHTML = '<div class="p-5 flex items-center gap-2 text-inksoft"><div class="spinner spinner-dark"></div>Memuat task...</div>';
  $('#drawer-backdrop').onclick = () => closeTaskDrawer();
  const res = await callServer('getTask', taskId);
  if (!res.success) {
    content.innerHTML = `<div class="p-5 text-berry">${escapeHtml(res.message || 'Gagal')}</div>`;
    return;
  }
  const t = res.data;
  const memberMap = {};
  if (State.init && State.init.members) State.init.members.forEach(m => memberMap[m.email] = m.displayName);
  const completed = t.checklist.filter(c => c.isCompleted).length;
  const role = (State.init && State.init.currentUser && State.init.currentUser.role) || 'viewer';
  const canEdit = t.canEdit !== false;
  const isAdminRole = role === 'admin';
  const assigneeName = (t.assigneeEmail && memberMap[t.assigneeEmail]) || t.assigneeEmail || 'anggota lain';
  const lockBanner = !canEdit ? `
    <div class="px-5 py-3 border-b border-line bg-paper flex items-start gap-2">
      <i data-lucide="lock" class="h-4 w-4 text-clay shrink-0 mt-0.5"></i>
      <div class="flex-1 text-xs text-inksoft">
        ${t.isUnassigned
          ? 'Task ini belum memiliki PIC. Ambil task untuk mulai mengerjakannya.'
          : `Hanya PIC task atau admin yang dapat mengubah task ini. Task ini milik <span class="font-medium text-ink">${escapeHtml(assigneeName)}</span>.`}
      </div>
      ${t.isUnassigned && role !== 'viewer' ? '<button id="task-claim" class="btn btn-primary btn-sm shrink-0"><i data-lucide="hand" class="h-3.5 w-3.5"></i>Ambil task</button>' : ''}
    </div>
  ` : '';
  content.innerHTML = `
    <div class="p-5 border-b border-line">
      <div class="flex items-start justify-between mb-2">
        <span class="text-xs text-inksoft">${t.workflowName ? escapeHtml(t.workflowName) : 'Tanpa workflow'}</span>
        <button id="drawer-close" class="btn btn-ghost btn-sm"><i data-lucide="x" class="h-4 w-4"></i></button>
      </div>
      <input type="text" id="task-title" class="w-full text-base font-semibold border-0 px-0 focus:outline-none" value="${escapeHtml(t.title)}" ${canEdit ? '' : 'disabled'}>
      <div class="flex items-center gap-2 flex-wrap mt-2">
        <span class="badge badge-${escapeHtml(t.status)}">${escapeHtml(STATUS_LABEL[t.status])}</span>
        <span class="badge badge-${escapeHtml(t.priority)}">${escapeHtml(PRIORITY_LABEL[t.priority])}</span>
        ${t.dueDate ? `<span class="badge bg-paper text-ink flex items-center gap-1"><i data-lucide="calendar" class="h-2.5 w-2.5"></i>${formatDate(t.dueDate)}</span>` : ''}
      </div>
    </div>
    ${lockBanner}
    <div class="p-5 space-y-5">
      <div>
        <label class="form-label">Deskripsi</label>
        <textarea id="task-desc" class="form-textarea" rows="3" placeholder="Tambahkan detail..." ${canEdit ? '' : 'disabled'}>${escapeHtml(t.description || '')}</textarea>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="form-label flex items-center gap-1"><i data-lucide="user" class="h-3 w-3"></i>PIC</label>
          <select id="task-assignee" class="form-select h-9" ${canEdit && isAdminRole ? '' : 'disabled'}>
            <option value="">Tidak ada</option>
            ${(() => {
              const all = (State.init && State.init.members) || [];
              const list = all.filter(m => m.status === 'active');
              if (t.assigneeEmail && !list.some(m => m.email === t.assigneeEmail)) {
                const current = all.find(m => m.email === t.assigneeEmail);
                // Member yang sudah dihapus tetap ditampilkan agar assignment
                // tidak hilang saat drawer disimpan tanpa perubahan PIC.
                list.push(current || { email: t.assigneeEmail, displayName: t.assigneeEmail, status: 'deleted' });
              }
              return list.map(m => `<option value="${escapeHtml(m.email)}" ${m.email === t.assigneeEmail ? 'selected' : ''}>${escapeHtml(m.displayName)}${m.status === 'inactive' ? ' (nonaktif)' : m.status === 'deleted' ? ' (dihapus)' : ''}</option>`).join('');
            })()}
          </select>
        </div>
        <div>
          <label class="form-label flex items-center gap-1"><i data-lucide="flag" class="h-3 w-3"></i>Priority</label>
          <select id="task-priority" class="form-select h-9" ${canEdit ? '' : 'disabled'}>${PRIORITIES.map(p => `<option value="${p.id}" ${p.id === t.priority ? 'selected' : ''}>${p.label}</option>`).join('')}</select>
        </div>
        <div>
          <label class="form-label">Status</label>
          <select id="task-status" class="form-select h-9" ${canEdit ? '' : 'disabled'}>${STATUSES.map(s => `<option value="${s.id}" ${s.id === t.status ? 'selected' : ''}>${s.label}</option>`).join('')}</select>
        </div>
        <div>
          <label class="form-label">Due Date</label>
          <input type="date" id="task-due" class="form-input h-9" value="${escapeHtml(t.dueDate || '')}" ${canEdit ? '' : 'disabled'}>
        </div>
      </div>
      <div>
        <div class="flex items-center justify-between"><label class="form-label flex items-center gap-1"><i data-lucide="check-square" class="h-3 w-3"></i>Progress</label><span class="text-xs font-medium text-fern" id="task-progress-val">${t.progress}%</span></div>
        <div class="bg-line rounded-full h-2 mt-1"><div class="bg-fern h-2 rounded-full transition-all" id="task-progress-bar" style="width:${t.progress}%"></div></div>
        <input type="range" id="task-progress" min="0" max="100" step="5" value="${t.progress}" class="w-full mt-2" ${(!canEdit || t.progressMode === 'checklist') ? 'disabled' : ''}>
      </div>
      <hr class="border-line">
      <div>
        <div class="flex items-center justify-between mb-2">
          <label class="form-label flex items-center gap-1 mb-0"><i data-lucide="check-square" class="h-3 w-3"></i>Checklist (${completed}/${t.checklist.length})</label>
        </div>
        <div id="checklist-container" class="space-y-1.5">
          ${t.checklist.map(c => `
            <div class="flex items-start gap-2 group" data-item-id="${escapeHtml(c.id)}">
              <input type="checkbox" ${c.isCompleted ? 'checked' : ''} class="mt-0.5 checklist-item-${escapeHtml(c.id)}" data-item-id="${escapeHtml(c.id)}" data-completed="${c.isCompleted}" ${canEdit ? '' : 'disabled'}>
              <span class="text-xs flex-1 ${c.isCompleted ? 'line-through text-inksoft/50' : ''}">${escapeHtml(c.title)}</span>
              ${canEdit ? `<button class="del-item-${escapeHtml(c.id)} opacity-0 group-hover:opacity-100 btn btn-ghost btn-sm" data-item-id="${escapeHtml(c.id)}"><i data-lucide="x" class="h-3 w-3"></i></button>` : ''}
            </div>
          `).join('')}
        </div>
        ${canEdit ? `
        <div class="flex gap-2 mt-2">
          <input type="text" id="new-checklist-input" class="form-input h-8 text-xs" placeholder="Tambah item...">
          <button id="add-checklist" class="btn btn-secondary btn-sm"><i data-lucide="plus" class="h-3.5 w-3.5"></i></button>
        </div>
        ` : ''}
      </div>
      <hr class="border-line">
      <div>
        <div class="flex items-center justify-between mb-2">
          <label class="form-label flex items-center gap-1 mb-0"><i data-lucide="link-2" class="h-3 w-3"></i>Aplikasi Terkait</label>
          ${canEdit ? '<button id="link-app-btn" class="btn btn-ghost btn-sm text-xs"><i data-lucide="plus" class="h-3 w-3"></i>Tambah</button>' : ''}
        </div>
        <div id="apps-container" class="space-y-1.5">
          ${t.applications.length === 0 ? '<p class="text-xs text-inksoft">Belum ada aplikasi terkait.</p>' :
            t.applications.map(a => `
              <div class="flex items-center gap-2 p-2 rounded-md border border-line bg-paper group" data-task-app-id="${escapeHtml(a.taskAppId)}">
                <div class="h-7 w-7 rounded-md bg-fernlight/15 text-ferndeep flex items-center justify-center text-xs font-semibold">${escapeHtml(a.name.charAt(0).toUpperCase())}</div>
                <div class="flex-1 min-w-0">
                  <p class="text-xs font-medium truncate">${escapeHtml(a.name)}</p>
                  ${a.linkLabel ? `<p class="text-[10px] text-inksoft truncate">${escapeHtml(a.linkLabel)}</p>` : ''}
                </div>
                <a href="${escapeHtml(a.url)}" target="_blank" rel="noopener" class="text-fern hover:bg-fernlight/10 h-7 w-7 flex items-center justify-center rounded-md"><i data-lucide="external-link" class="h-3.5 w-3.5"></i></a>
                ${canEdit ? `<button class="unlink-app-${escapeHtml(a.taskAppId)} opacity-0 group-hover:opacity-100 btn btn-ghost btn-sm" data-task-app-id="${escapeHtml(a.taskAppId)}"><i data-lucide="x" class="h-3 w-3"></i></button>` : ''}
              </div>
            `).join('')}
        </div>
      </div>
      <hr class="border-line">
      <div id="task-comments"></div>
      <hr class="border-line">
      <div id="task-activity"></div>
    </div>
    <div class="p-4 border-t border-line bg-card sticky bottom-0 flex gap-2">
      ${canEdit ? `<button id="task-delete" class="btn btn-danger btn-sm mr-auto"><i data-lucide="trash-2" class="h-3.5 w-3.5"></i>Hapus</button>` : '<span class="mr-auto text-[11px] text-inksoft self-center flex items-center gap-1"><i data-lucide="eye" class="h-3 w-3"></i>Mode lihat</span>'}
      <button id="task-close-btn" class="btn btn-secondary btn-sm">Tutup</button>
      ${canEdit ? `<button id="task-save" class="btn btn-primary btn-sm" data-task-id="${escapeHtml(t.id)}" data-version="${t.version}"><i data-lucide="save" class="h-3.5 w-3.5"></i>Simpan</button>` : ''}
    </div>
  `;
  refreshIcons();
  $('#drawer-close').addEventListener('click', closeTaskDrawer);
  $('#task-close-btn').addEventListener('click', closeTaskDrawer);
  $('#task-progress').addEventListener('input', (e) => {
    const v = parseInt(e.target.value, 10);
    $('#task-progress-val').textContent = v + '%';
    $('#task-progress-bar').style.width = v + '%';
  });

  $$('input[type="checkbox"][data-item-id]', content).forEach(cb => {
    cb.addEventListener('change', async (e) => {
      const itemId = e.target.dataset.itemId;
      const isCompleted = e.target.checked;
      const span = e.target.parentElement.querySelector('span');
      if (span) span.classList.toggle('line-through', isCompleted);
      if (span) span.classList.toggle('text-inksoft/50', isCompleted);
      await callServer('updateChecklistItem', { id: itemId, isCompleted });
      const newRes = await callServer('getTask', taskId);
      if (newRes.success) {
        $('#task-progress-val').textContent = newRes.data.progress + '%';
        $('#task-progress-bar').style.width = newRes.data.progress + '%';
        $('#task-progress').value = newRes.data.progress;
      }
    });
  });
  $$('[class*="del-item-"]', content).forEach(btn => btn.addEventListener('click', async (e) => {
    const itemId = e.currentTarget.dataset.itemId;
    await callServer('deleteChecklistItem', { itemId });
    toast('Item dihapus');
    openTaskDrawer(taskId);
  }));
  if ($('#add-checklist')) $('#add-checklist').addEventListener('click', async () => {
    const input = $('#new-checklist-input');
    if (!input.value.trim()) return;
    await callServer('createChecklistItem', { taskId, title: input.value.trim() });
    input.value = '';
    toast('Item ditambahkan');
    openTaskDrawer(taskId);
  });

  if ($('#link-app-btn')) $('#link-app-btn').addEventListener('click', () => showLinkAppDialog(taskId));
  $$('[class*="unlink-app-"]').forEach(btn => btn.addEventListener('click', async (e) => {
    const taskAppId = e.currentTarget.dataset.taskAppId;
    await callServer('unlinkApplicationFromTask', taskAppId);
    toast('Link dihapus');
    openTaskDrawer(taskId);
  }));

  if ($('#task-save')) $('#task-save').addEventListener('click', async (e) => {
    const id = e.currentTarget.dataset.taskId;
    const expectedVersion = parseInt(e.currentTarget.dataset.version, 10);
    const btn = e.currentTarget;
    btn.disabled = true;
    const payload = {
      id,
      title: $('#task-title').value,
      description: $('#task-desc').value,
      assigneeEmail: $('#task-assignee').value || null,
      status: $('#task-status').value,
      priority: $('#task-priority').value,
      dueDate: $('#task-due').value || null,
      expectedVersion,
    };
    if (t.progressMode !== 'checklist') {
      payload.progress = parseInt($('#task-progress').value, 10);
    }
    const res = await callServer('updateTask', payload);
    btn.disabled = false;
    if (res.success) toast('Task diperbarui');
    else if (res.errorCode === 'VERSION_CONFLICT') {
      toast('Konflik versi', 'error', 'Memuat ulang...');
      setTimeout(() => openTaskDrawer(taskId), 1500);
    } else toast(res.message || 'Gagal', 'error');
  });

  if ($('#task-delete')) $('#task-delete').addEventListener('click', async () => {
    const ok = await showConfirmDialog({
      title: 'Hapus task?',
      message: 'Node dan workflow terkait tetap dipertahankan. Tindakan ini tidak bisa dibatalkan.',
      confirmText: 'Hapus Task',
      cancelText: 'Batal',
      danger: true,
    });
    if (!ok) return;
    const res = await callServer('deleteTask', taskId);
    if (res.success) { toast('Task dihapus'); closeTaskDrawer(); if (State.view.kind === 'kanban') loadKanbanTasks(); if (State.view.kind === 'dashboard') renderView(); }
    else toast(res.message || 'Gagal', 'error');
  });

  if ($('#task-claim')) $('#task-claim').addEventListener('click', async () => {
    const res = await callServer('claimTask', taskId);
    if (res.success) { toast('Task diambil. Sekarang Anda PIC-nya.'); openTaskDrawer(taskId); }
    else toast(res.message || 'Gagal mengambil task', 'error');
  });

  loadTaskActivity(taskId, $('#task-activity'));
  mountCommentThread($('#task-comments'), 'task', taskId);
}

async function loadTaskActivity(taskId, container) {
  container.innerHTML = '<div class="flex items-center gap-2 text-inksoft"><div class="spinner spinner-dark"></div>Memuat aktivitas...</div>';
  const res = await callServer('listActivityLogs', { entityType: 'task', limit: 50 });
  if (!res.success) { container.innerHTML = ''; return; }
  const logs = res.data.filter(l => l.entityId === taskId).slice(0, 8);
  const actionLabel = { create: 'dibuat', status_change: 'status diubah', priority_change: 'priority diubah', assignee_change: 'PIC diganti', progress_update: 'progress diupdate', due_date_change: 'deadline diubah', link_application: 'aplikasi ditautkan', unlink_application: 'aplikasi dilepas', delete: 'dihapus' };
  container.innerHTML = `
    <label class="form-label flex items-center gap-1"><i data-lucide="activity" class="h-3 w-3"></i>Riwayat Aktivitas</label>
    ${logs.length === 0 ? '<p class="text-xs text-inksoft">Belum ada aktivitas.</p>' : `
      <div class="space-y-2 max-h-40 overflow-y-auto pr-1">
        ${logs.map(l => `
          <div class="flex items-start gap-2 text-xs">
            <span class="inline-block h-1.5 w-1.5 rounded-full bg-fern mt-1.5 shrink-0"></span>
            <div class="flex-1 min-w-0">
              <p class="text-inksoft"><span class="font-medium text-ink">${escapeHtml(l.actorEmail)}</span> · ${actionLabel[l.action] || l.action}</p>
              <p class="text-[10px] text-inksoft">${formatDateTime(l.createdAt)}</p>
            </div>
          </div>`).join('')}
      </div>
    `}
  `;
  refreshIcons();
}

function closeTaskDrawer() {
  $('#task-drawer').classList.add('hidden');
  State.taskDrawer.taskId = null;
  // Kalau drawer dibuka dari canvas, segarkan kartu & panel node supaya
  // progress/status terbaru (dan rata-rata node) langsung terlihat.
  if (State.view && State.view.kind === 'canvas' && State.selectedNode) {
    refreshSelectedNodeFromServer().catch(() => {});
  }
}

// Esc menutup drawer task. Dilewati kalau fokus ada di input (supaya draft
// tidak hilang) atau kalau modal lain sudah menangani Esc lebih dulu
// (mis. command palette memanggil preventDefault).
function bindDrawerEscape() {
  if (State.taskDrawer.escBound) return;
  State.taskDrawer.escBound = true;
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const drawer = $('#task-drawer');
    if (!drawer || drawer.classList.contains('hidden')) return;
    const active = document.activeElement;
    if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return;
    closeTaskDrawer();
  });
}

/* Modal pilih aplikasi. Dipakai dua tempat:
   - task drawer: langsung menautkan ke task yang sudah ada
   - form buat task: hasilnya dikumpulkan dulu, disimpan saat task dibuat
   Mendukung dua cara: pilih dari Application Hub, atau tautkan link baru. */
function showAppPickerDialog(options = {}) {
  return new Promise((resolve) => {
    Promise.all([callServer('listApplications'), callServer('listApplicationCategories')]).then(([res, catRes]) => {
      if (!res.success) { resolve(null); return; }
      const exclude = {};
      (options.excludeAppIds || []).forEach((id) => { exclude[String(id)] = true; });
      const excludeUrls = {};
      (options.excludeUrls || []).forEach((url) => {
        const key = String(url || '').trim().toLowerCase();
        if (key) excludeUrls[key] = true;
      });
      const allApps = res.data || [];
      const apps = allApps.filter((a) => !exclude[String(a.id)]);
      const categories = (catRes.success && catRes.data && catRes.data.length)
        ? catRes.data.map((c) => c.name)
        : (typeof APP_CATEGORIES !== 'undefined' ? APP_CATEGORIES.slice() : ['Other']);
      const hasApps = apps.length > 0;
      let mode = hasApps ? 'existing' : 'new';
      const html = `
        <div class="fixed inset-0 z-[60] bg-ink/40 flex items-center justify-center p-4" id="app-picker-backdrop">
          <div class="bg-card rounded-xl shadow-soft max-w-md w-full max-h-[90vh] overflow-y-auto" id="app-picker-card" onclick="event.stopPropagation()">
            <div class="px-5 py-4 border-b border-line flex items-center justify-between">
              <h3 class="text-base font-semibold">Tautkan Aplikasi</h3>
              <button class="btn btn-ghost btn-sm" id="app-picker-close"><i data-lucide="x" class="h-4 w-4"></i></button>
            </div>
            <div class="p-5 space-y-4">
              <div class="flex gap-1 p-1 bg-paper border border-line rounded-md">
                <button type="button" id="app-picker-tab-existing" class="flex-1 px-2 py-1.5 text-xs rounded">Dari Application Hub</button>
                <button type="button" id="app-picker-tab-new" class="flex-1 px-2 py-1.5 text-xs rounded">Link baru</button>
              </div>

              <div id="app-picker-pane-existing" class="space-y-4">
                ${hasApps ? `
                  <div>
                    <label class="form-label">Pilih Aplikasi</label>
                    <select id="app-picker-select" class="form-select">${apps.map(a => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)} (${escapeHtml(a.category || '')})</option>`).join('')}</select>
                  </div>
                  <div>
                    <label class="form-label">Custom URL (opsional)</label>
                    <input type="text" id="app-picker-url" class="form-input" placeholder="https://khusus-untuk-task-ini...">
                  </div>
                  <div>
                    <label class="form-label">Label Link (opsional)</label>
                    <input type="text" id="app-picker-label" class="form-input" placeholder="Contoh: Channel Onboarding">
                  </div>
                ` : `
                  <p class="text-xs text-inksoft">Semua aplikasi dari Application Hub sudah ditambahkan. Gunakan tab <span class="font-medium text-ink">Link baru</span> untuk menautkan link lain.</p>
                `}
              </div>

              <div id="app-picker-pane-new" class="space-y-4 hidden">
                <div>
                  <label class="form-label">Nama Aplikasi</label>
                  <input type="text" id="app-picker-new-name" class="form-input" placeholder="Contoh: Notion">
                </div>
                <div>
                  <label class="form-label">URL Aplikasi</label>
                  <input type="text" id="app-picker-new-url" class="form-input" placeholder="https://...">
                </div>
                <div>
                  <label class="form-label">Kategori</label>
                  <select id="app-picker-new-category" class="form-select">${categories.map(c => `<option value="${escapeHtml(c)}" ${c === 'Other' ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}</select>
                </div>
                <p class="text-[10px] text-inksoft">Link baru otomatis ditambahkan ke Application Hub supaya bisa dipakai lagi di task lain.</p>
              </div>
            </div>
            <div class="px-5 py-3 border-t border-line flex justify-end gap-2">
              <button class="btn btn-secondary" id="app-picker-cancel">Batal</button>
              <button class="btn btn-primary" id="app-picker-save">Tautkan</button>
            </div>
          </div>
        </div>`;
      const wrap = document.createElement('div');
      wrap.innerHTML = html;
      document.body.appendChild(wrap.firstElementChild);
      refreshIcons();

      const tabExisting = document.getElementById('app-picker-tab-existing');
      const tabNew = document.getElementById('app-picker-tab-new');
      const paneExisting = document.getElementById('app-picker-pane-existing');
      const paneNew = document.getElementById('app-picker-pane-new');
      const saveBtn = document.getElementById('app-picker-save');
      const activeTabCls = 'flex-1 px-2 py-1.5 text-xs font-semibold rounded bg-card text-ferndeep shadow-soft';
      const idleTabCls = 'flex-1 px-2 py-1.5 text-xs rounded text-inksoft hover:text-ink';

      const setMode = (next) => {
        mode = next;
        tabExisting.className = next === 'existing' ? activeTabCls : idleTabCls;
        tabNew.className = next === 'new' ? activeTabCls : idleTabCls;
        paneExisting.classList.toggle('hidden', next !== 'existing');
        paneNew.classList.toggle('hidden', next !== 'new');
        saveBtn.disabled = next === 'existing' && !hasApps;
        saveBtn.textContent = next === 'existing' ? 'Tautkan' : 'Tambah & Tautkan';
        if (next === 'new') {
          const nameInput = document.getElementById('app-picker-new-name');
          if (nameInput) nameInput.focus();
        }
      };
      setMode(mode);
      tabExisting.addEventListener('click', () => setMode('existing'));
      tabNew.addEventListener('click', () => setMode('new'));

      let settled = false;
      const close = (value) => {
        if (settled) return;
        settled = true;
        const bd = document.getElementById('app-picker-backdrop');
        if (bd) bd.remove();
        resolve(value);
      };
      document.getElementById('app-picker-close').addEventListener('click', () => close(null));
      document.getElementById('app-picker-cancel').addEventListener('click', () => close(null));
      document.getElementById('app-picker-backdrop').addEventListener('click', (e) => {
        if (e.target.id === 'app-picker-backdrop') close(null);
      });

      saveBtn.addEventListener('click', () => {
        if (mode === 'existing') {
          const appId = document.getElementById('app-picker-select').value;
          const app = apps.find((a) => String(a.id) === String(appId));
          if (!app) { toast('Pilih aplikasi terlebih dahulu', 'error'); return; }
          close({
            appId: app.id,
            name: app.name,
            customUrl: (document.getElementById('app-picker-url').value || '').trim(),
            linkLabel: (document.getElementById('app-picker-label').value || '').trim(),
          });
          return;
        }

        // Mode "Link baru"
        const name = (document.getElementById('app-picker-new-name').value || '').trim();
        const url = (document.getElementById('app-picker-new-url').value || '').trim();
        const category = document.getElementById('app-picker-new-category').value || 'Other';
        if (!name) { toast('Nama aplikasi wajib diisi', 'error'); return; }
        if (!/^https?:\/\/.+/i.test(url)) { toast('URL harus diawali http:// atau https://', 'error'); return; }
        // Kalau URL-nya sudah dipakai link lain di daftar ini, tolak.
        const urlKey = url.toLowerCase();
        if (excludeUrls[urlKey]) { toast('Link ini sudah ditambahkan', 'info'); return; }
        // Kalau URL-nya sudah ada di Application Hub, pakai entri yang ada.
        const sameUrl = allApps.find((a) => String(a.url || '').trim().toLowerCase() === urlKey);
        if (sameUrl) {
          if (exclude[String(sameUrl.id)]) { toast('Aplikasi ini sudah ditambahkan', 'info'); return; }
          close({ appId: sameUrl.id, name: sameUrl.name, customUrl: '', linkLabel: '' });
          return;
        }
        close({ newApp: { name, url, category }, name, linkLabel: '' });
      });
    });
  });
}

function showLinkAppDialog(taskId) {
  // Sembunyikan aplikasi yang sudah tertaut supaya tidak memilih duplikat.
  callServer('getTask', taskId).then((taskRes) => {
    const drawerApps = taskRes.success ? (taskRes.data.applications || []) : [];
    showAppPickerDialog({
      excludeAppIds: drawerApps.map((a) => a.id),
      excludeUrls: drawerApps.map((a) => a.url),
    }).then((pick) => {
      if (!pick) return;
      const request = pick.newApp
        ? callServer('linkNewApplicationToTask', {
            taskId,
            name: pick.newApp.name,
            url: pick.newApp.url,
            category: pick.newApp.category,
            linkLabel: pick.linkLabel || '',
          })
        : callServer('linkApplicationToTask', {
            taskId,
            appId: pick.appId,
            customUrl: pick.customUrl || null,
            linkLabel: pick.linkLabel || null,
          });
      request.then((res) => {
        if (res.success) { toast('Aplikasi ditautkan'); openTaskDrawer(taskId); }
        else toast(res.message || 'Gagal', 'error');
      });
    });
  });
}


function getBezierPoint(x1,y1,x2,y2,x3,y3,x4,y4,t) {
  const mt = 1-t;
  const x = mt*mt*mt*x1 + 3*mt*mt*t*x2 + 3*mt*t*t*x3 + t*t*t*x4;
  const y = mt*mt*mt*y1 + 3*mt*mt*t*y2 + 3*mt*t*t*y3 + t*t*t*y4;
  return {x,y};
}

function refreshEdgeLabels() {
  if (!State.editor || !State.editor.container) return;
  const conns = State.editor.container.querySelectorAll('.connection');
  conns.forEach(conn => {
    const path = conn.querySelector('.main-path');
    if (!path) return;
    let group = conn.querySelector('.edge-label-group');
    const label = conn.dataset.label || '';
    if (!label) {
      if (group) group.remove();
      return;
    }
    if (!group) {
      group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.classList.add('edge-label-group');
      group.style.pointerEvents = 'all';
      group.style.cursor = 'pointer';

      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.classList.add('edge-label-bg');
      rect.setAttribute('rx', '4');
      rect.setAttribute('ry', '4');
      rect.setAttribute('fill', '#F6F4EE');
      rect.setAttribute('stroke', '#E5E1D4');
      rect.setAttribute('stroke-width', '1');

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.classList.add('edge-label');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'middle');
      text.setAttribute('font-size', '10');
      text.setAttribute('font-family', 'IBM Plex Mono, monospace');
      text.setAttribute('fill', '#5C665D');
      text.setAttribute('letter-spacing', '0.08em');

      group.appendChild(rect);
      group.appendChild(text);
      conn.appendChild(group);

      group.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        e.preventDefault();
        showEdgeLabelModal(conn);
      });
    }

    const text = group.querySelector('.edge-label');
    const rect = group.querySelector('.edge-label-bg');
    text.textContent = label.toUpperCase();

    try {
      const d = path.getAttribute('d') || '';
      const m = d.match(/M\s*([-\d.]+)\s*([-\d.]+)[^\d-]*C\s*([-\d.]+)\s*([-\d.]+)\s*([-\d.]+)\s*([-\d.]+)\s*([-\d.]+)\s*([-\d.]+)/);
      if (m) {
        const p = getBezierPoint(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), parseFloat(m[4]), parseFloat(m[5]), parseFloat(m[6]), parseFloat(m[7]), parseFloat(m[8]), 0.5);
        text.setAttribute('x', p.x);
        text.setAttribute('y', p.y);
        let bbox = { width: label.length * 6, height: 10 };
        try {
          if (typeof text.getBBox === 'function') {
            bbox = text.getBBox();
          }
        } catch (e) {}
        const padX = 6;
        const padY = 3;
        rect.setAttribute('x', p.x - bbox.width / 2 - padX);
        rect.setAttribute('y', p.y - bbox.height / 2 - padY);
        rect.setAttribute('width', bbox.width + padX * 2);
        rect.setAttribute('height', bbox.height + padY * 2);
      }
    } catch (e) {}
  });

  requestAnimationFrame(() => {
    if (!State.editor || !State.editor.container) return;
    const conns2 = State.editor.container.querySelectorAll('.connection');
    conns2.forEach(conn => {
      const path = conn.querySelector('.main-path');
      const group = conn.querySelector('.edge-label-group');
      if (!path || !group) return;
      const label = conn.dataset.label || '';
      if (!label) return;
      const text = group.querySelector('.edge-label');
      const rect = group.querySelector('.edge-label-bg');
      try {
        const d = path.getAttribute('d') || '';
        const m = d.match(/M\s*([-\d.]+)\s*([-\d.]+)[^\d-]*C\s*([-\d.]+)\s*([-\d.]+)\s*([-\d.]+)\s*([-\d.]+)\s*([-\d.]+)\s*([-\d.]+)/);
        if (m && text && rect) {
          const p = getBezierPoint(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), parseFloat(m[4]), parseFloat(m[5]), parseFloat(m[6]), parseFloat(m[7]), parseFloat(m[8]), 0.5);
          text.setAttribute('x', p.x);
          text.setAttribute('y', p.y);
          let bbox = { width: label.length * 6, height: 10 };
          try {
            if (typeof text.getBBox === 'function') bbox = text.getBBox();
          } catch (e) {}
          const padX = 6;
          const padY = 3;
          rect.setAttribute('x', p.x - bbox.width / 2 - padX);
          rect.setAttribute('y', p.y - bbox.height / 2 - padY);
          rect.setAttribute('width', bbox.width + padX * 2);
          rect.setAttribute('height', bbox.height + padY * 2);
        }
      } catch (e) {}
    });
  });
}

function editEdgeLabel(conn) {
  showEdgeLabelModal(conn);
}

function showEdgeLabelModal(conn) {
  const current = conn.dataset.label || '';
  const html = `
    <div class="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4" id="edge-label-backdrop">
      <div class="bg-card rounded-xl shadow-soft max-w-sm w-full" onclick="event.stopPropagation()">
        <div class="px-5 py-4 border-b border-line flex items-center justify-between">
          <h3 class="text-base font-semibold">Label Garis</h3>
          <button class="btn btn-ghost btn-sm" id="edge-label-close"><i data-lucide="x" class="h-4 w-4"></i></button>
        </div>
        <div class="p-5 space-y-3">
          <div>
            <label class="form-label">Teks Label</label>
            <input type="text" id="edge-label-input" class="form-input" value="${escapeHtml(current)}" placeholder="Contoh: Yes / No">
            <p class="text-[10px] text-inksoft mt-1">Ditampilkan di tengah garis dengan bentuk pill.</p>
          </div>
        </div>
        <div class="px-5 py-3 border-t border-line flex justify-between gap-2">
          <button class="btn btn-ghost btn-sm text-berry ${current ? '' : 'hidden'}" id="edge-label-remove"><i data-lucide="trash-2" class="h-3.5 w-3.5"></i>Hapus label</button>
          <div class="flex gap-2 ml-auto">
            <button class="btn btn-secondary btn-sm" id="edge-label-cancel">Batal</button>
            <button class="btn btn-primary btn-sm" id="edge-label-save">Simpan</button>
          </div>
        </div>
      </div>
    </div>`;
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  document.body.appendChild(wrap.firstElementChild);
  refreshIcons();
  const input = document.getElementById('edge-label-input');
  if (input) {
    input.focus();
    input.select();
  }
  const close = () => {
    const bd = document.getElementById('edge-label-backdrop');
    if (bd) bd.remove();
  };
  document.getElementById('edge-label-close').addEventListener('click', close);
  document.getElementById('edge-label-cancel').addEventListener('click', close);
  document.getElementById('edge-label-backdrop').addEventListener('click', close);
  const removeBtn = document.getElementById('edge-label-remove');
  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      delete conn.dataset.label;
      close();
      refreshEdgeLabels();
      setCanvasDirty();
    });
  }
  document.getElementById('edge-label-save').addEventListener('click', () => {
    const clean = (input.value || '').trim();
    if (clean) {
      conn.dataset.label = clean;
    } else {
      delete conn.dataset.label;
    }
    close();
    refreshEdgeLabels();
    setCanvasDirty();
  });
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); document.getElementById('edge-label-save').click(); }
      if (e.key === 'Escape') close();
    });
  }
}

function showEdgeContextMenu(e, conn) {
  const existing = document.getElementById('edge-context-menu');
  if (existing) existing.remove();

  // Drawflow menambahkan tombol "x" tepat di posisi kursor saat garis
  // diklik-kanan. Karena menu ini sudah punya aksi hapus, tombol bawaan
  // itu dibuang supaya tidak bertumpuk dengan tombol label.
  if (State.editor && State.editor.precanvas) {
    Array.from(State.editor.precanvas.children).forEach((el) => {
      if (el.classList && el.classList.contains('drawflow-delete')) el.remove();
    });
  }

  const hasLabel = !!conn.dataset.label;
  const html = `
    <div class="fixed inset-0 z-40" id="edge-context-menu">
      <div class="absolute inset-0" id="edge-context-bg"></div>
      <div class="absolute bg-card border border-line rounded-md shadow-soft py-1 w-48" id="edge-context-box" style="left:${e.clientX}px;top:${e.clientY}px">
        <p class="px-3 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-inksoft">Koneksi</p>
        <button class="w-full text-left px-3 py-2 text-sm hover:bg-paper flex items-center gap-2" id="edge-ctx-label"><i data-lucide="type" class="h-3.5 w-3.5"></i>${hasLabel ? 'Ubah label' : 'Tambahkan Label'}</button>
        ${hasLabel ? '<button class="w-full text-left px-3 py-2 text-sm hover:bg-paper flex items-center gap-2" id="edge-ctx-remove"><i data-lucide="eraser" class="h-3.5 w-3.5"></i>Hapus label</button>' : ''}
        <div class="my-1 border-t border-line"></div>
        <button class="w-full text-left px-3 py-2 text-sm hover:bg-paper flex items-center gap-2 text-berry" id="edge-ctx-delete"><i data-lucide="unlink" class="h-3.5 w-3.5"></i>Hapus koneksi</button>
      </div>
    </div>`;
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  document.body.appendChild(wrap.firstElementChild);
  refreshIcons();

  // Jaga menu tetap di dalam layar saat diklik di tepi kanan/bawah.
  const box = document.getElementById('edge-context-box');
  const pad = 8;
  const boxRect = box.getBoundingClientRect();
  let left = e.clientX;
  let top = e.clientY;
  if (left + boxRect.width + pad > window.innerWidth) left = Math.max(pad, window.innerWidth - boxRect.width - pad);
  if (top + boxRect.height + pad > window.innerHeight) top = Math.max(pad, window.innerHeight - boxRect.height - pad);
  box.style.left = left + 'px';
  box.style.top = top + 'px';

  const close = () => {
    const menu = document.getElementById('edge-context-menu');
    if (menu) menu.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (ev) => {
    if (ev.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);

  document.getElementById('edge-context-bg').addEventListener('click', close);
  document.getElementById('edge-ctx-label').addEventListener('click', () => {
    close();
    showEdgeLabelModal(conn);
  });
  const remove = document.getElementById('edge-ctx-remove');
  if (remove) {
    remove.addEventListener('click', () => {
      close();
      delete conn.dataset.label;
      refreshEdgeLabels();
      setCanvasDirty();
    });
  }
  document.getElementById('edge-ctx-delete').addEventListener('click', () => {
    const path = conn.querySelector('.main-path');
    close();
    if (!path || !State.editor) return;
    // if (!confirm('Hapus koneksi ini?')) return;
    // Set selection supaya removeConnection() bawaan Drawflow tahu
    // garis mana yang harus dihapus dari data & DOM.
    State.editor.connection_selected = path;
    path.classList.add('selected');
    State.editor.removeConnection();
  });
}

function mapDrawioShape(styleStr, label) {
  const s = (styleStr || '').toLowerCase();
  const l = (label || '').toLowerCase();
  if (s.includes('ellipse') || s.includes('start') || s.includes('end') || l.match(/\b(start|mulai|begin|end|selesai|finish)\b/)) return 'start_end';
  if (s.includes('rhombus') || s.includes('diamond') || l.match(/\b(decision|keputusan|if|yes\/no|iya\/tidak)\b/)) return 'decision';
  if (s.includes('cylinder') || s.includes('database') || l.match(/\b(database|db|data)\b/)) return 'application';
  if (s.includes('note') || s.includes('sticky') || s.includes('text') || l.match(/\b(catatan|note|keterangan)\b/)) return 'note';
  if (l.match(/\b(task|tugas|todo|aktivitas)\b/)) return 'task';
  if (s.includes('parallelogram') || l.match(/\b(input|output|form)\b/)) return 'application';
  return 'process';
}

function decodeDrawioContent(xmlText) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');
    const diagram = doc.querySelector('diagram');
    if (!diagram) return xmlText;
    let content = diagram.textContent || '';
    try {
      content = content.replace(/\s/g, '');
      const decoded = atob(content);
      if (decoded.includes('<mxGraphModel') || decoded.includes('<?xml') || decoded.includes('<root')) return decoded;
    } catch (e) {}
    if (content.includes('<mxGraphModel')) {
      try { return decodeURIComponent(escape(content)); } catch(e) { return content; }
    }
    return xmlText;
  } catch (e) {
    return xmlText;
  }
}

async function importDrawioDiagram(xmlText) {
  if (!State.editor) throw new Error('Canvas belum siap');
  const decoded = decodeDrawioContent(xmlText);
  const parser = new DOMParser();
  const doc = parser.parseFromString(decoded, 'text/xml');
  const cells = Array.from(doc.querySelectorAll('mxCell'));
  if (cells.length === 0) throw new Error('Tidak ada diagram yang bisa diimpor di file ini');

  const vertices = [];
  const edges = [];
  cells.forEach(cell => {
    const id = cell.getAttribute('id');
    if (!id || id === '0' || id === '1') return;
    const value = cell.getAttribute('value') || '';
    const style = cell.getAttribute('style') || '';
    const vertex = cell.getAttribute('vertex');
    const edge = cell.getAttribute('edge');
    if (vertex === '1') {
      const geo = cell.querySelector('mxGeometry');
      const x = geo ? parseFloat(geo.getAttribute('x') || '0') : 0;
      const y = geo ? parseFloat(geo.getAttribute('y') || '0') : 0;
      const label = value.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').trim();
      vertices.push({ id, label, style, x, y });
    } else if (edge === '1') {
      const source = cell.getAttribute('source');
      const target = cell.getAttribute('target');
      if (source && target) edges.push({ id, source, target });
    }
  });

  if (vertices.length === 0) throw new Error('Tidak ditemukan node (vertex) di diagram ini');

  const idMap = {};
  vertices.forEach(v => {
    const nodeType = mapDrawioShape(v.style, v.label);
    const titles = { start_end: 'Mulai/Selesai', process: 'Proses', task: 'Task', decision: 'Keputusan', application: 'Aplikasi', note: 'Catatan' };
    const n = {
      id: Store.generateId('node'),
      nodeType,
      title: v.label || titles[nodeType] || 'Node',
      description: '',
      positionX: Math.max(20, v.x + 40),
      positionY: Math.max(20, v.y + 40),
      task: null,
    };
    idMap[v.id] = addNodeToCanvas(n);
  });

  edges.forEach(e => {
    const fromId = idMap[e.source];
    const toId = idMap[e.target];
    if (fromId != null && toId != null) {
      try { State.editor.addConnection(fromId, toId, 'output_1', 'input_1'); } catch (err) {}
    }
  });

  setCanvasDirty();

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!State.editor || !State.editor.drawflow) return;
      const data = State.editor.drawflow.drawflow.Home.data;
      Object.keys(data).forEach(id => {
        try { State.editor.updateConnectionNodes('node-' + id); } catch (e) {}
      });
    });
  });

  toast(vertices.length + ' node dan ' + edges.length + ' koneksi diimpor dari draw.io', 'success');
}

/* ============================================================
 * Komentar (task / node / workflow)
 * ============================================================ */

function commentAuthorName(comment) {
  const email = String(comment.authorEmail || '').toLowerCase();
  const members = (State.init && State.init.members) || [];
  const member = members.find((m) => String(m.email || '').toLowerCase() === email);
  return (member && member.displayName) || comment.authorName || comment.authorEmail || 'Anggota';
}

function commentInitial(name) {
  const text = String(name || '?').trim();
  return (text.charAt(0) || '?').toUpperCase();
}

/* Thread komentar datar yang dipakai di drawer task, panel node, dan
 * dialog workflow. Semua anggota aktif (termasuk viewer) boleh menulis;
 * edit/hapus hanya untuk penulis atau admin. */
function mountCommentThread(container, entityType, entityId) {
  if (!container || !entityType || !entityId) return;

  let rows = [];
  let draft = '';
  let editingId = null;
  let editDraft = '';
  let loading = true;
  let errorMsg = '';
  let busy = false;
  let reloadTimer = null;

  function rowHtml(c) {
    const author = commentAuthorName(c);
    const editing = editingId === c.id;
    return `
      <div class="group flex items-start gap-2" data-comment-row="${escapeHtml(c.id)}">
        <div class="h-7 w-7 rounded-full bg-sage/20 text-ferndeep flex items-center justify-center text-[11px] font-semibold shrink-0">${escapeHtml(commentInitial(author))}</div>
        <div class="flex-1 min-w-0 rounded-lg border border-line bg-paper/50 px-3 py-2">
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="text-xs font-medium truncate max-w-[60%]">${escapeHtml(author)}</span>
            <span class="text-[10px] text-inksoft" title="${escapeHtml(formatDateTime(c.createdAt))}">${escapeHtml(formatDateTime(c.createdAt))}</span>
            ${c.isEdited ? '<span class="text-[10px] italic text-inksoft">diedit</span>' : ''}
            ${(c.canEdit || c.canDelete) ? `
              <span class="ml-auto flex items-center gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                ${c.canEdit ? `<button type="button" data-comment-edit="${escapeHtml(c.id)}" class="btn btn-ghost btn-sm h-6 w-6 p-0" title="Edit komentar" aria-label="Edit komentar"><i data-lucide="pencil" class="h-3 w-3"></i></button>` : ''}
                ${c.canDelete ? `<button type="button" data-comment-delete="${escapeHtml(c.id)}" class="btn btn-ghost btn-sm h-6 w-6 p-0 text-berry hover:bg-berry/10" title="Hapus komentar" aria-label="Hapus komentar"><i data-lucide="trash-2" class="h-3 w-3"></i></button>` : ''}
              </span>
            ` : ''}
          </div>
          ${editing ? `
            <div class="mt-1.5 space-y-1.5">
              <textarea data-comment-edit-input rows="3" maxlength="2000" class="form-textarea text-xs">${escapeHtml(editDraft)}</textarea>
              <div class="flex justify-end gap-1">
                <button type="button" data-comment-cancel-edit class="btn btn-secondary btn-sm">Batal</button>
                <button type="button" data-comment-save-edit="${escapeHtml(c.id)}" class="btn btn-primary btn-sm">Simpan</button>
              </div>
            </div>
          ` : `
            <p class="text-xs text-ink whitespace-pre-wrap break-words mt-1">${escapeHtml(c.body)}</p>
          `}
        </div>
      </div>
    `;
  }

  function render() {
    container.innerHTML = `
      <div class="flex items-center justify-between gap-2 mb-2">
        <label class="form-label flex items-center gap-1 mb-0">
          <i data-lucide="message-square" class="h-3 w-3"></i>Komentar
          <span class="text-[10px] font-normal text-inksoft" data-comment-count>${rows.length}</span>
        </label>
        ${loading ? '<span class="text-[10px] text-inksoft flex items-center gap-1"><span class="spinner spinner-dark"></span>Memuat</span>' : ''}
      </div>
      ${errorMsg ? `<p class="text-xs text-berry mb-2">${escapeHtml(errorMsg)}</p>` : ''}
      <div class="${rows.length > 0 ? 'space-y-3 max-h-80 overflow-y-auto pr-1' : 'space-y-3'}" data-comment-list>
        ${rows.length === 0 && !loading ? '<p class="text-xs text-inksoft">Belum ada komentar. Mulai diskusi di sini.</p>' : rows.map(rowHtml).join('')}
      </div>
      <div class="mt-3 flex items-end gap-2">
        <textarea rows="2" maxlength="2000" data-comment-input class="form-textarea text-xs flex-1" placeholder="Tulis komentar..."></textarea>
        <button type="button" data-comment-send class="btn btn-primary btn-sm shrink-0"><i data-lucide="send" class="h-3.5 w-3.5"></i>Kirim</button>
      </div>
      <p class="text-[10px] text-inksoft mt-1">Ctrl+Enter untuk kirim · maksimal 2000 karakter</p>
    `;
    refreshIcons();

    const input = container.querySelector('[data-comment-input]');
    if (input) {
      input.value = draft;
      input.addEventListener('input', () => { draft = input.value; });
      input.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); submit(); }
      });
    }
    if (editingId) {
      const editInput = container.querySelector('[data-comment-edit-input]');
      if (editInput) {
        editInput.value = editDraft;
        editInput.addEventListener('input', () => { editDraft = editInput.value; });
        editInput.addEventListener('keydown', (e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); saveEdit(editingId); }
        });
        editInput.focus();
        editInput.setSelectionRange(editInput.value.length, editInput.value.length);
      }
    }
  }

  async function reload() {
    const res = await callServer('listComments', { entityType, entityId });
    loading = false;
    if (!res || !res.success) {
      errorMsg = (res && res.message) || 'Gagal memuat komentar';
    } else {
      errorMsg = '';
      rows = res.data || [];
      if (editingId && !rows.some((c) => c.id === editingId)) { editingId = null; editDraft = ''; }
    }
    render();
  }

  async function submit() {
    if (busy) return;
    const body = String(draft || '').trim();
    if (!body) { toast('Komentar tidak boleh kosong', 'error'); return; }
    busy = true;
    const res = await callServer('createComment', { entityType, entityId, body });
    busy = false;
    if (!res || !res.success) { toast((res && res.message) || 'Gagal mengirim komentar', 'error'); return; }
    draft = '';
    await reload();
  }

  async function saveEdit(id) {
    if (busy) return;
    const body = String(editDraft || '').trim();
    if (!body) { toast('Komentar tidak boleh kosong', 'error'); return; }
    busy = true;
    const res = await callServer('updateComment', { id, body });
    busy = false;
    if (!res || !res.success) { toast((res && res.message) || 'Gagal mengubah komentar', 'error'); return; }
    editingId = null;
    editDraft = '';
    await reload();
    toast('Komentar diperbarui');
  }

  container.addEventListener('click', async (e) => {
    const sendBtn = e.target.closest('[data-comment-send]');
    if (sendBtn) { await submit(); return; }

    const editBtn = e.target.closest('[data-comment-edit]');
    if (editBtn) {
      editingId = editBtn.dataset.commentEdit;
      const row = rows.find((c) => c.id === editingId);
      editDraft = row ? row.body : '';
      render();
      return;
    }

    const cancelBtn = e.target.closest('[data-comment-cancel-edit]');
    if (cancelBtn) {
      editingId = null;
      editDraft = '';
      render();
      return;
    }

    const saveBtn = e.target.closest('[data-comment-save-edit]');
    if (saveBtn) { await saveEdit(saveBtn.dataset.commentSaveEdit); return; }

    const delBtn = e.target.closest('[data-comment-delete]');
    if (delBtn) {
      const row = rows.find((c) => c.id === delBtn.dataset.commentDelete);
      const ok = await showConfirmDialog({
        title: 'Hapus komentar?',
        message: 'Komentar akan dihapus dari diskusi. Tindakan ini tidak bisa dibatalkan.',
        confirmText: 'Hapus Komentar',
        cancelText: 'Batal',
        danger: true,
      });
      if (!ok) return;
      const res = await callServer('deleteComment', delBtn.dataset.commentDelete);
      if (!res || !res.success) { toast((res && res.message) || 'Gagal menghapus komentar', 'error'); return; }
      if (row) toast('Komentar dihapus');
      await reload();
    }
  });

  // Komentar disinkronkan lewat Store; segarkan thread saat ada perubahan.
  const onStoreChange = (e) => {
    if (!document.body.contains(container)) {
      window.removeEventListener('fs:change', onStoreChange);
      return;
    }
    if (!e.detail || e.detail.collection !== 'comments') return;
    if (editingId) return;
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(reload, 150);
  };
  window.addEventListener('fs:change', onStoreChange);

  render();
  reload();
}

function showCommentsDialog(options = {}) {
  const entityType = options.entityType;
  const entityId = options.entityId;
  if (!entityType || !entityId) return;
  const previouslyFocused = document.activeElement;
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-[70] bg-ink/40 flex items-center justify-center p-4';
  modal.innerHTML = `
    <div class="bg-card rounded-xl shadow-soft w-full max-w-lg max-h-[85vh] flex flex-col" role="dialog" aria-modal="true" aria-labelledby="comments-dialog-title">
      <div class="px-5 py-4 border-b border-line flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 id="comments-dialog-title" class="font-display text-base font-semibold truncate">${escapeHtml(options.title || 'Diskusi')}</h3>
          ${options.subtitle ? `<p class="text-xs text-inksoft mt-0.5 truncate">${escapeHtml(options.subtitle)}</p>` : ''}
        </div>
        <button type="button" data-comments-close class="btn btn-ghost btn-sm h-7 w-7 p-0" aria-label="Tutup diskusi"><i data-lucide="x" class="h-4 w-4"></i></button>
      </div>
      <div class="p-4 overflow-y-auto" id="comments-dialog-body"></div>
    </div>
  `;
  document.body.appendChild(modal);
  refreshIcons();
  mountCommentThread(modal.querySelector('#comments-dialog-body'), entityType, entityId);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    modal.remove();
    if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus({ preventScroll: true });
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    const focusables = Array.from(modal.querySelectorAll('button, textarea, input, select, a[href]')).filter((el) => !el.disabled);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', onKey, true);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  modal.querySelector('[data-comments-close]').addEventListener('click', close);
  const closeBtn = modal.querySelector('[data-comments-close]');
  if (closeBtn) closeBtn.focus({ preventScroll: true });
}

/* ============================================================
 * Chat tim
 * ============================================================ */

let _chatEditId = null;
let _chatEditDraft = '';
let _chatTeardown = null;

function chatTimeLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/* ------------------------------------------------------------
 * Lampiran chat: referensi task/workflow
 * Disimpan sebagai snapshot {type, id, title, meta}; data live dipakai
 * untuk cek ketersediaan saat render. Kalau task/workflow sudah tidak
 * ada, kartu tetap tampil dengan label "Tidak tersedia".
 * ---------------------------------------------------------- */

function chatAttachmentInfo(a) {
  const type = a && a.type === 'workflow' ? 'workflow' : 'task';
  const id = a && a.id ? String(a.id) : '';
  const fallbackTitle = (a && a.title) || (type === 'workflow' ? 'Workflow' : 'Task');
  if (!id) return { type, id: '', available: false, title: fallbackTitle, meta: 'Tidak tersedia' };

  if (type === 'task') {
    const t = window.Store ? Store.findById('tasks', 'task_id', id) : null;
    if (!t) return { type, id, available: false, title: fallbackTitle, meta: 'Tidak tersedia' };
    const meta = [STATUS_LABEL[t.status] || t.status || '', PRIORITY_LABEL[t.priority] || '']
      .filter(Boolean).join(' · ');
    return { type, id, available: true, title: t.title || fallbackTitle, meta: meta || 'Task' };
  }

  const w = window.Store ? Store.findById('workflows', 'workflow_id', id) : null;
  if (!w) return { type, id, available: false, title: fallbackTitle, meta: 'Tidak tersedia' };
  return {
    type, id, available: true,
    title: w.workflow_name || fallbackTitle,
    meta: w.status === 'archived' ? 'Workflow · Diarsipkan' : 'Workflow',
  };
}

function chatAttachmentCardHtml(a) {
  const info = chatAttachmentInfo(a);
  const icon = info.type === 'workflow' ? 'workflow' : 'square-check-big';
  const base = 'flex items-center gap-2 rounded-lg border px-2.5 py-2 mt-1.5 text-left w-full min-w-0 transition-colors';
  // Kartu selalu netral: berada di luar bubble, jadi tidak memakai warna
  // bubble hijau agar tetap terbaca di semua tema percakapan.
  const tone = info.available
    ? 'border-line bg-card text-ink hover:bg-paper'
    : 'border-line bg-paper/40 text-inksoft/80';
  const attrs = info.available
    ? (info.type === 'workflow'
      ? `type="button" data-chat-open-wf="${escapeHtml(info.id)}"`
      : `type="button" data-chat-open-task="${escapeHtml(info.id)}"`)
    : 'type="button" disabled aria-disabled="true"';
  return `
    <button ${attrs} class="${base} ${tone}" title="${escapeHtml(info.title)}">
      <span class="h-6 w-6 rounded-md ${info.available ? 'bg-fernlight/15 text-ferndeep' : 'bg-ink/5 text-inksoft/60'} flex items-center justify-center shrink-0">
        <i data-lucide="${icon}" class="h-3.5 w-3.5"></i>
      </span>
      <span class="min-w-0 flex-1">
        <span data-chat-card-title class="block text-[11px] font-medium truncate">${escapeHtml(info.title)}</span>
        <span class="block text-[10px] text-inksoft truncate">${escapeHtml(info.meta || '')}</span>
      </span>
      <i data-lucide="${info.available ? 'arrow-up-right' : 'ban'}" class="h-3 w-3 shrink-0 ${info.available ? 'text-inksoft' : 'text-inksoft/50'}"></i>
    </button>
  `;
}

/* Dialog pemilih lampiran. Resolve dengan array terpilih, atau null bila
 * dibatalkan. Semua anggota aktif boleh melampirkan task/workflow. */
function showChatAttachmentPicker(options = {}) {
  return new Promise((resolve) => {
    const max = 3;
    const previouslyFocused = document.activeElement;
    const wsId = (State.init && State.init.workspace && State.init.workspace.id) || '';
    const memberNames = {};
    ((State.init && State.init.members) || []).forEach((m) => {
      memberNames[String(m.email || '').toLowerCase()] = m.displayName || m.email;
    });

    const allTasks = Store.findBy('tasks', 'workspace_id', wsId)
      .slice()
      .sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'id'));
    const allWorkflows = Store.findBy('workflows', 'workspace_id', wsId)
      .slice()
      .sort((a, b) => String(a.workflow_name || '').localeCompare(String(b.workflow_name || ''), 'id'));
    const taskCountByWf = {};
    allTasks.forEach((t) => {
      const key = String(t.workflow_id || '');
      taskCountByWf[key] = (taskCountByWf[key] || 0) + 1;
    });

    let tab = 'task';
    let query = '';
    let picked = (options.selected || []).slice(0, max).map((a) => ({
      type: a.type, id: String(a.id), title: a.title || '', meta: a.meta || '',
    }));
    let closed = false;

    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 z-[75] bg-ink/40 flex items-center justify-center p-4';
    modal.innerHTML = `
      <div class="bg-card rounded-xl shadow-soft w-full max-w-lg max-h-[85vh] flex flex-col" role="dialog" aria-modal="true" aria-labelledby="attach-picker-title">
        <div class="px-5 py-4 border-b border-line flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h3 id="attach-picker-title" class="font-display text-base font-semibold">Lampirkan ke pesan</h3>
            <p class="text-xs text-inksoft mt-0.5">Pilih task atau workflow · maksimal ${max}</p>
          </div>
          <button type="button" data-picker-close class="btn btn-ghost btn-sm h-7 w-7 p-0" aria-label="Tutup"><i data-lucide="x" class="h-4 w-4"></i></button>
        </div>
        <div class="px-4 pt-3 space-y-2 shrink-0">
          <div class="relative">
            <i data-lucide="search" class="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-inksoft"></i>
            <input id="attach-search" type="text" class="form-input pl-9 h-9 text-sm w-full" placeholder="Cari judul atau PIC..." autocomplete="off">
          </div>
          <div class="inline-flex rounded-lg border border-line bg-paper p-0.5 w-full" role="tablist" aria-label="Jenis lampiran">
            <button type="button" data-picker-tab="task" class="flex-1 px-3 py-1.5 rounded-md text-xs font-medium" role="tab"></button>
            <button type="button" data-picker-tab="workflow" class="flex-1 px-3 py-1.5 rounded-md text-xs font-medium" role="tab"></button>
          </div>
        </div>
        <div id="attach-list" class="flex-1 overflow-y-auto px-4 py-3 space-y-1.5"></div>
        <div class="px-4 py-3 border-t border-line flex items-center justify-between gap-2 shrink-0">
          <p id="attach-count" class="text-[11px] text-inksoft"></p>
          <div class="flex gap-2">
            <button type="button" data-picker-close class="btn btn-secondary btn-sm">Batal</button>
            <button type="button" data-picker-apply class="btn btn-primary btn-sm">Tambahkan</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    refreshIcons();

    const listEl = modal.querySelector('#attach-list');
    const searchEl = modal.querySelector('#attach-search');
    const countEl = modal.querySelector('#attach-count');
    const applyBtn = modal.querySelector('[data-picker-apply]');
    const tabBtns = Array.from(modal.querySelectorAll('[data-picker-tab]'));

    function items() {
      const q = query.trim().toLowerCase();
      if (tab === 'task') {
        return allTasks.map((t) => {
          const status = STATUS_LABEL[t.status] || t.status || 'Tanpa status';
          const pic = t.assignee_email
            ? (memberNames[String(t.assignee_email).toLowerCase()] || t.assignee_email)
            : 'Tanpa PIC';
          return {
            type: 'task', id: String(t.task_id), title: t.title || '(Tanpa judul)',
            meta: `${status} · ${pic}`,
            hay: [t.title, t.description, t.assignee_email].join(' ').toLowerCase(),
          };
        }).filter((x) => !q || x.hay.includes(q));
      }
      return allWorkflows.map((w) => {
        const count = taskCountByWf[String(w.workflow_id)] || 0;
        const state = w.status === 'archived' ? 'Diarsipkan' : 'Workflow';
        return {
          type: 'workflow', id: String(w.workflow_id), title: w.workflow_name || '(Tanpa judul)',
          meta: `${state} · ${count} task`,
          hay: [w.workflow_name, w.description, w.departments_json].join(' ').toLowerCase(),
        };
      }).filter((x) => !q || x.hay.includes(q));
    }

    function render() {
      tabBtns.forEach((btn) => {
        const active = btn.dataset.pickerTab === tab;
        const total = btn.dataset.pickerTab === 'task' ? allTasks.length : allWorkflows.length;
        btn.textContent = `${btn.dataset.pickerTab === 'task' ? 'Task' : 'Workflow'} (${total})`;
        btn.className = `flex-1 px-3 py-1.5 rounded-md text-xs font-medium ${active ? 'bg-ink text-paper' : 'text-inksoft hover:text-ink'}`;
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
      });

      const rows = items();
      if (rows.length === 0) {
        const empty = query
          ? 'Tidak ada hasil untuk pencarian itu.'
          : (tab === 'task' ? 'Belum ada task di workspace ini.' : 'Belum ada workflow di workspace ini.');
        listEl.innerHTML = `<p class="text-xs text-inksoft text-center py-8">${escapeHtml(empty)}</p>`;
      } else {
        listEl.innerHTML = rows.map((item) => {
          const isPicked = picked.some((p) => p.type === item.type && p.id === item.id);
          return `
            <button type="button" data-pick-type="${item.type}" data-pick-id="${escapeHtml(item.id)}" aria-pressed="${isPicked}"
              class="w-full flex items-center gap-2.5 text-left px-3 py-2 rounded-lg border ${isPicked ? 'border-fern bg-fernlight/10' : 'border-line bg-paper/50 hover:bg-paper'} transition-colors">
              <i data-lucide="${item.type === 'workflow' ? 'workflow' : 'square-check-big'}" class="h-3.5 w-3.5 shrink-0 ${isPicked ? 'text-ferndeep' : 'text-inksoft'}"></i>
              <span class="min-w-0 flex-1">
                <span class="block text-xs font-medium truncate">${escapeHtml(item.title)}</span>
                <span class="block text-[10px] text-inksoft truncate">${escapeHtml(item.meta)}</span>
              </span>
              <i data-lucide="${isPicked ? 'check-circle-2' : 'circle'}" class="h-4 w-4 shrink-0 ${isPicked ? 'text-ferndeep' : 'text-inksoft/40'}"></i>
            </button>
          `;
        }).join('');
      }
      refreshIcons();
      countEl.textContent = `${picked.length}/${max} lampiran dipilih`;
      applyBtn.disabled = picked.length === 0;
      applyBtn.textContent = picked.length > 0 ? `Tambahkan (${picked.length})` : 'Tambahkan';
    }

    const close = (result) => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      modal.remove();
      if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus({ preventScroll: true });
      resolve(result);
    };

    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(null); return; }
      if (e.key !== 'Tab') return;
      const focusables = Array.from(modal.querySelectorAll('button:not([disabled]), input, a[href]'))
        .filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };

    tabBtns.forEach((btn) => btn.addEventListener('click', () => { tab = btn.dataset.pickerTab; render(); }));
    searchEl.addEventListener('input', () => { query = searchEl.value; render(); });
    listEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-pick-type]');
      if (!btn) return;
      const type = btn.dataset.pickType;
      const id = btn.dataset.pickId;
      const idx = picked.findIndex((p) => p.type === type && p.id === id);
      if (idx >= 0) { picked.splice(idx, 1); render(); return; }
      if (picked.length >= max) { toast(`Maksimal ${max} lampiran per pesan`, 'error'); return; }
      const item = items().find((x) => x.type === type && x.id === id);
      if (!item) return;
      picked.push({ type, id, title: item.title, meta: item.meta });
      render();
    });
    applyBtn.addEventListener('click', () => close(picked.slice()));
    modal.querySelectorAll('[data-picker-close]').forEach((btn) => btn.addEventListener('click', () => close(null)));
    modal.addEventListener('click', (e) => { if (e.target === modal) close(null); });
    document.addEventListener('keydown', onKey, true);

    render();
    searchEl.focus({ preventScroll: true });
  });
}

function renderChatView(container) {
  if (_chatTeardown) { _chatTeardown(); _chatTeardown = null; }
  container.className = 'h-full w-full overflow-hidden p-4 md:p-6';
  if (window.Chat) Chat.init();

  container.innerHTML = `
    <div class="h-full max-w-4xl mx-auto flex flex-col bg-card border border-line rounded-xl overflow-hidden">
      <div class="px-4 md:px-5 py-3 border-b border-line flex items-center justify-between gap-3 shrink-0">
        <div class="min-w-0">
          <h1 class="font-display text-xl font-semibold tracking-tight">Chat Tim</h1>
          <p class="text-xs text-inksoft">Ruang obrolan workspace · 50 pesan terakhir</p>
        </div>
        <span class="badge bg-fernlight/15 text-ferndeep flex items-center gap-1 shrink-0"><span class="live-dot"></span>Live</span>
      </div>
      <div id="chat-messages" class="flex-1 overflow-y-auto px-3 md:px-5 py-4 space-y-3 bg-paper/30"></div>
      <div class="border-t border-line p-3 shrink-0">
        <div id="chat-attach-chips" class="hidden flex-wrap gap-1.5 mb-2"></div>
        <div class="flex items-end gap-2">
          <button type="button" id="chat-attach" class="btn btn-secondary btn-sm h-9 w-9 p-0 shrink-0" title="Lampirkan task atau workflow" aria-label="Lampirkan task atau workflow"><i data-lucide="paperclip" class="h-4 w-4"></i></button>
          <textarea id="chat-input" rows="1" maxlength="2000" class="form-textarea text-sm flex-1 resize-none max-h-32" placeholder="Tulis pesan untuk tim..."></textarea>
          <button type="button" id="chat-send" class="btn btn-primary btn-sm h-9 shrink-0"><i data-lucide="send" class="h-3.5 w-3.5"></i>Kirim</button>
        </div>
        <div class="flex items-center justify-between mt-1 gap-2">
          <p class="text-[10px] text-inksoft">Enter untuk kirim · Shift+Enter baris baru · maks. 3 lampiran</p>
          <p id="chat-counter" class="text-[10px] text-inksoft tabular-nums">0/2000</p>
        </div>
      </div>
    </div>
  `;
  refreshIcons();

  const listEl = $('#chat-messages', container);
  const inputEl = $('#chat-input', container);
  const sendBtn = $('#chat-send', container);
  const counterEl = $('#chat-counter', container);
  const attachBtn = $('#chat-attach', container);
  const chipsEl = $('#chat-attach-chips', container);
  let pendingAttachments = [];

  function renderChips() {
    if (!chipsEl) return;
    if (pendingAttachments.length === 0) {
      chipsEl.classList.add('hidden');
      chipsEl.classList.remove('flex');
      chipsEl.innerHTML = '';
      return;
    }
    chipsEl.classList.remove('hidden');
    chipsEl.classList.add('flex');
    chipsEl.innerHTML = pendingAttachments.map((a, i) => {
      const info = chatAttachmentInfo(a);
      return `
        <span class="inline-flex items-center gap-1 max-w-full rounded-full border border-line bg-paper px-2 py-1 text-[11px] ${info.available ? 'text-ink' : 'text-inksoft'}">
          <i data-lucide="${info.type === 'workflow' ? 'workflow' : 'square-check-big'}" class="h-3 w-3 shrink-0"></i>
          <span class="truncate max-w-[180px]" title="${escapeHtml(info.title)}">${escapeHtml(info.title)}</span>
          <button type="button" data-chip-remove="${i}" class="h-4 w-4 flex items-center justify-center rounded-full hover:bg-ink/10 shrink-0" title="Hapus lampiran" aria-label="Hapus lampiran"><i data-lucide="x" class="h-2.5 w-2.5"></i></button>
        </span>
      `;
    }).join('');
    refreshIcons();
    chipsEl.querySelectorAll('[data-chip-remove]').forEach((btn) => {
      btn.addEventListener('click', () => {
        pendingAttachments.splice(Number(btn.dataset.chipRemove), 1);
        renderChips();
        inputEl.focus();
      });
    });
  }

  let renderedSignature = '';
  let didAnchor = false;
  let unreadObserver = null;

  function currentFirstUnread() {
    return window.Chat && Chat.firstUnreadId ? Chat.firstUnreadId() : '';
  }

  function messageSignature(msgs) {
    return msgs.map((m) => [
      m.id, m.body || '', m.editedAt || '', m.isDeleted ? '1' : '0',
      (m.attachments || []).map((a) => a.type + ':' + a.id).join(','),
    ].join('|')).join('~') + '#' + (_chatEditId || '');
  }

  function ensureDivider(firstUnread) {
    let divider = listEl.querySelector('#chat-unread-divider');
    if (!firstUnread) {
      if (divider) divider.remove();
      return;
    }
    // Sekali dibuat, garis tetap di posisi awal sesi supaya pesan yang
    // baru terbaca tidak "menyeret" garis ke bawah saat discroll.
    if (divider) return;
    const target = listEl.querySelector(`[data-chat-msg="${firstUnread}"]`);
    if (!target) return;
    divider = document.createElement('div');
    divider.id = 'chat-unread-divider';
    divider.className = 'flex items-center gap-2 py-1';
    divider.setAttribute('role', 'separator');
    divider.setAttribute('aria-label', 'Pesan baru');
    divider.innerHTML = `
      <span class="h-px flex-1 bg-berry/30"></span>
      <span class="text-[10px] font-semibold uppercase tracking-wide text-berry">Pesan baru</span>
      <span class="h-px flex-1 bg-berry/30"></span>
    `;
    target.parentNode.insertBefore(divider, target);
  }

  /* Terapkan status unread ke DOM tanpa render ulang: tebalkan nama &
   * isi pesan, lalu pindahkan/lepas garis "Pesan baru". */
  function applyReadStyles() {
    if (!window.Chat) return;
    listEl.querySelectorAll('[data-chat-msg]').forEach((el) => {
      const unread = !!Chat.isUnread(el.dataset.chatMsg);
      el.dataset.chatUnread = unread ? '1' : '0';
      const name = el.querySelector('[data-chat-name]');
      if (name) name.classList.toggle('font-semibold', unread);
      const body = el.querySelector('[data-chat-body]');
      if (body) body.classList.toggle('font-semibold', unread);
      const cardTitle = el.querySelector('[data-chat-card-title]');
      if (cardTitle) cardTitle.classList.toggle('font-semibold', unread);
    });
    ensureDivider(currentFirstUnread());
    observeUnread();
  }

  function observerRoot() {
    return listEl;
  }

  function observeUnread() {
    if (!unreadObserver) return;
    unreadObserver.disconnect();
    listEl.querySelectorAll('[data-chat-msg][data-chat-unread="1"]').forEach((el) => {
      unreadObserver.observe(el);
    });
  }

  if ('IntersectionObserver' in window) {
    unreadObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const id = entry.target.dataset.chatMsg;
        if (!id || !window.Chat) return;
        if (!Chat.isUnread(id)) { unreadObserver.unobserve(entry.target); return; }
        Chat.markRead(id);
      });
    }, { root: observerRoot(), threshold: 0.5 });
  }

  let lastAnchorTop = -1;

  function scrollToDivider(firstUnread) {
    const divider = listEl.querySelector('#chat-unread-divider');
    const target = divider || (firstUnread ? listEl.querySelector(`[data-chat-msg="${firstUnread}"]`) : null);
    if (!target) return false;
    const top = target.getBoundingClientRect().top
      - listEl.getBoundingClientRect().top
      + listEl.scrollTop - 8;
    lastAnchorTop = Math.max(0, top);
    listEl.scrollTop = lastAnchorTop;
    return true;
  }

  function anchorInitialScroll(firstUnread) {
    if (didAnchor) return false;
    if (!window.Chat || !Chat.isReadReady || !Chat.isReadReady()) return false;
    if (!listEl.querySelector('[data-chat-msg]')) return false;
    didAnchor = true;
    if (!firstUnread || !scrollToDivider(firstUnread)) {
      listEl.scrollTop = listEl.scrollHeight;
      return true;
    }
    // Layout (font/ikon/tinggi kontainer) kadang baru stabil satu-dua
    // frame setelah render; koreksi posisi selama pengguna belum scroll.
    const retry = () => {
      if (!document.body.contains(listEl) || State.view.kind !== 'chat') return;
      if (Math.abs(listEl.scrollTop - lastAnchorTop) > 4) return;
      scrollToDivider(currentFirstUnread());
    };
    requestAnimationFrame(() => { retry(); requestAnimationFrame(retry); });
    setTimeout(retry, 250);
    return true;
  }

  function renderMessages(forceScroll) {
    const msgs = window.Chat ? Chat.getMessages() : [];
    const myEmail = String((State.init && State.init.currentUser && State.init.currentUser.email) || '').toLowerCase();
    const nearBottom = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 140;
    const last = msgs[msgs.length - 1];
    const lastMine = last && String(last.senderEmail || '').toLowerCase() === myEmail;

    renderedSignature = messageSignature(msgs);

    if (msgs.length === 0) {
      listEl.innerHTML = `
        <div class="h-full flex flex-col items-center justify-center text-center text-inksoft px-6">
          <div class="empty-icon"><i data-lucide="messages-square" class="h-6 w-6 text-inksoft/50"></i></div>
          <h3 class="text-base font-medium mb-1">Belum ada pesan</h3>
          <p class="text-sm max-w-xs">Mulai percakapan dengan tim. Pesan hanya dapat dibaca anggota workspace.</p>
        </div>`;
      refreshIcons();
      return;
    }

    const firstUnread = currentFirstUnread();
    let dividerPlaced = false;
    listEl.innerHTML = msgs.map((m) => {
      const mine = String(m.senderEmail || '').toLowerCase() === myEmail;
      const name = m.senderName || m.senderEmail || 'Anggota';
      const editing = _chatEditId === m.id;
      const deleted = m.isDeleted;
      const unread = !!window.Chat && Chat.isUnread(m.id);
      const actions = !deleted && (m.canEdit || m.canDelete);
      const divider = !dividerPlaced && firstUnread && m.id === firstUnread
        ? `<div id="chat-unread-divider" class="flex items-center gap-2 py-1" role="separator" aria-label="Pesan baru">
             <span class="h-px flex-1 bg-berry/30"></span>
             <span class="text-[10px] font-semibold uppercase tracking-wide text-berry">Pesan baru</span>
             <span class="h-px flex-1 bg-berry/30"></span>
           </div>`
        : '';
      if (divider) dividerPlaced = true;
      return `${divider}
        <div class="group flex items-end gap-2 ${mine ? 'justify-end' : ''}" data-chat-msg="${escapeHtml(m.id)}" data-chat-unread="${unread ? '1' : '0'}">
          ${mine ? '' : `<div class="h-7 w-7 rounded-full bg-sage/20 text-ferndeep flex items-center justify-center text-[11px] font-semibold shrink-0 mb-4">${escapeHtml(commentInitial(name))}</div>`}
          <div class="max-w-[85%] md:max-w-[75%] min-w-0 ${mine ? 'text-right' : ''}">
            <div class="flex items-center gap-1.5 ${mine ? 'justify-end' : ''} mb-0.5">
              ${mine ? '' : `<span data-chat-name class="text-[10px] font-medium text-inksoft truncate max-w-[50%]">${escapeHtml(name)}</span>`}
              <span class="text-[10px] text-inksoft/70">${escapeHtml(chatTimeLabel(m.createdAt))}</span>
              ${m.isEdited && !deleted ? '<span class="text-[10px] italic text-inksoft/70">diedit</span>' : ''}
            </div>
            ${editing ? `
              <div class="rounded-lg border border-line bg-card px-2 py-2 text-left space-y-1.5">
                <textarea data-chat-edit-input rows="2" maxlength="2000" class="form-textarea text-sm">${escapeHtml(_chatEditDraft)}</textarea>
                <div class="flex justify-end gap-1">
                  <button type="button" data-chat-cancel-edit class="btn btn-secondary btn-sm">Batal</button>
                  <button type="button" data-chat-save-edit="${escapeHtml(m.id)}" class="btn btn-primary btn-sm">Simpan</button>
                </div>
              </div>
            ` : `
              ${(deleted || m.body) ? `<div data-chat-body class="inline-block text-left rounded-xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${deleted ? 'bg-paper border border-line italic text-inksoft' : mine ? 'bg-fern text-white' : 'bg-card border border-line text-ink'}">${deleted ? 'Pesan ini telah dihapus' : escapeHtml(m.body)}</div>` : ''}
              ${!deleted && m.attachments && m.attachments.length ? m.attachments.map((a) => chatAttachmentCardHtml(a)).join('') : ''}
            `}
            ${actions ? `
              <div class="flex items-center gap-0.5 mt-0.5 ${mine ? 'justify-end' : ''} opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                ${m.canEdit ? `<button type="button" data-chat-edit="${escapeHtml(m.id)}" class="btn btn-ghost btn-sm h-6 w-6 p-0" title="Edit pesan" aria-label="Edit pesan"><i data-lucide="pencil" class="h-3 w-3"></i></button>` : ''}
                ${m.canDelete ? `<button type="button" data-chat-delete="${escapeHtml(m.id)}" class="btn btn-ghost btn-sm h-6 w-6 p-0 text-berry hover:bg-berry/10" title="Hapus pesan" aria-label="Hapus pesan"><i data-lucide="trash-2" class="h-3 w-3"></i></button>` : ''}
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
    refreshIcons();

    if (editingIdPresent()) {
      const editInput = listEl.querySelector('[data-chat-edit-input]');
      if (editInput) {
        editInput.value = _chatEditDraft;
        editInput.addEventListener('input', () => { _chatEditDraft = editInput.value; });
        editInput.addEventListener('keydown', (e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); saveEdit(_chatEditId); }
        });
        editInput.focus();
        editInput.setSelectionRange(editInput.value.length, editInput.value.length);
      }
    }

    applyReadStyles();

    if (!anchorInitialScroll(firstUnread) && (forceScroll || nearBottom || lastMine)) {
      listEl.scrollTop = listEl.scrollHeight;
    }
  }

  function editingIdPresent() {
    return !!_chatEditId && (window.Chat ? Chat.getMessages().some((m) => m.id === _chatEditId) : false);
  }

  let sending = false;

  async function sendMessage() {
    if (sending) return;
    const text = String(inputEl.value || '').trim();
    if (!text && pendingAttachments.length === 0) { inputEl.focus(); return; }
    sending = true;
    sendBtn.disabled = true;
    const res = await Chat.send(text, pendingAttachments);
    sending = false;
    sendBtn.disabled = false;
    if (!res || !res.success) { toast((res && res.message) || 'Gagal mengirim pesan', 'error'); return; }
    inputEl.value = '';
    inputEl.style.height = '';
    pendingAttachments = [];
    renderChips();
    updateCounter();
    _chatEditId = null;
    renderMessages(true);
    inputEl.focus();
  }

  async function saveEdit(id) {
    const text = String(_chatEditDraft || '').trim();
    if (!text) { toast('Pesan tidak boleh kosong', 'error'); return; }
    const res = await Chat.update(id, text);
    if (!res || !res.success) { toast((res && res.message) || 'Gagal memperbarui pesan', 'error'); return; }
    _chatEditId = null;
    _chatEditDraft = '';
    renderMessages();
    toast('Pesan diperbarui');
  }

  function updateCounter() {
    counterEl.textContent = `${String(inputEl.value || '').length}/2000`;
  }

  function autoGrow() {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(128, inputEl.scrollHeight) + 'px';
  }

  sendBtn.addEventListener('click', sendMessage);
  if (attachBtn) {
    attachBtn.addEventListener('click', async () => {
      const picked = await showChatAttachmentPicker({ selected: pendingAttachments });
      if (!picked) return;
      pendingAttachments = picked.slice(0, 3);
      renderChips();
      inputEl.focus();
    });
  }
  inputEl.addEventListener('input', () => { updateCounter(); autoGrow(); });
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  listEl.addEventListener('click', async (e) => {
    const openTaskBtn = e.target.closest('[data-chat-open-task]');
    if (openTaskBtn) { await openTaskDrawer(openTaskBtn.dataset.chatOpenTask); return; }
    const openWfBtn = e.target.closest('[data-chat-open-wf]');
    if (openWfBtn) { await openLinkedWorkflow(openWfBtn.dataset.chatOpenWf); return; }
    const editBtn = e.target.closest('[data-chat-edit]');
    if (editBtn) {
      const msg = Chat.getMessages().find((m) => m.id === editBtn.dataset.chatEdit);
      _chatEditId = editBtn.dataset.chatEdit;
      _chatEditDraft = msg ? msg.body : '';
      renderMessages();
      return;
    }
    const cancelBtn = e.target.closest('[data-chat-cancel-edit]');
    if (cancelBtn) {
      _chatEditId = null;
      _chatEditDraft = '';
      renderMessages();
      return;
    }
    const saveBtn = e.target.closest('[data-chat-save-edit]');
    if (saveBtn) { await saveEdit(saveBtn.dataset.chatSaveEdit); return; }
    const delBtn = e.target.closest('[data-chat-delete]');
    if (delBtn) {
      const ok = await showConfirmDialog({
        title: 'Hapus pesan?',
        message: 'Pesan akan dihapus untuk semua anggota. Tindakan ini tidak bisa dibatalkan.',
        confirmText: 'Hapus Pesan',
        cancelText: 'Batal',
        danger: true,
      });
      if (!ok) return;
      const res = await Chat.remove(delBtn.dataset.chatDelete);
      if (!res || !res.success) { toast((res && res.message) || 'Gagal menghapus pesan', 'error'); return; }
      if (_chatEditId === delBtn.dataset.chatDelete) { _chatEditId = null; _chatEditDraft = ''; }
      renderMessages();
      toast('Pesan dihapus');
    }
  });

  renderMessages(true);
  updateCounter();
  inputEl.focus();

  const onChange = () => {
    if (!document.body.contains(container) || State.view.kind !== 'chat') {
      if (_chatTeardown) { _chatTeardown(); _chatTeardown = null; }
      return;
    }
    if (!window.Chat) return;
    if (messageSignature(Chat.getMessages()) !== renderedSignature) {
      renderMessages();
      return;
    }
    applyReadStyles();
    if (!didAnchor) anchorInitialScroll(currentFirstUnread());
  };
  window.addEventListener('fs:chat-change', onChange);
  _chatTeardown = () => {
    window.removeEventListener('fs:chat-change', onChange);
    if (unreadObserver) { unreadObserver.disconnect(); unreadObserver = null; }
  };
}
