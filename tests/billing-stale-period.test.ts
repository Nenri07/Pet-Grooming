import { describe, expect, it } from 'vitest';
import { effectiveSubscriptionStatus, evaluateAccess, subscriptionToAccessInput } from '@/lib/billing/access';
import { resolveEntitlements } from '@/lib/billing/entitlements';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-11-05T12:00:00Z');

describe('missed-webhook safety net', () => {
  it('keeps an active plan inside the period and the 7-day grace', () => {
    expect(effectiveSubscriptionStatus('active', new Date(now.getTime() + DAY), now)).toBe('active');
    expect(effectiveSubscriptionStatus('active', new Date(now.getTime() - 6 * DAY), now)).toBe('active');
  });

  it('expires an active plan whose renewal is more than 7 days overdue', () => {
    expect(effectiveSubscriptionStatus('active', new Date(now.getTime() - 7 * DAY), now)).toBe('expired');
    const input = subscriptionToAccessInput(
      { status: 'active', currentPeriodEnd: new Date(now.getTime() - 8 * DAY) },
      now
    );
    expect(evaluateAccess(input)).toEqual({ allow: false, reason: 'inactive' });
  });

  it('leaves rows without a period end and non-active rows alone', () => {
    expect(effectiveSubscriptionStatus('active', null, now)).toBe('active');
    expect(effectiveSubscriptionStatus('trialing', new Date(0), now)).toBe('trialing');
    expect(effectiveSubscriptionStatus('past_due', new Date(0), now)).toBe('past_due');
  });

  it('entitlements agree with the lockout', () => {
    const base = { plan: 'pro' as const, status: 'active' as const, smsIncluded: 1000, smsTopupBalance: 0, foundingMember: false };
    expect(resolveEntitlements({ ...base, currentPeriodEnd: new Date(now.getTime() + DAY) }, now).active).toBe(true);
    expect(resolveEntitlements({ ...base, currentPeriodEnd: new Date(now.getTime() - 10 * DAY) }, now).active).toBe(false);
  });
});
