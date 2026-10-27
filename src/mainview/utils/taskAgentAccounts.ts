import type { AgentAccountKind, AgentAccountsState } from "../../shared/agent-accounts";
import { AUTO_ACCOUNT_ID } from "../../shared/agent-accounts";
import type { CodingAgent, Task } from "../../shared/types";
import { agentAccountKindForCommand } from "../components/AgentAccountIndicator";

export type TaskAgentAccount =
	| { kind: "managed"; label: string; email: string | null; api: boolean }
	| { kind: "system"; email: string | null }
	| { kind: "deleted" }
	| { kind: "default" }
	| { kind: "unknown" };

export interface TaskAgentAccountRow {
	key: number;
	agent: CodingAgent | null;
	agentName: string;
	account: TaskAgentAccount;
	auto: boolean;
}

interface Source {
	agentId: string | null;
	cmd: string;
	accountId: string | null | undefined;
}

function resolveAccount(
	kind: AgentAccountKind | null,
	id: string | null | undefined,
	accounts: AgentAccountsState | null,
): TaskAgentAccount {
	if (!kind) return { kind: "system", email: null };
	if (!accounts) return { kind: "unknown" };
	if (id === undefined || id === AUTO_ACCOUNT_ID) return { kind: "default" };
	if (id === null) {
		const identity =
			kind === "claude" ? accounts.claude.systemIdentity : kind === "codex" ? accounts.codex.currentIdentity : null;
		return { kind: "system", email: identity?.email ?? null };
	}
	const found = accounts[kind]?.accounts.find((a) => a.id === id);
	if (!found) return { kind: "deleted" };
	const email = found.identity?.email ?? null;
	return { kind: "managed", label: found.label, email: email === found.label ? null : email, api: found.auth === "api" };
}

export function describeTaskAgentAccounts(
	task: Task,
	agents: CodingAgent[],
	accounts: AgentAccountsState | null,
): TaskAgentAccountRow[] {
	const sources: Source[] = (task.sessionState?.panes ?? []).flatMap((p, i) =>
		p.parked
			? []
			: [{
				agentId: p.agentId,
				cmd: p.agentCmd,
				accountId: p.accountId !== undefined ? p.accountId : i === 0 ? task.accountId : undefined,
			}],
	);
	if (sources.length === 0 && task.agentId) {
		const agent = agents.find((a) => a.id === task.agentId);
		sources.push({ agentId: task.agentId, cmd: agent?.baseCommand ?? "", accountId: task.accountId });
	}

	return sources.map((s, index) => {
		const agent = agents.find((a) => a.id === s.agentId) ?? null;
		const cmdName = s.cmd.trim().split(/\s+/)[0]?.split("/").pop() ?? "";
		const kind = agentAccountKindForCommand(s.cmd);
		const auto =
			s.accountId === AUTO_ACCOUNT_ID ||
			(index === 0 && !!task.accountPick && s.accountId !== undefined && s.accountId === task.accountId);
		return {
			key: index,
			agent,
			agentName: agent?.name ?? cmdName,
			account: resolveAccount(kind, s.accountId, accounts),
			auto,
		};
	});
}
