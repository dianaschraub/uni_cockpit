import { initializeApp,getAuth,GoogleAuthProvider,onAuthStateChanged,signInWithPopup,
  signOut,setPersistence,browserLocalPersistence,getFirestore,doc,collection,getDocFromServer,
  getDocsFromServer,onSnapshot,runTransaction,serverTimestamp } from './firebase-sdk.js';
import { firebaseConfig } from './firebase-config.js';
import * as sdk from './firebase-sdk.js';
import { createFirestoreTransport } from './firebase-transport.js';

export function describeFirebaseError(error){
  const messages={
    'permission-denied':'Firebase verweigert den Zugriff. Bitte veröffentliche die mitgelieferten Firestore-Regeln und melde dich erneut mit Google an.',
    'resource-exhausted':'Das Firebase-Kontingent ist momentan ausgeschöpft. Änderungen bleiben lokal und warten auf den nächsten Abgleich.',
    'unavailable':'Firebase ist gerade nicht erreichbar. Deine Änderungen bleiben lokal gespeichert.',
    'auth/unauthorized-domain':'Diese Internetadresse ist für die Google-Anmeldung noch nicht in Firebase freigegeben.',
    'auth/operation-not-allowed':'Bitte aktiviere Google unter Firebase Authentication → Anmeldemethode.',
    'auth/popup-blocked':'Dein Browser hat die Anmeldung blockiert. Erlaube das Anmeldefenster oder öffne das Cockpit direkt in Chrome.',
    'auth/popup-closed-by-user':'Die Anmeldung wurde geschlossen. Deine lokalen Daten bleiben erhalten.',
    'auth/network-request-failed':'Für die Anmeldung brauchst du eine Internetverbindung.',
    'auth/invalid-api-key':'Die Firebase-Webkonfiguration wurde nicht akzeptiert. Bitte überprüfe den API-Schlüssel im Firebase-Projekt.'
  };
  return messages[error.code]||error.message||'Der Cloud-Abgleich ist fehlgeschlagen. Deine lokalen Daten bleiben erhalten.';
}
export async function createFirebaseClient(){
  const app=initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app);
  auth.languageCode='de';
  await setPersistence(auth,browserLocalPersistence);
  const provider=new GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});
  return {
    observe:callback=>onAuthStateChanged(auth,callback),
    login:()=>signInWithPopup(auth,provider),
    logout:()=>signOut(auth),
    transport:userId=>createFirestoreTransport(db,userId,sdk,describeFirebaseError)
  };
}
