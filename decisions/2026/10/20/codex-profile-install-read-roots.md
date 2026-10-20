# Grant the Codex installation read access in the dev3 permission profile

## 1. Context

The dev3 Codex permission profile reads only `:minimal`, the skill dirs and `~/.dev3.0`. On macOS Codex's sandbox helper re-execs Codex's own launcher inside the seatbelt sandbox, so with the install unreadable it died with `execvp() ... Operation not permitted` (seatbelt exit 71) and thread start failed. This relies on undocumented Codex behaviour and on its install layouts (standalone `~/.codex/packages/standalone/current -> releases/<v>`, Homebrew cask, npm global package).

## 2. Investigation

The first cut took the common prefix of the directories of every symlink hop. A chain such as `~/.local/bin/codex -> /opt/homebrew/bin/codex -> ../Caskroom/...` then granted the whole Homebrew prefix, hops in unrelated trees granted their common ancestor, and a prefix that collapsed to `$HOME` was dropped by the guard, leaving the install unreadable again.

## 3. Decision

`codexInstallReadRoots` in `src/bun/codex-config.ts` grants the directory of every link in the chain, plus one install root computed only from the last link and the real file (`installRootOf`, a trailing `bin` stepped out of). `guardInstallRoots` drops `/`, top-level dirs, `$HOME`, any ancestor of it, and `~/.codex` (it holds `auth.json`). Lines carry `# dev3: codex install` and `reconcileCodexInstallRoots` keeps them equal to the current set; `resolveCodexInstallRoots` runs before each launch, macOS only.

## 4. Risks

A new Codex layout whose last link and real file share no meaningful ancestor yields no install root, and the helper fails as before. Grants are read-only, so a wider-than-needed root leaks reads, never writes.

## 5. Alternatives considered

Granting the whole home dir or `/opt/homebrew` unconditionally — too broad. Running Codex's helper outside the sandbox — not ours to change. Hard-coding known install paths — breaks silently on every custom or future layout.
