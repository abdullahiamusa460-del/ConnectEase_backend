import { z } from 'zod'

export const uuidSchema = z
  .string()
  .trim()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    'Must be a valid UUID.',
  )

export const isoDateTimeSchema = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Must be a valid ISO-8601 date-time.')
  .refine((value) => /T/i.test(value), 'Must include both a date and a time.')

export const providerSchema = z.enum(['MTN', 'Airtel', 'Glo', '9mobile', 'Other'])

export const recordCategorySchema = z.enum(['note', 'contact', 'resource'])

const EARLIEST_CLIENT_TIME = Date.parse('2020-01-01T00:00:00.000Z')
const MAX_FUTURE_SKEW_MS = 10 * 60 * 1000

export function isReasonableClientTime(value: string): boolean {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) return false
  const upperBound = Date.now() + MAX_FUTURE_SKEW_MS
  return timestamp >= EARLIEST_CLIENT_TIME && timestamp <= upperBound
}

export const clientDateTimeSchema = isoDateTimeSchema.refine(
  (value) => isReasonableClientTime(value),
  'Timestamp is outside the allowed range.',
)

export const optionalLocationSchema = z
  .string()
  .trim()
  .max(120, 'Location must be 120 characters or fewer.')
  .nullable()
  .optional()
  .transform((value) => (value && value.length > 0 ? value : null))

export const issueSchema = z
  .string()
  .trim()
  .min(1, 'Describe the issue.')
  .max(2000, 'Issue must be 2000 characters or fewer.')

export const limitSchema = z.coerce.number().int().min(1).max(100).default(20)
export const offsetSchema = z.coerce.number().int().min(0).max(100_000).default(0)
