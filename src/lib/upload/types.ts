/**
 * Shared types for the Cloudinary upload flow.
 *
 * These live in a plain (non-`'use server'`) module so both the server action
 * helper (`./cloudinary.ts`) and the client component (`ImageUpload.tsx`) can
 * import them. A `'use server'` file may only export async functions, so it
 * cannot host these type declarations itself.
 *
 * _Requirements: 23.2_
 */

/** A portal upload context (authenticated): pet photo or business logo. */
export type PortalUploadFolder = 'petPhoto' | 'groomerLogo';

/**
 * The signed-upload envelope returned to the client. Everything here is safe to
 * expose to the browser — notably it does NOT include the api_secret.
 */
export interface UploadSignature {
  /** Unix timestamp (seconds) the signature was generated for. */
  timestamp: number;
  /** HMAC signature over the sorted upload params, keyed by the api_secret. */
  signature: string;
  /** Public Cloudinary API key. */
  apiKey: string;
  /** Cloudinary cloud name (used to build the upload URL). */
  cloudName: string;
  /** The Cloudinary folder the upload is pinned to. */
  folder: string;
}
