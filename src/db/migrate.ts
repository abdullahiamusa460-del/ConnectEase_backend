import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Pool } from 'pg'

const MIGRATIONS_DIRECTORY = fileURLToPath(new URL('../../migrations/', import.meta.url))
const MIGRATION_LOCK_ID = 812_004_221

interface MigrationFile {
  name: string
  sql: string
  checksum: string
}

async function loadMigrations(): Promise<MigrationFile[]> {
  const entries = await readdir(MIGRATIONS_DIRECTORY, { withFileTypes: true })
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort((first, second) => first.localeCompare(second))

  return Promise.all(
    files.map(async (name) => {
      const sql = await readFile(`${MIGRATIONS_DIRECTORY}/${name}`, 'utf8')
      return {
        name,
        sql,
        checksum: createHash('sha256').update(sql).digest('hex'),
      }
    }),
  )
}

async function ensureMigrationsTable(target: {
  query: (sql: string) => Promise<unknown>
}): Promise<void> {
  await target.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)
}

export interface MigrationStatus {
  name: string
  applied: boolean
  appliedAt: string | null
  checksumMatches: boolean
}

export async function getMigrationStatus(pool: Pool): Promise<MigrationStatus[]> {
  await ensureMigrationsTable(pool)
  const migrations = await loadMigrations()
  const applied = await pool.query<{
    name: string
    checksum: string
    applied_at: Date
  }>('SELECT name, checksum, applied_at FROM schema_migrations')

  const appliedByName = new Map(applied.rows.map((row) => [row.name, row]))

  return migrations.map((migration) => {
    const row = appliedByName.get(migration.name)
    return {
      name: migration.name,
      applied: Boolean(row),
      appliedAt: row ? row.applied_at.toISOString() : null,
      checksumMatches: row ? row.checksum === migration.checksum : false,
    }
  })
}

export async function runMigrations(pool: Pool): Promise<string[]> {
  const migrations = await loadMigrations()
  const client = await pool.connect()
  const appliedNow: string[] = []

  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID])
    await ensureMigrationsTable(client)

    const applied = await client.query<{ name: string; checksum: string }>(
      'SELECT name, checksum FROM schema_migrations',
    )
    const appliedByName = new Map(applied.rows.map((row) => [row.name, row.checksum]))

    for (const migration of migrations) {
      const previousChecksum = appliedByName.get(migration.name)

      if (previousChecksum) {
        if (previousChecksum !== migration.checksum) {
          throw new Error(
            `Migration ${migration.name} was modified after it was applied. ` +
              'Create a new migration instead of editing an applied one.',
          )
        }
        continue
      }

      await client.query('BEGIN')
      try {
        await client.query(migration.sql)
        await client.query(
          'INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)',
          [migration.name, migration.checksum],
        )
        await client.query('COMMIT')
        appliedNow.push(migration.name)
      } catch (error) {
        await client.query('ROLLBACK')
        throw new Error(`Migration ${migration.name} failed: ${(error as Error).message}`, {
          cause: error,
        })
      }
    }
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID])
    } finally {
      client.release()
    }
  }

  return appliedNow
}
