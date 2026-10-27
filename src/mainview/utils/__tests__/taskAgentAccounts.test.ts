import { describe, it, expect } from "vitest";
import type { AgentAccount, AgentAccountsState } from "../../../shared/agent-accounts";
import type { CodingAgent, Task } from "../../../shared/types";
import type { PaneSessionEntry } from "../../../shared/types/task-lifecycle";
import { describeTaskAgentAccounts } from "../taskAgentAccounts";

const claudeAgent = { id: "builtin-claude", name: "Claude Code", baseCommand: "claude", configurations: [] } as CodingAgent;
const codexAgent = { id: "builtin-codex", name: "Codex", baseCommand: "codex", configurations: [] } as CodingAgent;
const geminiAgent = { id: "builtin-gemini", name: "Gemini", baseCommand: "gemini", configurations: [] } as CodingAgent;
const agents = [claudeAgent, codexAgent, geminiAgent];

function account(id: string, label: string, email: string | null, auth: "oauth" | "api" = "oauth"): AgentAccount {
	return {
		id,
		kind: "claude",
		label,
		identity: email ? { email, organization: null, plan: null, planLabel: null, accountId: null } : null,
		auth,
		api: null,
		createdAt: 0,
	};
}

const accounts = {
	claude: {
		accounts: [account("a1", "Work", "work@example.com"), account("a2", "work@example.com", "work@example.com"), account("a3", "Proxy", null, "api")],
		activeId: null,
		systemConfigDir: "/home/me/.claude",
		systemIdentity: { email: "system@example.com", organization: null, plan: null, planLabel: null, accountId: null },
	},
	codex: {
		accounts: [{ ...account("c1", "Codex Work", "codex@example.com"), kind: "codex" as const }],
		activeId: null,
		currentIdentity: { email: "codex-system@example.com", organization: null, plan: null, planLabel: null, accountId: null },
	},
	omp: { accounts: [], activeId: null },
	pi: { accounts: [], activeId: null },
} as AgentAccountsState;

function pane(over: Partial<PaneSessionEntry>): PaneSessionEntry {
	return { agentCmd: "claude", sessionId: null, agentId: "builtin-claude", configId: null, ...over };
}

function task(over: Partial<Task>): Task {
	return { id: "t1", agentId: "builtin-claude", configId: null, ...over } as Task;
}

