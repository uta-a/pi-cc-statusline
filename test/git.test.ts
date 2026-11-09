import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readGitState } from "../extension/git.ts";

test("Git state tracks clean, untracked, staged, unstaged and detached HEAD", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "statusline-git-"));
	const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
	try {
		assert.deepEqual(await readGitState(cwd), { dirty: false });
		git("init", "-b", "main");
		assert.deepEqual(await readGitState(cwd), { branch: "main", dirty: false });
		writeFileSync(join(cwd, "file.txt"), "one");
		assert.deepEqual(await readGitState(cwd), { branch: "main", dirty: true });
		git("add", "file.txt");
		assert.deepEqual(await readGitState(cwd), { branch: "main", dirty: true });
		git("-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "commit", "-m", "test");
		assert.deepEqual(await readGitState(cwd), { branch: "main", dirty: false });
		writeFileSync(join(cwd, "file.txt"), "two");
		assert.deepEqual(await readGitState(cwd), { branch: "main", dirty: true });
		git("restore", "file.txt");
		git("checkout", "-b", "feature/test");
		assert.deepEqual(await readGitState(cwd), { branch: "feature/test", dirty: false });
		git("checkout", "--detach");
		assert.deepEqual(await readGitState(cwd), { branch: git("rev-parse", "--short", "HEAD"), dirty: false });
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
