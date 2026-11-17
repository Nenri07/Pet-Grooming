/**
 * dump-schema - prints every Mongoose model's fields, relations and indexes as
 * JSON, read from the real schemas (no database connection, nothing is written).
 *
 *   npx tsx scripts/dump-schema.ts            # JSON to stdout
 *
 * Used by scripts/gen-schema-doc.ts to build docs/PAWXIS_DATABASE_SCHEMA.md.
 */
import mongoose, { type Schema } from 'mongoose';
import { registerModels } from '@/lib/db/models';

export interface FieldInfo {
  name: string;
  type: string;
  required: boolean;
  unique: boolean;
  indexed: boolean;
  ref?: string;
  enum?: string[];
  default?: string;
  min?: number;
  max?: number;
  maxlength?: number;
  select?: boolean;
  /** Embedded sub-document fields (one level of nesting is flattened into `children`). */
  children?: FieldInfo[];
}
export interface IndexInfo {
  fields: Record<string, number | string>;
  unique: boolean;
  sparse: boolean;
  ttlSeconds?: number;
}
export interface ModelInfo {
  model: string;
  collection: string;
  timestamps: boolean;
  fields: FieldInfo[];
  indexes: IndexInfo[];
}

function describeDefault(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v === 'function') return 'computed';
  if (v === null) return 'null';
  if (v instanceof Date) return 'date';
  return JSON.stringify(v);
}

function typeOf(path: any): string {
  const inst = String(path.instance);
  if (inst === 'Array') {
    const inner = path.$embeddedSchemaType ?? path.caster;
    if (path.schema) return 'Subdocument[]';
    return `${inner?.instance ?? 'Mixed'}[]`;
  }
  if (inst === 'Embedded' || inst === 'Subdocument') return 'Subdocument';
  if (inst === 'ObjectId' || inst === 'ObjectID') return 'ObjectId';
  return inst;
}

function fieldsOf(schema: Schema, depth = 0): FieldInfo[] {
  const out: FieldInfo[] = [];
  for (const [name, path] of Object.entries(schema.paths) as Array<[string, any]>) {
    if (name === '__v') continue;
    const o = path.options ?? {};
    const inner = path.$embeddedSchemaType ?? path.caster;
    const f: FieldInfo = {
      name,
      type: typeOf(path),
      required: typeof o.required === 'function' ? false : !!o.required,
      unique: !!o.unique,
      indexed: !!o.index || !!o.unique,
    };
    const ref = o.ref ?? inner?.options?.ref;
    if (ref) f.ref = String(typeof ref === 'function' ? 'dynamic' : ref);
    const en = o.enum ?? inner?.options?.enum;
    if (Array.isArray(en)) f.enum = en.map(String);
    else if (en && Array.isArray(en.values)) f.enum = en.values.map(String);
    if ('default' in o) f.default = describeDefault(o.default);
    if (typeof o.min === 'number') f.min = o.min;
    if (typeof o.max === 'number') f.max = o.max;
    if (typeof o.maxlength === 'number') f.maxlength = o.maxlength;
    if (o.select === false) f.select = false;
    const sub: Schema | undefined = path.schema;
    if (sub && depth < 2) f.children = fieldsOf(sub, depth + 1);
    out.push(f);
  }
  return out;
}

function indexesOf(schema: Schema): IndexInfo[] {
  const out: IndexInfo[] = [];
  for (const [fields, opts] of schema.indexes() as Array<[Record<string, number | string>, any]>) {
    out.push({
      fields,
      unique: !!opts?.unique,
      sparse: !!opts?.sparse,
      ttlSeconds: typeof opts?.expireAfterSeconds === 'number' ? opts.expireAfterSeconds : undefined,
    });
  }
  return out;
}

export function dumpSchemas(): ModelInfo[] {
  registerModels();
  return Object.values(mongoose.models)
    .map((m) => ({
      model: m.modelName,
      collection: m.collection.name,
      timestamps: !!(m.schema as any).options?.timestamps,
      fields: fieldsOf(m.schema),
      indexes: indexesOf(m.schema),
    }))
    .sort((a, b) => a.model.localeCompare(b.model));
}

if (process.argv[1]?.endsWith('dump-schema.ts')) {
  console.log(JSON.stringify(dumpSchemas(), null, 2));
}