describe("describeTaskAgentAccounts", () => {
	it("resolves a managed account with label and email", () => {
		const rows = describeTaskAgentAccounts(
			task({ accountId: "a1", sessionState: { panes: [pane({})] } }), agents, accounts,
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ key: 0, agentName: "Claude Code", auto: false, account: { kind: "managed", label: "Work", email: "work@example.com", api: false } });
	});

	it("drops the email when it equals the label", () => {
		const [row] = describeTaskAgentAccounts(task({ accountId: "a2", sessionState: { panes: [pane({})] } }), agents, accounts);
		expect(row.account).toMatchObject({ kind: "managed", email: null });
	});

	it("flags Auto when the router picked the pane-0 account", () => {
		const [row] = describeTaskAgentAccounts(
			task({ accountId: "a1", accountPick: { reason: { code: "only", short: null }, at: "x" }, sessionState: { panes: [pane({ accountId: "a1" })] } }),
			agents, accounts,
		);
		expect(row.auto).toBe(true);
	});

	it("treats the literal auto id as Auto with no account text", () => {
		const [row] = describeTaskAgentAccounts(task({ accountId: "auto", sessionState: { panes: [pane({})] } }), agents, accounts);
		expect(row.auto).toBe(true);
		expect(row.account).toEqual({ kind: "unknown" });
	});

	it("does not flag Auto on an extra pane when the main pane is parked", () => {
		const rows = describeTaskAgentAccounts(
			task({
				accountId: "a1",
				accountPick: { reason: { code: "only", short: null }, at: "x" },
				sessionState: { panes: [pane({ parked: true }), pane({ accountId: "a1" })] },
			}),
			agents, accounts,
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ key: 1, auto: false });
	});

	it("follows the pane's agent family for a wrapper command", () => {
		const [row] = describeTaskAgentAccounts(
			task({ sessionState: { panes: [pane({ agentCmd: "ccr code", agentFamily: "claude", accountId: "a1" })] } }),
			agents, accounts,
		);
		expect(row.account).toMatchObject({ kind: "managed", label: "Work" });
	});

	it("returns nothing when every pane is parked", () => {
		expect(describeTaskAgentAccounts(task({ sessionState: { panes: [pane({ parked: true })] } }), agents, accounts)).toEqual([]);
	});

	it("marks API accounts", () => {
		const [row] = describeTaskAgentAccounts(task({ accountId: "a3", sessionState: { panes: [pane({})] } }), agents, accounts);
		expect(row.account).toMatchObject({ kind: "managed", api: true });
	});

	it("shows the system login with its email for claude and codex", () => {
		const rows = describeTaskAgentAccounts(
			task({
				accountId: null,
				sessionState: { panes: [pane({}), pane({ agentCmd: "codex", agentId: "builtin-codex", accountId: null })] },
			}),
			agents, accounts,
		);
		expect(rows[0].account).toEqual({ kind: "system", email: "system@example.com" });
		expect(rows[1].account).toEqual({ kind: "system", email: "codex-system@example.com" });
	});

	it("reports a deleted account for an unknown id", () => {
		const [row] = describeTaskAgentAccounts(task({ accountId: "gone", sessionState: { panes: [pane({})] } }), agents, accounts);
		expect(row.account).toEqual({ kind: "deleted" });
	});

	it("falls back to default when nothing was recorded", () => {
		const [row] = describeTaskAgentAccounts(task({ sessionState: { panes: [pane({})] } }), agents, accounts);
		expect(row.account).toEqual({ kind: "default" });
	});

	it("uses the pane's own account for an extra pane", () => {
		const rows = describeTaskAgentAccounts(
			task({
				accountId: "a1",
				sessionState: { panes: [pane({}), pane({ agentCmd: "codex", agentId: "builtin-codex", accountId: "c1" }), pane({ agentCmd: "codex", agentId: "builtin-codex" })] },
			}),
			agents, accounts,
		);
		expect(rows.map((r) => r.key)).toEqual([0, 1, 2]);
		expect(rows[1].account).toMatchObject({ kind: "managed", label: "Codex Work" });
		expect(rows[2].account).toEqual({ kind: "default" });
	});

	it("skips parked panes", () => {
		const rows = describeTaskAgentAccounts(
			task({ accountId: "a1", sessionState: { panes: [pane({ parked: true }), pane({ agentCmd: "codex", agentId: "builtin-codex" })] } }),
			agents, accounts,
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].agentName).toBe("Codex");
		// The main pane's task-level account must not leak onto an extra pane.
		expect(rows[0].account).toEqual({ kind: "default" });
	});

	it("builds a synthetic row from the task agent when there are no panes", () => {
		const [row] = describeTaskAgentAccounts(task({ accountId: "a1" }), agents, accounts);
		expect(row).toMatchObject({ agentName: "Claude Code", account: { kind: "managed", label: "Work" } });
	});

	it("returns nothing without any agent", () => {
		expect(describeTaskAgentAccounts(task({ agentId: null }), agents, accounts)).toEqual([]);
	});

	it("returns unknown accounts while the registry is not loaded", () => {
		const [row] = describeTaskAgentAccounts(task({ accountId: "a1", sessionState: { panes: [pane({})] } }), agents, null);
		expect(row.account).toEqual({ kind: "unknown" });
	});

	it("treats an agent without an account registry as the system login", () => {
		const [row] = describeTaskAgentAccounts(
			task({ sessionState: { panes: [pane({ agentCmd: "/opt/bin/gemini", agentId: "builtin-gemini" })] } }),
			agents, accounts,
		);
		expect(row).toMatchObject({ agentName: "Gemini", account: { kind: "system", email: null } });
	});

	it("does not throw for a pane whose agent is gone or a registry is missing", () => {
		const partial = { claude: accounts.claude, codex: accounts.codex } as AgentAccountsState;
		const rows = describeTaskAgentAccounts(
			task({ sessionState: { panes: [pane({ agentId: "nope", agentCmd: "/usr/bin/omp", accountId: "x" })] } }),
			agents, partial,
		);
		expect(rows[0]).toMatchObject({ agentName: "omp", account: { kind: "deleted" } });
	});

	it("shows the project login for a null-id claude pane when the project pins one", () => {
		const projectLogin = { configDir: "/home/me/.claude-proj", identity: { email: "proj@example.com", organization: null, plan: null, planLabel: null, accountId: null } };
		const t = task({ accountId: null, sessionState: { panes: [pane({}), pane({ agentCmd: "codex", agentId: "builtin-codex", accountId: null })] } });
		const rows = describeTaskAgentAccounts(t, agents, accounts, projectLogin);
		expect(rows[0].account).toEqual({ kind: "project", email: "proj@example.com" });
		expect(rows[1].account).toEqual({ kind: "system", email: "codex-system@example.com" });
		expect(describeTaskAgentAccounts(t, agents, accounts, { configDir: null, identity: null })[0].account).toEqual({ kind: "system", email: "system@example.com" });
	});
});
