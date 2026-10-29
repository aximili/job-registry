import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  AddPostingRequest,
  ChangeStatusRequest,
  JobCheckRequest,
  ListJobsQuery,
  SaveJobRequest,
  SetFollowUpRequest,
  UpdateJobRequest,
} from '../../../shared/contracts/index.ts';
import { IdParams, parseOrThrow } from '../../core/http/validate.ts';
import type { JobsService } from './service.ts';

const LookupQuery = z.object({ url: z.string().min(1) });

export function jobsRoutes(service: JobsService): FastifyPluginAsync {
  return async (http) => {
    http.post('/jobs/check', async (req) => service.check(parseOrThrow(JobCheckRequest, req.body)));

    http.post('/jobs/:id/postings', async (req) => {
      const { id } = parseOrThrow(IdParams, req.params);
      return service.addPosting(id, parseOrThrow(AddPostingRequest, req.body).capture);
    });

    http.get('/postings/lookup', async (req) => service.lookupByUrl(parseOrThrow(LookupQuery, req.query).url));

    http.post('/jobs', async (req, reply) => {
      const result = service.save(parseOrThrow(SaveJobRequest, req.body));
      return reply.status(result.result === 'created' ? 201 : 200).send(result);
    });

    http.get('/jobs', async (req) => service.list(parseOrThrow(ListJobsQuery, req.query)));

    http.get('/jobs/follow-ups', async () => service.listFollowUps());

    http.get('/jobs/:id', async (req) => service.get(parseOrThrow(IdParams, req.params).id));

    http.put('/jobs/:id/follow-up', async (req) => {
      const { id } = parseOrThrow(IdParams, req.params);
      return service.setFollowUp(id, parseOrThrow(SetFollowUpRequest, req.body));
    });

    http.patch('/jobs/:id', async (req) => {
      const { id } = parseOrThrow(IdParams, req.params);
      return service.update(id, parseOrThrow(UpdateJobRequest, req.body));
    });

    http.post('/jobs/:id/status', async (req) => {
      const { id } = parseOrThrow(IdParams, req.params);
      return service.changeStatus(id, parseOrThrow(ChangeStatusRequest, req.body).status, 'manual');
    });
  };
}
