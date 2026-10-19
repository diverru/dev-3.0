# Diff review anchors its scroll position in JavaScript

## Context
Diff file sections activate lazily: a ~136px placeholder becomes a full diff thousands of pixels high. When this happens above the viewport, content jumps. Scrolling up after a far jump moved content by 40-160k px, and jump-to-file drifted by 22-110k px.

## Investigation
A native probe showed WKWebView on macOS 26.5 has no scroll anchoring at all: `CSS.supports('overflow-anchor','none')` is false and `scrollTop` does not compensate. Chromium's native anchoring also lost the anchor on jump-to-file while sections were building.

## Decision
`anchorScrollRegion` (`src/mainview/utils/scroll-anchor.ts`) tracks the first visible file section (or the one straddling the top) and, on every scroll and child resize, corrects `scrollTop` by the anchor's drift. `TaskDiffViewer` attaches it to the scroll region and sets `overflow-anchor: none` so Chromium does not compensate twice. At `scrollTop` 0 nothing is compensated, as in browsers, so new content above stays visible. WebKit hands a user scroll position to the main thread before its scroll event, so a ResizeObserver callback cannot tell a user scroll from a programmatic one by timing. Programmatic scrolls computed against the current layout (`scrollTo`, `scrollIntoView`) therefore call `reanchor()` right after, which re-captures the anchor without compensation. Sections still showing the loading placeholder (`data-scroll-anchor-pending`) are weak anchors, used only when no built section is in view or straddling the top, because a placeholder in view grows by up to 100k px without moving its own top.

## Risks
The anchor is a whole file section, so height changes above the viewport inside the straddling section are not compensated. Writing `scrollTop` cancels an in-flight smooth scroll.

## Alternatives considered
Reserving an estimated placeholder height: rejected, the line count is unknown before the build and it still drifts. Dropping lazy activation: rejected, too costly on huge diffs. Relying on native `overflow-anchor`: rejected, WebKit does not implement it.
