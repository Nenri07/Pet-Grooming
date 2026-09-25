/**
 * SmsMessage Mongoose model (Master Spec §14).
 *
 * A log of every SMS in and out of PawPort: direction, kind, body, the Twilio
 * SID, delivery status, error code and segment count. This backs the Inbox
 * (threads grouped by client) and the delivery-status webhook.
 *
 * Additive model — introducing it does not touch existing collections.
 *
 * _Master Spec: §12, §14_
 */
import { Schema, model, models, type Model, type Types } from 'mongoose';
import { SMS_KINDS, type SmsKind } from '@/lib/sms/provider';

/** In = received from a client; out = sent by PawPort/groomer. */
export type SmsDirection = 'in' | 'out';

export interface ISmsMessage {
  _id: Types.ObjectId;
  groomerId: Types.ObjectId;
  /** The client this thread belongs to. Optional for unknown-number leads. */
  clientId?: Types.ObjectId | null;
  /** Related appointment, when the message is about one. */
  appointmentId?: Types.ObjectId | null;
  direction: SmsDirection;
  kind: SmsKind;
  body: string;
  /** Twilio message SID, when sent/received via Twilio. */
  twilioSid?: string;
  /** Delivery/lifecycle status (queued|sent|delivered|failed|skipped|received…). */
  status: string;
  /** Twilio error code on failure, if any. */
  errorCode?: string;
  /** Billable segment count, if known. */
  segments?: number;
  /**
   * Raw sender/recipient phone. For inbound leads (no clientId) this is how the
   * thread is identified. Kept for both directions for traceability.
   */
  phone?: string;
  /** Whether an inbound message has been read in the Inbox. */
  read?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const smsMessageSchema = new Schema<ISmsMessage>(
  {
    groomerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', default: null },
    appointmentId: { type: Schema.Types.ObjectId, ref: 'Appointment', default: null },
    direction: { type: String, enum: ['in', 'out'], required: true },
    kind: { type: String, enum: SMS_KINDS as unknown as SmsKind[], required: true },
    body: { type: String, required: true, maxlength: 2000 },
    twilioSid: { type: String, index: true, sparse: true },
    status: { type: String, required: true, default: 'queued', maxlength: 40 },
    errorCode: { type: String, maxlength: 40 },
    segments: { type: Number, min: 0 },
    phone: { type: String, maxlength: 20 },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Primary access pattern: a groomer's threads, grouped by client, newest-first.
smsMessageSchema.index({ groomerId: 1, clientId: 1, createdAt: -1 });
// Inbound-lead lookup by phone for unknown numbers.
smsMessageSchema.index({ groomerId: 1, phone: 1, createdAt: -1 });

export const SmsMessage: Model<ISmsMessage> =
  (models.SmsMessage as Model<ISmsMessage>) ||
  model<ISmsMessage>('SmsMessage', smsMessageSchema);
