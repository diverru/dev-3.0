# File preview: wider prose measure in the fit size

## Context
`decisions/2026/10/13/file-preview-prose-column-and-fit-size.md` set the fit-size prose measure to 32rem (about 70–75 characters). The fit dialog is itself capped at 60rem, so the column left roughly 200px empty on each side, and the user found the preview wasted a third of its width.

## Decision
`--dev3-prose-measure` for the fit size is now 42rem (about 95 characters) in `TaskDiffViewer.css` (`.dev3-file-preview-md .dev3-md-doc`). The expanded size stays at 56rem, and the per-block breakout layout is unchanged. The original reason for the column still holds: on a full-screen dialog a short note would run to ~200 characters, and the 60rem dialog cap plus this measure still prevents that.

## Risks
95 characters is above the classic 65–75 range, so long paragraphs read a little harder. The dialog cap keeps it from growing further.

## Alternatives considered
40rem (~90 characters): a smaller gain than the user asked for. 44rem or no column: lines of 100–130 characters, too long for prose.
