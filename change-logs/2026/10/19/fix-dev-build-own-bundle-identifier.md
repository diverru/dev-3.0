Dev builds started with `bun run dev` now use their own bundle identifier, so their WebKit storage no longer overwrites the installed app's localStorage (for example, the "viewed" marks in the diff).
