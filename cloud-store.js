import { validateState } from './model.js';
import { STORAGE_KEY } from './storage.js';
import { mergeStates, sameContent, cloudPayload } from './sync.js';

// State + common ancestor + remote version are one atomic localStorage value.
// Unsent changes therefore survive an app restart, including a restart offline.
export class CloudRepository {
  constructor(userId, storage=globalThis.localStorage) {
    this.storage=storage; this.key=`${STORAGE_KEY}:account:${userId}`;
  }
  exists(){return this.storage.getItem(this.key)!==null;}
  envelope(){
    const raw=this.storage.getItem(this.key);
    if(raw===null)throw new Error('Dieser Kontostand ist auf dem Gerät noch nicht eingerichtet.');
    const value=JSON.parse(raw);
    validateState(value.state);
    if(value.base!==null)validateState(value.base);
    if(value.format!==1 || !Number.isSafeInteger(value.version) || value.version<0 || value.version>0 && value.base===null)throw new Error('Der lokale Synchronisierungsstand ist beschädigt. Bitte sichere die Rohdaten.');
    return value;
  }
  load(){return structuredClone(this.envelope().state);}
  initialize(state,remote=null){
    if(this.exists())throw new Error('Dieser Kontostand ist bereits vorhanden.');
    const value={format:1,state:validateState(state),base:remote?.state||null,version:remote?.version||0,lastSyncedAt:null};
    this.storage.setItem(this.key,JSON.stringify(value));
  }
  save(state,{replace=false}={}){
    const envelope=this.envelope();
    if(!replace && envelope.state.revision!==state.revision)throw new Error('Ein anderes Fenster hat neuere Daten gespeichert. Sichere diesen Stand als JSON und lade die Seite neu.');
    const candidate=validateState({...state,revision:envelope.state.revision+1,updatedAt:new Date().toISOString()});
    if(replace)envelope.recovery=envelope.state;
    envelope.state=candidate;
    this.storage.setItem(this.key,JSON.stringify(envelope));
    Object.assign(state,{revision:candidate.revision,updatedAt:candidate.updatedAt});
  }
  adopt(remote,expectedRevision){
    const envelope=this.envelope();
    if(envelope.state.revision!==expectedRevision)return false;
    const selected=envelope.state.selectedSemesterId;
    const state=validateState({...remote.state,revision:expectedRevision+1,
      selectedSemesterId:remote.state.semesters.some(s=>s.id===selected)?selected:remote.state.selectedSemesterId});
    this.storage.setItem(this.key,JSON.stringify({...envelope,state,base:remote.state,version:remote.version,lastSyncedAt:new Date().toISOString()}));
    return true;
  }
  resolve(state,remote,expectedRevision){
    const envelope=this.envelope();
    if(envelope.state.revision!==expectedRevision)throw new Error('Es gibt inzwischen neue Änderungen. Bitte prüfe den Konflikt erneut.');
    const candidate=validateState({...state,revision:expectedRevision+1,updatedAt:new Date().toISOString()});
    this.storage.setItem(this.key,JSON.stringify({...envelope,recovery:envelope.state,state:candidate,base:remote.state,version:remote.version}));
  }
  get dirty(){const e=this.envelope();return !sameContent(e.state,e.base);}
}

/** A testable coordinator. The transport owns Firebase; this module owns safety.
 * No last-write-wins: a transaction compares the remote version before writing.
 */
export class SyncEngine {
  constructor({repository,transport,onState=()=>{},onStatus=()=>{},canApply=()=>true,isOnline=()=>true}){
    Object.assign(this,{repository,transport,onState,onStatus,canApply,isOnline});
    this.status='pending';this.running=false;this.stopped=false;this.conflict=null;
  }
  statusChanged(status,detail=''){
    this.status=status;this.detail=detail;this.onStatus(status,detail);
  }
  stop(){this.stopped=true;clearTimeout(this.timer);}
  wake(delay=700){
    if(this.stopped)return;
    clearTimeout(this.timer);
    if(!this.isOnline()){this.statusChanged('offline');return;}
    if(this.conflict && this.repository.load().revision!==this.conflict.revision)this.conflict=null;
    if(this.conflict){this.statusChanged('conflict');return;}
    if(this.repository.dirty)this.statusChanged('pending');
    this.timer=setTimeout(()=>this.run(),delay);
  }
  async run(){
    if(this.stopped)return;
    if(this.running){this.requested=true;return;}
    if(!this.isOnline()){this.statusChanged('offline');return;}
    if(!this.canApply()){this.statusChanged('editing');return;}
    if(this.conflict){this.statusChanged('conflict');return;}
    this.running=true;
    try {
      let rounds=0;
      do {
        this.requested=false;
        if(this.stopped || !this.canApply())break;
        this.statusChanged('syncing');
        const remote=await this.transport.read();
        if(this.stopped)break;
        if(!this.canApply()){this.statusChanged('editing');break;}
        const env=this.repository.envelope(),local=env.state;
        if(!remote && env.version>0)throw new Error('Der bisherige Cloudstand fehlt. Er wird nicht automatisch neu angelegt. Bitte prüfe dein Firebase-Projekt.');
        if(remote && remote.version<env.version)throw new Error('Die Cloud enthält eine ältere Version als erwartet. Bitte sichere beide Stände.');
        let candidate=local;
        if(remote && !env.base){
          this.conflict={kind:'initial',local,remote,revision:local.revision};this.statusChanged('conflict');break;
        }
        if(remote){
          const result=mergeStates(env.base,local,remote.state);
          if(result.conflicts.length || result.error){
            this.conflict={kind:'merge',base:env.base,local,remote,revision:local.revision,...result};
            this.statusChanged('conflict',result.error||'');break;
          }
          candidate=result.state;
        }
        if(remote && sameContent(candidate,remote.state)){
          // A read-only refresh must not generate another cloud write.
          if(!sameContent(local,remote.state) || this.repository.dirty || env.version!==remote.version){
            if(this.repository.adopt(remote,local.revision))this.onState(this.repository.load());
            else {this.requested=true;continue;}
          }
          this.requested=this.repository.dirty;
          this.statusChanged(this.requested?'pending':'synced');
        } else {
          cloudPayload(candidate);
          const result=await this.transport.write(remote?.version||0,candidate);
          if(this.stopped)break;
          if(this.repository.adopt(result,local.revision))this.onState(this.repository.load());
          else this.requested=true; // Another local edit happened during the request.
          this.requested ||= this.repository.dirty;
          this.statusChanged(this.requested?'pending':'synced');
        }
      }while(this.requested && ++rounds<5 && this.isOnline());
    }catch(error){
      if(!this.stopped){
        if(error.code==='version-conflict'){this.requested=true;this.statusChanged('pending');}
        else {this.statusChanged(this.isOnline()?'error':'offline',error.message);this.lastError=error;}
      }
    }finally{
      this.running=false;
      if(this.requested && !this.stopped)this.wake(400);
    }
  }
  resolve(preference,{whole=false}={}){
    const c=this.conflict;if(!c)throw new Error('Es gibt keinen offenen Konflikt.');
    const result=c.kind==='initial'||whole?{state:preference==='remote'?c.remote.state:c.local,error:null}:mergeStates(c.base,c.local,c.remote.state,preference);
    if(result.error)throw new Error('Diese Zusammenführung wäre ungültig. Exportiere beide Stände und übernimm anschließend einen vollständigen Stand.');
    this.repository.resolve(result.state,c.remote,c.revision);
    this.conflict=null;this.onState(this.repository.load());this.wake(0);
  }
}
