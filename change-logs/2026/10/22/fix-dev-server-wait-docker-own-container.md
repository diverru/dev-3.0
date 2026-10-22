Short: dev-server --wait sees Docker ports

`dev3 dev-server start/restart --wait` and the status warning now treat a port published by this task's own docker compose container as the dev server's port, even when the previous run's container was still up at start; a container from another compose project on that port is still reported as a conflict.
