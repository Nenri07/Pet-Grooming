/**
 * IdentityBinding Mongoose model — the anti-abuse trial ledger.
 *
 * Records that a verified phone identity has consumed a 14-day trial, so a
 * groomer cannot farm repeat free trials by deleting and re-registering. This
 * collection is deliberately persisted **independently of the account**: it is
 * NOT a sub-document of `User`/`GroomerProfile` and holds no cascading ref, so
 * deleting a `User` or `GroomerProfile` does NOT remove the binding (R11.4).
 * The abuse-prevention pipeline (see `src/actions/trial.ts`) checks this ledger
 * via the pure `identityConsumedTrial` decision before provisioning a trial.
 *
 * PII handling (R19, Security section):
 *  - Phone — hashed, never stored raw. `phoneHash = sha256(canonicalE164 + PEPPER)`
 *    with a server-only pepper. We only ever need equality checks ("has this
 *    phone consumed a trial?"), never the plaintext back; this keeps the ledger
 *    from being a plaintext phone directory if the collection leaks. `phoneHash`
 *    is the authoritative identity key (R11.1, R19.1).
 *  - Email — stored as the canonical NORMALIZED plaintext (lowercased,
 *    Gmail-collapsed per R9). Lower sensitivity than phone; kept for operator
 *    review and as a secondary cross-reference signal.
 *  - IP — masked (last IPv4 octet / low IPv6 bits zeroed) so it is a coarse
 *    velocity signal, not precise tracking (R12.4).
 *  - Device fingerprint — opaque hash only, never raw UA/entropy (R12.4).
 *
 * _Requirements: 11.1, 11.4, 12.4, 19.1_
 */
import { Schema, model, models, type Model, type Types } from 'mongoose';

export interface IIdentityBinding {
  _id: Types.ObjectId;
  /** Canonical normalized email (per R9) — lowercased, Gmail-collapsed. Stored plaintext for identity match. */
  normalizedEmail: string;
  /** SHA-256 of the canonical E.164 phone + server pepper (see PII note). Authoritative identity key (R11.1, R19.1). */
  phoneHash: string;
  /** When this identity first consumed a trial. */
  firstTrialAt: Date;
  /**
   * Optional phone-recycling horizon. `identityConsumedTrial` treats the
   * binding as consumed only while `now < bindingExpiresAt`; `null` = never
   * expires.
   */
  bindingExpiresAt?: Date | null;
  /** Non-PII device fingerprints seen for this identity (R12.1, R12.4) — opaque hashes only. */
  deviceFingerprints: string[];
  /** Originating IPs, masked/coarse (last-octet / low-bits zeroed), R12.4. */
  ips: string[];
  createdAt: Date;
  updatedAt: Date;
}

const identityBindingSchema = new Schema<IIdentityBinding>(
  {
    normalizedEmail: { type: String, required: true, lowercase: true, index: true },
    // The unique authoritative identity key. A double-submit / re-register with
    // the same phone collides on this unique index, which the pipeline treats
    // as "already consumed" (R11.1-11.3).
    phoneHash: { type: String, required: true, unique: true },
    firstTrialAt: { type: Date, required: true },
    // Default OFF: no `expires` option, so there is NO TTL index and logical
    // expiry via `identityConsumedTrial` governs phone recycling. An operator
    // can later enable a TTL (add `expires`/`expireAfterSeconds`) for automatic
    // cleanup; off by default so bindings never silently vanish.
    bindingExpiresAt: { type: Date, default: null },
    deviceFingerprints: { type: [String], default: [] },
    ips: { type: [String], default: [] },
  },
  { timestamps: true }
);

// Note: the `phoneHash` (unique) index comes from the field-level `unique: true`
// and the `normalizedEmail` secondary index from the field-level `index: true`
// above. Re-declaring either with `schema.index()` would create a conflicting
// duplicate index of the same auto-generated name, which `syncIndexes()`
// rejects (see the groomer-profile.ts comment).

export const IdentityBinding: Model<IIdentityBinding> =
  (models.IdentityBinding as Model<IIdentityBinding>) ||
  model<IIdentityBinding>('IdentityBinding', identityBindingSchema);
