/**
 * PawPort shared TypeScript types.
 *
 * This module is the CANONICAL source of truth for the domain-level union
 * ("enum-like") types and the cross-cutting interfaces used by the estimate
 * engine, availability logic, calendar sync, and the public booking flow.
 *
 * Mongoose models in `src/lib/db/models/*` import the union types from here
 * rather than re-declaring them, so a value like `Temperament` is defined
 * exactly once. Model-specific document interfaces (e.g. `IPet`) still live
 * next to their schema, but the shared vocabulary lives here.
 *
 * _Requirements: 22.1_
 */

// ---------------------------------------------------------------------------
// Enum-like union types (canonical)
// ---------------------------------------------------------------------------

/** A pet's disposition, used to inform grooming handling. */
export type Temperament = 'calm' | 'nervous' | 'aggressive' | 'friendly';

/** The pet's coat type, which drives estimate multipliers. */
export type CoatCondition =
  | 'smooth'
  | 'double'
  | 'wire'
  | 'curly'
  | 'long'
  | 'matted';

/** Lifecycle status of an appointment. */
export type AppointmentStatus =
  | 'upcoming'
  | 'in-progress'
  | 'completed'
  | 'cancelled';

/** Lifecycle status of a Stripe-backed transaction. */
export type TransactionStatus =
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'refunded';

/** Unit a pet's weight is expressed in. */
export type WeightUnit = 'lbs' | 'kg';

// ---------------------------------------------------------------------------
// Estimate engine — lib/estimate/engine.ts
// ---------------------------------------------------------------------------

/**
 * A groomer-configured pricing rule. When a booking's pet matches the rule's
 * coat condition and/or weight range, the `priceAdjustmentPercent` is applied
 * to the service base price. Clamped between -50% and +50%.
 */
export interface EstimateRule {
  coatCondition?: CoatCondition;
  weightRange?: {
    min?: number;
    max?: number;
  };
  priceAdjustmentPercent: number;
  note?: string;
}

/** Inputs required to compute a price estimate for a booking. */
export interface EstimateInput {
  petWeight: number;
  coatCondition: CoatCondition;
  serviceBasePrice: number;
  estimateRules: EstimateRule[];
}

/** The computed estimate range returned to the booking flow. */
export interface EstimateResult {
  minPrice: number;
  maxPrice: number;
  currency: string;
}

// ---------------------------------------------------------------------------
// Availability — lib/calendar/availability.ts
// ---------------------------------------------------------------------------

/** Query parameters for computing available booking slots. */
export interface AvailabilityQuery {
  groomerId: string;
  startDate: Date;
  endDate: Date;
  serviceDurationMinutes: number;
}

/** A single candidate time slot and whether it can be booked. */
export interface TimeSlot {
  start: Date;
  end: Date;
  available: boolean;
}

// ---------------------------------------------------------------------------
// Calendar sync — lib/calendar/sync.ts
// ---------------------------------------------------------------------------

/** A single failure encountered during a calendar sync run. */
export interface SyncError {
  /** Machine-readable code describing the failure category. */
  code: string;
  /** Human-readable description of what went wrong. */
  message: string;
  /** The Google Calendar event id involved, when applicable. */
  eventId?: string;
}

/** Aggregate outcome of a bidirectional calendar sync. */
export interface SyncResult {
  eventsCreated: number;
  eventsUpdated: number;
  slotsBlocked: number;
  errors: SyncError[];
}

// ---------------------------------------------------------------------------
// Booking — actions/booking.ts
// ---------------------------------------------------------------------------

/** A postal address collected during booking. */
export interface AddressInput {
  street: string;
  city: string;
  state: string;
  postalCode: string;
}

/** Pet details captured in Step 1 of the booking flow. */
export interface PetInfoInput {
  name: string;
  photoUrl?: string;
  breed: string;
  weight: number;
  weightUnit: WeightUnit;
  age: number;
  temperament: Temperament;
  coatCondition: CoatCondition;
  specialFlags?: string[];
  notes?: string;
}

/** Owner + service-address details captured in Step 2 of the booking flow. */
export interface OwnerDetailsInput {
  name: string;
  email: string;
  phone: string;
  address: AddressInput;
}

/** The full payload submitted to create a booking. */
export interface BookingPayload {
  groomerSlug: string;
  pet: PetInfoInput;
  owner: OwnerDetailsInput;
  selectedSlot: TimeSlot;
  stripePaymentIntentId: string;
}

/** The result of a successful booking creation. */
export interface BookingResult {
  appointmentId: string;
  clientId: string;
  petId: string;
  transactionId: string;
  status: AppointmentStatus;
}

/** The outcome of a Stripe deposit payment attempt. */
export interface PaymentResult {
  paymentIntentId: string;
  status: TransactionStatus;
  amount: number;
  currency: string;
  clientSecret?: string;
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Digital Pet Card — public pet-card page
// ---------------------------------------------------------------------------

/** A single past service entry shown on a pet's service-history timeline. */
export interface ServiceHistoryEntry {
  date: Date;
  serviceName: string;
  notes?: string;
  status: AppointmentStatus;
}

/** Groomer branding shown on a shareable Digital Pet Card. */
export interface GroomerBranding {
  businessName: string;
  logoUrl?: string;
  phone?: string;
  businessEmail?: string;
}

/** The assembled data rendered on a public Digital Pet Card. */
export interface PetCardData {
  cardId: string;
  name: string;
  photoUrl?: string;
  breed: string;
  weight: number;
  weightUnit: WeightUnit;
  age: number;
  temperament: Temperament;
  coatCondition: CoatCondition;
  specialFlags: string[];
  notes?: string;
  serviceHistory: ServiceHistoryEntry[];
  nextRecommendedDate?: Date;
  branding: GroomerBranding;
}
