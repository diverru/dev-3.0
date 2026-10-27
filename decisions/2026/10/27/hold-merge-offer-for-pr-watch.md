# Hold the merge-completion offer while a PR watch reports the merge

## Context

With `dev3 pr watch` an agent hears about its merged PR, but the merge path showed the user "complete the task?" in the same poll (`reportTaskPrStatus`), and the content poller (`checkMergedBranches`) could show it before the PR poll saw the merge at all. The user was asked before the agent wrote its final report, notes or coordinator message, and could not tell whether to wait for it.

## Decision

dev3 stays the single owner of the offer and only delays it. `mergeOfferHeld` (`src/bun/pr-watch-runner.ts`) holds the offer while the task has a watch and an agent that can receive it, for at most 10 minutes from the first merge sighting. Accepting the merged notice restarts that 10-minute fallback and remembers its text; the hold ends when the agent's prompt-submit hook reports a prompt containing that text (`releaseMergeOfferHoldOnSubmission`, called from `recordTerminalPromptSubmission` beside the stranded-message release), plus 30 seconds for a harness whose status hook lands after that call. That is proof of delivery; a timer after the send or a status change is not: `sendMessageImmediately` usually only queues the text until the pane is quiet, copy mode or a typing user can hold it for any time, and a notice accepted mid-turn is followed by that turn's own move to review. The card is then in-progress, which is never offered (`MERGE_ELIGIBLE_STATUSES`). When the agent's turn ends the card returns to review and the next poll offers as usual. A held offer reserves nothing, so it is never lost. A new subscription clears the previous hold, so each PR gets its own cycle. All three offer paths ask the hold (`checkMergedBranches`, `reportTaskPrStatus` on a fresh task read, `prepareMergeCompletionPrompt`); a forced re-check by the user bypasses it. The merged message tells the agent to wrap up and leave the completion to dev3; when the merged PR does not cover the local head (`mergedPrCoversHead`, or a historical PR of another branch) it says no offer comes until that work lands.

## Risks

The hold is in memory: after an app restart the offer comes at once. An agent that never takes the message (dead pane that still looks alive, text held forever) delays the offer by up to 10 minutes. Harnesses whose hooks do not report prompt submissions to dev3 always wait the full 10 minutes, as does a task whose pane is owned by a second dev3 process. A long agent turn delays the offer for its whole length, since in-progress is never offered.

## Alternatives considered

The agent setting manual completion itself was rejected: it depends on agent discipline, rewrites a user-visible preference, and leaves no offer at all when the agent dies. Letting the agent request completion with a dev3 fallback needs the same timer plus one more agent duty. A watch badge on the card was left out: with the hold the user no longer has to decide whether to wait.
