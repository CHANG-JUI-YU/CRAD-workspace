declare module "css-tree" {
  export interface CssNode {
    readonly type: string;
    readonly [key: string]: unknown;
  }

  export interface ParseOptions {
    readonly context?: string;
  }

  export function parse(source: string, options?: ParseOptions): CssNode;
  export function generate(node: CssNode): string;
  export function walk(node: CssNode, callback: (node: CssNode) => void): void;
}
