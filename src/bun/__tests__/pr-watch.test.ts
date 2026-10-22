import { describe, expect, it } from "vitest";
import type { PRCheckInfo } from "../../shared/types";
import type { PrWatch } from "../../shared/pr-watch";
import { applyPrWatchOutcome, evaluatePrWatches, upsertPrWatch, type PrWatchGit, type PrWatchSample } from "../pr-watch";

const OLD = "1111111111111111111111111111111111111111";
const HEAD = "2222222222222222222222222222222222222222";
const NEWER = "3333333333333333333333333333333333333333";

const check = (name: string, status: string, conclusion: string | null): PRCheckInfo => ({ name, status, conclusion, detailsUrl: null });
const green = [check("lint", "COMPLETED", "SUCCESS"), check("test", "COMPLETED", "SUCCESS")];
const red = [check("lint", "COMPLETED", "FAILURE"), check("test", "COMPLETED", "SUCCESS")];

function watch(until: PrWatch["until"], overrides: Partial<PrWatch> = {}): PrWatch {
	return { id: `w-${until}`, until, prNumber: 7, headSha: HEAD, createdAt: "2026-10-22T10:00:00.000Z", ...overrides };
}

function sample(overrides: Partial<PrWatchSample> = {}): PrWatchSample {
	return { number: 7, state: "OPEN", headRefOid: HEAD, checks: green, ...overrides };
}

/** Local repo facts: which commits exist, and which head is an ancestor of which. */
function fakeGit(opts: { known?: string[]; ancestors?: Array<[string, string]> } = {}): PrWatchGit {
	const known = opts.known ?? [OLD, HEAD, NEWER];
	const ancestors = opts.ancestors ?? [];
	return {
		hasCommit: async (sha) => known.includes(sha),
		isAncestor: async (a, d) => ancestors.some(([x, y]) => x === a && y === d),
	};
}

