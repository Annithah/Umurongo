// Starts or stops the private PostgreSQL cluster used for local development on Windows.
// The cluster lives in %LOCALAPPDATA%\umurongo-pg (outside OneDrive) and listens on port 5433.
// Usage: node scripts/pg-local.mjs start|stop|status
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const action = process.argv[2] ?? 'status';
const base = join(process.env.LOCALAPPDATA ?? '', 'umurongo-pg');
const data = join(base, 'data');
const candidates = ["18", "17", "16"].map((v) => `C:/Program Files/PostgreSQL/${v}/bin/pg_ctl.exe`);
const pgCtl = process.env.PG_CTL ?? candidates.find((p) => existsSync(p));

if (!pgCtl || !existsSync(base)) {
  console.error('Local cluster not found. See README, "Local database on Windows".');
  process.exit(1);
}
const args = { start: ['-o', '-p 5433', '-l', join(base, 'postgres.log'), '-w', 'start'], stop: ['-m', 'fast', 'stop'], status: ['status'] }[action];
if (!args) {
  console.error('Use start, stop or status');
  process.exit(1);
}
if (action === 'start' && spawnSync(pgCtl, ['-D', data, 'status']).status === 0) {
  console.log('Local PostgreSQL is already running on port 5433.');
  process.exit(0);
}
const r = spawnSync(pgCtl, ['-D', data, ...args], { stdio: 'inherit' });
process.exit(action === 'status' ? 0 : (r.status ?? 1));
