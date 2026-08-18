// The gate used to have two entry points — plain `pre-pr` and the queued
// wrapper — and remembering the right one per machine was a caller obligation
// that kept being dropped, which put unserialized gates on top of perf runs.
// Now there is only this: on Windows (= the multi-session dev box) every
// `npm run pre-pr` re-enters through the machine-wide mutex wrapper, and
// everywhere else (CI, cloud containers — one session per machine, no
// PowerShell) it runs the chain directly. PREPR_UNDER_MUTEX is set by the
// wrapper so its inner call runs the chain instead of queueing again.
import { spawnSync } from 'node:child_process';

const viaQueue = process.platform === 'win32' && !process.env.PREPR_UNDER_MUTEX;
if (viaQueue) {
  console.log('pre-pr: routing through the machine-wide queue (scripts/preprQueued.ps1)');
}
const r = viaQueue
  ? spawnSync(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/preprQueued.ps1'],
      { stdio: 'inherit' },
    )
  : spawnSync('npm run pre-pr:raw', { stdio: 'inherit', shell: true });
process.exit(r.status ?? 1);
