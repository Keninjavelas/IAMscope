import express from 'express';
import { MongoNetworkError } from 'mongodb';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from './errorHandler';

describe('database outage error response', () => {
  it('returns a retryable 503 envelope without leaking the driver error', async () => {
    const app = express();
    app.get('/probe', (_req, _res, next) => next(new MongoNetworkError('private network detail')));
    app.use(errorHandler);

    const response = await request(app).get('/probe');
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(response.body.error.message).toMatch(/Database temporarily unavailable/);
    expect(JSON.stringify(response.body)).not.toContain('private network detail');
  });
});
