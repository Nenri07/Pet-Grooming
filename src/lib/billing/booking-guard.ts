/**
 * Booking guard for lapsed accounts.
 *
 * A groomer whose subscription has lapsed (trial ended, canceled, expired, or
 * past_due after the grace period) keeps read access to existing data but
 * must not take NEW online bookings. Every booking entry point (slot list,
 * hold, free booking, deposit checkout, Fill My Day claim) calls
 * {@link assertAcceptingBookings} and maps {@link BookingsPausedError} to its
 * own error envelope.
 *
 * Reactivation is picked up through the 60-second Entitlements cache (the
 * Polar webhook also invalidates it), so no manual step is needed.
 *
 * `getEntitlements` is imported dynamically so the pure exports here stay
 * importable from client components and tests without pulling in Mongoose.
 *
 * _Requirements: 2.2, 2.4_
 */
import { AppError } from '@/lib/errors';
import type { Entitlements } from './entitlements';

/** User-safe message shown when a lapsed groomer's page is asked to book. */
export const BOOKINGS_PAUSED_MESSAGE =
  "This business isn't taking online bookings right now.";

/** Thrown when a booking is attempted against a Lapsed_Account. */
export class BookingsPausedError extends AppError {
  constructor() {
    super(BOOKINGS_PAUSED_MESSAGE, 'BOOKINGS_PAUSED', 403);
    this.name = 'BookingsPausedError';
    Object.setPrototypeOf(this, BookingsPausedError.prototype);
  }
}

/** PURE: whether an entitlement view may take new bookings. */
export function acceptsBookings(ent: Pick<Entitlements, 'active'>): boolean {
  return ent.active;
}

/**
 * Resolve the groomer's entitlements and throw {@link BookingsPausedError} for
 * a Lapsed_Account. If entitlements cannot be loaded, `getEntitlements` falls
 * back to the trial view, so an outage never blocks bookings.
 *
 * @param groomerId The groomer (User id) who owns the booking page.
 */
export async function assertAcceptingBookings(groomerId: string): Promise<void> {
  const { getEntitlements } = await import('./entitlements');
  const ent = await getEntitlements(groomerId);
  if (!acceptsBookings(ent)) {
    throw new BookingsPausedError();
  }
}
