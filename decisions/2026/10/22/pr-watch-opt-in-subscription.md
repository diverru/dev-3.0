# `dev3 pr watch` is an opt-in subscription, not automatic PR notifications

## Context

Agents waited on a PR's CI or merge by polling `gh` or setting timers, which burns turns and tokens. dev3 already polls every task's PR, so it can tell the agent instead.

## Decision

An agent subscribes with `dev3 pr watch [--until ci|merged]`. The socket handler (`src/bun/cli-socket/pr-watch-commands.ts`) stores `Task.prWatches` and returns at once. `pollTaskPrStatus` (`src/bun/lifecycle/activities.ts`) hands each PR sample to `runPrWatches` (`src/bun/pr-watch-runner.ts`); the pure verdict is `evaluatePrWatches` in `src/bun/pr-watch.ts`. A fired watch sends one `<dev3-pr-status>` message through the held delivery of `sendMessageImmediately` (origin `dev3`) and is removed only after the message was accepted.

Opt-in because the cases differ: many agents open a PR and stop, and an automatic message would wake an idle agent, move its card and cost a turn for nothing. The subscription says what this agent waits for. State is persisted on the task so a restart of dev3 keeps it.

The message carries only dev3 text, the PR number and URL, a short SHA and up to three sanitized check names, never a title, review or comment: fork authors write those and the text lands in the agent's prompt. A sample whose head is missing locally (a fork PR with the same branch name) or is an older ancestor of the watch's head is ignored; a head that is neither moves the watch to the new head.

## Risks

An older dev3 that rewrites the task can drop the field, and the subscription then vanishes silently. A message held for delivery is lost if the app dies before the agent's pane goes quiet, as with `dev3 message`. An agent that never subscribes hears nothing, which is the intended default. A watch on a task whose agent is gone waits; after a failed delivery the task is retried only every five minutes.

## Alternatives considered

Automatic notifications for every PR event were rejected for the noise above. A blocking `dev3 pr watch` that polls inside the CLI would hold the agent's turn and run a second poller beside the app's. Putting PR titles or review text in the message would have given forks a prompt-injection channel.
