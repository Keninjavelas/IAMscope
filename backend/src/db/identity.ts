/**
 * `iamscope_identity` connection pool + typed collection accessors (Plan §3, §4).
 * The URI defaults to `env.MONGO_IDENTITY_URL` but can be overridden so tests can point the
 * pool at an ephemeral mongod.
 */
import { MongoClient, type Collection, type Db, type Document } from 'mongodb';
import { env } from '../env';
import { logger } from '../logger';
import type {
  ApiKeyDoc,
  AuthEventDoc,
  InvitationDoc,
  MembershipDoc,
  OrgDoc,
  RateLimitDoc,
  SessionDoc,
  UserDoc,
} from './documents';

let client: MongoClient | null = null;
let database: Db | null = null;

export async function connectIdentity(uri: string = env.MONGO_IDENTITY_URL): Promise<Db> {
  if (database !== null) return database;

  const next = new MongoClient(uri, {
    autoSelectFamily: false,
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
    retryWrites: true,
    maxPoolSize: 20,
  });

  next.on('close', () => logger.warn('identity pool closed'));
  next.on('error', (error: unknown) => logger.error({ err: error }, 'identity pool error'));
  next.on('reconnect', () => logger.info('identity pool reconnected'));

  await next.connect();
  client = next;
  database = next.db();
  logger.info({ db: database.databaseName }, 'identity pool connected');
  return database;
}

export function identityDb(): Db {
  if (database === null)
    throw new Error('identity pool is not connected - call connectIdentity() first');
  return database;
}

export function identityClient(): MongoClient {
  if (client === null)
    throw new Error('identity pool is not connected - call connectIdentity() first');
  return client;
}

export function identityCollection<T extends Document>(name: string): Collection<T> {
  return identityDb().collection<T>(name);
}

export const identity = {
  users: (): Collection<UserDoc> => identityCollection<UserDoc>('users'),
  sessions: (): Collection<SessionDoc> => identityCollection<SessionDoc>('sessions'),
  orgs: (): Collection<OrgDoc> => identityCollection<OrgDoc>('orgs'),
  memberships: (): Collection<MembershipDoc> => identityCollection<MembershipDoc>('memberships'),
  invitations: (): Collection<InvitationDoc> => identityCollection<InvitationDoc>('invitations'),
  apiKeys: (): Collection<ApiKeyDoc> => identityCollection<ApiKeyDoc>('api_keys'),
  authEvents: (): Collection<AuthEventDoc> => identityCollection<AuthEventDoc>('auth_events'),
  rateLimits: (): Collection<RateLimitDoc> => identityCollection<RateLimitDoc>('rate_limits'),
};

export function isIdentityConnected(): boolean {
  return database !== null;
}

export async function pingIdentity(): Promise<boolean> {
  if (database === null) return false;
  try {
    await database.command({ ping: 1 });
    return true;
  } catch (error) {
    logger.warn({ err: error }, 'identity ping failed');
    return false;
  }
}

export async function closeIdentity(): Promise<void> {
  if (client === null) return;
  await client.close(true);
  client = null;
  database = null;
}

/** Test helper: drops the cached handles without closing an externally managed client. */
export function resetIdentityHandle(): void {
  client = null;
  database = null;
}
