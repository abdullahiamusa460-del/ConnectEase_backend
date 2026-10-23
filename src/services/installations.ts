import { createHash } from 'node:crypto'
import type { RegisterInstallationInput } from '../schemas/installations.js'
import { hashInstallationSecret, secretsMatch } from '../lib/auth-token.js'
import { conflict } from '../lib/errors.js'
import { query } from '../db/pool.js'

export interface InstallationRegistration {
  installationId: string
  registeredAt: string
  created: boolean
}

export async function registerInstallation(
  input: RegisterInstallationInput,
): Promise<InstallationRegistration> {
  const secretHash = hashInstallationSecret(input.secret)

  const inserted = await query<{ id: string; created_at: Date }>(
    `INSERT INTO installations (id, secret_hash)
     VALUES ($1, $2)
     ON CONFLICT (id) DO NOTHING
     RETURNING id, created_at`,
    [input.installationId, secretHash],
  )

  if (inserted.rows[0]) {
    return {
      installationId: inserted.rows[0].id,
      registeredAt: inserted.rows[0].created_at.toISOString(),
      created: true,
    }
  }

  const existing = await query<{ id: string; secret_hash: string; created_at: Date }>(
    'SELECT id, secret_hash, created_at FROM installations WHERE id = $1',
    [input.installationId],
  )
  const installation = existing.rows[0]

  if (!installation) {
    throw conflict('Installation registration could not be completed. Please retry.')
  }

  if (!secretsMatch(input.secret, installation.secret_hash)) {
    throw conflict(
      'That installation id is already registered with different credentials. ' +
        'Restore the original credentials or register a new installation.',
    )
  }

  return {
    installationId: installation.id,
    registeredAt: installation.created_at.toISOString(),
    created: false,
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isValidUuid(value: string): boolean {
  return UUID_PATTERN.test(value)
}

export function hashRequest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([first], [second]) => first.localeCompare(second))

  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`
}
