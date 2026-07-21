import type { MvuSource, PluginImplementationPin } from "@card-workspace/schemas";
import { describe, expect, it } from "vitest";

import {
  assertPluginSourcePinned,
  assertRegistryUpgradePreservesPins,
  createOfficialPluginImplementationRegistry,
  migratePinnedPluginSource,
  officialPluginImplementationRegistry,
  resolveExactPluginImplementation,
  resolvePluginSelectionDependencies,
} from "../src/index.js";

function nextPin(current: PluginImplementationPin): PluginImplementationPin {
  return {
    ...current,
    version: "1.1.0",
    digest: `sha256:${"b".repeat(64)}`,
  };
}

function mvuSource(implementation: PluginImplementationPin): MvuSource {
  return {
    schema_version: 1,
    plugin_id: "official.mvu-zod",
    project_kind: "character_card",
    implementation,
    variables: [{ name: "mood", type: "string", default: "calm" }],
  };
}

describe("official plugin implementation registry", () => {
  it("uses one capability-sensitive dependency resolver for all selection shapes", () => {
    expect(resolvePluginSelectionDependencies([])).toEqual([]);
    expect(resolvePluginSelectionDependencies([
      { plugin_id: "official.html", capabilities: ["html.message_presentation"] },
    ])).toEqual(["official.html"]);
    expect(resolvePluginSelectionDependencies([
      { plugin_id: "official.html", capabilities: ["html.status_bar"] },
    ])).toEqual(["official.html", "official.mvu-zod"]);
    expect(resolvePluginSelectionDependencies([
      { plugin_id: "official.ejs", capabilities: ["ejs"] },
      { plugin_id: "official.html", capabilities: ["html.message_presentation"] },
    ])).toEqual(["official.ejs", "official.html", "official.mvu-zod"]);
  });

  it("只接受 exact pin，registry 升級不會靜默改寫既有 source", () => {
    const current = officialPluginImplementationRegistry.implementations.find(
      (record) => record.plugin_id === "official.mvu-zod",
    );
    expect(current).toBeDefined();
    if (!current) return;
    const upgraded = nextPin(current.implementation);
    const next = createOfficialPluginImplementationRegistry([
      ...officialPluginImplementationRegistry.implementations,
      { plugin_id: "official.mvu-zod", implementation: upgraded },
    ], [{ plugin_id: "official.mvu-zod", from: current.implementation, to: upgraded }]);

    assertRegistryUpgradePreservesPins(officialPluginImplementationRegistry, next);
    expect(resolveExactPluginImplementation(next, current.plugin_id, current.implementation)).toEqual(current);
    expect(() => resolveExactPluginImplementation(next, current.plugin_id, {
      ...current.implementation,
      digest: `sha256:${"c".repeat(64)}`,
    })).toThrow("禁止 fall-forward");

    const source = mvuSource(current.implementation);
    expect(assertPluginSourcePinned(next, source)).toEqual(current);
    const migrated = migratePinnedPluginSource(next, source, upgraded);
    expect(migrated.source.implementation).toEqual(upgraded);
    expect(migrated.migration_revision).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("沒有明確 migration 時拒絕跨版本升級，且舊 registry pin 被刪除時升級失敗", () => {
    const current = officialPluginImplementationRegistry.implementations.find(
      (record) => record.plugin_id === "official.mvu-zod",
    );
    expect(current).toBeDefined();
    if (!current) return;
    const upgraded = nextPin(current.implementation);
    const withoutMigration = createOfficialPluginImplementationRegistry([
      { plugin_id: current.plugin_id, implementation: current.implementation },
      { plugin_id: current.plugin_id, implementation: upgraded },
    ]);
    expect(() => migratePinnedPluginSource(withoutMigration, mvuSource(current.implementation), upgraded))
      .toThrow("未找到明確 migration");

    const droppedOldPin = createOfficialPluginImplementationRegistry([
      { plugin_id: current.plugin_id, implementation: upgraded },
    ]);
    expect(() => assertRegistryUpgradePreservesPins(officialPluginImplementationRegistry, droppedOldPin))
      .toThrow("未知的 exact implementation pin");
  });

  it("registry revision 不受輸入順序影響，migration 不會改寫 source", () => {
    const current = officialPluginImplementationRegistry.implementations.find(
      (record) => record.plugin_id === "official.mvu-zod",
    );
    expect(current).toBeDefined();
    if (!current) return;
    const upgraded = nextPin(current.implementation);
    const records = [
      ...officialPluginImplementationRegistry.implementations,
      { plugin_id: current.plugin_id, implementation: upgraded },
    ];
    const migration = [{ plugin_id: current.plugin_id, from: current.implementation, to: upgraded }];
    const first = createOfficialPluginImplementationRegistry(records, migration);
    const second = createOfficialPluginImplementationRegistry([...records].reverse(), [...migration].reverse());

    expect(second.revision).toBe(first.revision);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.implementations)).toBe(true);
    expect(Object.isFrozen(first.migrations)).toBe(true);

    const source = mvuSource(current.implementation);
    const before = JSON.stringify(source);
    const migrated = migratePinnedPluginSource(first, source, upgraded);
    expect(JSON.stringify(source)).toBe(before);
    expect(migrated.source).not.toBe(source);
    expect(migrated.source.implementation).toEqual(upgraded);
  });
});
