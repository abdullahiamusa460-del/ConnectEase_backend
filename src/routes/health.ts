import { Router } from 'express'
import { checkDatabase } from '../db/pool.js'

export const healthRouter = Router()

healthRouter.get('/', async (_request, response) => {
  const database = await checkDatabase()
  const healthy = database

  response.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    service: 'connectease-api',
    database: database ? 'up' : 'down',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  })
})
