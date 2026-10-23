import cors from 'cors'
import type { CorsOptions } from 'cors'
import { env } from '../config/env.js'
import { AppError } from '../lib/errors.js'

const allowedOrigins = new Set(env.CORS_ORIGINS)
const allowAllOrigins = allowedOrigins.has('*')

export const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (!origin || allowAllOrigins || allowedOrigins.has(origin)) {
      callback(null, true)
      return
    }
    callback(
      new AppError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'This browser origin is not allowed to call the API.',
      }),
    )
  },
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
  exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy'],
  maxAge: 600,
}

export const corsMiddleware = cors(corsOptions)
