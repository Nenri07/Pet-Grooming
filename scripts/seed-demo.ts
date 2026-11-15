/**
 * seed-demo - creates (or re-creates) a self-contained DEMO groomer account
 * with realistic sample data, for screen recordings and sales demos.
 *
 * Everything it writes belongs to ONE dedicated account (DEMO_EMAIL), so it
 * never touches real groomers, and `--remove` deletes all of it cleanly.
 * Writes go straight to the database: no emails, texts or payments are sent.
 *
 * "Today" is computed when the script runs, in the demo timezone, so re-run
 * it with --reset on the day you record to get a fresh "Today's route".
 *
 * HOW TO RUN (uses MONGODB_URI / MONGODB_URI_DIRECT from .env):
 *   npx tsx scripts/seed-demo.ts --yes                 # create
 *   npx tsx scripts/seed-demo.ts --yes --reset         # wipe demo + re-create
 *   npx tsx scripts/seed-demo.ts --yes --remove        # wipe demo only
 *   add --password=YourPass1 to choose the password (else one is generated)
 *   add --tz=America/Chicago to pick the timezone (default: this machine's)
 */
import './_load-env';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import mongoose, { type Model } from 'mongoose';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { connectDB } from '@/lib/db/connect';
import { User } from '@/lib/db/models/user';
import { GroomerProfile } from '@/lib/db/models/groomer-profile';
import { Subscription } from '@/lib/db/models/subscription';
import { Service } from '@/lib/db/models/service';
import { Client } from '@/lib/db/models/client';
import { Pet } from '@/lib/db/models/pet';
import { Appointment } from '@/lib/db/models/appointment';
import { Transaction } from '@/lib/db/models/transaction';
import { SmsMessage } from '@/lib/db/models/sms-message';
import { FillEvent } from '@/lib/db/models/fill-event';
import { Waitlist } from '@/lib/db/models/waitlist';
import { CalendarBlock } from '@/lib/db/models/calendar-block';
import { PendingBooking } from '@/lib/db/models/pending-booking';
import { PLANS } from '@/lib/plans';
import { isValidPassword } from '@/lib/validators/auth';

// ---------------------------------------------------------------------------
// Demo identity
// ---------------------------------------------------------------------------
const DEMO_EMAIL = 'demo@pawxis.app';
const DEMO_NAME = 'Jordan Ellis';
const DEMO_SLUG = 'happy-tails-austin';
const BUSINESS = 'Happy Tails Mobile Grooming';
// The demo's "today" must match the clock of whoever records the video, so
// default to this machine's timezone. Override with --tz=America/Chicago.
const TZ =
  process.argv.find((a) => a.startsWith('--tz='))?.slice(5) ||
  Intl.DateTimeFormat().resolvedOptions().timeZone ||
  'UTC';
const BASE = { lat: 30.2747, lng: -97.7404 };
const DEPOSIT = 20;

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const arg = (n: string) => argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Small seeded PRNG so every run produces the same shape of data. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = prng(20261115);
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];

const NOW = new Date();
const nowLocal = toZonedTime(NOW, TZ);
/** A UTC instant for local wall-clock `hh:mm` on today + `dayOffset` in TZ. */
function at(dayOffset: number, hh: number, mm = 0): Date {
  const local = new Date(nowLocal.getFullYear(), nowLocal.getMonth(), nowLocal.getDate() + dayOffset, hh, mm, 0, 0);
  return fromZonedTime(local, TZ);
}
/** Day of week in TZ for today + offset; 0 = Sunday (JS convention). */
function dow(dayOffset: number): number {
  return new Date(nowLocal.getFullYear(), nowLocal.getMonth(), nowLocal.getDate() + dayOffset).getDay();
}
const addMin = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s)) * 1.35; // road factor, as the app uses
}
const REF = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const bookingRef = () => 'PP-' + Array.from({ length: 6 }, () => REF[Math.floor(rand() * REF.length)]).join('');

/**
 * Validate each doc through its Mongoose model (casting + schema rules), then
 * insert raw so the historical createdAt/updatedAt we choose are kept.
 */
