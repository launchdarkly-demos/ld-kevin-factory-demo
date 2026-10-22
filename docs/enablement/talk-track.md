# Talk track: the two-act Flight Deck demo

Each block has three columns in prose: **say**, **do**, **they see**. Timings
are observed averages; the GitHub App's two waits (classify, apply) are the
only parts you cannot speed up, so the script gives you something to say
during both.

Setting: a terminal operations board. Passengers (dots) check in, clear
security, walk to their gate, board. Blue is today's behaviour; gold is a
passenger on a flag's new path. The tape on the right is the release's
altitude; the instruments are the guardrail metrics; the lamp is autopilot's
state.

## Opening (2 minutes)

**Say.** "Every team here ships behind flags already. The gap is what happens
after the merge. Someone has to remember to create the flag, wire it, write
the flag-off test, decide how to roll it out, watch the dashboards, and pull
it back if something breaks. That's a dozen small decisions per change, made
differently by every engineer. Release AutoPilot moves those decisions into
two places: a GitHub App that does the wiring in the pull request, and a
release policy the platform team writes once. Let me show you what it looks
like from the developer's seat."

**Do.** Show the deck at TAXI, empty tape. Show the policy in LaunchDarkly:
Project settings, Release settings, "Release AutoPilot Demo". Read it aloud:
guarded release, 10% then 25% then 50% then everyone, watching boarding time
and missed boardings, automatic rollback.

**They see.** The baseline floor and the policy that will govern both acts.

## Act 1: a change that should land (12 minutes live, or pre-merged)

### Block 1a. The pull request (1 minute)

**Say.** "A developer adds an express boarding lane for carry-on-only
passengers, plus a small ops endpoint for lane stats. No flag in the diff.
This is a normal PR."

**Do.** Operate > PR 1 express lane. Open the PR. Point at the diff: a lane
decision, an endpoint, tests. No LaunchDarkly anywhere.

**They see.** A plain PR with eight files. Within 30 seconds the app reacts
with 👀.

### Block 1b. Classification (the 4-minute wait)

**Say, while waiting.** "The app is reading the diff and deciding whether a
flag would protect anything. It's not a regex. On a change with no new entry
point, no outside call, and no contract change, it says so and proposes
nothing. That's the behaviour you want: a flag on every PR is noise. Here the
new endpoint is a contract change and the lane switch changes what half the
passengers experience, so expect a proposal."

