import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll } from 'vitest';

let mongoServer: MongoMemoryServer | undefined;

/**
 * Whether an in-memory MongoDB connection is available for this run.
 *
 * On some environments (e.g. CPUs/VMs without the AVX instruction set that
 * MongoDB 8.x requires) the bundled `mongod` binary cannot start. When that
 * happens we do NOT crash the whole test run — pure-logic tests must still be
 * able to execute. DB-dependent tests should guard on `isDbAvailable()` and
 * skip themselves when the connection could not be established.
 */
let dbAvailable = false;

export function isDbAvailable(): boolean {
  return dbAvailable && mongoose.connection.readyState === 1;
}

// Start an in-memory MongoDB instance and connect mongoose before the suite runs.
// Bounded so a slow/blocked binary download can never trigger a hook timeout;
// if it cannot start in time, DB-backed tests skip and pure-logic tests run.
beforeAll(async () => {
  const startup = (async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);
    dbAvailable = true;
  })();

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('MongoMemoryServer startup timed out')), 20000)
  );

  try {
    await Promise.race([startup, timeout]);
  } catch (err) {
    dbAvailable = false;
    // Surface the reason once, without failing pure-logic test files.
    console.warn(
      '[tests/setup] In-memory MongoDB unavailable; DB-backed tests will be skipped.',
      err instanceof Error ? err.message : err
    );
  }
}, 30000);

// Clear all collections between tests so each test starts from a clean state.
afterEach(async () => {
  if (!isDbAvailable()) return;
  const { collections } = mongoose.connection;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
});

// Disconnect mongoose and stop the in-memory server on teardown.
afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (mongoServer) {
    await mongoServer.stop();
  }
});
