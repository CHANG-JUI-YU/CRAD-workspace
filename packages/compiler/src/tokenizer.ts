import { getEncoding } from "js-tiktoken";

export interface Tokenizer {
  id: string;
  version: string;
  exact: boolean;
  count(text: string): number;
}

export function createCl100kTokenizer(): Tokenizer {
  const encoding = getEncoding("cl100k_base");
  return {
    id: "cl100k_base",
    version: "js-tiktoken@1.0.21",
    exact: true,
    count: (text) => encoding.encode(text).length,
  };
}

export function createApproximateTokenizer(): Tokenizer {
  return {
    id: "unicode-codepoint-quarter",
    version: "1",
    exact: false,
    count: (text) => Math.ceil([...text].length / 4),
  };
}
