'use server';

/**
 * Cloudinary signed-upload helper (Requirement 23.2).
 *
 * PawPort uploads images (pet photos, business logos) directly from the
 * browser to Cloudinary. To keep `CLOUDINARY_API_SECRET` on the server ONLY,
 * the browser never talks to Cloudinary with the raw secret. Instead:
 *
 *   1. The client asks the server for a short-lived upload *signature* via one
 *      of the server actions below.
 *   2. The server signs the upload parameters with the secret and returns the
 *      signature together with the public `apiKey`, `cloudName`, `timestamp`,
 *      and `folder`.
 *   3. The browser POSTs the file + those signed params straight to Cloudinary
 *      (`https://api.cloudinary.com/v1_1/{cloudName}/image/upload`).
 *
 * This is Cloudinary's standard "signed upload" flow: the signature is an
 * HMAC/SHA of the sorted upload params keyed by the api_secret, so Cloudinary
 * can verify the request originated from us without the secret ever leaving the
 * server.
 *
 * Two entry points are exposed:
 *   - {@link getUploadSignature} — requires an authenticated groomer session.
 *     Used for portal uploads (pet photos, business logo).
 *   - {@link getBookingPetPhotoUploadSignature} — public (no auth). Used by the
 *     public booking flow so a prospective client can attach a pet photo. It is
 *     locked to a single fixed folder so it cannot be abused to write elsewhere.
 *
 * NOTE: This file carries the `'use server'` directive, so it may export ONLY
 * async functions. The shared types (`UploadSignature`, `PortalUploadFolder`)
 * therefore live in `./types` and are re-imported by both server and client.
 *
 * _Requirements: 23.2_
 */
import { v2 as cloudinary } from 'cloudinary';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/config';
import type { PortalUploadFolder, UploadSignature } from './types';

/**
 * The allow-listed Cloudinary folders for authenticated (portal) uploads.
 * Restricting the folder server-side prevents a client from redirecting an
 * upload to an arbitrary path.
 */
const PORTAL_FOLDERS: Record<PortalUploadFolder, string> = {
  petPhoto: 'pawport/pet-photos',
  groomerLogo: 'pawport/groomer-logos',
};

/** The fixed folder public booking pet-photo uploads are written to. */
const BOOKING_PET_PHOTO_FOLDER = 'pawport/booking-pet-photos';

/**
 * Reads and validates the required Cloudinary environment configuration.
 * Throws a descriptive error if anything is missing so misconfiguration fails
 * loudly on the server rather than producing an unsignable request.
 */
function getCloudinaryConfig(): {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
} {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error(
      'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.'
    );
  }

  return { cloudName, apiKey, apiSecret };
}

/**
 * Builds a signed-upload envelope for the given folder. The signature covers
 * exactly the params the client is expected to send (here: `folder` and
 * `timestamp`); Cloudinary recomputes it on its side and rejects the upload if
 * the client tampers with them.
 */
function buildSignature(folder: string): UploadSignature {
  const { cloudName, apiKey, apiSecret } = getCloudinaryConfig();

  const timestamp = Math.round(Date.now() / 1000);

  // The set of params to sign MUST match what the browser sends (besides
  // file/api_key/signature, which Cloudinary excludes from the signature).
  const signature = cloudinary.utils.api_sign_request(
    { folder, timestamp },
    apiSecret
  );

  return { timestamp, signature, apiKey, cloudName, folder };
}

/**
 * Generate a signed-upload envelope for an authenticated groomer (portal
 * uploads: pet photos and business logos).
 *
 * @param context - Which portal upload this is for; selects the target folder.
 * @throws If the caller is not an authenticated groomer, or Cloudinary is
 *   unconfigured.
 */
export async function getUploadSignature(
  context: PortalUploadFolder
): Promise<UploadSignature> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error('You must be signed in to upload images.');
  }

  const folder = PORTAL_FOLDERS[context];
  if (!folder) {
    throw new Error('Unknown upload context.');
  }

  return buildSignature(folder);
}

/**
 * Generate a signed-upload envelope for the PUBLIC booking flow's pet photo.
 *
 * No authentication is required (prospective clients are not signed in), so the
 * upload is pinned to a single fixed folder that cannot be overridden by the
 * caller.
 *
 * @throws If Cloudinary is unconfigured.
 */
export async function getBookingPetPhotoUploadSignature(): Promise<UploadSignature> {
  return buildSignature(BOOKING_PET_PHOTO_FOLDER);
}
