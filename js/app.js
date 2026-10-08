import { db, Priority, Recurrence, newTask, newGoal, newHabit, newTimeBlock, newSubtask, seedIfEmpty } from './db.js';
import * as L from './logic.js';
import { barChart } from './charts.js';
import { ensurePushPermission, subscribeToPush, syncReminder, cancelReminder } from './notifications.js';
import { getApiKey, setApiKey, hasApiKey, aiBreakdown, aiQuickAdd, aiWeeklyInsights, aiFocusSuggestion } from './ai.js';

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: '◆' },
  { id: 'tasks', label: 'Tasks', icon: '☑' },
  { id: 'calendar', label: 'Calendar', icon: '▦' },
  { id: 'planner', label: 'Planner', icon: '▤' },
  { id: 'focus', label: 'Focus', icon: '◐' },
  { id: 'habits', label: 'Habits', icon: '↻' },
  { id: 'goals', label: 'Goals', icon: '◎' },
  { id: 'settings', label: 'Settings', icon: '⚙' }
];
const TAB_IDS = ['dashboard', 'tasks', 'planner', 'habits'];
const MORE_IDS = ['calendar', 'focus', 'goals', 'settings'];
let moreMenuOpen = false;

const app = document.getElementById('app-shell');

function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  const parts = hash.split('/').filter(Boolean);
  return { page: parts[0] || 'dashboard', param: parts[1], param2: parts[2] };
}

function fmtDate(ms) {
  if (ms == null) return null;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function fmtDateTimeLocal(ms) {
  if (ms == null) return '';
  const d = new Date(ms);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function parseLocalDateTime(str) {
  if (!str) return null;
  const t = new Date(str).getTime();
  return Number.isNaN(t) ? null : t;
}
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function escapeAttr(s) { return escapeHtml(s); }
function emptyState(title, sub) { return `<div class="empty-state"><h3>${title}</h3><p>${sub}</p></div>`; }

// ---------- Toasts (with optional Undo) ----------
function toast(msg) {
  const el = ensureToastEl();
  el.innerHTML = escapeHtml(msg);
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 1800);
}
function toastUndo(msg, onUndo) {
  const el = ensureToastEl();
  el.innerHTML = `${escapeHtml(msg)} <button class="link" style="color:var(--paper);text-decoration:underline;margin-left:6px;" id="undo-btn">Undo</button>`;
  el.classList.add('show');
  clearTimeout(toast._t);
  const btn = el.querySelector('#undo-btn');
  const done = () => { el.classList.remove('show'); };
  btn.onclick = () => { onUndo(); done(); };
  toast._t = setTimeout(done, 5000);
}
function ensureToastEl() {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.appendChild(el); }
  return el;
}

// ---------- Theme ----------
function initTheme() {
  const saved = localStorage.getItem('po-theme');
  const theme = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('po-theme', next);
}

// ---------- Install prompt ----------
let deferredInstallPrompt = null;
let installDismissed = sessionStorage.getItem('po-install-dismissed') === '1';
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  renderTopBanners();
});
window.addEventListener('appinstalled', () => { deferredInstallPrompt = null; renderTopBanners(); });

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function renderTopBanners() {
  let host = document.getElementById('top-banners');
  if (!host) return;
  let html = '';
  if (!navigator.onLine) html += `<div class="banner offline">You're offline — changes are saved locally and will sync reminders once you're back online.</div>`;
  if (deferredInstallPrompt && !isStandalone() && !installDismissed) {
    html += `<div class="banner install"><span>Install Power Organizer for the full app experience.</span><button id="do-install">Install</button><button class="dismiss" id="dismiss-install">✕</button></div>`;
  }
  host.innerHTML = html;
  document.getElementById('do-install')?.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    renderTopBanners();
  });
  document.getElementById('dismiss-install')?.addEventListener('click', () => {
    installDismissed = true;
    sessionStorage.setItem('po-install-dismissed', '1');
    renderTopBanners();
  });
}
window.addEventListener('online', renderTopBanners);
window.addEventListener('offline', renderTopBanners);

// ---------- Shell ----------
function renderShell() {
  app.innerHTML = `
    <aside id="nav-rail">
      <div class="brand">Power Organizer</div>
      <nav>${NAV.map(n => `<button class="nav-item" data-nav="${n.id}"><span>${n.icon}</span><span>${n.label}</span></button>`).join('')}</nav>
    </aside>
    <div style="flex:1;min-width:0;display:flex;flex-direction:column;">
      <div id="top-banners"></div>
      <main id="main"></main>
    </div>
    <div id="tab-bar">
      <div class="tabs">
        ${TAB_IDS.map(id => { const n = NAV.find(x => x.id === id); return `<button class="tab" data-nav="${n.id}"><span class="icon">${n.icon}</span><span>${n.label}</span></button>`; }).join('')}
        <button class="tab" id="more-tab-btn"><span class="icon">⋯</span><span>More</span></button>
      </div>
    </div>
    <div class="modal-backdrop" id="more-menu-backdrop" style="display:none;">
      <div class="modal-sheet">
        <div class="sheet" style="padding:16px;">
          <h3 style="margin:0 0 4px;">More</h3>
          ${MORE_IDS.map(id => { const n = NAV.find(x => x.id === id); return `<button class="nav-item" data-nav="${n.id}" style="width:100%;text-align:left;"><span>${n.icon}</span><span>${n.label}</span></button>`; }).join('')}
          <button class="btn" id="close-more-menu" style="margin-top:8px;">Close</button>
        </div>
      </div>
    </div>
  `;
  app.querySelectorAll('[data-nav]').forEach(btn => btn.addEventListener('click', () => {
    location.hash = `#/${btn.dataset.nav}`;
    moreMenuOpen = false;
    const backdrop = document.getElementById('more-menu-backdrop');
    if (backdrop) backdrop.style.display = 'none';
  }));
  document.getElementById('more-tab-btn')?.addEventListener('click', () => {
    moreMenuOpen = true;
    document.getElementById('more-menu-backdrop').style.display = 'flex';
  });
  document.getElementById('close-more-menu')?.addEventListener('click', () => {
    moreMenuOpen = false;
    document.getElementById('more-menu-backdrop').style.display = 'none';
  });
  document.getElementById('more-menu-backdrop')?.addEventListener('click', (e) => {
    if (e.target.id === 'more-menu-backdrop') {
      moreMenuOpen = false;
      e.target.style.display = 'none';
    }
  });
  renderTopBanners();
}
function highlightNav(page) {
  document.querySelectorAll('[data-nav]').forEach(btn => btn.classList.toggle('active', btn.dataset.nav === page));
  document.getElementById('more-tab-btn')?.classList.toggle('active', MORE_IDS.includes(page));
}

// ---------- Router ----------
async function render() {
  const { page, param, param2 } = currentRoute();
  highlightNav(page);
  const main = document.getElementById('main');
  let html;
  if (page === 'calendar' && param === 'day' && param2) {
    html = await screenCalendarDay(param2);
  } else if (page === 'goals' && param) {
    html = await screenGoalDetail(param);
  } else if (page === 'tasks' && param) {
    html = await screenAddEditTask(param);
  } else {
    const screens = {
      dashboard: screenDashboard, tasks: screenTasks, calendar: screenCalendar,
      planner: screenPlanner, focus: screenFocus, habits: screenHabits, goals: screenGoals, settings: screenSettings
    };
    const fn = screens[page] || screenDashboard;
    html = await fn(param, param2);
  }
  main.innerHTML = html;
  wireScreen(page, param, param2);
}
window.addEventListener('hashchange', render);

// ---------- Keyboard shortcuts ----------
document.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  if (typing) return;
  if (e.key === 'n') { e.preventDefault(); location.hash = '#/tasks/new'; }
  if (e.key === '/') {
    e.preventDefault();
    if (currentRoute().page !== 'tasks') location.hash = '#/tasks';
    setTimeout(() => document.getElementById('task-search')?.focus(), 50);
  }
});

