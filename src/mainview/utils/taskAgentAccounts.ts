import type { AgentAccountKind, AgentAccountsState, ProjectClaudeLogin } from "../../shared/agent-accounts";
import { AUTO_ACCOUNT_ID } from "../../shared/agent-accounts";
import type { AgentFamily, CodingAgent, Task } from "../../shared/types";
import { agentKey } from "../../shared/agent-adapters/families";

export type TaskAgentAccount =
	| { kind: "managed"; label: string; email: string | null; api: boolean }
	| { kind: "system"; email: string | null }
	| { kind: "project"; email: string | null }
	| { kind: "deleted" }
	| { kind: "default" }
	| { kind: "unknown" };

export interface TaskAgentAccountRow {
	key: number;
	agent: CodingAgent | null;
	agentName: string;
	account: TaskAgentAccount;
	auto: boolean;
	/** Claude on the system login: a project pinning `CLAUDE_CONFIG_DIR` overrides it. */
	onSystemClaude: boolean;
}

interface Source {
	key: number;
	main: boolean;
	agentId: string | null;
	cmd: string;
	family: AgentFamily | undefined;
	accountId: string | null | undefined;
}

function resolveAccount(
	kind: AgentAccountKind | null,
	id: string | null | undefined,
	accounts: AgentAccountsState | null,
	projectLogin: ProjectClaudeLogin | null,
): TaskAgentAccount {
	if (!kind) return { kind: "system", email: null };
	if (!accounts) return { kind: "unknown" };
	if (id === AUTO_ACCOUNT_ID) return { kind: "unknown" };
	if (id === undefined) return { kind: "default" };
	if (id === null) {
		if (kind === "claude" && projectLogin?.configDir) return { kind: "project", email: projectLogin.identity?.email ?? null };
		const identity =
			kind === "claude" ? accounts.claude.systemIdentity : kind === "codex" ? accounts.codex.currentIdentity : null;
		return { kind: "system", email: identity?.email ?? null };
	}
	const found = accounts[kind]?.accounts.find((a) => a.id === id);
	if (!found) return { kind: "deleted" };
	const email = found.identity?.email ?? null;
	return { kind: "managed", label: found.label, email: email === found.label ? null : email, api: found.auth === "api" };
}

function accountKindOf(key: string): AgentAccountKind | null {
	return key === "claude" || key === "codex" || key === "omp" || key === "pi" ? key : null;
}

export function describeTaskAgentAccounts(
	task: Task,
	agents: CodingAgent[],
	accounts: AgentAccountsState | null,
	projectLogin: ProjectClaudeLogin | null = null,
): TaskAgentAccountRow[] {
	const panes = task.sessionState?.panes ?? [];
	const sources: Source[] = panes.flatMap((p, i) =>
		p.parked
			? []
			: [{
				key: i,
				main: i === 0,
				agentId: p.agentId,
				cmd: p.agentCmd,
				family: p.agentFamily ?? agents.find((a) => a.id === p.agentId)?.agentFamily,
				accountId: p.accountId !== undefined ? p.accountId : i === 0 ? task.accountId : undefined,
			}],
	);
	if (panes.length === 0 && task.agentId) {
		const agent = agents.find((a) => a.id === task.agentId);
		sources.push({
			key: 0,
			main: true,
			agentId: task.agentId,
			cmd: agent?.baseCommand ?? "",
			family: agent?.agentFamily,
			accountId: task.accountId,
		});
	}

	return sources.map((s) => {
		const agent = agents.find((a) => a.id === s.agentId) ?? null;
		const cmdName = s.cmd.trim().split(/\s+/)[0]?.split("/").pop() ?? "";
		const kind = accountKindOf(agentKey(s.cmd, s.family));
		const auto =
			s.accountId === AUTO_ACCOUNT_ID ||
			(s.main && !!task.accountPick && s.accountId !== undefined && s.accountId === task.accountId);
		return {
			key: s.key,
			agent,
			agentName: agent?.name ?? cmdName,
			account: resolveAccount(kind, s.accountId, accounts, projectLogin),
			auto,
			onSystemClaude: kind === "claude" && s.accountId === null,
		};
	});
}
