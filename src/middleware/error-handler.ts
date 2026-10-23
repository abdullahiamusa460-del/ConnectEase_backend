import type { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'
import { AppError } from '../lib/errors.js'
import { logger } from '../lib/logger.js'
import { zodErrorToAppError } from '../middleware/validate.js'

interface PostgresError {
  code?: string
  constraint?: string
  detail?: string
}

export function notFoundHandler(request: Request, response: Response) {
  response.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route ${request.method} ${request.path} was not found.`,
      requestId: response.locals.requestId ?? null,
    },
  })
}

export function errorHandler(
  error: unknown,
  request: Request,
  response: Response,
  next: NextFunction,
) {
  if (response.headersSent) {
    next(error)
    return
  }

  const requestId = response.locals.requestId ?? null
  let appError: AppError

  if (error instanceof AppError) {
    appError = error
  } else if (error instanceof ZodError) {
    appError = zodErrorToAppError(error)
  } else if (isBodyParserError(error)) {
    appError = new AppError({
      statusCode: (error as { status?: number }).status ?? 400,
      code: 'BAD_REQUEST',
      message:
        (error as { type?: string }).type === 'entity.too.large'
          ? 'Request body is too large.'
          : 'Request body is not valid JSON.',
    })
  } else if (isPostgresError(error)) {
    if (error.code === '23505') {
      appError = new AppError({
        statusCode: 409,
        code: 'CONFLICT',
        message: 'That resource already exists.',
      })
    } else if (error.code === '23514' || error.code === '23503' || error.code === '22P02') {
      appError = new AppError({
        statusCode: 400,
        code: 'BAD_REQUEST',
        message: 'The request did not satisfy a database constraint.',
      })
    } else {
      appError = new AppError({
        statusCode: 500,
        code: 'INTERNAL_ERROR',
        message: 'An unexpected database error occurred.',
        cause: error,
      })
    }
  } else {
    appError = new AppError({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      cause: error,
    })
  }

  if (appError.statusCode >= 500) {
    logger.error(
      {
        err: error,
        requestId,
        method: request.method,
        path: request.originalUrl,
      },
      'Unhandled request error',
    )
  } else if (appError.statusCode !== 401 && appError.statusCode !== 403) {
    logger.warn(
      {
        code: appError.code,
        requestId,
        method: request.method,
        path: request.originalUrl,
      },
      appError.message,
    )
  }

  const body: {
    error: {
      code: string
      message: string
      requestId: string | null
      details?: unknown
    }
  } = {
    error: {
      code: appError.code,
      message:
        appError.statusCode >= 500 && !appError.expose
          ? 'An unexpected error occurred.'
          : appError.message,
      requestId,
    },
  }

  if (appError.details !== undefined && appError.expose) {
    body.error.details = appError.details
  }

  response.status(appError.statusCode).json(body)
}

function isBodyParserError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    ((error as { type?: string }).type === 'entity.parse.failed' ||
      (error as { type?: string }).type === 'entity.too.large' ||
      (error as { status?: number }).status === 400)
  )
}

function isPostgresError(error: unknown): error is PostgresError {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as PostgresError).code === 'string' &&
    /^[0-9A-Z]{5}$/.test((error as PostgresError).code as string)
  )
}
