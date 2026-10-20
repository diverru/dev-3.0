# Suppress the Codex startup update menu in dev3 launches

## Context

A dev3-launched Codex 0.162.1 selected its default "Update now" action, installed 0.163.0 and exited successfully, leaving the worktree shell. The startup menu can consume an automatic Enter before a working conversation exists.

## Investigation

The incident's dev3 log records the immediate launch handoff completing 838 ms after its message file was written, consistent with `agentPromptStages` sending Enter after 800 ms; individual keystrokes were not recorded. Codex's [update prompt](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/tui/src/update_prompt.rs) ignores pasted text and selects "Update now" on Enter, while its [startup path](https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/tui/src/lib.rs#L1177-L1193) returns an update action with no conversation ID; a nonempty CLI prompt skips that menu, but scratch and resume launches may have none.

## Decision

`codexAdapter.launchArgs` and `codexAdapter.buildResumeCommand` in `src/shared/agent-adapters/codex.ts` append `-c check_for_update_on_startup=false`; placing it after preset arguments makes it authoritative for dev3 launches. The [documented setting](https://learn.chatgpt.com/docs/config-file/config-reference) disables the check and menu without rewriting user config; updating Codex remains manual through `codex update` between sessions.

## Risks

dev3 sessions no longer advertise new Codex releases, so users must update separately. This removes the update-menu failure only; it does not change message delivery, agent liveness, ordinary exit handling or permission-profile refresh after an external update.

## Alternatives considered

Pre-launch noninteractive updating is supported by `codex update` and the standalone installer's `CODEX_NON_INTERACTIVE=1`, but adds network delay, timeout/concurrency handling and a requirement to refresh the executable path and permission profile after installation (PR #2024). Restarting after a TUI update leaves the input-consuming menu intact, has no distinct exit code, and cannot resume a fresh conversation that has no ID yet; the user chose suppression alone.
