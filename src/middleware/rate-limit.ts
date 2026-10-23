import { rateLimit } from 'express-rate-limit'
import type { Request, Response } from 'express'
import { env } from '../config/env.js'

function rateLimitHandler(message: string) {
  return (_request: Request, response: Response) => {
    response.status(429).json({
      error: {
        code: 'RATE_LIMITED',
        message,
        requestId: response.locals.requestId ?? null,
      },
    })
  }
}

export function createLimiter(options: {
  windowMs: number
  limit: number
  message: string
}) {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: rateLimitHandler(options.message),
  })
}

export const globalLimiter = createLimiter({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  message: 'Too many requests from this address. Please try again later.',
})

export const registrationLimiter = createLimiter({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.REGISTRATION_RATE_LIMIT_MAX,
  message: 'Too many registration attempts. Please try again later.',
})

export const writeLimiter = createLimiter({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.WRITE_RATE_LIMIT_MAX,
  message: 'Too many write requests. Please slow down and try again later.',
})

export const syncLimiter = createLimiter({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.SYNC_RATE_LIMIT_MAX,
  message: 'Too many sync attempts. Please wait before retrying.',
})
