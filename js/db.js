// db.js — IndexedDB layer via Dexie, mirroring the Room database from the Android app.
// Table shapes intentionally match TaskOrganizer's Kotlin data classes field-for-field.

import Dexie from 'https://esm.sh/dexie@4';

export const db = new Dexie('PowerOrganizerDB');

db.version(1).stores({
  tasks: '++id, dueDate, isCompleted, goalId, priority, category',
  subtasks: '++id, taskId',
  goals: '++id',
  habits: '++id',
  // Room's HabitHistory has a compound primary key (habitId, dayKey) — no separate id.
  habitHistory: '[habitId+dayKey], habitId, dayKey',
  // TimeBlock has no separate "date" field in the original — day is derived from startAt.
  timeBlocks: '++id, startAt, taskId',
  // Room's TaskDependency has a compound primary key (taskId, dependsOnTaskId) — enforces uniqueness.
  taskDependencies: '[taskId+dependsOnTaskId], taskId, dependsOnTaskId'
});

// ---- Enums (matching Task.kt) ----
export const Priority = { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH' };
export const Recurrence = { NONE: 'NONE', DAILY: 'DAILY', WEEKLY: 'WEEKLY', MONTHLY: 'MONTHLY' };

// ---- Task shape (from Task.kt) ----
export function newTask(overrides = {}) {
  return {
    title: '',
    description: '',
    category: 'General',
    project: '',
    goalId: null,
    priority: Priority.MEDIUM,
    dueDate: null,
    reminderAt: null,
    recurrence: Recurrence.NONE,
    estimatedMinutes: 30,
    isCompleted: false,
    completedAt: null,
    createdAt: Date.now(),
    ...overrides
  };
}

// ---- Goal shape (from Goal.kt) ----
export function newGoal(overrides = {}) {
  return {
    name: '',
    description: '',
    targetDate: null,
    colorKey: 0,
    isCompleted: false,
    createdAt: Date.now(),
    ...overrides
  };
}

// ---- Habit shape (from Habit.kt) ----
export function newHabit(overrides = {}) {
  return {
    name: '',
    frequency: 'DAILY',
    targetPerWeek: 7,
    currentStreak: 0,
    bestStreak: 0,
    lastCompletedAt: null,
    isActive: true,
    createdAt: Date.now(),
    ...overrides
  };
}

// ---- TimeBlock shape (from TimeBlock.kt) ----
export function newTimeBlock(overrides = {}) {
  return {
    taskId: null,
    title: '',
    startAt: Date.now(),
    endAt: Date.now() + 30 * 60000,
    isCompleted: false,
    ...overrides
  };
}

// ---- Subtask shape (from Subtask.kt) ----
export function newSubtask(overrides = {}) {
  return {
    taskId: null,
    title: '',
    isCompleted: false,
    sortOrder: 0,
    ...overrides
  };
}

export async function seedIfEmpty() {
  const count = await db.tasks.count();
  if (count > 0) return;
  await db.tasks.bulkAdd([
    newTask({ title: 'Welcome to Power Organizer', description: 'This runs fully offline, right in your browser. Try the quick-capture box: "call the bank asap" or "quick email to team".', priority: Priority.MEDIUM }),
    newTask({ title: 'Set up a goal and link tasks to it', description: 'Goals track progress across a group of tasks.', priority: Priority.LOW })
  ]);
}
