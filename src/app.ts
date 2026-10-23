import express from 'express'
import helmet from 'helmet'
import { pinoHttp } from 'pino-http'
import { corsMiddleware } from './middleware/cors.js'
import { errorHandler, notFoundHandler } from './middleware/error-handler.js'
import { globalLimiter } from './middleware/rate-limit.js'
import { requestContext } from './middleware/request-context.js'
import { logger } from './lib/logger.js'
import { healthRouter } from './routes/health.js'
import { installationsRouter } from './routes/installations.js'
import { networkTestsRouter } from './routes/network-tests.js'
import { reportsRouter } from './routes/reports.js'
import { statsRouter } from './routes/stats.js'
import { syncRouter } from './routes/sync.js'

export function createApp() {
  const app = express()

  app.disable('x-powered-by')
  app.use(requestContext)
  app.use(
    pinoHttp({
      logger,
      genReqId: (_request, response) => response.locals.requestId as string,
      customLogLevel: (_request, response, error) => {
        if (error || response.statusCode >= 500) return 'error'
        if (response.statusCode >= 400) return 'warn'
        return 'info'
      },
      customProps: (_request, response) => ({
        requestId: response.locals.requestId,
      }),
    }),
  )
  app.use(helmet())
  app.use(corsMiddleware)
  app.use(express.json({ limit: '64kb', type: ['application/json', 'application/*+json'] }))
  app.use(globalLimiter)

  app.get('/', (_request, response) => {
    response.json({
      name: 'ConnectEase API',
      version: '1.0.0',
      documentation: '/docs/API.md',
      health: '/api/v1/health',
    })
  })

  app.use('/health', healthRouter)
  app.use('/api/v1/health', healthRouter)
  app.get('/api/v1', (_request, response) => {
    response.json({
      name: 'ConnectEase API',
      version: '1.0.0',
      endpoints: {
        register: 'POST /api/v1/installations/register',
        sync: 'POST /api/v1/sync',
        records: 'GET /api/v1/sync/records',
        reports: 'GET|POST /api/v1/reports',
        report: 'GET|DELETE /api/v1/reports/:id',
        networkTests: 'GET|POST /api/v1/network-tests',
        stats: 'GET /api/v1/stats',
      },
    })
  })

  app.use('/api/v1/installations', installationsRouter)
  app.use('/api/v1/sync', syncRouter)
  app.use('/api/v1/reports', reportsRouter)
  app.use('/api/v1/network-tests', networkTestsRouter)
  app.use('/api/v1/stats', statsRouter)

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}

export const app = createApp()
