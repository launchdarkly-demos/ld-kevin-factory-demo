# Facilitator runbook

Operational detail for running the session and the practice slots. The demo
mechanics are in [../demo-runbook.md](../demo-runbook.md); this file is about
not getting caught out in front of a room.

## The day before

- [ ] Operate > **Reset** on the deck (laptop alternative: `git checkout
      develop && git pull`, then `scripts/reset-demo.sh --yes`). Confirm the
      deck comes up at TAXI with an empty tape.
- [ ] Dry-run act 1 end to end. Note the classifier time; it varies.
- [ ] Confirm the policy still reads 10% / 1 min, 25% / 1 min, 50% / 2 min
      with both metrics attached and auto-rollback on.
- [ ] Confirm the Operate menu shows in the header. If not, the deck is
      missing one of `GITHUB_TOKEN`, `GITHUB_REPO`, `LD_API_KEY`,
      `LD_PROJECT_KEY` (`.env` on a laptop, secrets in Demo Depot). Confirm the
      Production SDK key is set (header reads "live").
- [ ] Reset again so the room sees a clean start, or deliberately pre-merge
      act 1 (see below).

## One hour before

- [ ] Settings > Release autopilot: the **Account-wide** auto-flagging and
      auto-releasing switches are on, and the repo row is mapped. The switch is
      shared by everyone on the account; it has been turned off under us once.
- [ ] Browser tabs, in order: the deck (full screen on the shared display),
      the repo's pull requests page, the flag list in LaunchDarkly, the
      release policy.
- [ ] No terminal needed: every step is in the Operate menu. If you prefer
      the scripts, a terminal in the repo on `main`, font large enough to
      read from the back.
- [ ] Decide: act 1 live or pre-merged. Pre-merged is the default for a
      60-minute session.
- [ ] If pre-merging: Operate > PR 1, Approve, Merge, Turn on serving
      baseline, let it reach CRUISE. Leave the PR conversation open in a tab; you will
      walk through it instead of waiting for it.
- [ ] Optional: start `scripts/capture.sh 10` in a second terminal to record.

## Known failure modes and the fix

| Symptom | Cause | Fix | Time |
|---|---|---|---|
| App never reacts to the PR (no 👀 in 2 minutes) | Repo not mapped, or app install changed | Settings > Release autopilot: check the repo row shows auto-flagging and auto-releasing on | 1 min |
| App reacts (👀 then 🚀) but never posts a plan | Account-wide auto-flagging is switched off (Settings > Release autopilot, "Account-wide" row). The switch is shared across the whole account; someone else can turn it off | Turn account-wide auto-flagging back on, then `@launchdarkly plan` on the PR. Check this switch in the hour-before list | 1 min |
| "LaunchDarkly suggests no changes" | Classifier found nothing to protect | Reply `@launchdarkly refine gate this behind a boolean flag per CLAUDE.md`; plan arrives in ~90 s. Say "judgment, not a regex" | 2 min |
| App asks a question instead of planning | Its policy lookup failed | Reply `@launchdarkly` and name the policy and environment; it replans | 2 min |
| Tape stays empty 30 s after merge | Deck has not self-deployed yet, or cannot (banner says why: not on `main`, or local changes) | Wait for "restarting on the new code" in the flight log, or Operate > Redeploy (`scripts/deploy.sh`) | 30 s |
| Flag on, tape jumps to 100% immediately | Flag switched on by hand with the default rule left on Treatment (Operate > Turn on, serve baseline avoids this) | Set default rule to Control and save. Release will not start on its own after this; use the Release button | 1 min |
| Flag on with Control, nothing after a minute | Automatic start did not fire (intermittent) | Targeting page: Release, Review and save, Save. Pre-filled from the policy | 30 s |
| "Plan applied" mentions a duplicate flag in another project | App created a stray flag in the account's `default` project | Ignore during the demo; archive it afterwards | 0 |
| Deck unresponsive or port in use | Wedged process | `scripts/deploy.sh --no-pull`; in Demo Depot, restart the instance | 10 s |
| Operate action fails with "patch … does not apply onto main" | `main` still carries the previous run | Operate > Reset, then retry | 1 min |
| Approve posted from the menu, App does nothing | The deck's GitHub token belongs to a user LaunchDarkly does not know | Comment `@launchdarkly approve` from your own GitHub account; fix the token later | 1 min |
| Reset refuses with "commits on origin/main" | Someone committed to `main` directly | Those commits belong on `develop`; cherry-pick them there, move the tag, re-run. Or `--yes --discard-main` if they are disposable | 2 min |

## Narration under failure

The audience does not know the script. Every row above has a one-line cover:

- Refine: "It didn't think this needed a flag. For the demo I want one, so I'll ask."
- Deploy: "That's my deploy step; the release waits until the new code is actually running."
- Release button: "I'll start the release by hand; it pre-fills everything from the policy, which is the point."

## Reset between groups

Operate > **Reset** (confirm the dialog). From a laptop:

```bash
scripts/reset-demo.sh          # review the plan
scripts/reset-demo.sh --yes    # apply: closes PRs, deletes branches and flags, resets main, restarts the deck
```

About 30 seconds. Then archive any stray flag in the `default` project.

## Practice slot (30 minutes per SE)

1. SE resets and starts narrating from the opening. Facilitator says nothing.
2. During act 1 the facilitator induces one stall from the table above
   (skip the deploy, or leave Treatment as the default). The SE must notice
   from the deck, name it, and recover using the runbook.
3. Act 2 to DISENGAGED.
4. Facilitator draws three objections from value-drivers.md. SE answers in
   under a minute each.

## Certification checklist

- [ ] Opening delivered in under two minutes without notes.
- [ ] Both acts completed; narration stayed behind the deck, not ahead of it.
- [ ] Recovered from the induced stall within the listed time.
- [ ] Said at least one "what it is not" line unprompted.
- [ ] Three objections answered; none included pricing or dates.
- [ ] Reset the environment for the next person.

## Timings to quote (observed, October 2026)

| Beat | Typical |
|---|---|
| PR open to app reaction | under 30 s |
| PR open to plan | 3.5 to 4 min |
| Approve to "Plan applied" with commit | about 2 min |
| Flag on to release start | under 1 min when automatic |
| Act 1 rollout to CRUISE | about 4 min |
| Act 2 start to rollback | about 2.5 min, in the 25% stage |
