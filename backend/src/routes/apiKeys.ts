/**
 * API keys (Plan §8.3, §8.14, §19). The secret is sha256-hashed at rest and shown exactly once,
 * in the response to the create call.
 */
import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { API_KEY_SCOPES, type ApiKeyScope } from '@iamscope/types';
import { createApiKeySchema, type CreateApiKeyInput } from '@iamscope/schemas';
import { attachAuth, currentOrgId, requireOrgAccess, requireRole } from '../auth/middleware';
import { generateApiKey } from '../auth/tokens';
import { identity } from '../db/identity';
import type { ApiKeyDoc } from '../db/documents';
import { badRequest, notFound } from '../lib/errors';
import { oidRequired } from '../lib/objectId';
import { toApiKeyDTO } from '../lib/serialize';
import { asyncHandler, sendData } from '../middleware/errorHandler';
import { auditMutation } from '../middleware/audit';
import { validateBody } from '../middleware/validate';
import { recordAuthEvent } from '../services/audit';

export const apiKeysRouter = Router();
apiKeysRouter.use(attachAuth());

function assertValidScopes(scopes: readonly string[]): ApiKeyScope[] {
  const invalid = scopes.filter((scope) => !(API_KEY_SCOPES as readonly string[]).includes(scope));
  if (invalid.length > 0) throw badRequest(`Unknown API key scope(s): ${invalid.join(', ')}`);
  return [...new Set(scopes)] as ApiKeyScope[];
}

apiKeysRouter.get(
  '/:id/api-keys',
  requireOrgAccess('id'),
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const orgId = currentOrgId(req);
    const docs = await identity
      .apiKeys()
      .find({ orgId, revokedAt: null })
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray();
    sendData(
      res,
      docs.map((doc) => toApiKeyDTO(doc)),
    );
  }),
);

apiKeysRouter.post(
  '/:id/api-keys',
  requireOrgAccess('id'),
  requireRole('admin'),
  validateBody(createApiKeySchema),
  asyncHandler(async (req, res) => {
    const orgId = currentOrgId(req);
    const payload = req.body as CreateApiKeyInput & { name: string; scopes: ApiKeyScope[] };
    const scopes = assertValidScopes(payload.scopes);

    const generated = generateApiKey();
    const now = new Date();
    const doc: Omit<ApiKeyDoc, '_id'> = {
      orgId,
      name: payload.name,
      keyHash: generated.keyHash,
      prefix: generated.prefix,
      scopes,
      createdBy: req.auth?.user?._id ?? new ObjectId('000000000000000000000000'),
      createdAt: now,
      lastUsedAt: null,
      expiresAt:
        payload.expiresAt === undefined || payload.expiresAt === null
          ? null
          : new Date(payload.expiresAt),
      revokedAt: null,
    };

    const inserted = await identity.apiKeys().insertOne(doc as ApiKeyDoc);

    await auditMutation(req, {
      action: 'apikey.create',
      target: { type: 'api_key', id: oidRequired(inserted.insertedId), name: payload.name },
      after: { name: payload.name, scopes, prefix: generated.prefix },
    });
    void recordAuthEvent({
      userId: req.auth?.user?._id ?? null,
      email: req.auth?.user?.email ?? null,
      orgId,
      type: 'apikey.created',
      metadata: { scopes },
    });

    // `secret` is present exactly once, on the created key itself.
    sendData(res, toApiKeyDTO({ ...doc, _id: inserted.insertedId }, generated.secret), 201);
  }),
);

apiKeysRouter.delete(
  '/:id/api-keys/:apiKeyId',
  requireOrgAccess('id'),
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const orgId = currentOrgId(req);
    const keyId = req.params.apiKeyId ?? '';
    if (!/^[a-f\d]{24}$/i.test(keyId)) throw badRequest('Invalid API key id');

    const existing = await identity.apiKeys().findOne({ _id: new ObjectId(keyId), orgId });
    if (existing === null) throw notFound('API key not found');

    const now = new Date();
    await identity.apiKeys().updateOne({ _id: existing._id }, { $set: { revokedAt: now } });

    await auditMutation(req, {
      action: 'apikey.revoke',
      target: { type: 'api_key', id: oidRequired(existing._id), name: existing.name },
      before: { scopes: existing.scopes, prefix: existing.prefix },
      after: { revokedAt: now.toISOString() },
    });
    void recordAuthEvent({
      userId: req.auth?.user?._id ?? null,
      email: req.auth?.user?.email ?? null,
      orgId,
      type: 'apikey.revoked',
      metadata: { apiKeyId: oidRequired(existing._id) },
    });

    sendData(res, { success: true });
  }),
);
