import { z } from 'zod'
import { clientDateTimeSchema, optionalLocationSchema, providerSchema } from './common.js'

export const statsFiltersSchema = z
  .object({
    provider: providerSchema.optional(),
    location: z.string().trim().max(120).optional(),
    from: clientDateTimeSchema.optional(),
    to: clientDateTimeSchema.optional(),
  })
  .strict()
  .refine(
    (filters) =>
      !filters.from || !filters.to || Date.parse(filters.from) <= Date.parse(filters.to),
    { message: 'The "from" date must be before or equal to the "to" date.', path: ['from'] },
  )

export const statsLocationQuerySchema = z
  .object({
    location: optionalLocationSchema,
    limit: z.coerce.number().int().min(1).max(50).default(10),
  })
  .strict()

export type StatsFilters = z.infer<typeof statsFiltersSchema>
