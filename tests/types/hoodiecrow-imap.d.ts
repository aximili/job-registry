// Just enough of hoodiecrow-imap (a scriptable IMAP server for tests) for
// the IMAP adapter's tests. The package ships no types.
declare module 'hoodiecrow-imap' {
  import type { Server } from 'node:net';

  type StoredMessage = { raw: string; internaldate?: string; flags?: string[] };
  type Options = {
    plugins?: string[];
    storage?: Record<string, { uidvalidity?: number; messages?: StoredMessage[] }>;
  };
  export default function hoodiecrow(options?: Options): Server & { server?: Server };
}