async function insertValidated(model: Model<any>, docs: Array<Record<string, unknown>>): Promise<void> {
  if (docs.length === 0) return;
  const rows = docs.map((d) => {
    const m = new model(d);
    const err = m.validateSync();
    if (err) throw new Error(`${model.modelName} validation failed: ${err.message}`);
    const o = m.toObject({ depopulate: true }) as Record<string, unknown>;
    o.createdAt = (d.createdAt as Date) ?? NOW;
    o.updatedAt = (d.updatedAt as Date) ?? o.createdAt;
    return o;
  });
  await model.collection.insertMany(rows);
}

// ---------------------------------------------------------------------------
// Wipe (only the demo account)
// ---------------------------------------------------------------------------
async function wipe(): Promise<boolean> {
  const user = await User.findOne({ email: DEMO_EMAIL }).select('_id').lean<{ _id: mongoose.Types.ObjectId } | null>();
  if (!user) return false;
  const profile = await GroomerProfile.findOne({ userId: user._id }).select('groomerSlug').lean<{ groomerSlug?: string } | null>();
  if (profile && profile.groomerSlug !== DEMO_SLUG) {
    throw new Error(`Refusing to wipe: ${DEMO_EMAIL} has slug "${profile.groomerSlug}", not the demo slug.`);
  }
  const gid = user._id;
  const counts: Record<string, number> = {};
  for (const m of [Appointment, Client, Pet, Service, Transaction, SmsMessage, FillEvent, Waitlist, CalendarBlock, PendingBooking] as Model<any>[]) {
    counts[m.modelName] = (await m.deleteMany({ groomerId: gid })).deletedCount ?? 0;
  }
  counts.Subscription = (await Subscription.deleteMany({ groomerId: gid })).deletedCount ?? 0;
  counts.GroomerProfile = (await GroomerProfile.deleteMany({ userId: gid })).deletedCount ?? 0;
  counts.User = (await User.deleteOne({ _id: gid })).deletedCount ?? 0;
  console.log('Removed demo data:', counts);
  return true;
}

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------
const SERVICES = [
  { key: 'full', name: 'Full Groom', basePrice: 95, durationMinutes: 120, description: 'Bath, haircut, nails, ears and a blow-dry finish.' },
  { key: 'bath', name: 'Bath & Tidy', basePrice: 65, durationMinutes: 75, description: 'Bath, blow-dry, nail trim and a face, feet and sanitary tidy.' },
  { key: 'deshed', name: 'De-shed Treatment', basePrice: 85, durationMinutes: 90, description: 'Deep de-shed bath and blow-out for double-coated breeds.' },
  { key: 'puppy', name: 'Puppy First Groom', basePrice: 55, durationMinutes: 60, description: 'A short, gentle first visit for puppies under 6 months.' },
  { key: 'nails', name: 'Nail Trim & Paw Tidy', basePrice: 25, durationMinutes: 20, description: 'Nails clipped and filed, paw pads tidied.' },
] as const;
type SvcKey = (typeof SERVICES)[number]['key'];

const CLIENTS = [
  { name: 'Sarah Mitchell', street: '2401 Windsor Rd', zip: '78703', lat: 30.2925, lng: -97.7633 },
  { name: 'James Carter', street: '4512 Avenue F', zip: '78751', lat: 30.3098, lng: -97.727 },
  { name: 'Priya Raman', street: '1907 Barton Hills Dr', zip: '78704', lat: 30.2526, lng: -97.782 },
  { name: 'Emily Nguyen', street: '3305 Bluebonnet Ln', zip: '78704', lat: 30.245, lng: -97.7835 },
  { name: 'Marcus Johnson', street: '6200 Shoal Creek Blvd', zip: '78757', lat: 30.3462, lng: -97.7496 },
  { name: 'Olivia Brooks', street: '1500 E 12th St', zip: '78702', lat: 30.2733, lng: -97.7255 },
  { name: 'Daniel Reyes', street: '8700 Mesa Dr', zip: '78759', lat: 30.3891, lng: -97.7535 },
  { name: 'Hannah Lee', street: '2100 Kinney Ave', zip: '78704', lat: 30.2522, lng: -97.7651 },
  { name: 'Ethan Walker', street: '5003 Bull Creek Rd', zip: '78731', lat: 30.329, lng: -97.7567 },
  { name: 'Grace Patel', street: '1201 S Lamar Blvd', zip: '78704', lat: 30.2531, lng: -97.7633 },
  { name: 'Noah Thompson', street: '4700 E Riverside Dr', zip: '78741', lat: 30.236, lng: -97.723 },
  { name: 'Ava Martinez', street: '9500 Great Hills Trl', zip: '78759', lat: 30.3965, lng: -97.752 },
] as const;

