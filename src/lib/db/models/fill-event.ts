/**
 * FillEvent model (Master Spec §11.1, §14).
 *
 * One row per Fill My Day trigger: the gap that opened, who was offered the
 * slot, who eventually claimed it, and the revenue recovered. Powers the
 * dashboard selling metric "Fill My Day recovered $X this month".
 *
 * _Master Spec: §11.1, §14_
 */
import { Schema, model, models, type Model, type Types } from 'mongoose';

export interface IFillEvent {
  groomerId: Types.ObjectId;
  /** Start of the freed gap. */
  gapStart: Date;
  /** End of the freed gap. */
  gapEnd: Date;
  /** Client ids the slot was offered to (top-ranked candidates). */
  offeredTo: Types.ObjectId[];
  /** The client who claimed the slot, once filled. */
  filledBy?: Types.ObjectId;
  /** Deposit / estimate value recovered when the gap was filled. */
  revenueRecovered?: number;
  createdAt: Date;
  updatedAt: Date;
}

const fillEventSchema = new Schema<IFillEvent>(
  {
    groomerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    gapStart: { type: Date, required: true },
    gapEnd: { type: Date, required: true },
    offeredTo: [{ type: Schema.Types.ObjectId, ref: 'Client' }],
    filledBy: { type: Schema.Types.ObjectId, ref: 'Client' },
    revenueRecovered: { type: Number, min: 0 },
  },
  { timestamps: true }
);

// Dashboard metric: this month's filled events for a groomer (§11.1).
fillEventSchema.index({ groomerId: 1, createdAt: -1 });

export const FillEvent: Model<IFillEvent> =
  (models.FillEvent as Model<IFillEvent>) ||
  model<IFillEvent>('FillEvent', fillEventSchema);
