# Release AutoPilot: SE enablement program

A 60-minute session plus one supervised practice run, built around the Flight
Deck demo in this repo. The goal is narrow: every SE can explain what Release
AutoPilot does in two minutes, run the two-act demo without notes, and handle
the six objections that come up every time.

Materials in this folder:

| File | Use it for |
|---|---|
| [talk-track.md](talk-track.md) | What to say and click, beat by beat, with timings. Modular demo blocks for 5, 15, and 25 minute versions. |
| [value-drivers.md](value-drivers.md) | The two-minute pitch, value drivers by persona, discovery questions, objection handling, FAQ. |
| [facilitator-runbook.md](facilitator-runbook.md) | Pre-session checklist, environment reset, what breaks and how to recover, certification checklist. |

The demo itself is documented in [../demo-runbook.md](../demo-runbook.md); the
product findings behind the talk track are in
[../factory-release-trigger-report.md](../factory-release-trigger-report.md).

## What Release AutoPilot is, in one paragraph

A LaunchDarkly GitHub App that watches pull requests. For a user-facing
change it proposes a feature flag, and on approval it creates the flag (off),
pushes a commit that wraps the change behind it with tests for both states,
and records a release plan that follows the project's release policy. After
the code is deployed and the flag is turned on, the release runs itself: a
guarded rollout through the policy's steps, watching the policy's metrics,
rolling back automatically if one regresses. Flags live in LaunchDarkly, the
code lives in the customer's repo, and the release practice lives in a policy
the platform team owns.

Status at time of writing: the GitHub App is marked Beta / New on the
Integrations page and its account settings are an alpha. Say so.

## Session agenda (60 minutes)

| Min | Block | Who | Outcome |
|---|---|---|---|
| 0–5 | Why this matters: the release gap | Lead | SEs can name the problem in the customer's words |
| 5–12 | How it works: the loop | Lead | SEs can draw the loop: PR → flag → policy → rollout → rollback |
| 12–37 | Live demo, both acts | Lead | SEs have seen the whole arc once |
| 37–45 | Value drivers and discovery | Lead | SEs can map features to three personas |
| 45–55 | Objections, live | Pairs | Each SE answers two objections out loud |
| 55–60 | Your turn: practice slots and certification | Lead | Every SE books a 30-minute practice slot |

The demo block runs long if the classifier takes its full four minutes twice.
Pre-merge act 1 before the session (see the runbook) and the live portion is
act 2 only, about 12 minutes, which leaves room for questions.

## Pre-work (15 minutes, before the session)

1. Read the one-paragraph description above and [value-drivers.md](value-drivers.md) through the pitch.
2. Open the demo repo and read one of the merged PRs end to end: the app's
   plan comment, the approval, the "Plan applied" comment, and Vega's commit.
   That conversation is the product.
3. Watch the README animation once.

## Practice and certification

Each SE runs the full demo once in a supervised 30-minute slot, from
Operate > Reset to DISENGAGED, narrating as they go. The facilitator
uses the certification checklist in the runbook. Sign-off requires:

- Both acts completed, narrated, no notes.
- Recovered from at least one induced stall (facilitator skips the deploy or
  leaves the default rule on Treatment) using the runbook.
- Answered three objections drawn at random from the list.

## Owner notes

- Keep the talk track and the runbook in step with `docs/demo-runbook.md`;
  when the demo changes, change these in the same commit.
- Numbers in the talk track are observed timings from October 2026 runs.
  Re-time after any policy or app change.
