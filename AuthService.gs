/**
 * FlowSpace - AuthService.gs
 * Identitas pengguna dan otorisasi workspace.
 */

var AuthService = {
  /**
   * Dapatkan email pengguna aktif (yang menjalankan script).
   * Catatan: cara ini hanya valid jika web app "executeAs: USER_DEPLOYING"
   * atau "USER_ACCESSING". Sesuaikan dengan model deployment.
   */
  getCurrentUserEmail: function () {
    try {
      var email = Session.getActiveUser().getEmail();
      if (!email) {
        email = Session.getEffectiveUser().getEmail();
      }
      return email;
    } catch (e) {
      return null;
    }
  },

  /**
   * Dapatkan konteks workspace untuk pengguna saat ini.
   * Untuk MVP: ambil workspace pertama yang status=active, dan cari member.
   * Jika user belum jadi member, anggap viewer guest.
   */
  getCurrentContext: function () {
    var email = this.getCurrentUserEmail();
    var workspaces = DatabaseService.readAll(CONFIG.SHEETS.WORKSPACES);
    var workspace = null;
    for (var i = 0; i < workspaces.length; i++) {
      if (String(workspaces[i].status) === 'active') {
        workspace = workspaces[i];
        break;
      }
    }
    if (!workspace) {
      return {
        workspace: null,
        member: null,
        role: 'viewer',
        email: email,
      };
    }

    var members = DatabaseService.findBy(CONFIG.SHEETS.MEMBERS, 'workspace_id', workspace.workspace_id);
    var member = null;
    for (var j = 0; j < members.length; j++) {
      if (String(members[j].email) === String(email)) {
        member = members[j];
        break;
      }
    }
    // Jika tidak ditemukan sebagai member tapi user adalah owner workspace, treat as admin
    if (!member && email && String(workspace.owner_email) === String(email)) {
      member = {
        member_id: 'owner-' + workspace.workspace_id,
        workspace_id: workspace.workspace_id,
        email: email,
        display_name: email.split('@')[0],
        role: 'admin',
        member_status: 'active',
      };
    }

    return {
      workspace: workspace,
      member: member,
      role: member ? member.role : 'viewer',
      email: email,
    };
  },

  /**
   * Versi safe: jika workspace belum setup, return null tanpa throw.
   */
  getCurrentUserContextSafe: function () {
    try {
      var id = DatabaseService.getSpreadsheetId();
      if (!id) {
        return { workspace: null, member: null, role: 'viewer', email: null };
      }
      return this.getCurrentContext();
    } catch (e) {
      return { workspace: null, member: null, role: 'viewer', email: null };
    }
  },

  /**
   * Pastikan user adalah member aktif workspace dengan role yang sesuai.
   * @param {string[]} allowedRoles - ['admin','editor','viewer'] atau subset
   * @return {Object} context { workspace, member, role, email }
   * @throws Error jika tidak diizinkan
   */
  requireAccess: function (allowedRoles) {
    var ctx = this.getCurrentContext();
    if (!ctx.workspace) {
      throw new Error('Workspace belum di-setup. Jalankan setup terlebih dahulu.');
    }
    if (!ctx.member || ctx.member.member_status !== 'active') {
      throw new Error('Akses ditolak: Anda bukan member aktif workspace ini.');
    }
    if (allowedRoles && allowedRoles.indexOf(ctx.role) === -1) {
      throw new Error('Akses ditolak: role Anda (' + ctx.role + ') tidak diizinkan untuk operasi ini.');
    }
    return ctx;
  },

  /**
   * Cek apakah user adalah admin.
   */
  requireAdmin: function () {
    return this.requireAccess(['admin']);
  },

  /**
   * Cek apakah user adalah admin atau editor (bisa edit data).
   */
  requireEditor: function () {
    return this.requireAccess(['admin', 'editor']);
  },
};
