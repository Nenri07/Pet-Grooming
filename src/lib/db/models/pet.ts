import { Schema, model, models, type Model, type Types } from 'mongoose';
import type { WeightUnit, Temperament, CoatCondition } from '@/types';

// Canonical definitions live in `src/types`; re-exported here for convenience
// so existing model consumers can keep importing them from this module.
export type { WeightUnit, Temperament, CoatCondition } from '@/types';

export interface IPet {
  clientId: Types.ObjectId;
  groomerId: Types.ObjectId;
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
  digitalCardId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const petSchema = new Schema<IPet>(
  {
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    groomerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, maxlength: 50 },
    photoUrl: { type: String },
    breed: { type: String, required: true },
    weight: { type: Number, required: true, min: 1, max: 200 },
    weightUnit: { type: String, enum: ['lbs', 'kg'], default: 'lbs' },
    age: { type: Number, required: true, min: 0, max: 30 },
    temperament: {
      type: String,
      required: true,
      enum: ['calm', 'nervous', 'aggressive', 'friendly'],
    },
    coatCondition: {
      type: String,
      required: true,
      enum: ['smooth', 'double', 'wire', 'curly', 'long', 'matted'],
    },
    specialFlags: [{ type: String }],
    notes: { type: String, maxlength: 500 },
    digitalCardId: { type: String, unique: true, sparse: true },
  },
  { timestamps: true }
);

petSchema.index({ clientId: 1 });
petSchema.index({ groomerId: 1 });
// `digitalCardId` already declares `unique: true, sparse: true`, which creates
// its index. A separate `petSchema.index({ digitalCardId: 1 })` duplicated it
// (Mongoose "Duplicate schema index" warning) and has been removed.

export const Pet: Model<IPet> =
  (models.Pet as Model<IPet>) || model<IPet>('Pet', petSchema);
