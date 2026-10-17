/** Mounts every router under `/api` (Plan §8). */
import { Router } from 'express';
import { requireAuth, requirePlatformAdmin } from '../auth/middleware';
import { adminRouter } from './admin';
import { apiKeysRouter } from './apiKeys';
import { auditRouter } from './audit';
import { authRouter } from './auth';
import { evaluateRouter, evaluationsRouter } from './evaluations';
import { eventsRouter } from './events';
import { graphRouter } from './graph';
import { orgInvitationsRouter, publicInvitationsRouter } from './invitations';
import { orgsRouter } from './orgs';
import { policiesRouter } from './policies';
import { presenceRouter } from './presence';
import { principalsRouter } from './principals';
import { resourcesRouter } from './resources';
import { scenariosRouter } from './scenarios';
import { timelineRouter } from './timeline';

export function createApiRouter(): Router {
  const api = Router();

  api.use('/auth', authRouter);
  api.use('/orgs', orgsRouter);
  api.use('/orgs', orgInvitationsRouter);
  api.use('/orgs', apiKeysRouter);
  api.use('/invitations', publicInvitationsRouter);
  /**
   * Platform-admin surface: cross-tenant, so it is gated by the allowlist rather than
   * by an org role. `requireAuth` comes first so `req.auth.user` is always present.
   */
  api.use('/admin', requireAuth, requirePlatformAdmin(), adminRouter);

  api.use('/policies', policiesRouter);
  api.use('/principals', principalsRouter);
  api.use('/resources', resourcesRouter);
  api.use('/scenarios', scenariosRouter);
  api.use('/evaluations', evaluationsRouter);
  api.use('/evaluate', evaluateRouter);
  api.use('/graph', graphRouter);
  api.use('/timeline', timelineRouter);
  api.use('/audit', auditRouter);
  api.use('/presence', presenceRouter);
  api.use('/events', eventsRouter);

  return api;
}
