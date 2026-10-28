import type { HttpModule } from '../../core/http/module.ts';
import { profileRoutes } from './routes.ts';
import { createProfileService, type ProfileFileName, type ProfileOptions, type ProfileService } from './service.ts';

export type { ProfileFileName, ProfileService };

export function createProfileModule(opts: ProfileOptions): HttpModule<ProfileService> {
  const service = createProfileService(opts);
  return { service, routes: profileRoutes(service) };
}
