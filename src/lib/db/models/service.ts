import { Schema, model, models, type Model, type Types } from 'mongoose';

export interface IService {
  groomerId: Types.ObjectId;
  name: string;
  description?: string;
  basePrice: number;
  durationMinutes: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const serviceSchema = new Schema<IService>(
  {
    groomerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, maxlength: 100 },
    description: { type: String, maxlength: 500 },
    basePrice: { type: Number, required: true, min: 0.01, max: 9999.99 },
    durationMinutes: { type: Number, required: true, min: 15, max: 480 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

serviceSchema.index({ groomerId: 1, isActive: 1 });

export const Service: Model<IService> =
  (models.Service as Model<IService>) ||
  model<IService>('Service', serviceSchema);
