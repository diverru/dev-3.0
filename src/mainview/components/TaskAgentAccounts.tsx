import type { CodingAgent, Task } from "../../shared/types";
import { useT } from "../i18n";
import { describeTaskAgentAccounts } from "../utils/taskAgentAccounts";
import { useAgentAccountsState } from "./AgentAccountIndicator";
import AgentLauncherBadge, { resolveAgentLauncherIcon } from "./AgentLauncherBadge";

const TAG_CLASS = "rounded px-1 text-nano font-semibold uppercase tracking-wider";

/** Mount only while the hover surface is open: it fetches the account registry. */
export function TaskAgentAccountsList({ task, agents }: { task: Task; agents: CodingAgent[] }) {
	const t = useT();
	const accounts = useAgentAccountsState(true);
	const rows = describeTaskAgentAccounts(task, agents, accounts);
	if (rows.length === 0) return null;

	return (
		<div data-testid="task-agent-accounts" className="flex flex-col gap-1">
			{rows.map(({ key, agent, agentName, account, auto }) => (
				<div key={key} data-testid="task-agent-account-row" className="flex min-w-0 items-center gap-1.5 text-micro">
					{agent && resolveAgentLauncherIcon(agent) && <AgentLauncherBadge agent={agent} size={12} />}
					<span className="flex-shrink-0 text-fg-3">{agentName}</span>
					{account.kind === "managed" && (
						<span className="min-w-0 truncate font-medium text-fg-2 streamer-private">{account.label}</span>
					)}
					{account.kind === "system" && (
						<span className="flex-shrink-0 text-fg-2">{t("taskAgents.systemLogin")}</span>
					)}
					{account.kind === "deleted" && (
						<span className="text-fg-3 italic">{t("taskAgents.deleted")}</span>
					)}
					{account.kind === "default" && <span className="text-fg-3">{t("taskAgents.default")}</span>}
					{(account.kind === "managed" || account.kind === "system") && account.email && (
						<span className="min-w-0 truncate font-mono text-fg-3 streamer-private" title={account.email}>
							{account.email}
						</span>
					)}
					{(auto || (account.kind === "managed" && account.api)) && (
						<span className="ml-auto flex flex-shrink-0 gap-1">
							{auto && <span className={`${TAG_CLASS} bg-accent/15 text-accent`}>{t("taskAgents.auto")}</span>}
							{account.kind === "managed" && account.api && (
								<span className={`${TAG_CLASS} bg-raised text-fg-3`}>{t("taskAgents.api")}</span>
							)}
						</span>
					)}
				</div>
			))}
		</div>
	);
}
