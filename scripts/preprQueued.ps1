# Machine-wide queue for pre-pr. Several Claude Code sessions often sync up and
# hit the gate at once; each full run wants the whole machine (vitest threads,
# vite build, Playwright's timing-sensitive drags), so overlapping runs thrash
# and flake. This wrapper serializes them behind a named kernel mutex: WaitOne
# IS the queue, and unlock-on-death is the KERNEL's guarantee, not this
# script's — if a holder errors out or is killed mid-run, the mutex is marked
# abandoned and the next waiter acquires it via AbandonedMutexException
# (caught below: it means "you own the lock; the previous holder died holding
# it"). No lock files, no staleness probes, no daemon; nothing on disk exists
# to wedge.
#
# Entry is FORCED, not chosen: `npm run pre-pr` routes here on Windows via
# scripts/prePr.mjs (callers kept forgetting the queued variant, which put
# unserialized gates on top of perf runs), and `pre-pr:queued` remains as a
# compatibility alias. CI and cloud containers run the chain directly — one
# session per machine, nothing to serialize, no PowerShell dependency. The
# perf harnesses in .perf/ take this same mutex (.perf/gateMutex.ts), so a
# gate and a perf run can never overlap either.
#
# The kernel covers DEATH, not a live hang: a stuck-but-alive pre-pr holds the
# lock legitimately, and the heartbeat below makes that visible. Killing the
# stuck run IS the release (death -> abandonment -> the next waiter proceeds).

# Global\ so the queue spans logon sessions too (an SSH logon or a service
# would miss a Local\ mutex). Creating a Global\ mutex needs no privilege —
# that restriction applies to file mappings, not synchronization objects.
$mutex = [System.Threading.Mutex]::new($false, 'Global\massimo-pre-pr')
$owned = $false
try {
  try { $owned = $mutex.WaitOne(0) }
  catch [System.Threading.AbandonedMutexException] { $owned = $true }
  if (-not $owned) {
    Write-Host 'pre-pr:queued: another pre-pr holds the machine lock; queued...'
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while (-not $owned) {
      try { $owned = $mutex.WaitOne(30000) }
      catch [System.Threading.AbandonedMutexException] { $owned = $true }
      if (-not $owned) {
        Write-Host ('pre-pr:queued: still queued ({0:f1}m)' -f $sw.Elapsed.TotalMinutes)
      }
    }
    Write-Host ('pre-pr:queued: lock acquired after {0:f1}m in queue' -f $sw.Elapsed.TotalMinutes)
  }

  # The guard keeps prePr.mjs from routing this inner call back into the
  # queue; calling the raw chain directly would also work, but the guard must
  # be set regardless so any nested `npm run pre-pr` stays queue-free.
  $env:PREPR_UNDER_MUTEX = '1'
  npm run pre-pr:raw
  # A missing/unlaunchable npm leaves $LASTEXITCODE null; a gate must never
  # turn that into a green exit 0.
  if ($null -eq $LASTEXITCODE) { exit 1 }
  exit $LASTEXITCODE
}
finally {
  if ($owned) { $mutex.ReleaseMutex() }
}
