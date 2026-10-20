import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../logger", () => ({
	createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("../spawn", () => ({ spawn: vi.fn(), spawnSync: vi.fn() }));
vi.mock("node:fs", async (original) => ({
	...await original<typeof import("node:fs")>(),
	existsSync: vi.fn(() => true),
	writeFileSync: vi.fn(),
}));

import { spawn } from "../spawn";
import { encodeResizeSequence } from "../../shared/resize-protocol";

interface WsHandlers {
	open(ws: unknown): void;
	message(ws: unknown, data: string): void;
	close(ws: unknown): void;
}
let handlers: WsHandlers;
const bun = globalThis as unknown as { Bun: { serve: (config: unknown) => unknown } };
const stubServe = bun.Bun.serve;
bun.Bun.serve = (config: unknown) => {
	handlers = (config as { websocket: WsHandlers }).websocket;
	return stubServe(config);
};
const pty = await import("../pty-server");
bun.Bun.serve = stubServe;
const TASK_ID = "redraw-test-task";
const terminal = { resize: vi.fn(), close: vi.fn(), write: vi.fn() };
const signal = vi.fn();

function connect() {
	const ws = { data: { url: new URL(`ws://localhost/?session=${TASK_ID}`) }, sendText: vi.fn() };
	handlers.open(ws);
	return ws;
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(spawn).mockReturnValue({
		pid: 123, terminal, kill: signal, exited: new Promise(() => {}),
	} as never);
	pty.createSession(TASK_ID, "project", "/tmp", "bash", {}, "test-socket");
});
afterEach(() => pty.destroySession(TASK_ID));

describe("tmux viewer redraw", () => {
	it("fills a fresh same-size viewer without resizing the agent", () => {
		const ws = connect();
		handlers.message(ws, encodeResizeSequence(220, 50));
		expect(terminal.resize).not.toHaveBeenCalled();
		expect(signal).toHaveBeenCalledWith("SIGWINCH");
	});

	it("redraws after reconnect without replaying or changing geometry", () => {
		const first = connect();
		handlers.message(first, encodeResizeSequence(120, 40));
		handlers.close(first);
		terminal.resize.mockClear();
		const next = connect();
		handlers.message(next, encodeResizeSequence(120, 40));
		expect(terminal.resize).not.toHaveBeenCalled();
		expect(signal.mock.calls).toEqual([["SIGWINCH"]]);
	});

	it("still resizes for a real viewport change", () => {
		const ws = connect();
		handlers.message(ws, encodeResizeSequence(120, 40));
		expect(terminal.resize.mock.calls).toEqual([[120, 40]]);
		expect(signal).not.toHaveBeenCalled();
	});

	it("keeps the smallest viewer size when a larger viewer connects", () => {
		handlers.message(connect(), encodeResizeSequence(120, 40));
		terminal.resize.mockClear();
		handlers.message(connect(), encodeResizeSequence(180, 60));
		expect(terminal.resize).not.toHaveBeenCalled();
		expect(signal.mock.calls).toEqual([["SIGWINCH"]]);
	});
});
