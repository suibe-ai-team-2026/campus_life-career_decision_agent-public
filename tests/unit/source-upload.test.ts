import { describe, expect, it, vi } from "vitest";
import {
  MAX_UPLOAD_BYTES,
  UploadError,
  sha256Hex,
  uploadSourceFile,
  validateUploadFile,
  type UploadDeps
} from "@/lib/source-upload";

const HEX64 = "a".repeat(64);

function makeFile(name: string, type: string, content = "hello"): File {
  return new File([content], name, { type });
}

function makeDeps(overrides: Partial<UploadDeps> = {}): UploadDeps {
  return {
    sha256Hex: vi.fn(async () => HEX64),
    requestIntent: vi.fn(async () => ({
      source_id: "user_1234abcd",
      signed_url: "https://example.test/upload",
      max_bytes: MAX_UPLOAD_BYTES
    })),
    putFile: vi.fn(async () => undefined),
    complete: vi.fn(async () => ({
      run_id: "run-1",
      status: "queued",
      source_version_id: "11111111-1111-4111-8111-111111111111"
    })),
    uuid: () => "22222222-2222-4222-8222-222222222222",
    ...overrides
  };
}

describe("validateUploadFile", () => {
  it("接受带正确 mime 的 PDF", () => {
    expect(validateUploadFile({ name: "培养方案.pdf", size: 1024, type: "application/pdf" })).toEqual({
      ok: true,
      mimeType: "application/pdf"
    });
  });

  it("mime 为空时按扩展名兜底（浏览器对 .md 常见空 mime）", () => {
    expect(validateUploadFile({ name: "学分认定.md", size: 10, type: "" })).toEqual({
      ok: true,
      mimeType: "text/markdown"
    });
  });

  it("拒绝空文件、超大文件与不支持的格式", () => {
    const empty = validateUploadFile({ name: "a.pdf", size: 0, type: "application/pdf" });
    expect(empty.ok).toBe(false);

    const huge = validateUploadFile({ name: "a.pdf", size: MAX_UPLOAD_BYTES + 1, type: "application/pdf" });
    expect(huge).toMatchObject({ ok: false });

    const zip = validateUploadFile({ name: "a.zip", size: 10, type: "application/zip" });
    expect(zip.ok).toBe(false);
    if (!zip.ok) expect(zip.reason).toContain("PDF、DOCX、TXT、Markdown");
  });

  it("拒绝没有文件名的输入", () => {
    const result = validateUploadFile({ name: "   ", size: 10, type: "application/pdf" });
    expect(result.ok).toBe(false);
  });
});

describe("uploadSourceFile", () => {
  it("按 校验 → 指纹 → 申请地址 → 直传 → 提交入库 的顺序执行", async () => {
    const deps = makeDeps();
    const steps: string[] = [];
    const file = makeFile("培养方案.pdf", "application/pdf");

    const result = await uploadSourceFile(file, deps, { onStep: (step) => steps.push(step) });

    expect(steps).toEqual(["validating", "hashing", "requesting", "uploading", "completing", "done"]);
    expect(deps.requestIntent).toHaveBeenCalledWith({
      filename: "培养方案.pdf",
      mime_type: "application/pdf",
      bytes: file.size,
      title: "培养方案.pdf"
    });
    expect(deps.putFile).toHaveBeenCalledWith("https://example.test/upload", file);
    expect(deps.complete).toHaveBeenCalledWith({
      source_id: "user_1234abcd",
      declared_sha256: HEX64,
      title: "培养方案.pdf",
      idempotency_key: "22222222-2222-4222-8222-222222222222"
    });
    expect(result).toEqual({
      sourceId: "user_1234abcd",
      sourceVersionId: "11111111-1111-4111-8111-111111111111",
      runId: "run-1",
      status: "queued"
    });
  });

  it("自定义标题优先于文件名", async () => {
    const deps = makeDeps();
    await uploadSourceFile(makeFile("a.pdf", "application/pdf"), deps, { title: "  2024 级国贸培养方案  " });
    expect(deps.requestIntent).toHaveBeenCalledWith(expect.objectContaining({ title: "2024 级国贸培养方案" }));
  });

  it("文件不合法时不发任何请求", async () => {
    const deps = makeDeps();
    await expect(uploadSourceFile(makeFile("a.zip", "application/zip"), deps)).rejects.toBeInstanceOf(UploadError);
    expect(deps.requestIntent).not.toHaveBeenCalled();
    expect(deps.putFile).not.toHaveBeenCalled();
    expect(deps.complete).not.toHaveBeenCalled();
  });

  it("直传失败时不再提交入库", async () => {
    const deps = makeDeps({
      putFile: vi.fn(async () => {
        throw new Error("network");
      })
    });
    await expect(uploadSourceFile(makeFile("a.pdf", "application/pdf"), deps)).rejects.toThrow("network");
    expect(deps.complete).not.toHaveBeenCalled();
  });

  it("服务端声明的上限更小时拒绝", async () => {
    const deps = makeDeps({
      requestIntent: vi.fn(async () => ({
        source_id: "user_1234abcd",
        signed_url: "https://example.test/upload",
        max_bytes: 1
      }))
    });
    await expect(uploadSourceFile(makeFile("a.pdf", "application/pdf"), deps)).rejects.toBeInstanceOf(UploadError);
    expect(deps.putFile).not.toHaveBeenCalled();
  });

  it("指纹不是 64 位十六进制时拒绝", async () => {
    const deps = makeDeps({ sha256Hex: vi.fn(async () => "not-a-hash") });
    await expect(uploadSourceFile(makeFile("a.pdf", "application/pdf"), deps)).rejects.toBeInstanceOf(UploadError);
    expect(deps.requestIntent).not.toHaveBeenCalled();
  });
});

describe("sha256Hex", () => {
  it("与已知向量一致", async () => {
    const data = new TextEncoder().encode("abc");
    await expect(sha256Hex(data.buffer as ArrayBuffer)).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });
});
