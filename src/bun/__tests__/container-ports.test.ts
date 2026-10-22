import { describe, it, expect } from "vitest";
import { parseWorktreeContainerPorts } from "../container-ports";

describe("parseWorktreeContainerPorts", () => {
	const output = [
		"/wt\t0.0.0.0:17501->8000/tcp, [::]:17501->8000/tcp",
		"/wt/infra\t127.0.0.1:17502-17503->9000-9001/tcp",
		"/wt-other\t0.0.0.0:17600->8000/tcp",
		"\t0.0.0.0:6379->6379/tcp",
		"/wt\t6379/tcp",
		"",
	].join("\n");

	it("keeps ports of compose projects inside the worktree, including ranges", () => {
		expect([...parseWorktreeContainerPorts(output, "/wt/")].sort()).toEqual([17501, 17502, 17503]);
	});

	it("ignores a sibling path, an unlabelled container and an unpublished port", () => {
		expect(parseWorktreeContainerPorts(output, "/wt-other")).toEqual(new Set([17600]));
		expect(parseWorktreeContainerPorts("", "/wt").size).toBe(0);
	});
});
