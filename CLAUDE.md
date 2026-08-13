# Working agreement

How to work in this repo. These override default behavior.

## Code

- Keep code simple and stupid. Don't overthink it. Prefer the obvious solution over the clever one.
- Respect existing abstractions. Use what's already here; don't reinvent or work around it. If an abstraction is genuinely wrong for the job, say so rather than bypassing it silently.

## Testing

- On this machine, gate with `npm run pre-pr:queued`, not bare `pre-pr`: it queues the run behind
  a machine-wide kernel mutex ([scripts/preprQueued.ps1](scripts/preprQueued.ps1)) so parallel
  sessions' gates serialize instead of thrashing each other. Cloud and CI use plain `pre-pr`.
- All logic changes must be unit-tested. No behavioral change ships without a test covering it.
- Use red-first / TDD whenever possible: write the failing test first, watch it fail, then make it pass.
- A red test must fail on **behavioral logic**, not on plumbing. "The module I'm about to write isn't importing yet" is NOT a red test. The test must exercise actual behavior and fail because that behavior is wrong or missing.

## Architecture doc

- [ARCHITECTURE.md](ARCHITECTURE.md) describes the code as it stands. Ask on every PR whether the
  change leaves it wrong or incomplete, and fix that in the same PR. Most PRs need no edit — that's
  a fine answer, but ask.
- A now-**wrong** statement always gets fixed. A **gap** gets filled only when the silence would
  misdirect someone bootstrapping the codebase: a new concept, layer, or invariant, or a new member
  of a set the doc enumerates. Not a new function. Grepping the doc for what the diff touched is a
  useful first pass, but zero hits settles nothing — new code can't hit.
- Edit the prose in place, at the altitude it already sits at. Rewrite what's wrong, delete what's
  gone; never record change (no changelog, no "new in", no "as of PR #N", no "previously X, now Y",
  no note bolted onto a section instead of editing it). Legacy _data_ shapes the code still handles
  (persist versions, migration gates) are present-tense facts, not history; those stay.
- Hand-edit only, never Prettier; wrap at 100 columns; leave the "up to date as of commit …" stamp
  to the nightly scrub.

## Plans

- Before presenting any plan, do a full adversarial / critique pass over it yourself. Confirm it:
  - follows the rules in this file (simplicity, existing abstractions, test-first),
  - is locked to the actual source on the ground — verify against the real code, not assumptions,
  - fully specifies the solution, with no hand-waving over the hard parts.

## Working together

- Ask questions. When something is ambiguous or underspecified, ask rather than guess.
- Push back. If a request seems unreasonable, or conflicts with the rules above, say so. You're a partner here and your input is valued — don't just comply.
- Walk me in. I directed this program; Claude wrote it. Treat me as a smart outsider to any code I didn't personally touch: an answer that explains how the code works opens with 2–4 plain-language sentences — what subsystem we're in, what it's for, and the main characters (files, concepts) the rest of the answer leans on. This takes precedence over "lead with the outcome": orientation first, then the outcome, then full depth. Don't thin the technical meat — the walk-in is what earns it. One walk-in per topic per conversation is enough; status reports and small answers don't need one.
- This software is used essentially by one person (me). If a slightly larger change would yield a worthwhile payoff — a real cleanup, unification, removing duplication — propose it. Big changes are fine when they're worth it; don't shy away from suggesting them.
