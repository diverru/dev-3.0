# Redraw terminals without synthetic resizing

## Context

Opening a terminal and returning to a hidden page used a one-row resize dance to refill the renderer. Inline Codex sessions can respond by printing history again, making the terminal visibly scroll through old output.

## Investigation

On a live Codex task, a height-only resize pair generated 215,894 UTF-8 WebSocket bytes over 6.127 seconds. Plain `refresh-client` was fast but lost scroll-up after a fresh Ghostty mount: it repaints without restoring mouse modes, reproducing the regression reported when PR #1731 was reverted in #1733. A live tmux/Ghostty test confirms that signaling the attached tmux client at unchanged geometry restores mouse modes and scrolling without signaling the pane application.

## Decision

`TerminalView.tsx` reports the actual size once on open and foreground refresh, waiting for the initial layout to settle through its existing 100 ms refit debounce before connecting. In `pty-server.ts::applyClientSizes`, an unchanged tmux size sends `SIGWINCH` to the attached client process: tmux reinitializes its outer terminal without changing pane geometry. Native does nothing for unchanged geometry; `reconnectPtyOnResume` replaces even an open socket after a hidden→visible cycle and requests journal replay from the last watermark, so foreground restoration does not require resizing. The remote PTY proxy retains the latest early geometry report until its upstream opens; the old second resize accidentally masked this race.

## Risks

A real viewport change can still trigger Codex history reflow, including the first attachment at a different size. Client reinitialization depends on tmux behavior, covered by a real tmux/Ghostty remount and wheel-scroll test that also checks unchanged pane geometry and absence of application `SIGWINCH`. Explicit Hard Reset retains its original resize dance; the redraw still uses tmux output rather than a capture whose width could be stale.

## Alternatives considered

Removing `--no-alt-screen` changes Codex history navigation and cannot repair an already running session. Merely deleting the renderer dance leaves fresh same-size viewers blank because tmux has no reason to repaint; plain `refresh-client` fails to restore their mouse tracking. Artificial row changes notify inline Codex and trigger the history replay we are avoiding.
