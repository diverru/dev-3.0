# Dev builds get their own bundle identifier

## Context

macOS keeps WKWebView storage in `~/Library/WebKit/<bundle identifier>`. The dev build (`build/dev-macos-arm64/dev-3.0-dev.app`) and the installed app both used `dev3.electrobun.dev`, so they shared one localStorage. While a task's dev-server ran a desktop window, the installed app lost its diff "viewed" marks (`dev3-inline-diff-read-state-v1`): the last writer wins.

## Investigation

Electrobun's `partition` option would isolate storage without a new identifier, but in Electrobun 1.18.1 `BrowserWindow` does not pass `partition` to its `BrowserView`, and on macOS older than 14 a named partition falls back to the default store. The config module cannot read the build environment either: it is also bundled into the app (`src/bun/index.ts` reads `app.identifier` for Windows shortcuts), where `process.argv` has no `--env=`.

## Decision

`appIdentifier()` in `electrobun.config.ts` returns `dev3.electrobun.dev-build` when `DEV3_DEV_BUNDLE=1`, else `dev3.electrobun.dev`. `scripts/dev.ts` sets the variable for all of its steps and for the app it launches, so the build and the runtime config agree. CI release builds (`electrobun build --env=canary|stable`) never set it and keep the release identifier.

## Risks

A dev build now has its own macOS identity: it asks again once for notification permission, keeps separate TCC grants, and starts with empty localStorage (theme, locale, diff marks). Its `~/Library/Application Support/<identifier>/dev` folder also changes; nothing in dev3 stores data there for the dev channel, and `~/.dev3.0` is not keyed by identifier. A dev bundle made with a bare `electrobun build` (no `scripts/dev.ts`) still uses the release identifier.

## Alternatives considered

- Patch Electrobun to forward `partition`: a vendored patch to maintain, and no isolation before macOS 14.
- Pick the identifier from `--env=` in `process.argv`: correct at build time, but wrong at runtime in installed apps, which would break Windows shortcut ownership.
