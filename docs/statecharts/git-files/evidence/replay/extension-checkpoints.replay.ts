// 回放：真实扩展 extension/omp-workspace-checkpoints.ts，对象是一次性 git 夹具（不碰任何真实仓库）。
// 入口只有宿主调用的钩子：session_start / session_switch / agent_start / agent_end。
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ext from "<repo>/extension/omp-workspace-checkpoints.ts";

const g = (cwd: string, ...a: string[]) =>
  execFileSync("git", a, { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } }).trim();

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), "omp-replay-repo-"));
  g(cwd, "init", "-q", "-b", "main");
  g(cwd, "config", "user.email", "t@t");
  g(cwd, "config", "user.name", "t");
  writeFileSync(join(cwd, "f.txt"), "base\n");
  g(cwd, "add", ".");
  g(cwd, "commit", "-q", "-m", "init");
  const handlers = new Map<string, (e: unknown, ctx: unknown) => unknown>();
  const entries: { type: string; data: any }[] = [];
  ext({
    on: (ev, fn) => void handlers.set(ev, fn),
    appendEntry: (type, data) => void entries.push({ type, data: data as any }),
  } as any);
  const ctx = { cwd, hasUI: false, sessionManager: { getSessionId: () => "sess1", getBranch: () => [] } };
  const fire = (ev: string) => handlers.get(ev)?.({}, ctx);
  return { cwd, fire, entries };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const refs = (cwd: string) => g(cwd, "for-each-ref", "--format=%(refname)", "refs/omp/").split("\n").filter(Boolean);

let failed = 0;
const check = (name: string, cond: boolean, detail: unknown) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${name} :: ${JSON.stringify(detail)}`);
  if (!cond) failed++;
};

// S1 对照：正常一轮——两个快照 ref + 一条条目
{
  const { cwd, fire, entries } = fixture();
  fire("agent_start");
  writeFileSync(join(cwd, "f.txt"), "turn1\n");
  fire("agent_end");
  const r = refs(cwd);
  check("S1 正常一轮留下 before/after 并追加条目", r.length === 2 && entries.length === 1, { r, entries: entries.length });
  rmSync(cwd, { recursive: true, force: true });
}

// S2 轮次进行中切换会话：before 快照残留、没有条目（bug: 残留存档）
{
  const { cwd, fire, entries } = fixture();
  fire("agent_start");
  writeFileSync(join(cwd, "f.txt"), "half\n");
  fire("session_switch"); // 宿主切换会话，agent_end 不再到达
  const r = refs(cwd);
  const leftover = r.filter((x) => x.endsWith("/before"));
  check("S2 切换会话后残留 before 快照且无条目", leftover.length === 1 && entries.length === 0, { r, entries: entries.length });
  // 之后无论多少轮都不会清理它：再跑一轮完整的
  await sleep(3);
  fire("agent_start");
  writeFileSync(join(cwd, "f.txt"), "turn2\n");
  fire("agent_end");
  const r2 = refs(cwd);
  check("S2b 后续正常轮次也不会清掉残留 before", r2.filter((x) => x.endsWith("/before")).length === 2, { r2 });
  rmSync(cwd, { recursive: true, force: true });
}

// S3 存档清理：第 1 轮被撤回（应用写 undone ref）后，第 52 轮结束时第 1 轮的 ref 与撤回标记一起被删，条目仍在
{
  const { cwd, fire, entries } = fixture();
  let first = "";
  for (let i = 1; i <= 52; i++) {
    fire("agent_start");
    writeFileSync(join(cwd, "f.txt"), `turn${i}\n`);
    fire("agent_end");
    if (i === 1) {
      first = entries[0].data.turnId;
      // 应用侧撤回所做的事（src-tauri/src/git/turns.rs:562）：写 undone ref 指向 before
      g(cwd, "update-ref", `refs/omp/undone/sess1/${first}`, entries[0].data.before);
    }
    await sleep(2);
  }
  const r = refs(cwd);
  const gone = !r.some((x) => x.includes(`/${first}/`) || x.endsWith(`/${first}`));
  check("S3 第 1 轮 before/after 与撤回标记被清理，条目仍在", gone && entries.length === 52 && entries[0].data.turnId === first, {
    first,
    refsOfFirst: r.filter((x) => x.includes(first)),
    total: r.length,
    entries: entries.length,
  });
  rmSync(cwd, { recursive: true, force: true });
}

console.log(failed === 0 ? "ALL REPLAYS REPRODUCED" : `${failed} replay checks failed`);
process.exit(failed === 0 ? 0 : 1);
