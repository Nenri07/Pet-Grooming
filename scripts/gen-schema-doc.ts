/**
 * gen-schema-doc - writes docs/PAWXIS_DATABASE_SCHEMA.md from the real Mongoose
 * models (via scripts/dump-schema.ts). Reads schema definitions only: it never
 * connects to a database.
 *
 *   npx tsx scripts/gen-schema-doc.ts
 *
 * The prose (purpose of each collection, notes) lives here; the field tables,
 * relationships and indexes come from the schemas. The diagram's curated field
 * lists are checked against the schemas, so a renamed field fails the run
 * instead of silently publishing a wrong diagram.
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dumpSchemas, type FieldInfo, type ModelInfo } from './dump-schema';

// Run from the project root (see the usage line above).
const OUT = resolve(process.cwd(), 'docs', 'PAWXIS_DATABASE_SCHEMA.md');

// ---------------------------------------------------------------------------
// Hand-written context
// ---------------------------------------------------------------------------
const PURPOSE: Record<string, string> = {
  User: 'A groomer\'s login account (email and password, or Google). The hub of the data model: nearly every other collection points back to it. Clients are **not** users; they have no login.',
  GroomerProfile: 'The groomer\'s business settings, one per user: public booking link, deposit, price rules, working hours, service area, routing settings, own-Stripe settings and onboarding progress.',
  Subscription: 'The groomer\'s plan and billing state, one per user: trial dates, Polar customer and subscription ids, plan, status and message allowance.',
  Service: 'A service a groomer offers (name, price, duration). Hidden from booking with `isActive: false`.',
  Client: 'One of a groomer\'s customers (the pet owner). Scoped to a groomer; the same person booking with two groomers is two Client rows.',
  Pet: 'A pet belonging to a client. Holds the grooming profile (breed, coat, temperament) and the rebooking cycle (`rebookIntervalWeeks`, `nextDueAt`).',
  Appointment: 'A booking: who, which pet, which service(s), when, status, deposit, final amount charged, route data and live-tracking state.',
  Transaction: 'A succeeded or attempted **card deposit** payment for an appointment (Stripe). Payment-link deposits are tracked on the appointment (`depositStatus`) instead.',
  SmsMessage: 'The client message log that powers the Inbox: every outgoing and incoming message, with its kind (confirmation, reminder, reply...) and delivery status.',
  FillEvent: 'One Fill My Day attempt: the gap that opened, who was offered it, who took it, and the revenue recovered. Drives the "recovered this month" number.',
  Waitlist: 'A client waiting for a slot (preferred days and date range). Fill My Day offers freed slots to these entries first.',
  CalendarBlock: 'A block of unavailable time on a groomer\'s calendar (a break, a busy period, or time from a shared calendar). Read when computing open slots; nothing in the app writes it yet.',
  PendingBooking: 'Holds the pet, owner and slot while a deposit payment is in progress, because the payment provider\'s metadata is too small. Consumed when the payment succeeds. **Deleted automatically after 1 hour.**',
  IdentityBinding: 'Anti-abuse record for the free trial: one trial per phone number. Stores only a one-way hash of the phone, never the number itself.',
  PrelaunchSignup: 'Emails collected on the coming-soon page before launch. Not connected to any other collection.',
  Reservation: '**Legacy.** An old short-lived slot hold, replaced by Redis holds. Only kept so an old test still runs. Not used by the app.',
  Availability: '**Unused.** A planned replacement for weekly hours and blocks. Nothing reads or writes it; weekly hours and blocked dates live on `GroomerProfile`.',
};

/** Fields shown on the overview diagram (all names are validated against the schemas). */
const DIAGRAM_FIELDS: Record<string, string[]> = {
  User: ['email', 'name', 'passwordHash', 'googleId', 'role', 'isActive', 'emailVerifiedAt', 'failedLoginAttempts', 'lockedUntil'],
  GroomerProfile: ['userId', 'businessName', 'groomerSlug', 'phone', 'businessEmail', 'depositAmount', 'timezone', 'baseAddress', 'baseLocation', 'serviceRadiusKm', 'bookingMode', 'connectStatus', 'onboardingComplete'],
  Subscription: ['groomerId', 'plan', 'status', 'trialDeadline', 'currentPeriodEnd', 'polarCustomerId', 'polarSubscriptionId', 'smsIncluded', 'smsTopupBalance', 'foundingMember'],
  Service: ['groomerId', 'name', 'description', 'basePrice', 'durationMinutes', 'isActive'],
  Client: ['groomerId', 'name', 'email', 'phone', 'location', 'smsConsentAt'],
  Pet: ['groomerId', 'clientId', 'name', 'breed', 'weight', 'age', 'temperament', 'coatCondition', 'specialFlags', 'digitalCardId', 'rebookIntervalWeeks', 'nextDueAt'],
  Appointment: ['groomerId', 'clientId', 'petId', 'serviceId', 'serviceIds', 'scheduledDate', 'scheduledEndDate', 'status', 'depositStatus', 'depositDue', 'amountCharged', 'bookingRef', 'source', 'location'],
  Transaction: ['appointmentId', 'groomerId', 'stripePaymentId', 'amount', 'currency', 'status'],
  SmsMessage: ['groomerId', 'clientId', 'appointmentId', 'direction', 'kind', 'body', 'status', 'read'],
  FillEvent: ['groomerId', 'gapStart', 'gapEnd', 'offeredTo', 'filledBy', 'revenueRecovered'],
  Waitlist: ['groomerId', 'clientId', 'petId', 'serviceId', 'preferredDays', 'status'],
  CalendarBlock: ['groomerId', 'source', 'startTime', 'endTime'],
  PendingBooking: ['paymentIntentId', 'groomerId', 'groomerSlug', 'slotStart', 'bookingRef', 'createdAt'],
  IdentityBinding: ['normalizedEmail', 'phoneHash', 'firstTrialAt', 'bindingExpiresAt'],
  PrelaunchSignup: ['email', 'source'],
};

