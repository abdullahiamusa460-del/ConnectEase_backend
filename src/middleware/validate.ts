import type { NextFunction, Request, Response } from 'express'
import { ZodError, type ZodType } from 'zod'
import { AppError } from '../lib/errors.js'

type Source = 'body' | 'query' | 'params'

interface ValidationSchemas {
  body?: ZodType
  query?: ZodType
  params?: ZodType
}

export function validate(schemas: ValidationSchemas) {
  return (request: Request, response: Response, next: NextFunction) => {
    try {
      if (schemas.body) response.locals.body = schemas.body.parse(request.body)
      if (schemas.query) response.locals.query = schemas.query.parse(request.query)
      if (schemas.params) response.locals.params = schemas.params.parse(request.params)
      next()
    } catch (error) {
      next(error)
    }
  }
}

export function validated<T>(response: Response, source: Source): T {
  return response.locals[source] as T
}

export function formatZodIssues(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
    code: issue.code,
  }))
}

export function zodErrorToAppError(error: ZodError) {
  return new AppError({
    statusCode: 400,
    code: 'VALIDATION_ERROR',
    message: 'One or more fields are invalid.',
    details: formatZodIssues(error),
  })
}
