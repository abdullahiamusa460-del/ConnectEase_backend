import { z } from 'zod'
import {
  clientDateTimeSchema,
  limitSchema,
  offsetSchema,
  optionalLocationSchema,
  providerSchema,
  uuidSchema,
} from './common.js'

export const createReportSchema = z
  .object({
    id: uuidSchema,
    provider: providerSchema,
    location: optionalLocationSchema,
    issue: z
      .string()
      .trim()
      .min(1, 'Describe the issue.')
      .max(2000, 'Issue must be 2000 characters or fewer.'),
    reportedAt: clientDateTimeSchema,
  })
  .strict()

export const reportIdParamsSchema = z.object({ id: uuidSchema }).strict()

export const reportFiltersSchema = z
  .object({
    provider: providerSchema.optional(),
    location: z.string().trim().max(120).optional(),
    q: z.string().trim().max(120).optional(),
    from: clientDateTimeSchema.optional(),
    to: clientDateTimeSchema.optional(),
    limit: limitSchema,
    offset: offsetSchema,
    sort: z.enum(['newest', 'oldest']).default('newest'),
  })
  .strict()
  .refine(
    (filters) =>
      !filters.from || !filters.to || Date.parse(filters.from) <= Date.parse(filters.to),
    { message: 'The "from" date must be before or equal to the "to" date.', path: ['from'] },
  )

export type CreateReportInput = z.infer<typeof createReportSchema>
export type ReportFilters = z.infer<typeof reportFiltersSchema>