/** Embedded documents drawn as their own classes (owner, field, class name, cardinality). */
const EMBEDDED: Array<{ owner: string; field: string; cls: string; many: boolean; attrs: string[] }> = [
  { owner: 'Client', field: 'address', cls: 'Address', many: false, attrs: ['street', 'city', 'state', 'postalCode'] },
  { owner: 'GroomerProfile', field: 'estimateRules', cls: 'EstimateRule', many: true, attrs: ['coatCondition', 'weightRange', 'priceAdjustmentPercent', 'note'] },
  { owner: 'GroomerProfile', field: 'availabilityWindows', cls: 'WeeklyWindow', many: true, attrs: ['dayOfWeek', 'startTime', 'endTime'] },
  { owner: 'GroomerProfile', field: 'blockedDates', cls: 'BlockedDate', many: true, attrs: ['startDateTime', 'endDateTime'] },
  { owner: 'GroomerProfile', field: 'travelFeeTiers', cls: 'TravelFeeTier', many: true, attrs: ['uptoKm', 'fee'] },
  { owner: 'Appointment', field: 'routeMeta', cls: 'RouteMeta', many: false, attrs: ['prevId', 'nextId', 'extraDriveMin', 'fromPrevKm', 'score'] },
  { owner: 'Appointment', field: 'tracking', cls: 'Tracking', many: false, attrs: ['token', 'startedAt', 'arrivedAt'] },
];
/** Subdocument fields drawn as a type name instead of a separate box. */
const INLINE_TYPE: Record<string, string> = { location: 'GeoPoint', baseLocation: 'GeoPoint' };

interface DiagramSpec {
  file: string;
  title: string;
  /** Mermaid layout direction. */
  direction: 'TB' | 'LR';
  models: string[];
  /** Models drawn as a name-only box, for context. */
  contextOnly?: string[];
  embedded: string[];
  /** [from, fromMult, toMult, to, label] */
  relations: Array<[string, string, string, string, string]>;
  note?: [string, string];
}

const SCOPING_NOTE =
  'Every collection except IdentityBinding and PrelaunchSignup also has a groomerId (FK to User). That is how each groomer only sees their own data.';

