/**
 * MongoDB connection singleton.
 *
 * Next.js may re-evaluate modules across hot reloads and serverless
 * invocations, so we cache the connection promise on the Node.js `global`
 * object to avoid opening a new pool on every call.
 *
 * We also import the central model registry (side-effect) so EVERY model
 * schema is registered before any query runs. Without this, a cold serverless
 * invocation that calls `.populate('serviceId')` on a page that never imported
 * the Service model throws `MissingSchemaError` and crashes the render.
 *
 * _Requirements: 22.1, 22.4_
 */
import mongoose from 'mongoose';
import '@/lib/db/models'; // registers all schemas (fixes populate MissingSchemaError)

const MONGODB_URI = process.env.MONGODB_URI;

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

// Reuse the cache across module reloads.
const globalWithMongoose = global as typeof globalThis & {
  mongoose?: MongooseCache;
};

const cached: MongooseCache =
  globalWithMongoose.mongoose ?? { conn: null, promise: null };

if (!globalWithMongoose.mongoose) {
  globalWithMongoose.mongoose = cached;
}

export async function connectDB(): Promise<typeof mongoose> {
  if (cached.conn) return cached.conn;

  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI environment variable is not defined');
  }

  if (!cached.promise) {
    cached.promise = mongoose.connect(MONGODB_URI, {
      bufferCommands: false,
      maxPoolSize: 10,
    });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}