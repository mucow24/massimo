import { readPowerMode } from './powerMode';

/**
 * Runs once before any perf spec — wired into both perf playwright configs.
 * Stamps the run with the machine's CPU perf mode, which swings these numbers
 * by a large factor and is otherwise invisible in the output. Non-fatal
 * everywhere the mode can't be read (see powerMode.ts).
 */
export default function globalSetup(): void {
  console.log(`\n[perf] Lenovo power mode: ${readPowerMode()}\n`);
}
