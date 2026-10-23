import type { NextFunction, Request, Response } from 'express'
import { query } from '../db/pool.js'
import { parseAuthorizationHeader, secretsMatch } from '../lib/auth-token.js'
import { unauthorized } from '../lib/errors.js'
import { logger } from '../lib/logger.js'

interface InstallationRow {
  id: string
  secret_hash: string
}

export async function requireInstallation(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  try {
    const token = parseAuthorizationHeader(request.header('authorization'))
    if (!token) {
      throw unauthorized('Send a Bearer installation token. Register once to receive credentials.')
    }

    const result = await query<InstallationRow>(
      'SELECT id, secret_hash FROM installations WHERE id = $1',
      [token.installationId],
    )
    const installation = result.rows[0]

    if (!installation || !secretsMatch(token.secret, installation.secret_hash)) {
      throw unauthorized('The installation token is not valid.')
    }

    response.locals.installationId = installation.id
    void query('UPDATE installations SET last_seen_at = now() WHERE id = $1', [
      installation.id,
    ]).catch((error: unknown) => {
      logger.warn({ err: error }, 'Could not update installation last_seen_at')
    })

    next()
  } catch (error) {
    next(error)
  }
}

export function installationId(response: Response): string {
  const value = response.locals.installationId
  if (typeof value !== 'string') {
    throw unauthorized()
  }
  return value
}
