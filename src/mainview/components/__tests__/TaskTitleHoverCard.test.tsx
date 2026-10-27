import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TaskTitleHoverCard from "../TaskTitleHoverCard";
import { I18nProvider } from "../../i18n";
import type { CodingAgent, Task } from "../../../shared/types";

vi.mock("../../rpc", () => ({
	api: {
		request: {
			getProjectClaudeLogin: vi.fn().mockResolvedValue({
				configDir: "/home/me/.claude-proj",
				identity: { email: "proj@example.com", organization: null, plan: null, planLabel: null, accountId: null },
			}),
			listAgentAccounts: vi.fn().mockResolvedValue({
				claude: {
					accounts: [{ id: "a1", kind: "claude", label: "Work", identity: { email: "work@example.com" }, auth: "api", api: null, createdAt: 0 }],
					activeId: null,
					systemConfigDir: "/home/me/.claude",
					systemIdentity: null,
				},
				codex: { accounts: [], activeId: null, currentIdentity: null },
				omp: { accounts: [], activeId: null },
				pi: { accounts: [], activeId: null },
			}),
		},
	},
}));

const agents = [{ id: "builtin-claude", name: "Claude Code", baseCommand: "claude", configurations: [] }] as CodingAgent[];

function renderCard(task: Partial<Task>) {
	const full = { id: "t1", seq: 1, projectId: "p1", title: "Title", description: "", createdAt: "2025-01-01T00:00:00Z", agentId: null, ...task } as Task;
	return render(
		<I18nProvider>
			<TaskTitleHoverCard task={full} project={null} agents={agents}>
				<span>trigger</span>
			</TaskTitleHoverCard>
		</I18nProvider>,
	);
}

describe("TaskTitleHoverCard — agents row", () => {
	afterEach(() => localStorage.removeItem("dev3-streamer-mode"));

	it("lists the agent's account after hover", async () => {
		renderCard({ agentId: "builtin-claude", accountId: "a1" });
		await userEvent.setup().hover(screen.getByText("trigger"));
		expect(await screen.findByText("Work")).toBeTruthy();
		expect(screen.getByText("Agents")).toBeTruthy();
		expect(screen.getByText("API")).toBeTruthy();
	});

	it("has no agents row for a task without an agent", async () => {
		renderCard({ agentId: null });
		await userEvent.setup().hover(screen.getByText("trigger"));
		expect(screen.getByTestId("task-title-hover-card")).toBeTruthy();
		expect(screen.queryByText("Agents")).toBeNull();
	});

	it("sets a tooltip with the email, but not in streamer mode", async () => {
		renderCard({ agentId: "builtin-claude", accountId: "a1" });
		await userEvent.setup().hover(screen.getByText("trigger"));
		expect((await screen.findByText("Work")).getAttribute("title")).toBe("Work");
		expect(screen.getByText("work@example.com").getAttribute("title")).toBe("work@example.com");
	});

	it("sets no tooltip in streamer mode", async () => {
		localStorage.setItem("dev3-streamer-mode", "on");
		renderCard({ agentId: "builtin-claude", accountId: "a1" });
		await userEvent.setup().hover(screen.getByText("trigger"));
		expect((await screen.findByText("Work")).hasAttribute("title")).toBe(false);
		expect(screen.getByText("work@example.com").hasAttribute("title")).toBe(false);
	});

	it("shows the project login email for a claude agent on the system login", async () => {
		renderCard({ agentId: "builtin-claude", accountId: null });
		await userEvent.setup().hover(screen.getByText("trigger"));
		expect(await screen.findByText("Project login")).toBeTruthy();
		expect(await screen.findByText("proj@example.com")).toBeTruthy();
	});
});