// ---------- Dashboard ----------
async function screenDashboard() {
  const [tasks, timeBlocks, habits] = await Promise.all([db.tasks.toArray(), db.timeBlocks.toArray(), db.habits.toArray()]);
  const plan = L.smartPlan(tasks);
  const score = L.productivityScore(tasks);
  const rate7 = L.completionRateLast7Days(tasks);
  const focusMin = L.focusMinutesCompleted(timeBlocks);
  const series = L.completionSeries(tasks, 7);
  const activeStreaks = habits.filter(h => h.currentStreak > 0).sort((a, b) => b.currentStreak - a.currentStreak).slice(0, 3);
  const overdueCount = tasks.filter(t => !t.isCompleted && t.dueDate != null && t.dueDate < Date.now()).length;

  return `
    <div class="page-header"><h1>Dashboard</h1><span class="page-sub">${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span></div>
    <div class="stat-row">
      <div class="stat"><div class="num">${score}%</div><div class="label">Productivity score</div></div>
      <div class="stat"><div class="num">${rate7}%</div><div class="label">Completed, last 7 days</div></div>
      <div class="stat"><div class="num">${focusMin}</div><div class="label">Focus minutes logged</div></div>
    </div>
    <div class="section-title">7-day completion trend</div>
    ${barChart(series)}
    ${activeStreaks.length ? `<div class="section-title">Active streaks</div><div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:8px;">${activeStreaks.map(h => `<span class="streak-badge">🔥 ${escapeHtml(h.name)} · ${h.currentStreak}d</span>`).join('')}</div>` : ''}
    <div class="section-title">Smart plan — today's 7</div>
    ${plan.length ? `<div class="ledger">${plan.map(t => taskRow(t)).join('')}</div>` : emptyState('Nothing urgent', 'Add a task and Smart Plan will rank it by priority, due date, and overdue status.')}
    <div class="section-title">✨ AI assistant</div>
    <div class="ai-panel" id="ai-panel" data-overdue="${overdueCount}" data-total="${tasks.length}" data-done7="${series.reduce((s, d) => s + d.value, 0)}" data-rate7="${rate7}" data-score="${score}" data-focusmin="${focusMin}" data-streaks="${activeStreaks.length}">
      ${hasApiKey() ? `
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
          <button type="button" class="btn" id="ai-insights-btn">Weekly insights</button>
          <button type="button" class="btn" id="ai-focus-btn">What should I focus on?</button>
        </div>
        <div id="ai-output"></div>
      ` : `<p style="color:var(--ink-soft);font-size:0.85rem;">Add your Gemini API key in <a href="#/settings">Settings</a> to turn this on.</p>`}
    </div>
  `;
}

function wireDashboardAi() {
  const panel = document.getElementById('ai-panel');
  if (!panel) return;
  const output = document.getElementById('ai-output');

  document.getElementById('ai-insights-btn')?.addEventListener('click', async () => {
    output.innerHTML = `<p class="ai-loading">Thinking…</p>`;
    const stats = {
      productivityScore: Number(panel.dataset.score),
      completionRateLast7Days: Number(panel.dataset.rate7),
      focusMinutesLogged: Number(panel.dataset.focusmin),
      tasksCompletedLast7Days: Number(panel.dataset.done7),
      totalTasks: Number(panel.dataset.total),
      overdueTasks: Number(panel.dataset.overdue),
      activeHabitStreaks: Number(panel.dataset.streaks)
    };
    const result = await aiWeeklyInsights(stats);
    output.innerHTML = result.ok
      ? `<p class="ai-response">${escapeHtml(result.text)}</p>`
      : `<p class="ai-error">${escapeHtml(result.error)}</p>`;
  });

  document.getElementById('ai-focus-btn')?.addEventListener('click', async () => {
    output.innerHTML = `<p class="ai-loading">Thinking…</p>`;
    const [tasks, deps] = await Promise.all([db.tasks.toArray(), db.taskDependencies.toArray()]);
    const open = tasks.filter(t => !t.isCompleted).map(t => ({
      title: t.title,
      priority: t.priority,
      dueDate: t.dueDate != null ? new Date(t.dueDate).toISOString() : null,
      estimatedMinutes: t.estimatedMinutes,
      isBlocked: L.isBlocked(t, deps, tasks)
    }));
    if (!open.length) { output.innerHTML = `<p class="ai-response">No open tasks — you're all caught up!</p>`; return; }
    const result = await aiFocusSuggestion(open);
    output.innerHTML = result.ok
      ? `<p class="ai-response"><strong>${escapeHtml(result.taskTitle)}</strong> — ${escapeHtml(result.reason)}</p>`
      : `<p class="ai-error">${escapeHtml(result.error)}</p>`;
  });
}

// ---------- Tasks ----------
let taskUiState = { filter: 'ALL', sort: 'DUE_DATE', search: '', category: 'All categories', project: 'All projects' };

