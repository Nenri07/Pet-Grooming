'use server';

/**
 * Before/After photo server actions (Master Spec §11.3).
 *
 * Groomers upload before/after photos on the appointment screen (via the
 * existing Cloudinary {@link ImageUpload}); the returned `secure_url` is saved
 * onto the appointment here. Reading the appointment back (for the share card)
 * is also exposed.
 *
 * PRO-GATED SERVER-SIDE (§13.1: "never gate only in the UI"): `beforeAfter` is
 * a Pro feature, so saving a photo calls `assertFeature(groomerId,
 * 'beforeAfter')` and returns a locked envelope when denied. Every query is
 * scoped to `{ _id, groomerId: session.user.id }`.
 *
 * _Master Spec: §11.3, §13.1_
 */
import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth/config';
import { connectDB } from '@/lib/db/connect';
import { Appointment } from '@/lib/db/models/appointment';
import { assertFeature, FeatureLockedError } from '@/lib/billing/entitlements';

/** Which slot a photo fills. */
export type PhotoKind = 'before' | 'after';

/** Result envelope for {@link savePhoto}. */
export type SavePhotoResult =
  | { ok: true }
  | { ok: false; locked: true; error: string }
  | { ok: false; error: string };

const savePhotoSchema = z.object({
  appointmentId: z.string().min(1),
  kind: z.enum(['before', 'after']),
  url: z.string().url().max(2000),
});

/**
 * Persist a before/after photo URL onto an appointment. Pro-gated.
 *
 * @param appointmentId The appointment (scoped to the authed groomer).
 * @param kind `before` | `after` — which field to set.
 * @param url The Cloudinary `secure_url` from the upload.
 */
export async function savePhoto(
  appointmentId: string,
  kind: PhotoKind,
  url: string
): Promise<SavePhotoResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { ok: false, error: 'You must be signed in to save a photo.' };
  }
  const groomerId = session.user.id;

  const parsed = savePhotoSchema.safeParse({ appointmentId, kind, url });
  if (!parsed.success) {
    return { ok: false, error: 'The photo request was invalid.' };
  }

  // PRO GATE (§13.1).
  try {
    await assertFeature(groomerId, 'beforeAfter');
  } catch (err) {
    if (err instanceof FeatureLockedError) {
      return { ok: false, locked: true, error: err.message };
    }
    console.error('[before-after] entitlement check failed:', err);
    return { ok: false, error: 'Could not verify access.' };
  }

  try {
    await connectDB();

    const field = kind === 'before' ? 'beforePhotoUrl' : 'afterPhotoUrl';
    const res = await Appointment.updateOne(
      { _id: parsed.data.appointmentId, groomerId },
      { $set: { [field]: parsed.data.url } }
    );

    if (res.matchedCount === 0) {
      return { ok: false, error: 'Appointment not found.' };
    }

    revalidatePath(`/appointments/${parsed.data.appointmentId}`);
    return { ok: true };
  } catch (err) {
    console.error('savePhoto failed:', err);
    return { ok: false, error: "We couldn't save that photo right now. Please try again." };
  }
}

/** Result envelope for {@link addAfterPhotoToPetCard}. */
export type AddToPetCardResult = { ok: true } | { ok: false; error: string };

const addToCardSchema = z.object({ appointmentId: z.string().min(1) });

/**
 * "Add to Pet Card" (§11.3): set the appointment's pet photo to the saved after
 * photo so the freshly-groomed look becomes the pet's Digital Pet Card image.
 * Pro-gated (beforeAfter). Scoped to the authed groomer.
 */
export async function addAfterPhotoToPetCard(
  appointmentId: string
): Promise<AddToPetCardResult> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { ok: false, error: 'You must be signed in.' };
  }
  const groomerId = session.user.id;

  const parsed = addToCardSchema.safeParse({ appointmentId });
  if (!parsed.success) {
    return { ok: false, error: 'Invalid request.' };
  }

  try {
    await assertFeature(groomerId, 'beforeAfter');
  } catch (err) {
    if (err instanceof FeatureLockedError) {
      return { ok: false, error: err.message };
    }
    console.error('[before-after] entitlement check failed:', err);
    return { ok: false, error: 'Could not verify access.' };
  }

  try {
    await connectDB();
    const { Pet } = await import('@/lib/db/models/pet');

    const appt = await Appointment.findOne({ _id: appointmentId, groomerId })
      .select('petId afterPhotoUrl')
      .lean<{ petId?: unknown; afterPhotoUrl?: string } | null>();
    if (!appt) return { ok: false, error: 'Appointment not found.' };
    if (!appt.afterPhotoUrl) {
      return { ok: false, error: 'Add an after photo first.' };
    }

    await Pet.updateOne(
      { _id: appt.petId, groomerId },
      { $set: { photoUrl: appt.afterPhotoUrl } }
    );

    revalidatePath(`/appointments/${appointmentId}`);
    return { ok: true };
  } catch (err) {
    console.error('addAfterPhotoToPetCard failed:', err);
    return { ok: false, error: "We couldn't update the pet card right now." };
  }
}
