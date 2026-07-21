import {
  pluginRuntimeAssetSchema,
  type PluginImplementationPin,
  type PluginRuntimeAsset,
} from "@card-workspace/schemas";

import { revisionFor } from "../canonical.js";

export const officialMvuRuntimeUrl = "https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource@043b72ae5f261de0953b2954bb5aba3f24c87bcb/dist/util/mvu_zod.js";

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

export const mvuRuntimeAsset = freezeDeep(pluginRuntimeAssetSchema.parse({
  id: "mvu-zod-runtime",
  url: officialMvuRuntimeUrl,
  content_hash: "sha256:1e4c6a613ae310a03bfc8e87dd9749bb89efac321fe7afef7b0c6284526128f1",
  allowed_use: "mvu_runtime",
  redirect_policy: "same_url_only",
}));

const manifestBody = freezeDeep({
  schema_version: 1 as const,
  id: "sillytavern-assets",
  assets: freezeDeep([mvuRuntimeAsset]),
});

export const officialMvuAssetManifest = freezeDeep({
  ...manifestBody,
  revision: revisionFor(manifestBody),
  hash: revisionFor({ manifest: manifestBody, assets: manifestBody.assets }),
} as const);

export type OfficialMvuAssetManifest = typeof officialMvuAssetManifest;

export function officialMvuAssetPin(
  implementation: Pick<PluginImplementationPin, "version" | "digest">,
): PluginImplementationPin {
  return {
    version: implementation.version,
    digest: implementation.digest,
    asset_manifest_id: officialMvuAssetManifest.id,
    asset_manifest_revision: officialMvuAssetManifest.revision,
    asset_manifest_hash: officialMvuAssetManifest.hash,
  };
}

export function mvuRuntimeAssets(): readonly PluginRuntimeAsset[] {
  return officialMvuAssetManifest.assets;
}

export function assertOfficialMvuAssetPin(implementation: PluginImplementationPin): void {
  if (implementation.asset_manifest_id !== officialMvuAssetManifest.id
    || implementation.asset_manifest_revision !== officialMvuAssetManifest.revision
    || implementation.asset_manifest_hash !== officialMvuAssetManifest.hash) {
    throw new Error("MVU implementation pin 與官方 asset manifest 不一致");
  }
}
