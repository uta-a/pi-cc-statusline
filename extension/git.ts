/** Read Git state off the render path. Includes staged, unstaged and untracked changes. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
export interface GitState {
	branch?: string;
	dirty: boolean;
}

export async function readGitState(cwd: string): Promise<GitState> {
	try {
		const options = { cwd, timeout: 3_000, maxBuffer: 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } };
		const { stdout: status } = await exec("git", ["status", "--porcelain=v1", "--untracked-files=normal"], options);
		const { stdout: name } = await exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], options).catch(async () =>
			// A newly initialized repository can have a branch but no commits yet.
			exec("git", ["symbolic-ref", "--short", "HEAD"], options),
		);
		let branch = name.trim();
		if (branch === "HEAD") {
			const { stdout } = await exec("git", ["rev-parse", "--short", "HEAD"], options);
			branch = stdout.trim();
		}
		return { branch: branch.replace(/[\x00-\x1f\x7f]/g, ""), dirty: status.length > 0 };
	} catch {
		return { dirty: false };
	}
}
