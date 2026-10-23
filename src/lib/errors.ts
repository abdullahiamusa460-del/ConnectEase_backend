export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'SERVICE_UNAVAILABLE'

export class AppError extends Error {
  readonly statusCode: number
  readonly code: ErrorCode
  readonly details?: unknown
  readonly expose: boolean

  constructor(options: {
    statusCode: number
    code: ErrorCode
    message: string
    details?: unknown
    cause?: unknown
    expose?: boolean
  }) {
    super(options.message, { cause: options.cause })
    this.name = 'AppError'
    this.statusCode = options.statusCode
    this.code = options.code
    this.details = options.details
    this.expose = options.expose ?? options.statusCode < 500
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError({ statusCode: 400, code: 'BAD_REQUEST', message, details })

export const unauthorized = (message = 'A valid installation token is required.') =>
  new AppError({ statusCode: 401, code: 'UNAUTHORIZED', message })

export const forbidden = (message = 'You do not have access to this resource.') =>
  new AppError({ statusCode: 403, code: 'FORBIDDEN', message })

export const notFound = (message = 'The requested resource was not found.') =>
  new AppError({ statusCode: 404, code: 'NOT_FOUND', message })

export const conflict = (message: string, details?: unknown) =>
  new AppError({ statusCode: 409, code: 'CONFLICT', message, details })
