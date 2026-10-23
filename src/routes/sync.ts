import { Router } from 'express'
import { installationId, requireInstallation } from '../middleware/auth.js'
import { syncLimiter } from '../middleware/rate-limit.js'
import { validate, validated } from '../middleware/validate.js'
import { syncRecordsQuerySchema, syncRequestSchema, type SyncRequestInput } from '../schemas/sync.js'
import { getWorkspaceRecords, syncWorkspace } from '../services/sync.js'

export const syncRouter = Router()

syncRouter.use(requireInstallation)

syncRouter.post(
  '/',
  syncLimiter,
  validate({ body: syncRequestSchema }),
  async (_request, response) => {
    const input = validated<SyncRequestInput>(response, 'body')
    const result = await syncWorkspace(installationId(response), input)
    response.setHeader('Cache-Control', 'no-store')
    response.json(result)
  },
)

syncRouter.get(
  '/records',
  validate({ query: syncRecordsQuerySchema }),
  async (_request, response) => {
    const query = validated<{ since?: string }>(response, 'query')
    const result = await getWorkspaceRecords(installationId(response), query.since)
    response.setHeader('Cache-Control', 'no-store')
    response.json(result)
  },
)
