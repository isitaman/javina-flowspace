/**
 * FlowSpace - SetupService.gs
 * Setup spreadsheet database & seed data demo.
 *
 * Cara pakai:
 * 1. Buka Apps Script editor
 * 2. Pilih fungsi "setupDatabase" lalu klik Run (ijinkan akses saat diminta)
 * 3. Setelah berhasil, deploy sebagai Web App
 * 4. (Opsional) Jalankan "seedDemoData" untuk mengisi data contoh
 */

var SetupService = {
  /**
   * Status setup: apakah sudah dilakukan?
   */
  getStatus: function () {
    var id = DatabaseService.getSpreadsheetId();
    if (!id) {
      return apiSuccess({
        setupRequired: true,
        spreadsheetId: null,
        spreadsheetUrl: null,
      });
    }
    try {
      var ss = SpreadsheetApp.openById(id);
      return apiSuccess({
        setupRequired: false,
        spreadsheetId: id,
        spreadsheetUrl: ss.getUrl(),
        sheets: ss.getSheets().map(function (s) { return s.getName(); }),
      });
    } catch (e) {
      return apiSuccess({
        setupRequired: true,
        spreadsheetId: null,
        spreadsheetUrl: null,
        error: e.message,
      });
    }
  },

  /**
   * Setup database:
   * 1. Buat spreadsheet baru (atau pakai yang sudah ada di script properties)
   * 2. Pastikan semua sheet dan header ada
   * 3. Tambahkan workspace default + admin (current user)
   */
  runSetup: function () {
    // Jika sudah pernah di-setup (workspace sudah ada), hanya admin yang boleh menjalankan ulang.
    var id = DatabaseService.getSpreadsheetId();
    if (id) {
      var existingWs = DatabaseService.readAll(CONFIG.SHEETS.WORKSPACES);
      if (existingWs.length > 0) {
        AuthService.requireAdmin();
      }
    }

    var email = AuthService.getCurrentUserEmail() || 'admin@flowspace.local';
    var name = email.split('@')[0];

    if (!id) {
      // Buat spreadsheet baru
      var ss = SpreadsheetApp.create('FlowSpace Database');
      id = ss.getId();
      DatabaseService.setSpreadsheetId(id);
    }
    DatabaseService.ensureSheets();

    // Cek apakah sudah ada workspace
    var workspaces = DatabaseService.readAll(CONFIG.SHEETS.WORKSPACES);
    if (workspaces.length === 0) {
      var now = nowIso();
      var wsId = generateId('ws');
      DatabaseService.insert(CONFIG.SHEETS.WORKSPACES, {
        workspace_id: wsId,
        workspace_name: 'FlowSpace Workspace',
        owner_email: email,
        status: 'active',
        created_at: now,
        updated_at: now,
      });
      // Tambahkan owner sebagai admin member
      DatabaseService.insert(CONFIG.SHEETS.MEMBERS, {
        member_id: generateId('mem'),
        workspace_id: wsId,
        email: email,
        display_name: name.charAt(0).toUpperCase() + name.slice(1),
        role: 'admin',
        member_status: 'active',
        created_at: now,
      });
    }

    return apiSuccess({
      spreadsheetId: id,
      spreadsheetUrl: SpreadsheetApp.openById(id).getUrl(),
      message: 'Setup berhasil. Anda sekarang bisa deploy sebagai Web App.',
    }, 'Setup berhasil');
  },

  /**
   * Reset database - hapus semua data demo. HATI-HATI!
   */
  resetDatabase: function () {
    var id = DatabaseService.getSpreadsheetId();
    if (!id) return apiError('Belum setup database', 'NOT_FOUND');
    AuthService.requireAdmin();
    Object.keys(CONFIG.HEADERS).forEach(function (sheetName) {
      var ss = DatabaseService.getSpreadsheet();
      var sheet = ss.getSheetByName(sheetName);
      if (sheet) {
        var lastRow = sheet.getLastRow();
        if (lastRow > 1) {
          sheet.deleteRows(2, lastRow - 1);
        }
      }
    });
    return apiSuccess(null, 'Database direset');
  },

  /**
   * Seed data demo untuk testing.
   */
  seedDemoData: function () {
    var id = DatabaseService.getSpreadsheetId();
    if (!id) return apiError('Belum setup database. Jalankan setupDatabase dulu.', 'NOT_FOUND');
    AuthService.requireAdmin();
    DatabaseService.ensureSheets();

    var email = AuthService.getCurrentUserEmail() || 'admin@flowspace.local';
    var ctx = AuthService.getCurrentContext();
    var ws = ctx.workspace;
    if (!ws) {
      // fallback ke first active workspace
      var wss = DatabaseService.readAll(CONFIG.SHEETS.WORKSPACES).filter(function (w) { return String(w.status) === 'active'; });
      if (wss.length === 0) return apiError('Tidak ada workspace', 'NOT_FOUND');
      ws = wss[0];
    }
    var wsId = ws.workspace_id;
    var now = nowIso();

    // Tambah members demo jika belum ada
    var existingMembers = DatabaseService.findBy(CONFIG.SHEETS.MEMBERS, 'workspace_id', wsId);
    if (existingMembers.length < 2) {
      var demoMembers = [
        { email: 'siti@flowspace.id', displayName: 'Siti Rahayu', role: 'editor' },
        { email: 'budi@flowspace.id', displayName: 'Budi Santoso', role: 'editor' },
        { email: 'maya@flowspace.id', displayName: 'Maya Wijaya', role: 'viewer' },
      ];
      // Cek apakah email admin sudah ada di members
      var adminInMembers = existingMembers.some(function (m) { return String(m.email) === String(email); });
      if (!adminInMembers) {
        DatabaseService.insert(CONFIG.SHEETS.MEMBERS, {
          member_id: generateId('mem'),
          workspace_id: wsId,
          email: email,
          display_name: 'Andi Pratama',
          role: 'admin',
          member_status: 'active',
          created_at: now,
        });
      }
      demoMembers.forEach(function (m) {
        if (!existingMembers.some(function (em) { return String(em.email) === String(m.email); })) {
          DatabaseService.insert(CONFIG.SHEETS.MEMBERS, {
            member_id: generateId('mem'),
            workspace_id: wsId,
            email: m.email,
            display_name: m.displayName,
            role: m.role,
            member_status: 'active',
            created_at: now,
          });
        }
      });
    }

    // Workflows
    var wfOnboardingId = generateId('wf');
    DatabaseService.insert(CONFIG.SHEETS.WORKFLOWS, {
      workflow_id: wfOnboardingId,
      workspace_id: wsId,
      workflow_name: 'Onboarding Karyawan Baru',
      description: 'Alur onboarding karyawan baru dari hari pertama hingga selesai probasi.',
      canvas_settings_json: JSON.stringify({ zoom: 0.85, x: 0, y: 0 }),
      created_by: email,
      created_at: now,
      updated_at: now,
      status: 'active',
      version: 1,
    });

    var wfProcurementId = generateId('wf');
    DatabaseService.insert(CONFIG.SHEETS.WORKFLOWS, {
      workflow_id: wfProcurementId,
      workspace_id: wsId,
      workflow_name: 'Pengadaan Barang',
      description: 'Alur pengajuan, persetujuan, dan penerimaan barang pengadaan.',
      canvas_settings_json: JSON.stringify({ zoom: 0.85, x: 0, y: 0 }),
      created_by: email,
      created_at: now,
      updated_at: now,
      status: 'active',
      version: 1,
    });

    var wfContentId = generateId('wf');
    DatabaseService.insert(CONFIG.SHEETS.WORKFLOWS, {
      workflow_id: wfContentId,
      workspace_id: wsId,
      workflow_name: 'Produksi Konten Marketing',
      description: 'Pipeline produksi konten mulai dari ide hingga publikasi.',
      canvas_settings_json: JSON.stringify({ zoom: 0.85, x: 0, y: 0 }),
      created_by: 'siti@flowspace.id',
      created_at: now,
      updated_at: now,
      status: 'active',
      version: 1,
    });

    // Nodes for Onboarding
    var n1 = generateId('node');
    var n2 = generateId('node');
    var n3 = generateId('node');
    var n4 = generateId('node');
    var n5 = generateId('node');
    var n6 = generateId('node');
    var n7 = generateId('node');
    var n8 = generateId('node');
    var nodesData = [
      { id: n1, type: 'start_end', title: 'Mulai', desc: 'Hari pertama karyawan', x: 0, y: 200, w: 140, h: 60 },
      { id: n2, type: 'process', title: 'Persiapan Akun & Email', desc: 'Buatkan akun email dan akses sistem', x: 220, y: 200, w: 180, h: 80 },
      { id: n3, type: 'task', title: 'Induksi Budaya & Kebijakan', desc: 'Sesi induksi kebijakan perusahaan', x: 440, y: 120, w: 180, h: 80 },
      { id: n4, type: 'task', title: 'Setup Workstation', desc: 'Pasang laptop, akses VPN, dan tools', x: 440, y: 300, w: 180, h: 80 },
      { id: n5, type: 'decision', title: 'Lulus Probasi?', desc: 'Keputusan setelah 3 bulan', x: 680, y: 200, w: 160, h: 80 },
      { id: n6, type: 'process', title: 'Evaluasi Mingguan', desc: 'Check-in mingguan dengan mentor', x: 680, y: 380, w: 160, h: 80 },
      { id: n7, type: 'start_end', title: 'Selesai', desc: 'Konfirmasi karyawan tetap', x: 900, y: 200, w: 140, h: 60 },
      { id: n8, type: 'note', title: 'Catatan: Dokumen Wajib', desc: 'KTP, NPWP, rekening, foto 3x4', x: 220, y: 40, w: 200, h: 70 },
    ];
    nodesData.forEach(function (n) {
      DatabaseService.insert(CONFIG.SHEETS.NODES, {
        node_id: n.id,
        workflow_id: wfOnboardingId,
        node_type: n.type,
        title: n.title,
        description: n.desc,
        position_x: n.x,
        position_y: n.y,
        width: n.w,
        height: n.h,
        style_json: '{}',
        application_id: '',
        task_id: '',
        created_at: now,
        updated_at: now,
        version: 1,
      });
    });

    // Edges for Onboarding
    // Format: [source, target, label, sourceOutput, targetInput]
    var edgesData = [
      [n1, n2, '', 'output_1', 'input_1'], [n2, n3, '', 'output_1', 'input_1'], [n2, n4, '', 'output_1', 'input_1'], [n3, n5, '', 'output_1', 'input_1'], [n4, n5, '', 'output_1', 'input_2'],
      [n5, n7, 'Ya', 'output_1', 'input_1'], [n5, n6, 'Belum', 'output_2', 'input_2'], [n6, n5, 'Re-evaluasi', 'output_1', 'input_1'],
    ];
    edgesData.forEach(function (e) {
      DatabaseService.insert(CONFIG.SHEETS.EDGES, {
        edge_id: generateId('edge'),
        workflow_id: wfOnboardingId,
        source_node_id: e[0],
        target_node_id: e[1],
        label: e[2],
        condition: '',
        source_output: e[3] || 'output_1',
        target_input: e[4] || 'input_1',
        created_at: now,
        updated_at: now,
      });
    });

    // Tasks linked to nodes
    var t1Id = generateId('task');
    var t2Id = generateId('task');
    var t3Id = generateId('task');
    var t4Id = generateId('task');
    var t5Id = generateId('task');
    var tasksData = [
      { id: t1Id, wfId: wfOnboardingId, nodeId: n3, title: 'Induksi Budaya & Kebijakan', desc: 'Sesi induksi kebijakan perusahaan oleh HRD.', assignee: 'siti@flowspace.id', status: 'in_progress', priority: 'high', progress: 65, due: '2026-10-25' },
      { id: t2Id, wfId: wfOnboardingId, nodeId: n4, title: 'Setup Workstation', desc: 'Pasang laptop, akses VPN, dan tools dev.', assignee: 'budi@flowspace.id', status: 'review', priority: 'critical', progress: 80, due: '2026-10-15' },
      { id: t3Id, wfId: wfOnboardingId, nodeId: n2, title: 'Buatkan Akun Email & Akses', desc: 'Buatkan email perusahaan dan akun SSO.', assignee: 'siti@flowspace.id', status: 'done', priority: 'high', progress: 100, due: '2026-10-05' },
      { id: t4Id, wfId: wfOnboardingId, nodeId: n6, title: 'Evaluasi Mingguan Minggu 1', desc: 'Check-in mingguan dengan mentor.', assignee: 'budi@flowspace.id', status: 'todo', priority: 'medium', progress: 0, due: '2026-10-29' },
      { id: t5Id, wfId: wfOnboardingId, nodeId: n5, title: 'Keputusan Probasi Final', desc: 'Rapat final keputusan status karyawan tetap.', assignee: email, status: 'backlog', priority: 'critical', progress: 0, due: '2026-12-28' },
    ];
    tasksData.forEach(function (t) {
      DatabaseService.insert(CONFIG.SHEETS.TASKS, {
        task_id: t.id,
        workspace_id: wsId,
        workflow_id: t.wfId,
        node_id: t.nodeId,
        title: t.title,
        description: t.desc,
        assignee_email: t.assignee,
        status: t.status,
        priority: t.priority,
        progress: t.progress,
        progress_mode: 'manual',
        start_date: '',
        due_date: t.due,
        created_by: email,
        created_at: now,
        updated_at: now,
        version: 1,
      });
    });

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
      var aid = generateId('app');
      appIds[a.name] = aid;
      DatabaseService.insert(CONFIG.SHEETS.APPLICATIONS, {
        app_id: aid,
        workspace_id: wsId,
        app_name: a.name,
        app_url: a.url,
        category: a.category,
        description: a.desc,
        icon_url: '',
        created_by: email,
        created_at: now,
        updated_at: now,
      });
    });

    // Link apps to tasks
    DatabaseService.insert(CONFIG.SHEETS.TASK_APPLICATIONS, {
      task_app_id: generateId('ta'),
      task_id: t3Id,
      app_id: appIds['Google Workspace'],
      custom_url: '',
      link_label: 'Buat Akun',
      created_at: now,
    });
    DatabaseService.insert(CONFIG.SHEETS.TASK_APPLICATIONS, {
      task_app_id: generateId('ta'),
      task_id: t1Id,
      app_id: appIds['Slack'],
      custom_url: '',
      link_label: 'Channel Onboarding',
      created_at: now,
    });
    DatabaseService.insert(CONFIG.SHEETS.TASK_APPLICATIONS, {
      task_app_id: generateId('ta'),
      task_id: t1Id,
      app_id: appIds['Notion'],
      custom_url: '',
      link_label: 'Handbook Karyawan',
      created_at: now,
    });

    // Seed kategori aplikasi (idempotent: hanya jika workspace belum punya kategori)
    CategoryService._ensureCategories(wsId);

    // Checklist
    var checklistData = [
      [t1Id, 'Jadwalkan sesi induksi', true], [t1Id, 'Siapkan slide presentasi kebijakan', true],
      [t1Id, 'Bagikan handbook karyawan', true], [t1Id, 'Sesi tanya jawab', false],
      [t1Id, 'Tanda tangan receipt kebijakan', false],
      [t2Id, 'Pesan laptop dari IT', true], [t2Id, 'Konfigurasi VPN', true],
      [t2Id, 'Install IDE & tools dev', true], [t2Id, 'Akses repo GitHub', true],
      [t2Id, 'Verifikasi akses CI/CD', false],
    ];
    checklistData.forEach(function (c, idx) {
      DatabaseService.insert(CONFIG.SHEETS.CHECKLIST, {
        checklist_id: generateId('cli'),
        task_id: c[0],
        item_title: c[1],
        is_completed: c[2] ? 'true' : 'false',
        sort_order: idx,
        created_by: email,
        created_at: now,
        updated_at: now,
      });
    });

    // Activity logs
    DatabaseService.insert(CONFIG.SHEETS.ACTIVITY_LOGS, {
      log_id: generateId('log'),
      workspace_id: wsId,
      entity_type: 'workflow',
      entity_id: wfOnboardingId,
      action: 'create',
      actor_email: email,
      old_value_json: '',
      new_value_json: JSON.stringify({ name: 'Onboarding Karyawan Baru' }),
      created_at: now,
    });
    DatabaseService.insert(CONFIG.SHEETS.ACTIVITY_LOGS, {
      log_id: generateId('log'),
      workspace_id: wsId,
      entity_type: 'task',
      entity_id: t1Id,
      action: 'create',
      actor_email: email,
      old_value_json: '',
      new_value_json: JSON.stringify({ title: 'Induksi Budaya & Kebijakan' }),
      created_at: now,
    });

    return apiSuccess({
      tasksCreated: tasksData.length,
      workflowsCreated: 3,
      appsCreated: appsData.length,
    }, 'Demo data berhasil dimuat. Refresh aplikasi untuk melihat data.');
  },
};
