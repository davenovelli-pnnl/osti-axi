import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const executable = fileURLToPath(new URL("../dist/bin/osti-axi.js", import.meta.url));

describe("version fast path", () => {
  it.each(["-v", "-V", "--version"])("prints a bare version for %s", async (flag) => {
    const result = await execFileAsync(process.execPath, [executable, flag], { cwd: root });
    expect(result.stdout).toBe("0.1.0\n");
    expect(result.stderr).toBe("");
  });

  it("stays close to the measured Node process floor", async () => {
    const elapsed = async (args: string[]): Promise<number> => {
      const start = performance.now();
      await execFileAsync(process.execPath, args, { cwd: root });
      return performance.now() - start;
    };
    await elapsed(["-e", "console.log(1)"]);
    await elapsed([executable, "--version"]);
    const floors: number[] = [];
    const versions: number[] = [];
    for (let index = 0; index < 4; index += 1) {
      floors.push(await elapsed(["-e", "console.log(1)"]));
      versions.push(await elapsed([executable, "--version"]));
    }
    floors.sort((a, b) => a - b);
    versions.sort((a, b) => a - b);
    expect(versions[1]!).toBeLessThan(floors[1]! + 150);
  }, 15_000);
});
