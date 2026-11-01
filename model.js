// Pure domain logic. No browser APIs: usable in tests and a future sync service.
export const SCHEMA_VERSION = 1;
export const DAY = 86_400_000;
export const STATUS = {
  open: 'Offen', submitted: 'Abgegeben',
  unresolved: 'Frist überschritten – ungeklärt', missed: 'Nicht abgegeben'
};
export const TEMPLATES = {
  linguistics: {
    name: 'Computerlinguistik', unit: 'Hausaufgabe',
    steps: ['Aufgabenblatt heruntergeladen', 'Auf Papier gelöst', 'Lösungen kontrolliert', 'In LaTeX übertragen', 'PDF überprüft', 'In ILIAS abgegeben'],
    anki: ['Englische Fachbegriffe / Vokabular', '⭐ Klausurrelevante Karteikarten', 'Weitere Karteikarten', 'Fehlerkorrekturen']
  },
  math: {
    name: 'Mathematik', unit: 'Online-Quiz',
    steps: ['Quiz geöffnet', 'Fragen bearbeitet', 'Antworten kontrolliert', 'Quiz eingereicht'],
    anki: ['Quiz- und Testfragen', '⭐ Klausurrelevante Karteikarten', 'Definitionen und Regeln', 'Weitere Inhalte und Fehlerkorrekturen']
  }
};
export const uid = () => globalThis.crypto.randomUUID();
export function makeTask(number, template = 'linguistics') {
  return { id: uid(), number, title: `${TEMPLATES[template].unit} ${number}`, releaseAt: null,
    dueAt: null, status: 'open', submittedAt: null, score: null, passed: null,
    steps: TEMPLATES[template].steps.map(label => ({ label, done: false })), notes: '', link: '' };
}
export function makeLecture(name, template = 'linguistics', count = 0) {
  return { id: uid(), name, template, countKnown: count > 0,
    tasks: Array.from({ length: count }, (_, i) => makeTask(i + 1, template)), weeks: [] };
}
export function initialState() {
  const winter = { id: uid(), name: 'Wintersemester 2026/2027', archived: false, lectures: [
    makeLecture('Einführung in die Computerlinguistik – Teil 1', 'linguistics', 12),
    makeLecture('Mathe Grundlagen', 'math', 14)
  ] };
  const summer = { id: uid(), name: 'Sommersemester 2027', archived: false, lectures: [
    makeLecture('Einführung in die Computerlinguistik – Teil 2')
  ] };
  return { schemaVersion: SCHEMA_VERSION, revision: 0, updatedAt: new Date().toISOString(),
    selectedSemesterId: winter.id, semesters: [winter, summer] };
}
export function taskStatus(task, now = Date.now()) {
  if (task.status === 'submitted' || task.status === 'missed') return task.status;
  if (task.dueAt && Date.parse(task.dueAt) <= now) return 'unresolved';
  return task.status;
}
export function reconcileDeadlines(state, now = Date.now()) {
  let changed = false;
  for (const semester of state.semesters) for (const lecture of semester.lectures) for (const task of lecture.tasks) {
    const next = taskStatus(task, now);
    if (task.status !== next) { task.status = next; changed = true; }
  }
  return changed;
}
export function countdownParts(target, now = Date.now()) {
  const minutes = Math.max(0, Math.ceil((Date.parse(target) - now) / 60_000));
  return { days: Math.floor(minutes / 1440), hours: Math.floor(minutes % 1440 / 60), minutes: minutes % 60 };
}
export function urgency(target, now = Date.now()) {
  const remaining = Date.parse(target) - now;
  return remaining > 5 * DAY ? 'blue' : remaining >= 2 * DAY ? 'orange' : 'red';
}
export function lectureCountdown(lecture, now = Date.now()) {
  const unresolved = lecture.tasks.filter(t => taskStatus(t, now) === 'unresolved');
  const open = lecture.tasks.filter(t => taskStatus(t, now) === 'open');
  const future = open.filter(t => t.dueAt && Date.parse(t.dueAt) > now)
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
  if (future.length) return { kind: 'deadline', task: future[0], target: future[0].dueAt,
    color: urgency(future[0].dueAt, now), unresolved };
  const releases = open.filter(t => t.releaseAt && Date.parse(t.releaseAt) > now)
    .sort((a, b) => Date.parse(a.releaseAt) - Date.parse(b.releaseAt));
  if (releases.length) return { kind: 'release', task: releases[0], target: releases[0].releaseAt,
    color: urgency(releases[0].releaseAt, now), unresolved };
  return { kind: unresolved.length ? 'unresolved' : 'clear', color: unresolved.length ? 'red' : 'green',
    task: null, target: null, unresolved };
}
export function statistics(lectures, now = Date.now()) {
  const tasks = lectures.flatMap(l => l.tasks);
  const count = status => tasks.filter(t => taskStatus(t, now) === status).length;
  const graded = tasks.filter(t => typeof t.score === 'number');
  const anki = lectures.flatMap(l => l.weeks.flatMap(w => w.items));
  const submitted = count('submitted');
  return { total: tasks.length, submitted, missed: count('missed'), open: count('open'),
    unresolved: count('unresolved'), submissionRate: tasks.length ? submitted / tasks.length * 100 : null,
    average: graded.length ? graded.reduce((sum, t) => sum + t.score, 0) / graded.length : null,
    graded: graded.length, passed: tasks.filter(t => t.passed === true).length,
    ankiDone: anki.filter(i => i.done).length, ankiTotal: anki.length };
}
export function copyLectureStructure(source) {
  return source.map(lecture => ({ ...makeLecture(lecture.name, lecture.template), countKnown: lecture.countKnown,
    tasks: lecture.tasks.map(task => ({ ...makeTask(task.number, lecture.template), title: task.title,
      steps: task.steps.map(step => ({ label: step.label, done: false })) })) }));
}
// Validate imports strictly before replacing any data. Limits also bound rendering cost.
export function validateState(input) {
  const fail = reason => { throw new Error(`Ungültige Sicherung: ${reason}`); };
  const obj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const str = (v, max = 500, required = false) => typeof v === 'string' && v.length <= max && (!required || v.trim().length > 0);
  const date = v => v === null || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v)));
  const ids = new Set();
  const id = value => { if (!str(value, 100, true) || ids.has(value)) fail('fehlende oder doppelte ID.'); ids.add(value); };
  const checklist = (items, max) => Array.isArray(items) && items.length <= max && items.every(i => obj(i) && str(i.label, 500, true) && typeof i.done === 'boolean');
  if (!obj(input) || input.schemaVersion !== SCHEMA_VERSION) fail('Dateiformat oder Version wird nicht unterstützt.');
  if (!Number.isSafeInteger(input.revision) || input.revision < 0 || !date(input.updatedAt) || input.updatedAt === null) fail('Speicherinformationen fehlen.');
  if (!Array.isArray(input.semesters) || !input.semesters.length || input.semesters.length > 100) fail('Semesterliste fehlt oder ist zu groß.');
  for (const s of input.semesters) {
    if (!obj(s)) fail('Semester ist beschädigt.');
    id(s.id);
    if (!str(s.name, 200, true) || typeof s.archived !== 'boolean' || !Array.isArray(s.lectures) || s.lectures.length > 100) fail('Semester ist unvollständig.');
    for (const l of s.lectures) {
      if (!obj(l)) fail('Vorlesung ist beschädigt.');
      id(l.id);
      if (!str(l.name, 300, true) || !Object.hasOwn(TEMPLATES, l.template) || typeof l.countKnown !== 'boolean' || !Array.isArray(l.tasks) || l.tasks.length > 500 || !Array.isArray(l.weeks) || l.weeks.length > 100) fail('Vorlesung ist unvollständig.');
      for (const t of l.tasks) {
        if (!obj(t)) fail('Aufgabe ist beschädigt.');
        id(t.id);
        if (!Number.isInteger(t.number) || t.number < 1 || t.number > 9999 || !str(t.title, 300, true) || !date(t.releaseAt) || !date(t.dueAt) || !date(t.submittedAt) || !Object.hasOwn(STATUS, t.status) || !checklist(t.steps, 50) || !str(t.notes, 20000) || !str(t.link, 2000)) fail('Aufgabendaten sind unvollständig.');
        if (t.releaseAt && t.dueAt && Date.parse(t.releaseAt) > Date.parse(t.dueAt)) fail('Freischaltung liegt nach der Abgabe.');
        if (t.status === 'submitted' && !t.submittedAt) fail('Abgabezeitpunkt fehlt.');
        if (t.status !== 'submitted' && t.submittedAt !== null) fail('Abgabezeitpunkt passt nicht zum Status.');
        if (t.status === 'unresolved' && !t.dueAt) fail('Ungeklärte Aufgabe benötigt eine Frist.');
        if (t.score !== null && (typeof t.score !== 'number' || !Number.isFinite(t.score) || t.score < 0 || t.score > 100)) fail('Bewertung muss zwischen 0 und 100 liegen.');
        if (t.passed !== null && typeof t.passed !== 'boolean') fail('Bestehensstatus ist ungültig.');
        if (t.link) { try { if (!['https:', 'http:'].includes(new URL(t.link).protocol)) fail('Link muss HTTP oder HTTPS verwenden.'); } catch { fail('ILIAS-Link ist ungültig.'); } }
      }
      for (const w of l.weeks) {
        if (!obj(w)) fail('Unterrichtswoche ist beschädigt.');
        id(w.id);
        if (!str(w.label, 200, true) || !checklist(w.items, 50)) fail('Anki-Checkliste ist unvollständig.');
      }
    }
  }
  if (!input.semesters.some(s => s.id === input.selectedSemesterId)) fail('Ausgewähltes Semester fehlt.');
  return structuredClone(input);
}
