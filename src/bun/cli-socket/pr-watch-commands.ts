import { PR_WATCH_NO_PR_PREFIX, PR_WATCH_UNTIL, type PrWatch, type PrWatchUntil } from "../../shared/pr-watch";
import type { Project, Task } from "../../shared/types";
import * as git from "../git";
import * as github from "../github";
import { addPrWatch, clearPrWatches } from "../pr-watch-runner";
import type { Handler } from "./shared";
import { resolveTaskFromParams } from "./task-resolution";

function noPr(message: string): Error {
	return new Error(`${PR_WATCH_NO_PR_PREFIX}${message}`);
}

/** `--pr N` wins, then the PR recorded on the task, then the open PR of the task's branch. */
async function resolveWatchedPr(
	project: Project,
	task: Task,
	worktree: string,
	explicit: number | null,
): Promise<{ number: number; url: string }> {
	if (explicit !== null) {
		if (explicit === task.prNumber && task.prUrl) return { number: explicit, url: task.prUrl };
		const view = await github.runGitHub(project, worktree, ["pr", "view", String(explicit), "--json", "number,url"]);
		try {
			const parsed = JSON.parse(view.stdout) as { number?: unknown; url?: unknown };
			if (view.ok && parsed.number === explicit) return { number: explicit, url: typeof parsed.url === "string" ? parsed.url : "" };
		} catch {
			// Unparseable output reads as "not found" below.
		}
		throw noPr(`Pull request #${explicit} was not found. Check the number, or drop --pr.`);
	}
	if (task.prNumber != null) return { number: task.prNumber, url: task.prUrl ?? "" };
	const branch = (await git.getCurrentBranch(worktree)) ?? task.branchName ?? "";
	const { pr } = await github.findOpenPullRequest(project, worktree, branch);
	if (!pr) {
		throw noPr(`No open pull request found for ${branch || "this task"}. Open it with \`dev3 pr create\`, or pass --pr <N>.`);
	}
	return { number: pr.number, url: pr.url };
}

function watchListing(watch: PrWatch) {
	return { until: watch.until, prNumber: watch.prNumber, headSha: watch.headSha.slice(0, 7), createdAt: watch.createdAt };
}

export const prWatchHandlers: Record<string, Handler> = {
	// `dev3 pr watch [--until ci|merged] [--pr N]`: store the subscription and return at once.
	"pr.watch.add": async (params) => {
		const until = params.until as PrWatchUntil;
		if (!PR_WATCH_UNTIL.includes(until)) throw new Error(`--until takes ${PR_WATCH_UNTIL.join(" or ")}.`);
		const { project, task } = await resolveTaskFromParams(params);
		const worktree = task.worktreePath;
		if (!worktree || task.status === "completed" || task.status === "cancelled") {
			throw new Error("Only a task with a live worktree can watch a pull request.");
		}
		const explicit = params.prNumber === undefined ? null : Number(params.prNumber);
		if (explicit !== null && !(Number.isInteger(explicit) && explicit > 0)) throw new Error("--pr takes a pull request number.");
		const pr = await resolveWatchedPr(project, task, worktree, explicit);
		const headSha = await git.getHeadSha(worktree);
		if (!headSha) throw new Error("Could not read this worktree's HEAD.");

		// Loaded on demand: the lifecycle modules pull in the Electrobun-backed shared module.
		const [{ persistTaskPrIdentity }, { lifecycleActorRuntime }] = await Promise.all([
			import("../lifecycle/activities"),
			import("../lifecycle/service"),
		]);
		// The poller only watches tasks with a stored PR identity.
		if (task.prNumber == null && pr.url) await persistTaskPrIdentity(project, task, pr.number, pr.url);
		const watch: PrWatch = { id: crypto.randomUUID(), until, prNumber: pr.number, headSha, createdAt: new Date().toISOString() };
		await addPrWatch(project, task.id, watch);
		delete lifecycleActorRuntime(task.id).prNextDue;
		return { taskId: task.id, projectId: project.id, until, prNumber: pr.number };
	},

	"pr.watch.list": async (params) => {
		const { project, task } = await resolveTaskFromParams(params);
		return { taskId: task.id, projectId: project.id, watches: (task.prWatches ?? []).map(watchListing) };
	},

	"pr.watch.off": async (params) => {
		const { project, task } = await resolveTaskFromParams(params);
		return { taskId: task.id, projectId: project.id, removed: await clearPrWatches(project, task.id) };
	},
};
