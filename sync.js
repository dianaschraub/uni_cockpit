import { validateState, uid } from './model.js';

// Document metadata and the selected view are local concerns, not study content.
export const content = state => ({ schemaVersion: state.schemaVersion, semesters: state.semesters });
export const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const sameContent = (a, b) => a !== null && b !== null && equal(content(a), content(b));
const clone = value => value === undefined ? undefined : structuredClone(value);
const labels = { name:'Name', title:'Titel', notes:'Notizen', dueAt:'Abgabefrist', releaseAt:'Freischaltung', score:'Bewertung', passed:'Bestanden', done:'Häkchen', archived:'Archiviert', submission:'Abgabestatus', number:'Nummer', semesters:'Semester', lectures:'Vorlesungen', tasks:'Aufgaben', weeks:'Unterrichtswochen', steps:'Bearbeitung', items:'Anki', countKnown:'Aufgabenanzahl bekannt' };

/** Three-way merge: separate changes combine; competing edits never silently win.
 * Collections use stable IDs, checklists use their template labels. A task's
 * status and actual submission time form one atomic value.
 */
export function mergeStates(base, local, remote, preference = 'local') {
  const conflicts = [];
  function conflict(b, l, r, path) {
    conflicts.push({ path: path.join(' › '), local: clone(l), remote: clone(r) });
    return clone(preference === 'remote' ? r : l);
  }
  function merge(b, l, r, path = []) {
    if (equal(l, r)) return clone(l);
    if (equal(l, b)) return clone(r);
    if (equal(r, b)) return clone(l);
    if (l === undefined || r === undefined || b === undefined) return conflict(b, l, r, path);
    if (Array.isArray(l) && Array.isArray(r) && Array.isArray(b)) {
      const all = [...b,...l,...r];
      const key = all.every(x => x && typeof x.id === 'string') ? 'id' : all.every(x => x && typeof x.label === 'string') ? 'label' : null;
      if (!key) return conflict(b,l,r,path);
      const map = xs => new Map(xs.map(x => [x[key],x]));
      const bm=map(b), lm=map(l), rm=map(r);
      const keys=[...new Set([...r.map(x=>x[key]),...l.map(x=>x[key]),...b.map(x=>x[key])])];
      return keys.map(id => {
        const item=lm.get(id)||rm.get(id)||bm.get(id);
        return merge(bm.get(id),lm.get(id),rm.get(id),[...path,item.name||item.title||item.label||'Eintrag']);
      }).filter(x=>x!==undefined);
    }
    if (l && r && b && typeof l==='object' && typeof r==='object' && typeof b==='object' && !Array.isArray(l) && !Array.isArray(r)) {
      const result={};
      const task = Object.hasOwn(l,'submittedAt') && Object.hasOwn(r,'submittedAt');
      if (task) {
        const pair = x => ({ status:x.status, submittedAt:x.submittedAt });
        const lp=pair(l), rp=pair(r), bp=pair(b);
        // An automatically detected overdue status must not undo an explicit confirmation.
        if (bp.status==='open' && lp.status==='unresolved' && ['submitted','missed'].includes(rp.status)) Object.assign(result,rp);
        else if (bp.status==='open' && rp.status==='unresolved' && ['submitted','missed'].includes(lp.status)) Object.assign(result,lp);
        else if(!equal(lp,rp) && !equal(lp,bp) && !equal(rp,bp)) Object.assign(result,conflict(bp,lp,rp,[...path,'Abgabestatus']));
        else Object.assign(result,equal(lp,bp)?rp:lp);
      }
      for (const key of new Set([...Object.keys(b),...Object.keys(l),...Object.keys(r)])) {
        if (['__proto__','constructor','prototype'].includes(key) || task && ['status','submittedAt'].includes(key)) continue;
        const value=merge(b[key],l[key],r[key],[...path,labels[key]||key]);
        if (value!==undefined) result[key]=value;
      }
      return result;
    }
    return conflict(b,l,r,path);
  }
  const merged=merge(content(base),content(local),content(remote));
  const selected=merged.semesters.some(s=>s.id===local.selectedSemesterId) ? local.selectedSemesterId
    : merged.semesters.some(s=>s.id===remote.selectedSemesterId) ? remote.selectedSemesterId : merged.semesters[0]?.id;
  const result={...merged,revision:local.revision,updatedAt:new Date().toISOString(),selectedSemesterId:selected};
  let error=null;
  try { validateState(result); } catch(e) { error=e.message; }
  return { state:result,conflicts,error };
}

/** Explicit migration adds independent copies rather than matching by course name. */
export function addLocalSemesters(remote, local) {
  const result=structuredClone(remote);
  for(const original of local.semesters) {
    const s=structuredClone(original);s.id=uid();
    if(result.semesters.some(v=>v.name===s.name))s.name=`${s.name.slice(0,170)} (von diesem Gerät)`;
    for(const l of s.lectures){l.id=uid();for(const t of l.tasks)t.id=uid();for(const w of l.weeks)w.id=uid();}
    result.semesters.push(s);
  }
  return validateState(result);
}

export const MAX_CLOUD_BYTES = 800_000;
export function cloudPayload(state) {
  const payload=JSON.stringify(validateState(state));
  if(new TextEncoder().encode(payload).length>MAX_CLOUD_BYTES)throw new Error('Dein Stand ist für diese Cloud-Version zu groß. Deine lokalen Daten bleiben erhalten; bitte exportiere eine JSON-Sicherung.');
  return payload;
}
export function parseCloud(data) {
  if(!data || data.format!==1 || !Number.isSafeInteger(data.version) || data.version<1 || typeof data.payload!=='string' || new TextEncoder().encode(data.payload).length>MAX_CLOUD_BYTES)throw new Error('Der Cloudstand hat ein unbekanntes oder beschädigtes Format. Er wird nicht überschrieben.');
  return {version:data.version,state:validateState(JSON.parse(data.payload)),savedAt:data.updatedAt?.toDate?.().toISOString()||null};
}
