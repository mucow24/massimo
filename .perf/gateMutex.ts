import { spawn } from 'node:child_process';

/**
 * The perf harnesses want the machine to themselves for the same reason
 * pre-pr does, so they take the same machine-wide kernel mutex
 * (Global\massimo-pre-pr — see scripts/preprQueued.ps1). Acquisition lives
 * here in the harness configs rather than in a wrapper script the caller must
 * remember: there is no unserialized way to start a perf run, on the same
 * principle that made `npm run pre-pr` route itself through the queue.
 *
 * The holder is a child PowerShell process, because the kernel ties mutex
 * ownership to a live thread and node has no handle on a Windows mutex. The
 * child acquires, prints ACQUIRED, then blocks on stdin; closing stdin
 * releases the mutex and ends the child — and if this whole process dies
 * instead, the pipe closes and the same path runs, so the release needs no
 * teardown to be reached. A holder killed harder still only abandons the
 * mutex, which every waiter (here and in preprQueued.ps1) catches as
 * acquisition. Nothing on disk exists to wedge.
 *
 * No-op off Windows: the queue exists for the multi-session dev box; CI and
 * cloud containers are one session per machine, with no PowerShell.
 */

const HOLDER_SCRIPT = `
$mutex = [System.Threading.Mutex]::new($false, 'Global\\massimo-pre-pr')
$owned = $false
try { $owned = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owned = $true }
if (-not $owned) {
  [Console]::Out.WriteLine('WAITING'); [Console]::Out.Flush()
  while (-not $owned) {
    try { $owned = $mutex.WaitOne(30000) } catch [System.Threading.AbandonedMutexException] { $owned = $true }
  }
}
[Console]::Out.WriteLine('ACQUIRED'); [Console]::Out.Flush()
[Console]::In.ReadLine() | Out-Null
$mutex.ReleaseMutex()
`;

let releaseCurrent: (() => void) | null = null;

/** Block until this run owns the machine mutex. Resolves immediately off Windows. */
export async function acquireGateMutex(label: string): Promise<void> {
  if (process.platform !== 'win32') return;
  const child = spawn('powershell', ['-NoProfile', '-Command', HOLDER_SCRIPT], {
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  await new Promise<void>((resolve, reject) => {
    let buf = '';
    let waitingAnnounced = false;
    child.stdout.on('data', (d: Buffer) => {
      buf += String(d);
      if (!waitingAnnounced && buf.includes('WAITING')) {
        waitingAnnounced = true;
        console.log(
          `[perf] ${label}: a pre-pr or another perf run holds the machine mutex; queued...`,
        );
      }
      if (buf.includes('ACQUIRED')) {
        if (waitingAnnounced) console.log(`[perf] ${label}: mutex acquired`);
        resolve();
      }
    });
    child.on('error', reject);
    child.on('exit', (code) => reject(new Error(`mutex holder exited early (code ${code})`)));
  });
  releaseCurrent = () => {
    try {
      child.stdin.write('\n');
      child.stdin.end();
    } catch {
      // The child is already gone; the kernel has the release covered.
    }
  };
}

/** Release the mutex taken by acquireGateMutex. Safe to call when none is held. */
export function releaseGateMutex(): void {
  releaseCurrent?.();
  releaseCurrent = null;
}
