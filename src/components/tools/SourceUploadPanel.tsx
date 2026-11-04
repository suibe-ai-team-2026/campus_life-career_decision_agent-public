"use client";

import { useRef, useState } from "react";
import { Badge, Button, Callout, Collapse, Icon } from "@/components/ui/primitives";
import {
  cloudConfigured,
  completeSourceUpload,
  friendlyErrorMessage,
  putSourceFile,
  requestSourceUpload
} from "@/lib/api-client";
import { parsingRunStatusLabel } from "@/lib/source-labels";
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
 * 上传的资料会进入「你个人知识库」，作为问答与方案生成的检索来源，并排在方案证据前列。
 * 规则库的确定性数字（如学分认定规则）仍以已核验数据为准，不会被上传内容改写。
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
        <h2 id="source-upload-title">上传培养方案等文件</h2>
        <p className="micro">支持 PDF、DOCX、TXT、Markdown，单个不超过 20MB。</p>
        <Collapse summary="上传说明与格式">
          <p className="micro">
            上传的文件只保存在你自己的账号下，会成为<strong>个人知识库</strong>的一部分，问答与方案生成时作为检索来源被引用。
            课程清单与学分数这类确定性数字仍以规则库为准，不会被上传内容改写。
          </p>
          <ul className="callout-list">
            {UPLOAD_KIND_HINTS.map((hint) => (
              <li key={hint}>{hint}</li>
            ))}
          </ul>
        </Collapse>
      </div>

      {cloud ? (
        <div>
          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            accept={UPLOAD_ACCEPT_ATTR}
            disabled={busy}
            aria-label="选择要上传的资料文件"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
          <div className="row">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              <Icon name="plus" size={13} />
              选择文件
            </Button>
            <span className="micro">
              {busy && step ? `正在${UPLOAD_STEP_LABELS[step]}…` : "选择后自动上传"}
            </span>
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
          <p className="micro">上传需要配置 Supabase；当前为本地演示模式，只展示入口说明。</p>
        </Callout>
      )}

      {message ? (
        <Callout tone="danger" title="上传失败">
          <p>{message}</p>
        </Callout>
      ) : null}

      {result ? (
        <Callout tone="ok" title="已加入你的知识库">
          <p className="micro">
            来源已入库，解析任务已提交（{parsingRunStatusLabel(result.status)}）。
            解析完成后，问答与方案会将它作为检索来源引用。
          </p>
          <p>
            <Badge tone="muted">仅本人可见</Badge>
          </p>
        </Callout>
      ) : null}
    </section>
  );
}
