"use client";

import { useRef, useState } from "react";
import { Badge, Button, Callout, Icon } from "@/components/ui/primitives";
import {
  cloudConfigured,
  completeSourceUpload,
  friendlyErrorMessage,
  putSourceFile,
  requestSourceUpload
} from "@/lib/api-client";
import {
  UPLOAD_ACCEPT_ATTR,
  UPLOAD_KIND_HINTS,
  UPLOAD_STEP_LABELS,
  UploadError,
  sha256Hex,
  uploadSourceFile,
  type UploadResult,
  type UploadStep
} from "@/lib/source-upload";

/**
 * 用户上传培养方案等资料的可选入口。
 *
 * 上传只解决"检索与解释时没有你的资料"；它不会让规则引擎凭空产出课程与学分，
 * 因为规则库只认已核验数据。这一点必须写在界面上，避免把上传误解成"补齐即可出结果"。
 */
export function SourceUploadPanel({
  title,
  onUploaded
}: {
  title?: string;
  onUploaded?: (result: UploadResult) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<UploadStep | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const cloud = cloudConfigured();

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    setResult(null);
    try {
      const outcome = await uploadSourceFile(
        file,
        {
          sha256Hex,
          requestIntent: async (input) => {
            const intent = await requestSourceUpload(input);
            return { source_id: intent.sourceId, signed_url: intent.signedUrl, max_bytes: intent.maxBytes };
          },
          putFile: putSourceFile,
          complete: async (input) => {
            const ack = await completeSourceUpload(input);
            return { run_id: ack.runId, status: ack.status, source_version_id: ack.sourceVersionId };
          },
          uuid: () => crypto.randomUUID()
        },
        { title, onStep: setStep }
      );
      setResult(outcome);
      onUploaded?.(outcome);
    } catch (error) {
      setMessage(error instanceof UploadError ? error.message : friendlyErrorMessage(error));
      setStep(null);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <section className="section-heading" aria-labelledby="source-upload-title">
      <div className="section-heading-text">
        <p className="eyebrow">可选 · 补充自己的资料</p>
        <h2 id="source-upload-title">上传培养方案等文件</h2>
        <p className="section-description">
          上传的文件只保存在你自己的账号下，会成为<strong>你个人知识库</strong>的一部分，
          问答与方案生成时作为检索来源被引用。课程清单与学分数这类需要确定性口径的数字
          仍以规则库为准，不会被上传凭空改写。支持 PDF、DOCX、TXT、Markdown，单个不超过 20MB。
        </p>
        <ul className="callout-list">
          {UPLOAD_KIND_HINTS.map((hint) => (
            <li key={hint}>{hint}</li>
          ))}
        </ul>
      </div>

      {cloud ? (
        <div>
          <input
            ref={inputRef}
            type="file"
            accept={UPLOAD_ACCEPT_ATTR}
            disabled={busy}
            aria-label="选择要上传的资料文件"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
          <div className="panel-note">
            {busy && step ? `正在${UPLOAD_STEP_LABELS[step]}…` : "选择文件后会依次计算指纹、直传并提交入库。"}
          </div>
          {busy ? (
            <Button variant="secondary" size="sm" disabled>
              <Icon name="plus" size={13} />
              上传中…
            </Button>
          ) : null}
        </div>
      ) : (
        <Callout tone="warn" title="本地演示模式不能上传">
          <p>上传需要配置 Supabase。当前未配置云端，所以这里只展示入口说明，不会伪造上传结果。</p>
        </Callout>
      )}

      {message ? (
        <Callout tone="danger" title="上传失败">
          <p>{message}</p>
        </Callout>
      ) : null}

      {result ? (
        <Callout tone="ok" title="已提交，等待解析">
          <p>
            来源 <code>{result.sourceId}</code> 已登记，解析任务 <code>{result.runId}</code>（状态：
            {result.status}）。解析完成后，问答与方案解释可以引用它；课程与学分仍需核验数据才会出现。
          </p>
          <p>
            <Badge tone="muted">仅本人可见</Badge>
          </p>
        </Callout>
      ) : null}
    </section>
  );
}
