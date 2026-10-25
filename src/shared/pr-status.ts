import type { PRMergeState } from "./types";

/** Extract host/owner/repo from a GitHub pull-request URL; null when it isn't one. */
export function parseGitHubPullRequestUrl(url: string): { host: string; owner: string; repo: string } | null {
	try {
		const parsed = new URL(url);
		const parts = parsed.pathname.split("/").filter(Boolean);
		const pullIndex = parts.indexOf("pull");
		if (pullIndex < 2) return null;
		const owner = parts[pullIndex - 2];
		const repo = parts[pullIndex - 1]?.replace(/\.git$/, "");
		return owner && repo && parsed.hostname ? { host: parsed.hostname, owner, repo } : null;
	} catch {
		return null;
	}
}

/** Common mergeability outcomes used by the PR status popover. */
export type PRMergeability = "mergeable" | "not_mergeable" | "unknown";
export type PRMergeabilityReason = "conflict" | "blocked" | "behind" | "draft" | "unstable" | "hooks";

export interface PRMergeabilitySummary {
	state: PRMergeability;
	reason: PRMergeabilityReason | null;
}

/**
 * Summarize GitHub's mergeability fields for a compact status surface. A
 * blocking merge-state status wins because `mergeable` mainly describes
 * conflict-free merging, while `mergeStateStatus` describes whether GitHub
 * allows the merge right now.
 */
export function summarizeMergeability(mergeState: PRMergeState | null | undefined): PRMergeabilitySummary {
	if (!mergeState) return { state: "unknown", reason: null };

	const mergeable = mergeState.mergeable?.toUpperCase();
	const status = mergeState.status?.toUpperCase();

	if (mergeable === "CONFLICTING" || status === "DIRTY") {
		return { state: "not_mergeable", reason: "conflict" };
	}

	const blockedReasons: Record<string, PRMergeabilityReason> = {
		BLOCKED: "blocked",
		BEHIND: "behind",
		DRAFT: "draft",
		UNSTABLE: "unstable",
		HAS_HOOKS: "hooks",
	};
	const reason = status ? blockedReasons[status] : undefined;
	if (reason) return { state: "not_mergeable", reason };
	if (mergeable === "MERGEABLE" || status === "CLEAN" || status === "HAS_HOOKS") {
		return { state: "mergeable", reason: null };
	}

	return { state: "unknown", reason: null };
}
