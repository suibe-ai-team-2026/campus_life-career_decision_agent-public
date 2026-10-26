import uuid

from app.providers.deepseek_search import _is_public_url
from app.agent.research import WebSource, _to_citation, _to_evidence


def test_is_public_url_accepts_https_and_rejects_private():
    assert _is_public_url("https://www.suibe.edu.cn/2024/report.pdf")
    assert _is_public_url("http://edu.cn")
    assert not _is_public_url("file:///etc/passwd")
    assert not _is_public_url("https://127.0.0.1/x")
    assert not _is_public_url("https://localhost/x")
    assert not _is_public_url("https://192.168.1.2/x")
    assert not _is_public_url("https://10.0.0.1/x")
    assert not _is_public_url("https://user:pass@example.com/x")
    assert not _is_public_url("not-a-url")


def test_web_citation_has_stable_uuids_and_scope():
    source = WebSource(
        url="https://example.edu.cn/report",
        title="就业质量报告",
        site_name="example.edu.cn",
        published_at="2024-05-01T00:00:00Z",
        fetched_at="2026-10-26T00:00:00Z",
        kind="fetch",
        snippet="摘要",
        content="正文内容",
    )
    citation = _to_citation(source, 3)
    assert citation.citation_no == 3
    assert citation.source_scope == "实时网页"
    assert citation.verification_status == "web_unverified"
    assert citation.source_id == "web:example.edu.cn"
    uuid.UUID(citation.source_version_id)
    uuid.UUID(citation.chunk_id)
    assert citation.locator["url"] == source.url


def test_web_evidence_carries_url_and_text_for_validator():
    source = WebSource(url="https://example.edu.cn/r", title="T", snippet="S", content="C")
    evidence = _to_evidence(source, 1)
    assert evidence["citation_no"] == 1
    assert evidence["source_type"] == "web"
    assert evidence["canonical_url"] == source.url
    assert evidence["text"] == "C"
    assert evidence["locator"]["url"] == source.url
