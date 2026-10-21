# Refresh saved PR history after a branch change

## Context

A task can keep its PR number while work continues on a renamed or follow-up branch. The inspector and board still show that saved PR, but `pollTaskPrStatus` discarded its GitHub response when the head branch differed, leaving its cached OPEN state indefinitely.

## Investigation

A read-only comparison of active boards with GitHub found an actual merged PR whose task had switched to a follow-up branch. Logs repeatedly reported a head mismatch; regression tests reproduce both MERGED and CLOSED being returned as not-found.

## Decision

`src/bun/lifecycle/activities.ts` now persists and pushes the current state of a saved PR even if its head differs. It requires a matching branch before promotion, attention notifications, or emitting merge-completion findings. The shared inspector hook refreshes rich PR data while visible and on explicit refresh; board polling uses one/five-minute active/background intervals.

## Risks

Polling settled PRs more often adds GitHub requests. Jitter and visibility-aware polling remain in place, and a historical PR never authorizes completion of follow-up work.

## Alternatives considered

Dropping the saved badge would hide task history and conflict with the existing PR ledger. Removing the head check from lifecycle actions would let another branch's PR promote or complete the current task.
