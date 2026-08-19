import { describe, expect, it } from "vitest";
import { attachmentContentDisposition, sanitizeAttachmentFilename } from "../src/publish-download-http.js";

describe("#209 publish download HTTP safety", () => {
  it("sanitizes control characters, quotes and path separators", () => {
    const name = sanitizeAttachmentFilename("../bad\\path\r\n\"角色卡.json");
    expect(name).not.toMatch(/[\r\n"\\/]/u);
    expect(name).toContain("角色卡.json");
  });

  it("preserves unicode through filename* while keeping an ASCII fallback", () => {
    const header = attachmentContentDisposition("雪乃 珠璣角色卡.json");
    expect(header).toMatch(/^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''/u);
    expect(header).toContain("%E9%9B%AA%E4%B9%83");
  });

  it("caps very long UTF-8 filenames", () => {
    const name = sanitizeAttachmentFilename(`${"角色".repeat(200)}.json`);
    expect(Buffer.byteLength(name, "utf8")).toBeLessThanOrEqual(180);
  });
});
