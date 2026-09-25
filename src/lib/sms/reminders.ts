/**
 * Reminder scheduling via QStash (Master Spec §12.3).
 *
 * On booking commit we schedule two reminders — `reminder_24h` and
 * `reminder_2h` — by publishing delayed jobs to `/api/qstash/reminder`. QStash
 * calls that endpoint at the requested delay; the endpoint verifies the QStash
 * signature and calls `sendSms`. The returned QStash message ids are stored on
 * the appointment (`reminderJobIds`) so a reschedule/cancel can cancel them.
 *
 * Degradation (CRITICAL): with no `QSTASH_TOKEN` or no `NEXT_PUBLIC_APP_URL`,
 * scheduling is a NO-OP that logs — the booking still succeeds. A Vercel-cron
 * fallback that scans for due reminders is a documented SEAM (Master Spec §16
 * Jobs) and is intentionally NOT built here.
 *
 * The pure scheduling math ({@link computeReminderDelays}) is exported and
 * DB/QStash-free so it can be unit-tested directly.
 *
 * _Master Spec: §12.3, §16_
 */

/** The reminder kinds this module schedules. */
export type ReminderKind = 'reminder_24h' | 'reminder_2h';

/** A single reminder to schedule: how many ms from `now` to fire, and its kind. */
export interface ReminderDelay {
  kind: ReminderKind;
  /** Delay from `now` in milliseconds (>= 0). */
  delayMs: number;
}

const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * PURE: compute the reminder delays for an appointment starting at `startAtMs`,
 * evaluated relative to `nowMs`.
 *
 * - `reminder_24h` fires 24h before the start.
 * - `reminder_2h` fires 2h before the start.
 *
 * A reminder whose fire time is already in the past (delay < 0) is DROPPED, so
 * booking something 30 minutes out schedules neither, and booking 3 hours out
 * schedules only the 2h reminder. Delays are clamped to whole milliseconds.
 */
export function computeReminderDelays(startAtMs: number, nowMs: number): ReminderDelay[] {
  const out: ReminderDelay[] = [];
  const at24 = startAtMs - 24 * MS_PER_HOUR - nowMs;
  const at2 = startAtMs - 2 * MS_PER_HOUR - nowMs;
  if (at24 >= 0) out.push({ kind: 'reminder_24h', delayMs: Math.round(at24) });
  if (at2 >= 0) out.push({ kind: 'reminder_2h', delayMs: Math.round(at2) });
  return out;
}

/** Whether QStash is configured for scheduling. */
export function isQStashConfigured(): boolean {
  return Boolean(process.env.QSTASH_TOKEN);
}

/** The absolute callback URL QStash should hit to deliver a reminder. */
function reminderCallbackUrl(): string | undefined {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '');
  return base ? `${base}/api/qstash/reminder` : undefined;
}

/** Input to {@link scheduleReminders}. */
export interface ScheduleRemindersInput {
  appointmentId: string;
  groomerId: string;
  /** Appointment start, epoch ms. */
  startAtMs: number;
  /** Evaluate delays relative to this instant (defaults to now). */
  nowMs?: number;
}

/**
 * Schedule the 24h + 2h reminders for an appointment via QStash and persist the
 * returned message ids on the appointment. Best-effort and NEVER throws — a
 * scheduling failure must never fail the booking commit that calls it.
 *
 * Returns the scheduled QStash message ids (empty when unconfigured / nothing
 * to schedule).
 */
export async function scheduleReminders(input: ScheduleRemindersInput): Promise<string[]> {
  const nowMs = input.nowMs ?? Date.now();
  const delays = computeReminderDelays(input.startAtMs, nowMs);
  if (delays.length === 0) return [];

  const callback = reminderCallbackUrl();

  if (!isQStashConfigured() || !callback) {
    console.info(
      `[sms:reminders] QStash not configured — skipping ${delays
        .map((d) => d.kind)
        .join(', ')} for appointment ${input.appointmentId} (no-op).`
    );
    return [];
  }

  try {
    // Lazy import so the SDK never loads when unconfigured.
    const { Client } = await import('@upstash/qstash');
    const qstash = new Client({ token: process.env.QSTASH_TOKEN! });

    const ids: string[] = [];
    for (const d of delays) {
      try {
        const res = await qstash.publishJSON({
          url: callback,
          body: {
            appointmentId: input.appointmentId,
            groomerId: input.groomerId,
            kind: d.kind,
          },
          delay: Math.ceil(d.delayMs / 1000), // QStash delay is in seconds
        });
        const messageId = (res as { messageId?: string }).messageId;
        if (messageId) ids.push(messageId);
      } catch (err) {
        console.error(`[sms:reminders] failed to schedule ${d.kind}:`, err);
      }
    }

    if (ids.length) {
      await persistJobIds(input.appointmentId, ids).catch(() => {});
    }
    return ids;
  } catch (err) {
    console.error('[sms:reminders] scheduleReminders failed (non-fatal):', err);
    return [];
  }
}

/** Store the QStash message ids on the appointment (best-effort). */
async function persistJobIds(appointmentId: string, ids: string[]): Promise<void> {
  const { connectDB } = await import('@/lib/db/connect');
  await connectDB();
  const { Appointment } = await import('@/lib/db/models/appointment');
  await Appointment.updateOne({ _id: appointmentId }, { $set: { reminderJobIds: ids } });
}

/**
 * Cancel previously-scheduled reminder jobs by their QStash message ids
 * (reschedule / cancel). Best-effort and NEVER throws. No-op when QStash is
 * unconfigured or `ids` is empty.
 */
export async function cancelReminders(ids: string[] | undefined | null): Promise<void> {
  if (!ids || ids.length === 0) return;
  if (!isQStashConfigured()) {
    console.info('[sms:reminders] QStash not configured — cancelReminders no-op.');
    return;
  }
  try {
    const { Client } = await import('@upstash/qstash');
    const qstash = new Client({ token: process.env.QSTASH_TOKEN! });
    for (const id of ids) {
      try {
        await qstash.messages.delete(id);
      } catch (err) {
        // A job that already fired / was deleted 404s — that's fine.
        console.info(`[sms:reminders] cancel of ${id} skipped:`, err instanceof Error ? err.message : err);
      }
    }
  } catch (err) {
    console.error('[sms:reminders] cancelReminders failed (non-fatal):', err);
  }
}

/**
 * Convenience for reschedule/cancel flows: load an appointment's stored
 * `reminderJobIds`, cancel them, and clear the field. Best-effort, never throws.
 */
export async function cancelRemindersForAppointment(appointmentId: string): Promise<void> {
  try {
    const { connectDB } = await import('@/lib/db/connect');
    await connectDB();
    const { Appointment } = await import('@/lib/db/models/appointment');
    const appt = await Appointment.findById(appointmentId).select('reminderJobIds').lean();
    const ids = (appt as { reminderJobIds?: string[] } | null)?.reminderJobIds;
    await cancelReminders(ids);
    if (ids && ids.length) {
      await Appointment.updateOne({ _id: appointmentId }, { $unset: { reminderJobIds: '' } }).catch(
        () => {}
      );
    }
  } catch (err) {
    console.error('[sms:reminders] cancelRemindersForAppointment failed (non-fatal):', err);
  }
}
