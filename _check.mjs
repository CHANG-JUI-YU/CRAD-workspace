import { readFileSync } from 'fs';
import { workflowStateSchema } from '@card-workspace/schemas';
const raw = readFileSync('C:/AI/projects/card-workspace/projects/ningxiang-fu-v3/workflow.json', 'utf8');
const result = workflowStateSchema.safeParse(JSON.parse(raw));
if (result.success) {
  console.log('WORKFLOW VALID - revision:', result.data.revision, 'stage:', result.data.stage);
  console.log('tasks:', result.data.tasks.length);
} else {
  console.log('WORKFLOW INVALID:');
  for (const issue of result.error.issues) {
    console.log('  path:', issue.path.join('.'), 'msg:', issue.message);
  }
}
