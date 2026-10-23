import { pool } from './pool.js'
import { getMigrationStatus, runMigrations } from './migrate.js'

async function main() {
  const command = process.argv[2] ?? 'up'

  if (command === 'status') {
    const status = await getMigrationStatus(pool)
    if (status.length === 0) {
      console.log('No migrations found.')
    } else {
      for (const migration of status) {
        const state = migration.applied
          ? migration.checksumMatches
            ? `applied ${migration.appliedAt}`
            : 'APPLIED BUT CHECKSUM MISMATCH'
          : 'pending'
        console.log(`${migration.name.padEnd(44)} ${state}`)
      }
    }
    return
  }

  if (command !== 'up') {
    throw new Error(`Unknown migration command "${command}". Use "up" or "status".`)
  }

  const applied = await runMigrations(pool)
  if (applied.length === 0) {
    console.log('Database is already up to date.')
  } else {
    console.log(`Applied ${applied.length} migration(s):`)
    for (const name of applied) console.log(`  - ${name}`)
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end()
  })
