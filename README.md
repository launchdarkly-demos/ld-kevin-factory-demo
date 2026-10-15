# Flight Deck

A demo of LaunchDarkly Release AutoPilot. An airport operations board whose
live view shows a guarded release rolling out passenger by passenger, with the
guardrail metrics on instruments beside it.

![Flight Deck: a guarded release climbing to cruise, then a second one rolling back](docs/media/flight-deck.png)

Open a pull request against this repo with a user-facing change. The
LaunchDarkly GitHub App proposes a flag, wraps the change behind it when you
approve, and once the flag is turned on after merge, autopilot releases it
under the project's release policy and rolls it back if a guardrail metric
regresses. The deck shows the rollout as it happens.

- Design: [docs/flight-deck-spec.md](docs/flight-deck-spec.md)
- Running the demo: [docs/demo-runbook.md](docs/demo-runbook.md)
- What starts the release: [docs/factory-release-trigger-report.md](docs/factory-release-trigger-report.md)
- Flag conventions for this codebase: [CLAUDE.md](CLAUDE.md)

## Run it

```bash
cp .env.example .env   # add LD_SDK_KEY, or leave blank for offline mode
npm install
npm start              # http://localhost:7777
npm test
```

Offline mode needs no LaunchDarkly credentials. Every flag returns its
fallback and the floor runs on baseline behaviour.

## Demo tooling

| Script | What it does |
|---|---|
| `scripts/reset-demo.sh [--yes]` | Close PRs, delete feature branches, force `main` to the `demo-baseline` tag, delete the project's flags, restart the deck. Dry run without `--yes`. |
| `scripts/deploy.sh [--no-pull]` | Pull `main` and hard-restart the deck on it. Run right after each merge. |
| `scripts/open-pr.sh 1\|2` | Open demo PR 1 (express boarding lane) or PR 2 (gate upgrade offers) from the stored patches in `demo/`. |
| `scripts/capture.sh [sec] [dir]` | Screenshot the deck every few seconds with headless Chrome while a run plays out. |
| `node scripts/make-gif.mjs` | Stitch the frames into `docs/media/flight-deck.png` (animated PNG; also a `.gif` if ffmpeg is installed). |
