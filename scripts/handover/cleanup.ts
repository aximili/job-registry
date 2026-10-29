// Handover fix F2: ends anything left running on the test ports (the test
// copy's app, its llama-server, the browser tests' servers). It never touches
// the real app (port 4777) or the Bonsai 2 you run on (port 8080).
//
//   node scripts\handover\cleanup.ts

import { createReport, killPortListeners, portAnswers, sleep, testPort } from './lib.ts';

const report = createReport('cleanup');
const ports = [testPort(), 8081, 4798, 4799];
for (const port of killPortListeners(ports)) report.info(`ended what was running on port ${port}`);
await sleep(2_000);
const still: number[] = [];
for (const port of ports) if (await portAnswers(port)) still.push(port);
if (still.length === 0) report.pass('the test ports are free', ports.join(', '));
else report.fail('the test ports are free', `still in use: ${still.join(', ')}`);
process.exit(report.finish());
