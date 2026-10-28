import { expect, it } from 'vitest';
import { describeListenError } from './listen-error.ts';

it('describeListenError explains a busy port', () => {
  const err = Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' });
  expect(describeListenError(err, 4777)).toBe(
    'Port 4777 is already in use. Job Registry may already be running: open http://127.0.0.1:4777/',
  );
});

it('describeListenError passes other errors through', () => {
  const err = Object.assign(new Error('permission denied'), { code: 'EACCES' });
  expect(describeListenError(err, 4777)).toBe("Job Registry couldn't start on port 4777: permission denied");
});
