import { Router } from 'express'
import { requireInstallation, installationId } from '../middleware/auth.js'
import { writeLimiter } from '../middleware/rate-limit.js'
import { validate, validated } from '../middleware/validate.js'
import {
  createReportSchema,
  reportFiltersSchema,
  reportIdParamsSchema,
  type CreateReportInput,
  type ReportFilters,
} from '../schemas/reports.js'
import {
  createReport,
  deleteReport,
  getReport,
  listReports,
} from '../services/reports.js'

export const reportsRouter = Router()

reportsRouter.get(
  '/',
  validate({ query: reportFiltersSchema }),
  async (_request, response) => {
    const filters = validated<ReportFilters>(response, 'query')
    const result = await listReports(filters)
    response.setHeader('Cache-Control', 'no-store')
    response.json(result)
  },
)

reportsRouter.get(
  '/:id',
  validate({ params: reportIdParamsSchema }),
  async (_request, response) => {
    const params = validated<{ id: string }>(response, 'params')
    const report = await getReport(params.id)
    response.setHeader('Cache-Control', 'no-store')
    response.json({ report })
  },
)

reportsRouter.post(
  '/',
  writeLimiter,
  requireInstallation,
  validate({ body: createReportSchema }),
  async (_request, response) => {
    const input = validated<CreateReportInput>(response, 'body')
    const result = await createReport(installationId(response), input)
    response
      .status(result.duplicate ? 200 : 201)
      .json({ report: result.report, duplicate: result.duplicate })
  },
)

reportsRouter.delete(
  '/:id',
  writeLimiter,
  requireInstallation,
  validate({ params: reportIdParamsSchema }),
  async (_request, response) => {
    const params = validated<{ id: string }>(response, 'params')
    await deleteReport(params.id, installationId(response))
    response.status(204).end()
  },
)
