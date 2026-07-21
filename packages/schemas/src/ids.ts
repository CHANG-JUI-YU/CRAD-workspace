import { z } from "zod";

const stableIdPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

export const stableIdSchema = z
  .string()
  .min(1)
  .max(96)
  .regex(stableIdPattern, "必須使用小寫英數字，並僅以 .、_ 或 - 分隔");

export const revisionSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export type StableId = z.infer<typeof stableIdSchema>;
export type Revision = z.infer<typeof revisionSchema>;
