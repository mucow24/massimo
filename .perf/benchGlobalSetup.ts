import { acquireGateMutex, releaseGateMutex } from './gateMutex';
import { assertUncontended } from './contention';
import { readPowerMode } from './powerMode';

/**
 * Vitest globalSetup for the node bench harnesses: the same
 * serialize-then-verify contract as the playwright configs' perfGlobalSetup —
 * take the machine mutex, prove the machine is quiet, stamp the power mode
 * (no browser here, so no GPU stamp), and re-check on the way out.
 */
export default async function setup(): Promise<() => void> {
  await acquireGateMutex('bench');
  assertUncontended('start');
  console.log(`[perf] Lenovo power mode: ${readPowerMode()}\n`);
  return () => {
    try {
      assertUncontended('end');
    } finally {
      releaseGateMutex();
    }
  };
}
