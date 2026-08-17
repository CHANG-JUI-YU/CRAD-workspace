import { describe, expect, it, vi } from "vitest";
import { handleRestRequest, type WorkspaceRouteDeps } from "../src/routes.js";
import { DASHBOARD_PANELS_MEDIA_JS } from "../src/dashboard-panels-media.js";

type MockElement = {
  tagName: string;
  id: string;
  className: string;
  textContent: string;
  disabled: boolean;
  hidden: boolean;
  title: string;
  value: string;
  files?: any[];
  parentNode: MockElement | null;
  children: MockElement[];
  childNodes: MockElement[];
  attrs: Map<string, string>;
  listeners: Map<string, Array<(event?: any) => void>>;
  style: Record<string, string>;
  classList: {
    add: (c: string) => void;
    remove: (c: string) => void;
    contains: (c: string) => boolean;
  };
  setAttribute: (name: string, value: string) => void;
  getAttribute: (name: string) => string | null;
  removeAttribute: (name: string) => void;
  addEventListener: (type: string, handler: (event?: any) => void) => void;
  appendChild: (child: MockElement) => MockElement;
  removeChild: (child: MockElement) => MockElement;
  append: (...children: MockElement[]) => void;
  focus: () => void;
  click: () => void;
  querySelector: (selector: string) => MockElement | null;
  querySelectorAll: (selector: string) => MockElement[];
};

function createMockElement(tagName: string, id = ""): MockElement {
  const listeners = new Map<string, Array<(event?: any) => void>>();
  const attrs = new Map<string, string>();
  const classes = new Set<string>();
  const children: MockElement[] = [];

  const element: MockElement = {
    tagName: tagName.toUpperCase(),
    id,
    get className() {
      return Array.from(classes).join(" ");
    },
    set className(val: string) {
      classes.clear();
      for (const part of (val || "").split(/\s+/)) {
        if (part) classes.add(part);
      }
    },
    textContent: "",
    disabled: false,
    hidden: false,
    title: "",
    value: "",
    parentNode: null,
    children,
    childNodes: children,
    attrs,
    listeners,
    style: {},
    classList: {
      add: (name: string) => { classes.add(name); },
      remove: (name: string) => { classes.delete(name); },
      contains: (name: string) => classes.has(name),
    },
    setAttribute: (name: string, value: string) => { attrs.set(name, String(value)); },
    getAttribute: (name: string) => (attrs.has(name) ? attrs.get(name)! : null),
    removeAttribute: (name: string) => { attrs.delete(name); },
    addEventListener: (type: string, handler: (event?: any) => void) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type)!.push(handler);
    },
    appendChild: (child: MockElement) => {
      child.parentNode = element;
      children.push(child);
      return child;
    },
    removeChild: (child: MockElement) => {
      const idx = children.indexOf(child);
      if (idx >= 0) {
        children.splice(idx, 1);
        child.parentNode = null;
      }
      return child;
    },
    append: (...items: MockElement[]) => {
      for (const item of items) {
        element.appendChild(item);
      }
    },
    focus: vi.fn(),
    click: vi.fn(),
    querySelector: (selector: string): MockElement | null => {
      const list = element.querySelectorAll(selector);
      return list.length > 0 ? list[0] : null;
    },
    querySelectorAll: (selector: string): MockElement[] => {
      const matches: MockElement[] = [];
      function matchNode(node: MockElement) {
        if (selector.startsWith("#") && node.id === selector.slice(1)) {
          matches.push(node);
        } else if (selector.startsWith(".") && node.classList.contains(selector.slice(1))) {
          matches.push(node);
        } else if (selector.toUpperCase() === node.tagName) {
          matches.push(node);
        }
        for (const c of node.children) matchNode(c);
      }
      for (const c of element.children) matchNode(c);
      return matches;
    },
  };
  return element;
}

