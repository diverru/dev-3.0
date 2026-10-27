# Hold the merge-completion offer while a PR watch reports the merge

## Context

With `dev3 pr watch` an agent hears about its merged PR, but the merge path showed the user "complete the task?" in the same poll (`reportTaskPrStatus`), and the content poller (`checkMergedBranches`) could show it before the PR poll saw the merge at all. The user was asked before the agent wrote its final report, notes or coordinator message, and could not tell whether to wait for it.

## Decision

dev3 stays the single owner of the offer and only delays it. `mergeOfferHeld` (`src/bun/pr-watch-runner.ts`) holds the offer while the task has a watch and an agent that can receive it, for at most 10 minutes from the first merge sighting; a delivered merged notice resets the hold to 2 minutes, enough for the prompt hook to move the card to in-progress, where no offer is made anyway (`MERGE_ELIGIBLE_STATUSES`). When the agent's turn ends the card returns to review and the next poll offers as usual. A held offer reserves nothing, so it is never lost. All three offer paths ask the hold (`checkMergedBranches`, `reportTaskPrStatus`, `prepareMergeCompletionPrompt`); a forced re-check by the user bypasses it. The merged message tells the agent to wrap up and leave the completion to dev3, and says no offer comes yet when the merged PR does not cover the local head (`mergedPrCoversHead`).

## Risks

The hold is in memory: after an app restart the offer comes at once. An agent pane that looks alive but never answers delays the offer by up to 10 minutes. A long agent turn delays the offer for its whole length, since in-progress is never offered.

## Alternatives considered

The agent setting manual completion itself was rejected: it depends on agent discipline, rewrites a user-visible preference, and leaves no offer at all when the agent dies. Letting the agent request completion with a dev3 fallback needs the same timer plus one more agent duty. A watch badge on the card was left out: with the hold the user no longer has to decide whether to wait.
