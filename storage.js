import { initialState, validateState } from './model.js';
export const STORAGE_KEY = 'mein-uni-cockpit.v1';
// Replace this adapter with a remote repository for future cross-device sync.
// IDs, schema version, revision and updatedAt are already part of the data model.
export class LocalRepository {
  constructor(storage = globalThis.localStorage, key = STORAGE_KEY) { this.storage = storage; this.key = key; }
  load() {
    const raw = this.storage.getItem(this.key);
    return raw === null ? initialState() : validateState(JSON.parse(raw));
  }
  save(state, { replace = false } = {}) {
    const current = this.storage.getItem(this.key);
    if (!replace && current !== null && JSON.parse(current).revision !== state.revision) {
      throw new Error('Ein anderes Fenster hat neuere Daten gespeichert. Sichere diesen Stand als JSON und lade die Seite neu.');
    }
    const candidate = { ...state, revision: state.revision + 1, updatedAt: new Date().toISOString() };
    this.storage.setItem(this.key, JSON.stringify(candidate));
    Object.assign(state, { revision: candidate.revision, updatedAt: candidate.updatedAt });
  }
}
