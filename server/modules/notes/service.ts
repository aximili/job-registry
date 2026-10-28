import type { Note } from '../../../shared/contracts/index.ts';
import type { Clock } from '../../core/config.ts';
import { NotFoundError, ValidationError } from '../../core/errors.ts';
import type { EventBus } from '../../core/events.ts';
import type { NotesRepo } from './repo.ts';

export interface NotesService {
  add(jobId: number, body: string): Note;
  update(id: number, body: string): Note;
  remove(id: number): void;
  listForJob(jobId: number): Note[];
}

function cleanBody(body: string): string {
  const text = body.trim();
  if (!text) throw new ValidationError("A note can't be empty.");
  return text;
}

export function createNotesService(opts: { repo: NotesRepo; bus: EventBus; now: Clock }): NotesService {
  const { repo, bus } = opts;

  function getOrThrow(id: number): Note {
    const note = repo.get(id);
    if (!note) throw new NotFoundError(`Note ${id} not found`);
    return note;
  }

  return {
    add(jobId, body) {
      const note = repo.insert(jobId, cleanBody(body), opts.now().toISOString());
      bus.emit('note.added', { jobId, noteId: note.id });
      return note;
    },

    update(id, body) {
      const note = getOrThrow(id);
      repo.update(id, cleanBody(body), opts.now().toISOString());
      bus.emit('note.updated', { jobId: note.jobId, noteId: id });
      return getOrThrow(id);
    },

    remove(id) {
      const note = getOrThrow(id);
      repo.remove(id);
      bus.emit('note.removed', { jobId: note.jobId, noteId: id });
    },

    listForJob: (jobId) => repo.listForJob(jobId),
  };
}
