/**
 * Change streams -> SSE (Plan §13.1).
 *
 * Watches the eight collections in `SSE_COLLECTIONS` with `fullDocument: 'updateLookup'` and
 * fans `{ collection, op, orgId, documentId, timestamp }` out to the matching org only.
 * On `policies` / `principals` changes the escalation cache and the timeline cache are
 * invalidated and a re-evaluation is enqueued.
 *
 * If the deployment is a standalone mongod (no replica set), change streams are unsupported:
 * the watcher logs a warning, sets `watchersActive = false` (surfaced by `GET /api/health`) and
 * the server keeps running.
 */
import {
  type ObjectId,
  type ChangeStream,
  type ChangeStreamDocument,
  type Document,
} from 'mongodb';
import type { SseCollection, SseEvent } from '@iamscope/types';
import { SSE_COLLECTIONS } from '@iamscope/types';
import { dataDb } from './db/data';
import { isChangeStreamUnsupported } from './lib/errors';
import { oidString } from './lib/objectId';
import { logger } from './logger';
import { enqueueEvaluation } from './services/evaluationRunner';
import { invalidateForPolicy } from './services/escalation';
import { invalidateTimelineCache } from './services/timeline';
import { broadcast, toSseEvent } from './services/sse';

export const WATCHED_COLLECTIONS: readonly SseCollection[] = SSE_COLLECTIONS;

export interface WatcherStatus {
  active: boolean;
  startedAt: Date | null;
  error: string | null;
  watchedCollections: string[];
}

const status: WatcherStatus = {
  active: false,
  startedAt: null,
  error: null,
  watchedCollections: [...WATCHED_COLLECTIONS],
};

const streams: ChangeStream[] = [];

/** Bounded cache so hard deletes can still be attributed to an org. */
const orgIdCache = new Map<string, string>();
const ORG_CACHE_LIMIT = 5_000;

function rememberOrgId(collection: string, documentId: string, orgId: string): void {
  if (orgIdCache.size >= ORG_CACHE_LIMIT) {
    const oldest = orgIdCache.keys().next();
    if (!oldest.done) orgIdCache.delete(oldest.value);
  }
  orgIdCache.set(`${collection}:${documentId}`, orgId);
}

function recallOrgId(collection: string, documentId: string): string | undefined {
  return orgIdCache.get(`${collection}:${documentId}`);
}

export function watcherStatus(): WatcherStatus {
  return { ...status, watchedCollections: [...status.watchedCollections] };
}

export function watchersActive(): boolean {
  return status.active;
}

type OpType = SseEvent['op'];

function toOp(operationType: string): OpType | null {
  switch (operationType) {
    case 'insert':
      return 'insert';
    case 'update':
      return 'update';
    case 'replace':
      return 'replace';
    case 'delete':
      return 'delete';
    default:
      return null;
  }
}

interface ChangeLike {
  operationType: string;
  documentKey?: { _id?: unknown };
  fullDocument?: unknown;
}

function extractOrgId(fullDocument: unknown): string | null {
  if (typeof fullDocument !== 'object' || fullDocument === null) return null;
  return oidString((fullDocument as { orgId?: ObjectId }).orgId ?? null);
}

/** Handles one change event. Exported so the mapping logic can be unit tested. */
export function handleChange(collection: SseCollection, change: ChangeLike): SseEvent | null {
  const op = toOp(change.operationType);
  if (op === null) return null;

  const documentId = oidString((change.documentKey?._id ?? null) as ObjectId | null) ?? '';
  if (documentId === '') return null;

  let orgId = extractOrgId(change.fullDocument);
  if (orgId === null) {
    const cached = recallOrgId(collection, documentId);
    if (cached === undefined) {
      logger.debug({ collection, documentId }, 'change event without orgId - skipped');
      return null;
    }
    orgId = cached;
  } else {
    rememberOrgId(collection, documentId, orgId);
  }

  return toSseEvent(
    collection,
    op,
    orgId,
    documentId,
    change.fullDocument === undefined ? undefined : undefined,
  );
}

async function afterChange(collection: SseCollection, event: SseEvent): Promise<void> {
  if (collection === 'policies') {
    invalidateTimelineCache(event.orgId);
    await invalidateForPolicy({ toHexString: () => event.orgId } as unknown as ObjectId).catch(
      () => 0,
    );
    enqueueEvaluation({
      orgId: { toHexString: () => event.orgId } as unknown as ObjectId,
      trigger: 'policy.update',
    });
    return;
  }

  if (collection === 'principals') {
    invalidateTimelineCache(event.orgId);
    enqueueEvaluation({
      orgId: { toHexString: () => event.orgId } as unknown as ObjectId,
      trigger: 'principal.update',
    });
    return;
  }

  if (collection === 'resources' || collection === 'scenarios') {
    invalidateTimelineCache(event.orgId);
  }
}

/** Opens every watcher. Never throws - unsupported deployments degrade gracefully. */
export async function startWatcher(): Promise<WatcherStatus> {
  if (status.active) return watcherStatus();

  const db = dataDb();

  for (const collection of WATCHED_COLLECTIONS) {
    try {
      const stream = db
        .collection(collection)
        .watch<Document>([], { fullDocument: 'updateLookup' });

      stream.on('change', (change: ChangeStreamDocument) => {
        const event = handleChange(collection, change);
        if (event === null) return;

        broadcast(event.orgId, event);
        void afterChange(collection, event).catch((error: unknown) => {
          logger.error({ err: error, collection }, 'watcher post-processing failed');
        });
      });

      stream.on('error', (error: unknown) => {
        if (isChangeStreamUnsupported(error)) {
          status.active = false;
          status.error = error instanceof Error ? error.message : String(error);
          logger.warn({ err: error, collection }, 'change streams unsupported - watchers disabled');
          return;
        }
        logger.error({ err: error, collection }, 'change stream error');
      });

      streams.push(stream);
    } catch (error) {
      if (isChangeStreamUnsupported(error)) {
        status.active = false;
        status.error = error instanceof Error ? error.message : String(error);
        logger.warn(
          { err: error, collection },
          'change streams are not supported on this deployment - SSE will not receive live updates',
        );
        await closeWatcher();
        return watcherStatus();
      }
      logger.error({ err: error, collection }, 'failed to open change stream');
    }
  }

  status.active = streams.length > 0;
  status.startedAt = new Date();
  status.error = status.active ? null : 'no change streams were opened';
  logger.info(
    { collections: WATCHED_COLLECTIONS.length, active: status.active },
    'watcher started',
  );
  return watcherStatus();
}

export async function closeWatcher(): Promise<void> {
  const open = streams.splice(0, streams.length);
  await Promise.all(
    open.map(async (stream) => {
      try {
        await stream.close();
      } catch {
        // Already closed.
      }
    }),
  );
  status.active = false;
}

/** Test helper. */
export function resetWatcherState(): void {
  status.active = false;
  status.startedAt = null;
  status.error = null;
  orgIdCache.clear();
}

/** Test helper: seeds the org cache so delete events can be attributed. */
export function rememberDocumentOrg(
  collection: SseCollection,
  documentId: string,
  orgId: string,
): void {
  rememberOrgId(collection, documentId, orgId);
}
