import { createServer } from 'node:http';
import { env } from './env';
import { createApp } from './app';
import { prisma } from './db';
import { attachRealtime } from './realtime';
import { startScheduler, stopScheduler } from './jobs/scheduler';

const app = createApp();
const server = createServer(app);
attachRealtime(server);

server.listen(env.PORT, () => {
  console.log(`Umurongo API listening on http://localhost:${env.PORT}/api/health (SMS: ${env.SMS_MODE})`);
  if (env.JOBS_ENABLED) startScheduler();
});

async function shutdown(signal: string) {
  console.log(`${signal}: shutting down`);
  stopScheduler();
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
