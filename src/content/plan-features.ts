/**
 * The single per-plan feature list shown in every pricing surface (landing
 * pricing cards, For Groomers page, in-app Billing plan cards).
 *
 * Message counts come from `PLANS` so the copy cannot drift from the metered
 * allowance. Pure module: safe to import from client components.
 *
 * _Requirements: 6.1, 6.5_
 */
import { PLANS } from '@/lib/plans';

/** Feature line for a monthly email-messaging allowance, e.g. "Client messaging by email (2,000/mo)". */
export function messagingFeature(count: number): string {
  return `Client messaging by email (${count.toLocaleString('en-US')}/mo)`;
}

export const PLAN_FEATURES: { readonly solo: readonly string[]; readonly pro: readonly string[] } = {
  solo: [
    'Branded booking page',
    'Deposits & no-show protection',
    'Native calendar & ICS feed',
    messagingFeature(PLANS.solo.sms),
    'Digital Pet Cards',
    'Appointment reminders',
  ],
  pro: [
    'Everything in Solo',
    'Order Radar route ranking',
    'Fill My Day auto-offers',
    'Live \u201con the way\u201d tracking',
    'Rebooking autopilot',
    'Before/after share cards',
    messagingFeature(PLANS.pro.sms),
  ],
};
