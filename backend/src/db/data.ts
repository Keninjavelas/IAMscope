/**
 * `iamscope_data` connection pool + typed collection accessors (Plan §3, §4).
 */
import { MongoClient, type Collection, type Db, type Document } from 'mongodb';
import { env } from '../env';
import { logger } from '../logger';
import type {
  AuditEventDoc,
  EscalationPathDoc,
  EvaluationRunDoc,
  PolicyDoc,
  PolicyVersionDoc,
  PresenceDoc,
  PrincipalDoc,
  ResourceDoc,
  ScenarioDoc,
} from './documents';

let client: MongoClient | null = null;
let database: Db | null = null;

export async function connectData(uri: string = env.MONGO_DATA_URL): Promise<Db> {
  if (database !== null) return database;

  const next = new MongoClient(uri, {
    autoSelectFamily: false,
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
    retryWrites: true,
    maxPoolSize: 20,
  });

  next.on('close', () => logger.warn('data pool closed'));
  next.on('error', (error: unknown) => logger.error({ err: error }, 'data pool error'));
  next.on('reconnect', () => logger.info('data pool reconnected'));

  await next.connect();
  client = next;
  database = next.db();
  logger.info({ db: database.databaseName }, 'data pool connected');
  return database;
}

export function dataDb(): Db {
  if (database === null) throw new Error('data pool is not connected - call connectData() first');
  return database;
}

export function dataClient(): MongoClient {
  if (client === null) throw new Error('data pool is not connected - call connectData() first');
  return client;
}

export function dataCollection<T extends Document>(name: string): Collection<T> {
  return dataDb().collection<T>(name);
}

export const data = {
  policies: (): Collection<PolicyDoc> => dataCollection<PolicyDoc>('policies'),
  policyVersions: (): Collection<PolicyVersionDoc> =>
    dataCollection<PolicyVersionDoc>('policy_versions'),
  principals: (): Collection<PrincipalDoc> => dataCollection<PrincipalDoc>('principals'),
  resources: (): Collection<ResourceDoc> => dataCollection<ResourceDoc>('resources'),
  scenarios: (): Collection<ScenarioDoc> => dataCollection<ScenarioDoc>('scenarios'),
  evaluationRuns: (): Collection<EvaluationRunDoc> =>
    dataCollection<EvaluationRunDoc>('evaluation_runs'),
  escalationPaths: (): Collection<EscalationPathDoc> =>
    dataCollection<EscalationPathDoc>('escalation_paths'),
  auditEvents: (): Collection<AuditEventDoc> => dataCollection<AuditEventDoc>('audit_events'),
  presence: (): Collection<PresenceDoc> => dataCollection<PresenceDoc>('presence'),
};

export function isDataConnected(): boolean {
  return database !== null;
}

export async function pingData(): Promise<boolean> {
  if (database === null) return false;
  try {
    await database.command({ ping: 1 });
    return true;
  } catch (error) {
    logger.warn({ err: error }, 'data ping failed');
    return false;
  }
}

export async function closeData(): Promise<void> {
  if (client === null) return;
  await client.close(true);
  client = null;
  database = null;
}

/** Test helper: drops the cached handles without closing an externally managed client. */
export function resetDataHandle(): void {
  client = null;
  database = null;
}
