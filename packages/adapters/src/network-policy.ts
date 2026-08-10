import { isIP } from "node:net";

export function stripBrackets(hostname: string): string {
  if (hostname.length >= 2 && hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

export function isIpLiteral(hostname: string): boolean {
  return isIP(stripBrackets(hostname.trim())) !== 0;
}

export function parseIpv4(ip: string): number[] | null {
  const parts = ip.trim().split(".");
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    bytes.push(value);
  }
  return bytes;
}

export function isUnsafeIpv4(ip: string): boolean {
  const bytes = parseIpv4(ip);
  if (bytes === null) return false;
  const a = bytes[0]!;
  const b = bytes[1]!;
  const c = bytes[2]!;
  if (a === 0) return true;                                               // 0.0.0.0/8（含 unspecified）
  if (a === 10) return true;                                              // private
  if (a === 100 && b >= 64 && b <= 127) return true;                      // 100.64.0.0/10 CGNAT
  if (a === 127) return true;                                             // loopback
  if (a === 169 && b === 254) return true;                                // link-local
  if (a === 172 && b >= 16 && b <= 31) return true;                       // private
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;          // IETF 保留 / documentation
  if (a === 192 && b === 168) return true;                                // private
  if (a === 198 && (b === 18 || b === 19)) return true;                   // benchmark
  if (a === 198 && b === 51 && c === 100) return true;                    // documentation
  if (a === 203 && b === 0 && c === 113) return true;                     // documentation
  if (a >= 224) return true;                                              // multicast + reserved
  return false;
}

export function parseIpv6(ip: string): number[] | null {
  let input = ip.trim();
  if (input.startsWith("[") && input.endsWith("]")) input = input.slice(1, -1);
  if (input === "") return null;
  if (input.includes(".")) {
    const lastColon = input.lastIndexOf(":");
    if (lastColon === -1) return null;
    const v4 = parseIpv4(input.slice(lastColon + 1));
    if (v4 === null) return null;
    input = input.slice(0, lastColon + 1) +
      ((v4[0]! << 8) | v4[1]!).toString(16) + ":" + ((v4[2]! << 8) | v4[3]!).toString(16);
  }
  const firstDouble = input.indexOf("::");
  if (firstDouble !== -1 && input.indexOf("::", firstDouble + 1) !== -1) return null;
  const headText = firstDouble === -1 ? input : input.slice(0, firstDouble);
  const tailText = firstDouble === -1 ? "" : input.slice(firstDouble + 2);
  const head = headText === "" ? [] : headText.split(":");
  const tail = tailText === "" ? [] : tailText.split(":");
  if (firstDouble === -1 && head.length !== 8) return null;
  if (firstDouble !== -1 && head.length + tail.length >= 8) return null;
  const groups: number[] = [];
  const parseGroups = (parts: string[]): boolean => {
    for (const part of parts) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return false;
      groups.push(parseInt(part, 16));
    }
    return true;
  };
  if (!parseGroups(head)) return null;
  const headCount = groups.length;
  if (!parseGroups(tail)) return null;
  const bytes = new Array<number>(16).fill(0);
  for (let i = 0; i < headCount; i++) {
    const g = groups[i]!;
    bytes[i * 2] = (g >> 8) & 0xff;
    bytes[i * 2 + 1] = g & 0xff;
  }
  if (firstDouble !== -1) {
    const offset = 8 - (groups.length - headCount);
    for (let i = headCount; i < groups.length; i++) {
      const g = groups[i]!;
      const pos = offset + (i - headCount);
      bytes[pos * 2] = (g >> 8) & 0xff;
      bytes[pos * 2 + 1] = g & 0xff;
    }
  }
  return bytes;
}

export function isUnsafeIpv6(bytes: readonly number[]): boolean {
  if (bytes.every((b) => b === 0)) return true;                         // unspecified
  if (bytes.slice(0, 15).every((b) => b === 0) && bytes[15] === 1) return true; // loopback ::1
  const mapped = bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0 && bytes[3] === 0 &&
    bytes[4] === 0 && bytes[5] === 0 && bytes[6] === 0 && bytes[7] === 0 &&
    bytes[8] === 0 && bytes[9] === 0 && bytes[10] === 0xff && bytes[11] === 0xff;
  if (mapped) {
    return isUnsafeIpv4(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`);
  }
  const first16 = (bytes[0]! << 8) | bytes[1]!;
  if ((first16 & 0xffc0) === 0xfe80) return true;                        // link-local fe80::/10
  if ((first16 & 0xfe00) === 0xfc00) return true;                        // unique local fc00::/7
  if (bytes[0] === 0xff) return true;                                    // multicast
  return false;
}

export function isBlockedIp(ip: string): boolean {
  const clean = stripBrackets(ip.trim());
  if (parseIpv4(clean) !== null) return isUnsafeIpv4(clean);
  const v6 = parseIpv6(clean);
  if (v6 !== null) return isUnsafeIpv6(v6);
  return false;
}
