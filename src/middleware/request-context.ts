import { randomUUID } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'

export function requestContext(request: Request, response: Response, next: NextFunction) {
  const incoming = request.header('x-request-id')
  const requestId =
    incoming && /^[A-Za-z0-9._:-]{1,100}$/.test(incoming) ? incoming : randomUUID()

  response.locals.requestId = requestId
  response.setHeader('x-request-id', requestId)
  next()
}
