# A worktree's own compose container is not a pre-start squatter

## Context

`dev-server-readiness-published-ports` tells "published for this dev server" from
"squatter" by an exact `(port, pid)` pre-start snapshot. Docker Desktop publishes
every port under one long-lived `com.docker.backend` PID (Linux: `docker-proxy`),
so the previous run's container and the new one look identical. Whenever that
container is still up when the snapshot is taken, the port is recorded as a
squatter and `--wait` times out on a healthy stack.

## Investigation

No commit changed the classifier's logic since #1429 (#1754 only keyed the
snapshot per server; #1990 moved the code verbatim). The failure is a state the
original design already listed as a risk. On HUP `docker compose up` stops its
container, but the stop takes up to the 10s grace period, and teardown does not
wait for foreign-held ports, so the 250ms restart gap snapshots the old container.
The in-memory `carriedPublished` forgives it only when this same app process saw
the previous run published. After an app restart, or once one start was poisoned,
every later restart records the daemon as a squatter again, and the loop never
breaks.

## Decision

`startOneDevServer` asks `docker ps` (`findWorktreeContainerPorts`,
`src/bun/container-ports.ts`) which host ports running containers publish whose
`com.docker.compose.project.working_dir` label is the task worktree or a folder
inside it, and drops those holders from the pre-start snapshot. It runs only when
an assigned port is already held at start. Status, `--wait`, the board poller and
the teardown carry all read the snapshot, so they agree.

## Risks

Only compose-labelled containers are recognised; a plain `docker run` stays a
conflict when it outlives a stop. The label is compared as a string, so a compose
working dir reached through a symlink does not match. A Docker CLI that hangs is
bounded by a 5s probe timeout.

## Alternatives considered

- **Trust any container runtime daemon as published** — loses the "another
  project's container on our port" conflict.
- **Persist `carriedPublished` to disk** — still fails on the first start after a
  container was left running, and adds on-disk state.
- **Wait for foreign-held ports to free on stop** — the next `up` may reuse the
  running container, so the port never frees.
