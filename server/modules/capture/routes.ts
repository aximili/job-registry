import type { FastifyPluginAsync } from 'fastify';
import { CapturePreviewRequest } from '../../../shared/contracts/index.ts';
import { parseOrThrow } from '../../core/http/validate.ts';
import type { CaptureService } from './service.ts';

export function captureRoutes(service: CaptureService): FastifyPluginAsync {
  return async (http) => {
    http.post('/captures/preview', async (req) => {
      const body = parseOrThrow(CapturePreviewRequest, req.body);
      if ('url' in body) return service.fromUrl(body.url);
      return { capture: service.fromText(body.text), warning: null };
    });
  };
}
