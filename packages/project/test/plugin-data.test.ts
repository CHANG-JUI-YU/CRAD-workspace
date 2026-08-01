import { writeFile } from "node:fs/promises";
import { makeTemporaryWorkspace } from "@card-workspace/testing";
import { describe, expect, it } from "vitest";

import {
  PLUGIN_DATA_MAX_BYTES,
  PLUGIN_DATA_MAX_DEPTH,
  PLUGIN_DATA_MAX_NODES,
  parsePluginDataFile,
  parsePluginDataText,
} from "../src/index.js";

describe("plugin-data@1 parser", () => {
  it("拒絕 JSON duplicate keys 與 prototype pollution keys", () => {
    expect(() => parsePluginDataText('{"name":1,"name":2}', "json")).toThrow(/重複/u);
    expect(() => parsePluginDataText('{"__proto__":{}}', "json")).toThrow(/不允許/u);
    expect(() => parsePluginDataText('{"constructor":true}', "json")).toThrow(/不允許/u);
  });

  it("拒絕 YAML alias、merge、custom tag 與多文件", () => {
    expect(() => parsePluginDataText("base: &base\n  value: 1\ncopy: *base\n", "yaml")).toThrow(/alias|anchor/u);
    expect(() => parsePluginDataText("base: {value: 1}\ncopy:\n  <<: *base\n", "yaml")).toThrow(/alias|anchor|merge/u);
    expect(() => parsePluginDataText("value: !custom 1\n", "yaml")).toThrow(/tag|custom/u);
    expect(() => parsePluginDataText("---\none: 1\n---\ntwo: 2\n", "yaml")).toThrow(/document/u);
  });

  it("在 materialization 前拒絕超深與超多節點資料", () => {
    const deep = `${"[".repeat(PLUGIN_DATA_MAX_DEPTH + 1)}0${"]".repeat(PLUGIN_DATA_MAX_DEPTH + 1)}`;
    expect(() => parsePluginDataText(deep, "json")).toThrow(/深度|上限/u);
    const many = `[${Array.from({ length: PLUGIN_DATA_MAX_NODES }, () => "0").join(",")}]`;
    expect(() => parsePluginDataText(many, "json")).toThrow(/節點|上限/u);
  });

  it("接受 bounded JSON/YAML 並保留 typed data", () => {
    expect(parsePluginDataText('{"enabled":true,"count":2}', "json")).toEqual({ enabled: true, count: 2 });
    expect(parsePluginDataText("enabled: true\ncount: 2\n", "yaml")).toEqual({ enabled: true, count: 2 });
  });
  it("covers bounded parser primitive and malformed syntax branches", () => {
    for (const raw of ["true", "false", "null", "-1", "1.25", "1e2", "[ ]", "[1,2]", "{ }"]) expect(parsePluginDataText(raw, "json")).toBeDefined();
    expect(parsePluginDataText(JSON.stringify("escaped`n"), "json")).toBe("escaped`n");
    for (const [index, raw] of ["", " ", "undefined", "{\\\"a\\\":1", "{\\\"a\\\" 1}", "[1", "[1 2]", "\\\"unterminated", "{\\\"a\\\":1} trailing", "{\\\"a\\\":\\u0001}"].entries()) expect(() => parsePluginDataText(raw, "json"), `invalid json ${index}`).toThrow();
    for (const raw of ["%YAML 1.2\na: 1", "---\none: 1\n---\ntwo: 2", "[a, b]: value", "? [a, b]\n: value", "a: [1, 2\n"]) expect(() => parsePluginDataText(raw, "yaml")).toThrow();
    expect(parsePluginDataText("- one\n- two\n", "yaml")).toEqual(["one", "two"]);
  });
  it("covers parser cursor boundary and YAML scalar branches", () => {
    for (const raw of [
      '{"a"}',
      '{"a":1,}',
      '{"a" 1}',
      '[1,]',
      '[1 2]',
        String.fromCharCode(34) + "bad" + String.fromCharCode(1) + String.fromCharCode(34),
      '"unterminated',
      '{"a":1} trailing',
    ]) {
      expect(() => parsePluginDataText(raw, "json")).toThrow();
    }
    expect(() => parsePluginDataText("a: [", "yaml")).toThrow();
    expect(parsePluginDataText("null\n", "yaml")).toBeNull();
    expect(parsePluginDataText("true\n", "yaml")).toBe(true);
  });
  it("covers file decoding, extension inference, limits, and YAML key guards", async () => {
    const workspace = await makeTemporaryWorkspace();
    try {
      const jsonPath = `${workspace.root}/data.json`;
      await writeFile(jsonPath, "{\"ok\":true}", "utf8");
      await expect(parsePluginDataFile(jsonPath)).resolves.toMatchObject({ data: { ok: true } });
      await expect(parsePluginDataFile(jsonPath, "yaml")).resolves.toMatchObject({ data: { ok: true } });
      const yamlPath = `${workspace.root}/data.yaml`;
      await writeFile(yamlPath, "enabled: true\n", "utf8");
      await expect(parsePluginDataFile(yamlPath)).resolves.toMatchObject({ data: { enabled: true } });
      await writeFile(`${workspace.root}/bad.bin`, Buffer.from([0xff, 0xfe]));
      await expect(parsePluginDataFile(`${workspace.root}/bad.bin`)).rejects.toMatchObject({ code: "PLUGIN_DATA_ENCODING_INVALID" });
      await writeFile(`${workspace.root}/large.json`, Buffer.alloc(PLUGIN_DATA_MAX_BYTES + 1, 0x20));
      await expect(parsePluginDataFile(`${workspace.root}/large.json`)).rejects.toMatchObject({ code: "PLUGIN_DATA_LIMIT" });
      for (const raw of ["__proto__: 1\n", "constructor: 1\n", "prototype: 1\n", "[a, b]: value\n"]) {
        expect(() => parsePluginDataText(raw, "yaml")).toThrow();
      }
    } finally {
      await workspace.cleanup();
    }
  });
});


it("covers YAML scalar limits and JSON object/array boundary errors", () => {
  expect(() => parsePluginDataText('{"a":1 "b":2}', "json")).toThrow();
  expect(() => parsePluginDataText('{"a":1', "json")).toThrow();
  expect(() => parsePluginDataText("[1", "json")).toThrow();
  expect(() => parsePluginDataText("", "yaml")).toThrow();
  const nestedYaml = "{a: ".repeat(PLUGIN_DATA_MAX_DEPTH + 2) + "0" + "}".repeat(PLUGIN_DATA_MAX_DEPTH + 2);
  expect(() => parsePluginDataText(nestedYaml, "yaml")).toThrow(/超過上限/u);
  expect(() => parsePluginDataText(" ".repeat(PLUGIN_DATA_MAX_BYTES + 1), "json")).toThrow(/1 MiB/u);
});
