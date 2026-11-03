/**
 * FlowSpace - DashboardService.gs
 * Agregasi statistik untuk dashboard.
 */

var DashboardService = {
  /** Hitung semua statistik untuk dashboard */
  getDashboardData: function () {
    var ctx = AuthService.getCurrentContext();
    if (!ctx.workspace) return apiError('Workspace belum siap', 'NOT_FOUND');

    var tasks = DatabaseService.findBy(CONFIG.SHEETS.TASKS, 'workspace_id', ctx.workspace.workspace_id);
    var workflows = DatabaseService.findBy(CONFIG.SHEETS.WORKFLOWS, 'workspace_id', ctx.workspace.workspace_id)
      .filter(function (w) { return String(w.status) === 'active'; });
    var members = DatabaseService.findBy(CONFIG.SHEETS.MEMBERS, 'workspace_id', ctx.workspace.workspace_id);

    var today = new Date().toISOString().slice(0, 10);

    var total = tasks.length;
    var done = 0, inProgress = 0, todo = 0, review = 0, backlog = 0, overdue = 0;
    var priority = { critical: 0, high: 0, medium: 0, low: 0 };
    var criticalHigh = [];

    for (var i = 0; i < tasks.length; i++) {
      var t = tasks[i];
      if (t.status === 'done') done++;
      else if (t.status === 'in_progress') inProgress++;
      else if (t.status === 'todo') todo++;
      else if (t.status === 'review') review++;
      else if (t.status === 'backlog') backlog++;
      priority[t.priority] = (priority[t.priority] || 0) + 1;
      if (t.status !== 'done' && t.due_date && String(t.due_date) < today) overdue++;
      if ((t.priority === 'critical' || t.priority === 'high') && t.status !== 'done') {
        var wfName = '';
        for (var j = 0; j < workflows.length; j++) {
          if (String(workflows[j].workflow_id) === String(t.workflow_id)) {
            wfName = workflows[j].workflow_name;
            break;
          }
        }
        criticalHigh.push({
          id: t.task_id,
          title: t.title,
          priority: t.priority,
          assigneeEmail: t.assignee_email,
          dueDate: t.due_date,
          workflow: { id: t.workflow_id, name: wfName },
        });
      }
    }

    var avgProgress = 0;
    if (total > 0) {
      var sum = 0;
      for (var k = 0; k < tasks.length; k++) sum += Number(tasks[k].progress) || 0;
      avgProgress = Math.round(sum / total);
    }

    // Per PIC
    var byPicMap = {};
    for (var m = 0; m < tasks.length; m++) {
      var pic = tasks[m].assignee_email || 'Unassigned';
      if (!byPicMap[pic]) byPicMap[pic] = { email: pic, total: 0, done: 0, inProgress: 0, overdue: 0 };
      byPicMap[pic].total++;
      if (tasks[m].status === 'done') byPicMap[pic].done++;
      if (tasks[m].status === 'in_progress') byPicMap[pic].inProgress++;
      if (tasks[m].status !== 'done' && tasks[m].due_date && String(tasks[m].due_date) < today) byPicMap[pic].overdue++;
    }
    var byPic = Object.keys(byPicMap).map(function (k) { return byPicMap[k]; });

    // Per workflow
    var byWfMap = {};
    for (var n = 0; n < tasks.length; n++) {
      var wid = tasks[n].workflow_id;
      if (!byWfMap[wid]) {
        var name = '';
        for (var p = 0; p < workflows.length; p++) {
          if (String(workflows[p].workflow_id) === String(wid)) { name = workflows[p].workflow_name; break; }
        }
        byWfMap[wid] = { id: wid, name: name, total: 0, done: 0, progress: 0 };
      }
      byWfMap[wid].total++;
      if (tasks[n].status === 'done') byWfMap[wid].done++;
      byWfMap[wid].progress += Number(tasks[n].progress) || 0;
    }
    var byWorkflow = Object.keys(byWfMap).map(function (k) {
      var w = byWfMap[k];
      w.progress = w.total === 0 ? 0 : Math.round(w.progress / w.total);
      return w;
    });

    return apiSuccess({
      total: total,
      done: done,
      inProgress: inProgress,
      todo: todo,
      review: review,
      backlog: backlog,
      overdue: overdue,
      avgProgress: avgProgress,
      priority: priority,
      criticalHigh: criticalHigh,
      byPic: byPic,
      byWorkflow: byWorkflow,
      workflowCount: workflows.length,
      memberCount: members.length,
    });
  },
};
