import pino from 'pino'
import { env, isTest } from '../config/env.js'

export const logger = pino({
  level: isTest ? 'silent' : env.LOG_LEVEL,
  base: {
    service: 'connectease-api',
    environment: env.NODE_ENV,
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.secret',
      '*.password',
      '*.token',
    ],
    censor: '[redacted]',
  },
})
