import {normalizeSnapshot} from './contracts.mjs';
export class MemoryRepository {
  constructor(snapshot={},options={}) { this.value=normalizeSnapshot(snapshot,options); }
  snapshot() { return structuredClone(this.value); }
}
