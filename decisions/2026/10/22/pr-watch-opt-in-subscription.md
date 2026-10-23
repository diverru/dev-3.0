# `dev3 pr watch` is an opt-in subscription, not automatic PR notifications

## Context

Agents waited on a PR's CI or merge by polling `gh` or setting timers, which burns turns and tokens. dev3 already polls every task's PR, so it can tell the agent instead.

## Decision

An agent subscribes with `dev3 pr watch [--until ci|merged]`. The socket handler (`src/bun/cli-socket/pr-watch-commands.ts`) stores `Task.prWatches` and returns at once. `pollTaskPrStatus` (`src/bun/lifecycle/activities.ts`) hands each PR sample to `runPrWatches` (`src/bun/pr-watch-runner.ts`); the pure verdict is `evaluatePrWatches` in `src/bun/pr-watch.ts`. A fired watch sends one `<dev3-pr-status>` message through the held delivery of `sendMessageImmediately` (origin `dev3`) and is removed only after the message was accepted.

Opt-in because the cases differ: many agents open a PR and stop, and an automatic message would wake an idle agent, move its card and cost a turn for nothing. The subscription says what this agent waits for. State is persisted on the task so a restart of dev3 keeps it.

The message carries only dev3 text, the PR number and URL, a short SHA and the failed and total check counts, never a title, review, comment or check name: fork authors write those, and the text lands in the agent's prompt. The agent reads names with `gh pr checks`. A merge or close fires whatever the head. For CI, a sample whose head is an older ancestor of the watch's head is ignored, and any other head, even one this repository never fetched, moves the watch to it. A sample whose head the branch has since pushed past (its upstream, else HEAD) is skipped for CI. The `ci` verdict is the same as the CI badge's: a rollup that does not yet list every external status can read as complete, so the message and help claim only that all checks GitHub listed finished.

The watched PR is the open PR of the task's own branch, which is what the poller samples; `--pr N` only has to match it, and a recorded PR that is no longer open is never a fallback. The message goes to the pane of the agent that subscribed, captured like a self-reminder's author (`scheduled-message-author.ts`). If that agent cannot be resolved (it is gone, or none was captured, which is always the case on Windows) the message goes to the task's only agent pane; with several agent panes the watch waits and retries, and a sibling is never guessed. A watch is never deleted because its author is gone. A watched task is polled every 60 s in any project.

## Risks

An older dev3 that rewrites the task can drop the field, and the subscription then vanishes silently. A message held for delivery is lost if the app dies before the agent's pane goes quiet, as with `dev3 message`. An agent that never subscribes hears nothing, which is the intended default. After a failed delivery the task is retried only every five minutes. On Windows, or without pane env, a task with several agent panes never gets the message until it is down to one. The PR is found by branch name only, as in the badge and merge detection, so a fork PR with the same branch name could be the one watched. A review task is not supported. A repository without CI checks never ends a `ci` watch, so the task keeps the 60 s poll until the PR is merged or closed; `--until merged` is the answer, and `dev3 pr watch --help` says so.

## Alternatives considered

Automatic notifications for every PR event were rejected for the noise above. A blocking `dev3 pr watch` that polls inside the CLI would hold the agent's turn and run a second poller beside the app's. Putting PR titles or review text in the message would have given forks a prompt-injection channel.
