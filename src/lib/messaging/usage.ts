/**
 * Client-message metering (emails today, texts later - one shared allowance).
 *
 * Every message a client receives counts once against the groomer's monthly
 * allowance (plan + top-up). Essential messages (confirmations, reminders,
 * "on my way") are ALWAYS sent and counted. Optional messages from the Inbox
 * are only allowed while there is allowance left.
 *
 * Best-effort: never throws; a counting failure never blocks a send.
 */
import { getUsage, incrementUsage } from '@/lib/sms/quota';
import { isEmailReserveActive } from '@/lib/email/daily-cap';

export async function messageAllowance(groomerId: string): Promise<{ used: number; included: number; topup: number }> {
  const { getEntitlements } = await import('@/lib/billing/entitlements');
  const [used, ent] = await Promise.all([getUsage(groomerId), getEntitlements(groomerId)]);
  return { used, included: ent.smsIncluded, topup: ent.smsTopupBalance };
}

/** Clamp to a finite, non-negative number (NaN / Infinity / negatives become 0). */
function nonNegative(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * PURE: true while `used` is below the monthly allowance (`included + topup`).
 * Non-finite or negative `included` / `topup` count as 0, so a bad allowance
 * value never grants unlimited optional messages. A negative `used` counts as
 * 0; a NaN `used` denies (NaN compares false).
 */
export function hasAllowance(used: number, included: number, topup: number): boolean {
  return Math.max(0, used) < nonNegative(included) + nonNegative(topup);
}

/**
 * True while the groomer still has messages left this month (plan + top-up)
 * AND the platform is not in its daily email 'reserve' (>= 90% of the Resend
 * daily limit), so essential emails keep the remaining quota. Fails open.
 */
export async function canSendOptionalMessage(groomerId: string): Promise<boolean> {
  try {
    if (await isEmailReserveActive()) return false;
    const a = await messageAllowance(groomerId);
    return hasAllowance(a.used, a.included, a.topup);
  } catch {
    return true;
  }
}

/** Count one delivered client message; past the plan allowance, use a top-up credit. */
export async function meterClientMessage(groomerId: string | null | undefined): Promise<void> {
  if (!groomerId) return;
  try {
    const used = await incrementUsage(groomerId);
    if (used <= 0) return;
    const { getEntitlements, invalidateEntitlements } = await import('@/lib/billing/entitlements');
    const ent = await getEntitlements(groomerId);
    if (used > ent.smsIncluded && ent.smsTopupBalance > 0) {
      const { connectDB } = await import('@/lib/db/connect');
      const { Subscription } = await import('@/lib/db/models/subscription');
      await connectDB();
      await Subscription.updateOne({ groomerId, smsTopupBalance: { $gt: 0 } }, { $inc: { smsTopupBalance: -1 } });
      await invalidateEntitlements(groomerId);
    }
  } catch (err) {
    console.error('[messaging] meterClientMessage failed (non-fatal):', err);
  }
}
