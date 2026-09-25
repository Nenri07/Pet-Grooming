/**
 * SMS usage endpoint (GET /api/portal/sms-usage) — Master Spec §13.4.
 *
 * Feeds the nav SMS pill with the groomer's real allowance + usage from
 * entitlements and the Redis usage counter. Best-effort: the pill falls back to
 * its placeholder if this fails or returns nothing, so an unconfigured
 * environment still renders. Not a gated feature — every plan has an SMS meter.
 *
 * _Master Spec: §13.4_
 */
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import { getEntitlements } from '@/lib/billing/entitlements';
import { getUsage } from '@/lib/sms/quota';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const entitlements = await getEntitlements(session.user.id);
    const used = await getUsage(session.user.id);
    return NextResponse.json(
      { used, included: entitlements.smsIncluded, topup: entitlements.smsTopupBalance },
      { status: 200 }
    );
  } catch (err) {
    console.error('[sms-usage] failed:', err);
    // Fail soft — the pill keeps its placeholder.
    return NextResponse.json({ used: 0, included: 300 }, { status: 200 });
  }
}
