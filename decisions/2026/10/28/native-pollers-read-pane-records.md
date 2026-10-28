# Native pollers read pane records, not recovery

## Context
Native-terminal tasks have no tmux session and no `session.proc`, so the port scanner, the dev-server board read and the resource monitor saw nothing of them. The native read that already existed (`auxPaneAlive`, `nativeAuxPaneShellPid`) runs full ownership recovery (`ps` checks plus a disk reconcile) per call, far too heavy for tickers that fire every 10 seconds per task.

## Decision
Pollers read the on-disk records only. `NativeTerminalBackend.readPaneRecords` / `listCoordinatorIds` (`terminal-backend/native-backend.ts`) are exposed as `nativeTaskPaneRecords` / `nativeTaskIdsOnDisk` (`native-task-panes.ts`) and injected into `port-scanner.ts` through `setNativePaneRecordsReader`, registered in `index.ts` and `headless-entry.ts` (`native-scan-readers.ts`). The injection keeps `port-scanner.ts` free of `native-*` imports (renderer-bundle safety, registry isolation tests). A pane is live when the shared `ps` tree shows its recorded shell as a child of its recorded host (`nativeTaskPaneRoots`). `getActiveSessionIds` lists bound native sessions with an empty socket, and the port poll also adds on-disk native tasks with a live pane, so surviving aux panes are still polled after the primary shell exits. An empty process table counts as "not measured" and skips the cycle. Native scanning is off on win32, which has no `ps`/`lsof`.

## Risks
The parent/child check does not prove ownership: after a pid reuse a recycled host pid could adopt an unrelated process as the "shell". The record's start signatures are what recovery uses to rule that out, and the pollers do not check them. The consequence is a wrong port or CPU figure on a card until the stale record is cleaned, never a kill or a write. Records are read each tick, so a large number of native tasks costs file reads, not spawns.

## Alternatives considered
Running recovery (`readPaneSet`) from the pollers: rejected, it spawns `ps` per pane and reconciles disk state from a read-only loop. Importing the registry into `port-scanner.ts` and extending the isolation allowlists: rejected, it breaks the single-seam rule. Probing `ps` for the host command line instead of reading records: rejected, per-tick parsing of every command line and no pane-to-task link.
