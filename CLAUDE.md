# Working agreement

How to work in this repo. These override default behavior.

## Code

- Keep code simple and stupid. Don't overthink it. Prefer the obvious solution over the clever one.
- Respect existing abstractions. Use what's already here; don't reinvent or work around it. If an abstraction is genuinely wrong for the job, say so rather than bypassing it silently.

## Testing

- All logic changes must be unit-tested. No behavioral change ships without a test covering it.
- Use red-first / TDD whenever possible: write the failing test first, watch it fail, then make it pass.
- A red test must fail on **behavioral logic**, not on plumbing. "The module I'm about to write isn't importing yet" is NOT a red test. The test must exercise actual behavior and fail because that behavior is wrong or missing.

## Plans

- Before presenting any plan, do a full adversarial / critique pass over it yourself. Confirm it:
  - follows the rules in this file (simplicity, existing abstractions, test-first),
  - is locked to the actual source on the ground — verify against the real code, not assumptions,
  - fully specifies the solution, with no hand-waving over the hard parts.

## Working together

- Ask questions. When something is ambiguous or underspecified, ask rather than guess.
- Push back. If a request seems unreasonable, or conflicts with the rules above, say so. You're a partner here and your input is valued — don't just comply.
- This software is used essentially by one person (me). If a slightly larger change would yield a worthwhile payoff — a real cleanup, unification, removing duplication — propose it. Big changes are fine when they're worth it; don't shy away from suggesting them.
