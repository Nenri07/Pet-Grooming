/**
 * Device fingerprint — the CLIENT-side helper that computes an opaque, non-PII
 * device signal submitted with the trial-start request (Phase 2 abuse
 * prevention).
 *
 * This is deliberately a COARSE multi-accounting signal, not a tracking id. It
 * hashes a handful of stable, low-entropy browser attributes (user-agent,
 * language, platform, screen geometry, time zone, core count, pixel ratio) into
 * a single opaque SHA-256 hex string. It intentionally AVOIDS high-entropy
 * supercookie techniques (canvas/WebGL fingerprinting, persistent ids) that
 * could uniquely identify a person — the goal is only to notice one device
 * spinning up many trials, so the server can store the hash and increment a
 * velocity counter (R12.1, R12.4). The raw signals never leave the browser;
 * only the hash is sent.
 *
 * Browser-safe by design: although it reads `window`/`navigator`/`screen`, it
 * is a plain util (no `'use client'` directive needed) and guards every global
 * access so it can be imported during SSR without crashing — in that case, and
 * on ANY failure, it resolves to the stable sentinel {@link UNKNOWN_FINGERPRINT}
 * (`'unknown'`). The pipeline treats a missing/`'unknown'` fingerprint as "no
 * signal" and proceeds, so a blocked, unsupported, or faulting collection never
 * blocks a legitimate groomer (R12.5 fail-open). This function never throws.
 *
 * Dependency-free: uses only Web Platform APIs (`crypto.subtle`, `Intl`), with a
 * deterministic string-hash fallback when SubtleCrypto is unavailable (older or
 * non-secure/`http:` contexts expose no `crypto.subtle`).
 *
 * _Requirements: 12.1 (record a device-fingerprint signal with the trial
 * attempt), 12.4 (store the fingerprint as a NON-PII opaque signal — no raw
 * UA/entropy components leave the client), 12.5 (fail-open: if the signal cannot
 * be collected, the trial flow still proceeds)._
 * _Design: Abuse-Prevention Pipeline → Device fingerprint collection
 * (`src/lib/identity/fingerprint.client.ts`)._
 */

/**
 * Stable sentinel returned when no fingerprint can be computed (SSR, blocked
 * APIs, or any failure). The server-side pipeline treats this exact value as
 * "no device signal" and proceeds without blocking (R12.5).
 */
export const UNKNOWN_FINGERPRINT = 'unknown';

/**
 * Collect the stable, low-entropy, NON-PII browser signals we fold into the
 * fingerprint. Every property access is guarded because any of these can be
 * absent, throw, or be `undefined` depending on the browser and context; a
 * missing value simply contributes an empty segment rather than failing.
 *
 * Deliberately excluded: canvas/WebGL rendering, audio fingerprints, installed
 * fonts/plugins, and any persistent identifier — these raise entropy to the
 * point of uniquely identifying a person, which R12.4 forbids. We want a coarse
 * device class, not a tracking id.
 *
 * @returns An ordered list of string segments, stable across page loads on the
 *          same device/browser.
 */
function collectSignals(): string[] {
  const nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator;
  const scr: Screen | undefined = typeof screen === 'undefined' ? undefined : screen;

  // `platform` is deprecated but still widely present; read it defensively via
  // an index signature so TS deprecation typing doesn't force the call site to
  // care, and so an absent value is just an empty segment.
  const platform =
    nav && typeof (nav as unknown as Record<string, unknown>).platform === 'string'
      ? ((nav as unknown as Record<string, unknown>).platform as string)
      : '';

  let timeZone = '';
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    timeZone = '';
  }

  const dpr =
    typeof window !== 'undefined' && typeof window.devicePixelRatio === 'number'
      ? String(window.devicePixelRatio)
      : '';

  return [
    nav?.userAgent ?? '',
    nav?.language ?? '',
    platform,
    scr ? String(scr.width) : '',
    scr ? String(scr.height) : '',
    scr ? String(scr.colorDepth) : '',
    timeZone,
    typeof nav?.hardwareConcurrency === 'number' ? String(nav.hardwareConcurrency) : '',
    dpr,
  ];
}

/**
 * Render bytes as a lowercase hex string.
 *
 * @param buffer The hash output from SubtleCrypto.
 * @returns The hex-encoded digest.
 */
function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Deterministic 32-bit rolling (FNV-1a-style) string hash, used only when
 * SubtleCrypto is unavailable (older browsers or non-secure `http:` contexts).
 * It is far lower-entropy than SHA-256 but still a stable, opaque, non-PII hex
 * value — adequate for a coarse velocity bucket (R12.4). Prefixed so an operator
 * can tell at a glance which path produced the value.
 *
 * @param input The concatenated signal string.
 * @returns A stable 8-char hex string, prefixed with `fb_`.
 */
function fallbackHash(input: string): string {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // FNV prime multiply, kept in 32-bit range via Math.imul.
    hash = Math.imul(hash, 0x01000193);
  }
  // Coerce to an unsigned 32-bit value, then hex.
  return `fb_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * Compute an opaque, non-PII device fingerprint hash for the current browser.
 *
 * Resolves to:
 *   - a SHA-256 hex digest of the stable signal string, when `crypto.subtle` is
 *     available (secure context);
 *   - a deterministic 32-bit string-hash hex (prefixed `fb_`), when SubtleCrypto
 *     is unavailable;
 *   - {@link UNKNOWN_FINGERPRINT} (`'unknown'`) during SSR (`typeof window ===
 *     'undefined'`) or on ANY failure.
 *
 * Never throws. Because it can resolve to `'unknown'`, the submission is always
 * best-effort and the server pipeline fails open on a missing signal (R12.5).
 *
 * @returns A promise of the opaque fingerprint hex string, or `'unknown'`.
 */
export async function computeDeviceFingerprint(): Promise<string> {
  // SSR / non-browser: no device to fingerprint — return the stable sentinel.
  if (typeof window === 'undefined') {
    return UNKNOWN_FINGERPRINT;
  }

  try {
    const payload = collectSignals().join('|');

    // Preferred path: SHA-256 via SubtleCrypto (secure contexts only).
    const subtle =
      typeof crypto !== 'undefined' && crypto.subtle ? crypto.subtle : undefined;
    if (subtle && typeof TextEncoder !== 'undefined') {
      const data = new TextEncoder().encode(payload);
      const digest = await subtle.digest('SHA-256', data);
      return toHex(digest);
    }

    // Fallback: deterministic string hash (non-secure/older contexts).
    return fallbackHash(payload);
  } catch {
    // Any collection/hash failure is a "no signal" — fail open (R12.5).
    return UNKNOWN_FINGERPRINT;
  }
}
