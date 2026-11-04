// All SQL for the briefs and prep_plans tables. A brief's parts and a plan's
// are kept as JSON, checked with zod when written and when read: a row that
// doesn't pass throws, except in the job's list of plans, which leaves it out.

import { Brief, BriefBody, PrepBody, PrepPlan } from '../../../shared/contracts/index.ts';
import { isConstraintError, type Db } from '../../core/db/db.ts';
import { NotFoundError } from '../../core/errors.ts';

type BriefRow = {
  id: number;
  job_id: number;
  brief_json: string;
  made_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
};

const toBrief = (r: BriefRow): Brief =>
  Brief.parse({
    ...(JSON.parse(r.brief_json) as object),
    id: r.id,
    jobId: r.job_id,
    by: r.made_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    approvedAt: r.approved_at,
  });

const asJson = (body: BriefBody): string => JSON.stringify(BriefBody.parse(body));

type PlanRow = {
  id: number;
  job_id: number;
  plan_json: string;
  made_by: string | null;
  created_at: string;
};

const toPlan = (r: PlanRow): PrepPlan =>
  PrepPlan.parse({ ...(JSON.parse(r.plan_json) as object), id: r.id, jobId: r.job_id, by: r.made_by, createdAt: r.created_at });

function inserted(jobId: number, insert: () => number): number {
  try {
    return insert();
  } catch (err) {
    if (isConstraintError(err, 'FOREIGNKEY')) throw new NotFoundError(`Job ${jobId} not found`);
    throw err;
  }
}

export function createPrepRepo(db: Db) {
  return {
    insertBrief(jobId: number, body: BriefBody, by: string, at: string): Brief {
      const id = inserted(jobId, () =>
        Number(
          db
            .prepare('INSERT INTO briefs (job_id, brief_json, made_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
            .run(jobId, asJson(body), by, at, at).lastInsertRowid,
        ),
      );
      return this.getBrief(id)!;
    },

    getBrief(id: number): Brief | undefined {
      const row = db.prepare('SELECT * FROM briefs WHERE id = ?').get(id) as BriefRow | undefined;
      return row ? toBrief(row) : undefined;
    },

    // The job's brief: its newest.
    newestBrief(jobId: number): Brief | undefined {
      const row = db.prepare('SELECT * FROM briefs WHERE job_id = ? ORDER BY id DESC LIMIT 1').get(jobId) as BriefRow | undefined;
      return row ? toBrief(row) : undefined;
    },

    updateBrief(id: number, body: BriefBody, at: string): void {
      db.prepare('UPDATE briefs SET brief_json = ?, updated_at = ? WHERE id = ?').run(asJson(body), at, id);
    },

    approveBrief(id: number, at: string): void {
      db.prepare('UPDATE briefs SET approved_at = ? WHERE id = ?').run(at, id);
    },

    insertPlan(jobId: number, body: PrepBody, by: string, at: string): PrepPlan {
      const id = inserted(jobId, () =>
        Number(
          db
            .prepare('INSERT INTO prep_plans (job_id, plan_json, made_by, created_at) VALUES (?, ?, ?, ?)')
            .run(jobId, JSON.stringify(PrepBody.parse(body)), by, at).lastInsertRowid,
        ),
      );
      return toPlan(db.prepare('SELECT * FROM prep_plans WHERE id = ?').get(id) as PlanRow);
    },

    // The job's plans, newest first: the one made last, as for briefs, even
    // if the computer's clock went back. One whose JSON is broken or doesn't
    // fit (all that reading a row can throw) is left out, and passed to skipped.
    plans(jobId: number, skipped: (id: number, err: unknown) => void): PrepPlan[] {
      const rows = db.prepare('SELECT * FROM prep_plans WHERE job_id = ? ORDER BY id DESC').all(jobId) as PlanRow[];
      return rows.flatMap((row) => {
        try {
          return [toPlan(row)];
        } catch (err) {
          skipped(row.id, err);
          return [];
        }
      });
    },
  };
}

export type PrepRepo = ReturnType<typeof createPrepRepo>;
