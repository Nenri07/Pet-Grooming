/**
 * Central model registry.
 *
 * Importing this module imports every Mongoose model, registering each schema
 * on the mongoose instance. Required because `.populate('ref')` throws
 * `MissingSchemaError` when the referenced model (Client/Pet/Service/...) has
 * not been registered yet — which happens on cold serverless invocations when
 * a page populates a ref whose model file it never imported. `connectDB()`
 * imports this so every query path that populates refs is safe.
 */
import '@/lib/db/models/user';
import '@/lib/db/models/groomer-profile';
import '@/lib/db/models/client';
import '@/lib/db/models/pet';
import '@/lib/db/models/service';
import '@/lib/db/models/appointment';
import '@/lib/db/models/transaction';
import '@/lib/db/models/pending-booking';
import '@/lib/db/models/calendar-block';
import '@/lib/db/models/reservation';
import '@/lib/db/models/availability';
import '@/lib/db/models/subscription';
import '@/lib/db/models/sms-message';
import '@/lib/db/models/waitlist';
import '@/lib/db/models/fill-event';

/** Force-evaluate the side-effect imports above. */
export function registerModels(): void {
  /* imports above register every schema */
}