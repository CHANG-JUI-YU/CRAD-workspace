import { z } from "zod";

import { projectKindSchema } from "./project.js";
import { revisionSchema, stableIdSchema } from "./ids.js";
import { jsonObjectSchema, jsonValueSchema, type JsonValue } from "./json.js";

export const officialPluginIdSchema = z.enum([
  "official.mvu-zod",
  "official.ejs",
  "official.html",
]);

export const pluginCapabilitySchema = z.enum([
  "mvu",
  "ejs",
  "html.status_bar",
  "html.message_presentation",
  "html.greeting_selector",
]);

export const jsonPointerPathSchema = z
  .string()
  .refine((value) => {
    if (!value.startsWith("/")) return false;
    for (let index = 0; index < value.length; index += 1) {
      const character = value[index]!;
      const code = value.charCodeAt(index);
      if (code <= 0x1f || code === 0x7f || character.trim() === "" || "\"'<>\\".includes(character)) {
        return false;
      }
      if (character === "~" && value[index + 1] !== "0" && value[index + 1] !== "1") {
        return false;
      }
    }
    return true;
  }, "必須是沒有危險字元的 RFC6901 JSON Pointer");

export const pluginImplementationPinSchema = z
  .object({
    version: z.string().regex(/^\d+\.\d+\.\d+$/u),
    digest: revisionSchema,
    asset_manifest_id: stableIdSchema,
    asset_manifest_revision: revisionSchema,
    asset_manifest_hash: revisionSchema,
  })
  .strict();

export const blueprintPluginSelectionSchema = z
  .object({
    plugin_id: officialPluginIdSchema,
    capabilities: z.array(pluginCapabilitySchema).min(1),
    template_id: stableIdSchema.optional(),
  })
  .strict()
  .superRefine((selection, context) => {
    const capabilities = new Set(selection.capabilities);
    if (selection.plugin_id === "official.mvu-zod" && !capabilities.has("mvu")) {
      context.addIssue({ code: "custom", message: "MVU plugin selection 必須包含 mvu capability", path: ["capabilities"] });
    }
    if (selection.plugin_id === "official.ejs" && !capabilities.has("ejs")) {
      context.addIssue({ code: "custom", message: "EJS plugin selection 必須包含 ejs capability", path: ["capabilities"] });
    }
    if (selection.plugin_id === "official.html" && !selection.capabilities.some((capability) => capability.startsWith("html."))) {
      context.addIssue({ code: "custom", message: "HTML plugin selection 必須包含 HTML capability", path: ["capabilities"] });
    }
  });

export const pluginSelectionSchema = z
  .object({
    schema_version: z.literal(1),
    plugin_id: officialPluginIdSchema,
    capabilities: z.array(pluginCapabilitySchema).min(1),
    source_revision: revisionSchema,
    implementation: pluginImplementationPinSchema,
    artifact_revision: revisionSchema,
  })
  .strict();

export const pluginRevisionPinSchema = z
  .object({
    plugin_id: officialPluginIdSchema,
    implementation: pluginImplementationPinSchema,
  })
  .strict();

const pluginSourceBaseSchema = z.object({
  schema_version: z.literal(1),
  project_kind: z.literal("character_card"),
  implementation: pluginImplementationPinSchema,
  template_id: stableIdSchema.optional(),
});

export const mvuScalarTypeSchema = z.enum(["string", "number", "integer", "boolean"]);

const mvuLegacyVariableSchema = z
  .object({
    name: stableIdSchema,
    type: mvuScalarTypeSchema,
    default: z.union([z.string(), z.number().finite(), z.boolean()]),
    writable: z.boolean().default(false),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
  })
  .strict()
  .superRefine((variable, context) => {
    if (variable.type === "string" && typeof variable.default !== "string") {
      context.addIssue({ code: "custom", message: "string variable 的 default 必須是字串", path: ["default"] });
    }
    if ((variable.type === "number" || variable.type === "integer") && typeof variable.default !== "number") {
      context.addIssue({ code: "custom", message: "numeric variable 的 default 必須是數字", path: ["default"] });
    }
    if (variable.type === "boolean" && typeof variable.default !== "boolean") {
      context.addIssue({ code: "custom", message: "boolean variable 的 default 必須是布林值", path: ["default"] });
    }
    if (variable.type === "integer" && typeof variable.default === "number" && !Number.isInteger(variable.default)) {
      context.addIssue({ code: "custom", message: "integer variable 的 default 必須是整數", path: ["default"] });
    }
    if ((variable.min !== undefined || variable.max !== undefined) && !["number", "integer"].includes(variable.type)) {
      context.addIssue({ code: "custom", message: "min/max 只適用於 numeric variable", path: ["min"] });
    }
    if (variable.min !== undefined && variable.max !== undefined && variable.min > variable.max) {
      context.addIssue({ code: "custom", message: "variable min 不可大於 max", path: ["min"] });
    }
  });

