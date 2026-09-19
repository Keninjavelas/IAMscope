/** Request correlation (Plan §18): every request carries an id and a child logger. */
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { requestLogger } from '../logger';

export const REQUEST_ID_HEADER = 'x-request-id';

export function requestIdMiddleware(): RequestHandler {
  return (req, res, next) => {
    const incoming = req.headers[REQUEST_ID_HEADER];
    const requestId =
      typeof incoming === 'string' && incoming.trim() !== '' && incoming.length <= 128
        ? incoming.trim()
        : randomUUID();

    req.requestId = requestId;
    req.log = requestLogger(requestId, { method: req.method, path: req.path });
    res.setHeader('X-Request-Id', requestId);
    next();
  };
}
