import { z } from 'zod'
import { clientDateTimeSchema, limitSchema, offsetSchema, uuidSchema } from './common.js'

const endpointSchema = z
  .string()
  .trim()
  .max(2048)
  .url('Endpoint must be a valid URL.')
  .refine((value) => {
    const protocol = new URL(value).protocol
    return protocol === 'http:' || protocol === 'https:'
  }, 'Endpoint must use http:// or https://.')
  .nullable()
  .optional()
  .transform((value) => (value && value.length > 0 ? value : null))

const measurementSchema = z.number().finite().min(0).max(100_000).nullable()

export const createNetworkTestSchema = z
  .object({
    id: uuidSchema,
    endpoint: endpointSchema,
    latencyMs: z.number().int().min(0).max(600_000).nullable(),
    downloadMbps: measurementSchema,
    uploadMbps: measurementSchema,
    testedAt: clientDateTimeSchema,
    error: z.string().trim().max(500).nullable().optional().transform((value) => value || null),
    available: z.boolean(),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.available) {
      if (
        result.latencyMs === null ||
        result.downloadMbps === null ||
        result.uploadMbps === null
      ) {
        context.addIssue({
          code: 'custom',
          message: 'A completed test must include latency, download and upload measurements.',
          path: ['available'],
        })
      }
      if (result.error !== null) {
        context.addIssue({
          code: 'custom',
          message: 'A completed test cannot include an error message.',
          path: ['error'],
        })
      }
      return
    }

    if (!result.error) {
      context.addIssue({
        code: 'custom',
        message: 'An unavailable test must explain why no measurement was possible.',
        path: ['error'],
      })
    }
  })

export const networkTestFiltersSchema = z
  .object({
    limit: limitSchema,
    offset: offsetSchema,
  })
  .strict()

export type CreateNetworkTestInput = z.infer<typeof createNetworkTestSchema>
