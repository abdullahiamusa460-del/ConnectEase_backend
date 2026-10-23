import 'dotenv/config'
import { z } from 'zod'

const booleanFromString = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value === '') return defaultValue
      return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
    })

const integerFromString = (options: {
  defaultValue: number
  min: number
  max: number
}) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value === '') return options.defaultValue
      return Number(value)
    })
    .pipe(z.number().int().min(options.min).max(options.max))

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: integerFromString({ defaultValue: 4000, min: 1, max: 65535 }),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .refine((value) => {
      try {
        const url = new URL(value)
        return url.protocol === 'postgres:' || url.protocol === 'postgresql:'
      } catch {
        return false
      }
    }, 'DATABASE_URL must be a postgres:// or postgresql:// connection string'),
  DATABASE_SSL: booleanFromString(false),
  DATABASE_POOL_MAX: integerFromString({ defaultValue: 10, min: 1, max: 50 }),
  CORS_ORIGINS: z
    .string()
    .default(
      'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173',
    )
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  TRUST_PROXY: integerFromString({ defaultValue: 0, min: 0, max: 10 }),
  INSTALLATION_PEPPER: z
    .string()
    .min(32, 'INSTALLATION_PEPPER must be at least 32 characters')
    .refine(
      (value) => !value.toLowerCase().includes('replace-with'),
      'INSTALLATION_PEPPER still contains the example placeholder',
    ),
  RATE_LIMIT_WINDOW_MS: integerFromString({
    defaultValue: 15 * 60 * 1000,
    min: 1000,
    max: 24 * 60 * 60 * 1000,
  }),
  RATE_LIMIT_MAX: integerFromString({ defaultValue: 300, min: 1, max: 1_000_000 }),
  WRITE_RATE_LIMIT_MAX: integerFromString({ defaultValue: 120, min: 1, max: 1_000_000 }),
  SYNC_RATE_LIMIT_MAX: integerFromString({ defaultValue: 60, min: 1, max: 1_000_000 }),
  REGISTRATION_RATE_LIMIT_MAX: integerFromString({
    defaultValue: 20,
    min: 1,
    max: 1_000_000,
  }),
})

export type AppEnv = z.infer<typeof envSchema>

function loadEnv(): AppEnv {
  const result = envSchema.safeParse(process.env)

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || 'environment'}: ${issue.message}`)
      .join('\n')
    throw new Error(`Invalid environment configuration:\n${issues}`)
  }

  return result.data
}

export const env = loadEnv()

export const isProduction = env.NODE_ENV === 'production'
export const isTest = env.NODE_ENV === 'test'
