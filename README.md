# Flight Deck

A demo of LaunchDarkly Release AutoPilot. An airport operations board whose
live view shows a guarded release rolling out passenger by passenger, with the
guardrail metrics on instruments beside it.

Open a pull request against this repo with a user-facing change. The
LaunchDarkly GitHub App proposes a flag, wraps the change behind it when you
approve, and on merge autopilot releases it under the project's release
policy. The deck shows the rollout as it happens.

Design: [docs/flight-deck-spec.md](docs/flight-deck-spec.md).
Conventions for flags in this codebase: [CLAUDE.md](CLAUDE.md).

## Run it

```bash
cp .env.example .env   # add LD_SDK_KEY, or leave blank for offline mode
npm install
npm start              # http://localhost:7777
npm test
```

Offline mode needs no LaunchDarkly credentials. Every flag returns its
fallback and the floor runs on baseline behaviour.