const DIAGRAMS: DiagramSpec[] = [
  {
    file: 'database-schema-core',
    title: 'Core data model',
    direction: 'LR',
    models: ['User', 'GroomerProfile', 'Subscription', 'Service', 'Client', 'Pet', 'Appointment', 'Transaction', 'SmsMessage'],
    embedded: ['Address', 'EstimateRule', 'WeeklyWindow', 'BlockedDate', 'TravelFeeTier', 'RouteMeta', 'Tracking'],
    relations: [
      ['User', '1', '1', 'GroomerProfile', 'userId'],
      ['User', '1', '1', 'Subscription', 'groomerId'],
      ['Client', '1', '0..*', 'Pet', 'clientId'],
      ['Client', '1', '0..*', 'Appointment', 'clientId'],
      ['Pet', '1', '0..*', 'Appointment', 'petId'],
      ['Service', '1..*', '0..*', 'Appointment', 'serviceId, serviceIds'],
      ['Appointment', '1', '0..*', 'Transaction', 'appointmentId'],
      ['Client', '0..1', '0..*', 'SmsMessage', 'clientId'],
      ['Appointment', '0..1', '0..*', 'SmsMessage', 'appointmentId'],
      ['Appointment', '0..1', '0..1', 'Appointment', 'routeMeta.prevId, nextId'],
    ],
    note: ['User', SCOPING_NOTE],
  },
  {
    file: 'database-schema-support',
    title: 'Automation and support collections',
    direction: 'LR',
    models: ['FillEvent', 'Waitlist', 'CalendarBlock', 'PendingBooking', 'IdentityBinding', 'PrelaunchSignup'],
    contextOnly: ['User', 'Client', 'Pet', 'Service'],
    embedded: [],
    relations: [
      ['User', '1', '0..*', 'FillEvent', 'groomerId'],
      ['Client', '0..*', '0..*', 'FillEvent', 'offeredTo, filledBy'],
      ['User', '1', '0..*', 'Waitlist', 'groomerId'],
      ['Client', '1', '0..*', 'Waitlist', 'clientId'],
      ['Pet', '0..1', '0..*', 'Waitlist', 'petId'],
      ['Service', '0..1', '0..*', 'Waitlist', 'serviceId'],
      ['User', '1', '0..*', 'CalendarBlock', 'groomerId'],
      ['User', '1', '0..*', 'PendingBooking', 'groomerId'],
    ],
  },
];

const REDIS: Array<[string, string, string, string]> = [
  ['`hold:{groomerId}:{holdId}`', '10 min', 'Slot hold', 'A time reserved while a client finishes booking'],
  ['`holds:{groomerId}:{date}`', '1 day', 'Slot hold index', 'The holds on a day, for fast availability checks'],
  ['`lock:book:{groomerId}`', '10 s', 'Booking lock', 'Stops two bookings for the same slot at the same instant'],
  ['`avail:{groomerId}:{date}`', '60 s', 'Cache', 'Computed open slots for a day'],
  ['`ent:{groomerId}`', '60 s', 'Cache', 'The groomer\'s plan and feature access'],
  ['`geo:{addressHash}`', '30 days', 'Cache', 'Geocoded address'],
  ['`tt:{hashA}:{hashB}`', '7 days', 'Cache', 'Drive time between two places'],
  ['`track:{token}`', '2 h', 'Live tracking', 'The van\'s current position for the client\'s tracker link'],
  ['`claim:{token}`', '30 min', 'Fill My Day', 'A slot offer a client can claim'],
  ['`claimwon:{groomerId}:{startMs}`', '30 min', 'Fill My Day', 'Marks a slot as taken, so only the first claimer wins'],
  ['`rebook:{token}`', '30 days', 'Rebooking', 'A client\'s rebook link'],
  ['`cron:rebook:{date}`', '25 h', 'Rebooking', 'Marks that the daily rebook sweep already ran'],
  ['`idem:stripe:{eventId}`', '7 days', 'Idempotency', 'Prevents handling the same Stripe event twice'],
  ['`email:day:{date}` and `:alert`', '48 h', 'Email cap', 'Emails sent today, and whether the founder alert went out'],
  ['`evf:{token}`', '30 min', 'Email verification', 'One-time verification link'],
  ['`evf:rl:{email}`', '60 s', 'Email verification', 'Resend cooldown'],
  ['`pwr:{sha256(token)}`', '1 h', 'Password reset', 'One-time reset link, stored as a hash'],
  ['`pwr:rl:{email}`', '60 s', 'Password reset', 'Reset-email cooldown'],
  ['`otp:{phoneHash}` and `otp:rl:{phoneHash}`', '10 min / 60 s', 'Phone check', 'One-time code and its resend limit'],
  ['`vel:dev:{fingerprint}` and `vel:ip:{maskedIp}`', '24 h', 'Trial abuse', 'Counts of trials started per device and per IP'],
];

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------
const byName = new Map<string, ModelInfo>();
for (const m of dumpSchemas()) byName.set(m.model, m);
const field = (model: string, name: string): FieldInfo => {
  const f = byName.get(model)?.fields.find((x) => x.name === name);
  if (!f) throw new Error(`Diagram lists ${model}.${name}, but that field does not exist in the schema.`);
  return f;
};

