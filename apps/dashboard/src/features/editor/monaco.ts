import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution";
import "monaco-editor/esm/vs/language/json/monaco.contribution";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";

const workerScope = globalThis as typeof globalThis & {
  MonacoEnvironment?: { getWorker: (_moduleId: string, label: string) => Worker };
};

workerScope.MonacoEnvironment = {
  getWorker: (_moduleId, label) => label === "json" ? new jsonWorker() : new editorWorker(),
};

loader.config({ monaco });
