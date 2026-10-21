import type { GitHubAccount, PRInfo, Project } from "../shared/types";
import { createLogger } from "./logger";
import { countUnresolvedReviewThreads } from "./rpc-handlers/pr-status";
import { isNotAGitHubRepoError, queryGitHub, resolveGitHubAccount, runGitHub } from "./github";

const log = createLogger("github-pr-status");
const STATUS_TTL_MS = 60_000;
const REPOSITORY_TTL_MS = 5 * 60_000;
type Selection = Pick<Project, "githubAuthHost" | "githubAuthLogin">;
type Page<T> = { nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
type Check = { name?: string; status?: string; conclusion?: string | null; detailsUrl?: string; context?: string; state?: string; targetUrl?: string };

export interface GitHubPullRequestSummary {
	number: number;
	url: string;
	title: string;
	state: string;
	headRefName: string;
	headRefOid: string;
	isDraft: boolean;
	autoMergeRequest: { enabledAt: string } | null;
	mergeable: string;
	mergeStateStatus: string;
	reviewDecision: string | null;
	author: { login: string; name?: string | null } | null;
	statusCheckRollup: Check[];
	unresolvedCount: number | null;
}

type ApiPR = Omit<GitHubPullRequestSummary, "statusCheckRollup" | "unresolvedCount"> & {
	commits: { nodes: { commit: { oid: string; statusCheckRollup: { contexts: Page<Check> } | null } }[] };
	reviewThreads: Page<{ isResolved: boolean }>;
};

type Repository = { owner: string; name: string; host: string };
type Probe = { pr: GitHubPullRequestSummary | null; isGitHub: boolean };
type Entry<T> = { at: number; promise: Promise<T> };
const repositories = new Map<string, Entry<Repository | null>>();
const statuses = new Map<string, Entry<Probe | null>>();
const snapshots = new Map<string, { at: number; pr: GitHubPullRequestSummary }>();
const lists = new Map<string, Entry<PRInfo[]>>();

const CHECK_FIELDS = `nodes {
  ... on CheckRun { name status conclusion detailsUrl }
  ... on StatusContext { context state targetUrl }
} pageInfo { hasNextPage endCursor }`;
const PR_FIELDS = `number url title state headRefName headRefOid isDraft
  author { login ... on User { name } }
  autoMergeRequest { enabledAt } mergeable mergeStateStatus reviewDecision
  commits(last: 1) { nodes { commit { oid statusCheckRollup { contexts(first: 100) { ${CHECK_FIELDS} } } } } }
  reviewThreads(first: 100) { nodes { isResolved } pageInfo { hasNextPage endCursor } }`;
const PR_QUERY = `query($owner: String!, $name: String!, $branch: String!, $number: Int!, $byBranch: Boolean!, $known: Boolean!) {
  repository(owner: $owner, name: $name) {
    open: pullRequests(headRefName: $branch, states: OPEN, first: 1, orderBy: {field: CREATED_AT, direction: DESC}) @include(if: $byBranch) { nodes { ${PR_FIELDS} } }
    known: pullRequest(number: $number) @include(if: $known) { ${PR_FIELDS} }
  }
}`;
const CHECKS_QUERY = `query($owner: String!, $name: String!, $oid: GitObjectID!, $after: String!) {
  repository(owner: $owner, name: $name) { object(oid: $oid) { ... on Commit {
    statusCheckRollup { contexts(first: 100, after: $after) { ${CHECK_FIELDS} } }
  } } }
}`;
const THREADS_QUERY = `query($owner: String!, $name: String!, $number: Int!, $after: String!) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) {
    reviewThreads(first: 100, after: $after) { nodes { isResolved } pageInfo { hasNextPage endCursor } }
  } }
}`;

function identity(account: GitHubAccount, repository: Repository): string {
	return `${account.host}\0${account.login}\0${repository.owner}/${repository.name}`;
}

async function resolveRepository(project: Selection, cwd: string, account: GitHubAccount): Promise<Repository | null> {
	const key = `${account.host}\0${account.login}\0${cwd}`;
	const cached = repositories.get(key);
	if (cached && Date.now() - cached.at < REPOSITORY_TTL_MS) return await cached.promise;
	const promise = (async () => {
		// gh resolves SSH aliases and its selected base repository; parsing origin loses both.
		const result = await runGitHub(project, cwd, ["repo", "view", "--json", "nameWithOwner,url"], { timeoutMs: 10_000 });
		if (!result.ok) {
			if (isNotAGitHubRepoError(result)) return null;
			throw new Error(result.stderr || "Could not resolve GitHub repository");
		}
		const repo = JSON.parse(result.stdout) as { nameWithOwner: string; url: string };
		const [owner, name] = repo.nameWithOwner.split("/");
		const host = new URL(repo.url).hostname;
		if (!owner || !name || host.toLowerCase() !== account.host.toLowerCase()) {
			throw new Error("GitHub repository does not match the selected account host");
		}
		return { owner, name, host };
	})();
	const entry = { at: Date.now(), promise };
	repositories.set(key, entry);
	try { return await promise; } catch (error) {
		if (repositories.get(key) === entry) repositories.delete(key);
		throw error;
	}
}

async function completePR(account: GitHubAccount, repo: Repository, pr: ApiPR, signal: AbortSignal): Promise<GitHubPullRequestSummary> {
	if (typeof pr.number !== "number" || typeof pr.url !== "string" || typeof pr.headRefName !== "string"
		|| !["OPEN", "MERGED", "CLOSED"].includes(pr.state)) throw new Error("GitHub returned an invalid PR identity or state");
	const commit = pr.commits.nodes[0]?.commit;
	let checksPage = commit?.statusCheckRollup?.contexts;
	const checks = [...(checksPage?.nodes ?? [])];
	while (checksPage?.pageInfo.hasNextPage) {
		if (!checksPage.pageInfo.endCursor) throw new Error("GitHub checks page is missing its cursor");
		const data = await queryGitHub<{ repository: { object: { statusCheckRollup: { contexts: Page<Check> } } } }>(
			account, CHECKS_QUERY, { ...repo, oid: commit!.oid, after: checksPage.pageInfo.endCursor }, signal,
		);
		checksPage = data.repository.object.statusCheckRollup.contexts;
		checks.push(...checksPage.nodes);
	}
	let threads = pr.reviewThreads;
	let unresolvedCount: number | null = countUnresolvedReviewThreads(threads.nodes);
	try {
		while (threads.pageInfo.hasNextPage) {
			if (!threads.pageInfo.endCursor) throw new Error("GitHub review-thread page is missing its cursor");
			const data = await queryGitHub<{ repository: { pullRequest: { reviewThreads: Page<{ isResolved: boolean }> } } }>(
				account, THREADS_QUERY, { ...repo, number: pr.number, after: threads.pageInfo.endCursor }, signal,
			);
			threads = data.repository.pullRequest.reviewThreads;
			unresolvedCount += countUnresolvedReviewThreads(threads.nodes);
		}
	} catch (error) {
		log.warn("PR review-thread pagination failed", { pr: pr.number, error: String(error) });
		unresolvedCount = null;
	}
	const { commits: _, reviewThreads: __, ...summary } = pr;
	return { ...summary, statusCheckRollup: checks, unresolvedCount };
}

export async function readTaskPullRequest(
	project: Selection,
	cwd: string,
	branch: string,
	prNumber?: number | null,
	options?: { force?: boolean; timeoutMs?: number },
): Promise<Probe | null> {
	try {
		const account = await resolveGitHubAccount(project);
		const repo = await resolveRepository(project, cwd, account);
		if (!repo) return { pr: null, isGitHub: false };
		const repoKey = identity(account, repo);
		if (!branch && prNumber != null && !options?.force) {
			const cached = snapshots.get(`${repoKey}#${prNumber}`);
			if (cached && Date.now() - cached.at < STATUS_TTL_MS) return { pr: cached.pr, isGitHub: true };
		}
		const key = `${repoKey}\0${branch}\0${prNumber ?? ""}`;
		const cached = statuses.get(key);
		// A forced refresh still joins an in-flight read; it only bypasses completed results.
		if (cached && (cached.at === Infinity || (!options?.force && Date.now() - cached.at < STATUS_TTL_MS))) return await cached.promise;
		const promise = (async (): Promise<Probe> => {
			const signal = AbortSignal.timeout(options?.timeoutMs ?? 15_000);
			const data = await queryGitHub<{ repository: { open?: { nodes: ApiPR[] }; known?: ApiPR | null } }>(
				account, PR_QUERY, { owner: repo.owner, name: repo.name, branch, number: prNumber ?? 0, byBranch: !!branch, known: prNumber != null }, signal,
			);
			const raw = data.repository.open?.nodes[0] ?? data.repository.known;
			if (prNumber != null && !raw) throw new Error("GitHub did not return the saved pull request");
			const pr = raw ? await completePR(account, repo, raw, signal) : null;
			if (pr) snapshots.set(`${repoKey}#${pr.number}`, { at: Date.now(), pr });
			return { pr, isGitHub: true };
		})();
		const entry = { at: Infinity, promise };
		statuses.set(key, entry);
		try {
			const result = await promise;
			if (result.pr && result.pr.headRefName === branch) statuses.set(`${repoKey}\0${branch}\0${result.pr.number}`, entry);
			return result;
		} finally {
			entry.at = Date.now();
		}
	} catch (error) {
		log.warn("PR status lookup failed", { pr: prNumber, error: String(error) });
		return null;
	}
}

export async function listOpenPullRequests(project: Selection, cwd: string): Promise<PRInfo[]> {
	const account = await resolveGitHubAccount(project);
	const repo = await resolveRepository(project, cwd, account);
	if (!repo) return [];
	const key = identity(account, repo);
	const cached = lists.get(key);
	if (cached && Date.now() - cached.at < STATUS_TTL_MS) return await cached.promise;
	const promise = queryGitHub<{ repository: { pullRequests: { nodes: PRInfo[] } } }>(account,
		`query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) {
		  pullRequests(states: OPEN, first: 100, orderBy: {field: CREATED_AT, direction: DESC}) { nodes { number url headRefName } }
		} }`, { owner: repo.owner, name: repo.name }, AbortSignal.timeout(15_000),
	).then((data) => data.repository.pullRequests.nodes);
	lists.set(key, { at: Date.now(), promise });
	return promise;
}
