/**
 * User (Groomer) Mongoose model.
 *
 * A User represents a registered solo mobile pet groomer. Password-based
 * accounts store a bcrypt hash in `passwordHash`; OAuth-only accounts leave it
 * null and carry a `googleId` instead. Failed-login tracking fields support the
 * account-lockout policy enforced by the auth layer.
 *
 * _Requirements: 1.7, 22.1, 22.4, 22.5, 22.6_
 */
import { Schema, model, models, type Model, type Types } from 'mongoose';

export interface IUser {
  _id: Types.ObjectId;
  email: string;
  passwordHash?: string | null;
  name: string;
  googleId?: string;
  role: 'groomer';
  isActive: boolean;
  failedLoginAttempts: number;
  lockedUntil?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    passwordHash: { type: String, default: null }, // null for OAuth users
    name: { type: String, required: true, maxlength: 100 },
    googleId: { type: String, sparse: true, unique: true },
    role: { type: String, enum: ['groomer'], default: 'groomer' },
    isActive: { type: Boolean, default: false },
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
  },
  { timestamps: true }
);

userSchema.index({ email: 1 });

export const User: Model<IUser> =
  (models.User as Model<IUser>) || model<IUser>('User', userSchema);
