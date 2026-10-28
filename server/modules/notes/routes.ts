import type { FastifyPluginAsync } from 'fastify';
import { NoteBodyRequest } from '../../../shared/contracts/index.ts';
import { IdParams, parseOrThrow } from '../../core/http/validate.ts';
import type { NotesService } from './service.ts';

export function notesRoutes(service: NotesService): FastifyPluginAsync {
  return async (http) => {
    http.get('/jobs/:id/notes', async (req) => service.listForJob(parseOrThrow(IdParams, req.params).id));

    http.post('/jobs/:id/notes', async (req, reply) => {
      const { id } = parseOrThrow(IdParams, req.params);
      return reply.status(201).send(service.add(id, parseOrThrow(NoteBodyRequest, req.body).body));
    });

    http.patch('/notes/:id', async (req) => {
      const { id } = parseOrThrow(IdParams, req.params);
      return service.update(id, parseOrThrow(NoteBodyRequest, req.body).body);
    });

    http.delete('/notes/:id', async (req, reply) => {
      service.remove(parseOrThrow(IdParams, req.params).id);
      return reply.status(204).send();
    });
  };
}
