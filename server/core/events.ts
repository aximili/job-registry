// The typed event bus. This map is the contract between modules: a module
// sends an event after its change is saved, and others react without
// calling it. Payloads are small (ids plus what changed). Listeners read
// fresh data through services. See docs/architecture.md §5.

import type { AiState, ProfileFileName, StatusSource } from '../../shared/contracts/index.ts';
import type { Logger } from './logger.ts';

export type AppEvents = {
  'job.saved': { jobId: number };
  'job.updated': { jobId: number; fields: string[] };
  'job.statusChanged': { jobId: number; from: string | null; to: string; source: StatusSource };
  'posting.added': { jobId: number; postingId: number };
  'note.added': { jobId: number; noteId: number };
  'note.updated': { jobId: number; noteId: number };
  'note.removed': { jobId: number; noteId: number };
  'contact.saved': { contactId: number; jobIds: number[] };
  'contact.linked': { contactId: number; jobId: number };
  'contact.unlinked': { contactId: number; jobId: number };
  'interaction.logged': { interactionId: number; contactId: number | null; jobId: number | null };
  'settings.changed': { keys: string[] };
  'profile.changed': { name: ProfileFileName };
  'document.saved': { jobId: number; documentId: number };
  'document.sent': { jobId: number; documentId: number };
  'attachment.added': { jobId: number; attachmentId: number };
  'ai.stateChanged': { state: AiState; detail: string | null };
  'enrich.done': { jobId: number; step: 'parse' | 'rate' };
  'enrich.failed': { jobId: number; step: 'parse' | 'rate'; error: string };
  'email.suggestionsAdded': { count: number };
  'email.suggestionHandled': { suggestionId: number; state: 'confirmed' | 'dismissed' };
  'email.checked': { ok: boolean; error: string | null };
};

export type EventName = keyof AppEvents;

export interface EventBus {
  emit<K extends EventName>(name: K, payload: AppEvents[K]): void;
  on<K extends EventName>(name: K, handler: (payload: AppEvents[K]) => void): () => void;
  onAny(handler: (name: EventName, payload: unknown) => void): () => void;
}

export function createEventBus(logger: Logger): EventBus {
  const handlers = new Map<EventName, Set<(payload: unknown) => void>>();
  const anyHandlers = new Set<(name: EventName, payload: unknown) => void>();

  // A failing listener is logged and never breaks the action that sent the event.
  function run(name: EventName, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      logger.error({ err, event: name }, 'An event listener failed');
    }
  }

  return {
    emit(name, payload) {
      for (const handler of [...(handlers.get(name) ?? [])]) run(name, () => handler(payload));
      for (const handler of [...anyHandlers]) run(name, () => handler(name, payload));
    },
    on(name, handler) {
      let set = handlers.get(name);
      if (!set) {
        set = new Set();
        handlers.set(name, set);
      }
      const h = handler as (payload: unknown) => void;
      set.add(h);
      return () => {
        set.delete(h);
      };
    },
    onAny(handler) {
      anyHandlers.add(handler);
      return () => {
        anyHandlers.delete(handler);
      };
    },
  };
}