function shortType(f: FieldInfo): string {
  if (f.type === 'Subdocument[]') return 'List~Subdocument~';
  if (f.type.endsWith('[]')) return `List~${f.type.slice(0, -2)}~`;
  return f.type;
}

function notes(f: FieldInfo): string {
  const n: string[] = [];
  if (f.ref) n.push(`ref **${f.ref}**`);
  if (f.enum) n.push(`one of ${f.enum.map((e) => `\`${e}\``).join(', ')}`);
  if (f.default !== undefined && f.default !== 'computed') n.push(`default \`${f.default}\``);
  if (f.min !== undefined || f.max !== undefined) n.push(`range ${f.min ?? ''}–${f.max ?? ''}`);
  if (f.maxlength !== undefined) n.push(`max ${f.maxlength} chars`);
  if (f.select === false) n.push('hidden from normal queries (secret)');
  return n.join('; ');
}

function fieldRows(fields: FieldInfo[], prefix = ''): string[] {
  const rows: string[] = [];
  for (const f of fields) {
    if (!prefix && ['_id', 'createdAt', 'updatedAt'].includes(f.name)) continue;
    const flags = [f.required ? 'required' : '', f.unique ? 'unique' : ''].filter(Boolean).join(', ');
    rows.push(`| ${prefix ? '↳ ' : ''}\`${prefix}${f.name}\` | ${f.type} | ${flags || '-'} | ${notes(f) || '-'} |`);
    if (f.children) rows.push(...fieldRows(f.children, `${prefix}${f.name}.`));
  }
  return rows;
}

function indexRows(m: ModelInfo): string[] {
  return m.indexes.map((i) => {
    const keys = Object.entries(i.fields).map(([k, v]) => `${k} ${v === -1 ? '↓' : '↑'}`).join(', ');
    const tags = [i.unique ? 'unique' : '', i.sparse ? 'sparse' : '', i.ttlSeconds !== undefined ? `auto-delete after ${i.ttlSeconds === 0 ? 'its own date passes' : `${i.ttlSeconds / 3600} h`}` : '']
      .filter(Boolean)
      .join(', ');
    return `| ${keys} | ${tags || '-'} |`;
  });
}

