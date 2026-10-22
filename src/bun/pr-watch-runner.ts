import type { Project, Task } from "../shared/types";
import type { PrWatch } from "../shared/pr-watch";
import { prStatusSubject, wrapPrStatusMessage } from "../shared/agent-message-envelope";
import * as data from "./data";
import * as git from "./git";
import { getPushMessage, log } from "./rpc-handlers/shared-pure";
import { applyPrWatchOutcome, evaluatePrWatches, upsertPrWatch, type PrWatchOutcome, type PrWatchSample } from "./pr-watch";

/** After a failed delivery the task is left alone this long, so a dead pane adds no log rows. */
export const PR_WATCH_RETRY_BACKOFF_MS = 5 * 60_000;

const retryAfter = new Map<string, number>();

export function _resetPrWatchRunnerState(): void {
	retryAfter.clear();
}

function isTerminal(task: Task): boolean {
	return task.status === "completed" || task.status === "cancelled";
}

/** Can the agent be typed into right now? Not while it waits on a question, sleeps, or has no pane. */
function agentCanReceive(task: Task): boolean {
	return !task.hibernated && task.status !== "user-questions" && (task.sessionState?.panes?.length ?? 0) > 0;
}

async function persistWatches(project: Project, taskId: string, change: (current: PrWatch[]) => PrWatch[]): Promise<Task> {
	const { task } = await data.updateTaskWith<void>(project, taskId, (current) => {
		const next = change(current.prWatches ?? []);
		return { updates: { prWatches: next.length > 0 ? next : null }, result: undefined };
	});
	getPushMessage()?.("taskUpdated", { projectId: project.id, task });
	return task;
}

export async function addPrWatch(project: Project, taskId: string, watch: PrWatch): Promise<Task> {
	return persistWatches(project, taskId, (current) => upsertPrWatch(current, watch));
}

/** Remove every watch of the task; returns how many there were. */
export async function clearPrWatches(project: Project, taskId: string): Promise<number> {
	let count = 0;
	await persistWatches(project, taskId, (current) => {
		count = current.length;
		return [];
	});
	return count;
}

/**
 * Judge the task's watches against a freshly polled PR and, when one fires, type
 * one message into the agent. Nothing is removed until the message was accepted:
 * an agent that cannot be reached keeps its watch and hears about it on a later poll.
 */
export async function runPrWatches(project: Project, taskId: string, sample: PrWatchSample, prUrl: string): Promise<void> {
	// Fresh read: the poll's task snapshot may predate a `--off` or a new subscription.
	const task = await data.getTask(project, taskId);
	const watches = task.prWatches ?? [];
	const worktree = task.worktreePath;
	if (watches.length === 0 || !worktree || isTerminal(task)) return;

	const outcome = await evaluatePrWatches(watches, sample, {
		hasCommit: (sha) => git.commitExists(worktree, sha),
		isAncestor: (ancestor, descendant) => git.isRefMergedInto(worktree, ancestor, descendant),
	});
	if (outcome.notices.length === 0) {
		if (Object.keys(outcome.patches).length > 0) {
			await persistWatches(project, taskId, (current) => applyPrWatchOutcome(current, outcome));
		}
		return;
	}
	if (!agentCanReceive(task) || (retryAfter.get(taskId) ?? 0) > Date.now()) return;

	const remaining = [...new Set(applyPrWatchOutcome(watches, outcome).map((watch) => watch.until))];
	const delivered = await deliver(task, outcome, sample.number, prUrl, remaining);
	if (!delivered) return;
	retryAfter.delete(taskId);
	await persistWatches(project, taskId, (current) => applyPrWatchOutcome(current, outcome));
}

async function deliver(
	task: Task,
	outcome: PrWatchOutcome,
	prNumber: number,
	prUrl: string,
	remaining: PrWatch["until"][],
): Promise<boolean> {
	try {
		// Loaded on demand: the scheduler pulls in the whole prompt-delivery stack.
		const { sendMessageImmediately } = await import("./scheduled-message-scheduler");
		const text = wrapPrStatusMessage({ prNumber, url: prUrl, notices: outcome.notices, remaining });
		const subject = prStatusSubject(prNumber, outcome.notices);
		await sendMessageImmediately(task, text, null, null, { subject, origin: "dev3" });
		return true;
	} catch (err) {
		retryAfter.set(task.id, Date.now() + PR_WATCH_RETRY_BACKOFF_MS);
		log.warn("PR watch message not delivered; the watch stays", { taskId: task.id.slice(0, 8), error: String(err) });
		return false;
	}
}
