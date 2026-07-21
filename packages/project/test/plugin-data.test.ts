import { describe, expect, it } from "vitest";

import {
  PLUGIN_DATA_MAX_DEPTH,
  PLUGIN_DATA_MAX_NODES,
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
});
