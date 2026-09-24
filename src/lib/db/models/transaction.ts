import { Schema, model, models, type Document, type Types } from 'mongoose';
import type { TransactionStatus } from '@/types';

// Canonical definition lives in `src/types`; re-exported here for convenience.
export type { TransactionStatus } from '@/types';

export interface ITransaction extends Document {
  appointmentId: Types.ObjectId;
  groomerId: Types.ObjectId;
  stripePaymentId: string;
  amount: number;
  currency: string;
  status: TransactionStatus;
  createdAt: Date;
  updatedAt: Date;
}

const transactionSchema = new Schema<ITransaction>(
  {
    appointmentId: {
      type: Schema.Types.ObjectId,
      ref: 'Appointment',
      required: true,
    },
    groomerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    stripePaymentId: { type: String, required: true, unique: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'usd', maxlength: 3 },
    status: {
      type: String,
      enum: ['pending', 'succeeded', 'failed', 'refunded'],
      default: 'pending',
    },
  },
  { timestamps: true }
);

transactionSchema.index({ appointmentId: 1 });
transactionSchema.index({ groomerId: 1, createdAt: -1 });
transactionSchema.index({ stripePaymentId: 1 });

export const Transaction =
  models.Transaction || model<ITransaction>('Transaction', transactionSchema);
