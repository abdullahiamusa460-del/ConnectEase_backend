import { beforeAll, beforeEach } from 'vitest'

function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL
  if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL)
    const database = url.pathname.replace(/^\//, '')
    url.pathname = `/${database.endsWith('_test') ? database : `${database}_test`}`
    return url.toString()
  }
  return 'postgres://connectease:connectease@127.0.0.1:5432/connectease_test'
}

process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = testDatabaseUrl()
process.env.DATABASE_SSL = 'false'
process.env.DATABASE_POOL_MAX = '5'
process.env.INSTALLATION_PEPPER =
  'test-only-installation-pepper-9cc1f61c2cef4a7c9d1e2f3a4b5c6d7e'
process.env.CORS_ORIGINS = 'http://localhost:5173,http://127.0.0.1:5173'
process.env.RATE_LIMIT_MAX = '100000'
process.env.WRITE_RATE_LIMIT_MAX = '100000'
process.env.SYNC_RATE_LIMIT_MAX = '100000'
process.env.REGISTRATION_RATE_LIMIT_MAX = '100000'
process.env.LOG_LEVEL = 'silent'

beforeAll(async () => {
  const { runMigrations } = await import('../src/db/migrate.js')
  const { pool } = await import('../src/db/pool.js')
  await runMigrations(pool)
})

beforeEach(async () => {
  const { pool } = await import('../src/db/pool.js')
  await pool.query(
    'TRUNCATE TABLE sync_batches, workspace_records, reports, network_tests, installations CASCADE',
  )
})