function extractFunctions(source: string, names: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const name of names) {
    const asyncMarker = `async function ${name}(`;
    const marker = `function ${name}(`;
    const asyncStart = source.indexOf(asyncMarker);
    const start = asyncStart >= 0 ? source.indexOf(marker, asyncStart) : source.indexOf(marker);
    if (start < 0) continue;
    const bodyStart = asyncStart >= 0 ? start - 6 : start;
    let depth = 0;
    let inBody = false;
    let end = -1;
    for (let i = start + marker.length; i < source.length; i++) {
      const ch = source[i];
      if (!inBody) {
        if (ch === "{") {
          inBody = true;
          depth = 1;
        }
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end > 0) out.set(name, source.slice(bodyStart, end));
  }
  return out;
}

function execute(functions: Map<string, string>, names: string[], context: Record<string, unknown>) {
  const keys = Object.keys(context);
  const args = keys.map((key) => context[key]);
  const body = names.map((name) => functions.get(name) ?? "").join("\n");
  const factory = new Function(...keys, `${body}\nreturn { ${names.join(", ")} };`);
  return factory(...args) as Record<string, any>;
}

function createMockReqRes(method: string, pathname: string, bodyJson?: any) {
  const chunks: Buffer[] = bodyJson !== undefined ? [Buffer.from(JSON.stringify(bodyJson))] : [];
  const req: any = {
    method,
    headers: { host: "localhost", "content-type": "application/json" },
    url: pathname,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
    on: (event: string, handler: any) => {
      if (event === "data" && bodyJson !== undefined) {
        handler(Buffer.from(JSON.stringify(bodyJson)));
      }
      if (event === "end") {
        handler();
      }
      return req;
    },
  };
  const headers: Record<string, string> = {};
  let bodyChunks: Buffer[] = [];
  const res: any = {
    statusCode: 200,
    setHeader: (name: string, value: string) => {
      headers[name.toLowerCase()] = String(value);
    },
    getHeader: (name: string) => headers[name.toLowerCase()],
    writeHead: (status: number, hdrs?: Record<string, string>) => {
      res.statusCode = status;
      if (hdrs) {
        for (const [k, v] of Object.entries(hdrs)) {
          headers[k.toLowerCase()] = String(v);
        }
      }
    },
    end: (chunk?: any) => {
      if (chunk) bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    },
    get json() {
      const buf = Buffer.concat(bodyChunks);
      return buf.length > 0 ? JSON.parse(buf.toString("utf-8")) : null;
    },
    get buffer() {
      return Buffer.concat(bodyChunks);
    },
    get status() {
      return res.statusCode;
    },
  };
  return { req, res, url: new URL(`http://localhost${pathname}`) };
}

