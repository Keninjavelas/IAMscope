/**
 * Transaction helper (Plan §7, §29).
 *
 * Atlas and the local Docker replica set support multi-document transactions. A bare
 * `mongod` (e.g. the default `mongodb-memory-server` binary, or a single-node dev setup
 * without `--replSet`) does not, so this helper transparently falls back to sequential
 * execution and logs the downgrade once.
 */
import type { ClientSession } from 'mongodb';
import { logger } from '../logger';
import { isTransactionUnsupported } from '../lib/errors';
import { dataClient } from './data';

export type TransactionalWork<T> = (session: ClientSession | undefined) => Promise<T>;

let fallbackWarned = false;

function warnFallback(reason: unknown): void {
  if (fallbackWarned) return;
  fallbackWarned = true;
  logger.warn(
    { err: reason },
    'transactions unavailable on this deployment - falling back to sequential writes (no atomicity across collections)',
  );
}

/** Test helper. */
export function resetTransactionFallbackWarning(): void {
  fallbackWarned = false;
}

export async function withTransaction<T>(work: TransactionalWork<T>): Promise<T> {
  let session: ClientSession;
  try {
    session = dataClient().startSession();
  } catch (error) {
    warnFallback(error);
    return work(undefined);
  }

  try {
    const holder: { value: T | undefined; set: boolean } = { value: undefined, set: false };

    await session.withTransaction(async () => {
      holder.value = await work(session);
      holder.set = true;
    });

    if (!holder.set) {
      // The transaction was retried to exhaustion without committing.
      throw new Error('transaction did not commit');
    }

    return holder.value as T;
  } catch (error) {
    if (isTransactionUnsupported(error)) {
      warnFallback(error);
      // `await` matters: without it the `finally` would end the session while this
      // promise is still in flight.
      return await work(undefined);
    }
    throw error;
  } finally {
    await session.endSession().catch(() => undefined);
  }
}
