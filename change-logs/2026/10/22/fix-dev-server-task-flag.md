Short: dev-server args and --task fix

`dev3 dev-server` now honours `--task <id>` on start, stop, restart, status and logs instead of silently acting on the task the shell is in, and rejects a `--task` that contradicts a positional task id.
