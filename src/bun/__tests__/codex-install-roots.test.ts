import { afterAll, describe, expect, it } from "vitest";
import { load } from "js-toml";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { codexInstallReadRoots, ensureCodexConfig } from "../codex-config";

const WORKTREES = "/Users/testuser/.dev3.0/worktrees";
const SOCKETS = "/Users/testuser/.dev3.0/sockets";
const MARKER = "# dev3: codex install";

const dirs: string[] = [];
function tmp(): string {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "codex-install-")));
	dirs.push(dir);
	return dir;
}
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function touch(path: string): void {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, "");
}

/** ~/.local/bin/codex -> ~/.codex/packages/standalone/current/bin/codex, current -> releases/<v>. */
function standalone(home: string, release: string): string {
	const standaloneDir = join(home, ".codex", "packages", "standalone");
	touch(join(standaloneDir, "releases", release, "bin", "codex"));
	symlinkSync(join("releases", release), join(standaloneDir, "current"));
	mkdirSync(join(home, ".local", "bin"), { recursive: true });
	const launcher = join(home, ".local", "bin", "codex");
	symlinkSync(join(standaloneDir, "current", "bin", "codex"), launcher);
	return launcher;
}

function filesystem(config: string): Record<string, unknown> {
	const parsed = load(config) as { permissions: { dev3: { filesystem: Record<string, unknown> } } };
	return parsed.permissions.dev3.filesystem;
}

describe.skipIf(process.platform === "win32")("codexInstallReadRoots", () => {
	it("returns the launcher dir and the standalone install root", () => {
		const home = tmp();
		const launcher = standalone(home, "0.163.0-aarch64-apple-darwin");
		expect(codexInstallReadRoots(launcher)).toEqual([
			join(home, ".local", "bin"),
			join(home, ".codex", "packages", "standalone"),
		]);
	});

	it("follows a relative Homebrew cask link", () => {
		const prefix = tmp();
		const cask = join(prefix, "Caskroom", "codex", "0.1.0");
		touch(join(cask, "codex-aarch64-apple-darwin"));
		mkdirSync(join(prefix, "bin"));
		symlinkSync("../Caskroom/codex/0.1.0/codex-aarch64-apple-darwin", join(prefix, "bin", "codex"));
		expect(codexInstallReadRoots(join(prefix, "bin", "codex"))).toEqual([join(prefix, "bin"), cask]);
	});

	it("follows an npm global link and steps out of the package bin dir", () => {
		const prefix = tmp();
		const pkg = join(prefix, "lib", "node_modules", "@openai", "codex");
		touch(join(pkg, "bin", "codex.js"));
		mkdirSync(join(prefix, "bin"));
		symlinkSync("../lib/node_modules/@openai/codex/bin/codex.js", join(prefix, "bin", "codex"));
		expect(codexInstallReadRoots(join(prefix, "bin", "codex"))).toEqual([join(prefix, "bin"), pkg]);
	});

	it("returns only the launcher dir for a plain file", () => {
		const dir = tmp();
		touch(join(dir, "codex"));
		expect(codexInstallReadRoots(join(dir, "codex"))).toEqual([dir]);
	});

	it("returns nothing for a missing launcher", () => {
		expect(codexInstallReadRoots(join(tmp(), "nope"))).toEqual([]);
	});
});

describe.skipIf(process.platform === "win32")("ensureCodexConfig codexInstallRoots", () => {
	it("writes the roots as managed read grants into a new dev3 profile", () => {
		const home = tmp();
		const roots = codexInstallReadRoots(standalone(home, "0.163.0"));
		const result = ensureCodexConfig(null, WORKTREES, SOCKETS, [], { codexInstallRoots: roots });
		const fs = filesystem(result);
		for (const root of roots) {
			expect(fs[root]).toBe("read");
			expect(result).toContain(`"${root}" = "read" ${MARKER}`);
		}
	});

	it("adds the roots to an existing dev3 profile", () => {
		const base = ensureCodexConfig(null, WORKTREES, SOCKETS);
		const result = ensureCodexConfig(base, WORKTREES, SOCKETS, [], { codexInstallRoots: ["/opt/a/bin", "/opt/a/pkg"] });
		expect(filesystem(result)["/opt/a/bin"]).toBe("read");
		expect(filesystem(result)["/opt/a/pkg"]).toBe("read");
	});

	it("swaps stale managed lines when the install moves", () => {
		const first = ensureCodexConfig(null, WORKTREES, SOCKETS, [], { codexInstallRoots: ["/opt/a/bin", "/opt/a/old"] });
		const second = ensureCodexConfig(first, WORKTREES, SOCKETS, [], { codexInstallRoots: ["/opt/a/bin", "/opt/b/new"] });
		const fs = filesystem(second);
		expect(fs["/opt/a/old"]).toBeUndefined();
		expect(fs["/opt/b/new"]).toBe("read");
		expect(fs["/opt/a/bin"]).toBe("read");
		expect(second.match(/"\/opt\/a\/bin"/g)).toHaveLength(1);
	});

	it("is a no-op on a second run and ignores roots when the option is unset", () => {
		const first = ensureCodexConfig(null, WORKTREES, SOCKETS, [], { codexInstallRoots: ["/opt/a/bin"] });
		expect(ensureCodexConfig(first, WORKTREES, SOCKETS, [], { codexInstallRoots: ["/opt/a/bin"] })).toBe(first);
		expect(ensureCodexConfig(first, WORKTREES, SOCKETS)).toBe(first);
	});

	it("keeps the user's own entries and does not duplicate a path they already granted", () => {
		const base = ensureCodexConfig(null, WORKTREES, SOCKETS).replace(
			'":minimal" = "read"',
			'":minimal" = "read"\n"/opt/a/bin" = "read"\n"/opt/custom" = "write"',
		);
		const result = ensureCodexConfig(base, WORKTREES, SOCKETS, [], { codexInstallRoots: ["/opt/a/bin", "/opt/a/pkg"] });
		const fs = filesystem(result);
		expect(result.match(/"\/opt\/a\/bin"/g)).toHaveLength(1);
		expect(result).not.toContain(`"/opt/a/bin" = "read" ${MARKER}`);
		expect(fs["/opt/custom"]).toBe("write");
		expect(fs["/opt/a/pkg"]).toBe("read");

		const dropped = ensureCodexConfig(result, WORKTREES, SOCKETS, [], { codexInstallRoots: [] });
		expect(filesystem(dropped)["/opt/a/bin"]).toBe("read");
		expect(filesystem(dropped)["/opt/a/pkg"]).toBeUndefined();
	});

	it("never grants write to a root", () => {
		const before = filesystem(ensureCodexConfig(null, WORKTREES, SOCKETS));
		const after = filesystem(ensureCodexConfig(null, WORKTREES, SOCKETS, [], { codexInstallRoots: ["/opt/a/bin", "/opt/a/pkg"] }));
		const added = Object.keys(after).filter((key) => !(key in before));
		expect(added.sort()).toEqual(["/opt/a/bin", "/opt/a/pkg"]);
		for (const key of added) expect(after[key]).toBe("read");
		expect(Object.values(after).filter((mode) => mode === "write")).toHaveLength(
			Object.values(before).filter((mode) => mode === "write").length,
		);
	});
});
