/**
 * Encrypt / decrypt small secrets at rest (groomers' Stripe keys and webhook
 * signing secrets). AES-256-GCM with a random 12-byte IV per value.
 *
 * The 32-byte key comes from PAYMENT_KEYS_SECRET (base64 or 64 hex chars).
 * Without it the feature is off: {@link isSecretBoxConfigured} returns false
 * and encrypt/decrypt throw, so nothing is ever stored in plain text.
 *
 * Stored format: `v1.<iv b64url>.<tag b64url>.<ciphertext b64url>`.
 * Server-only.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function loadKey(): Buffer | null {
  const raw = (process.env.PAYMENT_KEYS_SECRET ?? '').trim();
  if (!raw) return null;
  let key: Buffer;
  if (/^[0-9a-f]{64}$/i.test(raw)) key = Buffer.from(raw, 'hex');
  else key = Buffer.from(raw, 'base64');
  return key.length === 32 ? key : null;
}

export function isSecretBoxConfigured(): boolean {
  return loadKey() !== null;
}

export function sealSecret(plain: string): string {
  const key = loadKey();
  if (!key) throw new Error('PAYMENT_KEYS_SECRET is not configured');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
}

export function openSecret(sealed: string): string {
  const key = loadKey();
  if (!key) throw new Error('PAYMENT_KEYS_SECRET is not configured');
  const [v, iv, tag, ct] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Unrecognised sealed secret');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}
