/**
 * SMS send orchestrator (Master Spec §12).
 *
 * `sendSms` is the ONE entry point the rest of the app calls to text a client.
 * It composes the pure gates (consent, quiet-hours, quota) with the provider
 * seam and the {@link SmsMessage} log:
 *
 *   1. Load the client's consent / opt-out + the groomer's business name +
 *      timezone.
 *   2. Consent gate ({@link mayReceive}) — never message without consent
 *      (except a single transactional confirmation) and never an opted-out
 *      number.
 *   3. Quiet-hours gate ({@link isWithinQuietHours}) — marketing only 08:00–20:30
 *      groomer-local; transactional anytime.
 *   4. Quota gate ({@link canSend}) using the current month's usage.
 *   5. Render the template ({@link renderTemplate}).
 *   6. Send via the provider ({@link getSmsProvider}) with up to 3 attempts +
 *      backoff.
 *   7. Log an outbound {@link SmsMessage}, increment usage.
 *   8. On repeated failure, log for review; for `booking_confirmed` fall back to
 *      a Resend confirmation email.
 *
 * CRITICAL: this NEVER throws to its caller. Every path returns a typed result.
 * With no Twilio/Redis/DB it still returns a sensible outcome (the provider is
 * the no-op-that-logs and the quota/consent gates degrade open/skip).
 *
 * _Master Spec: §12_
 */
import type { SmsKind } from './provider';
import { getSmsProvider } from './provider';
import { renderTemplate, type TemplateVars } from './templates';
import { mayReceive } from './consent';
import { isWithinQuietHours, resolveLocalTime } from './quiet-hours';
import { canSend, getUsage, incrementUsage } from './quota';

/** Included monthly SMS allowance fallback when a plan can't be resolved. */
const DEFAULT_INCLUDED_SMS = 300;

/** Retry policy for provider sends (Master Spec §12.3: up to 3× with backoff). */
const MAX_SEND_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 300;

/** Arguments to {@link sendSms}. */
export interface SendSmsInput {
  groomerId: string;
  /** The client this is going to (used for consent + logging). Optional for leads. */
  clientId?: string;
  /** Related appointment, when applicable. */
  appointmentId?: string;
  /** Destination phone (E.164 preferred). */
  to: string;
  kind: SmsKind;
  /** Template variables ({pet}{date}{time}{business}{link}). `business` is filled in if omitted. */
  vars?: TemplateVars;
  /** Override the rendered body entirely (used for freeform replies). */
  bodyOverride?: string;
  /** For tests / scheduled jobs: the instant to evaluate quiet-hours against. */
  now?: Date;
}

/** Why a send did not go out. */
export type SendSmsOutcome =
  | 'sent'
  | 'skipped_no_provider'
  | 'blocked_consent'
  | 'blocked_quiet_hours'
  | 'blocked_quota'
  | 'failed'
  | 'error';

/** Result of {@link sendSms}. Never thrown — always returned. */
export interface SendSmsResult {
  ok: boolean;
  outcome: SendSmsOutcome;
  /** Provider message id when a send was attempted. */
  id?: string;
  /** Provider status, or a reason string when blocked. */
  status?: string;
  /** Whether the email fallback fired (booking_confirmed only). */
  emailFallback?: boolean;
}

/** Sleep helper for backoff. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve the groomer's business name, timezone, and included SMS allowance,
 * plus the client's consent state and email/pet context. All best-effort; on
 * any DB error we return safe defaults so `sendSms` still runs its gates.
 */
