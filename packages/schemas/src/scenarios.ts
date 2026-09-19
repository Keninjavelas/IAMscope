import { z } from 'zod';
import { iamActionSchema, listQuerySchema, policyEffectSchema, principalArnSchema } from './common';

const resourceArnOrWildcard = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine(
    (value) => value === '*' || value.startsWith('arn:'),
    'Expected an ARN or the wildcard "*"',
  );

export const createScenarioSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(160),
  principalArn: principalArnSchema,
  action: iamActionSchema,
  resourceArn: resourceArnOrWildcard,
  expectedResult: policyEffectSchema,
  tags: z.array(z.string().trim().min(1).max(48)).max(24).optional(),
});

export const updateScenarioSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    principalArn: principalArnSchema.optional(),
    action: iamActionSchema.optional(),
    resourceArn: resourceArnOrWildcard.optional(),
    expectedResult: policyEffectSchema.optional(),
    tags: z.array(z.string().trim().min(1).max(48)).max(24).optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: 'Nothing to update',
  });

export const listScenariosQuerySchema = listQuerySchema.extend({
  principalArn: principalArnSchema.optional(),
});

export type CreateScenarioInput = z.input<typeof createScenarioSchema>;
export type UpdateScenarioInput = z.input<typeof updateScenarioSchema>;
