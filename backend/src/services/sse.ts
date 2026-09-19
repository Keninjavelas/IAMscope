/**
 * SSE client registry + fan-out (Plan §13.2).
 *
 * Clients are held in memory and keyed by `orgId`; the watcher broadcasts document changes and
 * only clients in the matching org receive them. A heartbeat comment every 10s keeps proxies
 * from closing idle connections.
 *
 * 10s rather than a longer interval is deliberate: in production the stream passes through
 * two proxies (Vercel's edge and Render's), and some proxies only flush a buffered
 * `text/event-stream` response when more bytes are written. More frequent writes buy
 * headroom at negligible cost - the frame is ~50 bytes per client.
 *
 * The interval is advertised to clients in the `hello` event (`heartbeatSeconds`), so it can
 * be tuned here without a matching frontend change.
 */
import type { Response } from 'express';
import type { SseEvent } from '@iamscope/types';
import { logger } from '../logger';

export const SSE_HEARTBEAT_SECONDS = 10;
export const SSE_HEARTBEAT_MS = SSE_HEARTBEAT_SECONDS * 1_000;
export const SSE_RETRY_MS = 3_000;

export interface SseClient {
  id: string;
  orgId: string;
  userId: string | null;
  response: Response;
  heartbeat: NodeJS.Timeout;
  connectedAt: Date;
}

const clients = new Map<string, SseClient>();
let sequence = 0;

export function nextEventId(): string {
  sequence += 1;
  return `${Date.now().toString(36)}-${sequence.toString(36)}`;
}

export function nextClientId(): string {
  sequence += 1;
  return `c${Date.now().toString(36)}${sequence.toString(36)}`;
}

/** Serialises one SSE frame. Exported for unit tests. */
export function formatSseFrame(event: { event?: string; id?: string; data: unknown }): string {
  const lines: string[] = [];
  if (event.id !== undefined) lines.push(`id: ${event.id}`);
  if (event.event !== undefined) lines.push(`event: ${event.event}`);
  lines.push(`data: ${JSON.stringify(event.data)}`);
  return `${lines.join('\n')}\n\n`;
}

export function formatHeartbeat(now: Date = new Date()): string {
  return `: heartbeat ${now.toISOString()}\n\n`;
}

export function toSseEvent(
  collection: SseEvent['collection'],
  op: SseEvent['op'],
  orgId: string,
  documentId: string,
  payload?: Record<string, unknown>,
): SseEvent {
  const event: SseEvent = {
    id: nextEventId(),
    collection,
    op,
    orgId,
    documentId,
    timestamp: new Date().toISOString(),
  };
  return payload === undefined ? event : { ...event, payload };
}

export interface RegisterClientInput {
  orgId: string;
  userId: string | null;
  response: Response;
}

export function registerClient(input: RegisterClientInput): SseClient {
  const client: SseClient = {
    id: nextClientId(),
    orgId: input.orgId,
    userId: input.userId,
    response: input.response,
    connectedAt: new Date(),
    heartbeat: setInterval(() => {
      try {
        client.response.write(formatHeartbeat());
      } catch (error) {
        logger.warn({ err: error, clientId: client.id }, 'SSE heartbeat failed');
        unregisterClient(client.id);
      }
    }, SSE_HEARTBEAT_MS),
  };

  client.heartbeat.unref();
  clients.set(client.id, client);
  logger.debug(
    { clientId: client.id, orgId: client.orgId, total: clients.size },
    'SSE client registered',
  );
  return client;
}

export function unregisterClient(id: string): void {
  const client = clients.get(id);
  if (client === undefined) return;
  clearInterval(client.heartbeat);
  clients.delete(id);
  try {
    client.response.end();
  } catch {
    // The socket is already gone; nothing to clean up.
  }
}

/** Fans an event out to every client in the org. Returns the number of clients written to. */
export function broadcast(orgId: string, event: SseEvent): number {
  let delivered = 0;
  for (const client of clients.values()) {
    if (client.orgId !== orgId) continue;
    try {
      client.response.write(formatSseFrame({ id: event.id, event: event.collection, data: event }));
      delivered += 1;
    } catch (error) {
      logger.warn({ err: error, clientId: client.id }, 'SSE write failed - dropping client');
      unregisterClient(client.id);
    }
  }
  return delivered;
}

export function sendToClient(
  client: SseClient,
  event: { event?: string; id?: string; data: unknown },
): void {
  client.response.write(formatSseFrame(event));
}

export function clientCount(): number {
  return clients.size;
}

export function orgClientCount(orgId: string): number {
  let count = 0;
  for (const client of clients.values()) if (client.orgId === orgId) count += 1;
  return count;
}

export function listClients(): { id: string; orgId: string; connectedAt: string }[] {
  return [...clients.values()].map((client) => ({
    id: client.id,
    orgId: client.orgId,
    connectedAt: client.connectedAt.toISOString(),
  }));
}

/** Graceful shutdown hook. */
export function closeAllClients(): void {
  for (const id of [...clients.keys()]) unregisterClient(id);
}
