import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { GuideName, ProfileFileName, PutProfileRequest, StarterActionRequest } from '../../../shared/contracts/index.ts';
import { NotFoundError } from '../../core/errors.ts';
import { dashboardOnly } from '../../core/http/security.ts';
import { parseOrThrow } from '../../core/http/validate.ts';
import type { ProfileService } from './service.ts';

const NameParams = z.object({ name: z.string() });
const DASHBOARD_ONLY = dashboardOnly('Only the dashboard can change your profile and templates.');

function nameOf(params: unknown): ProfileFileName {
  const { name } = parseOrThrow(NameParams, params);
  const parsed = ProfileFileName.safeParse(name);
  if (!parsed.success) throw new NotFoundError(`There's no profile file called ${name}.`);
  return parsed.data;
}

function guideOf(params: unknown): GuideName {
  const { name } = parseOrThrow(NameParams, params);
  const parsed = GuideName.safeParse(name);
  if (!parsed.success) throw new NotFoundError(`There's no starter guide called ${name}.`);
  return parsed.data;
}

export function profileRoutes(service: ProfileService): FastifyPluginAsync {
  return async (http) => {
    // Fastify takes a fixed path before /profile/:name, so this is never read as a file called "starters".
    http.get('/profile/starters', async () => service.starters());
    http.get('/profile/:name', async (req) => service.file(nameOf(req.params)));
    // Your profile is what the AI writes from and is sent with every rating,
    // so no installed extension may change it.
    http.put('/profile/:name', { config: DASHBOARD_ONLY }, async (req) => {
      const name = nameOf(req.params);
      const { text, updatedAt } = parseOrThrow(PutProfileRequest, req.body);
      return service.write(name, text, { updatedAt });
    });
    // Use the new starter guide (your old one is kept), or keep yours.
    http.post('/profile/:name/starter', { config: DASHBOARD_ONLY }, async (req) => {
      const name = guideOf(req.params);
      const { action } = parseOrThrow(StarterActionRequest, req.body);
      return action === 'use' ? service.useStarter(name) : service.keepStarter(name);
    });
  };
}
