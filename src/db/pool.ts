import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg'
import { env } from '../config/env.js'
import { logger } from '../lib/logger.js'

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: env.DATABASE_SSL ? { rejectUnauthorized: true } : false,
  application_name: 'connectease-api',
})

pool.on('error', (error) => {
  logger.error({ err: error }, 'Unexpected idle PostgreSQL client error')
})

export function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, values as unknown[])
}

export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch (rollbackError) {
      logger.error({ err: rollbackError }, 'Failed to roll back transaction')
    }
    throw error
  } finally {
    client.release()
  }
}

export async function checkDatabase(): Promise<boolean> {
  try {
    await pool.query('SELECT 1')
    return true
  } catch (error) {
    logger.error({ err: error }, 'Database health check failed')
    return false
  }
}

export async function closePool(): Promise<void> {
  await pool.end()
}
