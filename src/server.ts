import { createServer } from 'node:http'
import { app } from './app.js'
import { env } from './config/env.js'
import { checkDatabase, closePool } from './db/pool.js'
import { logger } from './lib/logger.js'

async function main() {
  const databaseUp = await checkDatabase()
  if (!databaseUp) {
    logger.error('Database is unavailable. Run "npm run migrate" and check DATABASE_URL.')
    process.exitCode = 1
    await closePool()
    return
  }

  const server = createServer(app)

  server.listen(env.PORT, () => {
    logger.info(
      {
        port: env.PORT,
        environment: env.NODE_ENV,
        cors: env.CORS_ORIGINS,
      },
      'ConnectEase API listening',
    )
  })

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down ConnectEase API')
    const forceExit = setTimeout(() => {
      logger.error('Graceful shutdown timed out')
      process.exit(1)
    }, 10_000)
    forceExit.unref()

    server.close((error) => {
      if (error) logger.error({ err: error }, 'HTTP server close failed')
      closePool()
        .catch((poolError: unknown) => {
          logger.error({ err: poolError }, 'PostgreSQL pool close failed')
        })
        .finally(() => {
          clearTimeout(forceExit)
          process.exit(error ? 1 : 0)
        })
    })
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection')
})

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Failed to start ConnectEase API')
  process.exitCode = 1
})
