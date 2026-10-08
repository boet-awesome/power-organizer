// logic.js — pure functions ported from TaskViewModel.kt.
// Kept as plain functions (no framework) so the ranking/filtering rules are easy
// to compare line-by-line against the original Kotlin.

import { Priority, Recurrence } from './db.js';

const priorityRank = { [Priority.HIGH]: 0, [Priority.MEDIUM]: 1, [Priority.LOW]: 2 };

// --- ported from TaskViewModel.smartPlan() ---
export function smartPlan(allTasks) {
  const now = Date.now();
  return allTasks
    .filter(t => !t.isCompleted)
    .sort((a, b) => {
      const pr = priorityRank[a.priority] - priorityRank[b.priority];
      if (pr !== 0) return pr;
      const aOverdue = a.dueDate != null && a.dueDate < now ? 0 : 1;
      const bOverdue = b.dueDate != null && b.dueDate < now ? 0 : 1;
      if (aOverdue !== bOverdue) return aOverdue - bOverdue;
      const aDue = a.dueDate ?? Infinity;
      const bDue = b.dueDate ?? Infinity;
      if (aDue !== bDue) return aDue - bDue;
      return b.estimatedMinutes - a.estimatedMinutes; // longer effort first, tie-break
    })
    .slice(0, 7);
}

// --- ported from TaskViewModel.isBlocked() ---
export function isBlocked(task, dependencies, allTasks) {
  return dependencies
    .filter(d => d.taskId === task.id)
    .some(dep => {
      const dependsOn = allTasks.find(t => t.id === dep.dependsOnTaskId);
      return !dependsOn || dependsOn.isCompleted !== true;
    });
}

// --- ported from TaskViewModel.naturalLanguageTask() ---
export function naturalLanguageTask(text) {
  const lower = text.toLowerCase();
  let priority = Priority.MEDIUM;
  if (lower.includes('urgent') || lower.includes('asap')) priority = Priority.HIGH;
  else if (lower.includes('low priority')) priority = Priority.LOW;

  let estimatedMinutes = 30;
  if (lower.includes('quick') || lower.includes('short')) estimatedMinutes = 15;
  else if (lower.includes('long')) estimatedMinutes = 90;

  const trimmed = text.trim();
  const title = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return { title, priority, estimatedMinutes };
}

// --- ported from TaskViewModel.completionRateLast7Days() ---
export function completionRateLast7Days(allTasks) {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = allTasks.filter(t => t.createdAt >= cutoff);
  if (recent.length === 0) return 0;
  return Math.round((recent.filter(t => t.isCompleted).length * 100) / recent.length);
}

// --- ported from TaskViewModel.focusMinutesCompleted() ---
export function focusMinutesCompleted(timeBlocks) {
  return timeBlocks
    .filter(b => b.isCompleted)
    .reduce((sum, b) => sum + Math.max(0, Math.round((b.endAt - b.startAt) / 60000)), 0);
}

// --- ported from TaskViewModel.productivityScore() ---
export function productivityScore(allTasks) {
  if (allTasks.length === 0) return 0;
  return Math.round((allTasks.filter(t => t.isCompleted).length / allTasks.length) * 100);
}

export function dayKey(ms) {
  const d = new Date(ms);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; // local date, NOT toISOString (which is UTC and shifts the day for timezones ahead of UTC)
}