type Coat = 'smooth' | 'double' | 'wire' | 'curly' | 'long' | 'matted';
type Temper = 'calm' | 'nervous' | 'aggressive' | 'friendly';
const PETS: Array<{ c: number; name: string; breed: string; weight: number; age: number; temperament: Temper; coat: Coat; flags?: string[]; notes?: string; svc: SvcKey }> = [
  { c: 0, name: 'Bella', breed: 'Golden Retriever', weight: 65, age: 5, temperament: 'friendly', coat: 'double', svc: 'full', notes: 'Loves the blow-dryer. Treats OK.' },
  { c: 0, name: 'Milo', breed: 'Cavapoo', weight: 18, age: 2, temperament: 'calm', coat: 'curly', svc: 'full' },
  { c: 1, name: 'Duke', breed: 'German Shepherd', weight: 80, age: 6, temperament: 'calm', coat: 'double', svc: 'deshed' },
  { c: 2, name: 'Luna', breed: 'Shih Tzu', weight: 12, age: 4, temperament: 'friendly', coat: 'long', svc: 'full', notes: 'Teddy-bear face, short body.' },
  { c: 2, name: 'Coco', breed: 'Toy Poodle', weight: 8, age: 11, temperament: 'nervous', coat: 'curly', flags: ['senior', 'anxious'], svc: 'full', notes: 'Go slow around the face. Owner likes a bow.' },
  { c: 3, name: 'Max', breed: 'Labradoodle', weight: 55, age: 3, temperament: 'friendly', coat: 'curly', svc: 'full' },
  { c: 4, name: 'Rocky', breed: 'Boxer', weight: 70, age: 7, temperament: 'friendly', coat: 'smooth', svc: 'bath' },
  { c: 5, name: 'Daisy', breed: 'Pomeranian', weight: 7, age: 5, temperament: 'nervous', coat: 'double', flags: ['anxious'], svc: 'deshed' },
  { c: 6, name: 'Charlie', breed: 'Miniature Schnauzer', weight: 18, age: 6, temperament: 'calm', coat: 'wire', svc: 'bath' },
  { c: 7, name: 'Lola', breed: 'Maltese', weight: 9, age: 12, temperament: 'calm', coat: 'long', flags: ['senior'], svc: 'full' },
  { c: 8, name: 'Bear', breed: 'Bernese Mountain Dog', weight: 95, age: 4, temperament: 'friendly', coat: 'double', svc: 'deshed', notes: 'Needs the ramp to get into the van.' },
  { c: 9, name: 'Penny', breed: 'Cocker Spaniel', weight: 26, age: 3, temperament: 'nervous', coat: 'long', svc: 'full' },
  { c: 10, name: 'Tucker', breed: 'Australian Shepherd', weight: 50, age: 2, temperament: 'friendly', coat: 'double', svc: 'deshed' },
  { c: 11, name: 'Nala', breed: 'Goldendoodle', weight: 60, age: 4, temperament: 'friendly', coat: 'curly', svc: 'full' },
  { c: 11, name: 'Ollie', breed: 'Yorkshire Terrier', weight: 6, age: 8, temperament: 'calm', coat: 'long', svc: 'full' },
  { c: 11, name: 'Ziggy', breed: 'Siberian Husky', weight: 55, age: 3, temperament: 'friendly', coat: 'double', svc: 'deshed' },
];
const intervalWeeks = (coat: Coat) => (coat === 'curly' || coat === 'long' ? 6 : coat === 'double' ? 8 : 10);
const SLOTS: Array<[number, number]> = [[8, 30], [10, 45], [13, 15], [15, 30]];

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------
async function seed(password: string): Promise<void> {
  const gid = new mongoose.Types.ObjectId();
  const signedUp = addDays(NOW, -185);

  await insertValidated(User, [{
    _id: gid, email: DEMO_EMAIL, name: DEMO_NAME, role: 'groomer', isActive: true,
    passwordHash: await bcrypt.hash(password, 12), failedLoginAttempts: 0, lockedUntil: null,
    emailVerifiedAt: addDays(signedUp, 0), createdAt: signedUp,
  }]);

  await insertValidated(GroomerProfile, [{
    userId: gid, businessName: BUSINESS, groomerSlug: DEMO_SLUG, phone: '+15125550100', businessEmail: DEMO_EMAIL,
    depositAmount: DEPOSIT, depositPolicy: 'Deposits are non-refundable for cancellations within 24 hours of the appointment.',
    estimateRules: [
      { coatCondition: 'matted', priceAdjustmentPercent: 25, note: 'Dematting takes extra time.' },
      { coatCondition: 'double', priceAdjustmentPercent: 15, note: 'Undercoat removal.' },
      { weightRange: { min: 60, max: 200 }, priceAdjustmentPercent: 20, note: 'Large breed.' },
    ],
    // dayOfWeek: 0 = Monday ... 6 = Sunday
    availabilityWindows: [0, 1, 2, 3, 4].map((d) => ({ dayOfWeek: d, startTime: '08:00', endTime: '17:00' })).concat([{ dayOfWeek: 5, startTime: '09:00', endTime: '15:00' }]),
    blockedDates: [{ startDateTime: at(24, 0), endDateTime: at(26, 23, 59) }],
    onboardingComplete: true, onboardingStep: 6, timezone: TZ,
    baseAddress: '1100 Congress Ave, Austin, TX 78701', baseLocation: BASE, serviceRadiusKm: 25,
    bookingMode: 'instant', icsFeedToken: randomBytes(24).toString('base64url'), createdAt: signedUp,
  }]);

  await insertValidated(Subscription, [{
    groomerId: gid, plan: 'pro', status: 'active', smsIncluded: PLANS.pro.sms,
    trialStartedAt: signedUp, trialDeadline: addDays(signedUp, 14), trialEndsAt: addDays(signedUp, 14),
    currentPeriodEnd: addDays(NOW, 365), createdAt: signedUp,
  }]);

  const svcIds: Record<SvcKey, mongoose.Types.ObjectId> = {} as never;
  await insertValidated(Service, SERVICES.map((s) => {
    const _id = new mongoose.Types.ObjectId();
    svcIds[s.key] = _id;
    return { _id, groomerId: gid, name: s.name, description: s.description, basePrice: s.basePrice, durationMinutes: s.durationMinutes, isActive: true, createdAt: signedUp };
  }));
  const svc = (k: SvcKey) => SERVICES.find((s) => s.key === k)!;

  const clients = CLIENTS.map((c, i) => {
    const [first, last] = c.name.toLowerCase().split(' ');
    return {
      _id: new mongoose.Types.ObjectId(), groomerId: gid, name: c.name,
      email: `${first}.${last}@example.com`, phone: `+1512555${String(101 + i).padStart(4, '0')}`,
      address: { street: c.street, city: 'Austin', state: 'TX', postalCode: c.zip },
      location: { lat: c.lat, lng: c.lng }, smsConsentAt: addDays(NOW, -170 + i * 9),
      createdAt: addDays(NOW, -175 + i * 9),
    };
  });
  const pets = PETS.map((p) => ({
    _id: new mongoose.Types.ObjectId(), groomerId: gid, clientId: clients[p.c]._id, name: p.name, breed: p.breed,
    weight: p.weight, weightUnit: 'lbs', age: p.age, temperament: p.temperament, coatCondition: p.coat,
    specialFlags: p.flags ?? [], notes: p.notes, rebookIntervalWeeks: intervalWeeks(p.coat),
    createdAt: clients[p.c].createdAt,
    _svc: p.svc, _client: p.c,
  }));

  type Appt = Record<string, unknown> & { _id: mongoose.Types.ObjectId; scheduledDate: Date; status: string; petId: mongoose.Types.ObjectId };
  const appts: Appt[] = [];
  const txs: Array<Record<string, unknown>> = [];

  const makeAppt = (petIdx: number, start: Date, status: string, extra: Record<string, unknown> = {}): Appt => {
    const p = pets[petIdx];
    const c = clients[p._client];
    const s = svc(p._svc as SvcKey);
    const created = (extra.createdAt as Date) ?? addDays(start, -(3 + Math.floor(rand() * 10)));
    const a: Appt = {
      _id: new mongoose.Types.ObjectId(), groomerId: gid, clientId: c._id, petId: p._id,
      serviceId: svcIds[s.key], serviceIds: [svcIds[s.key]],
      scheduledDate: start, scheduledEndDate: addMin(start, s.durationMinutes), status,
      serviceAddress: `${c.address.street}, Austin, TX ${c.address.postalCode}`,
      location: c.location, bookingRef: bookingRef(), source: rand() < 0.8 ? 'public' : rand() < 0.5 ? 'rebook' : 'manual',
      depositDue: DEPOSIT, depositStatus: status === 'cancelled' ? undefined : 'received',
      ...(status === 'completed' ? { amountCharged: s.basePrice + pick([0, 0, 0, 5, 10, 15]) } : {}),
      createdAt: created, updatedAt: status === 'completed' ? addMin(start, s.durationMinutes) : created,
      ...extra,
    };
    a.createdAt = created;
    appts.push(a);
    if (status !== 'cancelled') {
      txs.push({
        appointmentId: a._id, groomerId: gid, stripePaymentId: `demo_pi_${randomBytes(9).toString('hex')}`,
        amount: DEPOSIT, currency: 'usd', status: 'succeeded', createdAt: created,
      });
    }
    return a;
  };

  // --- History: the last ~6 months, ramping up as the business grows. Mon-Sat.
  for (let d = -182; d <= -1; d += 1) {
    const wd = dow(d);
    if (wd === 0) continue; // Sundays off
    const growth = 0.45 + 0.55 * ((d + 182) / 182);
    const maxSlots = wd === 6 ? 2 : 4;
    for (let s = 0; s < maxSlots; s += 1) {
      if (rand() > growth * 0.78) continue;
      const petIdx = Math.floor(rand() * pets.length);
      if (pets[petIdx].createdAt > at(d, 0)) continue; // client not signed up yet
      const [hh, mm] = SLOTS[s];
      makeAppt(petIdx, at(d, hh, mm), rand() < 0.06 ? 'cancelled' : 'completed');
    }
  }

  // --- Today's route: four stops, ordered by time. Status follows the clock
  // when the script runs, so stops already passed are completed (not no-shows).
  const todayPlan: Array<[number, number, number]> = [[0, 9, 0], [8, 11, 30], [3, 13, 45], [6, 15, 45]];
  let prev: Appt | null = null;
  for (const [petIdx, hh, mm] of todayPlan) {
    const p = pets[petIdx];
    const loc = clients[p._client].location;
    const fromPrev = prev ? (prev.location as { lat: number; lng: number }) : BASE;
    const dist = km(fromPrev, loc);
    const start = at(0, hh, mm);
    const end = addMin(start, svc(p._svc as SvcKey).durationMinutes);
    const status = end <= NOW ? 'completed' : start <= NOW ? 'in-progress' : 'upcoming';
    const a = makeAppt(petIdx, start, status, {
      createdAt: addDays(start, -6),
      routeMeta: { prevId: prev?._id ?? null, nextId: null, fromPrevKm: Number(dist.toFixed(1)), extraDriveMin: Math.max(3, Math.round((dist / 32) * 60)), score: Math.max(55, 96 - Math.round(dist * 3)) },
    });
    if (prev) (prev.routeMeta as Record<string, unknown>).nextId = a._id;
    prev = a;
  }

  // --- Next three weeks: booked days (Mon-Sat), 2-3 stops each.
  for (let d = 1; d <= 21; d += 1) {
    const wd = dow(d);
    if (wd === 0) continue;
    const slots = wd === 6 ? [0, 1] : [0, 1, 2, 3].filter(() => rand() < (d <= 7 ? 0.75 : 0.5));
    for (const s of slots) {
      const [hh, mm] = SLOTS[s];
      makeAppt(Math.floor(rand() * pets.length), at(d, hh, mm), 'upcoming');
    }
  }

  // --- Order Radar: three bookings that came in during the last two days,
  // each scored against the stop before it that day.
  const radarPlan: Array<[number, number, number, number]> = [
    // dayOffset, petIdx, slot, score
    [2, 13, 2, 91],
    [3, 10, 3, 68],
    [5, 12, 2, 42],
  ];
  for (const [d, petIdx, s, score] of radarPlan) {
    if (dow(d) === 0) continue;
    const [hh, mm] = SLOTS[s];
    const start = at(d, hh, mm);
    // Drop anything already booked in that slot so the day never double-books.
    for (let i = appts.length - 1; i >= 0; i -= 1) {
      if (appts[i].scheduledDate.getTime() === start.getTime()) {
        const [removed] = appts.splice(i, 1);
        const t = txs.findIndex((x) => x.appointmentId === removed._id);
        if (t >= 0) txs.splice(t, 1);
      }
    }
    const before = appts
      .filter((a) => a.scheduledDate < start && a.scheduledDate > at(d, 0) && a.status === 'upcoming')
      .sort((a, b) => b.scheduledDate.getTime() - a.scheduledDate.getTime())[0];
    const loc = clients[pets[petIdx]._client].location;
    const dist = km((before?.location as { lat: number; lng: number }) ?? BASE, loc);
    makeAppt(petIdx, start, 'upcoming', {
      createdAt: addMin(NOW, -(60 * (6 + d * 7))),
      routeMeta: { prevId: before?._id ?? null, nextId: null, fromPrevKm: Number(dist.toFixed(1)), extraDriveMin: Math.max(4, Math.round((dist / 32) * 60) + (100 - score) / 6), score },
    });
  }

  // --- Pet grooming cycle: last groom, next due. Leave a few due soon with no
  // booking so "Rebooking due" has real entries.
  const futureByPet = new Set(appts.filter((a) => a.scheduledDate > NOW).map((a) => String(a.petId)));
  for (const p of pets) {
    const done = appts.filter((a) => String(a.petId) === String(p._id) && a.status === 'completed').sort((a, b) => b.scheduledDate.getTime() - a.scheduledDate.getTime());
    if (done[0]) {
      (p as Record<string, unknown>).lastGroomAt = done[0].scheduledDate;
      let due = addDays(done[0].scheduledDate, p.rebookIntervalWeeks * 7);
      if (!futureByPet.has(String(p._id)) && due < NOW) due = addDays(NOW, 2 + Math.floor(rand() * 9));
      (p as Record<string, unknown>).nextDueAt = due;
    }
  }

  // --- Inbox: a few realistic threads.
  const fmt = (d: Date) => d.toLocaleString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const todays = appts.filter((a) => a.scheduledDate >= at(0, 0) && a.scheduledDate <= at(0, 23, 59)).sort((a, b) => a.scheduledDate.getTime() - b.scheduledDate.getTime());
  const msgs: Array<Record<string, unknown>> = [];
  const msg = (ci: number, direction: 'in' | 'out', kind: string, body: string, minutesAgo: number, read = true, appointmentId: unknown = null) =>
    msgs.push({ groomerId: gid, clientId: clients[ci]._id, appointmentId, direction, kind, body, status: direction === 'in' ? 'received' : 'delivered', phone: clients[ci].phone, read, segments: 1, createdAt: addMin(NOW, -minutesAgo) });
  const petName = (a: Appt) => pets.find((p) => String(p._id) === String(a.petId))!.name;
  if (todays[0]) {
    msg(0, 'out', 'booking_confirmed', `${BUSINESS}: You're booked for ${petName(todays[0])} on ${fmt(todays[0].scheduledDate)}. Reply STOP to opt out.`, 60 * 52, true, todays[0]._id);
    msg(0, 'out', 'reminder_24h', `Reminder: ${petName(todays[0])}'s groom is tomorrow at ${fmt(todays[0].scheduledDate).split(', ').pop()}. Please have water and a power outlet ready.`, 60 * 20, true, todays[0]._id);
    msg(0, 'in', 'reply', 'Perfect, thank you! Gate code is 4417 and Bella will be in the backyard.', 60 * 19, false, todays[0]._id);
  }
  if (todays[1]) {
    msg(6, 'out', 'booking_confirmed', `${BUSINESS}: You're booked for ${petName(todays[1])} on ${fmt(todays[1].scheduledDate)}. Reply STOP to opt out.`, 60 * 30, true, todays[1]._id);
    msg(6, 'in', 'reply', 'Could you come 15 minutes later? I get back from school pickup at 11:40.', 45, false, todays[1]._id);
  }
  msg(2, 'out', 'reminder_24h', "Reminder: Coco's groom is coming up. Reply if anything has changed.", 60 * 26);
  msg(2, 'in', 'reply', 'Can Coco get a bow again this time? She loved it.', 60 * 25);
  msg(2, 'out', 'reply', 'Of course! Pink or blue?', 60 * 24);
  msg(2, 'in', 'reply', 'Pink please 💗', 60 * 24 - 5);
  msg(5, 'out', 'rebook_nudge', `Hi Olivia, Daisy is due for her next groom. Book a time that suits you: pawxis.app/book/${DEMO_SLUG}`, 60 * 72);
  msg(5, 'in', 'reply', 'Yes please! Is next Thursday afternoon free?', 60 * 70, false);

  // --- Write everything (validated).
  await insertValidated(Client, clients);
  await insertValidated(Pet, pets.map(({ _svc, _client, ...p }) => p));
  await insertValidated(Appointment, appts);
  await insertValidated(Transaction, txs);
  await insertValidated(SmsMessage, msgs);

  const past = appts.filter((a) => a.scheduledDate < NOW);
  console.log('Seeded demo account:', {
    services: SERVICES.length, clients: clients.length, pets: pets.length,
    appointments: appts.length, completed: past.filter((a) => a.status === 'completed').length,
    cancelled: past.filter((a) => a.status === 'cancelled').length,
    upcoming: appts.filter((a) => a.status === 'upcoming').length, today: todays.length,
    deposits: txs.length, messages: msgs.length,
  });
}