async function screenTasks() {
  const [tasks, deps] = await Promise.all([db.tasks.toArray(), db.taskDependencies.toArray()]);
  const subtaskCounts = await subtaskProgressMap(tasks.map(t => t.id));
  const list = L.filterTasks(tasks, taskUiState);
  const filters = ['ALL', 'ACTIVE', 'TODAY', 'UPCOMING', 'OVERDUE', 'COMPLETED'];
  const categories = ['All categories', ...new Set(tasks.map(t => t.category).filter(Boolean))];
  const projects = ['All projects', ...new Set(tasks.map(t => t.project).filter(Boolean))];

  return `
    <div class="page-header"><h1>Tasks</h1></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
      <div class="field" style="max-width:280px;flex:1;"><input type="text" id="task-search" placeholder="Search tasks… (press / anywhere)" value="${escapeAttr(taskUiState.search)}" /></div>
      <select id="filter-category" style="border:1px solid var(--hairline);border-radius:8px;padding:8px;">${categories.map(c => `<option ${taskUiState.category === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}</select>
      <select id="filter-project" style="border:1px solid var(--hairline);border-radius:8px;padding:8px;">${projects.map(p => `<option ${taskUiState.project === p ? 'selected' : ''}>${escapeHtml(p)}</option>`).join('')}</select>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px;">
      ${filters.map(f => `<button class="btn" data-filter="${f}" style="${taskUiState.filter === f ? 'background:var(--teal);color:white;border-color:var(--teal);' : ''}">${f.replace('_', ' ')}</button>`).join('')}
    </div>
    ${list.length ? `<div class="ledger">${list.map(t => taskRow(t, L.isBlocked(t, deps, tasks), subtaskCounts[t.id])).join('')}</div>` : emptyState('No tasks here', 'Try a different filter, or add your first task with the + button (or press n).')}
    <button class="fab" id="add-task-fab" aria-label="Add task">+</button>
  `;
}

async function subtaskProgressMap(taskIds) {
  const all = await db.subtasks.where('taskId').anyOf(taskIds.length ? taskIds : [-1]).toArray();
  const map = {};
  all.forEach(s => { const m = (map[s.taskId] ||= { done: 0, total: 0 }); m.total++; if (s.isCompleted) m.done++; });
  return map;
}

function taskRow(t, blocked = false, subtaskInfo = null) {
  const overdue = t.dueDate != null && t.dueDate < Date.now() && !t.isCompleted;
  return `
    <div class="ledger-row" data-task-row="${t.id}">
      <div class="checkbox ${t.isCompleted ? 'done' : ''} ${blocked && !t.isCompleted ? '' : ''}" data-toggle-task="${t.id}" title="${blocked && !t.isCompleted ? 'Blocked by an incomplete dependency' : ''}">${t.isCompleted ? '✓' : ''}</div>
      <div class="row-body" data-open-task="${t.id}">
        <div class="row-title ${t.isCompleted ? 'done' : ''}">${escapeHtml(t.title)}</div>
        <div class="row-meta">
          ${t.dueDate != null ? `<span>${fmtDate(t.dueDate)}</span>` : ''}
          <span class="tag priority-${t.priority.toLowerCase()}">${t.priority}</span>
          ${overdue ? '<span class="tag overdue">Overdue</span>' : ''}
          ${blocked ? '<span class="tag blocked">Blocked</span>' : ''}
          ${subtaskInfo ? `<span>${subtaskInfo.done}/${subtaskInfo.total} subtasks</span>` : ''}
          ${t.category && t.category !== 'General' ? `<span>${escapeHtml(t.category)}</span>` : ''}
        </div>
      </div>
      ${!t.isCompleted ? `<button type="button" class="icon-btn" data-quick-schedule="${t.id}" title="Schedule in Planner">🕒</button>` : ''}
    </div>
  `;
}

// ---------- Add / Edit Task ----------
async function screenAddEditTask(param) {
  const isEdit = param && param !== 'new';
  const id = isEdit ? Number(param) : null;
  const task = isEdit ? await db.tasks.get(id) : newTask();
  const [goals, allTasks, subtasks, myDeps, linkedBlocks] = await Promise.all([
    db.goals.toArray(),
    db.tasks.toArray(),
    isEdit ? db.subtasks.where('taskId').equals(id).toArray() : [],
    isEdit ? db.taskDependencies.where('taskId').equals(id).toArray() : [],
    isEdit ? db.timeBlocks.where('taskId').equals(id).toArray() : []
  ]);
  linkedBlocks.sort((a, b) => a.startAt - b.startAt);
  const dependsOnIds = new Set(myDeps.map(d => d.dependsOnTaskId));
  const candidateDeps = allTasks.filter(t => t.id !== id && !t.isCompleted);

  return `
    <div class="page-header"><h1>${isEdit ? 'Edit task' : 'New task'}</h1></div>
    <form class="sheet" id="task-form">
      <div class="field">
        <label>Quick capture (optional — press Enter to parse, or use ✨ AI)</label>
        <div style="display:flex;gap:8px;">
          <input type="text" id="nl-input" style="flex:1;" placeholder="e.g. &quot;call the bank asap&quot; or &quot;quick email to team&quot;" />
          <button type="button" class="btn" id="ai-quickadd-btn" title="Parse with AI">✨ AI</button>
        </div>
        <p id="ai-quickadd-status" class="ai-loading" style="display:none;"></p>
      </div>
      <div class="field"><label>Title</label><input type="text" id="f-title" required value="${escapeAttr(task.title)}" /></div>
      <div class="field"><label>Description</label><textarea id="f-desc">${escapeHtml(task.description)}</textarea></div>
      <div class="field-row">
        <div class="field"><label>Category</label><input type="text" id="f-category" value="${escapeAttr(task.category)}" /></div>
        <div class="field"><label>Project</label><input type="text" id="f-project" value="${escapeAttr(task.project)}" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Priority</label><select id="f-priority">${Object.values(Priority).map(p => `<option value="${p}" ${task.priority === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
        <div class="field"><label>Recurrence</label><select id="f-recurrence">${Object.values(Recurrence).map(r => `<option value="${r}" ${task.recurrence === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Due date</label><input type="datetime-local" id="f-due" value="${fmtDateTimeLocal(task.dueDate)}" /></div>
        <div class="field"><label>Remind me at</label><input type="datetime-local" id="f-reminder" value="${fmtDateTimeLocal(task.reminderAt)}" /></div>
      </div>
      <div class="field"><label>Estimated minutes</label><input type="number" id="f-estimate" min="5" step="5" value="${task.estimatedMinutes}" /></div>
      <div class="field">
        <label>Goal (optional)</label>
        <select id="f-goal">
          <option value="">No goal</option>
          ${goals.map(g => `<option value="${g.id}" ${task.goalId === g.id ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join('')}
        </select>
      </div>

      ${isEdit ? `
        <div class="field">
          <label>Scheduled time blocks</label>
          ${linkedBlocks.length ? linkedBlocks.map(b => `
            <div class="timeblock" data-linked-block-row="${b.id}">
              <div class="time">${fmtDate(b.startAt)} · ${new Date(b.startAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</div>
              <div class="row-body">
                <div class="checkbox ${b.isCompleted ? 'done' : ''}" data-toggle-block="${b.id}">${b.isCompleted ? '✓' : ''}</div>
                <div class="row-title ${b.isCompleted ? 'done' : ''}">${escapeHtml(b.title)}</div>
              </div>
              <button type="button" class="icon-btn" data-unschedule-block="${b.id}" title="Remove from Planner">✕</button>
            </div>
          `).join('') : '<div style="padding:6px;color:var(--ink-soft);font-size:0.85rem;">Not scheduled yet.</div>'}
          <button type="button" class="btn" id="schedule-task-btn" style="margin-top:8px;">+ Schedule a time block</button>
        </div>
        ${taskScheduleModal ? taskScheduleModalHtml(task) : ''}
        <div class="field">
          <label>Depends on (blocks this task until they're done)</label>
          <div class="picker-list">
            ${candidateDeps.length ? candidateDeps.map(t => `
              <label class="picker-row"><input type="checkbox" class="dep-check" value="${t.id}" ${dependsOnIds.has(t.id) ? 'checked' : ''} /> ${escapeHtml(t.title)}</label>
            `).join('') : '<div style="padding:6px;color:var(--ink-soft);font-size:0.85rem;">No other open tasks to depend on.</div>'}
          </div>
        </div>
        <div class="field">
          <label>Subtasks</label>
          <div id="subtask-list">${subtasks.map(subtaskRowHtml).join('')}</div>
          <div style="display:flex;gap:8px;margin-top:6px;">
            <input type="text" id="new-subtask-input" placeholder="Add a subtask…" style="flex:1;padding:8px 10px;border:1px solid var(--hairline);border-radius:8px;" />
            <button type="button" class="btn" id="add-subtask-btn">Add</button>
          </div>
          <button type="button" class="btn" id="ai-breakdown-btn" style="margin-top:8px;">✨ Break down with AI</button>
          <p id="ai-breakdown-status" class="ai-loading" style="display:none;"></p>
        </div>
      ` : `<div class="field"><p style="color:var(--ink-soft);font-size:0.85rem;">Save this task first to add subtasks or dependencies.</p></div>`}

      <div style="display:flex;gap:10px;margin-top:8px;">
        <button type="submit" class="btn primary">${isEdit ? 'Save changes' : 'Add task'}</button>
        ${isEdit ? `<button type="button" class="btn" id="delete-task">Delete</button>` : ''}
      </div>
    </form>
  `;
}
function taskScheduleModalHtml(task) {
  const now = new Date();
  const defaultDate = task.dueDate != null ? L.dayKey(task.dueDate) : L.dayKey(now.getTime());
  const defaultHour = task.dueDate != null ? new Date(task.dueDate).getHours() : Math.min(now.getHours() + 1, 23);
  const startDefault = `${String(defaultHour).padStart(2, '0')}:00`;
  return `
    <div class="modal-backdrop" id="task-schedule-backdrop">
      <div class="modal-sheet">
        <h3 style="margin-bottom:14px;">Schedule "${escapeHtml(task.title || 'this task')}"</h3>
        <form id="task-schedule-form" class="sheet">
          <div class="field"><label>Date</label><input type="date" id="ts-date" value="${defaultDate}" required /></div>
          <div class="field"><label>Start time</label><input type="time" id="ts-start" value="${startDefault}" required /></div>
          <div class="field"><label>Duration (minutes)</label><input type="number" id="ts-duration" min="5" step="5" value="${task.estimatedMinutes || 30}" /></div>
          <div style="display:flex;gap:10px;margin-top:6px;">
            <button type="submit" class="btn primary">Add to Planner</button>
            <button type="button" class="btn" id="cancel-task-schedule">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function subtaskRowHtml(s) {
  return `<div class="subtask-row" data-subtask-id="${s.id}">
    <div class="checkbox ${s.isCompleted ? 'done' : ''}" data-toggle-subtask="${s.id}" style="width:17px;height:17px;">${s.isCompleted ? '✓' : ''}</div>
    <span class="title ${s.isCompleted ? 'done' : ''}">${escapeHtml(s.title)}</span>
    <button type="button" class="icon-btn" data-delete-subtask="${s.id}">✕</button>
  </div>`;
}

// ---------- Calendar ----------
async function screenCalendar(param) {
  const [y, m] = (param || '').split('-').map(Number);
  const now = new Date();
  const year = y || now.getFullYear();
  const month = m != null ? m : now.getMonth();
  const [tasks, blocks] = await Promise.all([db.tasks.toArray(), db.timeBlocks.toArray()]);
  const byDay = {};
  tasks.forEach(t => { if (t.dueDate != null) { const k = L.dayKey(t.dueDate); (byDay[k] ||= []).push({ title: t.title, kind: 'task' }); } });
  blocks.forEach(b => { if (b.startAt != null) { const k = L.dayKey(b.startAt); (byDay[k] ||= []).push({ title: b.title, kind: 'block' }); } });

  const first = new Date(year, month, 1);
  const startOffset = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const prev = month === 0 ? `${year - 1}-11` : `${year}-${month - 1}`;
  const next = month === 11 ? `${year + 1}-0` : `${year}-${month + 1}`;
  const monthLabel = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return `
    <div class="page-header">
      <h1>Calendar</h1>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="btn" data-cal-nav="${prev}">‹</button><span class="page-sub">${monthLabel}</span><button class="btn" data-cal-nav="${next}">›</button>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:var(--hairline);border:1px solid var(--hairline);">
      ${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(d => `<div style="background:var(--paper);padding:6px;font-size:0.72rem;color:var(--ink-soft);text-align:center;">${d}</div>`).join('')}
      ${cells.map(d => {
        if (!d) return `<div style="background:var(--surface);min-height:64px;"></div>`;
        const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const items = byDay[key] || [];
        const isToday = key === L.dayKey(Date.now());
        return `<div style="background:var(--surface);min-height:64px;padding:5px;cursor:pointer;${isToday ? 'box-shadow:inset 0 0 0 1.5px var(--teal);' : ''}" data-cal-day="${key}">
          <div style="font-size:0.78rem;font-weight:${isToday ? 700 : 400};">${d}</div>
          ${items.slice(0, 2).map(t => `<div style="font-size:0.66rem;color:var(--ink-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${t.kind === 'block' ? '🕒 ' : ''}${escapeHtml(t.title)}</div>`).join('')}
          ${items.length > 2 ? `<div style="font-size:0.62rem;color:var(--ink-soft);">+${items.length - 2} more</div>` : ''}
        </div>`;
      }).join('')}
    </div>
  `;
}

async function screenCalendarDay(param) {
  const key = param;
  const [tasks, blocks] = await Promise.all([db.tasks.toArray(), db.timeBlocks.toArray()]);
  const dayTasks = tasks.filter(t => t.dueDate != null && L.dayKey(t.dueDate) === key);
  const dayBlocks = blocks.filter(b => L.dayKey(b.startAt) === key).sort((a, b) => a.startAt - b.startAt);
  const label = new Date(key + 'T00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  return `
    <div class="page-header"><h1>${label}</h1><button class="btn" data-back-to-cal="1">← Month view</button></div>
    <div class="section-title">Due today</div>
    ${dayTasks.length ? `<div class="ledger">${dayTasks.map(t => taskRow(t)).join('')}</div>` : emptyState('Nothing due', 'No tasks are due on this day.')}
    <div class="section-title">Scheduled</div>
    ${dayBlocks.length ? dayBlocks.map(b => `<div class="timeblock"><div class="time">${new Date(b.startAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</div><div class="row-body"><div class="row-title ${b.isCompleted ? 'done' : ''}">${escapeHtml(b.title)}</div></div></div>`).join('') : emptyState('Nothing scheduled', 'No focus blocks on this day.')}
  `;
}

// ---------- Planner (hourly grid) ----------
let plannerDate = L.dayKey(Date.now());
const PLANNER_START_HOUR = 6, PLANNER_END_HOUR = 23;
let plannerModal = null; // { hour, taskId?, title? } when open, null when closed
let taskScheduleModal = false; // toggled on the task edit screen's "Schedule a time block" button

async function screenPlanner() {
  const [allBlocks, allTasks] = await Promise.all([db.timeBlocks.toArray(), db.tasks.toArray()]);
  const blocks = allBlocks.filter(b => L.dayKey(b.startAt) === plannerDate);
  const tasksById = {}; allTasks.forEach(t => { tasksById[t.id] = t; });
  const openTasks = allTasks.filter(t => !t.isCompleted).sort((a, b) => (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity));
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - d.getDay() + i); return d; });
  const hours = [];
  for (let h = PLANNER_START_HOUR; h <= PLANNER_END_HOUR; h++) hours.push(h);

  return `
    <div class="page-header"><h1>Planner</h1></div>
    <div class="day-strip">
      ${days.map(d => { const key = L.dayKey(d.getTime()); return `<div class="day-chip ${key === plannerDate ? 'active' : ''}" data-planner-day="${key}"><div class="dow">${d.toLocaleDateString(undefined, { weekday: 'short' })}</div><div class="dom">${d.getDate()}</div></div>`; }).join('')}
    </div>
    <div class="hour-grid">
      ${hours.map(h => {
        const hourBlocks = blocks.filter(b => new Date(b.startAt).getHours() === h);
        const label = new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' });
        return `<div class="hour-row">
          <div class="hour-label">${label}</div>
          <div class="hour-slot" data-add-at-hour="${h}">
            ${hourBlocks.map(b => `<div class="hour-block ${b.isCompleted ? 'done' : ''}" data-toggle-block="${b.id}">${b.taskId && tasksById[b.taskId] ? '🔗 ' : ''}${escapeHtml(b.title)} · ${new Date(b.startAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}–${new Date(b.endAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</div>`).join('')}
          </div>
        </div>`;
      }).join('')}
    </div>
    <button class="fab" id="add-block-fab" aria-label="Add time block">+</button>
    ${plannerModal ? plannerModalHtml(openTasks) : ''}
  `;
}

function plannerModalHtml(openTasks = []) {
  const startDefault = `${String(plannerModal.hour).padStart(2, '0')}:00`;
  const endDefault = `${String(Math.min(plannerModal.hour + 1, 23)).padStart(2, '0')}:00`;
  const presetTaskId = plannerModal.taskId ?? '';
  return `
    <div class="modal-backdrop" id="planner-modal-backdrop">
      <div class="modal-sheet">
        <h3 style="margin-bottom:14px;">Add time block</h3>
        <form id="planner-block-form" class="sheet">
          <div class="field">
            <label>Link to task (optional)</label>
            <select id="pb-task">
              <option value="">No linked task</option>
              ${openTasks.map(t => `<option value="${t.id}" ${String(t.id) === String(presetTaskId) ? 'selected' : ''}>${escapeHtml(t.title)}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>Title</label><input type="text" id="pb-title" placeholder="Deep work, gym, call with team…" value="${plannerModal.title ? escapeAttr(plannerModal.title) : ''}" required /></div>
          <div class="field"><label>Start time</label><input type="time" id="pb-start" value="${startDefault}" required /></div>
          <div class="field">
            <label>Length</label>
            <div style="display:flex;gap:6px;margin-bottom:8px;">
              <button type="button" class="btn" id="mode-endtime" style="flex:1;">Until a time</button>
              <button type="button" class="btn" id="mode-duration" style="flex:1;background:var(--teal);color:white;border-color:var(--teal);">For a duration</button>
            </div>
            <div id="endtime-fields" style="display:none;">
              <input type="time" id="pb-end" value="${endDefault}" />
            </div>
            <div id="duration-fields" class="field-row">
              <div class="field"><label>Hours</label><input type="number" id="pb-hours" min="0" value="1" /></div>
              <div class="field"><label>Minutes</label><input type="number" id="pb-minutes" min="0" max="59" step="5" value="0" /></div>
            </div>
          </div>
          <div style="display:flex;gap:10px;margin-top:6px;">
            <button type="submit" class="btn primary">Add block</button>
            <button type="button" class="btn" id="cancel-planner-modal">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `;
}


// ---------- Focus (real countdown timer) ----------
const focusTimer = { running: false, remaining: 0, total: 0, title: '', intervalId: null, linkedBlockStart: null };

function fmtClock(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

async function screenFocus() {
  const blocks = (await db.timeBlocks.toArray()).sort((a, b) => b.startAt - a.startAt).slice(0, 15);
  const totalMin = L.focusMinutesCompleted(await db.timeBlocks.toArray());
  return `
    <div class="page-header"><h1>Focus</h1></div>
    <div class="stat-row"><div class="stat"><div class="num">${totalMin}</div><div class="label">Minutes completed</div></div></div>

    ${focusTimer.running || focusTimer.remaining > 0 ? `
      <div class="timer-display" id="timer-display">${fmtClock(focusTimer.remaining)}</div>
      <div class="page-sub" style="text-align:center;margin-bottom:6px;">${escapeHtml(focusTimer.title)}</div>
      <div class="timer-controls">
        ${focusTimer.running ? `<button class="btn" id="pause-timer">Pause</button>` : `<button class="btn primary" id="resume-timer">Resume</button>`}
        <button class="btn" id="reset-timer">Reset</button>
      </div>
    ` : `
      <form id="quick-focus-form" class="sheet" style="margin-bottom:24px;">
        <div class="field-row">
          <div class="field"><label>What are you focusing on?</label><input type="text" id="focus-title" placeholder="Deep work session" required /></div>
          <div class="field" style="max-width:120px;"><label>Minutes</label><input type="number" id="focus-minutes" value="25" min="5" step="5" /></div>
        </div>
        <button class="btn primary" type="submit" style="align-self:flex-start;">Start focus timer</button>
      </form>
    `}

    <div class="section-title">Recent sessions</div>
    ${blocks.length ? `<div class="ledger">${blocks.map(b => `
      <div class="ledger-row">
        <div class="checkbox ${b.isCompleted ? 'done' : ''}" data-toggle-block="${b.id}">${b.isCompleted ? '✓' : ''}</div>
        <div class="row-body"><div class="row-title ${b.isCompleted ? 'done' : ''}">${escapeHtml(b.title)}</div><div class="row-meta"><span>${fmtDate(b.startAt)}</span><span>${Math.round((b.endAt - b.startAt) / 60000)} min</span></div></div>
      </div>`).join('')}</div>` : emptyState('No focus sessions yet', 'Start one above to begin tracking focused time.')}
  `;
}

function tickTimer() {
  focusTimer.remaining--;
  const el = document.getElementById('timer-display');
  if (el) el.textContent = fmtClock(focusTimer.remaining);
  if (focusTimer.remaining <= 0) finishTimer();
}
async function finishTimer() {
  clearInterval(focusTimer.intervalId);
  focusTimer.running = false;
  const startAt = focusTimer.linkedBlockStart || Date.now() - focusTimer.total * 1000;
  await db.timeBlocks.add(newTimeBlock({ title: focusTimer.title, startAt, endAt: Date.now(), isCompleted: true }));
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('Focus session complete', { body: focusTimer.title, icon: './icons/icon-192.png' });
  }
  toast('Focus session complete — nice work');
  focusTimer.remaining = 0; focusTimer.total = 0; focusTimer.title = '';
  if (currentRoute().page === 'focus') render();
}

// ---------- Habits ----------
async function screenHabits() {
  const [habits, historyRows] = await Promise.all([db.habits.toArray(), db.habitHistory.toArray()]);
  const historyByHabit = {};
  historyRows.forEach(r => { (historyByHabit[r.habitId] ||= new Set()).add(r.dayKey); });

  return `
    <div class="page-header"><h1>Habits</h1></div>
    <form id="add-habit-form" style="display:flex;gap:8px;margin-bottom:18px;max-width:420px;">
      <input type="text" id="new-habit-name" placeholder="New habit, e.g. Read 10 pages" style="flex:1;padding:9px 11px;border:1px solid var(--hairline);border-radius:8px;" required />
      <button class="btn primary" type="submit">Add</button>
    </form>
    ${habits.length ? `<div class="ledger">${habits.map(h => {
      const todaySet = historyByHabit[h.id] || new Set();
      const doneToday = todaySet.has(L.dayKey(Date.now()));
      return `
      <div class="ledger-row" style="align-items:flex-start;">
        <div class="checkbox ${doneToday ? 'done' : ''}" data-toggle-habit="${h.id}">${doneToday ? '✓' : ''}</div>
        <div class="row-body">
          <div class="row-title">${escapeHtml(h.name)}</div>
          <div class="row-meta"><span class="streak-badge">🔥 ${h.currentStreak} day streak</span><span>Best: ${h.bestStreak}</span></div>
          ${habitHeatmapHtml(h.id, todaySet)}
        </div>
        <button class="btn" data-delete-habit="${h.id}" style="padding:5px 10px;">✕</button>
      </div>
    `; }).join('')}</div>` : emptyState('No habits yet', 'Add one above — check it off daily to build a streak.')}
  `;
}

function habitHeatmapHtml(habitId, doneSet) {
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    const key = L.dayKey(d.getTime());
    days.push({ key, label: d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }), done: doneSet.has(key), isToday: i === 0 });
  }
  return `<div class="habit-heatmap">${days.map(d => `<div class="heat-dot ${d.done ? 'done' : ''} ${d.isToday ? 'today' : ''}" data-toggle-habit-day="${habitId}|${d.key}" title="${d.label}${d.done ? ' — done' : ''}"></div>`).join('')}</div>`;
}

// ---------- Goals ----------
async function screenGoals() {
  const [goals, tasks] = await Promise.all([db.goals.toArray(), db.tasks.toArray()]);
  return `
    <div class="page-header"><h1>Goals</h1></div>
    <form id="add-goal-form" style="display:flex;gap:8px;margin-bottom:18px;max-width:420px;">
      <input type="text" id="new-goal-name" placeholder="New goal, e.g. Ship v1" style="flex:1;padding:9px 11px;border:1px solid var(--hairline);border-radius:8px;" required />
      <button class="btn primary" type="submit">Add</button>
    </form>
    ${goals.length ? goals.map(g => {
      const prog = L.goalProgress(g, tasks);
      return `<div class="ledger-row" data-open-goal="${g.id}" style="border-bottom:1px solid var(--hairline);cursor:pointer;flex-direction:column;align-items:stretch;">
        <div style="display:flex;align-items:center;gap:10px;">
          <div class="checkbox ${g.isCompleted ? 'done' : ''}" data-toggle-goal="${g.id}">${g.isCompleted ? '✓' : ''}</div>
          <div class="row-body"><div class="row-title ${g.isCompleted ? 'done' : ''}">${escapeHtml(g.name)}</div><div class="row-meta">${prog.total ? `<span>${prog.done}/${prog.total} tasks · ${prog.pct}%</span>` : '<span>No linked tasks yet</span>'}</div></div>
          <button class="icon-btn" data-delete-goal="${g.id}">✕</button>
        </div>
        <div class="progress-bar" style="margin-left:30px;"><div style="width:${prog.pct}%;"></div></div>
      </div>`;
    }).join('') : emptyState('No goals yet', 'Goals group related tasks so you can see progress at a glance. Link a task to a goal from its edit screen.')}
  `;
}

async function screenGoalDetail(param) {
  const id = Number(param);
  const [goal, tasks] = await Promise.all([db.goals.get(id), db.tasks.toArray()]);
  if (!goal) return emptyState('Goal not found', 'It may have been deleted.');
  const linked = tasks.filter(t => t.goalId === id);
  const prog = L.goalProgress(goal, tasks);
  return `
    <div class="page-header"><h1>${escapeHtml(goal.name)}</h1><button class="btn" data-back-to-goals="1">← Goals</button></div>
    <div class="goal-hero"><div class="page-sub">${prog.done} of ${prog.total} linked tasks complete</div><div class="progress-bar"><div style="width:${prog.pct}%;"></div></div></div>
    <div class="section-title">Linked tasks</div>
    ${linked.length ? `<div class="ledger">${linked.map(t => taskRow(t)).join('')}</div>` : emptyState('No tasks linked yet', 'Open a task and set its Goal field to link it here.')}
  `;
}

// ---------- Settings ----------
async function screenSettings() {
  const perm = ('Notification' in window) ? Notification.permission : 'unsupported';
  const theme = document.documentElement.getAttribute('data-theme');
  return `
    <div class="page-header"><h1>Settings</h1></div>
    <div class="settings-group">
      <h3>Appearance</h3>
      <div class="settings-row"><div>Dark mode</div><label class="switch"><input type="checkbox" id="dark-toggle" ${theme === 'dark' ? 'checked' : ''} /><span class="track"></span></label></div>
    </div>
    <div class="settings-group">
      <h3>App</h3>
      <div class="settings-row"><div><div>Install as an app</div><div class="desc">${isStandalone() ? 'Already running as an installed app.' : deferredInstallPrompt ? 'Add to your home screen for the full experience.' : 'On iPhone: Share → Add to Home Screen. On Android: use the banner or browser menu.'}</div></div>${deferredInstallPrompt && !isStandalone() ? `<button class="btn" id="install-btn">Install</button>` : ''}</div>
    </div>
    <div class="settings-group">
      <h3>Notifications</h3>
      <div class="settings-row"><div><div>Reminder notifications</div><div class="desc">Current permission: ${perm}. Reminders are delivered by a small push server that only receives a device ID and a time — never your task text. Best-effort, not guaranteed.</div></div><button class="btn" id="enable-push">Enable</button></div>
    </div>
    <div class="settings-group">
      <h3>Data</h3>
      <div class="settings-row"><div><div>Export backup</div><div class="desc">Download all tasks, goals, and habits as JSON.</div></div><button class="btn" id="export-json">Export</button></div>
      <div class="settings-row"><div><div>Restore backup</div><div class="desc">Replace current data with a previously exported JSON file.</div></div><label class="btn" style="cursor:pointer;">Import<input type="file" id="import-json" accept="application/json" style="display:none;" /></label></div>
    </div>
    <div class="settings-group">
      <h3>✨ AI features</h3>
      <div class="settings-row">
        <div style="flex:1;">
          <div>Google Gemini API key</div>
          <div class="desc">Your own key — used only for AI quick-add, subtask breakdown, weekly insights, and focus suggestions. Stored only in this browser; requests go directly from your device to Google. Gemini's free tier is ongoing (not a one-time trial) and covers light daily use. Get a key at <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener">aistudio.google.com/app/apikey</a> — no credit card needed.</div>
        </div>
      </div>
      <div class="settings-row" style="gap:8px;">
        <input type="password" id="ai-key-input" placeholder="AIza..." value="${escapeAttr(getApiKey())}" style="flex:1;padding:8px 10px;border:1px solid var(--hairline);border-radius:8px;" />
        <button class="btn" id="save-ai-key">${getApiKey() ? 'Update' : 'Save'}</button>
        ${getApiKey() ? `<button class="btn" id="clear-ai-key">Remove</button>` : ''}
      </div>
      <div class="desc" style="margin-top:8px;">Weekly insights sends only aggregate numbers (scores, counts) — never task titles. Quick-add, AI breakdown, and focus suggestions send the task text you're working on to Google's API using your key. Google may use free-tier inputs/outputs to improve their models — see Gemini's terms if that matters to you.</div>
    </div>
    <div class="settings-group">
      <h3>Shortcuts</h3>
      <div class="desc"><code>n</code> new task · <code>/</code> jump to task search</div>
    </div>
    <div class="settings-group">
      <h3>About</h3>
      <div class="desc">Power Organizer — offline-first PWA rebuild of the original Android app. Data lives in this browser's IndexedDB.</div>
    </div>
  `;
}

// ---------- Event wiring ----------
function wireScreen(page, param, param2) {
  if (page === 'dashboard' || page === 'tasks') {
    document.querySelectorAll('[data-toggle-task]').forEach(el => el.addEventListener('click', (e) => { e.stopPropagation(); toggleTask(Number(el.dataset.toggleTask)); }));
    document.querySelectorAll('[data-open-task]').forEach(el => el.addEventListener('click', () => location.hash = `#/tasks/${el.dataset.openTask}`));
    document.querySelectorAll('[data-quick-schedule]').forEach(el => el.addEventListener('click', (e) => { e.stopPropagation(); quickSchedule(Number(el.dataset.quickSchedule)); }));
  }
  if (page === 'dashboard') wireDashboardAi();
  if (page === 'tasks') {
    document.getElementById('add-task-fab')?.addEventListener('click', () => location.hash = '#/tasks/new');
    document.getElementById('task-search')?.addEventListener('input', (e) => { taskUiState.search = e.target.value; render(); });
    document.getElementById('filter-category')?.addEventListener('change', (e) => { taskUiState.category = e.target.value; render(); });
    document.getElementById('filter-project')?.addEventListener('change', (e) => { taskUiState.project = e.target.value; render(); });
    document.querySelectorAll('[data-filter]').forEach(btn => btn.addEventListener('click', () => { taskUiState.filter = btn.dataset.filter; render(); }));
  }
  if (page === 'tasks' && param) wireTaskForm(param);

  if (page === 'calendar') {
    document.querySelectorAll('[data-cal-nav]').forEach(btn => btn.addEventListener('click', () => location.hash = `#/calendar/${btn.dataset.calNav}`));
    document.querySelectorAll('[data-cal-day]').forEach(el => el.addEventListener('click', () => location.hash = `#/calendar/day/${el.dataset.calDay}`));
  }
  if (page === 'calendar' && param === 'day') {
    document.querySelectorAll('[data-back-to-cal]').forEach(el => el.addEventListener('click', () => location.hash = '#/calendar'));
    document.querySelectorAll('[data-toggle-task]').forEach(el => el.addEventListener('click', (e) => { e.stopPropagation(); toggleTask(Number(el.dataset.toggleTask)); }));
    document.querySelectorAll('[data-open-task]').forEach(el => el.addEventListener('click', () => location.hash = `#/tasks/${el.dataset.openTask}`));
    document.querySelectorAll('[data-quick-schedule]').forEach(el => el.addEventListener('click', (e) => { e.stopPropagation(); quickSchedule(Number(el.dataset.quickSchedule)); }));
  }
  if (page === 'planner') {
    document.querySelectorAll('[data-planner-day]').forEach(el => el.addEventListener('click', () => { plannerDate = el.dataset.plannerDay; plannerModal = null; render(); }));
    document.querySelectorAll('[data-toggle-block]').forEach(el => el.addEventListener('click', (e) => { e.stopPropagation(); toggleBlock(Number(el.dataset.toggleBlock)); }));
    document.getElementById('add-block-fab')?.addEventListener('click', () => { plannerModal = { hour: new Date().getHours() }; render(); });
    document.querySelectorAll('[data-add-at-hour]').forEach(el => el.addEventListener('click', (e) => {
      if (e.target.closest('.hour-block')) return; // clicked an existing block, not empty space
      plannerModal = { hour: Number(el.dataset.addAtHour) };
      render();
    }));
    wirePlannerModal();
  }
  if (page === 'focus') {
    document.querySelectorAll('[data-toggle-block]').forEach(el => el.addEventListener('click', () => toggleBlock(Number(el.dataset.toggleBlock))));
    document.getElementById('quick-focus-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const title = document.getElementById('focus-title').value.trim();
      const minutes = Number(document.getElementById('focus-minutes').value) || 25;
      if (!title) return;
      focusTimer.title = title; focusTimer.total = minutes * 60; focusTimer.remaining = minutes * 60; focusTimer.running = true; focusTimer.linkedBlockStart = Date.now();
      clearInterval(focusTimer.intervalId);
      focusTimer.intervalId = setInterval(tickTimer, 1000);
      render();
    });
    document.getElementById('pause-timer')?.addEventListener('click', () => { focusTimer.running = false; clearInterval(focusTimer.intervalId); render(); });
    document.getElementById('resume-timer')?.addEventListener('click', () => { focusTimer.running = true; focusTimer.intervalId = setInterval(tickTimer, 1000); render(); });
    document.getElementById('reset-timer')?.addEventListener('click', () => { clearInterval(focusTimer.intervalId); focusTimer.running = false; focusTimer.remaining = 0; focusTimer.total = 0; render(); });
  }
  if (page === 'habits') {
    document.getElementById('add-habit-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('new-habit-name').value.trim();
      if (!name) return;
      await db.habits.add(newHabit({ name }));
      render();
    });
    document.querySelectorAll('[data-toggle-habit]').forEach(el => el.addEventListener('click', () => toggleHabitDay(Number(el.dataset.toggleHabit), L.dayKey(Date.now()))));
    document.querySelectorAll('[data-toggle-habit-day]').forEach(el => el.addEventListener('click', () => {
      const [habitId, dayKey] = el.dataset.toggleHabitDay.split('|');
      toggleHabitDay(Number(habitId), dayKey);
    }));
    document.querySelectorAll('[data-delete-habit]').forEach(el => el.addEventListener('click', async () => {
      const id = Number(el.dataset.deleteHabit);
      const record = await db.habits.get(id);
      const historyRecords = await db.habitHistory.where('habitId').equals(id).toArray();
      await db.habits.delete(id);
      await db.habitHistory.where('habitId').equals(id).delete();
      toastUndo('Habit deleted', async () => {
        const newId = await db.habits.add(record);
        if (historyRecords.length) await db.habitHistory.bulkAdd(historyRecords.map(r => ({ ...r, habitId: newId })));
        render();
      });
      render();
    }));
  }
  if (page === 'goals') {
    document.getElementById('add-goal-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('new-goal-name').value.trim();
      if (!name) return;
      await db.goals.add(newGoal({ name }));
      render();
    });
    document.querySelectorAll('[data-toggle-goal]').forEach(el => el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = Number(el.dataset.toggleGoal);
      const g = await db.goals.get(id);
      await db.goals.update(id, { isCompleted: !g.isCompleted });
      render();
    }));
    document.querySelectorAll('[data-delete-goal]').forEach(el => el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = Number(el.dataset.deleteGoal);
      const record = await db.goals.get(id);
      await db.goals.delete(id);
      toastUndo('Goal deleted', async () => { await db.goals.add(record); render(); });
      render();
    }));
    document.querySelectorAll('[data-open-goal]').forEach(el => el.addEventListener('click', () => location.hash = `#/goals/${el.dataset.openGoal}`));
  }
  if (page === 'goals' && param) {
    document.querySelectorAll('[data-back-to-goals]').forEach(el => el.addEventListener('click', () => location.hash = '#/goals'));
    document.querySelectorAll('[data-toggle-task]').forEach(el => el.addEventListener('click', (e) => { e.stopPropagation(); toggleTask(Number(el.dataset.toggleTask)); }));
    document.querySelectorAll('[data-open-task]').forEach(el => el.addEventListener('click', () => location.hash = `#/tasks/${el.dataset.openTask}`));
    document.querySelectorAll('[data-quick-schedule]').forEach(el => el.addEventListener('click', (e) => { e.stopPropagation(); quickSchedule(Number(el.dataset.quickSchedule)); }));
  }
  if (page === 'settings') {
    document.getElementById('dark-toggle')?.addEventListener('change', toggleTheme);
    document.getElementById('save-ai-key')?.addEventListener('click', () => {
      const val = document.getElementById('ai-key-input').value.trim();
      if (!val) { toast('Enter a key first'); return; }
      setApiKey(val);
      toast('API key saved');
      render();
    });
    document.getElementById('clear-ai-key')?.addEventListener('click', () => {
      setApiKey('');
      toast('API key removed');
      render();
    });
    document.getElementById('install-btn')?.addEventListener('click', async () => { if (deferredInstallPrompt) { deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt = null; render(); } });
    document.getElementById('enable-push')?.addEventListener('click', async () => {
      const perm = await ensurePushPermission();
      if (perm === 'granted') { await subscribeToPush(); toast('Notifications enabled'); render(); } else toast('Permission not granted');
    });
    document.getElementById('export-json')?.addEventListener('click', exportJson);
    document.getElementById('import-json')?.addEventListener('change', importJson);
  }
}

async function wireTaskForm(param) {
  const isEdit = param !== 'new';
  const nlInput = document.getElementById('nl-input');
  nlInput?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const parsed = L.naturalLanguageTask(nlInput.value);
    document.getElementById('f-title').value = parsed.title;
    document.getElementById('f-priority').value = parsed.priority;
    document.getElementById('f-estimate').value = parsed.estimatedMinutes;
    nlInput.value = '';
    toast('Parsed into the fields below — review and save');
  });

  document.getElementById('ai-quickadd-btn')?.addEventListener('click', async () => {
    const text = nlInput.value.trim();
    if (!text) return;
    if (!hasApiKey()) { toast('Add your Gemini API key in Settings first'); return; }
    const status = document.getElementById('ai-quickadd-status');
    status.style.display = 'block';
    status.textContent = 'Thinking…';
    const parsed = await aiQuickAdd(text);
    if (!parsed.ok) { status.textContent = parsed.error; return; }
    document.getElementById('f-title').value = parsed.title;
    document.getElementById('f-priority').value = parsed.priority;
    document.getElementById('f-estimate').value = parsed.estimatedMinutes;
    document.getElementById('f-category').value = parsed.category;
    if (parsed.dueDate) document.getElementById('f-due').value = fmtDateTimeLocal(parsed.dueDate);
    nlInput.value = '';
    status.style.display = 'none';
    toast('Parsed into the fields below — review and save');
  });

  if (isEdit) {
    const id = Number(param);
    document.getElementById('add-subtask-btn')?.addEventListener('click', async () => {
      const input = document.getElementById('new-subtask-input');
      const title = input.value.trim();
      if (!title) return;
      await db.subtasks.add(newSubtask({ taskId: id, title }));
      input.value = '';
      const list = await db.subtasks.where('taskId').equals(id).toArray();
      document.getElementById('subtask-list').innerHTML = list.map(subtaskRowHtml).join('');
      wireSubtaskRows(id);
    });
    document.getElementById('ai-breakdown-btn')?.addEventListener('click', async () => {
      if (!hasApiKey()) { toast('Add your Gemini API key in Settings first'); return; }
      const status = document.getElementById('ai-breakdown-status');
      status.style.display = 'block';
      status.textContent = 'Thinking…';
      const title = document.getElementById('f-title').value.trim();
      const description = document.getElementById('f-desc').value.trim();
      const result = await aiBreakdown(title, description);
      if (!result.ok) { status.textContent = result.error; return; }
      await db.subtasks.bulkAdd(result.subtasks.map(t => newSubtask({ taskId: id, title: t })));
      const list = await db.subtasks.where('taskId').equals(id).toArray();
      document.getElementById('subtask-list').innerHTML = list.map(subtaskRowHtml).join('');
      wireSubtaskRows(id);
      status.style.display = 'none';
      toast(`Added ${result.subtasks.length} subtasks`);
    });
    wireSubtaskRows(id);

    document.querySelectorAll('[data-toggle-block]').forEach(el => el.addEventListener('click', () => toggleBlock(Number(el.dataset.toggleBlock))));
    document.querySelectorAll('[data-unschedule-block]').forEach(el => el.addEventListener('click', async () => {
      await db.timeBlocks.delete(Number(el.dataset.unscheduleBlock));
      toast('Removed from Planner');
      render();
    }));
    document.getElementById('schedule-task-btn')?.addEventListener('click', () => { taskScheduleModal = true; render(); });
    document.getElementById('cancel-task-schedule')?.addEventListener('click', () => { taskScheduleModal = false; render(); });
    document.getElementById('task-schedule-backdrop')?.addEventListener('click', (e) => { if (e.target.id === 'task-schedule-backdrop') { taskScheduleModal = false; render(); } });
    document.getElementById('task-schedule-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const task = await db.tasks.get(id);
      const date = document.getElementById('ts-date').value;
      const startTime = document.getElementById('ts-start').value;
      const duration = Number(document.getElementById('ts-duration').value) || 30;
      if (!date || !startTime) return;
      const startAt = new Date(`${date}T${startTime}`).getTime();
      const endAt = startAt + duration * 60000;
      await db.timeBlocks.add(newTimeBlock({ taskId: id, title: task.title, startAt, endAt }));
      taskScheduleModal = false;
      toast('Scheduled in Planner');
      render();
    });
  }

  document.getElementById('task-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
      title: document.getElementById('f-title').value.trim(),
      description: document.getElementById('f-desc').value,
      category: document.getElementById('f-category').value || 'General',
      project: document.getElementById('f-project').value,
      priority: document.getElementById('f-priority').value,
      recurrence: document.getElementById('f-recurrence').value,
      dueDate: parseLocalDateTime(document.getElementById('f-due').value),
      reminderAt: parseLocalDateTime(document.getElementById('f-reminder').value),
      estimatedMinutes: Number(document.getElementById('f-estimate').value) || 30,
      goalId: document.getElementById('f-goal').value ? Number(document.getElementById('f-goal').value) : null
    };
    if (!data.title) return;
    let id;
    if (isEdit) { id = Number(param); await db.tasks.update(id, data); } else { id = await db.tasks.add(newTask(data)); }

    if (isEdit) {
      const checked = [...document.querySelectorAll('.dep-check:checked')].map(el => Number(el.value));
      await db.taskDependencies.where('taskId').equals(id).delete();
      if (checked.length) await db.taskDependencies.bulkAdd(checked.map(dependsOnTaskId => ({ taskId: id, dependsOnTaskId })));
    }

    const saved = await db.tasks.get(id);
    let reminderFailed = false;
    if (saved.reminderAt) reminderFailed = !(await syncReminder(saved)); else await cancelReminder(id);
    toast(reminderFailed ? (isEdit ? 'Task updated, but the reminder could not be scheduled (offline, or notifications not enabled)' : 'Task added, but the reminder could not be scheduled (offline, or notifications not enabled)') : (isEdit ? 'Task updated' : 'Task added'));
    location.hash = '#/tasks';
  });

  document.getElementById('delete-task')?.addEventListener('click', async () => {
    const id = Number(param);
    const record = await db.tasks.get(id);
    await cancelReminder(id);
    await db.tasks.delete(id);
    const orphanedBlocks = await db.timeBlocks.where('taskId').equals(id).toArray();
    await Promise.all(orphanedBlocks.map(b => db.timeBlocks.update(b.id, { taskId: null })));
    toastUndo('Task deleted', async () => {
      const newId = await db.tasks.add(record);
      if (record.reminderAt) await syncReminder({ ...record, id: newId });
      await Promise.all(orphanedBlocks.map(b => db.timeBlocks.update(b.id, { taskId: newId })));
      render();
    });
    location.hash = '#/tasks';
  });
}

