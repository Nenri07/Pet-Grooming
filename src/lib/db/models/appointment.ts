import { Schema, model, models, type Document, type Types } from 'mongoose';
import type { AppointmentStatus } from '@/types';

// Canonical definition lives in `src/types`; re-exported here for convenience.
export type { AppointmentStatus } from '@/types';

export interface IAppointment extends Document {
  groomerId: Types.ObjectId;
  clientId: Types.ObjectId;
  petId: Types.ObjectId;
  serviceId: Types.ObjectId;
  scheduledDate: Date;
  scheduledEndDate: Date;
  status: AppointmentStatus;
  serviceAddress?: string;
  notes?: string;
  postGroomNotes?: string;
  googleEventId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const appointmentSchema = new Schema<IAppointment>(
  {
    groomerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    petId: { type: Schema.Types.ObjectId, ref: 'Pet', required: true },
    serviceId: { type: Schema.Types.ObjectId, ref: 'Service', required: true },
    scheduledDate: { type: Date, required: true },
    scheduledEndDate: { type: Date, required: true },
    status: {
      type: String,
      enum: ['upcoming', 'in-progress', 'completed', 'cancelled'],
      default: 'upcoming',
    },
    serviceAddress: { type: String, maxlength: 500 },
    notes: { type: String, maxlength: 500 },
    postGroomNotes: { type: String, maxlength: 2000 },
    googleEventId: { type: String },
  },
  { timestamps: true }
);

appointmentSchema.index({ groomerId: 1, scheduledDate: 1 });
appointmentSchema.index({ groomerId: 1, status: 1 });
appointmentSchema.index({ clientId: 1 });
appointmentSchema.index({ petId: 1 });

export const Appointment =
  models.Appointment || model<IAppointment>('Appointment', appointmentSchema);
