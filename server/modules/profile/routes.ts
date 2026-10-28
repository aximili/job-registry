import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ProfileFileName, PutProfileRequest } from '../../../shared/contracts/index.ts';
import { NotFoundError } from '../../core/errors.ts';
import { dashboardOnly } from '../../core/http/security.ts';
import { parseOrThrow } from '../../core/http/validate.ts';
import type { ProfileService } from './service.ts';

const NameParams = z.object({ name: z.string() });

function nameOf(params: unknown): ProfileFileName {
  const { name } = parseOrThrow(NameParams, params);
  const parsed = ProfileFileName.safeParse(name);
  if (!parsed.success) throw new NotFoundError(`There's no profile file called ${name}.`);
  return parsed.data;
}

export function profileRoutes(service: ProfileService): FastifyPluginAsync {
  return async (http) => {
    http.get('/profile/:name', async (req) => service.file(nameOf(req.params)));
    // Your profile is what the AI writes from and is sent with every rating,
    // so no installed extension may change it.
    http.put('/profile/:name', { config: dashboardOnly('Only the dashboard can change your profile and templates.') }, async (req) =>
      service.write(nameOf(req.params), parseOrThrow(PutProfileRequest, req.body).text),
    );
  };
}
