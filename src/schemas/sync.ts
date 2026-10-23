import { z } from 'zod'
import {
  clientDateTimeSchema,
  recordCategorySchema,
  uuidSchema,
} from './common.js'

const recordSchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required.').max(200),
    body: z.string().max(20_000),
    category: recordCategorySchema,
    pinned: z.boolean(),
    isSample: z.boolean().default(false),
    createdAt: clientDateTimeSchema,
    updatedAt: clientDateTimeSchema,
  })
  .strict()

const changeSchema = z
  .object({
    recordId: uuidSchema,
    action: z.enum(['create', 'update', 'delete']),
    changedAt: clientDateTimeSchema,
    record: recordSchema.optional(),
  })
  .strict()
  .superRefine((change, context) => {
    if (change.action !== 'delete' && !change.record) {
      context.addIssue({
        code: 'custom',
        message: 'Create and update changes must include the record.',
        path: ['record'],
      })
    }
    if (change.record && Date.parse(change.record.updatedAt) > Date.parse(change.changedAt)) {
      context.addIssue({
        code: 'custom',
        message: 'The record updatedAt timestamp cannot be later than changedAt.',
        path: ['record', 'updatedAt'],
      })
    }
  })

export const syncRequestSchema = z
  .object({
    batchId: uuidSchema,
    changes: z.array(changeSchema).max(200, 'Send at most 200 changes per batch.').default([]),
  })
  .strict()

export const syncRecordsQuerySchema = z
  .object({
    since: clientDateTimeSchema.optional(),
  })
  .strict()

export type SyncRequestInput = z.infer<typeof syncRequestSchema>
export type SyncChangeInput = z.infer<typeof changeSchema>