If you have time, show a declined PR from the repo history (PR #4 or #10) so
they see what "no flag needed" looks like, and the `@launchdarkly refine`
reply that overrides it.

**They see.** The plan comment: one flag, `enable-express-boarding`, and a
release configuration that quotes the policy back word for word.

### Block 1c. Approve and apply (2 minutes)

**Say.** "The developer reviews the plan and approves. Watch what comes back:
not a suggestion, a commit."

**Do.** Operate > Approve (posts `@launchdarkly approve`). When the commit lands, open it.

**They see.** A commit by the app: the lane decision wrapped in
`isEnabled("enable-express-boarding", passenger.context, false)`, flag-on and
flag-off tests added, following the repo's own conventions file. In
LaunchDarkly, the flag exists, off, with a release pipeline attached to the PR.

**Say.** "Notice it followed this repo's house rules: helper name, fallback
value, test style. Those rules live in a markdown file in the repo. Change the
file, change the behaviour."

### Block 1d. Merge, deploy, hand off (2 minutes)

**Say.** "Merge. The deck deploys itself when it sees main move; watch the
flight log. The flag is off, so nothing changed for a passenger yet. The
handoff is one switch: the engineer turns the flag on, still serving the
baseline. That tells autopilot the code is live."

**Do.** Operate > Merge. Wait for "restarting on the new code" in the flight
log (about 30 seconds; Operate > Redeploy if impatient). Operate > Turn on,
serve baseline (or in LaunchDarkly: flag on, default rule to Control, save).
If the release hasn't started within a minute, click Release on the
targeting page and Save; the form is pre-filled from the policy.

**They see.** Within a minute the flag's Release tab reads "Release phase 1 of
1, In progress". On the deck, the first gold passengers appear as they clear
security, and the lamp reads CLIMB.

### Block 1e. The climb (4 minutes)

**Say.** "Ten percent of passengers are on the express lane. Look at the
instruments: new-path boarding time is already under baseline, no missed
boardings. Autopilot holds here for a minute, checks the metrics, then
advances. Nobody is watching a dashboard. The policy is."

**Do.** Nothing. Narrate the steps as the tape moves: 10, 25, 50, 100.

**They see.** Gold spreading down the concourses, the tape climbing, boarding
time 4.1 against 5.5 minutes, then CRUISE. The flag now serves the new lane to
everyone and the tape shows it as landed.

## Act 2: a change that should not land (8 minutes live)

### Block 2a. The pull request (1 minute)

**Say.** "Second change, from a different team: offer paid upgrades to Plus
and Elite members at the gate. Good for revenue. Costs a few minutes per
passenger at the door. The PR says so honestly."

**Do.** Operate > PR 2 upgrade offers. Open the PR.

**They see.** Five files, a new `/api/upgrades` endpoint, a stated customer
impact.

### Block 2b. Classification (4-minute wait)

**Say, while waiting.** "Same wait. This time read the plan carefully when it
arrives: the app warns that the door step may hurt boarding time, the exact
metric the policy guards. It reasoned about the consequence, not just the
diff."

**They see.** The plan with the warning, the flag, and the release config.

### Block 2c. Approve, merge, deploy, flag on (3 minutes)

**Do.** Operate > Approve, wait for "Plan applied", Merge, wait for the
self-deploy, flag on with Control. Release button if needed.

**They see.** Everyone on the floor drops from gold to blue: the new rolling
flag now decides the colour. Then the first gold passengers again, this time
ringed in purple as they pause at the door for the offer.

### Block 2d. The rollback (2 to 3 minutes)

**Say.** "Ten percent. The new-path boarding time gauge is already climbing:
seven minutes against four. Autopilot advances to 25% because the sample is
still small. Watch the gauge turn red. Now watch the lamp."

**Do.** Nothing. Let it happen. Resist narrating ahead of the deck.

**They see.** At about 40 seconds into the 25% stage, a flag update. The tape
collapses to zero, the lamp reads DISENGAGED, the gold passengers finish
boarding and no new ones appear. In LaunchDarkly, the release rule is gone and
the flag serves Control.

**Say.** "No page, no human. The policy said what good looks like, the metrics
said this wasn't it, and the change is off for everyone about three minutes
after it started. The code is still merged. The team can fix the door flow and
turn it back on. Nobody shipped a bad afternoon to the whole airport."

## Close (1 minute)

**Say.** "Three things to take away. The developer wrote no flag code and no
rollout plan. The platform team wrote one policy and it governed both
releases. And the system was honest about judgment: it declined to flag
changes that didn't need it, warned about the one that would hurt, and rolled
it back when it did."

## Modular versions

| Version | Blocks | Minutes | Notes |
|---|---|---|---|
| Lightning | Opening, pre-merged act 1 at CRUISE on screen, 2d from a recording, close | 5 | Use the README animation for 2d |
| Standard | Opening, act 1 pre-merged (show PR conversation, deck at CRUISE), act 2 live, close | 15 | The default for discovery calls |
| Full | Everything live | 25 | Two classifier waits; have the "while waiting" lines ready |

## Phrases that have worked

- "The deploy is not the release. Merging ships the control path. The release
  is the flag operation afterwards, and that's what the policy owns."
- "Judgment, not a regex." (on declined classifications)
- "House rules in a markdown file." (on `CLAUDE.md` conventions being followed)
- "Nobody watched a dashboard."

## Phrases to avoid

- Anything about pricing, packaging, or dates. Route to the AE.
- "Fully automatic." The handoff (flag on) and the approval are human steps,
  and that is the design. Say "automates the mechanics, keeps the decisions".
- Competitor names.
