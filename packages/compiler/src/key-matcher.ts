import type { CanonicalActivation } from "@card-workspace/schemas";

export interface MatchResult {
  matched: boolean;
  matchedKeys: string[];
  invalidPatterns: string[];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function matchesPlain(text: string, key: string, caseSensitive: boolean, wholeWords: boolean): boolean {
  const flags = caseSensitive ? "u" : "iu";
  const pattern = wholeWords ? `(?<![\\p{L}\\p{N}_])${escapeRegex(key)}(?![\\p{L}\\p{N}_])` : escapeRegex(key);
  return new RegExp(pattern, flags).test(text);
}

function parseSlashRegex(value: string): RegExp | undefined {
  const match = /^\/(.*)\/([dgimsuvy]*)$/u.exec(value);
  if (!match) return undefined;
  try {
    return new RegExp(match[1] ?? "", match[2] ?? "");
  } catch {
    return undefined;
  }
}

export function matchActivation(text: string, activation: Extract<CanonicalActivation, { type: "keyed" }>): MatchResult {
  const invalidPatterns: string[] = [];
  const test = (key: string) => {
    if (!activation.use_regex) return matchesPlain(text, key, activation.case_sensitive, activation.match_whole_words);
    const regex = parseSlashRegex(key);
    if (!regex) {
      invalidPatterns.push(key);
      return false;
    }
    regex.lastIndex = 0;
    return regex.test(text);
  };
  const primary = activation.keys.filter(test);
  if (primary.length === 0) return { matched: false, matchedKeys: [], invalidPatterns };
  if (activation.secondary_keys.length === 0) return { matched: true, matchedKeys: primary, invalidPatterns };
  const secondaryMatches = activation.secondary_keys.filter(test);
  const secondary = {
    any: secondaryMatches.length > 0,
    all: secondaryMatches.length === activation.secondary_keys.length,
    not_any: secondaryMatches.length === 0,
    not_all: secondaryMatches.length < activation.secondary_keys.length,
  }[activation.secondary_logic];
  return {
    matched: secondary,
    matchedKeys: secondary ? [...primary, ...secondaryMatches] : primary,
    invalidPatterns,
  };
}
