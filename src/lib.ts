// Note: this implementation is not designed to be efficient (or complete). It's
// designed to be a minimal implementation to illustrate an idea.

// Note: in this unit, I've used the term "delta" to refer to a change to an
// instance, and "migration" to refer to a change to a schema.

const ledgerSymbol = Symbol('ledger');

type SchemaMigration =
  | { op: 'addField', fieldName: string }
  | { op: 'renameField', oldName: string, newName: string }
  | { op: 'removeField', fieldName: string }

export class Schema {
  // Schemas are linked together in a doubly-linked list
  prev: Schema;
  // The "migration" is the action to take on the previous schema that brings
  // us to this schema.
  migration: SchemaMigration;

  constructor (prev: Schema, migration: SchemaMigration) {
    this.prev = prev;
    this.migration = migration;
  }

  addField(fieldName: string) {
    return new Schema(this, { op: 'addField', fieldName });
  }

  renameField(oldName: string, newName: string) {
    return new Schema(this, { op: 'renameField', oldName, newName });
  }

  removeField(fieldName: string) {
    return new Schema(this, { op: 'removeField', fieldName });
  }

  newInstance(initialState: any) {
    // A single, mutable ledger, shared between all views
    const ledger: Ledger = [];
    const view = viewLedger(ledger, this);
    if (initialState) {
      Object.assign(view, initialState);
    }
    return view;
  }

  viewInstance(instance: any) {
    // Get the underlying ledger used by the instance
    const ledger = instance[ledgerSymbol];
    console.assert(ledger !== undefined);
    // Get a proxy that represents the ledger as this schema
    return viewLedger(ledger, this);
  }
}

export const emptySchema = new Schema(undefined as any, undefined as any);

type Delta =
  | { op: 'no-op', version: Schema }
  | { op: 'set', version: Schema, prop: string, value: any }

type Ledger = Delta[];

class Handler {
  ledger: Ledger;
  version: Schema;

  constructor (ledger: Ledger, version: Schema) {
    this.ledger = ledger;
    this.version = version;
  }

  set(_obj: any, prop: PropertyKey, value: any) {
    if (typeof prop !== 'string') throw new Error('Cannot set non-string property key')
    const version = this.version;
    this.ledger.push({ version, op: 'set', prop, value });
    return true;
  }

  get(_obj: any, prop: PropertyKey) {
    if (prop === ledgerSymbol) return this.ledger;
    const state = renderLedgerAsVersion(this.ledger, this.version);
    return state[prop];
  }
}

function viewLedger(ledger: Ledger, version: Schema) {
  return new Proxy({}, new Handler(ledger, version));
}

function renderLedgerAsVersion(ledger: Ledger, version: Schema) {
  return ledger.reduce(reducer, {});

  function reducer(state: any, delta: Delta) {
    // Translate the delta into the version being requested
    delta = translateDelta(delta, version);
    state = applyDelta(state, delta);
    return state;
  }
}

// This takes a delta to an instance in one version and translates it to a delta
// to an instance in another version in the same lineage.
function translateDelta(delta: Delta, targetVersion: Schema): Delta {
  const history = getVersionRelationship(delta.version, targetVersion);
  for (const { version, direction } of history) {
    delta = upgradeOrDowngradeDelta(delta, direction, version)
    console.assert(delta.version === version);
  }
  return delta;
}

// This takes a delta to an instance in one version and translates it to a delta
// to an instance in another version in the same lineage.
function upgradeOrDowngradeDelta(delta: Delta, direction: 'downgrade' | 'upgrade', version: Schema): Delta {
  const migration = version.migration;
  switch (delta.op) {
    case 'no-op': break;
    case 'set': {
      switch (migration.op) {
        case 'addField': {
          if (direction === 'downgrade' && delta.prop === migration.fieldName) {
            return { op: 'no-op', version }
          } else {
            console.assert(delta.prop !== migration.fieldName);
          }
        }
        case 'removeField': {
          if (direction === 'upgrade' && delta.prop === migration.fieldName) {
            return { op: 'no-op', version }
          } else {
            console.assert(delta.prop !== migration.fieldName);
          }
          break;
        }
        case 'renameField': {
          if (direction === 'upgrade' && delta.prop === migration.oldName) {
            return { ...delta, version, prop: migration.newName };
          } else if (direction === 'downgrade' && delta.prop === migration.newName) {
            return { ...delta, version, prop: migration.oldName };
          }
          break;
        }
        default: console.assert(false);
      }
      break;
    }
    default: console.assert(false);
  }

  // Most schema migrations have no effect on the instance delta
  return { ...delta, version };
}

function applyDelta(instance: any, delta: Delta): any {
  switch (delta.op) {
    case 'no-op': return instance;
    case 'set': return { ...instance, [delta.prop]: delta.value };
    default: console.assert(false);
  }
}

type VersionHistory = Array<{ version: Schema, direction: 'upgrade' | 'downgrade' }>;

function getVersionRelationship(sourceVersion: Schema, targetVersion: Schema): VersionHistory {
  let history: VersionHistory = [];

  // If the target version is later, we need to progressively upgrade the version
  if (versionInheritsFrom(targetVersion, sourceVersion)) {
    let version = targetVersion;
    while (version !== sourceVersion) {
      console.assert(version);
      history.unshift({ version, direction: 'upgrade' });
      version = version.prev;
    }
  } else {
    // Otherwise the target version is earlier, so we need to progressively downgrade
    console.assert(versionInheritsFrom(sourceVersion, targetVersion));
    let version = sourceVersion;
    while (version !== targetVersion) {
      console.assert(version);
      history.push({ version, direction: 'downgrade' });
      version = version.prev;
    }
  }

  return history;
}

function versionInheritsFrom(descendantVersion: Schema, ancestorVersion: Schema): boolean {
  let version = descendantVersion;
  while (version) {
    if (version === ancestorVersion) return true;
    version = version.prev;
  }
  return false;
}