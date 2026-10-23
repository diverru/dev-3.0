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
// Two overlapping polls of one task (timer tick, popover refresh) must not both deliver.
const inFlight = new Set<string>();

export function _resetPrWatchRunnerState(): void {
	retryAfter.clear();
	inFlight.clear();
}

function isTerminal(task: Task): boolean {
	return task.status === "completed" || task.status === "cancelled";
}

/** Can the agent be typed into right now? Not while it waits on a question, sleeps, or has no pane. */
function agentCanReceive(task: Task): boolean {
	return !task.hibernated && task.status !== "user-questions" && (task.sessionState?.panes?.length ?? 0) > 0;
}

async function persistWatches(project: Project, taskId: string, change: (current: PrWatch[], task: Task) => PrWatch[]): Promise<Task> {
	const { task } = await data.updateTaskWith<void>(project, taskId, (current) => {
		const next = change(current.prWatches ?? [], current);
		return { updates: { prWatches: next.length > 0 ? next : null }, result: undefined };
	});
	getPushMessage()?.("taskUpdated", { projectId: project.id, task });
	return task;
}

export async function addPrWatch(project: Project, taskId: string, watch: PrWatch): Promise<Task> {
	return persistWatches(project, taskId, (current, task) => {
		// The task may have ended while the subscribe handler waited on gh and ps.
		if (isTerminal(task)) throw new Error("The task has finished; there is nothing left to watch for.");
		return upsertPrWatch(current, watch);
	});
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
 * Judge the task's watches against a freshly polled PR and, when some fire, type
 * one message per subscribing agent into its pane. Nothing is removed until the
 * message was accepted: an agent that cannot be reached keeps its watch and hears
 * about it on a later poll.
 */
export async function runPrWatches(project: Project, taskId: string, sample: PrWatchSample, prUrl: string): Promise<void> {
	if (inFlight.has(taskId)) return;
	inFlight.add(taskId);
	try {
		await runPrWatchesOnce(project, taskId, sample, prUrl);
	} finally {
		inFlight.delete(taskId);
	}
}

async function runPrWatchesOnce(project: Project, taskId: string, sample: PrWatchSample, prUrl: string): Promise<void> {
	// Fresh read: the poll's task snapshot may predate a `--off` or a new subscription.
	const task = await data.getTask(project, taskId);
	const watches = task.prWatches ?? [];
	const worktree = task.worktreePath;
	if (watches.length === 0 || !worktree || isTerminal(task)) return;

	const outcome = await evaluatePrWatches(watches, sample, {
		tip: (await git.getUpstreamSha(worktree)) ?? (await git.getHeadSha(worktree)),
		isAncestor: (ancestor, descendant) => git.isRefMergedInto(worktree, ancestor, descendant),
	});
	const firedIds = new Set(outcome.fired.map(({ watch }) => watch.id));
	const quietPatches = Object.fromEntries(Object.entries(outcome.patches).filter(([id]) => !firedIds.has(id)));
	if (Object.keys(quietPatches).length > 0) {
		await persistWatches(project, taskId, (current) => applyPrWatchOutcome(current, { removeIds: [], patches: quietPatches }));
	}
	if (outcome.fired.length === 0) return;
	if (!agentCanReceive(task)) return;

	const groups = new Map<string, PrWatchOutcome["fired"]>();
	for (const fired of outcome.fired) {
		const key = subscriberKey(fired.watch);
		groups.set(key, [...(groups.get(key) ?? []), fired]);
	}
	for (const group of groups.values()) {
		if (!(await deliverGroup(project, taskId, group, outcome, sample.number, prUrl))) return;
	}
}

/** The whole identity of the subscribing agent: a pane can host one agent after another. */
function subscriberKey(watch: PrWatch): string {
	const author = watch.author;
	return author ? JSON.stringify([author.paneId, author.sessionId, author.paneToken, author.agentProcess]) : "";
}

/** One message to one subscriber. False when the send failed or cannot be made now, so the rest wait. */
async function deliverGroup(
	project: Project,
	taskId: string,
	group: PrWatchOutcome["fired"],
	outcome: PrWatchOutcome,
	prNumber: number,
	prUrl: string,
): Promise<boolean> {
	const backoffKey = `${taskId}|${subscriberKey(group[0].watch)}`;
	if ((retryAfter.get(backoffKey) ?? 0) > Date.now()) return true;
	// Re-read right before typing: a `--off`, another run, or the agent's own state may have changed since.
	const task = await data.getTask(project, taskId);
	if (isTerminal(task) || !task.worktreePath || !agentCanReceive(task)) return false;
	const held = new Set((task.prWatches ?? []).map((watch) => watch.id));
	const live = group.filter(({ watch }) => held.has(watch.id));
	if (live.length === 0) return true;

	const ids = new Set(live.map(({ watch }) => watch.id));
	const settle = (current: PrWatch[]) => applyPrWatchOutcome(current, {
		removeIds: outcome.removeIds.filter((id) => ids.has(id)),
		patches: Object.fromEntries(Object.entries(outcome.patches).filter(([id]) => ids.has(id))),
	});
	// The subscriber's own pane when it still runs; else the task's only agent pane (likely
	// the same agent, resumed). With several panes and no proof, wait: never guess a sibling.
	let author = live[0].watch.author;
	if (author && !(await resolvesToLivePane(task, author))) author = undefined;
	if (!author && (task.sessionState?.panes?.length ?? 0) !== 1) {
		retryAfter.set(backoffKey, Date.now() + PR_WATCH_RETRY_BACKOFF_MS);
		log.warn("PR watch waits: several agent panes and the subscriber cannot be resolved", { taskId: taskId.slice(0, 8) });
		return true;
	}

	const key = subscriberKey(live[0].watch);
	const remaining = [...new Set(settle(task.prWatches ?? []).filter((watch) => subscriberKey(watch) === key).map((watch) => watch.until))];
	const notices = live.map(({ notice }) => notice);
	try {
		// Loaded on demand: the scheduler pulls in the whole prompt-delivery stack.
		const { sendMessageImmediately } = await import("./scheduled-message-scheduler");
		const text = wrapPrStatusMessage({ prNumber, url: prUrl, notices, remaining });
		await sendMessageImmediately(task, text, null, null, { subject: prStatusSubject(prNumber, notices), origin: "dev3", author });
	} catch (err) {
		retryAfter.set(backoffKey, Date.now() + PR_WATCH_RETRY_BACKOFF_MS);
		log.warn("PR watch message not delivered; the watch stays", { taskId: taskId.slice(0, 8), error: String(err) });
		return false;
	}
	retryAfter.delete(backoffKey);
	await persistWatches(project, taskId, settle);
	return true;
}

async function resolvesToLivePane(task: Task, author: NonNullable<PrWatch["author"]>): Promise<boolean> {
	const { resolveScheduledMessageAuthorPane } = await import("./scheduled-message-author");
	return (await resolveScheduledMessageAuthorPane(task, author)).ok;
}
