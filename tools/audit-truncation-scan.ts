import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const projectRoot = process.argv[2] ?? "projects";

interface AuditEvent {
  event?: string;
}

interface ProjectState {
  audit?: AuditEvent[];
  project_name?: string;
  project_id?: string;
}

async function findStateFiles(dir: string, depth = 0): Promise<string[]> {
  if (depth > 4) return [];
  const results: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) results.push(...await findStateFiles(full, depth + 1));
      else if (entry.name === "state.json") results.push(full);
    }
  } catch {
    return [];
  }
  return results;
}

const interviewEvents = new Set(["interview.started", "interview.answer.recorded", "blueprint.precheck.recorded", "operation.created", "workflow.answer_interview", "blueprint.revision.proposed", "source.candidates_registered"]);

let truncated = 0;
let suspicious = 0;
let clean = 0;

for (const stateFile of await findStateFiles(projectRoot)) {
  let parsed: ProjectState;
  try {
    parsed = JSON.parse(await readFile(stateFile, "utf8")) as ProjectState;
  } catch {
    console.log(`UNREADABLE ${stateFile}`);
    continue;
  }
  const audit = parsed.audit ?? [];
  const firstConfirmed = audit.findIndex((event) => event.event === "blueprint.precheck.confirmed");
  const label = `${stateFile} (${parsed.project_name ?? parsed.project_id ?? "unknown"}, audit=${audit.length})`;
  if (firstConfirmed === -1) {
    console.log(`CLEAN    ${label} - no precheck.confirmed event`);
    clean += 1;
    continue;
  }
  const before = audit.slice(0, firstConfirmed);
  const hasHistory = before.some((event) => event.event !== undefined && interviewEvents.has(event.event));
  if (firstConfirmed === 0 || (firstConfirmed === 1 && before[0]?.event === "blueprint.created") || !hasHistory) {
    console.log(`TRUNCATED ${label} - audit history before precheck.confirmed was replaced (first events: ${before.map((event) => event.event).join(", ") || "none"})`);
    truncated += 1;
  } else {
    console.log(`CLEAN    ${label} - ${before.length} events preserved before confirmation (${before.map((event) => event.event).slice(0, 4).join(", ")}...)`);
    clean += 1;
  }
}

console.log(`\nScanned ${clean + truncated + suspicious} state files: ${clean} clean, ${truncated} truncated, ${suspicious} suspicious`);
if (truncated > 0) process.exitCode = 1;
