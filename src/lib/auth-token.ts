import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '../config/env.js'

const TOKEN_PREFIX = 'ce1'
const TOKEN_PATTERN = /^ce1\.([0-9a-fA-F-]{36})\.([A-Za-z0-9_-]{32,128})$/

export function hashInstallationSecret(secret: string): string {
  return createHmac('sha256', env.INSTALLATION_PEPPER).update(secret, 'utf8').digest('hex')
}

export function secretsMatch(secret: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashInstallationSecret(secret), 'hex')
  let stored: Buffer
  try {
    stored = Buffer.from(storedHash, 'hex')
  } catch {
    return false
  }

  if (candidate.length !== stored.length) return false
  return timingSafeEqual(candidate, stored)
}

export interface ParsedToken {
  installationId: string
  secret: string
}

export function parseAuthorizationHeader(header: string | undefined): ParsedToken | null {
  if (!header) return null
  const [scheme, value, ...rest] = header.trim().split(' ')
  if (rest.length > 0 || scheme?.toLowerCase() !== 'bearer' || !value) return null

  const match = TOKEN_PATTERN.exec(value)
  if (!match?.[1] || !match[2]) return null

  return {
    installationId: match[1].toLowerCase(),
    secret: match[2],
  }
}

export function createAuthorizationToken(installationId: string, secret: string): string {
  return `${TOKEN_PREFIX}.${installationId}.${secret}`
}