function wireSubtaskRows(taskId) {
  document.querySelectorAll('[data-toggle-subtask]').forEach(el => el.addEventListener('click', async () => {
    const sid = Number(el.dataset.toggleSubtask);
    const s = await db.subtasks.get(sid);
    await db.subtasks.update(sid, { isCompleted: !s.isCompleted });
    const list = await db.subtasks.where('taskId').equals(taskId).toArray();
    document.getElementById('subtask-list').innerHTML = list.map(subtaskRowHtml).join('');
    wireSubtaskRows(taskId);
  }));
  document.querySelectorAll('[data-delete-subtask]').forEach(el => el.addEventListener('click', async () => {
    await db.subtasks.delete(Number(el.dataset.deleteSubtask));
    const list = await db.subtasks.where('taskId').equals(taskId).toArray();
    document.getElementById('subtask-list').innerHTML = list.map(subtaskRowHtml).join('');
    wireSubtaskRows(taskId);
  }));
}

async function quickSchedule(taskId) {
  const task = await db.tasks.get(taskId);
  if (!task) return;
  const targetDate = task.dueDate != null ? new Date(task.dueDate) : new Date();
  plannerDate = L.dayKey(targetDate.getTime());
  const hour = task.dueDate != null ? targetDate.getHours() : Math.min(new Date().getHours() + 1, 23);
  plannerModal = { hour, taskId, title: task.title };
  if (location.hash.replace(/^#\/?/, '') === 'planner') render(); else location.hash = '#/planner';
}

async function toggleHabitDay(habitId, dayKey) {
  const existing = await db.habitHistory.get([habitId, dayKey]);
  if (existing) {
    await db.habitHistory.delete([habitId, dayKey]);
  } else {
    await db.habitHistory.put({ habitId, dayKey, completedAt: Date.now() });
  }
  const rows = await db.habitHistory.where('habitId').equals(habitId).toArray();
  const dayKeys = rows.map(r => r.dayKey);
  const stats = L.computeHabitStats(dayKeys);
  const mostRecentKey = dayKeys.length ? dayKeys.sort().at(-1) : null;
  await db.habits.update(habitId, {
    currentStreak: stats.currentStreak,
    bestStreak: stats.bestStreak,
    lastCompletedAt: mostRecentKey ? new Date(mostRecentKey + 'T00:00').getTime() : null
  });
  render();
}

async function toggleTask(id) {
  const task = await db.tasks.get(id);
  const done = !task.isCompleted;
  await db.tasks.update(id, { isCompleted: done, completedAt: done ? Date.now() : null });
  if (done) await cancelReminder(id);
  if (done && task.recurrence !== Recurrence.NONE && task.dueDate != null) {
    const next = L.nextRecurrence({ ...task, isCompleted: done });
    const newId = await db.tasks.add(newTask(next));
    const created = await db.tasks.get(newId);
    if (created.reminderAt) await syncReminder(created);
  }
  // Keep any linked Planner time blocks in sync with this task's completion state.
  const linkedBlocks = await db.timeBlocks.where('taskId').equals(id).toArray();
  await Promise.all(linkedBlocks.filter(b => b.isCompleted !== done).map(b => db.timeBlocks.update(b.id, { isCompleted: done })));
  render();
}
function wirePlannerModal() {
  const backdrop = document.getElementById('planner-modal-backdrop');
  if (!backdrop) return;
  backdrop.dataset.mode = 'duration';
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) { plannerModal = null; render(); } });
  document.getElementById('cancel-planner-modal')?.addEventListener('click', () => { plannerModal = null; render(); });

  const endBtn = document.getElementById('mode-endtime');
  const durBtn = document.getElementById('mode-duration');
  const endFields = document.getElementById('endtime-fields');
  const durFields = document.getElementById('duration-fields');
  function setMode(mode) {
    const isDuration = mode === 'duration';
    durFields.style.display = isDuration ? 'flex' : 'none';
    endFields.style.display = isDuration ? 'none' : 'block';
    durBtn.style.background = isDuration ? 'var(--teal)' : '';
    durBtn.style.color = isDuration ? 'white' : '';
    durBtn.style.borderColor = isDuration ? 'var(--teal)' : '';
    endBtn.style.background = !isDuration ? 'var(--teal)' : '';
    endBtn.style.color = !isDuration ? 'white' : '';
    endBtn.style.borderColor = !isDuration ? 'var(--teal)' : '';
    backdrop.dataset.mode = mode;
  }
  endBtn?.addEventListener('click', () => setMode('endtime'));
  durBtn?.addEventListener('click', () => setMode('duration'));

  const taskSelect = document.getElementById('pb-task');
  const titleInput = document.getElementById('pb-title');
  taskSelect?.addEventListener('change', () => {
    const opt = taskSelect.selectedOptions[0];
    if (taskSelect.value && (!titleInput.value.trim() || titleInput.dataset.autofilled === '1')) {
      titleInput.value = opt.textContent;
      titleInput.dataset.autofilled = '1';
    }
  });
  titleInput?.addEventListener('input', () => { if (titleInput.dataset.autofilled === '1' && document.activeElement === titleInput) titleInput.dataset.autofilled = '0'; });

  document.getElementById('planner-block-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('pb-title').value.trim();
    const startTime = document.getElementById('pb-start').value;
    const taskId = document.getElementById('pb-task').value ? Number(document.getElementById('pb-task').value) : null;
    if (!title || !startTime) return;
    const startAt = new Date(`${plannerDate}T${startTime}`).getTime();
    let endAt;
    if (backdrop.dataset.mode === 'duration') {
      const hours = Number(document.getElementById('pb-hours').value) || 0;
      const minutes = Number(document.getElementById('pb-minutes').value) || 0;
      const totalMin = hours * 60 + minutes;
      if (totalMin <= 0) { toast('Enter a duration greater than 0'); return; }
      endAt = startAt + totalMin * 60000;
    } else {
      const endTime = document.getElementById('pb-end').value;
      endAt = new Date(`${plannerDate}T${endTime}`).getTime();
      if (endAt <= startAt) endAt += 24 * 60 * 60000; // spans past midnight
    }
    await db.timeBlocks.add(newTimeBlock({ title, startAt, endAt, taskId }));
    plannerModal = null;
    toast(taskId ? 'Time block added and linked to task' : 'Time block added');
    render();
  });
}

