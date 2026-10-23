import { Router } from 'express'
import { validate, validated } from '../middleware/validate.js'
import { registrationLimiter } from '../middleware/rate-limit.js'
import { registerInstallationSchema, type RegisterInstallationInput } from '../schemas/installations.js'
import { registerInstallation } from '../services/installations.js'

export const installationsRouter = Router()

installationsRouter.post(
  '/register',
  registrationLimiter,
  validate({ body: registerInstallationSchema }),
  async (_request, response) => {
    const input = validated<RegisterInstallationInput>(response, 'body')
    const registration = await registerInstallation(input)

    response.setHeader('Cache-Control', 'no-store')
    response.status(registration.created ? 201 : 200).json({
      installationId: registration.installationId,
      registeredAt: registration.registeredAt,
    })
  },
)
