# Redraw terminals without synthetic resizing

## Context

Opening a terminal and returning to a hidden page used a one-row resize dance to refill the renderer. Inline Codex sessions can respond by printing history again, making the terminal visibly scroll through old output.

## Investigation

On a live Codex task, a height-only resize pair generated 215,894 UTF-8 WebSocket bytes over 6.127 seconds. A `tmux refresh-client` at unchanged geometry generated 5,554 bytes, with the last packet arriving after 28.5 ms. The existing workaround and stale-width capture hazards are documented in `decisions/2026/04/24/defer-initial-capture-pane-on-reconnect.md`.

## Decision

`TerminalView.tsx` reports the actual size once on open and foreground refresh, waiting for the initial layout to settle through its existing 100 ms refit debounce before connecting. In `pty-server.ts::applyClientSizes`, an unchanged tmux size calls `TmuxClient.refreshAttachedClient`, which selects the attached process by PID and refreshes its tty; native already provides its attach replay and does nothing for unchanged geometry. The remote PTY proxy retains the latest early geometry report until its upstream opens: the old second resize accidentally masked this race. Real size changes and the explicit Hard Reset resize dance remain as before.

## Risks

A real viewport change can still trigger Codex history reflow, including the first attachment at a different size. Refreshing needs two bounded tmux commands; a detached client is ignored, and command failures are logged. The redraw uses tmux's own output rather than a capture whose width could be stale.

## Alternatives considered

Removing `--no-alt-screen` changes Codex history navigation and cannot repair an already running session. Merely deleting the renderer dance leaves fresh same-size viewers blank because tmux has no reason to repaint; the server's own same-size nudge must also be replaced. Explicit Hard Reset retains its shell resize because the native backend cannot refill a manually cleared renderer through tmux refresh.
