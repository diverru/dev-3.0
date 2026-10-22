import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, Task } from "../../shared/types";
import type { PrWatch } from "../../shared/pr-watch";

const push = vi.hoisted(() => vi.fn());
vi.mock("../rpc-handlers/shared-pure", () => ({
	log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
	getPushMessage: () => push,
}));
vi.mock("../data", () => ({ getTask: vi.fn(), updateTaskWith: vi.fn() }));
vi.mock("../git", () => ({ commitExists: vi.fn(), isRefMergedInto: vi.fn() }));
vi.mock("../scheduled-message-scheduler", () => ({ sendMessageImmediately: vi.fn() }));

import * as data from "../data";
import * as git from "../git";
import { sendMessageImmediately } from "../scheduled-message-scheduler";
import { PR_WATCH_RETRY_BACKOFF_MS, _resetPrWatchRunnerState, addPrWatch, clearPrWatches, runPrWatches } from "../pr-watch-runner";

const HEAD = "2222222222222222222222222222222222222222";
const URL = "https://github.com/acme/app/pull/7";
const project = { id: "p1" } as Project;

function watch(until: PrWatch["until"], overrides: Partial<PrWatch> = {}): PrWatch {
	return { id: `w-${until}`, until, prNumber: 7, headSha: HEAD, createdAt: "2026-10-22T10:00:00.000Z", ...overrides };
}

function task(overrides: Partial<Task> = {}): Task {
	return {
		id: "t1",
		status: "in-progress",
		worktreePath: "/wt",
		prWatches: [watch("ci")],
		sessionState: { panes: [{ id: "%1" }] },
		...overrides,
	} as unknown as Task;
}

const greenSample = { number: 7, state: "OPEN", headRefOid: HEAD, checks: [{ name: "lint", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: null }] };
const pendingSample = { ...greenSample, checks: [{ name: "lint", status: "IN_PROGRESS", conclusion: null, detailsUrl: null }] };

const stored: Array<Partial<Task>> = [];

/** What the task's watches were rewritten to by the last `updateTaskWith`. */
function lastStoredWatches(): PrWatch[] | null | undefined {
	return stored[stored.length - 1]?.prWatches;
}

let current: Task;

beforeEach(() => {
	vi.resetAllMocks();
	_resetPrWatchRunnerState();
	current = task();
	stored.length = 0;
	vi.mocked(data.getTask).mockImplementation(async () => current);
	vi.mocked(data.updateTaskWith).mockImplementation(async (_p, _id, mutator) => {
		const { updates, result } = await mutator(current);
		stored.push(updates);
		return { task: { ...current, ...updates } as Task, result };
	});
	vi.mocked(git.commitExists).mockResolvedValue(true);
	vi.mocked(git.isRefMergedInto).mockResolvedValue(false);
	vi.mocked(sendMessageImmediately).mockResolvedValue({ status: "held", spilledPath: null });
});

describe("runPrWatches", () => {
	it("sends one dev3-origin message and removes the watch once it is accepted", async () => {
		await runPrWatches(project, "t1", greenSample, URL);

		expect(sendMessageImmediately).toHaveBeenCalledTimes(1);
		const [, text, target, source, opts] = vi.mocked(sendMessageImmediately).mock.calls[0];
		expect(text).toContain("<dev3-pr-status>");
		expect(text).toContain("PR #7: CI passed on 2222222.");
		expect([target, source]).toEqual([null, null]);
		expect(opts).toEqual({ subject: "PR #7: CI passed", origin: "dev3" });
		expect(lastStoredWatches()).toBeNull();
	});

	it("sends nothing and changes nothing while CI is pending", async () => {
		await runPrWatches(project, "t1", pendingSample, URL);
		expect(sendMessageImmediately).not.toHaveBeenCalled();
		expect(data.updateTaskWith).not.toHaveBeenCalled();
	});

	it("does nothing for a task without watches", async () => {
		current = task({ prWatches: null });
		await runPrWatches(project, "t1", greenSample, URL);
		expect(sendMessageImmediately).not.toHaveBeenCalled();
		expect(git.commitExists).not.toHaveBeenCalled();
	});

	for (const [name, overrides] of [
		["hibernated", { hibernated: true }],
		["waiting on a question", { status: "user-questions" }],
		["without a live agent pane", { sessionState: { panes: [] } }],
	] as const) {
		it(`keeps the watch and sends nothing while the task is ${name}`, async () => {
			current = task(overrides as Partial<Task>);
			await runPrWatches(project, "t1", greenSample, URL);
			expect(sendMessageImmediately).not.toHaveBeenCalled();
			expect(data.updateTaskWith).not.toHaveBeenCalled();
		});
	}

	it("keeps the watch when delivery is not delivered, and does not retry before the backoff", async () => {
		vi.mocked(sendMessageImmediately).mockRejectedValue(new Error("no live agent session"));
		await runPrWatches(project, "t1", greenSample, URL);
		await runPrWatches(project, "t1", greenSample, URL);

		expect(sendMessageImmediately).toHaveBeenCalledTimes(1);
		expect(data.updateTaskWith).not.toHaveBeenCalled();
	});

	it("retries once the backoff has passed, and then removes the watch", async () => {
		vi.mocked(sendMessageImmediately).mockRejectedValueOnce(new Error("no live agent session"));
		const now = Date.now();
		const clock = vi.spyOn(Date, "now").mockReturnValue(now);
		await runPrWatches(project, "t1", greenSample, URL);
		clock.mockReturnValue(now + PR_WATCH_RETRY_BACKOFF_MS + 1);
		await runPrWatches(project, "t1", greenSample, URL);
		clock.mockRestore();

		expect(sendMessageImmediately).toHaveBeenCalledTimes(2);
		expect(lastStoredWatches()).toBeNull();
	});

	it("keeps a merged-watch after reporting a red CI, and records the head it reported", async () => {
		current = task({ prWatches: [watch("merged")] });
		const red = { ...greenSample, checks: [{ name: "lint", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: null }] };
		await runPrWatches(project, "t1", red, URL);

		expect(vi.mocked(sendMessageImmediately).mock.calls[0][1]).toContain("Watch until merged stays active.");
		expect(lastStoredWatches()).toEqual([watch("merged", { failedNotifiedHead: HEAD })]);
	});

	it("stores a retarget without sending anything", async () => {
		current = task({ prWatches: [watch("ci", { headSha: "0".repeat(40) })] });
		await runPrWatches(project, "t1", pendingSample, URL);

		expect(sendMessageImmediately).not.toHaveBeenCalled();
		expect(lastStoredWatches()).toEqual([watch("ci")]);
	});

	it("ignores a finished task", async () => {
		current = task({ status: "completed" });
		await runPrWatches(project, "t1", greenSample, URL);
		expect(sendMessageImmediately).not.toHaveBeenCalled();
	});
});

describe("watch storage", () => {
	it("pushes the updated task after adding a watch", async () => {
		current = task({ prWatches: null });
		await addPrWatch(project, "t1", watch("ci"));
		expect(lastStoredWatches()).toEqual([watch("ci")]);
		expect(push).toHaveBeenCalledWith("taskUpdated", expect.objectContaining({ projectId: "p1" }));
	});

	it("clears every watch and says how many there were", async () => {
		current = task({ prWatches: [watch("ci"), watch("merged")] });
		expect(await clearPrWatches(project, "t1")).toBe(2);
		expect(lastStoredWatches()).toBeNull();
	});
});