const mvuDangerousIds = new Set(["__proto__", "prototype", "constructor"]);

export interface MvuVariableNodeBaseOutput {
  id: string;
  label: string;
  description?: string;
  visibility: "visible" | "hidden";
  writable: boolean;
  update_rules: string[];
}

export interface MvuStringNodeOutput extends MvuVariableNodeBaseOutput {
  kind: "string";
  default: string;
  min_length?: number;
  max_length?: number;
}

export interface MvuNumberNodeOutput extends MvuVariableNodeBaseOutput {
  kind: "number";
  default: number;
  min?: number;
  max?: number;
  clamp: boolean;
}

export interface MvuIntegerNodeOutput extends MvuVariableNodeBaseOutput {
  kind: "integer";
  default: number;
  min?: number;
  max?: number;
  clamp: boolean;
}

export interface MvuBooleanNodeOutput extends MvuVariableNodeBaseOutput {
  kind: "boolean";
  default: boolean;
}

export interface MvuEnumNodeOutput extends MvuVariableNodeBaseOutput {
  kind: "enum";
  values: string[];
  default: string;
}

export interface MvuObjectNodeOutput extends MvuVariableNodeBaseOutput {
  kind: "object";
  fields: MvuVariableNodeOutput[];
  default: Record<string, JsonValue>;
}

export interface MvuArrayNodeOutput extends MvuVariableNodeBaseOutput {
  kind: "array";
  items: MvuVariableNodeOutput;
  default: JsonValue[];
  min_items?: number;
  max_items?: number;
}

export type MvuVariableNodeOutput =
  | MvuStringNodeOutput
  | MvuNumberNodeOutput
  | MvuIntegerNodeOutput
  | MvuBooleanNodeOutput
  | MvuEnumNodeOutput
  | MvuObjectNodeOutput
  | MvuArrayNodeOutput;

const mvuVariableNodeBaseSchema = z
  .object({
    id: stableIdSchema,
    label: z.string().min(1),
    description: z.string().optional(),
    visibility: z.enum(["visible", "hidden"]).default("visible"),
    writable: z.boolean().default(false),
    update_rules: z.array(z.string().min(1)).default([]),
  })
  .strict();

const mvuStringNodeSchema = mvuVariableNodeBaseSchema
  .extend({
    kind: z.literal("string"),
    default: z.string(),
    min_length: z.number().int().nonnegative().optional(),
    max_length: z.number().int().nonnegative().optional(),
  })
  .superRefine((node, context) => {
    if (node.min_length !== undefined && node.max_length !== undefined && node.min_length > node.max_length) {
      context.addIssue({ code: "custom", path: ["min_length"], message: "string min_length 不可大於 max_length" });
    }
    if (node.min_length !== undefined && node.default.length < node.min_length) {
      context.addIssue({ code: "custom", path: ["default"], message: "string default 長度小於 min_length" });
    }
    if (node.max_length !== undefined && node.default.length > node.max_length) {
      context.addIssue({ code: "custom", path: ["default"], message: "string default 長度大於 max_length" });
    }
  });

