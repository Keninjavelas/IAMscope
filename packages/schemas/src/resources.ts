import { z } from 'zod';
import { arnSchema, listQuerySchema, resourceTypeSchema, tagsSchema } from './common';

export const createResourceSchema = z.object({
  arn: arnSchema,
  type: resourceTypeSchema,
  tags: tagsSchema.optional(),
  accountId: z
    .string()
    .trim()
    .regex(/^\d{12}$/, 'Account IDs are 12 digits')
    .nullable()
    .optional(),
});

export const updateResourceSchema = z
  .object({
    arn: arnSchema.optional(),
    type: resourceTypeSchema.optional(),
    tags: tagsSchema.optional(),
    accountId: z
      .string()
      .trim()
      .regex(/^\d{12}$/, 'Account IDs are 12 digits')
      .nullable()
      .optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: 'Nothing to update',
  });

export const listResourcesQuerySchema = listQuerySchema.extend({
  type: resourceTypeSchema.optional(),
  accountId: z.string().trim().max(12).optional(),
});

export type CreateResourceInput = z.input<typeof createResourceSchema>;
export type UpdateResourceInput = z.input<typeof updateResourceSchema>;
