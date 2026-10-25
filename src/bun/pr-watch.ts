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

/** What the verdict needs from the local repository. */
export interface PrWatchGit {
	/** What the remotes last had for the task's own branch; empty when it was never pushed. */
	tips: readonly string[];
	/** True when `ancestor` is an ancestor of `descendant`; false too when either commit is unknown here. */
	isAncestor(ancestor: string, descendant: string): Promise<boolean>;
}

export interface PrWatchOutcome {
	/** Watches that fired, each with what to tell its agent; empty means nothing fired. */
	fired: Array<{ watch: PrWatch; notice: PrStatusNotice }>;
	/** Watches that fired and are done. */
	removeIds: string[];
	/** Watches that stay, with the fields that moved. */
	patches: Record<string, Partial<Pick<PrWatch, "headSha" | "failedNotifiedHead" | "ciSeen">>>;
}

/**
 * Judge a task's watches against one polled PR. A merge or close is a fact about the
 * PR whatever its head. A watch whose PR is no longer the branch's open PR ends.
 *
 * For CI the verdict is only about a head that is really on the remote. With remote
 * tips known, a sample head must equal a tip or descend from one, else it is stale (a
 * lagging poll after a push, a pre-rebase head) and is skipped. A watch whose own head
 * is not under any tip has not been pushed yet and does not move. A fresh head the
 * watch does not have (the agent pushed again, or someone else did) moves it. Without
 * tips nothing is known, and only a head that is an older ancestor of the watch's is
 * skipped. A finished-looking run counts once seen twice in a row on one head with one
 * total, because some checks join the rollup late.
 */
export async function evaluatePrWatches(
	watches: readonly PrWatch[],
	sample: PrWatchSample,
	git: PrWatchGit,
): Promise<PrWatchOutcome> {
	const outcome: PrWatchOutcome = { fired: [], removeIds: [], patches: {} };
	const state = sample.state?.toUpperCase();
	if (state === "OPEN") {
		for (const watch of watches.filter((w) => w.prNumber !== sample.number)) {
			outcome.fired.push({ watch, notice: { kind: "replaced", oldNumber: watch.prNumber, newNumber: sample.number } });
			outcome.removeIds.push(watch.id);
		}
	}
	const mine = watches.filter((watch) => watch.prNumber === sample.number);
	if (mine.length === 0) return outcome;

	if (state === "MERGED" || state === "CLOSED") {
		const notice: PrStatusNotice = state === "MERGED" ? { kind: "merged" } : { kind: "closed" };
		for (const watch of mine) outcome.fired.push({ watch, notice });
		outcome.removeIds.push(...mine.map((watch) => watch.id));
		return outcome;
	}
	const head = sample.headRefOid;
	if (state !== "OPEN" || !head) return outcome;

	const { total, pending, failed } = summarizeChecks(sample.checks);
	const ciDone = total > 0 && pending === 0;
	const onRemote = async (sha: string) => {
		for (const tip of git.tips) if (tip === sha || (await git.isAncestor(sha, tip))) return true;
		return false;
	};
	if (git.tips.length > 0) {
		let fresh = false;
		for (const tip of git.tips) fresh ||= tip === head || (await git.isAncestor(tip, head));
		if (!fresh) return outcome;
	}
	for (const watch of mine) {
		if (watch.headSha !== head) {
			if (git.tips.length > 0 && !(await onRemote(watch.headSha))) continue;
			if (await git.isAncestor(head, watch.headSha)) continue;
			outcome.patches[watch.id] = { headSha: head };
		}
		const seen = ciDone ? { head, total } : undefined;
		const confirmed = ciDone && watch.ciSeen?.head === head && watch.ciSeen.total === total;
		if (watch.ciSeen?.head !== seen?.head || watch.ciSeen?.total !== seen?.total) {
			outcome.patches[watch.id] = { ...outcome.patches[watch.id], ciSeen: seen };
		}
		if (!confirmed) continue;
		const failedNotice: PrStatusNotice = { kind: "ci-failed", sha: head, failedCount: failed.length, totalChecks: total };
		if (watch.until === "ci") {
			outcome.fired.push({ watch, notice: failed.length > 0 ? failedNotice : { kind: "ci-passed", sha: head, totalChecks: total } });
			outcome.removeIds.push(watch.id);
			delete outcome.patches[watch.id];
		} else if (failed.length > 0 && watch.failedNotifiedHead !== head) {
			outcome.fired.push({ watch, notice: failedNotice });
			outcome.patches[watch.id] = { ...outcome.patches[watch.id], failedNotifiedHead: head };
		}
	}
	return outcome;
}

/** The watch list after `outcome`, applied to whatever the task holds now. */
export function applyPrWatchOutcome(watches: readonly PrWatch[], outcome: Pick<PrWatchOutcome, "removeIds" | "patches">): PrWatch[] {
	return watches
		.filter((watch) => !outcome.removeIds.includes(watch.id))
		.map((watch) => (outcome.patches[watch.id] ? { ...watch, ...outcome.patches[watch.id] } : watch));
}

/** Add `next`, replacing any watch of the same kind; one per kind, so at most two stay. */
export function upsertPrWatch(watches: readonly PrWatch[], next: PrWatch): PrWatch[] {
	return [...watches.filter((watch) => watch.until !== next.until), next];
}