async function loadContext(input: SendSmsInput): Promise<{
  business: string;
  timezone: string;
  included: number;
  consentAt?: Date | string | null;
  optOut?: boolean | null;
  clientEmail?: string;
  clientName?: string;
  customTemplates?: Partial<Record<SmsKind, string>>;
}> {
  const defaults = {
    business: 'PawPort',
    timezone: 'UTC',
    included: DEFAULT_INCLUDED_SMS,
  };

  try {
    const { connectDB } = await import('@/lib/db/connect');
    await connectDB();

    const { GroomerProfile } = await import('@/lib/db/models/groomer-profile');
    const profile = await GroomerProfile.findOne({ userId: input.groomerId })
      .select('businessName timezone')
      .lean();

    const business =
      (typeof profile?.businessName === 'string' && profile.businessName.trim()) ||
      defaults.business;
    const timezone =
      (typeof profile?.timezone === 'string' && profile.timezone.trim()) || defaults.timezone;

    // Resolve the included SMS allowance from the plan/subscription when present.
    const included = await resolveIncludedSms(input.groomerId).catch(() => defaults.included);

    let consentAt: Date | string | null | undefined;
    let optOut: boolean | null | undefined;
    let clientEmail: string | undefined;
    let clientName: string | undefined;

    if (input.clientId) {
      const { Client } = await import('@/lib/db/models/client');
      const client = await Client.findOne({ _id: input.clientId, groomerId: input.groomerId })
        .select('smsConsentAt smsOptOut email name')
        .lean();
      if (client) {
        consentAt = (client as { smsConsentAt?: Date }).smsConsentAt ?? null;
        optOut = (client as { smsOptOut?: boolean }).smsOptOut ?? false;
        clientEmail = (client as { email?: string }).email;
        clientName = (client as { name?: string }).name;
      }
    }

    return { business, timezone, included, consentAt, optOut, clientEmail, clientName };
  } catch (err) {
    console.error('[sms] loadContext failed, using defaults:', err);
    return { ...defaults };
  }
}

/**
 * Resolve the included monthly SMS allowance for a groomer.
 *
 * SEAM (Master Spec §13): the authoritative allowance lives on the
 * `Subscription` record (`smsIncluded` + `smsTopupBalance`), resolved from the
 * plan (Solo 300 / Pro 800). That model is built in Phase 5 (billing); until it
 * exists we read a static allowance from `SMS_INCLUDED_DEFAULT` (env) and fall
 * back to {@link DEFAULT_INCLUDED_SMS}. When the Subscription model lands, swap
 * this to read it — nothing else in the pipeline changes.
 */
async function resolveIncludedSms(_groomerId: string): Promise<number> {
  const fromEnv = Number(process.env.SMS_INCLUDED_DEFAULT);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_INCLUDED_SMS;
}

/**
 * Persist an outbound {@link SmsMessage} row. Best-effort — logging a message
 * must never break the send. Returns silently on any DB/model error.
 */
async function logOutbound(args: {
  groomerId: string;
  clientId?: string;
  appointmentId?: string;
  kind: SmsKind;
  body: string;
  to: string;
  twilioSid?: string;
  status: string;
  errorCode?: string;
}): Promise<void> {
  try {
    const { connectDB } = await import('@/lib/db/connect');
    await connectDB();
    const { SmsMessage } = await import('@/lib/db/models/sms-message');
    await SmsMessage.create({
      groomerId: args.groomerId,
      clientId: args.clientId ?? null,
      appointmentId: args.appointmentId ?? null,
      direction: 'out',
      kind: args.kind,
      body: args.body,
      phone: args.to,
      twilioSid: args.twilioSid,
      status: args.status,
      errorCode: args.errorCode,
    });
  } catch (err) {
    console.error('[sms] logOutbound failed (non-fatal):', err);
  }
}

/**
 * Fall back to a Resend confirmation email for `booking_confirmed` when SMS
 * could not be delivered. Best-effort; returns whether the email was sent.
 */
async function emailConfirmationFallback(
  clientEmail: string | undefined,
  ctx: { business: string; vars?: TemplateVars }
): Promise<boolean> {
  if (!clientEmail) return false;
  try {
    const { sendClientConfirmationEmail } = await import('@/lib/email/send');
    return await sendClientConfirmationEmail(clientEmail, {
      date: ctx.vars?.date ?? '',
      time: ctx.vars?.time ?? '',
      services: [],
      serviceAddress: '',
      groomerName: ctx.business,
      depositAmount: 0,
    });
  } catch (err) {
    console.error('[sms] email confirmation fallback failed:', err);
    return false;
  }
}

