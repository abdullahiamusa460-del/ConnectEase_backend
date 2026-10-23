import { Router } from 'express'
import { installationId, requireInstallation } from '../middleware/auth.js'
import { writeLimiter } from '../middleware/rate-limit.js'
import { validate, validated } from '../middleware/validate.js'
import {
  createNetworkTestSchema,
  networkTestFiltersSchema,
  type CreateNetworkTestInput,
} from '../schemas/network-tests.js'
import { createNetworkTest, listNetworkTests } from '../services/network-tests.js'

export const networkTestsRouter = Router()

networkTestsRouter.use(requireInstallation)

networkTestsRouter.get(
  '/',
  validate({ query: networkTestFiltersSchema }),
  async (_request, response) => {
    const filters = validated<{ limit: number; offset: number }>(response, 'query')
    const result = await listNetworkTests(installationId(response), filters)
    response.setHeader('Cache-Control', 'no-store')
    response.json(result)
  },
)

networkTestsRouter.post(
  '/',
  writeLimiter,
  validate({ body: createNetworkTestSchema }),
  async (_request, response) => {
    const input = validated<CreateNetworkTestInput>(response, 'body')
    const result = await createNetworkTest(installationId(response), input)
    response
      .status(result.duplicate ? 200 : 201)
      .json({ test: result.test, duplicate: result.duplicate })
  },
)