// ---------------------------------------------------------------------------
// Mermaid class diagram
// ---------------------------------------------------------------------------
function mermaid(d: DiagramSpec): string {
  const L: string[] = ['classDiagram', `  direction ${d.direction}`];
  const keyOf = (f: FieldInfo): string => (f.ref ? ' FK' : f.unique ? ' unique' : '');
  const typeFor = (n: string, f: FieldInfo): string => INLINE_TYPE[n] ?? shortType(f);
  for (const model of d.models) {
    L.push(`  class ${model} {`, '    +ObjectId _id PK');
    for (const n of DIAGRAM_FIELDS[model]) {
      const f = field(model, n);
      L.push(`    +${typeFor(n, f)} ${n}${keyOf(f)}`);
    }
    L.push('  }');
  }
  for (const c of d.contextOnly ?? []) L.push(`  class ${c}`);
  const emb = EMBEDDED.filter((e) => d.embedded.includes(e.cls));
  for (const e of emb) {
    const owner = field(e.owner, e.field);
    if (!owner.children) throw new Error(`${e.owner}.${e.field} is not an embedded document`);
    const have = new Set(owner.children.map((c) => c.name.split('.')[0]));
    L.push(`  class ${e.cls} {`, '    <<embedded>>');
    for (const a of e.attrs) {
      if (!have.has(a)) throw new Error(`${e.cls}.${a} does not exist in ${e.owner}.${e.field}`);
      L.push(`    +${a}`);
    }
    L.push('  }');
  }
  // GeoPoint is shown as a field type (explained under the diagram), not a box.
  for (const [m, n] of [['Client', 'location'], ['Appointment', 'location'], ['GroomerProfile', 'baseLocation']] as const) field(m, n);
  for (const [from, fm, tm, to, label] of d.relations) L.push(`  ${from} "${fm}" --> "${tm}" ${to} : ${label}`);
  for (const e of emb) {
    const f = field(e.owner, e.field);
    const mult = f.type.endsWith('[]') ? '0..*' : f.required ? '1' : '0..1';
    L.push(`  ${e.owner} "1" *-- "${mult}" ${e.cls} : ${e.field}`);
  }
  if (d.note) L.push(`  note for ${d.note[0]} "${d.note[1]}"`);
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------
function build(): string {
  let sha = 'unknown';
  try {
    sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    /* not a git checkout */
  }
  const today = new Date().toISOString().slice(0, 10);
  const models = [...byName.values()];
  const live = models.filter((m) => !['Reservation', 'Availability'].includes(m.model));

  const DIAGRAM_BLOCKS = DIAGRAMS.map((d) => {
    const src = mermaid(d);
    writeFileSync(resolve(process.cwd(), 'docs', 'images', `${d.file}.mmd`), src + '\n');
    return `![${d.title}](images/${d.file}.svg)

<details>
<summary>Mermaid source (also saved as \`docs/images/${d.file}.mmd\`; paste into mermaid.live or another UML tool)</summary>

\`\`\`mermaid
${src}
\`\`\`

</details>`;
  });

  const out: string[] = [];
  out.push(`# Pawxis Database Schema

**Database:** MongoDB Atlas, accessed through Mongoose. **Short-lived data:** Upstash Redis (section 5).
**Collections:** ${models.length} defined, ${live.length} in use (1 legacy, 1 unused; see section 6).
**Source of truth:** \`src/lib/db/models/*\`. Generated on ${today} from commit \`${sha}\`.
Regenerate after any schema change with \`npx tsx scripts/gen-schema-doc.ts\`. The script only reads the schema definitions and never connects to a database.

---

## 1. How the data is organised

- **\`User\` is the hub.** A User is a groomer's account. Almost every other collection carries a \`groomerId\` that points back to it, so each groomer only ever sees their own data (multi-tenant by \`groomerId\`).
- **Clients are not users.** A \`Client\` is a groomer's customer record. There is no client login or client table of accounts; clients reach the product through links (booking page, tracker, pet card).
- **Documents, not tables.** Related data that always travels together is **embedded** inside its parent document (for example a client's \`address\`, or a profile's \`estimateRules\`). Everything else is linked by \`ObjectId\`.
- **No database-enforced foreign keys.** MongoDB does not enforce references. The application keeps them consistent.
- **Money** is stored as plain numbers in **dollars** (not cents), for example \`basePrice: 95\`.
- **Dates** are stored as UTC instants. The groomer's IANA timezone (\`GroomerProfile.timezone\`) is used to display them and to build slots.
- **Timestamps:** every collection except \`PendingBooking\` and \`Reservation\` has \`createdAt\` and \`updatedAt\`. Every document has an \`_id\` (ObjectId).
- **Secrets:** a groomer's own Stripe key is stored encrypted (\`ownStripeKeyEnc\`) and is excluded from normal queries. Phone numbers used for the trial check are stored only as a one-way hash.

---

## 2. Diagrams (UML class diagrams)

Two diagrams, so each stays readable. They show keys and the main fields, not every field (full field tables are in section 4). **PK** is the primary key and **FK** a link to another collection. An arrow is a link by id with its cardinality. A filled diamond is a document embedded inside its parent. \`GeoPoint\` is an embedded latitude/longitude pair (\`{ lat, lng }\`), shown as a field type.

### 2a. Core data model

${DIAGRAM_BLOCKS[0]}

### 2b. Automation and support collections

These sit around the core model: Fill My Day (\`FillEvent\`, \`Waitlist\`), time blocks, in-flight payments, and the anti-abuse and pre-launch tables. Boxes with only a name are the core collections, repeated for context.

${DIAGRAM_BLOCKS[1]}

---

## 3. Relationships

| From | Field | To | Meaning |
|---|---|---|---|
| \`GroomerProfile\` | \`userId\` | \`User\` | One profile per user (unique) |
| \`Subscription\` | \`groomerId\` | \`User\` | One subscription per user (unique) |
| \`Service\`, \`Client\`, \`Pet\`, \`Appointment\`, \`Transaction\`, \`SmsMessage\`, \`FillEvent\`, \`Waitlist\`, \`CalendarBlock\`, \`PendingBooking\` | \`groomerId\` | \`User\` | Owned by one groomer (many per groomer) |
| \`Pet\` | \`clientId\` | \`Client\` | A client has many pets |
| \`Appointment\` | \`clientId\`, \`petId\` | \`Client\`, \`Pet\` | Who and which pet |
| \`Appointment\` | \`serviceId\`, \`serviceIds[]\` | \`Service\` | The main service, and the full list when several are booked |
| \`Appointment\` | \`routeMeta.prevId\`, \`routeMeta.nextId\` | \`Appointment\` | The stops before and after on the same day (route chain) |
| \`Transaction\` | \`appointmentId\` | \`Appointment\` | A card deposit for a booking |
| \`SmsMessage\` | \`clientId\`, \`appointmentId\` | \`Client\`, \`Appointment\` | Both optional: a message can come from an unknown number (no client) and need not relate to a booking |
| \`FillEvent\` | \`offeredTo[]\`, \`filledBy\` | \`Client\` | Who was offered a freed slot, and who took it |
| \`Waitlist\` | \`clientId\` (required), \`petId\`, \`serviceId\` | \`Client\`, \`Pet\`, \`Service\` | A client waiting for a slot |

\`IdentityBinding\` and \`PrelaunchSignup\` are standalone: they link to nothing.

---

## 4. Collections and fields

Each table lists every field in the schema. \`_id\`, \`createdAt\` and \`updatedAt\` are omitted (see section 1). Sub-document fields are shown as \`parent.child\`.
`);
  for (const m of models) {
    out.push(`### ${m.model}\n`);
    out.push(`**Collection:** \`${m.collection}\`. ${PURPOSE[m.model] ?? ''}\n`);
    out.push('| Field | Type | Flags | Notes |', '|---|---|---|---|', ...fieldRows(m.fields), '');
    if (m.indexes.length) out.push('**Indexes**\n', '| Keys | Properties |', '|---|---|', ...indexRows(m), '');
  }
  out.push(`---

## 5. Short-lived data (Redis)

These are not stored in MongoDB. They are temporary keys that expire on their own. If Redis is unavailable, booking holds, live tracking and password reset stop working and the rest degrades gracefully.

| Key | Lives for | Purpose | What it holds |
|---|---|---|---|
${REDIS.map((r) => `| ${r[0]} | ${r[1]} | ${r[2]} | ${r[3]} |`).join('\n')}

---

## 6. Things worth knowing

1. **\`Availability\` is not used.** The model is defined but nothing reads or writes it. A groomer's weekly hours and blocked dates are stored on \`GroomerProfile\` (\`availabilityWindows\`, \`blockedDates\`). It can be deleted.
2. **\`Reservation\` is legacy.** Booking holds now live in Redis. The model remains only for an old test.
3. **\`CalendarBlock\` is read but never written by the app.** Slot calculation reads it (for blocks from a shared calendar), but nothing creates rows yet, so it is empty in practice. Groomers add time off through \`GroomerProfile.blockedDates\` on the Availability page.
4. **Two service links on \`Appointment\`.** \`serviceId\` is the original, required field and \`serviceIds\` the newer multi-service list. Code that needs all services should read \`serviceIds\` and fall back to \`serviceId\`.
5. **\`PendingBooking.pet\` and \`.owner\` are free-form (\`Mixed\`).** They are a snapshot of the booking form while payment is in progress, and the whole row deletes itself after 1 hour.
6. **Revenue has no separate table.** It is computed from \`Appointment.amountCharged\` for completed jobs and from \`Transaction\` and \`depositDue\` for deposits (see the product guide, section 10).
7. **Card deposits vs payment links.** Card deposits create a \`Transaction\`. Payment-link deposits do not; they set \`Appointment.depositStatus\` when the groomer marks them received.
8. **Plan limits are not stored per feature.** \`Subscription.plan\` decides access in code (\`src/lib/plans.ts\`).
9. **Schema, not live data.** This document describes what the code defines. It does not inspect the production database, so indexes shown here are the ones the code asks for.
`);
  return out.join('\n');
}

writeFileSync(OUT, build());
console.log(`wrote ${OUT}`);