/**
 * Send an SMS through the full gate → provider → log pipeline. NEVER throws.
 *
 * See the module docs for the ordered pipeline. Returns a typed
 * {@link SendSmsResult} describing exactly what happened.
 */
export async function sendSms(input: SendSmsInput): Promise<SendSmsResult> {
  const now = input.now ?? new Date();

  try {
    const ctx = await loadContext(input);
    const vars: TemplateVars = { business: ctx.business, ...input.vars };

    // 2. Consent gate.
    if (!mayReceive(input.kind, { consentAt: ctx.consentAt, optOut: ctx.optOut })) {
      return { ok: false, outcome: 'blocked_consent', status: 'blocked_consent' };
    }

    // 3. Quiet-hours gate (marketing only).
    const local = resolveLocalTime(now, ctx.timezone);
    if (isWithinQuietHours(local, input.kind)) {
      return { ok: false, outcome: 'blocked_quiet_hours', status: 'blocked_quiet_hours' };
    }

    // 4. Quota gate.
    const used = await getUsage(input.groomerId, now);
    const decision = canSend({ used, included: ctx.included, kind: input.kind });
    if (!decision.allowed) {
      return { ok: false, outcome: 'blocked_quota', status: decision.reason ?? 'blocked_quota' };
    }

    // 5. Render the body (bodyOverride wins, for freeform replies).
    const body = input.bodyOverride?.trim()
      ? input.bodyOverride.trim()
      : renderTemplate(input.kind, vars, ctx.customTemplates);

    // 6. Send with retry + backoff.
    const provider = getSmsProvider();
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
      try {
        const res = await provider.send({
          to: input.to,
          body,
          groomerId: input.groomerId,
          kind: input.kind,
          meta: { clientId: input.clientId, appointmentId: input.appointmentId },
        });

        // 7. Log + increment usage. A no-op ('skipped') is logged but does NOT
        //    consume quota (nothing was actually sent).
        await logOutbound({
          groomerId: input.groomerId,
          clientId: input.clientId,
          appointmentId: input.appointmentId,
          kind: input.kind,
          body,
          to: input.to,
          twilioSid: res.id,
          status: res.status,
        });

        if (res.status === 'skipped') {
          return { ok: true, outcome: 'skipped_no_provider', id: res.id, status: res.status };
        }

        await incrementUsage(input.groomerId, now);
        return { ok: true, outcome: 'sent', id: res.id, status: res.status };
      } catch (err) {
        lastError = err;
        if (attempt < MAX_SEND_ATTEMPTS) {
          await delay(BASE_BACKOFF_MS * attempt);
        }
      }
    }

    // 8. All attempts failed: log for review and (for confirmations) fall back
    //    to email.
    const errorCode = lastError instanceof Error ? lastError.message.slice(0, 40) : 'send_failed';
    console.error(
      `[sms] send failed after ${MAX_SEND_ATTEMPTS} attempts (kind=${input.kind}, groomer=${input.groomerId}):`,
      lastError
    );
    await logOutbound({
      groomerId: input.groomerId,
      clientId: input.clientId,
      appointmentId: input.appointmentId,
      kind: input.kind,
      body,
      to: input.to,
      status: 'failed',
      errorCode,
    });

    let emailFallback = false;
    if (input.kind === 'booking_confirmed') {
      emailFallback = await emailConfirmationFallback(ctx.clientEmail, {
        business: ctx.business,
        vars,
      });
    }

    return { ok: false, outcome: 'failed', status: 'failed', emailFallback };
  } catch (err) {
    // Absolute backstop — sendSms must never throw.
    console.error('[sms] sendSms encountered an unexpected error:', err);
    return { ok: false, outcome: 'error', status: 'error' };
  }
}
