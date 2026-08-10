import { startWorkspaceServer } from "./packages/server/src/index.ts";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

const projectId = "我的青春戀愛喜劇太色情了";
const projectDir = resolve(process.cwd(), "projects", projectId);
const batchArg = process.argv[2] ?? "2";

const state = JSON.parse(readFileSync(resolve(projectDir, ".workspace", "state.json"), "utf8"));
const facts = state.facts;
const decided = new Set((state.fact_review_decisions ?? []).map((d: any) => d.candidate_occurrence_id));

const badSources = [
  "source_8d2c5766-e1e5-4ba8-abec-7428f62007ce",
  "source_459245bd-330f-446f-8447-f67e3bc9f7d1",
  "source_e3a20e7e-14aa-47be-8635-5d0f759b3a82",
  "source_39c924d2-35ac-49c0-8538-391c65e30150",
];
const cleanSources = [
  "source_195d6c4c-410a-4061-bf5f-add491b9af4e",
  "source_ac741ca4-d8fd-468d-9d37-14951b77ebb3",
];

const undecided = facts.filter((f: any) => !decided.has(f.candidate_occurrence_id ?? f.id));
const toReject = undecided.filter((f: any) => badSources.includes(f.source_ids?.[0]));
const toAccept = undecided.filter((f: any) => cleanSources.includes(f.source_ids?.[0]));

let decisions: any[] = [];
let summary = "";
if (batchArg === "2") {
  decisions = toReject.map((f: any) => ({
    fact_id: f.id,
    candidate_occurrence_id: f.candidate_occurrence_id ?? f.id,
    claim: f.statement ?? f.value,
    decision: "reject",
    reason: "候選事實來自未清洗的 HTML 來源，內容為網頁標籤／腳本／導覽碎片，非可採信的設定事實陳述。",
    evidence: (f.evidence_refs ?? []).map((r: any) => ({ source: r.source_id, quote: r.quote, locator: r.source_revision_id ?? r.chunk_id })),
  }));
  summary = `批次 2：reject ${decisions.length} 筆維基 HTML 垃圾候選（獨立身分分工裁決）。`;
} else if (batchArg === "3") {
  decisions = toAccept.map((f: any) => ({
    fact_id: f.id,
    candidate_occurrence_id: f.candidate_occurrence_id ?? f.id,
    claim: f.statement ?? f.value,
    decision: "reject",
    reason: "此候選來自維基文字版來源，但 subject 未能正確解析為角色名（多為頁面標題或句子碎片），且未宣告任何 coverage 維度，無法作為角色設定事實引用，予以拒絕。",
    evidence: (f.evidence_refs ?? []).map((r: any) => ({ source: r.source_id, quote: r.quote, locator: r.source_revision_id ?? r.chunk_id })),
  }));
  summary = `批次 3：reject ${decisions.length} 筆 subject 錯亂的維基文字版候選（獨立身分分工裁決）。`;
}

console.log(`BATCH ${batchArg}: decisions=${decisions.length} (undecided=${undecided.length}, toReject=${toReject.length}, toAccept=${toAccept.length})`);

async function main() {
  const server = await startWorkspaceServer({
    actor: "probe",
    host: "127.0.0.1",
    port: 0,
    projectRoot: resolve(process.cwd(), "projects"),
    autoStartWorker: false,
    projectId,
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no address");
  const endpoint = `http://127.0.0.1:${address.port}`;
  const start = Date.now();
  const response = await fetch(`${endpoint}/workspace/template`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "fact_review", decisions, summary }),
  });
  const text = await response.text();
  console.log("STATUS", response.status, "ELAPSED_MS", Date.now() - start);
  console.log("BODY", text.slice(0, 3000));
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}

main().catch((error) => {
  console.error("PROBE_FAILED", error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
