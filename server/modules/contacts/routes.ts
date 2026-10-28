import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  CreateContactRequest,
  LinkContactRequest,
  LogInteractionRequest,
  UpdateContactRequest,
} from '../../../shared/contracts/index.ts';
import { IdParams, parseOrThrow } from '../../core/http/validate.ts';
import type { ContactsService } from './service.ts';

const ListQuery = z.object({ q: z.string().max(200).optional() });
const LinkParams = z.object({ id: z.coerce.number().int().positive(), contactId: z.coerce.number().int().positive() });

export function contactsRoutes(service: ContactsService): FastifyPluginAsync {
  return async (http) => {
    http.get('/contacts', async (req) => service.list(parseOrThrow(ListQuery, req.query).q));

    http.post('/contacts', async (req, reply) =>
      reply.status(201).send(service.create(parseOrThrow(CreateContactRequest, req.body))),
    );

    http.patch('/contacts/:id', async (req) => {
      const { id } = parseOrThrow(IdParams, req.params);
      return service.update(id, parseOrThrow(UpdateContactRequest, req.body));
    });

    http.post('/jobs/:id/contacts', async (req) => {
      const { id } = parseOrThrow(IdParams, req.params);
      return service.linkToJob(id, parseOrThrow(LinkContactRequest, req.body));
    });

    http.delete('/jobs/:id/contacts/:contactId', async (req, reply) => {
      const { id, contactId } = parseOrThrow(LinkParams, req.params);
      service.unlink(id, contactId);
      return reply.status(204).send();
    });

    http.post('/interactions', async (req, reply) =>
      reply.status(201).send(service.logInteraction(parseOrThrow(LogInteractionRequest, req.body))),
    );

    http.get('/jobs/:id/interactions', async (req) =>
      service.listInteractionsForJob(parseOrThrow(IdParams, req.params).id),
    );
  };
}
