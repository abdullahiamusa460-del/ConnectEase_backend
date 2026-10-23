import { Router } from 'express'
import { validate, validated } from '../middleware/validate.js'
import { statsFiltersSchema, type StatsFilters } from '../schemas/stats.js'
import { getNetworkStats } from '../services/stats.js'

export const statsRouter = Router()

statsRouter.get(
  '/',
  validate({ query: statsFiltersSchema }),
  async (_request, response) => {
    const filters = validated<StatsFilters>(response, 'query')
    const stats = await getNetworkStats(filters)
    response.setHeader('Cache-Control', 'no-store')
    response.json({ stats })
  },
)
