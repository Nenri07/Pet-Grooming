import { Schema, model, models, type Model, type Types } from 'mongoose';

export interface IAddress {
  street: string;
  city: string;
  state: string;
  postalCode: string;
}

export interface IClient {
  groomerId: Types.ObjectId;
  name: string;
  email: string;
  phone: string;
  address: IAddress;
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

const clientSchema = new Schema<IClient>(
  {
    groomerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, maxlength: 100 },
    email: { type: String, required: true, lowercase: true, maxlength: 254 },
    phone: { type: String, required: true, maxlength: 15 },
    address: { type: addressSchema, required: true },
  },
  { timestamps: true }
);

// A groomer cannot have two clients sharing the same email.
clientSchema.index({ groomerId: 1, email: 1 }, { unique: true });

// Text search across a groomer's clients by name, email, or phone.
clientSchema.index({ groomerId: 1, name: 'text', email: 'text', phone: 'text' });

export const Client: Model<IClient> =
  (models.Client as Model<IClient>) || model<IClient>('Client', clientSchema);
