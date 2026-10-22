import { runProbeText } from "./probe-spawn";

const DOCKER_PS_TIMEOUT_MS = 5_000;
const COMPOSE_WORKING_DIR_LABEL = "com.docker.compose.project.working_dir";

/**
 * Host ports published by running compose containers whose project lives in
 * `worktreePath` (the compose working dir is the worktree or a folder inside it).
 *
 * A container runtime daemon (`com.docker.backend`, `docker-proxy`) holds every
 * published port under one long-lived PID, so a pid snapshot cannot tell this
 * task's own container from another project's. The compose label can.
 */
export async function findWorktreeContainerPorts(worktreePath: string): Promise<Set<number>> {
	const output = await runProbeText(
		["docker", "ps", "--format", `{{.Label "${COMPOSE_WORKING_DIR_LABEL}"}}\t{{.Ports}}`],
		DOCKER_PS_TIMEOUT_MS,
	);
	return parseWorktreeContainerPorts(output, worktreePath);
}

/** Parse `docker ps` lines of `<working dir>\t<ports>`, e.g. `/wt\t0.0.0.0:17501->8000/tcp, [::]:17501->8000/tcp`. */
export function parseWorktreeContainerPorts(output: string, worktreePath: string): Set<number> {
	const root = worktreePath.replace(/\/+$/, "");
	const ports = new Set<number>();
	for (const line of output.split("\n")) {
		const [workingDir, published = ""] = line.split("\t");
		if (!workingDir || (workingDir !== root && !workingDir.startsWith(`${root}/`))) continue;
		for (const match of published.matchAll(/:(\d+)(?:-(\d+))?->/g)) {
			const first = Number(match[1]);
			const last = match[2] ? Number(match[2]) : first;
			for (let port = first; port <= last; port++) ports.add(port);
		}
	}
	return ports;
}
