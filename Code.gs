/**
 * FlowSpace - Code.gs
 * Entry point untuk Google Apps Script Web App.
 */

/**
 * doGet - halaman utama web app.
 */
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('FlowSpace - Workflow Visual Canvas')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * include - helper untuk include file HTML (CSS/JS partials) di Index.html.
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/** Helper: format respons sukses */
function apiSuccess(data, message) {
  return {
    success: true,
    data: data,
    message: message || null,
    errorCode: null,
  };
}

/** Helper: format respons error */
function apiError(message, errorCode) {
  return {
    success: false,
    data: null,
    message: message,
    errorCode: errorCode || 'INTERNAL',
  };
}

/**
 * getInitialAppData - dipanggil frontend saat pertama load.
 * Mengembalikan context workspace, members, current user.
 */
function getInitialAppData() {
  try {
    var ctx = AuthService.getCurrentUserContextSafe();
    if (!ctx.workspace) {
      return apiSuccess({
        workspace: null,
        members: [],
        currentUser: null,
        setupRequired: true,
      });
    }
    var members = DatabaseService.findBy(CONFIG.SHEETS.MEMBERS, 'workspace_id', ctx.workspace.workspace_id)
      .map(function (m) {
        return {
          id: m.member_id,
          email: m.email,
          displayName: m.display_name,
          role: m.role,
          status: m.member_status,
        };
      });
    return apiSuccess({
      workspace: {
        id: ctx.workspace.workspace_id,
        name: ctx.workspace.workspace_name,
        ownerEmail: ctx.workspace.owner_email,
        status: ctx.workspace.status,
      },
      members: members,
      currentUser: ctx.member ? {
        email: ctx.member.email,
        displayName: ctx.member.display_name,
        role: ctx.member.role,
      } : null,
      setupRequired: false,
    });
  } catch (err) {
    return apiError('Gagal memuat init data: ' + err.message, 'INTERNAL');
  }
}

/* =====================================================================
 *  PUBLIC API FUNCTIONS (dipanggil via google.script.run dari frontend)
 * ===================================================================== */

/** === Workflows === */
function listWorkflows() {
  return WorkflowService.listWorkflows();
}
function createWorkflow(payload) {
  return WorkflowService.createWorkflow(payload);
}
function updateWorkflow(payload) {
  return WorkflowService.updateWorkflow(payload);
}
function archiveWorkflow(workflowId) {
  return WorkflowService.updateWorkflow({ id: workflowId, status: 'archived' });
}
function deleteWorkflow(workflowId) {
  return WorkflowService.deleteWorkflow(workflowId);
}
function duplicateWorkflow(workflowId) {
  return WorkflowService.duplicateWorkflow(workflowId);
}

/** === Canvas === */
function getWorkflowCanvas(workflowId) {
  return CanvasService.getCanvas(workflowId);
}
function saveCanvasLayout(payload) {
  return CanvasService.saveCanvas(payload);
}
function createNode(payload) {
  return CanvasService.createNode(payload);
}
function updateNode(payload) {
  return CanvasService.updateNode(payload);
}
function deleteNode(payload) {
  return CanvasService.deleteNode(payload.nodeId || payload);
}
function createEdge(payload) {
  return CanvasService.createEdge(payload);
}
function deleteEdge(payload) {
  return CanvasService.deleteEdge(payload.edgeId || payload);
}

/** === Tasks === */
function listTasks(filters) {
  return TaskService.listTasks(filters || {});
}
function getTask(taskId) {
  return TaskService.getTask(taskId);
}
function createTask(payload) {
  return TaskService.createTask(payload);
}
function updateTask(payload) {
  return TaskService.updateTask(payload);
}
function updateTaskStatus(payload) {
  return TaskService.updateTask({ id: payload.taskId, status: payload.status, expectedVersion: payload.expectedVersion });
}
function updateTaskProgress(payload) {
  return TaskService.updateTask({ id: payload.taskId, progress: payload.progress, expectedVersion: payload.expectedVersion });
}
function deleteTask(taskId) {
  return TaskService.deleteTask(taskId);
}

/** === Applications === */
function listApplications() {
  return ApplicationService.listApplications();
}
function createApplication(payload) {
  return ApplicationService.createApplication(payload);
}
function updateApplication(payload) {
  return ApplicationService.updateApplication(payload);
}
function deleteApplication(appId) {
  return ApplicationService.deleteApplication(appId);
}
function linkApplicationToTask(payload) {
  return ApplicationService.linkApplicationToTask(payload);
}
function unlinkApplicationFromTask(taskAppId) {
  return ApplicationService.unlinkApplicationFromTask(taskAppId);
}

/** === Application Categories === */
function listCategories() {
  return CategoryService.listCategories();
}
function createCategory(payload) {
  return CategoryService.createCategory(payload);
}
function updateCategory(payload) {
  return CategoryService.updateCategory(payload);
}
function deleteCategory(categoryId) {
  return CategoryService.deleteCategory(categoryId);
}

/** === Checklist === */
function listChecklist(taskId) {
  return ChecklistService.listChecklist(taskId);
}
function createChecklistItem(payload) {
  return ChecklistService.createItem(payload);
}
function updateChecklistItem(payload) {
  return ChecklistService.updateItem(payload);
}
function deleteChecklistItem(payload) {
  return ChecklistService.deleteItem(payload.itemId || payload);
}

/** === Dashboard === */
function getDashboardData() {
  return DashboardService.getDashboardData();
}

/** === Activity Log === */
function listActivityLogs(filters) {
  return AuditService.listLogs(filters || {});
}

/** === Members === */
function listMembers() {
  return WorkspaceService.listMembers();
}
function addMember(payload) {
  return WorkspaceService.addMember(payload);
}

/** === Setup === */
function setupDatabase() {
  return SetupService.runSetup();
}
function seedDemoData() {
  return SetupService.seedDemoData();
}
function resetDatabase() {
  return SetupService.resetDatabase();
}
function getSetupStatus() {
  return SetupService.getStatus();
}
