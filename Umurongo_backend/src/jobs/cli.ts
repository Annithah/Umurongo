// Run one background job from the command line, e.g. from a hosted cron:
//   npm run job -w @umurongo/api -- retention
//   npm run job -w @umurongo/api -- daily-close
import { prisma } from '../db';
import { JOBS, runJob, type JobName } from './jobs';
import { withJobLock } from './scheduler';

const name = process.argv[2] as JobName | undefined;
if (!name || !(name in JOBS)) {
  console.error(`Usage: job <${Object.keys(JOBS).join('|')}>`);
  process.exit(1);
}

const result = await withJobLock(name, () => runJob(name, () => JOBS[name]()));
if (result === null) console.log(`${name}: another process is running it right now`);
else console.log(`${name}:`, JSON.stringify(result));
await prisma.$disconnect();
process.exit(result && !result.ok ? 1 : 0);