function dayStart(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// --- ported from TaskViewModel.filteredTasks (TaskFilter enum) ---
export const TaskFilter = { ALL: 'ALL', ACTIVE: 'ACTIVE', COMPLETED: 'COMPLETED', TODAY: 'TODAY', UPCOMING: 'UPCOMING', OVERDUE: 'OVERDUE' };
export const SortMode = { DUE_DATE: 'DUE_DATE', PRIORITY: 'PRIORITY', CREATED: 'CREATED' };

export function filterTasks(tasks, { filter = TaskFilter.ALL, search = '', category = 'All categories', project = 'All projects', sort = SortMode.DUE_DATE }) {
  const now = Date.now();
  const start = dayStart(now);
  const end = start + 86400000;
  let list = tasks.filter(t => {
    let ok;
    switch (filter) {
      case TaskFilter.ACTIVE: ok = !t.isCompleted; break;
      case TaskFilter.COMPLETED: ok = t.isCompleted; break;
      case TaskFilter.TODAY: ok = t.dueDate != null && t.dueDate >= start && t.dueDate < end && !t.isCompleted; break;
      case TaskFilter.UPCOMING: ok = (t.dueDate ?? 0) >= end && !t.isCompleted; break;
      case TaskFilter.OVERDUE: ok = (t.dueDate ?? Infinity) < now && !t.isCompleted; break;
      default: ok = true;
    }
    if (!ok) return false;
    if (category !== 'All categories' && t.category !== category) return false;
    if (project !== 'All projects' && t.project !== project) return false;
    if (search.trim() && ![t.title, t.description, t.category, t.project].some(f => (f || '').toLowerCase().includes(search.toLowerCase()))) return false;
    return true;
  });

  if (sort === SortMode.DUE_DATE) {
    list = list.sort((a, b) => (a.isCompleted - b.isCompleted) || ((a.dueDate ?? Infinity) - (b.dueDate ?? Infinity)));
  } else if (sort === SortMode.PRIORITY) {
    list = list.sort((a, b) => (a.isCompleted - b.isCompleted) || (priorityRank[a.priority] - priorityRank[b.priority]));
  } else {
    list = list.sort((a, b) => b.createdAt - a.createdAt);
  }
  return list;
}

// --- ported from TaskViewModel.toggleComplete() recurrence-rollover logic ---
export function nextRecurrence(task) {
  if (task.recurrence === Recurrence.NONE || task.dueDate == null) return null;
  const d = new Date(task.dueDate);
  if (task.recurrence === Recurrence.DAILY) d.setDate(d.getDate() + 1);
  else if (task.recurrence === Recurrence.WEEKLY) d.setDate(d.getDate() + 7);
  else if (task.recurrence === Recurrence.MONTHLY) d.setMonth(d.getMonth() + 1);
  const newDue = d.getTime();
  return {
    ...task,
    id: undefined,
    dueDate: newDue,
    reminderAt: task.reminderAt != null ? task.reminderAt - task.dueDate + newDue : null,
    isCompleted: false,
    completedAt: null
  };
}

// --- new: goal progress, derived from linked tasks (goalId) ---
export function goalProgress(goal, tasks) {
  const linked = tasks.filter(t => t.goalId === goal.id);
  const done = linked.filter(t => t.isCompleted).length;
  const pct = linked.length ? Math.round((done / linked.length) * 100) : 0;
  return { total: linked.length, done, pct };
}

// --- new: daily completion counts for the dashboard trend chart ---
export function completionSeries(tasks, days = 7) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - i);
    const key = dayKey(day.getTime());
    const value = tasks.filter(t => t.isCompleted && t.completedAt != null && dayKey(t.completedAt) === key).length;
    out.push({ label: day.toLocaleDateString(undefined, { weekday: 'narrow' }), value, key });
  }
  return out;
}

// --- new: derive current + best streak purely from habitHistory day-keys ---
// This is the source of truth going forward: recomputing from history (rather than
// incrementing a stored counter) means undoing a day, backfilling a missed day, or
// deleting a stray entry all just work — the streaks always reflect what's on record.
export function computeHabitStats(dayKeys) {
  const set = new Set(dayKeys);
  if (set.size === 0) return { currentStreak: 0, bestStreak: 0 };

  // Current streak: consecutive completed days ending today, or ending yesterday
  // if today hasn't been checked off yet (so the streak doesn't look "broken" mid-day).
  let current = 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  if (!set.has(dayKey(cursor.getTime()))) cursor.setDate(cursor.getDate() - 1);
  while (set.has(dayKey(cursor.getTime()))) {
    current++;
    cursor.setDate(cursor.getDate() - 1);
  }

  // Best streak ever: longest run of consecutive calendar days anywhere in the history.
  const sortedKeys = [...set].sort();
  let best = 0, run = 0, prevKey = null;
  for (const key of sortedKeys) {
    if (prevKey) {
      const expectedNext = new Date(prevKey + 'T00:00');
      expectedNext.setDate(expectedNext.getDate() + 1);
      run = dayKey(expectedNext.getTime()) === key ? run + 1 : 1;
    } else {
      run = 1;
    }
    best = Math.max(best, run);
    prevKey = key;
  }
  return { currentStreak: current, bestStreak: best };
}

// --- ported from TaskViewModel.toggleHabit() streak logic ---
export function nextHabitState(habit, now = Date.now()) {
  const sameDay = habit.lastCompletedAt != null && dayKey(habit.lastCompletedAt) === dayKey(now);
  if (sameDay) return null; // already completed today, no-op
  const yesterday = now - 24 * 60 * 60 * 1000;
  const continued = habit.lastCompletedAt != null && dayKey(habit.lastCompletedAt) === dayKey(yesterday);
  const streak = continued ? habit.currentStreak + 1 : 1;
  return {
    ...habit,
    currentStreak: streak,
    bestStreak: Math.max(habit.bestStreak, streak),
    lastCompletedAt: now
  };
}
