import type { FastifyPluginAsync } from 'fastify';
import { BriefEdits, type BriefLine, type PrepLine } from '../../../shared/contracts/index.ts';
import { dashboardOnly } from '../../core/http/security.ts';
import { sendLines } from '../../core/http/lines.ts';
import { IdParams, parseOrThrow } from '../../core/http/validate.ts';
import type { PrepService } from './service.ts';

// Making a brief or a plan uses the writing AI, which may cost money, and
// your answers become facts in your profile. So only the dashboard may do
// any of them.
const BRIEF_WRITES = { config: dashboardOnly('Only the dashboard can make or change a brief.') };
const PROFILE_WRITES = { config: dashboardOnly('Only the dashboard can add answers to your profile.') };
const PLAN_WRITES = { config: dashboardOnly('Only the dashboard can make a prep plan.') };

// heartbeatMs: how often a quiet reply says it's still there (tests make it short).
export function prepRoutes(service: PrepService, o: { heartbeatMs?: number } = {}): FastifyPluginAsync {
  return async (http) => {
    http.get('/jobs/:id/brief', async (req) => ({ brief: service.brief(parseOrThrow(IdParams, req.params).id) }));

    http.post('/jobs/:id/brief', BRIEF_WRITES, async (req, reply) => {
      const { id } = parseOrThrow(IdParams, req.params);
      return sendLines<BriefLine>(req, reply, (signal, onLine) => service.makeBrief(id, { signal, onLine }), {
        failed: 'Something went wrong while making the brief. See the log for details.',
        what: 'Making a brief failed',
        replaced: 'A newer brief for this job took its place.',
        heartbeatMs: o.heartbeatMs,
      });
    });

    http.patch('/briefs/:id', BRIEF_WRITES, async (req) =>
      service.editBrief(parseOrThrow(IdParams, req.params).id, parseOrThrow(BriefEdits, req.body)),
    );

    http.post('/briefs/:id/answers-to-profile', PROFILE_WRITES, async (req) =>
      service.addAnswersToProfile(parseOrThrow(IdParams, req.params).id),
    );

    http.get('/jobs/:id/prep', async (req) => ({ plans: service.plans(parseOrThrow(IdParams, req.params).id) }));

    http.post('/jobs/:id/prep', PLAN_WRITES, async (req, reply) => {
      const { id } = parseOrThrow(IdParams, req.params);
      return sendLines<PrepLine>(req, reply, (signal, onLine) => service.makePlan(id, { signal, onLine }), {
        failed: 'Something went wrong while making the prep plan. See the log for details.',
        what: 'Making a prep plan failed',
        replaced: 'A newer plan for this job took its place.',
        heartbeatMs: o.heartbeatMs,
      });
    });
  };
}
