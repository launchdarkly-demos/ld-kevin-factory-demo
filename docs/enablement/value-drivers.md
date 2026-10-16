# Value drivers, discovery, objections

## The two-minute pitch

Teams already ship behind flags. What they don't have is a consistent answer
to the dozen decisions that follow a merge: which flag, wired where, tested
how, released to whom, at what pace, watched by which metrics, pulled back by
whom. Release AutoPilot gives those decisions two homes. The GitHub App
handles the mechanics inside the pull request: it decides whether a change
needs a flag, creates it, wraps the code, writes the tests for both states,
and records a release plan. The release policy, written once by the platform
team, decides how that release runs: progressive or guarded, which steps,
which metrics, whether to roll back on its own. Developers approve a plan and
flip a switch when the deploy is live. Everything else is consistent across
every team because it is configuration, not habit.

## Value drivers by persona

| Persona | Pain today | What changes | Proof point in the demo |
|---|---|---|---|
| Platform / release engineering | Release practice is a wiki page; every team does it differently | One release policy governs every flag release in the project; progressive and guarded rollouts become the default, not the exception | The same policy ran both acts; the SE never configured a rollout |
| Engineering leads | Flag hygiene is toil: wiring, tests, cleanup; reviewers police conventions | The app does the wiring and the tests, following the repo's own conventions; reviewers approve a plan | Vega's commit: helper, fallback, both test states, per `CLAUDE.md` |
| SRE / on-call | Bad releases are caught by humans watching dashboards, often late | Guardrail metrics are attached by policy; regression means automatic rollback within minutes | Act 2: rollback about 3 minutes after the release started, no human in the loop |
| Product | Risky changes ship all-or-nothing, or sit behind a flag nobody turns on | Every change ships dark and is released on a schedule with a safety net; the PR records the plan | The plan comment and release configuration on every PR |
| Security / compliance | Who changed what in production is spread across tools | The PR carries the flag, the plan, and the approval; LaunchDarkly carries the release and the rollback | The PR conversation plus the flag's Release tab |

## Discovery questions

Ask these before the demo; they decide which act to lead with.

1. "Walk me through what happens after a PR merges today. Who creates the flag? Who decides the rollout? Who watches?"
2. "How many release incidents in the last quarter were caught by a person noticing, versus by a system?"
3. "Do you have a written release standard? How many teams follow it?"
4. "How do you decide which changes need a flag at all?"
5. "What metric would tell you within five minutes that a release is going wrong?" (If they have no answer, that's the guardrail-metric conversation.)
6. "How long does a flag live after it's at 100%?" (Cleanup conversation; the app's plan includes a cleanup stage.)
7. "Where do your engineers' AI coding tools fit into your release process today?" (The app is agent-friendly: conventions in a repo file, flag and release helpers.)

## Objection handling

**"We already have feature flags."**
Good, this needs them. Flags are the mechanism; this is the practice around
them. Ask question 1 and let the answer show the gap between having flags and
having a release process.

**"I don't want an AI writing code into my PR."**
It writes one thing: the guard around your change, plus tests for both states,
following your conventions file. It proposes first; nothing lands without
`@launchdarkly approve`, and `@launchdarkly revert` undoes it. Show a commit.
The code is small and boring on purpose.

**"What if it flags the wrong thing, or misses one?"**
Show a declined PR. It declines changes with no new entry point, outside call,
or contract change, and tells you why. You can override with `refine` or
`replan`. The classification is a judgment with an explanation and a human
approval, which is more than most teams have today.

**"Our rollouts take hours or days, not minutes."**
The policy is yours. The demo compresses to minutes so you can watch it;
customers set steps of hours. The point is that the steps, the metrics, and
the rollback rule are written once and applied every time.

**"What permissions does the app need, and where does our code go?"**
It's a GitHub App installed on the repos you choose, with read and write on
code, pull requests, checks, and actions, scoped per repo in Settings.
Pointing at the install page and the per-repo mapping in LaunchDarkly is
usually enough. For anything deeper, bring in the AE and a solutions
architect rather than guessing.

**"We don't have good metrics for a guarded release."**
Start with what you have: error rate, latency, a conversion step. The policy
can watch a metric group. If they have nothing, the demo's two metrics show
how little it takes: one numeric, one occurrence, sent from the SDK.

**"Is this GA? What does it cost?"**
The GitHub App is marked Beta / New on the Integrations page. For packaging,
pricing, and timelines, route to the AE. Don't improvise.

## What it is not

Say these unprompted when they fit; they build trust.

- It is not fully hands-off. A human approves the plan and a human turns the
  flag on when the deploy is live. Those are the two decisions worth keeping.
- It does not deploy your code. The deploy is yours. The release is the flag
  operation afterwards.
- It does not replace monitoring. It consumes the metrics you already send to
  LaunchDarkly, and acts on them.

## FAQ for SEs (internal)

**Why did the classifier say "no flag needed" on my PR?**
Its bar is a new entry point, an outside call, or a contract change. A pure
behaviour tweak with no new surface gets declined. The stored demo PR 1 adds
an endpoint for exactly this reason; it passes unaided. If you improvise a PR
and it declines, reply `@launchdarkly refine gate this behind a boolean flag
per CLAUDE.md` and it will.

**Why didn't the release start after I turned the flag on?**
Two checks. First: did you deploy? The deck shows an orange banner if it is
running code behind `main`. Second: is the default rule serving Control? The
app creates the flag with Treatment as the on-variation; flipping the switch
alone releases to 100%. If both are right and nothing happens within a
minute, click Release on the targeting page and Save; the form is pre-filled
from the policy. In our runs the automatic start has been intermittent; this
is logged with the product team.

**Why did everyone turn blue when act 2 started?**
A rolling flag decides the colour. Act 1's flag has landed, so its passengers
show gold only until another flag starts rolling. The tape still shows act
1's flag at 100%, green, "landed".

**The app reacted to my PR but never posted a plan.**
Account-wide auto-flagging is off. It's one switch for the whole account at
Settings > Release autopilot, and someone else can flip it. Turn it on, then
`@launchdarkly plan` on the PR.

**Can I show a different app?**
The reference polyglot app (Go, Python, TypeScript) exists in the demos org.
Flight Deck is faster to narrate because the rollout is visible. Use the
reference app when the audience wants to see multi-language wiring.
