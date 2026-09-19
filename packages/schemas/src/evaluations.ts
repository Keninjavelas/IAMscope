import { z } from 'zod';
import {
  booleanQuerySchema,
  iamActionSchema,
  isoDateTimeSchema,
  objectIdSchema,
  principalArnSchema,
} from './common';
import { listQuerySchema } from './common';

const resourceArnOrWildcard = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine(
    (value) => value === '*' || value.startsWith('arn:'),
    'Expected an ARN or the wildcard "*"',
  );

export const evaluateSchema = z.object({
  principalArn: principalArnSchema,
  action: iamActionSchema,
  resourceArn: resourceArnOrWildcard,
  persist: z.boolean().optional(),
  label: z.string().trim().max(200).optional(),
});

export const listEvaluationsQuerySchema = listQuerySchema;

export const evaluationIdParamSchema = z.object({ id: objectIdSchema });

export const evaluationDiffQuerySchema = z.object({
  before: objectIdSchema.optional(),
  after: objectIdSchema.optional(),
});

export const escalationQuerySchema = z.object({
  fromPrincipalArn: principalArnSchema.optional(),
  maxDepth: z.coerce.number().int().min(1).max(5).optional(),
  refresh: z.boolean().optional(),
});

export const graphPathsQuerySchema = z.object({
  from: principalArnSchema.optional(),
});

export const timelineStateQuerySchema = z.object({
  at: isoDateTimeSchema,
});

export const timelineEventsQuerySchema = z.object({
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
  granularity: z.enum(['hour', 'day']).optional(),
});

export const timelineDiffQuerySchema = z.object({
  at: isoDateTimeSchema,
  compareTo: isoDateTimeSchema.optional(),
});

export const auditQuerySchema = listQuerySchema.extend({
  targetType: z.string().trim().max(64).optional(),
  targetId: z.string().trim().max(64).optional(),
  actorId: objectIdSchema.optional(),
  action: z.string().trim().max(120).optional(),
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
});

export const attributionQuerySchema = z.object({
  scenarioId: objectIdSchema,
  before: objectIdSchema.optional(),
  after: objectIdSchema.optional(),
});

export const presenceHeartbeatSchema = z.object({
  location: z.object({
    route: z.string().trim().max(512),
    entityType: z.string().trim().max(64).nullable().optional(),
    entityId: z.string().trim().max(64).nullable().optional(),
  }),
  cursor: z
    .object({
      x: z.number().finite(),
      y: z.number().finite(),
    })
    .nullable()
    .optional(),
});

export const includeDeletedQuerySchema = z.object({
  includeDeleted: booleanQuerySchema.optional(),
});

export type EvaluateInput = z.input<typeof evaluateSchema>;
export type EvaluateOutput = z.output<typeof evaluateSchema>;
export type PresenceHeartbeatInput = z.input<typeof presenceHeartbeatSchema>;
export type AttributionQueryInput = z.input<typeof attributionQuerySchema>;
