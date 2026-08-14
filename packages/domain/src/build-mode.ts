import { computeProjectProjection, type ProjectState } from "@st-workspace/core";
import type { CardModeSelection } from "@st-workspace/compiler";
import { buildRequiredArtifactManifest } from "./required-artifacts.js";

export interface BuildModeResolution {
  status: "ok" | "needs_input" | "invalid";
  mode_selection?: CardModeSelection;
  available_modes: { zhuji: boolean; palette: boolean };
  manifest_mode?: "zhuji" | "palette";
  reason?: string;
  question?: string;
}

export function resolveBuildModeSelection(state: ProjectState, requested?: CardModeSelection): BuildModeResolution {
  const projection = computeProjectProjection(state);
  const availableModes = {
    zhuji: projection.publishPlan("zhuji").entries.some((entry) => entry.kind === "zhuji"),
    palette: projection.publishPlan("palette").entries.some((entry) => entry.kind === "palette"),
  };
  const manifest = buildRequiredArtifactManifest(state);
  const manifestMode = manifest === undefined || manifest.export_modes === "both" ? undefined : manifest.export_modes;
  const modeUsable = (selection: CardModeSelection): boolean => {
    if (manifestMode !== undefined) {
      if (selection === "both" || selection !== manifestMode) return false;
      return availableModes[manifestMode];
    }
    if (selection === "both") return availableModes.zhuji && availableModes.palette;
    return availableModes[selection];
  };
  const onlyAvailableMode = availableModes.zhuji === availableModes.palette
    ? undefined
    : availableModes.zhuji
    ? "zhuji"
    : availableModes.palette
    ? "palette"
    : undefined;
  const base: Omit<BuildModeResolution, "status" | "mode_selection"> = { available_modes: availableModes, ...(manifestMode === undefined ? {} : { manifest_mode: manifestMode }) };
  if (requested !== undefined) {
    if (!modeUsable(requested)) {
      return {
        ...base,
        status: "invalid",
        reason: "BUILD_MODE_INVALID",
        question: `本次打包可用模式為${availableModes.zhuji ? "珠璣" : ""}${availableModes.zhuji && availableModes.palette ? "、" : ""}${availableModes.palette ? "調色盤" : ""}${manifestMode === undefined ? "" : `（Blueprint 限定 ${manifestMode === "zhuji" ? "珠璣" : "調色盤"}）`}，請重新選擇。`,
      };
    }
    return { ...base, status: "ok", mode_selection: requested };
  }
  const auto = manifestMode !== undefined && availableModes[manifestMode] ? manifestMode : onlyAvailableMode;
  if (auto !== undefined && modeUsable(auto)) {
    return { ...base, status: "ok", mode_selection: auto };
  }
  if (availableModes.zhuji && availableModes.palette) {
    return {
      ...base,
      status: "needs_input",
      reason: "MODE_SELECTION_REQUIRED",
      question: manifestMode === undefined
        ? "本次打包同時有珠璣與調色盤模組，請選擇：珠璣、調色盤，或兩者。"
        : `本次打包同時有珠璣與調色盤模組；Blueprint 選定 ${manifestMode === "zhuji" ? "珠璣" : "調色盤"}，本次只能打包該模式。請確認後再試。`,
    };
  }
  return { ...base, status: "ok" };
}
