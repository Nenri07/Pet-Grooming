import { Schema, model, models, type Model, type Types } from 'mongoose';

export interface IAddress {
  street: string;
  city: string;
  state: string;
  postalCode: string;
}

/** Geocoded coordinates for the client's service address (Master Spec §10.1). */
export interface IGeoLocation {
  lat: number;
  lng: number;
}

export interface IClient {
  groomerId: Types.ObjectId;
  name: string;
  email: string;
  phone: string;
  address: IAddress;
  /** Additive: geocoded service-address coordinates, when known (§10.1). */
  location?: IGeoLocation;
  /**
   * Additive (§12.3): when the client consented to receive SMS. Absent means no
   * explicit consent — only a single transactional confirmation may be sent.
   */
  smsConsentAt?: Date;
  /** Additive (§12.3): set when the client replies STOP; cleared on START. */
  smsOptOut?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const addressSchema = new Schema<IAddress>(
  {
    street: { type: String, required: true, maxlength: 200 },
    city: { type: String, required: true, maxlength: 100 },
    state: { type: String, required: true, maxlength: 100 },
    postalCode: { type: String, required: true, maxlength: 20 },
  },
  { _id: false }
);

const geoLocationSchema = new Schema<IGeoLocation>(
  {
    lat: { type: Number, required: true, min: -90, max: 90 },
    lng: { type: Number, required: true, min: -180, max: 180 },
  },
  { _id: false }
);

const clientSchema = new Schema<IClient>(
  {
    groomerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, maxlength: 100 },
    email: { type: String, required: true, lowercase: true, maxlength: 254 },
    phone: { type: String, required: true, maxlength: 15 },
    address: { type: addressSchema, required: true },
    // Additive: geocoded coordinates (§10.1). Optional — routing degrades to a
    // pass-through when absent.
    location: { type: geoLocationSchema, required: false },
    // Additive: SMS consent + opt-out (§12.3).
    smsConsentAt: { type: Date, required: false },
    smsOptOut: { type: Boolean, required: false },
  },
  { timestamps: true }
);

// A groomer cannot have two clients sharing the same email.
clientSchema.index({ groomerId: 1, email: 1 }, { unique: true });

// Text search across a groomer's clients by name, email, or phone.
clientSchema.index({ groomerId: 1, name: 'text', email: 'text', phone: 'text' });

export const Client: Model<IClient> =
  (models.Client as Model<IClient>) || model<IClient>('Client', clientSchema);