async function toggleBlock(id) {
  const b = await db.timeBlocks.get(id);
  const done = !b.isCompleted;
  await db.timeBlocks.update(id, { isCompleted: done });
  // If this block is linked to a task, completing/reopening the block does the same to the task.
  if (b.taskId) {
    const task = await db.tasks.get(b.taskId);
    if (task && task.isCompleted !== done) {
      await db.tasks.update(task.id, { isCompleted: done, completedAt: done ? Date.now() : null });
      if (done) await cancelReminder(task.id);
      if (done && task.recurrence !== Recurrence.NONE && task.dueDate != null) {
        const next = L.nextRecurrence({ ...task, isCompleted: done });
        const newId = await db.tasks.add(newTask(next));
        const created = await db.tasks.get(newId);
        if (created.reminderAt) await syncReminder(created);
      }
    }
  }
  render();
}

async function exportJson() {
  const [tasks, goals, habits, subtasks, timeBlocks, taskDependencies, habitHistory] = await Promise.all([
    db.tasks.toArray(), db.goals.toArray(), db.habits.toArray(), db.subtasks.toArray(), db.timeBlocks.toArray(), db.taskDependencies.toArray(), db.habitHistory.toArray()
  ]);
  const blob = new Blob([JSON.stringify({ version: 6, exportedAt: Date.now(), tasks, goals, habits, subtasks, timeBlocks, taskDependencies, habitHistory }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `power-organizer-backup-${L.dayKey(Date.now())}.json`; a.click();
  URL.revokeObjectURL(url);
  toast('Backup downloaded');
}

async function importJson(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (!confirm('Importing will replace ALL current data with this backup. Continue?')) { e.target.value = ''; return; }
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    await db.transaction('rw', db.tasks, db.goals, db.habits, db.subtasks, db.timeBlocks, db.taskDependencies, db.habitHistory, async () => {
      await Promise.all([db.tasks.clear(), db.goals.clear(), db.habits.clear(), db.subtasks.clear(), db.timeBlocks.clear(), db.taskDependencies.clear(), db.habitHistory.clear()]);
      if (data.tasks) await db.tasks.bulkAdd(data.tasks.map(({ id, ...rest }) => rest));
      if (data.goals) await db.goals.bulkAdd(data.goals.map(({ id, ...rest }) => rest));
      if (data.habits) await db.habits.bulkAdd(data.habits.map(({ id, ...rest }) => rest));
    });
    toast('Backup restored');
    render();
  } catch (err) {
    console.error(err);
    toast('Could not read that backup file');
  }
  e.target.value = '';
}

// ---------- Boot ----------
async function boot() {
  initTheme();
  renderShell();
  await seedIfEmpty();
  if ('serviceWorker' in navigator) { try { await navigator.serviceWorker.register('./sw.js'); } catch (e) { console.warn('SW registration failed', e); } }
  render();
}
boot();
