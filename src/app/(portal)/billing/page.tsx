import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth/config';
import { getEntitlements } from '@/lib/billing/entitlements';
import { isBillingConfigured } from '@/lib/billing/provider';
import { getUsage } from '@/lib/sms/quota';
import { PLANS, SMS_TOPUP, FOUNDING } from '@/lib/plans';
import { BillingView } from '@/components/portal/BillingView';

/**
 * Billing page (server component) — Master Spec §13.2, §13.4.
 *
 * Resolves the groomer's entitlements (plan/status/trial/period/SMS allowance)
 * and current SMS usage, then hands a plain serializable shape to
 * {@link BillingView}. Everything degrades: when billing is unconfigured the
 * plan info still shows and the actionable CTAs disable with a clear banner.
 *
 * _Master Spec: §13.2, §13.4_
 */
export const dynamic = 'force-dynamic';

export default async function BillingPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    redirect('/login');
  }
  const groomerId = session.user.id;

  const entitlements = await getEntitlements(groomerId);
  // Best-effort usage read (0 when Redis is unconfigured).
  const smsUsed = await getUsage(groomerId);

  return (
    <BillingView
      billingConfigured={isBillingConfigured()}
      plan={entitlements.plan}
      tier={entitlements.tier}
      status={entitlements.status}
      active={entitlements.active}
      inGracePeriod={entitlements.inGracePeriod}
      foundingMember={entitlements.foundingMember}
      trialEndsAt={entitlements.trialEndsAt}
      currentPeriodEnd={entitlements.currentPeriodEnd}
      smsIncluded={entitlements.smsIncluded}
      smsUsed={smsUsed}
      smsTopupBalance={entitlements.smsTopupBalance}
      prices={{
        soloMonth: PLANS.solo.priceMonth,
        soloYear: PLANS.solo.priceYear,
        proMonth: PLANS.pro.priceMonth,
        proYear: PLANS.pro.priceYear,
      }}
      founding={{
        spots: FOUNDING.spots,
        soloMonth: FOUNDING.soloMonth,
        proMonth: FOUNDING.proMonth,
      }}
      smsTopup={{ messages: SMS_TOPUP.messages, price: SMS_TOPUP.price }}
    />
  );
}
