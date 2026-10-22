import type { PRCheckInfo } from "../shared/types";
import type { PrStatusNotice, PrWatch } from "../shared/pr-watch";
import { summarizeChecks } from "./rpc-handlers/pr-status";

/** The slice of one polled PR that watches are judged against. */
export interface PrWatchSample {
	number: number;
	/** GitHub's `state`: OPEN, MERGED or CLOSED. */
	state?: string | null;
	headRefOid: string | null;
	checks: PRCheckInfo[];
}

/** Local repository facts the verdict needs; the caller answers them with git. */
export interface PrWatchGit {
	hasCommit(sha: string): Promise<boolean>;
	/** True when `ancestor` is an ancestor of `descendant` (the two differ). */
	isAncestor(ancestor: string, descendant: string): Promise<boolean>;
}

export interface PrWatchOutcome {
	/** What to tell the agent; empty means nothing fired. */
	notices: PrStatusNotice[];
	/** Watches that fired and are done. */
	removeIds: string[];
	/** Watches that stay, with the fields that moved. */
	patches: Record<string, Partial<Pick<PrWatch, "headSha" | "failedNotifiedHead">>>;
}

/**
 * Judge a task's watches against one polled PR.
 *
 * The verdict is only about the head the agent pushed: a sample whose head is
 * missing locally (a fork PR with the same branch name) or is an older ancestor of
 * the watch's head (the push is not visible on GitHub yet) says nothing about it.
 * A head that is neither means the agent pushed again, and the watch moves along.
 */
export async function evaluatePrWatches(
	watches: readonly PrWatch[],
	sample: PrWatchSample,
	git: PrWatchGit,
): Promise<PrWatchOutcome> {
	const outcome: PrWatchOutcome = { notices: [], removeIds: [], patches: {} };
	const mine = watches.filter((watch) => watch.prNumber === sample.number);
	const head = sample.headRefOid;
	if (mine.length === 0 || !head || !(await git.hasCommit(head))) return outcome;

	const state = sample.state?.toUpperCase();
	if (state === "MERGED" || state === "CLOSED") {
		const notice: PrStatusNotice = state === "MERGED" ? { kind: "merged" } : { kind: "closed" };
		outcome.notices.push(notice);
		outcome.removeIds.push(...mine.map((watch) => watch.id));
		return outcome;
	}
	if (state !== "OPEN") return outcome;

	const { total, pending, failed } = summarizeChecks(sample.checks);
	const ciDone = total > 0 && pending === 0;
	for (const watch of mine) {
		if (watch.headSha !== head) {
			if (await git.isAncestor(head, watch.headSha)) continue;
			outcome.patches[watch.id] = { headSha: head };
		}
		if (!ciDone) continue;
		const failedNotice: PrStatusNotice = { kind: "ci-failed", sha: head, failedChecks: failed, totalChecks: total };
		if (watch.until === "ci") {
			outcome.notices.push(failed.length > 0 ? failedNotice : { kind: "ci-passed", sha: head });
			outcome.removeIds.push(watch.id);
			delete outcome.patches[watch.id];
		} else if (failed.length > 0 && watch.failedNotifiedHead !== head) {
			outcome.notices.push(failedNotice);
			outcome.patches[watch.id] = { ...outcome.patches[watch.id], failedNotifiedHead: head };
		}
	}
	return outcome;
}

/** The watch list after `outcome`, applied to whatever the task holds now. */
export function applyPrWatchOutcome(watches: readonly PrWatch[], outcome: PrWatchOutcome): PrWatch[] {
	return watches
		.filter((watch) => !outcome.removeIds.includes(watch.id))
		.map((watch) => (outcome.patches[watch.id] ? { ...watch, ...outcome.patches[watch.id] } : watch));
}

/** Add `next`, replacing any watch of the same kind; one per kind, so at most two stay. */
export function upsertPrWatch(watches: readonly PrWatch[], next: PrWatch): PrWatch[] {
	return [...watches.filter((watch) => watch.until !== next.until), next];
}
