import { cloudPayload,parseCloud } from './sync.js';

// SDK injection lets the very same transport run against the real Firebase
// emulator in integration tests, without signing into any production account.
export function createFirestoreTransport(db,userId,sdk,errorText=error=>error.message){
  const {doc,collection,getDocFromServer,getDocsFromServer,onSnapshot,runTransaction,serverTimestamp}=sdk;
  const current=doc(db,'users',userId,'cockpit','current');
  return {
    async read(){
      try{const s=await getDocFromServer(current);return s.exists()?parseCloud(s.data()):null;}
      catch(e){e.message=errorText(e);throw e;}
    },
    async write(expectedVersion,state){
      const payload=cloudPayload(state);
      try{
        return await runTransaction(db,async tx=>{
          const snap=await tx.get(current),previous=snap.exists()?snap.data():null;
          if((previous?.version||0)!==expectedVersion){const e=new Error('Ein anderes Gerät hat inzwischen gespeichert.');e.code='version-conflict';throw e;}
          if(previous){
            parseCloud(previous);
            tx.set(doc(db,'users',userId,'backups',String(previous.version%10)),{
              format:1,version:previous.version,payload:previous.payload,updatedAt:serverTimestamp()
            });
          }
          const next={format:1,version:expectedVersion+1,payload,updatedAt:serverTimestamp()};
          tx.set(current,next);
          return {version:next.version,state:structuredClone(state),savedAt:new Date().toISOString()};
        });
      }catch(e){e.message=errorText(e);throw e;}
    },
    watch(callback,onError){
      return onSnapshot(current,{includeMetadataChanges:true},snapshot=>{
        if(!snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites)callback();
      },error=>onError(errorText(error)));
    },
    async backups(){
      try{
        const snapshots=await getDocsFromServer(collection(db,'users',userId,'backups'));
        return snapshots.docs.map(s=>({...parseCloud(s.data()),id:s.id})).sort((a,b)=>b.version-a.version);
      }catch(e){e.message=errorText(e);throw e;}
    }
  };
}
