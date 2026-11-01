import { CloudRepository,SyncEngine } from './cloud-store.js';
import { addLocalSemesters } from './sync.js';

/** Account lifecycle is separate from both the UI and the sync algorithm. */
export class CloudSession {
  constructor({guestRepository,onSwitch,onStatus,canApply}){
    Object.assign(this,{guestRepository,onSwitch,onStatus,canApply});
    this.status='loading';this.user=null;this.generation=0;this.repository=null;
  }
  notify(status,detail=''){this.status=status;this.detail=detail;this.onStatus();}
  async start(){
    if(this.starting)return this.starting;
    this.starting=this.initialize();
    try{return await this.starting;}finally{this.starting=null;}
  }
  async initialize(){
    try{
      const {createFirebaseClient,describeFirebaseError}=await import('./firebase-client.js');
      this.errorText=describeFirebaseError;
      this.client=await createFirebaseClient();
      this.client.observe(user=>this.accountChanged(user));
      this.retryTimer ??= setInterval(()=>{
        if(this.user && navigator.onLine && document.visibilityState==='visible' && ['error','offline','pending'].includes(this.status))this.retry();
      },30_000);
    }catch(e){this.notify('error','Google-Anmeldung konnte nicht vorbereitet werden. Die App bleibt lokal nutzbar. '+e.message);}
  }
  async login(){
    if(!this.client){await this.start();if(!this.client)return;}
    try{await this.client.login();}catch(e){this.notify('error',this.errorText(e));}
  }
  async logout(){
    if(!this.client)return;
    try{await this.client.logout();}catch(e){this.notify('error',this.errorText(e));}
  }
  async accountChanged(user){
    this.generation++;
    this.engine?.stop();this.unwatch?.();this.unwatch=null;this.engine=null;
    this.repository=null;this.pending=null;this.user=user;
    if(!user){this.notify('local');this.onSwitch(this.guestRepository);return;}
    if(user.emailVerified===false){this.notify('error','Bitte verwende ein bestätigtes Google-Konto.');return;}
    await this.prepare();
  }
  async prepare(){
    const generation=this.generation,user=this.user;if(!user)return;
    try{
      const repo=new CloudRepository(user.uid),transport=this.client.transport(user.uid);
      this.transport=transport;
      if(repo.exists()){this.attach(repo,transport);return;}
      this.notify('loading','Dein Cloudstand wird geprüft. Der bisherige Gerätestand bleibt erhalten.');
      const remote=await transport.read();
      if(generation!==this.generation)return;
      this.pending={repository:repo,remote};this.notify('setup');
    }catch(e){if(generation===this.generation)this.notify('error',e.message);}
  }
  choose(option){
    const p=this.pending;if(!p)throw new Error('Bitte prüfe den Cloudstand zuerst erneut.');
    const state=p.remote ? option==='add'?addLocalSemesters(p.remote.state,this.guestRepository.load()):p.remote.state : this.guestRepository.load();
    p.repository.initialize(state,p.remote);
    this.pending=null;this.attach(p.repository,this.transport);
  }
  attach(repository,transport){
    this.repository=repository;
    this.onSwitch(repository);
    this.engine=new SyncEngine({repository,transport,canApply:this.canApply,isOnline:()=>navigator.onLine,
      onState:()=>this.onSwitch(repository),onStatus:(status,detail)=>this.notify(status,detail)});
    this.subscribe();this.engine.wake(0);
  }
  subscribe(){
    this.unwatch?.();
    this.unwatch=this.transport.watch(()=>this.engine?.wake(50),detail=>this.notify('error',detail));
  }
  retry(){
    if(this.engine){this.subscribe();this.engine.wake(0);}
    else if(this.user)this.prepare();else if(!this.client)this.start();
  }
  changed(){this.engine?.wake();}
  onlineChanged(){
    if(!navigator.onLine){if(this.user)this.notify('offline');}
    else if(this.user)this.retry();
  }
}
