#!/usr/bin/env python3
"""Apply the additive Supabase migrations through the Management API.

Why this exists: this machine cannot open a raw Postgres TCP connection to the
project (5432/6543 are blocked by the local network proxy), while the Supabase
Management API over HTTPS works. The script therefore executes each migration
inside one transaction and records it in supabase_migrations.schema_migrations,
which is the table the Supabase CLI uses for migration history.

Safety:
  * dry-run executes ALL migrations in a single transaction and rolls back;
  * apply aborts if the remote already contains app_ tables but no matching
    migration history (refuses to guess);
  * apply refuses files containing top-level DROP TABLE / TRUNCATE / DELETE;
  * one transaction per migration, so a failed migration leaves no partial DDL.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = sorted((ROOT / "supabase" / "migrations").glob("*.sql"))
EVIDENCE = ROOT / "docs" / "evidence"
CREDENTIALS = Path(os.environ.get("CAMPUS_PATHWAY_ENV_FILE", "~/.config/campus-pathway/credentials.env")).expanduser()
FORBIDDEN = re.compile(r"(?im)^\s*(drop\s+table|truncate|delete\s+from)\b")


def load_env() -> dict[str, str]:
    values: dict[str, str] = {}
    if CREDENTIALS.exists():
        for line in CREDENTIALS.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, raw = line.split("=", 1)
            values[key] = raw.strip().strip("'")
    for key in ("SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF"):
        if not values.get(key) and os.environ.get(key):
            values[key] = os.environ[key]
    return values


def api(token: str, ref: str, sql: str, timeout: int = 120) -> list | dict:
    body = json.dumps({"query": sql}).encode()
    request = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{ref}/database/query",
        data=body,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode()[:2000]
        raise RuntimeError(f"management_api_{exc.code}: {detail}") from exc


def q(token: str, ref: str, sql: str) -> list | dict:
    return api(token, ref, sql)


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def file_meta() -> list[dict]:
    rows = []
    for path in MIGRATIONS:
        content = path.read_text()
        if FORBIDDEN.search(content):
            raise SystemExit(f"refusing {path.name}: contains a top-level destructive statement")
        rows.append(
            {
                "version": path.stem.split("_", 1)[0],
                "name": path.stem,
                "sha256": hashlib.sha256(content.encode()).hexdigest(),
                "bytes": len(content.encode()),
                "statements": content.count(";"),
                "path": str(path.relative_to(ROOT)),
            }
        )
    return rows


def history_sql(version: str, name: str) -> str:
    return (
        "create schema if not exists supabase_migrations;"
        "create table if not exists supabase_migrations.schema_migrations ("
        "version text primary key, statements text[], name text, created_by text, idempotency_key text);"
        f"insert into supabase_migrations.schema_migrations (version, name, statements, created_by) "
        f"values ('{version}', '{name}', '{{}}'::text[], 'campus-pathway-deploy') "
        "on conflict (version) do nothing;"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if args.dry_run == args.apply:
        raise SystemExit("pass exactly one of --dry-run or --apply")

    env = load_env()
    token = env.get("SUPABASE_ACCESS_TOKEN")
    ref = env.get("SUPABASE_PROJECT_REF")
    if not token or not ref:
        raise SystemExit("missing SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF in protected env")

    metas = file_meta()
    remote = q(
        token,
        ref,
        "select "
        "(select count(*)::int from pg_tables where schemaname = 'public' and tablename like 'app_%') as app_tables,"
        "(select count(*)::int from pg_tables where schemaname = 'app_private') as private_tables,"
        "(select to_regclass('supabase_migrations.schema_migrations') is not null) as history_exists,"
        "(select count(*)::int from storage.buckets) as buckets;",
    )
    state = remote[0] if isinstance(remote, list) and remote else {}
    report: dict = {
        "generated_at": now(),
        "project_ref": ref,
        "mode": "dry-run" if args.dry_run else "apply",
        "migrations": metas,
        "remote_before": state,
        "commands": [],
    }

    if args.dry_run:
        if state.get("history_exists"):
            applied = q(token, ref, "select version from supabase_migrations.schema_migrations order by version;")
            applied_versions = {row["version"] for row in applied} if isinstance(applied, list) else set()
        else:
            applied_versions = set()
        pending = [(meta, path) for meta, path in zip(metas, MIGRATIONS) if meta["version"] not in applied_versions]
        report["applied_before"] = sorted(applied_versions)
        report["pending"] = [meta["version"] for meta, _ in pending]
        if pending:
            combined = (
                "begin;\n"
                + "\n".join(path.read_text() for _, path in pending)
                + "\nselect 'dry-run-ok' as result;\nrollback;\n"
            )
            api(token, ref, combined, timeout=180)
        report["result"] = "rolled_back_successfully"
        report["note"] = "仅对尚未应用的迁移在单事务中执行后回滚；没有写入任何对象。"
    else:
        if (state.get("app_tables", 0) or state.get("private_tables", 0) or state.get("buckets", 0)) and not state.get("history_exists"):
            raise SystemExit(
                "remote already contains app objects but no migration history; refusing to guess. "
                f"remote_before={json.dumps(state)}"
            )
        if state.get("history_exists"):
            applied = q(
                token,
                ref,
                "select version from supabase_migrations.schema_migrations order by version;",
            )
            applied_versions = {row["version"] for row in applied} if isinstance(applied, list) else set()
        else:
            applied_versions = set()

        for meta, path in zip(metas, MIGRATIONS):
            if meta["version"] in applied_versions:
                report["commands"].append({"version": meta["version"], "status": "already_applied"})
                continue
            sql = (
                "begin;\n"
                + path.read_text()
                + "\n"
                + history_sql(meta["version"], meta["name"])
                + "\ncommit;\n"
            )
            api(token, ref, sql, timeout=180)
            report["commands"].append({"version": meta["version"], "status": "applied", "name": meta["name"]})
            print(f"applied {meta['name']}", flush=True)

        verify = q(
            token,
            ref,
            "select "
            "(select count(*)::int from pg_tables where schemaname = 'public' and tablename like 'app_%') as app_tables,"
            "(select count(*)::int from pg_tables where schemaname = 'app_private') as private_tables,"
            "(select count(*)::int from pg_policies where schemaname = 'public') as policies,"
            "(select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'worker_%') as worker_functions,"
            "(select count(*)::int from storage.buckets where id in ('career-source-files','career-artifacts')) as buckets,"
            "(select count(*)::int from supabase_migrations.schema_migrations) as history_rows;",
        )
        report["remote_after"] = verify[0] if isinstance(verify, list) and verify else {}
        report["result"] = "applied"
        print(json.dumps(report["remote_after"], ensure_ascii=False))

    EVIDENCE.mkdir(parents=True, exist_ok=True)
    target = EVIDENCE / ("migration-apply.json" if args.apply else "migration-dry-run.json")
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(f"evidence: {target.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
