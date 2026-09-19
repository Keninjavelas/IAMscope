/**
 * Ephemeral mongod helper for integration tests.
 *
 * `mongodb-memory-server` downloads a mongod binary on first use. On a machine without network
 * access (or with the download blocked) that fails - in which case `mongoAvailable()` resolves
 * `false` and the integration suites use `describe.skipIf` so `npm test` still exits 0.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectData, closeData, dataDb } from '../../src/db/data';
import { connectIdentity, closeIdentity, identityDb } from '../../src/db/identity';
import { createIndexes } from '../../src/db/indexes';

let server: MongoMemoryServer | null = null;
let available: boolean | null = null;
let failureReason = 'not attempted yet';

export async function mongoAvailable(): Promise<boolean> {
  if (available !== null) return available;

  try {
    server = await MongoMemoryServer.create();
    available = true;
  } catch (error) {
    failureReason = error instanceof Error ? error.message : String(error);
    available = false;
  }

  return available;
}

export function skipReason(): string {
  return `mongodb-memory-server unavailable: ${failureReason}`;
}

export function mongoUri(): string {
  if (server === null) throw new Error('mongo server is not running');
  return server.getUri();
}

/** Connects both pools to the ephemeral server and ensures indexes exist. */
export async function connectTestDatabases(): Promise<void> {
  if (server === null) throw new Error('mongo server is not running');

  const base = server.getUri();
  await connectIdentity(`${base}iamscope_identity`);
  await connectData(`${base}iamscope_data`);
  await createIndexes();
}

export async function dropTestDatabases(): Promise<void> {
  if (server === null) return;
  await identityDb().dropDatabase();
  await dataDb().dropDatabase();
}

export async function stopTestMongo(): Promise<void> {
  await Promise.all([closeIdentity().catch(() => undefined), closeData().catch(() => undefined)]);
  if (server !== null) {
    await server.stop().catch(() => undefined);
    server = null;
  }
}
