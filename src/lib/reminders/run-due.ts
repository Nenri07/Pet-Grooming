/**
 * Reminder sweep: sends the 24-hour and 2-hour appointment reminders.
 *
 * Runs on a schedule (every ~15 minutes) instead of per-booking delayed jobs,
 * so reminders work with no QStash and no Twilio:
 *   - EMAIL always goes out (Resend).
 *   - SMS goes out only when QStash is NOT configured; when it is, the
 *     per-booking QStash jobs already send the texts, so we don't double up.
 *
 * Each reminder is claimed atomically (sent-at flag set in the same update that
 * selects it), so overlapping runs never send twice.
 */
import { connectDB } from '@/lib/db/connect';
import { Appointment } from '@/lib/db/models/appointment';
import { Client } from '@/lib/db/models/client';
import { Pet } from '@/lib/db/models/pet';
import { GroomerProfile } from '@/lib/db/models/groomer-profile';
import { sendAppointmentReminderEmail } from '@/lib/email/send';

const HOUR = 60 * 60 * 1000;
const BATCH = 200;

export interface ReminderWindow {
  kind: '24h' | '2h';
  flag: 'reminder24SentAt' | 'reminder2SentAt';
  /** Lead time before the appointment. */
  leadMs: number;
  /** Lower edge: never send for appointments starting sooner than this. */
  minAheadMs: number;
}

export const REMINDER_WINDOWS: readonly ReminderWindow[] = [
  { kind: '24h', flag: 'reminder24SentAt', leadMs: 24 * HOUR, minAheadMs: 2 * HOUR },
  { kind: '2h', flag: 'reminder2SentAt', leadMs: 2 * HOUR, minAheadMs: 0 },
];

/**
 * PURE: should this reminder go out now? Due once we're inside the lead time,
 * not after the appointment started, and only if the booking was made before
 * the reminder time (someone who books 3 hours ahead doesn't need a
 * "tomorrow" email).
 */
export function isReminderDue(
  w: ReminderWindow,
  appt: { scheduledDate: Date; createdAt?: Date | null },
  now: Date
): boolean {
  const start = appt.scheduledDate.getTime();
  const t = now.getTime();
  if (start - t > w.leadMs) return false; // too early
  if (start - t <= w.minAheadMs) return false; // too late for this one
  const created = appt.createdAt ? appt.createdAt.getTime() : 0;
  return created <= start - w.leadMs;
}

export interface SweepResult {
  emailed: number;
  texted: number;
  skipped: number;
}

export async function runDueReminders(now: Date = new Date()): Promise<SweepResult> {
  await connectDB();
  const result: SweepResult = { emailed: 0, texted: 0, skipped: 0 };
  const smsHere = !process.env.QSTASH_TOKEN;

  for (const w of REMINDER_WINDOWS) {
    const candidates = await Appointment.find({
      status: 'upcoming',
      scheduledDate: { $gt: new Date(now.getTime() + w.minAheadMs), $lte: new Date(now.getTime() + w.leadMs) },
      [w.flag]: { $exists: false },
    })
      .select('_id groomerId clientId petId scheduledDate serviceAddress createdAt')
      .limit(BATCH)
      .lean<
        Array<{
          _id: unknown;
          groomerId: unknown;
          clientId: unknown;
          petId: unknown;
          scheduledDate: Date;
          serviceAddress?: string;
          createdAt?: Date;
        }>
      >();

    for (const appt of candidates) {
      if (!isReminderDue(w, appt, now)) {
        // Booked too late for this reminder: mark it so we stop re-checking.
        await Appointment.updateOne({ _id: appt._id, [w.flag]: { $exists: false } }, { $set: { [w.flag]: now } });
        result.skipped++;
        continue;
      }
      // Atomic claim.
      const claimed = await Appointment.findOneAndUpdate(
        { _id: appt._id, status: 'upcoming', [w.flag]: { $exists: false } },
        { $set: { [w.flag]: now } },
        { new: false }
      )
        .select('_id')
        .lean();
      if (!claimed) continue;

      try {
        const [client, pet, profile] = await Promise.all([
          Client.findById(appt.clientId).select('email phone').lean<{ email?: string; phone?: string } | null>(),
          Pet.findById(appt.petId).select('name').lean<{ name?: string } | null>(),
          GroomerProfile.findOne({ userId: appt.groomerId })
            .select('businessName businessEmail phone timezone')
            .lean<{ businessName?: string; businessEmail?: string; phone?: string; timezone?: string } | null>(),
        ]);
        const tz = profile?.timezone || 'UTC';
        const when = new Date(appt.scheduledDate);
        const date = when.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' });
        const time = when.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
        const petName = pet?.name ?? 'your pet';

        if (client?.email) {
          const ok = await sendAppointmentReminderEmail(client.email, {
            kind: w.kind,
            businessName: profile?.businessName ?? '',
            petName,
            date,
            time,
            serviceAddress: appt.serviceAddress,
            groomerPhone: profile?.phone,
            replyTo: profile?.businessEmail?.trim() || undefined,
          });
          if (ok) result.emailed++;
        }

        if (smsHere && client?.phone) {
          const { sendSms } = await import('@/lib/sms/send-sms');
          const res = await sendSms({
            groomerId: String(appt.groomerId),
            clientId: String(appt.clientId),
            appointmentId: String(appt._id),
            to: client.phone,
            kind: w.kind === '24h' ? 'reminder_24h' : 'reminder_2h',
            vars: { pet: petName, date, time },
          });
          if ((res as { ok?: boolean })?.ok) result.texted++;
        }
      } catch (err) {
        console.error(`[reminders] ${w.kind} for ${String(appt._id)} failed:`, err);
      }
    }
  }
  return result;
}