describe("Audit 9 Batch 6 Suite", () => {
  describe("Issue #137: Validate attachment reuploads and avoid main-thread base64 conversion", () => {
    it("rejects reupload with missing or empty content", async () => {
      const mockRuntime = {
        reuploadOperationAttachments: vi.fn(),
      };
      const deps: WorkspaceRouteDeps = {
        actor: "tester",
        worker: { status: vi.fn() } as any,
        runtimeRevision: "rev-1",
        getRuntime: async () => mockRuntime as any,
        getAgentAdapter: vi.fn(),
      };

      // 缺少 content_base64 與 content
      const { req, res, url } = createMockReqRes("POST", "/workspace/operation/attachments/reupload", {
        operation_id: "op-123",
        replacements: [
          { name: "test.txt" },
        ],
      });

      await handleRestRequest(req, res, url, deps);
      expect(res.status).toBe(400);
      expect(mockRuntime.reuploadOperationAttachments).not.toHaveBeenCalled();
    });

    it("rejects reupload with malformed base64", async () => {
      const mockRuntime = {
        reuploadOperationAttachments: vi.fn(),
      };
      const deps: WorkspaceRouteDeps = {
        actor: "tester",
        worker: { status: vi.fn() } as any,
        runtimeRevision: "rev-1",
        getRuntime: async () => mockRuntime as any,
        getAgentAdapter: vi.fn(),
      };

      const { req, res, url } = createMockReqRes("POST", "/workspace/operation/attachments/reupload", {
        operation_id: "op-123",
        replacements: [
          { name: "test.txt", content_base64: "not_valid_base64!@#$" },
        ],
      });

      await handleRestRequest(req, res, url, deps);
      expect(res.status).toBe(400);
      expect(res.json.code).toBe("ATTACHMENT_INVALID_BASE64");
      expect(mockRuntime.reuploadOperationAttachments).not.toHaveBeenCalled();
    });

    it("rejects reupload with 0-byte decoded content", async () => {
      const mockRuntime = {
        reuploadOperationAttachments: vi.fn(),
      };
      const deps: WorkspaceRouteDeps = {
        actor: "tester",
        worker: { status: vi.fn() } as any,
        runtimeRevision: "rev-1",
        getRuntime: async () => mockRuntime as any,
        getAgentAdapter: vi.fn(),
      };

      // 空字串 base64 解碼後為 0 bytes
      const { req, res, url } = createMockReqRes("POST", "/workspace/operation/attachments/reupload", {
        operation_id: "op-123",
        replacements: [
          { name: "empty.txt", content_base64: "" },
        ],
      });

      await handleRestRequest(req, res, url, deps);
      expect(res.status).toBe(400);
      expect(mockRuntime.reuploadOperationAttachments).not.toHaveBeenCalled();
    });

    it("rejects reupload with path traversal filename", async () => {
      const mockRuntime = {
        reuploadOperationAttachments: vi.fn(),
      };
      const deps: WorkspaceRouteDeps = {
        actor: "tester",
        worker: { status: vi.fn() } as any,
        runtimeRevision: "rev-1",
        getRuntime: async () => mockRuntime as any,
        getAgentAdapter: vi.fn(),
      };

      const { req, res, url } = createMockReqRes("POST", "/workspace/operation/attachments/reupload", {
        operation_id: "op-123",
        replacements: [
          { name: "../../../etc/passwd", content_base64: Buffer.from("hello").toString("base64") },
        ],
      });

      await handleRestRequest(req, res, url, deps);
      expect(res.status).toBe(400);
      expect(mockRuntime.reuploadOperationAttachments).not.toHaveBeenCalled();
    });

    it("rejects reupload exceeding 20 files limit", async () => {
      const mockRuntime = {
        reuploadOperationAttachments: vi.fn(),
      };
      const deps: WorkspaceRouteDeps = {
        actor: "tester",
        worker: { status: vi.fn() } as any,
        runtimeRevision: "rev-1",
        getRuntime: async () => mockRuntime as any,
        getAgentAdapter: vi.fn(),
      };

      const replacements = [];
      for (let i = 0; i < 21; i++) {
        replacements.push({
          name: `file-${i}.txt`,
          content_base64: Buffer.from(`content-${i}`).toString("base64"),
        });
      }

      const { req, res, url } = createMockReqRes("POST", "/workspace/operation/attachments/reupload", {
        operation_id: "op-123",
        replacements,
      });

      await handleRestRequest(req, res, url, deps);
      expect(res.status).toBe(400);
      expect(mockRuntime.reuploadOperationAttachments).not.toHaveBeenCalled();
    });

    it("rejects reupload with file exceeding 5MB limit", async () => {
      const mockRuntime = {
        reuploadOperationAttachments: vi.fn(),
      };
      const deps: WorkspaceRouteDeps = {
        actor: "tester",
        worker: { status: vi.fn() } as any,
        runtimeRevision: "rev-1",
        getRuntime: async () => mockRuntime as any,
        getAgentAdapter: vi.fn(),
      };

      // 構建超過 5MB 的 payload (5 * 1024 * 1024 + 10 bytes, base64 ~6.98MB < 10MB body cap)
      const bigBuffer = Buffer.alloc(5 * 1024 * 1024 + 10);
      const b64 = bigBuffer.toString("base64");

      const { req, res, url } = createMockReqRes("POST", "/workspace/operation/attachments/reupload", {
        operation_id: "op-123",
        replacements: [
          { name: "bigfile.dat", content_base64: b64 },
        ],
      });

      await handleRestRequest(req, res, url, deps);
      expect(res.status).toBe(400);
      expect(res.json.code).toBe("ATTACHMENT_TOO_LARGE");
      expect(mockRuntime.reuploadOperationAttachments).not.toHaveBeenCalled();
    });

    it("accepts valid reupload and passes decoded Uint8Array to runtime", async () => {
      const mockRuntime = {
        reuploadOperationAttachments: vi.fn(async () => ({ ok: true, summary: "Reupload ok" })),
      };
      const deps: WorkspaceRouteDeps = {
        actor: "tester",
        worker: { status: vi.fn() } as any,
        runtimeRevision: "rev-1",
        getRuntime: async () => mockRuntime as any,
        getAgentAdapter: vi.fn(),
      };

      const raw = "Hello, world attachment content!";
      const b64 = Buffer.from(raw).toString("base64");

      const { req, res, url } = createMockReqRes("POST", "/workspace/operation/attachments/reupload", {
        operation_id: "op-123",
        replacements: [
          { name: "valid.txt", content_base64: b64, media_type: "text/plain" },
        ],
      });

      await handleRestRequest(req, res, url, deps);
      expect(res.status).toBe(200);
      expect(res.json.ok).toBe(true);
      expect(mockRuntime.reuploadOperationAttachments).toHaveBeenCalledWith(
        "op-123",
        [
          {
            name: "valid.txt",
            content: new Uint8Array(Buffer.from(raw)),
            media_type: "text/plain",
          },
        ],
        { actor: "tester", attachments: [] },
      );
    });
  });

  describe("Issue #148: Decode image path identifiers consistently before repository lookup", () => {
    it("decodes percent-encoded CJK image path identifier", async () => {
      const mockImage = {
        id: "雪乃-cover.png",
        content: new Uint8Array(Buffer.from("png-bytes")),
        media_type: "image/png",
      };
      const mockRuntime = {
        getProjectImage: vi.fn(async (id: string) => (id === "雪乃-cover.png" ? mockImage : undefined)),
      };
      const deps: WorkspaceRouteDeps = {
        actor: "tester",
        worker: { status: vi.fn() } as any,
        runtimeRevision: "rev-1",
        getRuntime: async () => mockRuntime as any,
        getAgentAdapter: vi.fn(),
      };

      const encoded = encodeURIComponent("雪乃-cover.png");
      const { req, res, url } = createMockReqRes("GET", `/workspace/images/${encoded}`);

      await handleRestRequest(req, res, url, deps);
      expect(res.status).toBe(200);
      expect(res.getHeader("content-type")).toBe("image/png");
      expect(mockRuntime.getProjectImage).toHaveBeenCalledWith("雪乃-cover.png");
    });

    it("decodes image path identifier containing spaces and percent signs", async () => {
      const mockImage = {
        id: "hero 100% full.png",
        content: new Uint8Array(Buffer.from("png-bytes-space")),
        media_type: "image/png",
      };
      const mockRuntime = {
        getProjectImage: vi.fn(async (id: string) => (id === "hero 100% full.png" ? mockImage : undefined)),
      };
      const deps: WorkspaceRouteDeps = {
        actor: "tester",
        worker: { status: vi.fn() } as any,
        runtimeRevision: "rev-1",
        getRuntime: async () => mockRuntime as any,
        getAgentAdapter: vi.fn(),
      };

      const encoded = encodeURIComponent("hero 100% full.png");
      const { req, res, url } = createMockReqRes("GET", `/workspace/images/${encoded}`);

      await handleRestRequest(req, res, url, deps);
      expect(res.status).toBe(200);
      expect(mockRuntime.getProjectImage).toHaveBeenCalledWith("hero 100% full.png");
    });

    it("returns structured 400 on malformed percent encoding", async () => {
      const mockRuntime = {
        getProjectImage: vi.fn(),
      };
      const deps: WorkspaceRouteDeps = {
        actor: "tester",
        worker: { status: vi.fn() } as any,
        runtimeRevision: "rev-1",
        getRuntime: async () => mockRuntime as any,
        getAgentAdapter: vi.fn(),
      };

      // 不完整的 percent sequence
      const { req, res, url } = createMockReqRes("GET", "/workspace/images/%E9%9B%AA%");

      await handleRestRequest(req, res, url, deps);
      expect(res.status).toBe(400);
      expect(res.json.code).toBe("IMAGE_ID_INVALID");
      expect(mockRuntime.getProjectImage).not.toHaveBeenCalled();
    });

    it("rejects path traversal in image identifier", async () => {
      const mockRuntime = {
        getProjectImage: vi.fn(),
      };
      const deps: WorkspaceRouteDeps = {
        actor: "tester",
        worker: { status: vi.fn() } as any,
        runtimeRevision: "rev-1",
        getRuntime: async () => mockRuntime as any,
        getAgentAdapter: vi.fn(),
      };

      // 編碼後的 ..%2F
      const { req, res, url } = createMockReqRes("GET", "/workspace/images/..%2Fsecret.png");

      await handleRestRequest(req, res, url, deps);
      expect(res.status).toBe(400);
      expect(res.json.code).toBe("IMAGE_ID_INVALID");
      expect(mockRuntime.getProjectImage).not.toHaveBeenCalled();
    });

    it("rejects path traversal in POST /workspace/images/remove and POST /workspace/cover/select", async () => {
      const mockRuntime = {
        removeProjectImage: vi.fn(),
        setProjectCover: vi.fn(),
      };
      const deps: WorkspaceRouteDeps = {
        actor: "tester",
        worker: { status: vi.fn() } as any,
        runtimeRevision: "rev-1",
        getRuntime: async () => mockRuntime as any,
        getAgentAdapter: vi.fn(),
      };

      // 1. remove
      const { req: r1, res: s1, url: u1 } = createMockReqRes("POST", "/workspace/images/remove", {
        image_id: "../etc/passwd",
      });
      await handleRestRequest(r1, s1, u1, deps);
      expect(s1.status).toBe(400);
      expect(s1.json.code).toBe("IMAGE_ID_INVALID");
      expect(mockRuntime.removeProjectImage).not.toHaveBeenCalled();

      // 2. cover select
      const { req: r2, res: s2, url: u2 } = createMockReqRes("POST", "/workspace/cover/select", {
        image_id: "..\\system32\\calc.exe",
      });
      await handleRestRequest(r2, s2, u2, deps);
      expect(s2.status).toBe(400);
      expect(s2.json.code).toBe("IMAGE_ID_INVALID");
      expect(mockRuntime.setProjectCover).not.toHaveBeenCalled();
    });

    it("returns 404 IMAGE_NOT_FOUND when image is missing", async () => {
      const mockRuntime = {
        getProjectImage: vi.fn(async () => undefined),
      };
      const deps: WorkspaceRouteDeps = {
        actor: "tester",
        worker: { status: vi.fn() } as any,
        runtimeRevision: "rev-1",
        getRuntime: async () => mockRuntime as any,
        getAgentAdapter: vi.fn(),
      };

      const { req, res, url } = createMockReqRes("GET", "/workspace/images/missing-img.png");

      await handleRestRequest(req, res, url, deps);
      expect(res.status).toBe(404);
      expect(res.json.code).toBe("IMAGE_NOT_FOUND");
    });
  });

  describe("Issue #136: Ignore stale crop previews and revoke every object URL", () => {
    it("ignores stale preview generation and revokes object URLs in reversed load order", () => {
      const revokedUrls: string[] = [];
      const createdUrls: string[] = [];

      let mockUrlCounter = 0;
      const mockURL = {
        createObjectURL: vi.fn((_blob: any) => {
          const u = `blob:http://localhost/mock-${++mockUrlCounter}`;
          createdUrls.push(u);
          return u;
        }),
        revokeObjectURL: vi.fn((url: string) => {
          revokedUrls.push(url);
        }),
      };

      const imageContainer = createMockElement("div", "image-crop-preview");
      const fileInput = createMockElement("input", "image-file");
      const ratioInput = createMockElement("select", "image-ratio");
      ratioInput.value = "1:1";

      const domMap = new Map<string, MockElement>([
        ["image-crop-preview", imageContainer],
        ["image-file", fileInput],
        ["image-ratio", ratioInput],
      ]);

      const mediaFns = extractFunctions(DASHBOARD_PANELS_MEDIA_JS, ["renderCropPreview", "cleanupCropPreview", "parseRatio"]);

      const instances: any[] = [];
      class MockImage {
        naturalWidth = 800;
        naturalHeight = 600;
        onload: any = null;
        onerror: any = null;
        src = "";
        constructor() {
          instances.push(this);
        }
      }

      const mockDoc = {
        createElement: (tag: string) => {
          const el = createMockElement(tag);
          if (tag === "canvas") {
            (el as any).getContext = () => ({
              drawImage: vi.fn(),
              strokeRect: vi.fn(),
              fillRect: vi.fn(),
            });
          }
          return el;
        },
      };

      const { renderCropPreview, cleanupCropPreview } = execute(mediaFns, ["renderCropPreview", "cleanupCropPreview", "parseRatio"], {
        byId: (id: string) => domMap.get(id) || null,
        URL: mockURL,
        Image: MockImage,
        document: mockDoc,
        cropPreviewGeneration: 0,
        currentCropObjectUrl: null,
      });

      // 1. 第一次選檔 (File 1)
      fileInput.files = [{ name: "img1.png", type: "image/png" }];
      renderCropPreview();
      expect(instances.length).toBe(1);
      const img1 = instances[0];
      const url1 = img1.src;

      // 2. 快速第二次選檔 (File 2)
      fileInput.files = [{ name: "img2.png", type: "image/png" }];
      renderCropPreview();
      expect(instances.length).toBe(2);
      const img2 = instances[1];
      const url2 = img2.src;

      // 在產生第二個預覽時，第一個 url1 應該已經被 revoke
      expect(revokedUrls).toContain(url1);

      // 3. 模擬非同步完成順序倒置：img2 先完成
      img2.onload();
      expect(revokedUrls).toContain(url2);
      expect(imageContainer.hidden).toBe(false);

      // 4. 舊的 img1 隨後完成，應該被 stale 檢查忽略，不會覆蓋 DOM
      const childCountAfterImg2 = imageContainer.children.length;
      img1.onload();
      // children 數量應保持不變，未被 img1 污染
      expect(imageContainer.children.length).toBe(childCountAfterImg2);

      // 5. 測試清理
      cleanupCropPreview();
      expect(imageContainer.hidden).toBe(true);
    });

    it("revokes object URL on image decode error", () => {
      const revokedUrls: string[] = [];
      const mockURL = {
        createObjectURL: vi.fn(() => "blob:http://localhost/error-img"),
        revokeObjectURL: vi.fn((url: string) => {
          revokedUrls.push(url);
        }),
      };

      const imageContainer = createMockElement("div", "image-crop-preview");
      const fileInput = createMockElement("input", "image-file");
      fileInput.files = [{ name: "corrupt.png", type: "image/png" }];
      const ratioInput = createMockElement("select", "image-ratio");

      const domMap = new Map<string, MockElement>([
        ["image-crop-preview", imageContainer],
        ["image-file", fileInput],
        ["image-ratio", ratioInput],
      ]);

      const mediaFns = extractFunctions(DASHBOARD_PANELS_MEDIA_JS, ["renderCropPreview", "cleanupCropPreview", "parseRatio"]);

      let errorImgInstance: any = null;
      class MockImage {
        onload: any = null;
        onerror: any = null;
        src = "";
        constructor() {
          errorImgInstance = this;
        }
      }

      const { renderCropPreview } = execute(mediaFns, ["renderCropPreview", "cleanupCropPreview", "parseRatio"], {
        byId: (id: string) => domMap.get(id) || null,
        URL: mockURL,
        Image: MockImage,
        document: { createElement: (t: string) => createMockElement(t) },
        cropPreviewGeneration: 0,
        currentCropObjectUrl: null,
      });

      renderCropPreview();
      expect(errorImgInstance).not.toBeNull();

      // 觸發 onerror
      errorImgInstance.onerror();

      expect(imageContainer.textContent).toBe("無法讀取圖片預覽。");
      expect(revokedUrls).toContain("blob:http://localhost/error-img");
    });
  });
});