async function main(): Promise<void> {
  if (!flag('yes')) {
    console.error('This writes to the database in .env. Re-run with --yes (add --reset or --remove as needed).');
    process.exit(1);
  }
  const uri = process.env.MONGODB_URI_DIRECT || process.env.MONGODB_URI || '';
  const target = uri.replace(/\/\/[^@]*@/, '//<credentials>@').replace(/\?.*$/, '');
  console.log(`Target database: ${target.split(',')[0]}… (db: ${uri.match(/\/([^/?]+)(\?|$)/)?.[1] ?? '?'})`);

  await connectDB();
  if (flag('remove')) {
    if (!(await wipe())) console.log('No demo account to remove.');
    await mongoose.disconnect();
    return;
  }
  const exists = await User.exists({ email: DEMO_EMAIL });
  if (exists && !flag('reset')) {
    console.error(`${DEMO_EMAIL} already exists. Re-run with --reset to re-create it, or --remove to delete it.`);
    await mongoose.disconnect();
    process.exit(1);
  }
  if (exists) await wipe();

  const password = arg('password') ?? `Demo-${randomBytes(4).toString('hex')}-Paws9`;
  if (!isValidPassword(password)) throw new Error('Password must be 8+ chars with upper, lower and a digit.');
  await seed(password);
  console.log(`Timezone: ${TZ}`);
  console.log(`\nLog in at /login\n  email:    ${DEMO_EMAIL}\n  password: ${password}\n  booking:  /book/${DEMO_SLUG}`);
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error('seed-demo failed:', e instanceof Error ? e.message : e);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