describe("evaluatePrWatches", () => {
	it("fires an `until ci` watch green once every check finished passing", async () => {
		const out = await evaluatePrWatches([watch("ci")], sample(), fakeGit());
		expect(out.notices).toEqual([{ kind: "ci-passed", sha: HEAD }]);
		expect(out.removeIds).toEqual(["w-ci"]);
	});

	it("fires an `until ci` watch red with the failed check names", async () => {
		const out = await evaluatePrWatches([watch("ci")], sample({ checks: red }), fakeGit());
		expect(out.notices).toEqual([{ kind: "ci-failed", sha: HEAD, failedChecks: ["lint"], totalChecks: 2 }]);
		expect(out.removeIds).toEqual(["w-ci"]);
	});

	it("keeps waiting while any check is pending, even when another already failed", async () => {
		const checks = [check("lint", "COMPLETED", "FAILURE"), check("test", "IN_PROGRESS", null)];
		const out = await evaluatePrWatches([watch("ci")], sample({ checks }), fakeGit());
		expect(out).toEqual({ notices: [], removeIds: [], patches: {} });
	});

	it("keeps waiting on a null or empty rollup", async () => {
		const out = await evaluatePrWatches([watch("ci")], sample({ checks: [] }), fakeGit());
		expect(out.notices).toEqual([]);
	});

	it("fires `until ci` with `merged` when the PR merged before CI finished", async () => {
		const out = await evaluatePrWatches([watch("ci")], sample({ state: "MERGED", checks: [] }), fakeGit());
		expect(out.notices).toEqual([{ kind: "merged" }]);
		expect(out.removeIds).toEqual(["w-ci"]);
	});

	it("fires `until ci` with `closed` when the PR was closed", async () => {
		const out = await evaluatePrWatches([watch("ci")], sample({ state: "CLOSED" }), fakeGit());
		expect(out.notices).toEqual([{ kind: "closed" }]);
	});

	it("fires `until merged` on merge and on close, and removes the watch", async () => {
		const merged = await evaluatePrWatches([watch("merged")], sample({ state: "MERGED" }), fakeGit());
		const closed = await evaluatePrWatches([watch("merged")], sample({ state: "CLOSED" }), fakeGit());
		expect(merged.notices).toEqual([{ kind: "merged" }]);
		expect(closed.notices).toEqual([{ kind: "closed" }]);
		expect(merged.removeIds).toEqual(["w-merged"]);
	});

	it("does not fire `until merged` on a green CI", async () => {
		const out = await evaluatePrWatches([watch("merged")], sample(), fakeGit());
		expect(out).toEqual({ notices: [], removeIds: [], patches: {} });
	});

	it("reports a red CI to an `until merged` watch, keeps it, and remembers the head", async () => {
		const out = await evaluatePrWatches([watch("merged")], sample({ checks: red }), fakeGit());
		expect(out.notices).toHaveLength(1);
		expect(out.removeIds).toEqual([]);
		expect(out.patches).toEqual({ "w-merged": { failedNotifiedHead: HEAD } });
	});

	it("reports a red CI to an `until merged` watch once per head", async () => {
		const seen = watch("merged", { failedNotifiedHead: HEAD });
		const again = await evaluatePrWatches([seen], sample({ checks: red }), fakeGit());
		expect(again.notices).toEqual([]);
		const pushed = await evaluatePrWatches(
			[{ ...seen, headSha: HEAD }],
			sample({ headRefOid: NEWER, checks: red }),
			fakeGit({ ancestors: [] }),
		);
		expect(pushed.notices).toHaveLength(1);
		expect(pushed.patches["w-merged"]).toEqual({ headSha: NEWER, failedNotifiedHead: NEWER });
	});

	it("turns two watches firing on one sample into notices the message builder can merge", async () => {
		const out = await evaluatePrWatches([watch("ci"), watch("merged")], sample({ checks: red }), fakeGit());
		expect(out.notices).toHaveLength(2);
		expect(out.notices[0]).toEqual(out.notices[1]);
		expect(out.removeIds).toEqual(["w-ci"]);
	});

	it("moves the watch to a new head the agent pushed, and judges that head", async () => {
		const out = await evaluatePrWatches([watch("merged", { headSha: OLD })], sample({ checks: red }), fakeGit());
		expect(out.patches["w-merged"]).toMatchObject({ headSha: HEAD });
	});

	it("retargets without a notice while the new head's CI is still running", async () => {
		const checks = [check("lint", "QUEUED", null)];
		const out = await evaluatePrWatches([watch("ci", { headSha: OLD })], sample({ checks }), fakeGit());
		expect(out.notices).toEqual([]);
		expect(out.patches).toEqual({ "w-ci": { headSha: HEAD } });
	});

	it("ignores a sample whose head is an older ancestor of the watch's head", async () => {
		const out = await evaluatePrWatches(
			[watch("ci", { headSha: NEWER })],
			sample({ headRefOid: HEAD, checks: red }),
			fakeGit({ ancestors: [[HEAD, NEWER]] }),
		);
		expect(out).toEqual({ notices: [], removeIds: [], patches: {} });
	});

	it("ignores a sample whose head commit is not in the local repository (fork guard)", async () => {
		const out = await evaluatePrWatches([watch("ci")], sample({ checks: red }), fakeGit({ known: [OLD] }));
		expect(out).toEqual({ notices: [], removeIds: [], patches: {} });
	});

	it("ignores a merged state from a sample without a head", async () => {
		const out = await evaluatePrWatches([watch("ci")], sample({ state: "MERGED", headRefOid: null }), fakeGit());
		expect(out.notices).toEqual([]);
	});

	it("ignores a sample of a different PR number", async () => {
		const out = await evaluatePrWatches([watch("ci")], sample({ number: 8, state: "MERGED" }), fakeGit());
		expect(out).toEqual({ notices: [], removeIds: [], patches: {} });
	});
});

describe("watch list helpers", () => {
	it("applies removals and patches to whatever the task holds now", () => {
		const current = [watch("ci"), watch("merged")];
		const next = applyPrWatchOutcome(current, { notices: [], removeIds: ["w-ci"], patches: { "w-merged": { headSha: NEWER } } });
		expect(next).toEqual([watch("merged", { headSha: NEWER })]);
	});

	it("replaces a watch of the same kind instead of duplicating it, keeping at most two", () => {
		const first = upsertPrWatch(upsertPrWatch([], watch("ci")), watch("merged"));
		const replaced = upsertPrWatch(first, watch("ci", { id: "w-new", prNumber: 9 }));
		expect(replaced.map((w) => w.id).sort()).toEqual(["w-merged", "w-new"]);
	});
});
