import { isUrgentDeadline, pendingDeadlineAlarms } from './deadline-alerts.js';
import { STATUS, TEMPLATES, uid, initialState, makeLecture, makeTask, taskStatus, reconcileDeadlines,
  countdownParts, lectureCountdown, statistics, copyLectureStructure, validateState, urgency, ensurePreparation } from './model.js';
import { LocalRepository, STORAGE_KEY } from './storage.js';
import { CloudSession } from './cloud-session.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const icons = {
  cap: '<path d="m2 9 10-5 10 5-10 5z"/><path d="M6 11v6q6 4 12 0v-6M22 9v7"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  tasks: '<rect x="5" y="5" width="15" height="16" rx="2"/><path d="M9 5V3h7v2M9 11h7M9 16h5"/>',
  cards: '<rect x="7" y="5" width="13" height="16" rx="2"/><path d="M4 17 2 5a2 2 0 0 1 2-2l11-1M11 10h5M11 14h4"/>',
  chart: '<path d="M4 3v17h17M9 16v-5M14 16V7M19 16V4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4M17 3v4M3 11h18M8 15h2M14 15h2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  book: '<path d="M12 5C8 2 4 3 2 4v15c3-1 6-1 10 1 4-2 7-2 10-1V4c-2-1-6-2-10 1zm0 0v15"/>',
  math: '<path d="M4 8h5l4 12L20 3h-7M16 13h5M16 17h5"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  backup: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/>',
  upload: '<path d="M12 16V4m-4 4 4-4 4 4M4 16v4h16v-4"/>',
  wifi: '<path d="M3 8a16 16 0 0 1 18 0M6 12a10 10 0 0 1 12 0M9 16a5 5 0 0 1 6 0"/><circle cx="12" cy="20" r=".5"/>',
  alert: '<path d="m10 4-8 14a2 2 0 0 0 2 3h16a2 2 0 0 0 2-3L14 4a2.3 2.3 0 0 0-4 0zM12 9v4M12 17h.01"/>',
  leaf: '<path d="M5 19C0 7 9 3 21 3c0 13-5 20-16 16zm0 0L16 8"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  archive: '<rect x="3" y="3" width="18" height="5" rx="1"/><path d="M5 8v13h14V8M9 12h6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4M12 17h.01"/>',
  edit: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14z"/>',
  link: '<path d="M14 3h7v7M21 3l-11 11M11 4H4v16h16v-7"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  cloud: '<path d="M7 18a6 6 0 1 1 0-12 7 7 0 0 1 13 4 4 4 0 0 1 0 8M8 14l4 4 4-4M12 10v8"/>'
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.book}</svg>`;
const dateFormat = new Intl.DateTimeFormat('de-DE', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
const fmtDate = value => value ? dateFormat.format(new Date(value)) + ' Uhr' : 'Noch kein Termin';
const percent = value => value === null ? '–' : `${Math.round(value)} %`;
const fieldDate = value => {
  if (!value) return '';
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
};
const isoDate = value => value ? new Date(value).toISOString() : null;
let repository, state, guestRepository, cloud=null, deferredCloud=false, cloudBackups=[], loadError = null, saveFailed = false;
try { repository = new LocalRepository(); guestRepository=repository; state = repository.load(); }
catch (error) { loadError = error; }
let view = 'dashboard', filterLecture = '', filterStatus = '', search = '', installEvent = null, modalContext = null;
const semester = () => state.semesters.find(s => s.id === state.selectedSemesterId);
const lectureById = id => semester().lectures.find(l => l.id === id);
function persist() {
  try { repository.save(state); saveFailed = false; cloud?.changed(); return true; }
  catch (error) { saveFailed = true; toast(error.message.startsWith('Ein anderes Fenster') ? error.message : 'Speichern fehlgeschlagen. Bitte sichere deine Daten jetzt als JSON.', true); return false; }
}
function commit(message) { const saved = persist(); render(); if (message && saved) toast(message); }
let toastTimer,taskAutosaveTimer;
function toast(message, error = false) {
  clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').className = `visible${error ? ' error' : ''}`;
  toastTimer = setTimeout(() => { $('#toast').className = ''; }, error ? 12000 : 4200);
}
const statusBadge = status => `<span class="status status-${status}"><span class="status-dot"></span>${esc(STATUS[status])}</span>`;
const courseIcon = l => `<span class="course-icon ${l.template}">${icon(l.template === 'math' ? 'math' : 'book')}</span>`;
const button = (action, label, symbol = '', cls = 'btn', attrs = '') => `<button type="button" class="${cls}" data-action="${action}" ${attrs}>${symbol ? icon(symbol) : ''}${label}</button>`;
const empty = (symbol, title, detail, action = '') => `<div class="empty-state">${icon(symbol)}<h3>${title}</h3><p>${detail}</p>${action}</div>`;

const ALARM_STORAGE_KEY='mein-uni-cockpit.deadline-alarms.v1';
let alarmAudio=null,alarmEnabled=false,alarmSeen=new Set();
function readAlarmHistory(){
  try{const keys=JSON.parse(localStorage.getItem(ALARM_STORAGE_KEY)||'[]');if(Array.isArray(keys))for(const key of keys)if(typeof key==='string')alarmSeen.add(key);}catch{}
}
readAlarmHistory();
function alarmRunning(){return alarmEnabled && alarmAudio?.state==='running';}
function playDeadlineChime(){
  if(!alarmRunning())return false;
  const start=alarmAudio.currentTime;
  [880,660,880].forEach((frequency,index)=>{
    const oscillator=alarmAudio.createOscillator(),gain=alarmAudio.createGain(),at=start+index*.4;
    oscillator.type='sine';oscillator.frequency.value=frequency;
    gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(.11,at+.015);
    gain.gain.linearRampToValueAtTime(0,at+.23);
    oscillator.connect(gain);gain.connect(alarmAudio.destination);
    oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
    oscillator.start(at);oscillator.stop(at+.24);
  });
  return true;
}
function pollDeadlineAlarm(){
  if(loadError || document.visibilityState!=='visible' || !alarmRunning())return;
  readAlarmHistory();
  const pending=pendingDeadlineAlarms(state,repository.key,alarmSeen);
  if(!pending.length)return;
  try{
    if(!playDeadlineChime())return;
    for(const item of pending)alarmSeen.add(item.key);
    try{localStorage.setItem(ALARM_STORAGE_KEY,JSON.stringify([...alarmSeen].slice(-2000)));}catch{}
    toast(`${pending.length===1?'Abgabe in höchstens 24 Stunden':`${pending.length} Abgaben in höchstens 24 Stunden`}: ${pending.map(item=>item.title).join(', ')}`);
  }catch{alarmEnabled=false;toast('Der Alarmton konnte nicht abgespielt werden. Bitte erneut aktivieren.',true);render();}
}
async function toggleDeadlineAlarm(){
  if(alarmRunning()){
    alarmEnabled=false;await alarmAudio.suspend();render();return;
  }
  try{
    const Audio=window.AudioContext||window.webkitAudioContext;
    if(!Audio)throw new Error('unsupported');
    if(!alarmAudio || alarmAudio.state==='closed')alarmAudio=new Audio();
    await alarmAudio.resume();
    if(alarmAudio.state!=='running')throw new Error('blocked');
    alarmEnabled=true;
    const pending=pendingDeadlineAlarms(state,repository.key,alarmSeen);
    if(pending.length)pollDeadlineAlarm();else playDeadlineChime();
    render();
  }catch{alarmEnabled=false;toast('Der Browser erlaubt gerade keinen Alarmton. Öffne die App direkt in Chrome und versuche es erneut.',true);render();}
}
function deadlineAlarmControls(){
  return `<details id="deadline-alarm-settings" class="deadline-alarm-settings"><summary>${icon('alert')}Abgabewarnung & Alarmton${alarmRunning()?'<span class="alarm-active">Ton aktiv</span>':''}</summary><div><p>In den letzten 24 Stunden pulsiert die rote Countdown-Fläche. Ein kurzer Alarmton kann dich einmal je Abgabe und Termin auf diesem Gerät erinnern – auch für andere nicht archivierte Semester.</p>${button('toggle-deadline-alarm',alarmRunning()?'Alarmton ausschalten':'Alarmton aktivieren & testen','',alarmRunning()?'btn btn-white':'btn btn-primary')}<p class="helper-text">Der Ton funktioniert nur bei geöffneter, sichtbarer App und passender Medienlautstärke. Nach dem Schließen erneut aktivieren. Bei gesperrtem Bildschirm oder geschlossener App gibt es keinen zuverlässigen Alarm.</p></div></details>`;
}

function render() {
  if (loadError) { renderRecovery(); return; }
  const openedDetails=[...document.querySelectorAll('#app details[open][id]')].map(el=>el.id);
  const active = document.activeElement?.id;
  const selection = document.activeElement?.selectionStart;
  const s = semester();
  const stats = statistics(s.lectures);
  const titles = { dashboard:'Übersicht', tasks:'Aufgaben', anki:'Anki-Vorbereitung', stats:'Statistik', settings:'Semester & Vorlesungen', backup:'Daten & Sicherung', help:'Hilfe & Installation' };
  $('#app').classList.toggle('dashboard-view',view==='dashboard');
  $('#app').innerHTML = `
    <a class="skip-link" href="#main-content">Zum Inhalt</a>
    <aside class="sidebar">
      <a class="brand" href="#dashboard" aria-label="Mein Uni-Cockpit – Übersicht"><span class="brand-mark">${icon('cap')}</span><span>Mein Uni-Cockpit<span class="brand-sub">DEIN STUDIUM. DEIN RHYTHMUS.</span></span></a>
      <div class="semester-picker"><label for="semester-select">DEIN SEMESTER</label><div class="select-wrap"><select id="semester-select" aria-label="Semester auswählen">${state.semesters.map(s=>`<option value="${s.id}" ${s.id === state.selectedSemesterId ? 'selected' : ''}>${esc(s.name)}${s.archived ? ' · Archiviert' : ''}</option>`).join('')}</select>${icon('down')}</div></div>
      <nav class="main-nav" aria-label="Hauptnavigation">${[
        ['dashboard','Übersicht','grid'],['tasks','Aufgaben','tasks'],['anki','Anki-Vorbereitung','cards'],['stats','Statistik','chart']
      ].map(([key,label,symbol])=>`<a href="#${key}" class="nav-item ${view === key ? 'active' : ''}" ${view === key ? 'aria-current="page"' : ''}>${icon(symbol)}<span>${label}</span>${key === 'tasks' && stats.unresolved ? `<span class="nav-count">${stats.unresolved}</span>` : ''}</a>`).join('')}</nav>
      <div class="sidebar-bottom"><p class="nav-caption">DEIN COCKPIT</p>
        <a href="#settings" aria-label="Semester und Vorlesungen" class="nav-item ${view === 'settings' ? 'active' : ''}">${icon('settings')}<span>Semester & Vorlesungen</span></a>
        <a href="#backup" aria-label="Daten und Sicherung" class="nav-item ${view === 'backup' ? 'active' : ''}">${icon('backup')}<span>Daten & Sicherung</span></a>
        <a href="#help" aria-label="Hilfe und Installation" class="nav-item ${view === 'help' ? 'active' : ''}">${icon('help')}<span>Hilfe & Installation</span></a>
        <div class="local-note"><span class="local-dot"></span><div>Dein Studium bleibt bei dir.<small>${cloud?.repository?'Auf Gerät und im Google-Konto':'Auf diesem Gerät gespeichert'}</small></div>${icon('leaf')}</div>
      </div>
    </aside>
    <div class="workspace">
      <header class="topbar"><div class="breadcrumb">Mein Cockpit <span>/</span> <strong>${titles[view]}</strong></div><div class="topbar-right"><span class="connectivity ${navigator.onLine ? '' : 'is-offline'}">${icon('wifi')}<span>${navigator.onLine ? 'Offline nutzbar' : 'Du bist offline'}</span></span><a href="#backup" id="cloud-indicator" class="cloud-indicator">${esc(cloudLabel())}</a>${button('backup','Daten sichern','backup','btn btn-small btn-white')}<span class="avatar" aria-label="Dein persönliches Cockpit">DU</span></div></header>
      <main id="main-content" tabindex="-1">
        ${saveFailed ? `<div class="notice danger">${icon('alert')}<div><strong>Deine letzten Änderungen sind noch nicht dauerhaft gespeichert.</strong><p>Exportiere jetzt eine Sicherung und prüfe, ob dein Browser Speicherplatz zulässt.</p></div>${button('export','JSON sichern','backup')}</div>` : ''}
        ${renderCloudNotice()}
        ${s.archived ? `<div class="notice">${icon('archive')}<div><strong>Du siehst ein archiviertes Semester.</strong><p>Alle Daten bleiben erhalten und können weiter bearbeitet werden.</p></div></div>` : ''}
        ${{dashboard:renderDashboard,tasks:renderTasks,anki:renderAnki,stats:renderStats,settings:renderSettings,backup:renderBackup,help:renderHelp}[view]()}
      </main>
      <footer class="page-footer"><span>Mit klarem Kopf durchs Semester.</span><span>Mein Uni-Cockpit <span class="footer-dot">·</span> Version 2.2.1</span></footer>
    </div>`;
  for(const id of openedDetails){const detail=document.getElementById(id);if(detail)detail.open=true;}
  queueMicrotask(pollDeadlineAlarm);
  if(view==='help')queueMicrotask(checkOffline);
  if (active && document.getElementById(active)) {
    document.getElementById(active).focus({ preventScroll: true });
    if (typeof selection === 'number' && document.activeElement.setSelectionRange && document.activeElement.type === 'search') document.activeElement.setSelectionRange(selection, selection);
  }
}
function pageHeading(kicker, title, description, action = '') {
  return `<div class="page-heading"><div><p class="eyebrow">${kicker}</p><h1>${title}</h1><p class="page-description">${description}</p></div>${action}</div>`;
}
function progress(done, total, cls = '') {
  return `<progress class="progress ${cls}" max="${total || 1}" value="${done}" aria-label="${done} von ${total} erledigt"></progress>`;
}
function renderDashboard() {
  const s = semester(), stats = statistics(s.lectures);
  const today = new Intl.DateTimeFormat('de-DE', { weekday:'long', day:'numeric', month:'long' }).format(new Date());
  const upcoming = s.lectures.flatMap(l=>l.tasks.filter(t=>taskStatus(t)==='open' && t.dueAt && Date.parse(t.dueAt)>Date.now()).map(t=>({l,t}))).sort((a,b)=>Date.parse(a.t.dueAt)-Date.parse(b.t.dueAt)).slice(0,4);
  const unresolved = s.lectures.flatMap(l=>l.tasks.filter(t=>taskStatus(t)==='unresolved').map(t=>({l,t})));
  const undated = s.lectures.flatMap(l=>l.tasks).filter(t=>taskStatus(t)==='open' && !t.dueAt).length;
  return `${pageHeading(esc(today).toUpperCase(), 'Dein Semester, gut sortiert.', 'Abgaben im Blick. Karteikarten vorbereitet. Mehr Platz im Kopf.', button('new-task','Aufgabe hinzufügen','plus','btn btn-primary'))}
    <div class="semester-line"><span class="semester-pill">${icon('calendar')}${esc(s.name)}</span><span>${s.lectures.length} Vorlesungen<span class="small-dot">·</span>Dein persönlicher Überblick</span></div>
    <div class="metric-grid">
      ${metric('check','Abgegeben',`${stats.submitted}<small>/ ${stats.total}</small>`,'Aufgaben erledigt','green')}
      ${metric('clock','Noch offen',stats.open,'Schritt für Schritt','blue')}
      ${metric('alert','Zu klären',stats.unresolved,stats.unresolved ? 'Bitte Abgabestatus prüfen' : 'Alles auf dem Schirm','orange')}
      ${metric('cards','Anki vorbereitet',stats.ankiTotal ? percent(stats.ankiDone/stats.ankiTotal*100) : '–',stats.ankiTotal ? `${stats.ankiDone} von ${stats.ankiTotal} Checklistenpunkten` : 'Noch keine Unterrichtswochen','violet')}
    </div>
    ${unresolved.length ? `<div class="notice danger">${icon('alert')}<div><strong>${unresolved.length} ${unresolved.length === 1 ? 'Abgabe ist' : 'Abgaben sind'} noch ungeklärt.</strong><p>Bestätige, ob du abgegeben oder die Frist versäumt hast. Dein nächster Countdown läuft weiter.</p></div>${button('unresolved','Jetzt klären','arrow','btn btn-white')}</div>` : ''}
    <div class="dashboard-columns"><div class="dashboard-main">
      <div class="section-heading"><div><h2>Deine nächsten Abgaben <span class="count-pill">${s.lectures.length}</span></h2><p>Eine Vorlesung, ein Countdown. Du behältst den Überblick.</p></div>${button('new-task','<span class="sr-only">Aufgabe hinzufügen</span>','plus','btn btn-primary mobile-add-task')}</div>
      <div class="countdown-grid">${s.lectures.length ? s.lectures.map(countdownCard).join('') : empty('book','Platz für dein Semester','Füge deine erste Vorlesung hinzu.',button('new-lecture','Vorlesung hinzufügen','plus','btn btn-primary'))}</div>
      <div class="legend" aria-label="Countdown-Farben"><span><i class="dot blue"></i>Mehr als 5 Tage</span><span><i class="dot orange"></i>2–5 Tage</span><span><i class="dot red"></i>Unter 2 Tagen</span><span><i class="dot green"></i>Keine offene Frist</span></div>
      ${deadlineAlarmControls()}
      <section class="panel next-panel"><div class="panel-heading"><h2>Was als Nächstes ansteht</h2><a href="#tasks" class="text-link">Alle Aufgaben ${icon('arrow')}</a></div>
        ${upcoming.length ? `<div class="upcoming-list">${upcoming.map(({l,t})=>`<button class="upcoming-item" data-action="edit-task" data-lecture="${l.id}" data-task="${t.id}"><time datetime="${esc(t.dueAt)}" class="date-tile">${new Date(t.dueAt).getDate()}<small>${new Intl.DateTimeFormat('de-DE',{month:'short'}).format(new Date(t.dueAt))}</small></time><span class="upcoming-content"><strong>${esc(t.title)}</strong><small>${esc(l.name)}</small></span><span class="upcoming-time">${new Intl.DateTimeFormat('de-DE',{hour:'2-digit',minute:'2-digit'}).format(new Date(t.dueAt))} Uhr${icon('chevron')}</span></button>`).join('')}</div>` : `<div class="calm-empty">${icon('calendar')}<div><strong>Deine Termine haben hier ihren Platz.</strong><p>${undated ? `Für ${undated} offene Aufgaben ist noch keine Abgabefrist eingetragen.` : 'Aktuell steht keine zukünftige Abgabe an.'}</p></div>${button('tasks','Termine eintragen','arrow','text-link')}</div>`}
      </section>
    </div><aside class="dashboard-rail">
      <section class="anki-teaser"><div class="teaser-top"><span class="teaser-icon">${icon('cards')}</span><span class="mini-label">GUT VORBEREITET</span></div><h2>Kleine Häkchen. <br>Gutes Gefühl.</h2><p>Halte fest, welche Karteikarten du erstellt oder importiert hast. Das Wiederholen übernimmt Anki.</p><div class="teaser-progress"><span>Deine Vorbereitung</span><strong>${stats.ankiDone} / ${stats.ankiTotal}</strong></div>${progress(stats.ankiDone,stats.ankiTotal)}<a href="#anki" class="teaser-link">Zur Anki-Vorbereitung ${icon('arrow')}</a></section>
      <section class="getting-started"><p class="eyebrow">DEIN START INS SEMESTER</p><h3>Alles beginnt mit dem<br>ersten Termin.</h3><ol><li><span class="step-number done">${icon('check')}</span><div><strong>Semester auswählen</strong><small>Deine Vorlesungen sind angelegt.</small></div></li><li><span class="step-number ${undated === 0 && stats.total ? 'done' : ''}">2</span><div><strong>Fristen eintragen</strong><small>Direkt aus deinem ILIAS-Kurs.</small></div></li><li><span class="step-number">3</span><div><strong>In deinem Tempo loslegen</strong><small>Eine Aufgabe nach der anderen.</small></div></li></ol></section>
    </aside></div>`;
}
function metric(symbol, label, value, hint, tone) {
  return `<div class="metric-card"><div class="metric-top"><span>${label}</span><span class="metric-icon ${tone}">${icon(symbol)}</span></div><div class="metric-value">${value}</div><p>${hint}</p></div>`;
}
function countdownCard(l) {
  const c = lectureCountdown(l), stats = statistics([l]);
  const urgent=c.kind==='deadline' && isUrgentDeadline(c.task);
  const activeTask=c.task||l.tasks.find(t=>taskStatus(t)==='open');
  const content = c.target ? `<p class="countdown-label"><span class="deadline-kind">${c.kind === 'release' ? 'NÄCHSTE FREISCHALTUNG' : 'NÄCHSTE ABGABE'}</span> <span>· ${esc(c.task.title)}</span></p><div class="countdown-digits" data-target="${c.target}">${digits(c.target)}</div><p class="countdown-date">${icon('calendar')}${fmtDate(c.target)}</p>${c.kind==='deadline' && c.task.releaseAt && Date.parse(c.task.releaseAt)>Date.now() ? `<p class="release-note">Freischaltung: ${fmtDate(c.task.releaseAt)}</p>` : ''}` : `<div class="countdown-empty"><span class="countdown-empty-icon">${icon(c.kind === 'unresolved' ? 'alert' : 'calendar')}</span><h3>${c.kind === 'unresolved' ? 'Eine Rückfrage bleibt.' : l.tasks.some(t=>taskStatus(t)==='open' && !t.dueAt) ? 'Bereit für deine Termine.' : 'Gerade alles im Grünen.'}</h3><p>${c.kind === 'unresolved' ? 'Bitte kläre die überfälligen Abgaben.' : l.tasks.some(t=>taskStatus(t)==='open' && !t.dueAt) ? 'Trage deine erste Abgabefrist ein.' : 'Aktuell steht keine offene Abgabe an.'}</p></div>`;
  return `<article class="countdown-card tone-${c.color}${urgent?' deadline-urgent':''}"><div class="course-heading">${courseIcon(l)}<h3>${esc(l.name)}</h3>${button('edit-lecture',`<span class="sr-only">${esc(l.name)} bearbeiten</span>`,'edit','icon-button',`data-lecture="${l.id}"`)}</div>${urgent?`<p class="urgent-badge">${icon('alert')}Abgabe in höchstens 24 Stunden</p>`:''}${content}
    ${c.unresolved.length ? `<button class="overdue-warning" data-action="course-unresolved" data-lecture="${l.id}">${icon('alert')}${c.unresolved.length} überfällige ${c.unresolved.length === 1 ? 'Abgabe' : 'Abgaben'} zu klären ${icon('arrow')}</button>` : ''}
    ${activeTask?coursePreparation(l,activeTask):''}
    <div class="course-bottom"><span>${stats.submitted} von ${stats.total} abgegeben${!l.countKnown ? ' · Anzahl noch offen' : ''}</span>${button('course-tasks', c.target ? 'Aufgaben ansehen' : 'Aufgaben & Termine','arrow','text-link',`data-lecture="${l.id}"`)}</div>${progress(stats.submitted,stats.total)}
  </article>`;
}
function digits(target) { const c = countdownParts(target); return `<span>${String(c.days).padStart(2,'0')}<small>Tage</small></span><i>:</i><span>${String(c.hours).padStart(2,'0')}<small>Stunden</small></span><i>:</i><span>${String(c.minutes).padStart(2,'0')}<small>Minuten</small></span>`; }
function coursePreparation(l,t){
  const parts=t.parts||[],pdf=t.steps.find(step=>step.label==='Quiz als PDF umformatiert');
  return `<details id="preparation-${l.id}" class="course-preparation"><summary><span>Teilaufgaben & Vorbereitung</span><small>${parts.filter(p=>p.done).length+(pdf?.done?1:0)}/${parts.length+(pdf?1:0)}</small>${icon('down')}</summary><div class="preparation-body"><p class="preparation-task">${esc(t.title)}</p>${parts.map(p=>`<label class="check-item ${p.done?'checked':''}"><input id="part-${p.id}" type="checkbox" data-task-part="${esc(p.id)}" data-lecture="${l.id}" data-task="${t.id}" ${p.done?'checked':''}><span>${esc(p.label)}</span></label>`).join('')}${pdf?`<label class="check-item pdf-check ${pdf.done?'checked':''}"><input id="pdf-${t.id}" type="checkbox" data-prep-step="${esc(pdf.label)}" data-lecture="${l.id}" data-task="${t.id}" ${pdf.done?'checked':''}><span>${esc(pdf.label)}</span></label>`:''}${button('course-add-part','Teilaufgabe hinzufügen','plus','btn btn-small btn-white',`data-lecture="${l.id}" data-task="${t.id}"`)}</div></details>`;
}
function partFields(parts){
  return parts.map(p=>`<div class="part-edit-row" data-part-id="${esc(p.id)}"><label class="part-check"><input type="checkbox" name="part-done-${esc(p.id)}" ${p.done?'checked':''} aria-label="${esc(p.label)} erledigt"></label><input type="text" name="part-label-${esc(p.id)}" value="${esc(p.label)}" maxlength="200" required aria-label="Bezeichnung der Teilaufgabe"></div>`).join('');
}
function readTaskParts(){
  return [...$('#task-parts').querySelectorAll('[data-part-id]')].map(row=>{
    const label=row.querySelector('input[type=text]').value.trim();
    if(!label)throw new Error('Bitte benenne jede Teilaufgabe.');
    return {id:row.dataset.partId,label,done:row.querySelector('input[type=checkbox]').checked};
  });
}
function addTaskPart(){
  const current=$('#task-parts'),count=current.querySelectorAll('[data-part-id]').length;
  if(count>=50){toast('Bis zu 50 Teilaufgaben pro Abgabe sind möglich.');return;}
  current.insertAdjacentHTML('beforeend',partFields([{id:uid(),label:`Aufgabe ${count+1}`,done:false}]));
  current.lastElementChild.querySelector('input[type=text]').focus();scheduleTaskAutosave();
}
function lectureOptions(selected = '') { return `<option value="">Alle Vorlesungen</option>${semester().lectures.map(l=>`<option value="${l.id}" ${selected===l.id?'selected':''}>${esc(l.name)}</option>`).join('')}`; }
function renderTasks() {
  return `${pageHeading('SCHRITT FÜR SCHRITT', 'Deine Aufgaben.', 'Von der Freischaltung bis zur Bewertung – alles an einem Ort.',button('new-task','Aufgabe hinzufügen','plus','btn btn-primary'))}
    <div class="filter-bar"><label class="search-field">${icon('search')}<input id="task-search" type="search" placeholder="Aufgabe suchen …" aria-label="Aufgabe suchen" value="${esc(search)}"></label><select id="lecture-filter" aria-label="Nach Vorlesung filtern">${lectureOptions(filterLecture)}</select><select id="status-filter" aria-label="Nach Abgabestatus filtern"><option value="">Alle Statuswerte</option>${Object.entries(STATUS).map(([key,label])=>`<option value="${key}" ${filterStatus===key?'selected':''}>${label}</option>`).join('')}</select></div>
    <p class="helper-text">Zeiten gelten in deiner Gerätezeitzone (${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)}). Ein Häkchen in der Bearbeitung bestätigt noch keine Abgabe.</p>
    <div id="task-groups">${taskGroups()}</div>`;
}
function taskGroups() {
  let total = 0;
  const groups = semester().lectures.filter(l=>!filterLecture || filterLecture===l.id).map(l=>{
    const tasks = l.tasks.filter(t=>(!filterStatus || taskStatus(t)===filterStatus) && (!search || `${t.number} ${t.title} ${l.name}`.toLocaleLowerCase('de').includes(search.toLocaleLowerCase('de'))));
    total += tasks.length;
    if (!tasks.length) return '';
    return `<section class="panel task-group"><div class="panel-heading"><div class="inline-course">${courseIcon(l)}<h2>${esc(l.name)}</h2></div><span class="muted">${tasks.length} Aufgaben</span></div><div class="task-table"><div class="task-table-head"><span>AUFGABE</span><span>ABGABE</span><span>STATUS</span><span>BEARBEITUNG</span><span></span></div>${tasks.map(t=>{
      const status = taskStatus(t), done = [...t.steps,...(t.parts||[])].filter(s=>s.done).length;
      return `<button class="task-row" data-action="edit-task" data-lecture="${l.id}" data-task="${t.id}"><span class="task-name"><span class="task-number">${String(t.number).padStart(2,'0')}</span><span><strong>${esc(t.title)}</strong>${t.releaseAt && Date.parse(t.releaseAt)>Date.now() ? `<small>Freischaltung: ${fmtDate(t.releaseAt)}</small>` : `<small>${t.score === null ? 'Noch keine Bewertung' : `${t.score} %`}${t.passed === null ? '' : t.passed ? ' · Bestanden' : ' · Nicht bestanden'}</small>`}</span></span><span class="task-date">${t.dueAt ? fmtDate(t.dueAt) : '<span class="muted">Termin eintragen</span>'}${status==='open' && t.dueAt ? `<small class="task-remaining ${urgency(t.dueAt)}">${compactCountdown(t.dueAt)}</small>` : ''}</span><span>${statusBadge(status)}</span><span class="task-progress">${progress(done,t.steps.length+(t.parts?.length||0))}<small>${done}/${t.steps.length+(t.parts?.length||0)}</small></span>${icon('chevron')}</button>`;
    }).join('')}</div></section>`;
  }).join('');
  return total ? groups : empty('tasks','Hier ist noch Platz.','Keine Aufgaben für diese Auswahl gefunden.',button('new-task','Aufgabe hinzufügen','plus','btn btn-primary'));
}
function compactCountdown(target) { const p = countdownParts(target); return `${p.days} T ${p.hours} Std ${p.minutes} Min`; }
function renderAnki() {
  const lectures = semester().lectures.filter(l=>!filterLecture || l.id===filterLecture);
  return `${pageHeading('VORBEREITEN. ABHAKEN. DURCHATMEN.', 'Platz für deine Karteikarten.', 'Hier erfasst du nur, was du erstellt oder importiert hast. Gelernt wird in Anki.',button('new-week','Unterrichtswoche hinzufügen','plus','btn btn-primary'))}
    <div class="filter-bar"><label for="anki-lecture" class="filter-label">Vorlesung</label><select id="anki-lecture">${lectureOptions(filterLecture)}</select></div>
    ${lectures.length ? lectures.map(l=>{ const st=statistics([l]); return `<section class="anki-course"><div class="section-heading"><div class="inline-course">${courseIcon(l)}<div><h2>${esc(l.name)}</h2><p>${st.ankiDone} von ${st.ankiTotal} Checklistenpunkten vorbereitet</p></div></div>${button('new-week','Woche hinzufügen','plus','btn btn-white',`data-lecture="${l.id}"`)}</div>
      ${l.weeks.length ? `<div class="weeks-grid">${l.weeks.map(w=>`<article class="panel week-card"><div class="week-heading"><h3>${esc(w.label)}</h3>${button('edit-week','<span class="sr-only">Unterrichtswoche bearbeiten</span>','edit','icon-button',`data-lecture="${l.id}" data-week="${w.id}"`)}</div>${w.items.map((i,index)=>`<label class="check-item ${i.done?'checked':''}"><input id="anki-${w.id}-${index}" type="checkbox" data-anki="${index}" data-lecture="${l.id}" data-week="${w.id}" ${i.done?'checked':''}><span>${esc(i.label)}</span></label>`).join('')}<div class="week-footer">${w.items.filter(i=>i.done).length} / ${w.items.length} erstellt oder importiert</div></article>`).join('')}</div>` : `<div class="panel">${empty('cards','Die erste Woche wartet auf dich.','Lege eine Unterrichtswoche an und hake deine vorbereiteten Karten ab.',button('new-week','Erste Woche anlegen','plus','btn btn-white',`data-lecture="${l.id}"`))}</div>`}</section>`; }).join('') : empty('book','Noch keine Vorlesung','Lege zunächst eine Vorlesung an.',button('new-lecture','Vorlesung hinzufügen','plus','btn btn-primary'))}`;
}
function renderStats() {
  const s = semester(), st = statistics(s.lectures);
  return `${pageHeading('DEIN FORTSCHRITT ZÄHLT', 'Ein Blick aufs Ganze.', `Deine Aufgaben und deine Anki-Vorbereitung im ${esc(s.name)}.`)}
    ${statsPanel(st,'Das gesamte Semester','semester-summary')}
    <p class="helper-text stats-explanation">Abgabequote = abgegebene Aufgaben ÷ alle angelegten Aufgaben. Der Bewertungsdurchschnitt berücksichtigt nur eingetragene Bewertungen. Bestandene Aufgaben werden ausdrücklich markiert; es gibt keine angenommene Bestehensgrenze.</p>
    <div class="stats-course-grid">${s.lectures.map(l=>`<section class="panel"><div class="panel-heading inline-course">${courseIcon(l)}<h2>${esc(l.name)}</h2></div>${!l.countKnown ? '<p class="unknown-count">Die Gesamtzahl steht noch nicht fest. Die Statistik zählt aktuell angelegte Aufgaben.</p>' : ''}${statsPanel(statistics([l]),'', 'course-summary')}</section>`).join('')}</div>`;
}
function statsPanel(s,title,cls) {
  return `<div class="stats-panel ${cls}">${title?`<h2>${title}</h2>`:''}<div class="stats-overview"><div class="quote-ring"><strong>${percent(s.submissionRate)}</strong><span>Abgabequote</span></div><div class="stats-counts">${[['Gesamtzahl',s.total],['Abgegeben',s.submitted],['Nicht abgegeben',s.missed],['Noch offen',s.open],['Frist überschritten – ungeklärt',s.unresolved],['Bestanden',s.passed]].map(([label,value])=>`<div><span>${label}</span><strong>${value}</strong></div>`).join('')}</div></div><div class="stats-bottom"><div><span>Durchschnittliche Bewertung</span><strong>${s.average === null ? 'Noch keine Bewertung' : percent(s.average)}</strong><small>${s.graded} bewertete Aufgaben</small></div><div><span>Anki-Vorbereitung</span><strong>${s.ankiDone} / ${s.ankiTotal}</strong>${progress(s.ankiDone,s.ankiTotal)}</div></div></div>`;
}
function renderSettings() {
  const s = semester();
  return `${pageHeading('EIN PLATZ FÜR JEDES SEMESTER', 'Dein Studium wächst mit.', 'Frühere Semester, Aufgaben und Ergebnisse bleiben erhalten.',button('new-semester','Semester anlegen','plus','btn btn-primary'))}
    <section class="panel"><div class="panel-heading"><h2>Deine Semester</h2><span class="muted">${state.semesters.length} gespeichert</span></div><div class="semester-list">${state.semesters.map(item=>`<div class="semester-row"><span class="semester-symbol">${icon(item.archived?'archive':'calendar')}</span><div><strong>${esc(item.name)}</strong><small>${item.lectures.length} Vorlesungen${item.archived?' · Archiviert':''}${item.id===s.id?' · Ausgewählt':''}</small></div><div class="row-actions">${item.id!==s.id ? button('select-semester','Öffnen','','btn btn-small btn-white',`data-semester="${item.id}"`) : ''}${button('edit-semester','<span class="sr-only">Semester umbenennen</span>','edit','icon-button',`data-semester="${item.id}"`)}${button('archive-semester',item.archived?'Wiederherstellen':'Archivieren','archive','btn btn-small btn-quiet',`data-semester="${item.id}"`)}</div></div>`).join('')}</div></section>
    <section class="settings-courses"><div class="section-heading"><div><h2>Vorlesungen in diesem Semester</h2><p>${esc(s.name)}</p></div>${button('new-lecture','Vorlesung hinzufügen','plus','btn btn-white')}</div><div class="settings-course-grid">${s.lectures.map(l=>`<article class="panel settings-course"><div class="course-heading">${courseIcon(l)}<h3>${esc(l.name)}</h3></div><p>${l.tasks.length} Aufgaben${l.countKnown?'':' · Gesamtzahl noch offen'}<span class="small-dot">·</span>${l.weeks.length} Anki-Wochen</p><div class="row-actions">${button('edit-lecture','Verwalten','settings','btn btn-white',`data-lecture="${l.id}"`)}${button('course-tasks','Aufgaben','arrow','text-link',`data-lecture="${l.id}"`)}</div></article>`).join('') || empty('book','Noch keine Vorlesungen','Füge deine Vorlesungen für dieses Semester hinzu.')}</div></section>
    <div class="notice">${icon('leaf')}<div><strong>Ein neues Semester, ein frischer Start.</strong><p>Beim Anlegen kannst du die Vorlesungsstruktur aus einem früheren Semester übernehmen. Termine, Ergebnisse, Notizen und Anki-Häkchen werden dabei zurückgesetzt.</p></div></div>`;
}
function renderBackup() {
  return `${pageHeading('DEINE DATEN GEHÖREN DIR', 'Gut gesichert. Gut aufgehoben.', 'Lokal weiterarbeiten, mit deinem Google-Konto abgleichen und zusätzlich sichern.')}
    ${renderCloudPanel()}
    <div class="backup-grid"><section class="panel backup-card"><span class="large-icon green">${icon('backup')}</span><h2>Eine Sicherung für alles.</h2><p>Exportiere Vorlesungen, Aufgaben, Abgaben, Bewertungen und Anki-Checklisten gemeinsam als JSON-Datei.</p>${button('export','Sicherung herunterladen','backup','btn btn-primary')}<small>Alle ${state.semesters.length} Semester · ohne Konto nutzbar</small></section><section class="panel backup-card"><span class="large-icon blue">${icon('upload')}</span><h2>Wieder da, wo du warst.</h2><p>Stelle eine Sicherung wieder her oder übertrage deinen aktuellen Stand auf dein Smartphone oder Tablet.</p>${button('import','JSON-Datei auswählen','upload','btn btn-white')}<small>Vor dem Ersetzen siehst du eine Zusammenfassung.</small></section></div>
    <div class="notice">${icon('cloud')}<div><strong>Synchronisierung und Sicherung ergänzen sich.</strong><p>Mit demselben Google-Konto werden deine Änderungen automatisch zwischen Geräten abgeglichen. Offline-Änderungen warten auf Internet. Die letzten zehn Cloud-Stände lassen sich wiederherstellen. Eine zusätzliche JSON-Datei außerhalb der App schützt auch bei Verlust des Kontos oder Projekts.</p></div></div>
    <section class="panel text-panel"><h2>Was „auf diesem Gerät gespeichert“ bedeutet</h2><p>Deine Einträge bleiben nach dem Schließen erhalten. Sie liegen im Browser für diese Internetadresse. Ein anderer Browser, eine andere Adresse oder ein anderes Gerät hat einen eigenen Speicher.</p><p>Beim Löschen von Website-Daten, im privaten Modus oder beim Zurücksetzen des Geräts können Einträge verloren gehen. Lade deshalb regelmäßig eine Sicherung herunter und bewahre sie zum Beispiel in deinem eigenen Cloudspeicher auf.</p><p><strong>Zuletzt gespeichert:</strong> ${fmtDate(state.updatedAt)}${saveFailed?' · Speichern fehlgeschlagen':''}</p>${button('persistent-storage','Dauerhaften Browserspeicher anfragen','check','btn btn-white')}</section>`;
}
function cloudLabel(){
  if(saveFailed)return 'Speicherung prüfen';
  if(cloud?.user && !navigator.onLine)return 'Offline · lokal gespeichert';
  return ({loading:'Cloud wird geprüft …',local:'Nur auf diesem Gerät',setup:'Gerätestand auswählen',
    pending:'Lokal gespeichert · Abgleich folgt',editing:'Abgleich nach Bearbeitung',syncing:'Wird synchronisiert …',
    synced:'Mit Google synchronisiert',offline:'Offline · Abgleich wartet',conflict:'Änderungen vergleichen',error:'Cloud-Verbindung prüfen'})[cloud?.status||'loading'];
}
function renderCloudNotice(){
  let content='';
  if(cloud?.status==='setup')content=`<div class="notice">${icon('cloud')}<div><strong>Dein Google-Konto ist verbunden. Wähle einmal den Startstand.</strong><p>Deine bisherigen lokalen Daten bleiben erhalten.</p></div>${button('backup','Übernahme einrichten','arrow','btn btn-white')}</div>`;
  else if(cloud?.status==='conflict')content=`<div class="notice danger">${icon('alert')}<div><strong>Zwei Geräte haben dieselbe Angabe geändert.</strong><p>Es wird nichts still überschrieben. Vergleiche die Änderungen und wähle die passenden Werte.</p></div>${button('cloud-conflict','Änderungen prüfen','arrow','btn btn-white')}</div>`;
  else if(cloud?.status==='error' && cloud.user)content=`<div class="notice danger">${icon('alert')}<div><strong>Der Cloud-Abgleich wartet.</strong><p>${esc(cloud.detail)}</p></div>${button('backup','Verbindung prüfen','arrow','btn btn-white')}</div>`;
  else if(!cloud?.user && view==='dashboard')content=`<div class="notice cloud-intro">${icon('cloud')}<div><strong>Dein Cockpit auf Smartphone und Tablet.</strong><p>Verbinde dein Google-Konto, um automatisch zu synchronisieren. Dein lokaler Stand bleibt erhalten.</p></div>${button('cloud-login','Mit Google verbinden','','btn btn-white')}</div>`;
  return `<div id="cloud-notice">${content}</div>`;
}
function renderCloudPanel(){
  const c=cloud;
  const account=c?.user?`<p class="cloud-account">Angemeldet als <strong>${esc(c.user.email||c.user.displayName||'Google-Nutzerin')}</strong></p>`:'';
  let controls='',detail=c?.detail||'';
  if(c?.status==='setup'){
    const remote=c.pending?.remote;
    detail=remote?'In deinem Google-Konto ist bereits ein Stand vorhanden. Auf dem zweiten Gerät wählst du normalerweise „Cloudstand verwenden“.':'Im Google-Konto ist noch kein Stand vorhanden. Übernimm jetzt die Einträge dieses Geräts. Die ursprüngliche lokale Kopie bleibt bestehen.';
    controls=remote?`${button('cloud-use-remote','Cloudstand verwenden','cloud','btn btn-primary')}${button('cloud-add-local','Lokale Semester zusätzlich übernehmen','plus','btn btn-white')}`:button('cloud-use-local','Diesen Gerätestand übernehmen','upload','btn btn-primary');
  }else if(c?.repository){
    controls=`${button('cloud-retry','Jetzt abgleichen','cloud','btn btn-white')}${button('cloud-backups','Frühere Cloud-Stände','archive','btn btn-white')}${button('cloud-logout','Abmelden','','btn btn-quiet')}`;
    if(c.status==='conflict')controls=button('cloud-conflict','Änderungen vergleichen','alert','btn btn-primary')+controls;
    if(!detail)detail=c.status==='synced'?'Alle gespeicherten Änderungen sind in deinem Google-Konto angekommen. Nutze auf dem anderen Gerät dasselbe Konto.':c.status==='editing'?'Deine offene Bearbeitung wird nicht durch Änderungen eines anderen Geräts ersetzt. Nach dem Schließen wird weiter abgeglichen.':'Deine Änderungen bleiben auf diesem Gerät gespeichert und werden bei Internetverbindung automatisch abgeglichen.';
  }else if(c?.user){
    controls=`${button('cloud-retry','Verbindung erneut prüfen','cloud','btn btn-primary')}${button('cloud-logout','Abmelden','','btn btn-white')}`;
  }else controls=button('cloud-login','Mit Google anmelden','','btn btn-primary');
  return `<section id="cloud-panel" class="panel cloud-panel"><div class="cloud-heading"><span class="large-icon green">${icon('cloud')}</span><div><h2>Dein Cockpit, auf beiden Geräten.</h2><p class="cloud-status" role="status">${esc(cloudLabel())}</p></div></div>${account}<p>${esc(detail||'Melde dich mit Google an. Beim ersten Mal entscheidest du, ob du deinen bisherigen Gerätestand übernehmen möchtest. Ohne Anmeldung bleibt alles lokal nutzbar.')}</p><div class="row-actions">${controls}</div><p class="helper-text">Die Anmeldung bleibt auf diesem Gerät gespeichert. Nutze sie auf deinem eigenen Smartphone oder Tablet. Beim Abmelden bleiben lokale Kontokopien im Browserspeicher; auf einem fremden Gerät entferne anschließend die Website-Daten.</p></section>`;
}
function refreshCloudUI(){
  const indicator=$('#cloud-indicator');if(indicator)indicator.textContent=cloudLabel();
  const notice=$('#cloud-notice');if(notice)notice.outerHTML=renderCloudNotice();
  const panel=$('#cloud-panel');if(panel)panel.outerHTML=renderCloudPanel();
}
function switchRepository(next){
  if(!next)return;
  repository=next;
  if($('#modal').open){deferredCloud=true;toast('Ein neuer Kontostand ist bereit. Schließe die Bearbeitung, um ihn anzuzeigen.');return;}
  try{
    state=repository.load();const preparationAdded=ensurePreparation(state);loadError=null;saveFailed=false;filterLecture='';filterStatus='';
    if(reconcileDeadlines(state)||preparationAdded)persist();
    render();
  }catch(error){loadError=error;render();}
}
function readableConflict(value){
  if(value===undefined)return 'Gelöscht';
  if(value===null)return 'Noch nicht eingetragen';
  if(typeof value==='boolean')return value?'Ja':'Nein';
  if(value && typeof value==='object' && value.status)return `${STATUS[value.status]||value.status}${value.submittedAt?' · '+fmtDate(value.submittedAt):''}`;
  return typeof value==='object'?JSON.stringify(value,null,2):String(value);
}
function showCloudConflict(){
  const c=cloud?.engine?.conflict;if(!c){toast('Derzeit gibt es keinen Konflikt.');return;}
  const full=c.kind==='initial'||!!c.error;
  showModal('Änderungen vergleichen',`<div class="modal-body"><p>Beide Stände bleiben bis zu deiner Entscheidung erhalten. Du kannst sie zuerst als JSON herunterladen.</p><div class="row-actions">${button('cloud-export-local','Gerätestand sichern','backup','btn btn-white')}${button('cloud-export-remote','Cloudstand sichern','backup','btn btn-white')}</div>${full?'<p class="helper-text">Hier ist eine Auswahl des vollständigen Stands nötig. Sichere beide Dateien, bevor du einen Stand übernimmst.</p>':`<p class="helper-text">Unterschiedliche Änderungen werden zusammengeführt. Deine Auswahl betrifft nur die folgenden konkurrierenden Angaben:</p>${c.conflicts.map(x=>`<div class="conflict-item"><h3>${esc(x.path)}</h3><dl><dt>Dieses Gerät</dt><dd>${esc(readableConflict(x.local))}</dd><dt>Cloud / anderes Gerät</dt><dd>${esc(readableConflict(x.remote))}</dd></dl></div>`).join('')}`}<div class="cloud-conflict-actions">${button('cloud-conflict-local',full?'Gesamten Gerätestand übernehmen':'Bei Konflikten dieses Gerät bevorzugen','check','btn btn-primary')}${button('cloud-conflict-remote',full?'Gesamten Cloudstand übernehmen':'Bei Konflikten die Cloud bevorzugen','cloud','btn btn-white')}${button('close-modal','Später entscheiden','','btn btn-quiet')}</div><p id="cloud-action-error" class="form-error" role="alert"></p></div>`,{type:'cloud-conflict'});
}
async function handleCloudAction(action,b){
  try{
    if(action==='cloud-login'){await cloud.login();return;}
    if(action==='cloud-retry'){cloud.retry();return;}
    if(action==='cloud-use-remote'||action==='cloud-use-local'){cloud.choose(action==='cloud-use-remote'?'remote':'local');return;}
    if(action==='cloud-add-local'){
      showModal('Lokale Semester zusätzlich übernehmen',`<div class="modal-body"><p>Alle Semester dieses Geräts werden zusätzlich zu den Cloud-Semestern übernommen. Bei gleichen Namen entsteht eine zusätzliche Kopie. Der ursprüngliche Gerätestand bleibt lokal erhalten.</p><p>Wenn du auf diesem Gerät noch keine eigenen Einträge hast, verwende stattdessen den vorhandenen Cloudstand.</p><div class="row-actions">${button('cloud-add-local-confirm','Zusätzliche Semester übernehmen','plus','btn btn-primary')}${button('close-modal','Abbrechen','','btn btn-white')}</div><p id="cloud-action-error" class="form-error" role="alert"></p></div>`,{type:'cloud-add'});return;
    }
    if(action==='cloud-add-local-confirm'){$('#modal').close();cloud.choose('add');return;}
    if(action==='cloud-logout'){
      if(cloud.repository?.dirty){showModal('Mit offenen Änderungen abmelden?',`<div class="modal-body"><p>Einige Änderungen sind noch nicht in der Cloud angekommen. Sie bleiben in der lokalen Kopie dieses Google-Kontos erhalten und werden erst nach erneutem Anmelden abgeglichen.</p><div class="row-actions">${button('export','Vorher JSON sichern','backup','btn btn-white')}${button('cloud-logout-confirm','Trotzdem abmelden','','btn btn-danger')}${button('close-modal','Weiterarbeiten','','btn btn-white')}</div></div>`,{type:'cloud-logout'});return;}
      await cloud.logout();return;
    }
    if(action==='cloud-logout-confirm'){$('#modal').close();await cloud.logout();return;}
    if(action==='cloud-conflict'){showCloudConflict();return;}
    if(action==='cloud-export-local'||action==='cloud-export-remote'){
      const c=cloud.engine.conflict,data=action==='cloud-export-local'?c.local:c.remote.state;
      downloadBlob(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),`uni-cockpit-${action.endsWith('local')?'geraet':'cloud'}-${new Date().toISOString().slice(0,10)}.json`);return;
    }
    if(action==='cloud-conflict-local'||action==='cloud-conflict-remote'){
      const c=cloud.engine.conflict;
      cloud.engine.resolve(action.endsWith('local')?'local':'remote',{whole:c.kind==='initial'||!!c.error});
      $('#modal').close();return;
    }
    if(action==='cloud-backups'){
      toast('Frühere Cloud-Stände werden geladen …');cloudBackups=await cloud.transport.backups();
      showModal('Frühere Cloud-Stände',`<div class="modal-body"><p>Hier stehen bis zu zehn vorherige Cloud-Stände. Bei vielen Änderungen können sie kurz hintereinander liegen. Lade wichtige Sicherungen zusätzlich als JSON herunter.</p>${cloudBackups.length?cloudBackups.map((backup,index)=>`<div class="cloud-backup-row"><div><strong>Cloudstand ${backup.version}</strong><small>${fmtDate(backup.savedAt)} · ${backup.state.semesters.length} Semester</small></div>${button('cloud-download-backup','JSON','backup','btn btn-small btn-white',`data-backup="${index}"`)}${button('cloud-restore','Wiederherstellen','','btn btn-small btn-white',`data-backup="${index}"`)}</div>`).join(''):'<p class="helper-text">Nach der ersten Änderung eines vorhandenen Cloudstands erscheint hier dessen Vorgängerversion.</p>'}${button('close-modal','Schließen','','btn btn-white')}</div>`,{type:'cloud-backups'});return;
    }
    if(action==='cloud-download-backup'){
      const backup=cloudBackups[Number(b.dataset.backup)];downloadBlob(new Blob([JSON.stringify(backup.state,null,2)],{type:'application/json'}),`uni-cockpit-cloudstand-${backup.version}.json`);return;
    }
    if(action==='cloud-restore'){
      const backup=cloudBackups[Number(b.dataset.backup)];
      showModal('Früheren Stand wiederherstellen?',`<div class="modal-body"><p>Cloudstand ${backup.version} ersetzt deinen gesamten aktuellen Kontostand. Nach dem nächsten erfolgreichen Abgleich wird er auch auf anderen angemeldeten Geräten sichtbar. Der vorherige Cloudstand wird dabei in den zehn Wiederherstellungsständen aufbewahrt.</p><div class="row-actions">${button('export','Aktuellen Stand zuerst sichern','backup','btn btn-white')}${button('cloud-restore-confirm','Stand wiederherstellen','archive','btn btn-primary',`data-backup="${b.dataset.backup}"`)}${button('close-modal','Abbrechen','','btn btn-white')}</div><p id="cloud-action-error" class="form-error" role="alert"></p></div>`,{type:'cloud-restore'});return;
    }
    if(action==='cloud-restore-confirm'){
      const candidate=structuredClone(cloudBackups[Number(b.dataset.backup)].state);
      repository.save(candidate,{replace:true});state=repository.load();reconcileDeadlines(state);persist();
      $('#modal').close();render();toast('Stand lokal wiederhergestellt. Der Cloud-Abgleich folgt.');return;
    }
  }catch(error){const field=$('#cloud-action-error');if(field)field.textContent=error.message;else toast(error.message,true);}
}
$('#modal').addEventListener('close',()=>{
  clearTimeout(taskAutosaveTimer);
  if(deferredCloud){deferredCloud=false;switchRepository(repository);}
  else if(!loadError)render();
  cloud?.engine?.wake(0);
});
function renderHelp() {
  return `${pageHeading('DEIN COCKPIT KENNENLERNEN', 'Einfach anfangen.', 'Alles Wichtige für deinen Start – auch ohne Programmierkenntnisse.')}
    <div class="help-grid"><section class="panel text-panel"><h2>Auf Android installieren</h2><ol><li>Öffne deine veröffentlichte HTTPS-Adresse in Chrome.</li><li>Tippe auf das Menü mit den drei Punkten.</li><li>Wähle „App installieren“ oder „Zum Startbildschirm hinzufügen“.</li><li>Öffne das Cockpit über das neue Symbol. Nach dem ersten Laden funktioniert es auch offline.</li></ol>${installEvent ? button('install','App installieren','plus','btn btn-primary') : '<p class="helper-text">Der Browser entscheidet, wann die Installation angeboten wird. Auf dem Startbildschirm kann die App bereits installiert sein.</p>'}<p class="helper-text" id="offline-state">Offline-Cache wird geprüft …</p></section>
    <section class="panel text-panel"><h2>So startest du</h2><ol><li>Wähle links beziehungsweise oben dein Semester.</li><li>Öffne unter „Aufgaben“ eine Aufgabe und trage die echten ILIAS-Termine ein.</li><li>Nutze die Bearbeitungscheckliste und bestätige deine Abgabe mit dem tatsächlichen Zeitpunkt.</li><li>Ergänze Bewertung und Bestehensstatus, sobald du sie kennst.</li><li>Lege im Anki-Bereich Unterrichtswochen an und hake erstellte oder importierte Karten ab.</li></ol></section>
    <section class="panel text-panel"><h2>Was passiert nach einer Frist?</h2><p>Eine offene Aufgabe wird als „Frist überschritten – ungeklärt“ markiert. Bestätige anschließend „Abgegeben“ mit dem tatsächlichen Abgabezeitpunkt oder „Nicht abgegeben“.</p><p>Die große Karte zeigt weiterhin die nächste zukünftige Frist. Die Warnung für ungeklärte Aufgaben bleibt sichtbar. Beim nächsten Öffnen der App werden auch Fristen berücksichtigt, die während des Schließens abgelaufen sind.</p></section>
    <section class="panel text-panel"><h2>Deine Countdown-Farben</h2><ul class="help-colors"><li><i class="dot blue"></i>Blau: mehr als 5 Tage</li><li><i class="dot orange"></i>Orange: 2 bis einschließlich 5 Tage</li><li><i class="dot red"></i>Rot: weniger als 2 Tage oder nur noch ungeklärte Abgaben</li><li><i class="dot green"></i>Grün: keine offene Frist und keine ungeklärte Überfälligkeit</li></ul><p>„Grün“ kann auch bedeuten, dass du noch keine Fristen eingetragen hast. Das steht dann ausdrücklich auf der Karte.</p></section></div>`;
}
function showModal(title, content, context) {
  modalContext = {...context,openedRevision:state?.revision,repositoryKey:repository?.key};
  $('#modal').innerHTML = `<div class="modal-top"><h2 id="modal-title">${title}</h2>${button('close-modal','<span class="sr-only">Schließen</span>','close','icon-button')}</div>${content}`;
  if (!$('#modal').open) $('#modal').showModal();
  $('#modal').scrollTop = 0;
}
const modalFooter = (label = 'Speichern') => `<p id="form-error" role="alert" class="form-error"></p><div class="modal-footer">${button('close-modal','Abbrechen','','btn btn-white')}<button class="btn btn-primary" type="submit">${icon('check')}${label}</button></div>`;
function openTask(lectureId, taskId = null) {
  const l = lectureById(lectureId) || semester().lectures[0];
  if (!l) { openLecture(); return; }
  const existing = taskId ? l.tasks.find(t=>t.id===taskId) : null;
  const t = existing || makeTask(Math.max(0,...l.tasks.map(t=>t.number))+1, l.template);
  const status = taskStatus(t);
  showModal(existing ? 'Aufgabe & Abgabe' : 'Neue Aufgabe', `<form id="task-form"><div class="modal-body">
    <label class="form-field">Vorlesung<select name="lecture" ${existing?'disabled':''}>${semester().lectures.map(v=>`<option value="${v.id}" ${l.id===v.id?'selected':''}>${esc(v.name)}</option>`).join('')}</select></label>
    <div class="form-grid number-title"><label class="form-field">Nummer<input name="number" type="number" min="1" max="9999" required value="${t.number}"></label><label class="form-field">Titel<input name="title" maxlength="300" required value="${esc(t.title)}"></label></div>
    <div class="form-grid"><label class="form-field">Freischaltung<input name="releaseAt" type="datetime-local" value="${fieldDate(t.releaseAt)}"></label><label class="form-field">Abgabefrist<input name="dueAt" type="datetime-local" value="${fieldDate(t.dueAt)}"></label></div>
    <p class="helper-text">Optional. Zeiten in ${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)}. Es werden keine Termine vorausgefüllt.</p>
    <section class="form-section"><div class="parts-heading"><h3>Teilaufgaben</h3><span>Einzeln abhaken</span></div><div id="task-parts">${partFields(t.parts||[])}</div>${button('task-add-part','Teilaufgabe hinzufügen','plus','btn btn-small btn-white')}<p class="helper-text">Aufgabe 1, 2, 3 … Benenne sie bei Bedarf genauer. Weitere Aufgaben kannst du jederzeit ergänzen. Häkchen bestätigen noch keine Abgabe.</p></section>
    <section class="form-section"><h3>Bearbeitungsschritte</h3><div id="task-steps">${taskStepFields(t.steps)}</div><p class="helper-text">Diese Häkchen dokumentieren deine Bearbeitung. Bestätige die Abgabe zusätzlich unten.</p></section>
    <section class="form-section"><h3>Abgabe & Ergebnis</h3><label class="form-field">Abgabestatus<select name="status" id="task-status">${Object.entries(STATUS).map(([key,label])=>`<option value="${key}" ${status===key?'selected':''}>${label}</option>`).join('')}</select></label><div id="submission-field" ${status!=='submitted'?'hidden':''}><label class="form-field">Tatsächlicher Abgabezeitpunkt<input type="datetime-local" name="submittedAt" id="submitted-at" value="${fieldDate(t.submittedAt)}" ${status==='submitted'?'required':''}></label>${button('submitted-now','Jetzt als abgegeben bestätigen','check','btn btn-small btn-white')}<p class="helper-text">Für frühere Abgaben trage bitte den tatsächlichen Zeitpunkt ein.</p></div>
    <div class="form-grid"><label class="form-field">Bewertung in Prozent<input name="score" type="number" min="0" max="100" step="0.01" placeholder="Noch nicht bekannt" value="${t.score ?? ''}"></label><label class="form-field">Bestanden?<select name="passed"><option value="" ${t.passed===null?'selected':''}>Noch nicht bekannt</option><option value="true" ${t.passed===true?'selected':''}>Bestanden</option><option value="false" ${t.passed===false?'selected':''}>Nicht bestanden</option></select></label></div></section>
    <label class="form-field">ILIAS-Link (optional)<input name="link" type="url" maxlength="2000" placeholder="https://…" value="${esc(t.link)}"></label>${t.link?`<a href="${esc(t.link)}" target="_blank" rel="noopener noreferrer" class="text-link">In ILIAS öffnen ${icon('link')}</a>`:''}
    <label class="form-field">Notizen<textarea name="notes" rows="3" maxlength="20000" placeholder="Was möchtest du dir merken?">${esc(t.notes)}</textarea></label>
    ${existing ? button('delete-task','Aufgabe löschen','','btn btn-small btn-danger',`data-lecture="${l.id}" data-task="${t.id}"`) : ''}
    <p id="task-autosave" class="helper-text" role="status">Änderungen werden automatisch auf diesem Gerät gespeichert, sobald alle Angaben gültig sind. Der Cloud-Abgleich folgt nach dem Schließen.</p>
    </div>${modalFooter('Speichern & schließen')}</form>`, {type:'task',lectureId:l.id,taskId:existing?.id,draft:t});
  $('#task-form [data-action="close-modal"]').textContent='Schließen';
}
function taskStepFields(steps) { return steps.map((step,index)=>`<label class="check-item"><input type="checkbox" name="step-${index}" ${step.done?'checked':''}><span>${esc(step.label)}</span></label>`).join(''); }
function openLecture(id) {
  const l = id ? lectureById(id) : null;
  showModal(l?'Vorlesung verwalten':'Neue Vorlesung', `<form id="lecture-form"><div class="modal-body"><label class="form-field">Vollständiger Vorlesungsname<input name="name" maxlength="300" required value="${esc(l?.name || '')}" placeholder="Name deiner Vorlesung"></label><label class="form-field">Checklisten-Vorlage<select name="template" ${l?'disabled':''}>${Object.entries(TEMPLATES).map(([key,v])=>`<option value="${key}" ${l?.template===key?'selected':''}>${v.name}</option>`).join('')}</select></label><label class="form-field">${l?'Gewünschte Gesamtzahl der Aufgaben':'Anzahl der Aufgaben (optional)'}<input name="count" type="number" min="${l?.tasks.length || 0}" max="500" placeholder="Noch offen" value="${l?.countKnown ? l.tasks.length : ''}"></label><p class="helper-text">${l ? `Aktuell ${l.tasks.length} Aufgaben. Eine höhere Zahl ergänzt leere Aufgaben. Bestehende Aufgaben bleiben erhalten; einzelne Aufgaben kannst du in deren Detailansicht löschen.` : 'Lass die Anzahl leer, wenn sie noch nicht feststeht. Du kannst später Aufgaben ergänzen.'}</p>${l?button('delete-lecture','Vorlesung mit allen Daten löschen','','btn btn-small btn-danger',`data-lecture="${l.id}"`):''}</div>${modalFooter()}</form>`, {type:'lecture',id});
}
function openSemester(id) {
  const s = id ? state.semesters.find(s=>s.id===id) : null;
  showModal(s?'Semester umbenennen':'Neues Semester', `<form id="semester-form"><div class="modal-body"><label class="form-field">Semestername<input name="name" required maxlength="200" placeholder="z. B. Wintersemester 2027/2028" value="${esc(s?.name || '')}"></label>${!s?`<label class="form-field">Vorlesungsstruktur übernehmen (optional)<select name="copy"><option value="">Mit leerem Semester starten</option>${state.semesters.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label><p class="helper-text">Übernommen werden Vorlesungen, Aufgabentitel und Bearbeitungsschritte. Termine, Status, Abgabezeitpunkte, Bewertungen, Notizen und Anki-Wochen werden nicht übernommen.</p>`:''}</div>${modalFooter(s?'Speichern':'Semester anlegen')}</form>`,{type:'semester',id});
}
function openWeek(lectureId, weekId) {
  if (!semester().lectures.length) { openLecture(); return; }
  const l = lectureById(lectureId) || lectureById(filterLecture) || semester().lectures[0];
  const w = weekId ? l.weeks.find(w=>w.id===weekId) : null;
  showModal(w?'Unterrichtswoche bearbeiten':'Unterrichtswoche hinzufügen', `<form id="week-form"><div class="modal-body"><label class="form-field">Vorlesung<select name="lecture" ${w?'disabled':''}>${semester().lectures.map(v=>`<option value="${v.id}" ${l.id===v.id?'selected':''}>${esc(v.name)}</option>`).join('')}</select></label><label class="form-field">Bezeichnung<input name="label" required maxlength="200" value="${esc(w?.label || `Unterrichtswoche ${l.weeks.length+1}`)}"></label><p class="helper-text">Jede Woche erhält eine eigene Checkliste für erstellte oder importierte Karteikarten.</p>${w?button('delete-week','Unterrichtswoche löschen','','btn btn-small btn-danger',`data-lecture="${l.id}" data-week="${w.id}"`):''}</div>${modalFooter()}</form>`,{type:'week',lectureId:l.id,weekId:w?.id});
}
function confirmDelete(kind, target) {
  const labels={task:'diese Aufgabe und alle ihre Einträge',lecture:'diese Vorlesung mit allen Aufgaben, Ergebnissen und Anki-Wochen',week:'diese Unterrichtswoche mit ihren Anki-Häkchen'};
  showModal('Wirklich löschen?', `<form id="delete-form"><div class="modal-body"><p>Du löschst ${labels[kind]}. Das lässt sich nur mit einer vorherigen JSON-Sicherung wiederherstellen.</p></div>${modalFooter('Endgültig löschen')}</form>`, {type:'delete',kind,...target});
}
function exportData() {
  const blob = new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
  downloadBlob(blob,`mein-uni-cockpit-${new Date().toISOString().slice(0,10)}.json`);
  toast('Sicherung erstellt. Bitte prüfe deinen Download-Ordner.');
}
function downloadBlob(blob,filename) {
  const url=URL.createObjectURL(blob),a=document.createElement('a'); a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function importData() {
  const input=document.createElement('input');input.type='file';input.accept='.json,application/json';
  input.addEventListener('change',async()=>{
    const file=input.files[0];if(!file)return;
    try {
      if(file.size>10*1024*1024)throw new Error('Die Datei ist größer als 10 MB.');
      const candidate=validateState(JSON.parse(await file.text()));
      const courses=candidate.semesters.flatMap(s=>s.lectures), tasks=courses.flatMap(l=>l.tasks);
      showModal('Sicherung wiederherstellen',`<form id="import-form"><div class="modal-body"><p>Diese Datei enthält <strong>${candidate.semesters.length} Semester, ${courses.length} Vorlesungen und ${tasks.length} Aufgaben</strong>.</p><p>Stand der Datei: ${fmtDate(candidate.updatedAt)}</p><div class="notice danger"><div><strong>Der gesamte lokale Stand wird ersetzt.</strong><p>Es findet keine Zusammenführung statt. Lade vorher eine Sicherung dieses Geräts herunter.</p></div></div>${!loadError?button('export','Aktuellen Stand zuerst sichern','backup','btn btn-white'):''}<label class="check-item import-confirm"><input type="checkbox" name="confirmed" required><span>Ich möchte den aktuellen Stand durch diese Datei ersetzen.</span></label></div>${modalFooter('Sicherung übernehmen')}</form>`,{type:'import',candidate});
    } catch(error) { toast(error instanceof SyntaxError?'Die Datei enthält kein gültiges JSON.':error.message,true); }
  });input.click();
}
function renderRecovery() {
  $('#app').innerHTML=`<main class="recovery"><span class="brand-mark">${icon('cap')}</span><h1>Deine Daten brauchen einen Blick.</h1><p>Der gespeicherte Stand konnte nicht gelesen werden. Er wird nicht überschrieben.</p><p>Du kannst die gespeicherten Rohdaten sichern, eine gültige JSON-Sicherung importieren oder den Zugriff nach einem Browserneustart erneut versuchen.</p><div class="row-actions">${button('raw-export','Rohdaten herunterladen','backup','btn btn-primary')}${button('import','Sicherung importieren','upload','btn btn-white')}</div><p class="helper-text">${esc(loadError.message)}</p></main>`;
}
function navigate(next, lecture = '', status = '') { filterLecture=lecture;filterStatus=status;search=''; if(location.hash===`#${next}`){view=next;render();}else location.hash=next; }
document.addEventListener('click', async event=>{
  const b=event.target.closest('[data-action]');if(!b)return;
  const action=b.dataset.action,lid=b.dataset.lecture,tid=b.dataset.task;
  if(action==='close-modal'){closeModalSafely();return;}
  if(action==='discard-task-input'){modalContext.autoDirty=false;$('#modal').close();return;}
  if(action==='export'){exportData();return;}
  if(action==='import'){importData();return;}
  if(action.startsWith('cloud-')){await handleCloudAction(action,b);return;}
  if(action==='raw-export'){
    try { const raw=localStorage.getItem(repository?.key||STORAGE_KEY);if(raw===null)throw new Error('Keine Rohdaten vorhanden.');downloadBlob(new Blob([raw],{type:'application/json'}),'uni-cockpit-rohdaten.json'); }catch(error){toast(error.message,true);}return;
  }
  if(action==='task-add-part'){addTaskPart();return;}
  if(action==='course-add-part'){openTask(lid,tid);addTaskPart();return;}
  if(action==='new-task'){openTask(lid||filterLecture);return;}
  if(action==='edit-task'){openTask(lid,tid);return;}
  if(action==='new-lecture'){openLecture();return;}
  if(action==='edit-lecture'){openLecture(lid);return;}
  if(action==='new-semester'){openSemester();return;}
  if(action==='edit-semester'){openSemester(b.dataset.semester);return;}
  if(action==='new-week'){openWeek(lid);return;}
  if(action==='edit-week'){openWeek(lid,b.dataset.week);return;}
  if(action==='delete-task'||action==='delete-lecture'||action==='delete-week'){confirmDelete(action.replace('delete-',''),{lectureId:lid,taskId:tid,weekId:b.dataset.week});return;}
  if(action==='submitted-now'){$('#task-status').value='submitted';$('#submission-field').hidden=false;$('#submitted-at').required=true;$('#submitted-at').value=fieldDate(new Date().toISOString());scheduleTaskAutosave();return;}
  if(action==='course-tasks'){navigate('tasks',lid);return;}
  if(action==='course-unresolved'){navigate('tasks',lid,'unresolved');return;}
  if(action==='tasks'){navigate('tasks');return;}
  if(action==='unresolved'){navigate('tasks','','unresolved');return;}
  if(action==='backup'){navigate('backup');return;}
  if(action==='select-semester'){state.selectedSemesterId=b.dataset.semester;filterLecture='';filterStatus='';commit();return;}
  if(action==='archive-semester'){const s=state.semesters.find(s=>s.id===b.dataset.semester);s.archived=!s.archived;commit(s.archived?'Semester archiviert. Alle Daten bleiben erhalten.':'Semester wiederhergestellt.');return;}
  if(action==='persistent-storage'){
    const granted=await navigator.storage?.persist?.();toast(granted?'Dein Browser hat dauerhaften Speicher zugesagt. Regelmäßige Sicherungen bleiben sinnvoll.':'Dein Browser hat dauerhaften Speicher nicht zugesagt. Sichere regelmäßig als JSON.');return;
  }
  if(action==='toggle-deadline-alarm'){await toggleDeadlineAlarm();return;}
  if(action==='install' && installEvent){await installEvent.prompt();installEvent=null;render();}
});
document.addEventListener('change',event=>{
  const el=event.target;
  if(el.id==='semester-select'){state.selectedSemesterId=el.value;filterLecture='';filterStatus='';search='';commit();}
  if(el.id==='lecture-filter'||el.id==='anki-lecture'){filterLecture=el.value;render();}
  if(el.id==='status-filter'){filterStatus=el.value;render();}
  if(el.id==='task-status'){$('#submission-field').hidden=el.value!=='submitted';$('#submitted-at').required=el.value==='submitted';}
  if(el.closest('#task-form') && el.name==='lecture' && !modalContext.taskId){
    const l=lectureById(el.value),steps=TEMPLATES[l.template].steps.map(label=>({label,done:false}));
    modalContext.draft.steps=steps;$('#task-steps').innerHTML=taskStepFields(steps);
    const number=Math.max(0,...l.tasks.map(t=>t.number))+1;
    $('#task-form').elements.number.value=number;$('#task-form').elements.title.value=`${TEMPLATES[l.template].unit} ${number}`;
  }
  if(el.dataset.taskPart!==undefined || el.dataset.prepStep!==undefined){
    const l=lectureById(el.dataset.lecture),t=l.tasks.find(t=>t.id===el.dataset.task);
    const item=el.dataset.taskPart!==undefined?t.parts.find(p=>p.id===el.dataset.taskPart):t.steps.find(step=>step.label===el.dataset.prepStep);
    if(item){item.done=el.checked;commit();}
  }
  if(el.dataset.anki!==undefined){
    const l=lectureById(el.dataset.lecture),w=l.weeks.find(w=>w.id===el.dataset.week);w.items[Number(el.dataset.anki)].done=el.checked;commit();
  }
  if(el.closest('#task-form'))scheduleTaskAutosave();
});
document.addEventListener('input',event=>{if(event.target.id==='task-search'){search=event.target.value;$('#task-groups').innerHTML=taskGroups();}if(event.target.closest('#task-form'))scheduleTaskAutosave();});
function scheduleTaskAutosave(){
  clearTimeout(taskAutosaveTimer);modalContext.autoDirty=true;
  if($('#task-autosave'))$('#task-autosave').textContent='Änderungen werden gespeichert …';
  taskAutosaveTimer=setTimeout(()=>flushTaskAutosave(),750);
}
function flushTaskAutosave(){
  clearTimeout(taskAutosaveTimer);const form=$('#task-form');if(!form||!modalContext?.autoDirty)return;
  if(!form.checkValidity()){$('#task-autosave').textContent='Noch nicht gespeichert: Bitte vervollständige die markierten Pflichtangaben.';return;}
  form.dataset.autosaving='true';form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));delete form.dataset.autosaving;
}
function closeModalSafely(){
  if(modalContext?.type==='task'&&modalContext.autoDirty){
    flushTaskAutosave();
    if(modalContext.autoDirty){
      const field=$('#form-error');if(field&&!field.textContent)field.textContent='Einige Eingaben sind noch nicht gespeichert. Bitte korrigiere sie oder verwirf diese ungespeicherten Eingaben ausdrücklich.';
      if(!$('#discard-task-input'))$('#task-autosave').insertAdjacentHTML('afterend','<button id="discard-task-input" type="button" class="btn btn-small btn-danger" data-action="discard-task-input">Ungespeicherte Eingaben verwerfen</button>');
      return;
    }
  }
  $('#modal').close();
}
$('#modal').addEventListener('cancel',event=>{if(modalContext?.type==='task'&&modalContext.autoDirty){event.preventDefault();closeModalSafely();}});
document.addEventListener('submit',event=>{
  const form=event.target;if(!form.closest('#modal'))return;event.preventDefault();
  const data=new FormData(form),ctx=modalContext;
  try {
    if(['task-form','lecture-form','semester-form','week-form','delete-form'].includes(form.id) && (ctx.repositoryKey!==repository.key || ctx.openedRevision!==repository.load().revision))throw new Error('Der Datenstand wurde in einem anderen Fenster oder Gerät geändert. Kopiere ungespeicherte Texte und öffne die Bearbeitung erneut.');
    if(form.id==='task-form'){
      const l=lectureById(ctx.taskId?ctx.lectureId:data.get('lecture'));
      if(!ctx.taskId && l.tasks.length>=500)throw new Error('Maximal 500 Aufgaben pro Vorlesung.');
      const t=ctx.taskId?l.tasks.find(t=>t.id===ctx.taskId):ctx.draft;
      const releaseAt=isoDate(data.get('releaseAt')),dueAt=isoDate(data.get('dueAt')),status=data.get('status');
      if(releaseAt&&dueAt&&Date.parse(releaseAt)>Date.parse(dueAt))throw new Error('Die Freischaltung muss vor oder auf der Abgabefrist liegen.');
      const submittedAt=status==='submitted'?isoDate(data.get('submittedAt')):null;
      if(status==='submitted'&&!submittedAt)throw new Error('Bitte gib den tatsächlichen Abgabezeitpunkt an.');
      if(submittedAt&&Date.parse(submittedAt)>Date.now()+60_000)throw new Error('Der tatsächliche Abgabezeitpunkt darf nicht in der Zukunft liegen.');
      if(status==='unresolved'&&(!dueAt||Date.parse(dueAt)>Date.now()))throw new Error('„Ungeklärt“ setzt eine abgelaufene Abgabefrist voraus.');
      const link=String(data.get('link')).trim();
      if(link&&!['https:','http:'].includes(new URL(link).protocol))throw new Error('Bitte verwende einen HTTP- oder HTTPS-Link.');
      const title=String(data.get('title')).trim();if(!title)throw new Error('Bitte gib einen Titel ein.');
      const number=Number(data.get('number'));if(l.tasks.some(v=>v.id!==t.id&&v.number===number))throw new Error('Diese Aufgabennummer ist in der Vorlesung schon vergeben.');
      Object.assign(t,{number,title,releaseAt,dueAt,status,submittedAt,score:data.get('score')===''?null:Number(data.get('score')),passed:data.get('passed')===''?null:data.get('passed')==='true',notes:String(data.get('notes')),link,
        parts:readTaskParts(),steps:t.steps.map((step,index)=>({...step,done:data.has(`step-${index}`)}))});
      if(!ctx.taskId)l.tasks.push(t);
      l.tasks.sort((a,b)=>a.number-b.number);reconcileDeadlines(state);
    } else if(form.id==='lecture-form'){
      const name=String(data.get('name')).trim();if(!name)throw new Error('Bitte gib den vollständigen Vorlesungsnamen ein.');
      const count=data.get('count')===''?null:Number(data.get('count'));
      if(ctx.id){
        const l=lectureById(ctx.id);l.name=name;
        if(count!==null){let number=Math.max(0,...l.tasks.map(t=>t.number));while(l.tasks.length<count)l.tasks.push(makeTask(++number,l.template));l.countKnown=true;}
        else l.countKnown=false;
      }else{if(semester().lectures.length>=100)throw new Error('Maximal 100 Vorlesungen pro Semester.');const l=makeLecture(name,data.get('template'),count||0);l.countKnown=count!==null;semester().lectures.push(l);}
    } else if(form.id==='semester-form'){
      const name=String(data.get('name')).trim();if(!name)throw new Error('Bitte gib einen Semesternamen ein.');
      if(ctx.id)state.semesters.find(s=>s.id===ctx.id).name=name;
      else{if(state.semesters.length>=100)throw new Error('Maximal 100 Semester.');const source=state.semesters.find(s=>s.id===data.get('copy'));const s={id:uid(),name,archived:false,lectures:source?copyLectureStructure(source.lectures):[]};state.semesters.push(s);state.selectedSemesterId=s.id;filterLecture='';filterStatus='';}
    } else if(form.id==='week-form'){
      const l=lectureById(ctx.weekId?ctx.lectureId:data.get('lecture')),label=String(data.get('label')).trim();if(!label)throw new Error('Bitte benenne die Unterrichtswoche.');
      if(ctx.weekId)l.weeks.find(w=>w.id===ctx.weekId).label=label;
      else{if(l.weeks.length>=100)throw new Error('Maximal 100 Unterrichtswochen pro Vorlesung.');l.weeks.push({id:uid(),label,items:TEMPLATES[l.template].anki.map(label=>({label,done:false}))});}
    } else if(form.id==='delete-form'){
      const l=lectureById(ctx.lectureId);
      if(ctx.kind==='task')l.tasks=l.tasks.filter(t=>t.id!==ctx.taskId);
      if(ctx.kind==='week')l.weeks=l.weeks.filter(w=>w.id!==ctx.weekId);
      if(ctx.kind==='lecture'){semester().lectures=semester().lectures.filter(l=>l.id!==ctx.lectureId);if(filterLecture===ctx.lectureId)filterLecture='';}
    } else if(form.id==='import-form'){
      if(!data.has('confirmed'))return;
      const candidate=ctx.candidate;ensurePreparation(candidate);reconcileDeadlines(candidate);
      try { if(!repository)repository=new LocalRepository();repository.save(candidate,{replace:true});cloud?.changed(); }
      catch { throw new Error('Die Sicherung konnte nicht gespeichert werden. Der bisherige Stand bleibt erhalten. Bitte prüfe den Browserspeicher.'); }
      state=candidate;loadError=null;saveFailed=false;filterLecture='';filterStatus='';search='';$('#modal').close();render();toast('Sicherung wiederhergestellt.');return;
    }
    if(form.id==='task-form'&&form.dataset.autosaving){
      if(!ctx.taskId){ctx.taskId=ctx.draft.id;ctx.lectureId=data.get('lecture');form.elements.lecture.disabled=true;}
      const saved=persist();
      ctx.openedRevision=state.revision;ctx.autoDirty=!saved;
      $('#task-autosave').textContent=saved?'Auf diesem Gerät gespeichert. Der Cloud-Abgleich folgt nach dem Schließen.':'Noch nicht dauerhaft gespeichert. Bitte sichere deine Daten.';
      if(saved){$('#form-error').textContent='';$('#discard-task-input')?.remove();}
      return;
    }
    $('#modal').close();commit('Gespeichert.');
  }catch(error){$('#form-error').textContent=error.message;if(form.id==='task-form'&&$('#task-autosave'))$('#task-autosave').textContent='Diese Änderungen sind noch nicht gespeichert.';}
});
window.addEventListener('hashchange',()=>{const next=location.hash.slice(1);view=['dashboard','tasks','anki','stats','settings','backup','help'].includes(next)?next:'dashboard';render();window.scrollTo(0,0);if(view==='help')checkOffline();});
window.addEventListener('online',()=>{cloud?.onlineChanged();render();});window.addEventListener('offline',()=>{cloud?.onlineChanged();render();});
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installEvent=event;if(view==='help')render();});
window.addEventListener('appinstalled',()=>{installEvent=null;toast('Dein Uni-Cockpit ist installiert.');});
window.addEventListener('storage',event=>{
  if(event.key===repository?.key){
    if($('#modal').open || saveFailed){toast('Daten wurden in einem anderen Fenster geändert. Schließe die Bearbeitung und lade diese Seite neu, bevor du weiterarbeitest.',true);return;}
    try{state=repository.load();filterLecture='';render();cloud?.changed();}catch{toast('Der Stand aus dem anderen Fenster konnte nicht gelesen werden.',true);}
  }
});
function refreshTime(){
  pollDeadlineAlarm();
  if(loadError || $('#modal').open)return;
  if(reconcileDeadlines(state)){persist();render();}
  else{document.querySelectorAll('[data-target]').forEach(el=>{el.innerHTML=digits(el.dataset.target);});if(view==='dashboard')render();if(view==='tasks'&&!$('#modal').open)$('#task-groups').innerHTML=taskGroups();}
}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){refreshTime();cloud?.engine?.wake(0);}});
setInterval(refreshTime,30_000);
async function checkOffline(){
  if(!$('#offline-state'))return;
  try{const keys=await caches.keys();$('#offline-state').textContent=keys.some(k=>k.startsWith('uni-cockpit-'))?'Die App-Dateien sind offline gespeichert.':'Noch kein Offline-Cache vorhanden. Öffne die App über HTTPS und lade sie einmal vollständig.';}
  catch{$('#offline-state').textContent='Offline-Cache in diesem Browser nicht verfügbar.';}
}
if(!loadError){ensurePreparation(state);reconcileDeadlines(state);persist();}
const start=location.hash.slice(1);if(['tasks','anki','stats','settings','backup','help'].includes(start))view=start;
cloud=new CloudSession({guestRepository,onSwitch:switchRepository,onStatus:refreshCloudUI,canApply:()=>!$('#modal').open&&!saveFailed});
render();
cloud.start();
if('serviceWorker' in navigator){navigator.serviceWorker.register('./sw.js').then(()=>navigator.serviceWorker.ready).then(checkOffline).catch(()=>toast('Die Offline-Funktion ist noch nicht bereit. Öffne die App über HTTPS oder localhost.',true));}
if(view==='help')checkOffline();
