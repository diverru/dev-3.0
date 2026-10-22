import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, Task } from "../../shared/types";
import { PR_WATCH_NO_PR_PREFIX } from "../../shared/pr-watch";

const runtime = vi.hoisted(() => ({ prNextDue: 123 as number | undefined }));
vi.mock("../data", () => ({ getProject: vi.fn(), loadTasks: vi.fn(), loadProjects: vi.fn(async () => []), loadVirtualProjects: vi.fn(async () => []) }));
vi.mock("../git", () => ({ getCurrentBranch: vi.fn(), getHeadSha: vi.fn() }));
vi.mock("../github", () => ({ runGitHub: vi.fn(), findOpenPullRequest: vi.fn() }));
vi.mock("../lifecycle/activities", () => ({ persistTaskPrIdentity: vi.fn() }));
vi.mock("../lifecycle/service", () => ({ lifecycleActorRuntime: () => runtime }));
vi.mock("../pr-watch-runner", () => ({ addPrWatch: vi.fn(), clearPrWatches: vi.fn(async () => 2) }));

import * as data from "../data";
import * as git from "../git";
import * as github from "../github";
import { persistTaskPrIdentity } from "../lifecycle/activities";
import { addPrWatch } from "../pr-watch-runner";
import { prWatchHandlers } from "../cli-socket/pr-watch-commands";

const project = { id: "p1" } as Project;
const HEAD = "a".repeat(40);
let task: Task;

const add = (extra: Record<string, unknown> = {}) =>
	prWatchHandlers["pr.watch.add"]({ taskId: "t1", projectId: "p1", until: "ci", ...extra });

beforeEach(() => {
	vi.resetAllMocks();
	runtime.prNextDue = 123;
	task = { id: "t1", seq: 1, status: "in-progress", worktreePath: "/wt", branchName: "feat/x", prNumber: null, prUrl: null } as unknown as Task;
	vi.mocked(data.getProject).mockResolvedValue(project);
	vi.mocked(data.loadTasks).mockImplementation(async () => [task]);
	vi.mocked(git.getCurrentBranch).mockResolvedValue("feat/x");
	vi.mocked(git.getHeadSha).mockResolvedValue(HEAD);
	vi.mocked(github.findOpenPullRequest).mockResolvedValue({ pr: { number: 7, url: "https://github.com/a/b/pull/7", title: null, author: null }, isGitHub: true });
});

describe("pr.watch.add", () => {
	it("looks up the open PR of the branch, records its identity and stores the watch at the local HEAD", async () => {
		const res = await add();

		expect(persistTaskPrIdentity).toHaveBeenCalledWith(project, task, 7, "https://github.com/a/b/pull/7");
		expect(vi.mocked(addPrWatch).mock.calls[0][2]).toMatchObject({ until: "ci", prNumber: 7, headSha: HEAD });
		expect(res).toMatchObject({ prNumber: 7, until: "ci" });
	});

	it("resets the poll schedule so the next tick checks the PR", async () => {
		await add();
		expect(runtime.prNextDue).toBeUndefined();
	});

	it("prefers the PR recorded on the task over a lookup", async () => {
		task = { ...task, prNumber: 5, prUrl: "https://github.com/a/b/pull/5" } as Task;
		await add();
		expect(github.findOpenPullRequest).not.toHaveBeenCalled();
		expect(persistTaskPrIdentity).not.toHaveBeenCalled();
		expect(vi.mocked(addPrWatch).mock.calls[0][2]).toMatchObject({ prNumber: 5 });
	});

	it("lets --pr win and checks that it exists", async () => {
		task = { ...task, prNumber: 5, prUrl: "https://github.com/a/b/pull/5" } as Task;
		vi.mocked(github.runGitHub).mockResolvedValue({ ok: true, stdout: JSON.stringify({ number: 9, url: "https://github.com/a/b/pull/9" }), stderr: "", code: 0 });

		await add({ prNumber: 9 });

		expect(vi.mocked(addPrWatch).mock.calls[0][2]).toMatchObject({ prNumber: 9 });
	});

	it("fails with the no-PR prefix when --pr names nothing", async () => {
		vi.mocked(github.runGitHub).mockResolvedValue({ ok: false, stdout: "", stderr: "not found", code: 1 });
		await expect(add({ prNumber: 99 })).rejects.toThrow(PR_WATCH_NO_PR_PREFIX);
		expect(addPrWatch).not.toHaveBeenCalled();
	});

	it("fails with the no-PR prefix when the branch has no open PR, and stores nothing", async () => {
		vi.mocked(github.findOpenPullRequest).mockResolvedValue({ pr: null, isGitHub: true });
		await expect(add()).rejects.toThrow(PR_WATCH_NO_PR_PREFIX);
		expect(addPrWatch).not.toHaveBeenCalled();
		expect(persistTaskPrIdentity).not.toHaveBeenCalled();
	});

	it("rejects an unknown kind and a task with no worktree", async () => {
		await expect(add({ until: "review" })).rejects.toThrow("--until takes ci or merged");
		task = { ...task, worktreePath: null } as Task;
		await expect(add()).rejects.toThrow("live worktree");
	});
});

describe("pr.watch.off and pr.watch.list", () => {
	it("reports how many watches were removed", async () => {
		expect(await prWatchHandlers["pr.watch.off"]({ taskId: "t1", projectId: "p1" })).toMatchObject({ removed: 2 });
	});

	it("lists watches with a short head", async () => {
		task = { ...task, prWatches: [{ id: "w", until: "merged", prNumber: 7, headSha: HEAD, createdAt: "2026-10-22T10:00:00.000Z" }] } as Task;
		const res = (await prWatchHandlers["pr.watch.list"]({ taskId: "t1", projectId: "p1" })) as { watches: unknown[] };
		expect(res.watches).toEqual([{ until: "merged", prNumber: 7, headSha: "aaaaaaa", createdAt: "2026-10-22T10:00:00.000Z" }]);
	});
});
