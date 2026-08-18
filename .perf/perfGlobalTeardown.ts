import { releaseGateMutex } from './gateMutex';
import { assertUncontended } from './contention';

/**
 * The other endpoint of the contention check that perfGlobalSetup opened. A
 * full pre-pr (5-7min) outlives any harness run (1-2min), so anything that
 * bypassed the mutex and overlapped this run is still visible at one of the
 * two endpoints; failing here retroactively marks the just-printed tables as
 * contended rather than letting them be read as clean. The mutex is released
 * either way — a failed run must not keep the machine.
 */
export default function globalTeardown(): void {
  try {
    assertUncontended('end');
  } finally {
    releaseGateMutex();
  }
}
