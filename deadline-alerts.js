import { DAY, taskStatus } from './model.js';

// Inclusive 24-hour boundary. Expired, submitted and missed tasks never alarm.
export function isUrgentDeadline(task, now = Date.now()) {
  if (!task?.dueAt || taskStatus(task, now) !== 'open') return false;
  const remaining = Date.parse(task.dueAt) - now;
  return remaining > 0 && remaining <= DAY;
}

// Include all active semesters, even when another semester is selected.
// A changed due date is a new reminder; checks and notes are not.
export function pendingDeadlineAlarms(state, scope, seen, now = Date.now()) {
  return state.semesters.filter(s => !s.archived).flatMap(s =>
    s.lectures.flatMap(l => l.tasks.filter(t => isUrgentDeadline(t, now)).map(t => ({
      key: JSON.stringify([scope, t.id, t.dueAt]), title: t.title, lecture: l.name
    }))))
    .filter(item => !seen.has(item.key));
}