const mvuNumberNodeSchema = mvuVariableNodeBaseSchema
  .extend({
    kind: z.literal("number"),
    default: z.number().finite(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    clamp: z.boolean().default(true),
  })
  .superRefine((node, context) => {
    if (node.min !== undefined && node.max !== undefined && node.min > node.max) {
      context.addIssue({ code: "custom", path: ["min"], message: "number min 不可大於 max" });
    }
    if (node.min !== undefined && node.default < node.min) {
      context.addIssue({ code: "custom", path: ["default"], message: "number default 小於 min" });
    }
    if (node.max !== undefined && node.default > node.max) {
      context.addIssue({ code: "custom", path: ["default"], message: "number default 大於 max" });
    }
  });

const mvuIntegerNodeSchema = mvuVariableNodeBaseSchema
  .extend({
    kind: z.literal("integer"),
    default: z.number().int().finite(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    clamp: z.boolean().default(true),
  })
  .superRefine((node, context) => {
    if (node.min !== undefined && node.max !== undefined && node.min > node.max) {
      context.addIssue({ code: "custom", path: ["min"], message: "integer min 不可大於 max" });
    }
    if (node.min !== undefined && node.default < node.min) {
      context.addIssue({ code: "custom", path: ["default"], message: "integer default 小於 min" });
    }
    if (node.max !== undefined && node.default > node.max) {
      context.addIssue({ code: "custom", path: ["default"], message: "integer default 大於 max" });
    }
  });

const mvuBooleanNodeSchema = mvuVariableNodeBaseSchema.extend({
  kind: z.literal("boolean"),
  default: z.boolean(),
});

const mvuEnumNodeSchema = mvuVariableNodeBaseSchema
  .extend({
    kind: z.literal("enum"),
    values: z.array(z.string().min(1)).min(1),
    default: z.string(),
  })
  .superRefine((node, context) => {
    if (new Set(node.values).size !== node.values.length) {
      context.addIssue({ code: "custom", path: ["values"], message: "enum values 不可重複" });
    }
    if (!node.values.includes(node.default)) {
      context.addIssue({ code: "custom", path: ["default"], message: "enum default 必須存在於 values" });
    }
  });

const mvuObjectNodeSchema = mvuVariableNodeBaseSchema.extend({
  kind: z.literal("object"),
  fields: z.array(z.lazy(() => recursiveMvuVariableNodeSchema)).min(1),
  default: z.record(z.string(), jsonValueSchema),
});

const mvuArrayNodeSchema = mvuVariableNodeBaseSchema
  .extend({
    kind: z.literal("array"),
    items: z.lazy(() => recursiveMvuVariableNodeSchema),
    default: z.array(jsonValueSchema),
    min_items: z.number().int().nonnegative().optional(),
    max_items: z.number().int().nonnegative().optional(),
  })
  .superRefine((node, context) => {
    if (node.min_items !== undefined && node.max_items !== undefined && node.min_items > node.max_items) {
      context.addIssue({ code: "custom", path: ["min_items"], message: "array min_items 不可大於 max_items" });
    }
    if (node.min_items !== undefined && node.default.length < node.min_items) {
      context.addIssue({ code: "custom", path: ["default"], message: "array default 長度小於 min_items" });
    }
    if (node.max_items !== undefined && node.default.length > node.max_items) {
      context.addIssue({ code: "custom", path: ["default"], message: "array default 長度大於 max_items" });
    }
  });

const recursiveMvuVariableNodeSchema: z.ZodType<MvuVariableNodeOutput> = z.lazy(() => z.discriminatedUnion("kind", [
  mvuStringNodeSchema,
  mvuNumberNodeSchema,
  mvuIntegerNodeSchema,
  mvuBooleanNodeSchema,
  mvuEnumNodeSchema,
  mvuObjectNodeSchema,
  mvuArrayNodeSchema,
])) as unknown as z.ZodType<MvuVariableNodeOutput>;

export const mvuVariableNodeSchema = recursiveMvuVariableNodeSchema;

export const mvuVariableSchema = z.union([mvuLegacyVariableSchema, mvuVariableNodeSchema]);

export const mvuUpdateRuleSchema = z
  .object({
    path: jsonPointerPathSchema,
    type: z.string().min(1).optional(),
    range_min: z.number().finite().optional(),
    range_max: z.number().finite().optional(),
    format: z.string().min(1).optional(),
    value: z.string().min(1).optional(),
    check: z.array(z.string().min(1)).min(1),
  })
  .strict()
  .superRefine((rule, context) => {
    if (rule.range_min !== undefined && rule.range_max !== undefined && rule.range_min > rule.range_max) {
      context.addIssue({ code: "custom", path: ["range_min"], message: "update rule range_min 不可大於 range_max" });
    }
  });

function variableId(variable: z.infer<typeof mvuVariableSchema>): string {
  return "kind" in variable ? variable.id : variable.name;
}

function validateMvuVariableIds(
  variables: readonly z.infer<typeof mvuVariableSchema>[],
  context: z.RefinementCtx,
  seen: Set<string>,
  path: readonly (string | number)[],
): void {
  variables.forEach((variable, index) => {
    const id = variableId(variable);
    if (mvuDangerousIds.has(id)) {
      context.addIssue({ code: "custom", message: `禁止的 MVU variable ID: ${id}`, path: [...path, index, "kind" in variable ? "id" : "name"] });
    }
    if (seen.has(id)) {
      context.addIssue({ code: "custom", message: `重複的 MVU variable ID: ${id}`, path: [...path, index, "kind" in variable ? "id" : "name"] });
    }
    seen.add(id);
    if ("kind" in variable && variable.kind === "object") {
      validateMvuVariableIds(variable.fields, context, seen, [...path, index, "fields"]);
    }
    if ("kind" in variable && variable.kind === "array") {
      validateMvuVariableIds([variable.items], context, seen, [...path, index, "items"]);
    }
  });
}

export const mvuSourceSchema = pluginSourceBaseSchema
  .extend({
    plugin_id: z.literal("official.mvu-zod"),
    variables: z.array(mvuVariableSchema).min(1),
    update_rules: z.array(mvuUpdateRuleSchema).default([]),
  })
  .strict()
  .superRefine((source, context) => {
    validateMvuVariableIds(source.variables, context, new Set<string>(), ["variables"]);
    const rulePaths = new Set<string>();
    source.update_rules.forEach((rule, index) => {
      if (rulePaths.has(rule.path)) {
        context.addIssue({ code: "custom", message: `重複的 MVU update rule path: ${rule.path}`, path: ["update_rules", index, "path"] });
      }
      rulePaths.add(rule.path);
    });
  });

export const ejsConditionSchema = z
  .object({
    path: jsonPointerPathSchema,
    operator: z.enum(["equals", "not_equals", "greater_than", "less_than", "truthy", "falsy"]),
    value: z.union([z.string(), z.number().finite(), z.boolean()]).optional(),
  })
  .strict()
  .superRefine((condition, context) => {
    if (["truthy", "falsy"].includes(condition.operator) && condition.value !== undefined) {
      context.addIssue({ code: "custom", message: "truthy/falsy condition 不可帶 value", path: ["value"] });
    }
    if (!["truthy", "falsy"].includes(condition.operator) && condition.value === undefined) {
      context.addIssue({ code: "custom", message: "比較 condition 必須帶 value", path: ["value"] });
    }
  });

export type EjsScalarValue = string | number | boolean | null;

export interface EjsVariableExpressionOutput {
  kind: "variable";
  path: string;
}

export interface EjsLiteralExpressionOutput {
  kind: "literal";
  value: EjsScalarValue;
}

export interface EjsCompareExpressionOutput {
  kind: "compare";
  operator: "equals" | "not_equals" | "greater_than" | "less_than";
  left: EjsExpressionOutput;
  right: EjsExpressionOutput;
}

export interface EjsMembershipExpressionOutput {
  kind: "in";
  value: EjsExpressionOutput;
  values: EjsScalarValue[];
}

export interface EjsAllExpressionOutput {
  kind: "all";
  conditions: EjsExpressionOutput[];
}

export interface EjsAnyExpressionOutput {
  kind: "any";
  conditions: EjsExpressionOutput[];
}

export interface EjsNotExpressionOutput {
  kind: "not";
  condition: EjsExpressionOutput;
}

export interface EjsRangeExpressionOutput {
  kind: "range";
  path: string;
  min: number | undefined;
  max: number | undefined;
  min_inclusive: boolean;
  max_inclusive: boolean;
}

export type EjsExpressionOutput =
  | EjsVariableExpressionOutput
  | EjsLiteralExpressionOutput
  | EjsCompareExpressionOutput
  | EjsMembershipExpressionOutput
  | EjsAllExpressionOutput
  | EjsAnyExpressionOutput
  | EjsNotExpressionOutput
  | EjsRangeExpressionOutput;

const ejsScalarValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const ejsRangeExpressionSchema = z
  .object({
    kind: z.literal("range"),
    path: jsonPointerPathSchema,
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    min_inclusive: z.boolean().default(true),
    max_inclusive: z.boolean().default(true),
  })
  .strict()
  .superRefine((range, context) => {
    if (range.min === undefined && range.max === undefined) {
      context.addIssue({ code: "custom", path: ["min"], message: "range 至少需要 min 或 max" });
    }
    if (range.min !== undefined && range.max !== undefined && range.min > range.max) {
      context.addIssue({ code: "custom", path: ["min"], message: "range min 不可大於 max" });
    }
  });

const ejsVariableExpressionSchema = z.object({
  kind: z.literal("variable"),
  path: jsonPointerPathSchema,
}).strict();

const ejsLiteralExpressionSchema = z.object({
  kind: z.literal("literal"),
  value: ejsScalarValueSchema,
}).strict();

const ejsCompareExpressionSchema = z.object({
  kind: z.literal("compare"),
  operator: z.enum(["equals", "not_equals", "greater_than", "less_than"]),
  left: z.lazy(() => recursiveEjsExpressionSchema),
  right: z.lazy(() => recursiveEjsExpressionSchema),
}).strict();

const ejsMembershipExpressionSchema = z.object({
  kind: z.literal("in"),
  value: z.lazy(() => recursiveEjsExpressionSchema),
  values: z.array(ejsScalarValueSchema).min(1),
}).strict();

const ejsAllExpressionSchema = z.object({
  kind: z.literal("all"),
  conditions: z.array(z.lazy(() => recursiveEjsExpressionSchema)).min(1),
}).strict();

const ejsAnyExpressionSchema = z.object({
  kind: z.literal("any"),
  conditions: z.array(z.lazy(() => recursiveEjsExpressionSchema)).min(1),
}).strict();

const ejsNotExpressionSchema = z.object({
  kind: z.literal("not"),
  condition: z.lazy(() => recursiveEjsExpressionSchema),
}).strict();

const recursiveEjsExpressionSchema: z.ZodType<EjsExpressionOutput> = z.lazy(() => z.discriminatedUnion("kind", [
  ejsVariableExpressionSchema,
  ejsLiteralExpressionSchema,
  ejsCompareExpressionSchema,
  ejsMembershipExpressionSchema,
  ejsAllExpressionSchema,
  ejsAnyExpressionSchema,
  ejsNotExpressionSchema,
  ejsRangeExpressionSchema,
])) as unknown as z.ZodType<EjsExpressionOutput>;

export const ejsExpressionSchema = recursiveEjsExpressionSchema;
export const ejsWhenSchema = z.union([ejsConditionSchema, ejsExpressionSchema]);

export const ejsEntrySchema = z
  .object({
    id: stableIdSchema,
    condition: ejsWhenSchema,
    content: z.string().min(1),
  })
  .strict();

export const ejsPreprocessingAliasSchema = z
  .object({
    id: stableIdSchema,
    path: jsonPointerPathSchema,
  })
  .strict();

export const ejsBranchSchema = z
  .object({
    when: ejsWhenSchema,
    content: z.string().min(1),
  })
  .strict();

export const ejsSectionSchema = z
  .object({
    id: stableIdSchema,
    branches: z.array(ejsBranchSchema).min(1),
    fallback: z.string().min(1).optional(),
  })
  .strict();

export const ejsDynamicTextBranchSchema = z
  .object({
    when: ejsWhenSchema,
    text: z.string().min(1),
  })
  .strict();

export const ejsDynamicTextSchema = z
  .object({
    id: stableIdSchema,
    branches: z.array(ejsDynamicTextBranchSchema).min(1),
    fallback: z.string().min(1).optional(),
  })
  .strict();

export const ejsSourceSchema = pluginSourceBaseSchema
  .extend({
    plugin_id: z.literal("official.ejs"),
    entries: z.array(ejsEntrySchema).default([]),
    preprocessing: z.array(ejsPreprocessingAliasSchema).default([]),
    sections: z.array(ejsSectionSchema).default([]),
    dynamic_text: z.array(ejsDynamicTextSchema).default([]),
  })
  .strict()
  .superRefine((source, context) => {
    if (source.entries.length === 0 && source.sections.length === 0 && source.dynamic_text.length === 0) {
      context.addIssue({ code: "custom", path: ["entries"], message: "EJS source 至少需要一個 entry、section 或 dynamic text" });
    }
    const aliasIds = new Set<string>();
    source.preprocessing.forEach((alias, index) => {
      if (aliasIds.has(alias.id)) {
        context.addIssue({ code: "custom", path: ["preprocessing", index, "id"], message: `重複的 EJS preprocessing alias: ${alias.id}` });
      }
      aliasIds.add(alias.id);
    });
    const assertText = (value: string, path: (string | number)[]): void => {
      if (value.includes("<%") || value.includes("%>")) {
        context.addIssue({ code: "custom", path, message: "EJS authored text 不可包含 raw EJS delimiter" });
      }
    };
    source.entries.forEach((entry, index) => assertText(entry.content, ["entries", index, "content"]));
    source.sections.forEach((section, sectionIndex) => {
      section.branches.forEach((branch, branchIndex) => assertText(branch.content, ["sections", sectionIndex, "branches", branchIndex, "content"]));
      if (section.fallback !== undefined) assertText(section.fallback, ["sections", sectionIndex, "fallback"]);
    });
    source.dynamic_text.forEach((dynamic, dynamicIndex) => {
      dynamic.branches.forEach((branch, branchIndex) => assertText(branch.text, ["dynamic_text", dynamicIndex, "branches", branchIndex, "text"]));
      if (dynamic.fallback !== undefined) assertText(dynamic.fallback, ["dynamic_text", dynamicIndex, "fallback"]);
    });
  });

export const htmlFeatureSchema = z.enum(["status_bar", "message_presentation", "greeting_selector"]);

export const htmlTextNodeSchema = z
  .object({
    kind: z.literal("text"),
    value: z.string(),
  })
  .strict();

export const htmlComponentSchema = z
  .object({
    id: stableIdSchema,
    feature: htmlFeatureSchema,
    tag: z.enum([
      "div",
      "span",
      "p",
      "section",
      "header",
      "footer",
      "ul",
      "ol",
      "li",
      "dl",
      "dt",
      "dd",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "button",
      "label",
      "input",
      "select",
      "option",
      "progress",
      "meter",
      "br",
      "strong",
      "em",
      "small",
    ]),
    label: z.string().min(1),
    text: z.array(htmlTextNodeSchema).default([]),
    binding_paths: z.array(jsonPointerPathSchema).default([]),
  })
  .strict();

export const htmlSourceSchema = pluginSourceBaseSchema
  .extend({
    plugin_id: z.literal("official.html"),
    features: z.array(htmlFeatureSchema).min(1),
    components: z.array(htmlComponentSchema).min(1),
  })
  .strict()
  .superRefine((source, context) => {
    const features = new Set(source.features);
    const ids = new Set<string>();
    source.components.forEach((component, index) => {
      if (!features.has(component.feature)) {
        context.addIssue({ code: "custom", message: `component feature 未在 source.features 啟用: ${component.feature}`, path: ["components", index, "feature"] });
      }
      if (ids.has(component.id)) {
        context.addIssue({ code: "custom", message: `重複的 HTML component: ${component.id}`, path: ["components", index, "id"] });
      }
      ids.add(component.id);
      if ((component.tag === "input" || component.tag === "br") && component.text.length > 0) {
        context.addIssue({ code: "custom", message: `${component.tag} 不可包含文字內容`, path: ["components", index, "text"] });
      }
      if (component.label.includes("<%") || component.label.includes("%>")) {
        context.addIssue({ code: "custom", message: "HTML label 不可包含 raw EJS delimiter", path: ["components", index, "label"] });
      }
      component.text.forEach((node, textIndex) => {
        if (node.value.includes("<%") || node.value.includes("%>")) {
          context.addIssue({ code: "custom", message: "HTML text 不可包含 raw EJS delimiter", path: ["components", index, "text", textIndex, "value"] });
        }
      });
    });
  });

export const pluginSourceSchema = z.discriminatedUnion("plugin_id", [mvuSourceSchema, ejsSourceSchema, htmlSourceSchema]);

export const pluginLoreEntryContributionSchema = z
  .object({
    id: stableIdSchema,
    name: z.string().min(1),
    keys: z.array(z.string()),
    content: z.string(),
    use_regex: z.boolean().default(false),
    enabled: z.boolean(),
    insertion_order: z.number().int(),
    constant: z.boolean().optional(),
    position: z.enum(["before_char", "after_char"]).optional(),
    depth: z.number().int().nonnegative().optional(),
    role: z.number().int().min(0).max(2).optional(),
    extensions: jsonObjectSchema,
  })
  .strict();

export const regexScriptContributionSchema = z
  .object({
    scriptName: z.string().min(1),
    findRegex: z.string().min(1),
    replaceString: z.string(),
    trimStrings: z.array(z.string()),
    placement: z.array(z.number().int()),
    disabled: z.boolean(),
    markdownOnly: z.boolean(),
    promptOnly: z.boolean(),
    runOnEdit: z.boolean(),
    substituteRegex: z.boolean(),
    minDepth: z.number().int().nonnegative().optional(),
    maxDepth: z.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine((script, context) => {
    if (script.minDepth !== undefined && script.maxDepth !== undefined && script.minDepth > script.maxDepth) {
      context.addIssue({ code: "custom", message: "regex minDepth 不可大於 maxDepth", path: ["minDepth"] });
    }
  });

const tavernHelperButtonSchema = z
  .object({
    enabled: z.boolean(),
    buttons: z.array(z.object({ name: z.string().min(1), visible: z.boolean() }).strict()),
  })
  .strict();

export const tavernHelperScriptContributionSchema = z
  .object({
    type: z.literal("script"),
    enabled: z.boolean(),
    id: stableIdSchema,
    name: z.string().min(1),
    content: z.string().min(1),
    info: z.string(),
    button: tavernHelperButtonSchema,
    data: jsonObjectSchema,
  })
  .strict();

export const pluginGreetingOperationSchema = z
  .object({
    greeting_id: stableIdSchema,
    mode: z.enum(["replace", "append"]),
    content: z.string().min(1),
  })
  .strict();

export const pluginContributionsSchema = z
  .object({
    schema_version: z.literal(1),
    plugin_id: officialPluginIdSchema,
    implementation: pluginImplementationPinSchema,
    artifact_revision: revisionSchema,
    lore_entries: z.array(pluginLoreEntryContributionSchema),
    regex_scripts: z.array(regexScriptContributionSchema),
    helper_scripts: z.array(tavernHelperScriptContributionSchema),
    greeting_operations: z.array(pluginGreetingOperationSchema),
    metadata: z.record(z.string(), jsonValueSchema),
  })
  .strict();

export const pluginRevisionIntentSchema = z
  .object({
    schema_version: z.literal(1),
    project_id: stableIdSchema,
    revision: revisionSchema,
    project_kind: projectKindSchema,
    base_selection_revision: z.union([revisionSchema, z.literal("absent")]),
    selections: z.array(blueprintPluginSelectionSchema),
    dependency_closure: z.array(officialPluginIdSchema),
    implementation_pins: z.array(pluginRevisionPinSchema),
  })
  .strict()
  .superRefine((intent, context) => {
    if (intent.selections.length > 0 && intent.project_kind !== "character_card") {
      context.addIssue({ code: "custom", message: "第一版官方 authoring plugins 僅支援 character_card", path: ["project_kind"] });
    }
    const ids = new Set<string>();
    intent.selections.forEach((selection, index) => {
      if (ids.has(selection.plugin_id)) {
        context.addIssue({ code: "custom", message: `重複的 plugin selection: ${selection.plugin_id}`, path: ["selections", index, "plugin_id"] });
      }
      ids.add(selection.plugin_id);
    });
    const selectionIds = new Set(intent.selections.map((selection) => selection.plugin_id));
    const closureIds = new Set(intent.dependency_closure);
    const pinIds = new Set(intent.implementation_pins.map((pin) => pin.plugin_id));
    if (closureIds.size !== intent.dependency_closure.length) {
      context.addIssue({ code: "custom", message: "plugin dependency closure 不可包含重複 ID", path: ["dependency_closure"] });
    }
    if (pinIds.size !== intent.implementation_pins.length) {
      context.addIssue({ code: "custom", message: "plugin implementation pins 不可包含重複 ID", path: ["implementation_pins"] });
    }
    for (const pluginId of selectionIds) {
      if (!closureIds.has(pluginId)) {
        context.addIssue({ code: "custom", message: `dependency closure 缺少 selected plugin: ${pluginId}`, path: ["dependency_closure"] });
      }
    }
    for (const pluginId of closureIds) {
      if (!pinIds.has(pluginId)) {
        context.addIssue({ code: "custom", message: `dependency closure 缺少 implementation pin: ${pluginId}`, path: ["implementation_pins"] });
      }
    }
    for (const pluginId of pinIds) {
      if (!closureIds.has(pluginId)) {
        context.addIssue({ code: "custom", message: `implementation pin 不在 dependency closure: ${pluginId}`, path: ["implementation_pins"] });
      }
    }
    const expectedDependencyIds = new Set(selectionIds);
    if (selectionIds.has("official.ejs") || intent.selections.some((selection) =>
      selection.plugin_id === "official.html" && selection.capabilities.includes("html.status_bar"))) {
      expectedDependencyIds.add("official.mvu-zod");
    }
    if (expectedDependencyIds.size !== closureIds.size || [...expectedDependencyIds].some((pluginId) => !closureIds.has(pluginId))) {
      context.addIssue({ code: "custom", message: "dependency closure 與官方 plugin 依賴規則不一致", path: ["dependency_closure"] });
    }
    const sortedSelections = [...intent.selections].sort((left, right) => left.plugin_id < right.plugin_id ? -1 : left.plugin_id > right.plugin_id ? 1 : 0);
    if (JSON.stringify(sortedSelections) !== JSON.stringify(intent.selections)) {
      context.addIssue({ code: "custom", message: "plugin selections 必須以 plugin_id lexical 排序", path: ["selections"] });
    }
    const sortedClosure = [...intent.dependency_closure].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
    if (JSON.stringify(sortedClosure) !== JSON.stringify(intent.dependency_closure)) {
      context.addIssue({ code: "custom", message: "dependency closure 必須 lexical 排序", path: ["dependency_closure"] });
    }
    const sortedPins = [...intent.implementation_pins].sort((left, right) => left.plugin_id < right.plugin_id ? -1 : left.plugin_id > right.plugin_id ? 1 : 0);
    if (JSON.stringify(sortedPins) !== JSON.stringify(intent.implementation_pins)) {
      context.addIssue({ code: "custom", message: "implementation pins 必須以 plugin_id lexical 排序", path: ["implementation_pins"] });
    }
  });

export type OfficialPluginId = z.infer<typeof officialPluginIdSchema>;
export type PluginCapability = z.infer<typeof pluginCapabilitySchema>;
export type PluginImplementationPin = z.infer<typeof pluginImplementationPinSchema>;
export type BlueprintPluginSelection = z.infer<typeof blueprintPluginSelectionSchema>;
export type PluginSelection = z.infer<typeof pluginSelectionSchema>;
export type PluginRevisionPin = z.infer<typeof pluginRevisionPinSchema>;
export type MvuSource = z.infer<typeof mvuSourceSchema>;
export type MvuVariable = z.infer<typeof mvuVariableSchema>;
export type MvuVariableNode = z.infer<typeof mvuVariableNodeSchema>;
export type MvuUpdateRule = z.infer<typeof mvuUpdateRuleSchema>;
export type EjsSource = z.infer<typeof ejsSourceSchema>;
export type EjsExpression = z.infer<typeof ejsExpressionSchema>;
export type EjsWhen = z.infer<typeof ejsWhenSchema>;
export type EjsPreprocessingAlias = z.infer<typeof ejsPreprocessingAliasSchema>;
export type EjsSection = z.infer<typeof ejsSectionSchema>;
export type EjsDynamicText = z.infer<typeof ejsDynamicTextSchema>;
export type HtmlSource = z.infer<typeof htmlSourceSchema>;
export type PluginSource = z.infer<typeof pluginSourceSchema>;
export type PluginContributions = z.infer<typeof pluginContributionsSchema>;
export type PluginRevisionIntent = z.infer<typeof pluginRevisionIntentSchema>;
