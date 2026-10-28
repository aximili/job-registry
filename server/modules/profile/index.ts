import type { HttpModule } from '../../core/http/module.ts';
import { createProfileService, type ProfileName, type ProfileService } from './service.ts';

export type { ProfileName, ProfileService };

export function createProfileModule(opts: { dir: string }): HttpModule<ProfileService> {
  // No routes yet: Phase 4 adds the profile and template editors.
  return { service: createProfileService(opts), routes: async () => {} };
}
