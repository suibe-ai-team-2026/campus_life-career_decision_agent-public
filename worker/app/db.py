"""Supabase 数据访问层：PostgREST + Storage，直接使用 service/secret key。

worker 是纯后端进程：
- 不向浏览器暴露任何端口；
- 所有 worker RPC 都带 ``(worker_id, lease_epoch)``，由 SQL 侧 fencing；
- service role 会绕过 RLS，所以本模块**自己**强制按 run owner 过滤，并在返回前
  再校验一次 ``owner_id``，避免误读其他用户的数据。

错误只抛出脱敏后的短码/短消息，绝不把 URL、key、请求体写进日志或 run.error_code。
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Iterable, Sequence
from urllib.parse import quote

import httpx

from .config import Config
from .errors import (
    BadRequest,
    ConfigError,
    DatabaseError,
    ResourceNotFound,
    StaleLeaseError,
    redact,
)
from .models import ClaimedJob, EmbeddingProfile, UsageTotals
from .logging_setup import get_logger, log_event

logger = get_logger("worker.db")

# PostgREST 单次返回行数：Supabase 默认 max-rows 1000；分页由调用方显式处理。
DEFAULT_PAGE_SIZE = 500


class SupabaseDb:
    def __init__(self, config: Config, *, http_client: httpx.Client | None = None) -> None:
        self.config = config
        self.base_url = config.supabase_url.rstrip("/")
        self._secret = config.supabase_secret_key
        self._secrets = config.secret_values()
        self._client = http_client or httpx.Client(
            timeout=httpx.Timeout(60.0, connect=10.0),
            limits=httpx.Limits(max_connections=8, max_keepalive_connections=4),
        )
        self._owns_client = http_client is None

    # ------------------------------------------------------------------
    # 基础 HTTP
    # ------------------------------------------------------------------
    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def _headers(self, *, prefer: str | None = None, content_type: str | None = "application/json") -> dict[str, str]:
        headers = {
            "apikey": self._secret,
            "Authorization": f"Bearer {self._secret}",
            "Accept": "application/json",
        }
        if content_type:
            headers["Content-Type"] = content_type
        if prefer:
            headers["Prefer"] = prefer
        return headers

    def _url(self, path: str) -> str:
        return f"{self.base_url}{path}"

    def _parse_error(self, response: httpx.Response) -> DatabaseError:
        message = ""
        code = ""
        try:
            payload = response.json()
            if isinstance(payload, dict):
                message = str(payload.get("message") or "")
                code = str(payload.get("code") or "")
        except (json.JSONDecodeError, ValueError):
            message = response.text[:200]
        safe = redact(message, self._secrets, limit=200)
        if message == "stale_lease":
            return StaleLeaseError("租约已失效，禁止写入")
        if message == "resource_not_found":
            return ResourceNotFound("目标资源不存在或不属于该 run 的 owner")
        if message == "version_conflict":
            return DatabaseError("版本冲突")
        if message == "idempotency_conflict":
            return DatabaseError("幂等冲突")
        if message == "bad_request":
            return BadRequest("数据库拒绝了请求参数")
        if code == "PGRST116":
            return ResourceNotFound("没有找到记录")
        return DatabaseError(
            f"数据库请求失败（HTTP {response.status_code}）：{safe}",
            detail=f"pg_code={code}",
        )

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: Sequence[tuple[str, str]] | None = None,
        json_body: Any = None,
        prefer: str | None = None,
        single: bool = False,
        content: bytes | None = None,
        content_type: str | None = "application/json",
        timeout: float | None = None,
        expect_json: bool = True,
    ) -> Any:
        headers = self._headers(prefer=prefer, content_type=content_type)
        if single:
            headers["Accept"] = "application/vnd.pgrst.object+json"
        try:
            response = self._client.request(
                method,
                self._url(path),
                params=list(params or []),
                json=json_body,
                content=content,
                headers=headers,
                timeout=timeout,
            )
        except httpx.TimeoutException as exc:
            raise DatabaseError("数据库请求超时") from exc
        except httpx.HTTPError as exc:
            raise DatabaseError("数据库网络错误") from exc
        if response.status_code >= 400:
            raise self._parse_error(response)
        if not expect_json or response.status_code == 204 or not response.content:
            return None
        try:
            return response.json()
        except ValueError as exc:
            raise DatabaseError("数据库返回了非 JSON 响应") from exc

    # ------------------------------------------------------------------
    # REST 基础操作
    # ------------------------------------------------------------------
    def select(
        self,
        table: str,
        *,
        filters: Sequence[tuple[str, str]] | None = None,
        columns: str = "*",
        order: str | None = None,
        limit: int | None = None,
        offset: int | None = None,
    ) -> list[dict[str, Any]]:
        params: list[tuple[str, str]] = [("select", columns)]
        params.extend(filters or [])
        if order:
            params.append(("order", order))
        if limit is not None:
            params.append(("limit", str(max(1, int(limit)))))
        if offset is not None:
            params.append(("offset", str(max(0, int(offset)))))
        result = self._request("GET", f"/rest/v1/{table}", params=params)
        if result is None:
            return []
        if not isinstance(result, list):
            raise DatabaseError("数据库返回结构异常")
        return result

    def select_maybe_one(
        self,
        table: str,
        *,
        filters: Sequence[tuple[str, str]],
        columns: str = "*",
        order: str | None = None,
    ) -> dict[str, Any] | None:
        params: list[tuple[str, str]] = [("select", columns)]
        params.extend(filters)
        if order:
            params.append(("order", order))
        params.append(("limit", "1"))
        rows = self._request("GET", f"/rest/v1/{table}", params=params)
        if not rows:
            return None
        if not isinstance(rows, list):
            raise DatabaseError("数据库返回结构异常")
        return rows[0]

    def insert(self, table: str, rows: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
        if not rows:
            return []
        payload = self._request(
            "POST",
            f"/rest/v1/{table}",
            json_body=list(rows),
            prefer="return=representation",
        )
        if payload is None:
            return []
        if isinstance(payload, dict):
            return [payload]
        if not isinstance(payload, list):
            raise DatabaseError("数据库插入返回结构异常")
        return payload

    def insert_no_return(self, table: str, rows: Sequence[dict[str, Any]]) -> None:
        if not rows:
            return
        self._request(
            "POST",
            f"/rest/v1/{table}",
            json_body=list(rows),
            prefer="return=minimal",
            expect_json=False,
        )

    def update(
        self,
        table: str,
        values: dict[str, Any],
        *,
        filters: Sequence[tuple[str, str]],
    ) -> list[dict[str, Any]]:
        if not filters:
            raise DatabaseError("update 必须带过滤条件，拒绝全表更新")
        payload = self._request(
            "PATCH",
            f"/rest/v1/{table}",
            params=list(filters),
            json_body=values,
            prefer="return=representation",
        )
        if payload is None:
            return []
        if isinstance(payload, dict):
            return [payload]
        return payload  # type: ignore[return-value]

    def delete(self, table: str, *, filters: Sequence[tuple[str, str]]) -> int:
        if not filters:
            raise DatabaseError("delete 必须带过滤条件，拒绝全表删除")
        response = self._client.request(
            "DELETE",
            self._url(f"/rest/v1/{table}"),
            params=list(filters),
            headers=self._headers(prefer="return=minimal"),
        )
        if response.status_code >= 400:
            raise self._parse_error(response)
        return 0

    # ------------------------------------------------------------------
    # RPC
    # ------------------------------------------------------------------
    def rpc(self, name: str, payload: dict[str, Any]) -> Any:
        return self._request("POST", f"/rest/v1/rpc/{name}", json_body=payload)

    # ------------------------------------------------------------------
    # Storage
    # ------------------------------------------------------------------
    def storage_download(self, bucket: str, path: str) -> bytes:
        if not path or path.startswith("/") or ".." in path.split("/"):
            raise BadRequest("非法的 storage path")
        url_path = quote(path, safe="/")
        try:
            response = self._client.get(
                self._url(f"/storage/v1/object/{bucket}/{url_path}"),
                headers=self._headers(content_type=None),
                timeout=httpx.Timeout(120.0, connect=15.0),
            )
        except httpx.HTTPError as exc:
            raise DatabaseError("下载源文件失败") from exc
        if response.status_code == 404:
            raise ResourceNotFound("源文件不存在")
        if response.status_code >= 400:
            raise DatabaseError(f"下载源文件失败（HTTP {response.status_code}）")
        return response.content

    def storage_upload(self, bucket: str, path: str, data: bytes, *, content_type: str) -> None:
        if not path or path.startswith("/") or ".." in path.split("/"):
            raise BadRequest("非法的 storage path")
        url_path = quote(path, safe="/")
        headers = self._headers(prefer=None, content_type=content_type)
        headers["x-upsert"] = "true"
        try:
            response = self._client.post(
                self._url(f"/storage/v1/object/{bucket}/{url_path}"),
                content=data,
                headers=headers,
                timeout=httpx.Timeout(120.0, connect=15.0),
            )
        except httpx.HTTPError as exc:
            raise DatabaseError("上传产物失败") from exc
        if response.status_code >= 400:
            raise DatabaseError(f"上传产物失败（HTTP {response.status_code}）")

    def storage_exists(self, bucket: str, path: str) -> bool:
        url_path = quote(path, safe="/")
        try:
            response = self._client.head(
                self._url(f"/storage/v1/object/{bucket}/{url_path}"),
                headers=self._headers(content_type=None),
            )
        except httpx.HTTPError:
            return False
        return response.status_code < 400

    # ------------------------------------------------------------------
    # Worker 队列 RPC（签名以 20261019000300_career_cloud_functions.sql 为准）
    # ------------------------------------------------------------------
    def claim_job(self, worker_id: str, lease_seconds: int) -> ClaimedJob | None:
        rows = self.rpc(
            "worker_claim_job",
            {"p_worker_id": worker_id, "p_lease_seconds": int(lease_seconds)},
        )
        if not rows:
            return None
        if not isinstance(rows, list):
            raise DatabaseError("worker_claim_job 返回结构异常")
        return ClaimedJob.from_rpc_row(rows[0])

    def heartbeat(self, job_id: str, worker_id: str, lease_epoch: int, lease_seconds: int) -> bool:
        result = self.rpc(
            "worker_heartbeat",
            {
                "p_job_id": job_id,
                "p_worker_id": worker_id,
                "p_lease_epoch": int(lease_epoch),
                "p_lease_seconds": int(lease_seconds),
            },
        )
        return bool(result)

    def set_progress(
        self,
        job_id: str,
        worker_id: str,
        lease_epoch: int,
        status: str,
        progress: int,
    ) -> bool:
        result = self.rpc(
            "worker_set_progress",
            {
                "p_job_id": job_id,
                "p_worker_id": worker_id,
                "p_lease_epoch": int(lease_epoch),
                "p_status": status,
                "p_progress": int(progress),
            },
        )
        return bool(result)

    def complete_job(
        self,
        job_id: str,
        worker_id: str,
        lease_epoch: int,
        result: dict[str, Any],
    ) -> str | None:
        run_id = self.rpc(
            "worker_complete_job",
            {
                "p_job_id": job_id,
                "p_worker_id": worker_id,
                "p_lease_epoch": int(lease_epoch),
                "p_result": result,
            },
        )
        if run_id is None:
            raise StaleLeaseError("worker_complete_job 返回空：租约已失效")
        return str(run_id)

    def fail_job(
        self,
        job_id: str,
        worker_id: str,
        lease_epoch: int,
        error_code: str,
        retryable: bool,
    ) -> str:
        outcome = self.rpc(
            "worker_fail_job",
            {
                "p_job_id": job_id,
                "p_worker_id": worker_id,
                "p_lease_epoch": int(lease_epoch),
                "p_error_code": redact(error_code, limit=80),
                "p_retryable": bool(retryable),
            },
        )
        return str(outcome or "failed")

    def save_plan(
        self,
        *,
        job_id: str,
        worker_id: str,
        lease_epoch: int,
        plan_id: str | None,
        profile_id: str,
        direction_id: str,
        rules_version: str,
        corpus_version: str | None,
        embedding_profile_id: str | None,
        actions: list[dict[str, Any]],
        result: dict[str, Any],
        warnings: list[str],
    ) -> tuple[str, str, int]:
        payload = {
            "p_job_id": job_id,
            "p_worker_id": worker_id,
            "p_lease_epoch": int(lease_epoch),
            "p_plan_id": plan_id,
            "p_profile_id": profile_id,
            "p_direction_id": direction_id,
            "p_rules_version": rules_version,
            "p_corpus_version": corpus_version,
            "p_embedding_profile_id": embedding_profile_id,
            "p_actions": actions,
            "p_result": result,
            "p_warnings": warnings,
        }
        rows = self.rpc("worker_save_plan", payload)
        if not rows:
            raise StaleLeaseError("worker_save_plan 返回空：租约已失效")
        row = rows[0] if isinstance(rows, list) else rows
        try:
            return str(row["plan_id"]), str(row["version_id"]), int(row["version"])
        except (KeyError, TypeError, ValueError) as exc:
            raise DatabaseError("worker_save_plan 返回结构异常") from exc

    def register_artifact(
        self,
        *,
        job_id: str,
        worker_id: str,
        lease_epoch: int,
        artifact_id: str,
        kind: str,
        storage_path: str,
        sha256: str,
        byte_size: int,
        plan_version_id: str | None,
    ) -> str:
        payload = {
            "p_job_id": job_id,
            "p_worker_id": worker_id,
            "p_lease_epoch": int(lease_epoch),
            "p_artifact_id": artifact_id,
            "p_kind": kind,
            "p_storage_path": storage_path,
            "p_sha256": sha256,
            "p_bytes": int(byte_size),
            "p_plan_version_id": plan_version_id,
        }
        result = self.rpc("worker_register_artifact", payload)
        if result is None:
            raise StaleLeaseError("worker_register_artifact 返回空：租约已失效")
        return str(result)

    def search_chunks(
        self,
        *,
        owner_id: str,
        profile_id: str,
        query_embedding_text: str,
        query_text: str,
        limit: int,
    ) -> list[dict[str, Any]]:
        # 授权过滤（approved_reference 或 owner 本人）在 SQL 内完成。
        rows = self.rpc(
            "worker_search_chunks",
            {
                "p_owner": owner_id,
                "p_profile_id": profile_id,
                "p_query_embedding": query_embedding_text,
                "p_query_text": redact(query_text, self._secrets, limit=1000),
                "p_limit": int(limit),
            },
        )
        if rows is None:
            return []
        if not isinstance(rows, list):
            raise DatabaseError("worker_search_chunks 返回结构异常")
        return rows

    def chunk_neighbors(self, *, chunk_ids: Iterable[str], owner_id: str) -> list[dict[str, Any]]:
        ids = [str(chunk_id) for chunk_id in chunk_ids]
        if not ids:
            return []
        rows = self.rpc("worker_chunk_neighbors", {"p_chunk_ids": ids, "p_owner": owner_id})
        if rows is None:
            return []
        if not isinstance(rows, list):
            raise DatabaseError("worker_chunk_neighbors 返回结构异常")
        return rows

    # ------------------------------------------------------------------
    # owner 校验工具：service role 绕过 RLS，必须自己检查
    # ------------------------------------------------------------------
    @staticmethod
    def _same_owner(row: dict[str, Any], owner_id: str) -> bool:
        return str(row.get("owner_id") or "").lower() == str(owner_id).lower()

    def _require_owner(self, row: dict[str, Any], owner_id: str, what: str) -> dict[str, Any]:
        if not self._same_owner(row, owner_id):
            raise ResourceNotFound(f"{what} 不属于当前 run 的 owner")
        return row

    # ------------------------------------------------------------------
    # 产品数据读取（均按 owner 过滤）
    # ------------------------------------------------------------------
    def get_profile(self, owner_id: str, profile_id: str) -> dict[str, Any]:
        row = self.select_maybe_one(
            "app_profiles",
            filters=[("profile_id", f"eq.{profile_id}"), ("owner_id", f"eq.{owner_id}")],
        )
        if not row:
            raise ResourceNotFound("画像不存在")
        return self._require_owner(row, owner_id, "画像")

    def get_plan(self, owner_id: str, plan_id: str) -> dict[str, Any]:
        row = self.select_maybe_one(
            "app_plans",
            filters=[("plan_id", f"eq.{plan_id}"), ("owner_id", f"eq.{owner_id}")],
        )
        if not row:
            raise ResourceNotFound("方案不存在")
        return self._require_owner(row, owner_id, "方案")

    def get_plan_version(self, owner_id: str, version_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
        version = self.select_maybe_one(
            "app_plan_versions",
            filters=[("version_id", f"eq.{version_id}")],
        )
        if not version:
            raise ResourceNotFound("方案版本不存在")
        plan = self.get_plan(owner_id, str(version["plan_id"]))
        return plan, version

    def get_artifact(self, owner_id: str, artifact_id: str) -> dict[str, Any]:
        row = self.select_maybe_one(
            "app_artifacts",
            filters=[("artifact_id", f"eq.{artifact_id}"), ("owner_id", f"eq.{owner_id}")],
        )
        if not row:
            raise ResourceNotFound("产物不存在")
        return self._require_owner(row, owner_id, "产物")

    def get_run_cancel_requested(self, run_id: str) -> bool:
        row = self.select_maybe_one(
            "app_runs",
            filters=[("run_id", f"eq.{run_id}")],
            columns="run_id,status,cancel_requested",
        )
        if not row:
            raise ResourceNotFound("run 不存在")
        return bool(row.get("cancel_requested"))

    def get_direction(self, direction_id: str) -> dict[str, Any] | None:
        return self.select_maybe_one(
            "app_directions",
            filters=[("direction_id", f"eq.{direction_id}")],
        )

    def list_directions(self, direction_ids: Sequence[str] | None = None) -> list[dict[str, Any]]:
        filters: list[tuple[str, str]] = []
        if direction_ids:
            quoted = ",".join(str(item) for item in direction_ids)
            filters.append(("direction_id", f"in.({quoted})"))
        return self.select("app_directions", filters=filters, order="sort_order.asc,direction_id.asc")

    def get_assessment(self, version: str) -> dict[str, Any] | None:
        return self.select_maybe_one("app_assessments", filters=[("version", f"eq.{version}")])

    # ------------------------------------------------------------------
    # 来源 / 版本 / chunks
    # ------------------------------------------------------------------
    def get_source_version(self, source_version_id: str) -> dict[str, Any]:
        row = self.select_maybe_one(
            "app_source_versions",
            filters=[("source_version_id", f"eq.{source_version_id}")],
        )
        if not row:
            raise ResourceNotFound("来源版本不存在")
        return row

    def get_source(self, source_id: str) -> dict[str, Any] | None:
        return self.select_maybe_one("app_sources", filters=[("source_id", f"eq.{source_id}")])

    def list_evidence_records(
        self,
        *,
        source_version_ids: Sequence[str],
        included_only: bool = True,
    ) -> list[dict[str, Any]]:
        """读取来源版本下的证据记录（数据导入/导出与审计使用；不用于替代检索）。"""

        rows: list[dict[str, Any]] = []
        ids = list(dict.fromkeys(str(item) for item in source_version_ids))
        for start in range(0, len(ids), 50):
            batch = ids[start : start + 50]
            if not batch:
                continue
            filters: list[tuple[str, str]] = [
                ("source_version_id", f"in.({','.join(batch)})"),
            ]
            if included_only:
                filters.append(("included", "eq.true"))
            rows.extend(
                self.select(
                    "app_evidence_records",
                    filters=filters,
                    order="record_id.asc",
                )
            )
        return rows

    def insert_evidence_records(self, rows: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
        if not rows:
            return []
        return self.insert("app_evidence_records", rows)

    def update_source_version(self, source_version_id: str, values: dict[str, Any]) -> None:
        self.update(
            "app_source_versions",
            values,
            filters=[("source_version_id", f"eq.{source_version_id}")],
        )

    def delete_chunks_for_version(self, source_version_id: str, splitter_version: str) -> None:
        # app_chunk_embeddings.chunk_id 是 on delete cascade，删 chunks 即可。
        self.delete(
            "app_chunks",
            filters=[
                ("source_version_id", f"eq.{source_version_id}"),
                ("splitter_version", f"eq.{splitter_version}"),
            ],
        )

    def insert_chunks(self, rows: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
        return self.insert("app_chunks", rows)

    def insert_chunk_embeddings(self, rows: Sequence[dict[str, Any]]) -> None:
        self.insert_no_return("app_chunk_embeddings", rows)

    # ------------------------------------------------------------------
    # embedding profile
    # ------------------------------------------------------------------
    @staticmethod
    def _profile_from_row(row: dict[str, Any]) -> EmbeddingProfile:
        return EmbeddingProfile(
            profile_id=str(row["profile_id"]),
            provider=str(row["provider"]),
            model=str(row["model"]),
            dimensions=int(row["dimensions"]),
            normalization=str(row["normalization"]),
            query_template_version=str(row["query_template_version"]),
            splitter_version=str(row["splitter_version"]),
            status=str(row["status"]),
            metadata=dict(row.get("metadata") or {}),
        )

    def get_embedding_profile(self, profile_id: str) -> EmbeddingProfile | None:
        row = self.select_maybe_one(
            "app_embedding_profiles",
            filters=[("profile_id", f"eq.{profile_id}")],
        )
        return None if row is None else self._profile_from_row(row)

    def get_active_embedding_profile(self) -> EmbeddingProfile | None:
        row = self.select_maybe_one(
            "app_embedding_profiles",
            filters=[("status", "eq.active")],
            order="created_at.asc",
        )
        return None if row is None else self._profile_from_row(row)

    def ensure_embedding_profile(self, profile: EmbeddingProfile) -> EmbeddingProfile:
        """确保数据库里存在这一个 profile；不同模型/维度/模板必须显式报错，绝不混用。"""

        existing = self.get_embedding_profile(profile.profile_id)
        if existing is not None:
            self._assert_profile_compatible(existing, profile)
            return existing

        active = self.get_active_embedding_profile()
        if active is not None:
            self._assert_profile_compatible(active, profile)
            raise ConfigError(
                "数据库已有 active embedding profile 且与当前 worker 配置不一致；"
                "切换模型必须新建 profile、全量重建并显式切换，不能由 worker 自动混用"
            )

        row = {
            "profile_id": profile.profile_id,
            "provider": profile.provider,
            "model": profile.model,
            "dimensions": profile.dimensions,
            "normalization": profile.normalization,
            "query_template_version": profile.query_template_version,
            "splitter_version": profile.splitter_version,
            "status": "active",
            "metadata": {
                **profile.metadata,
                "created_by": "worker",
                "embedding_instruction_mode": profile.metadata.get("embedding_instruction_mode"),
            },
        }
        self.insert_no_return("app_embedding_profiles", [row])
        created = self.get_embedding_profile(profile.profile_id)
        if created is None:
            raise DatabaseError("embedding profile 创建失败")
        return created

    @staticmethod
    def _assert_profile_compatible(existing: EmbeddingProfile, wanted: EmbeddingProfile) -> None:
        fields = ("provider", "model", "dimensions", "normalization", "query_template_version", "splitter_version")
        mismatched = [
            f"{name}={getattr(existing, name)}!={getattr(wanted, name)}"
            for name in fields
            if getattr(existing, name) != getattr(wanted, name)
        ]
        if mismatched:
            raise ConfigError("embedding profile 与 worker 配置不一致：" + "; ".join(mismatched))

    # ------------------------------------------------------------------
    # 规则数据（只读 verified 行）
    # ------------------------------------------------------------------
    def list_verified_courses(
        self,
        *,
        school: str,
        major: str,
        enrollment_year: int,
    ) -> list[dict[str, Any]]:
        return self.select(
            "app_courses",
            filters=[
                ("school", f"eq.{school}"),
                ("major", f"eq.{major}"),
                ("enrollment_year", f"eq.{int(enrollment_year)}"),
                ("status", "eq.verified"),
            ],
            order="course_id.asc",
        )

    def list_verified_prerequisites(
        self,
        course_ids: Sequence[str],
        *,
        rules_version: str | None = None,
    ) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        ids = list(dict.fromkeys(str(course_id) for course_id in course_ids))
        version = rules_version or self.config.rules_version
        for start in range(0, len(ids), 100):
            batch = ids[start : start + 100]
            if not batch:
                continue
            quoted = ",".join(batch)
            rows.extend(
                self.select(
                    "app_prerequisites",
                    filters=[
                        ("course_id", f"in.({quoted})"),
                        ("rule_version", f"eq.{version}"),
                    ],
                    order="course_id.asc,prerequisite_id.asc",
                )
            )
        return rows

    def list_verified_competitions(self) -> list[dict[str, Any]]:
        return self.select(
            "app_competitions",
            filters=[("status", "eq.verified")],
            order="competition_id.asc",
        )

    def list_verified_credit_rules(self, *, school: str, enrollment_year: int) -> list[dict[str, Any]]:
        return self.select(
            "app_credit_rules",
            filters=[
                ("school", f"eq.{school}"),
                ("enrollment_year", f"eq.{int(enrollment_year)}"),
                ("status", "eq.verified"),
            ],
            order="rule_id.asc",
        )

    def list_verified_direction_requirements(self, direction_id: str) -> list[dict[str, Any]]:
        return self.select(
            "app_direction_requirements",
            filters=[("direction_id", f"eq.{direction_id}"), ("status", "eq.verified")],
            order="requirement_id.asc",
        )

    def list_verified_requirement_actions(self, requirement_ids: Sequence[str]) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        ids = list(dict.fromkeys(str(item) for item in requirement_ids))
        for start in range(0, len(ids), 100):
            batch = ids[start : start + 100]
            if not batch:
                continue
            rows.extend(
                self.select(
                    "app_requirement_actions",
                    filters=[
                        ("requirement_id", f"in.({','.join(batch)})"),
                        ("mapping_status", "eq.verified"),
                    ],
                    order="requirement_id.asc,action_id.asc",
                )
            )
        return rows

    # ------------------------------------------------------------------
    # 用量 / 预算
    # ------------------------------------------------------------------
    def record_usage(
        self,
        *,
        owner_id: str | None,
        run_id: str | None,
        provider: str,
        model: str,
        operation: str,
        input_tokens: int | None,
        output_tokens: int | None,
        estimated_cost: Decimal | None,
        currency: str,
        pricing_snapshot_at: datetime | None,
    ) -> None:
        row = {
            "owner_id": owner_id,
            "run_id": run_id,
            "provider": provider,
            "model": model,
            "operation": operation,
            # 未知 token 写 NULL，绝不写 0。
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "estimated_cost": None if estimated_cost is None else str(estimated_cost),
            "currency": currency,
            "pricing_snapshot_at": pricing_snapshot_at.isoformat() if pricing_snapshot_at else None,
        }
        try:
            self.insert_no_return("app_usage", [row])
        except DatabaseError:
            # 用量记录失败不能拖垮业务结果，但必须留下可见日志（字段安全）。
            log_event(
                logger,
                "usage_record_failed",
                level=40,
                run_id=run_id,
                model=model,
                operation=operation,
            )

    def usage_since(self, *, since: datetime) -> UsageTotals:
        """汇总某时间点之后的用量成本；成本未知的行单独计数（不当作 0 花费）。"""

        total = Decimal(0)
        unknown = 0
        offset = 0
        since_iso = since.astimezone(timezone.utc).isoformat()
        while True:
            rows = self.select(
                "app_usage",
                filters=[("created_at", f"gte.{since_iso}")],
                columns="estimated_cost",
                limit=DEFAULT_PAGE_SIZE,
                offset=offset,
            )
            for row in rows:
                value = row.get("estimated_cost")
                if value is None:
                    unknown += 1
                else:
                    try:
                        total += Decimal(str(value))
                    except Exception:  # noqa: BLE001 - 脏数据不能拖垮预算闸门
                        unknown += 1
            if len(rows) < DEFAULT_PAGE_SIZE:
                break
            offset += DEFAULT_PAGE_SIZE
        return UsageTotals(spent_usd=total, unknown_cost_usage_count=unknown)
