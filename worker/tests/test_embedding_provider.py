"""OpenRouter embedding 测试：批量 16、index 排序、维度/有限性校验、L2、重试与错误映射。"""

from __future__ import annotations

import json

import httpx
import pytest

from app.errors import (
    ModelAuthFailed,
    ModelOutputInvalid,
    ModelQuotaExceeded,
    ModelUnavailable,
)
from app.providers.openrouter import (
    OpenRouterClient,
    build_document_embedding_input,
    build_query_embedding_input,
    normalize_l2,
    vector_literal,
)
from tests.fakes import embedding_payload, make_config, make_mock_http, unit_vector


class Recorder:
    def __init__(self, respond) -> None:
        self.respond = respond
        self.requests: list[dict] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content) if request.content else None
        self.requests.append({"body": body, "url": str(request.url), "headers": dict(request.headers)})
        return self.respond(len(self.requests) - 1, body)


def _client(config, recorder, sleeps: list[float] | None = None) -> OpenRouterClient:
    return OpenRouterClient(
        config,
        http_client=make_mock_http(recorder),
        sleep=(sleeps.append if sleeps is not None else (lambda _seconds: None)),
    )


def _reversed_index_responder(dimensions: int = 4096):
    def respond(_attempt: int, body: dict) -> httpx.Response:
        texts = body["input"]
        vectors = [unit_vector(dimensions, at=index) for index in range(len(texts))]
        indexes = list(reversed(range(len(texts))))
        data = [{"index": index, "embedding": vectors[index]} for index in indexes]
        return httpx.Response(200, json={"data": data, "usage": {"prompt_tokens": len(texts)}})

    return respond


def test_batches_of_16_and_sorts_by_index():
    config = make_config()
    recorder = Recorder(_reversed_index_responder(config.embedding_dimensions))
    client = _client(config, recorder)
    response = client.embed_texts([f"文档片段 {index}" for index in range(17)], operation="test")
    assert len(recorder.requests) == 2
    assert [len(request["body"]["input"]) for request in recorder.requests] == [16, 1]
    assert response.request_count == 2
    assert len(response.vectors) == 17
    # index 排序后再归一化：每批第 i 个输入对应本批单位向量第 i 维
    for position in range(17):
        expected = unit_vector(config.embedding_dimensions, at=position if position < 16 else position - 16)
        assert response.vectors[position] == expected
    assert response.usage is not None and response.usage.input_tokens == 17


def test_rejects_wrong_count():
    config = make_config()

    def respond(_attempt, _body):
        return httpx.Response(200, json=embedding_payload([unit_vector()]))

    with pytest.raises(ModelOutputInvalid):
        _client(config, Recorder(respond)).embed_texts(["一", "二"])


def test_rejects_duplicate_index():
    config = make_config()

    def respond(_attempt, body):
        vectors = [unit_vector(), unit_vector(at=1)]
        payload = embedding_payload(vectors, indexes=[0, 0])
        return httpx.Response(200, json=payload)

    with pytest.raises(ModelOutputInvalid):
        _client(config, Recorder(respond)).embed_texts(["一", "二"])


def test_rejects_wrong_dimensions():
    config = make_config()

    def respond(_attempt, _body):
        return httpx.Response(200, json=embedding_payload([[0.6, 0.8]]))

    with pytest.raises(ModelOutputInvalid):
        _client(config, Recorder(respond)).embed_texts(["一"])


def test_rejects_zero_and_non_finite_vectors():
    config = make_config()
    zero = [0.0] * 4096

    def respond_zero(_attempt, _body):
        return httpx.Response(200, json=embedding_payload([zero]))

    with pytest.raises(ModelOutputInvalid):
        _client(config, Recorder(respond_zero)).embed_texts(["一"])

    nan_vector = [0.0] * 4096
    nan_vector[0] = float("nan")
    # httpx 的 json= 会拒绝 NaN，这里手工序列化以模拟上游返回 NaN 的情况。
    import json as _json

    nan_payload = _json.dumps(embedding_payload([nan_vector]), allow_nan=True).encode("utf-8")

    def respond_nan(_attempt, _body):
        return httpx.Response(200, content=nan_payload, headers={"content-type": "application/json"})

    with pytest.raises(ModelOutputInvalid):
        _client(config, Recorder(respond_nan)).embed_texts(["一"])


def test_normalize_l2_returns_unit_length():
    vector = normalize_l2([3.0, 4.0])
    assert pytest.approx(vector, abs=1e-9) == [0.6, 0.8]
    with pytest.raises(ModelOutputInvalid):
        normalize_l2([0.0, 0.0])


def test_vector_literal_is_pgvector_text():
    literal = vector_literal([0.5, 0.25])
    assert literal.startswith("[") and literal.endswith("]")
    assert literal == "[0.5,0.25]"


def test_retries_on_429_respecting_retry_after():
    config = make_config(MODEL_MAX_RETRIES="3")
    sleeps: list[float] = []

    def respond(attempt, body):
        if attempt == 0:
            return httpx.Response(429, headers={"retry-after": "1.5"}, json={"error": {"message": "rate limited"}})
        texts = body["input"]
        return httpx.Response(200, json=embedding_payload([unit_vector() for _ in texts]))

    response = _client(config, Recorder(respond), sleeps).embed_texts(["一"])
    assert len(response.vectors) == 1
    assert sleeps and sleeps[0] == 1.5


def test_401_is_not_retried_and_maps_auth_failed():
    config = make_config()
    recorder = Recorder(lambda _attempt, _body: httpx.Response(401, json={"error": {"message": "invalid key"}}))
    with pytest.raises(ModelAuthFailed):
        _client(config, recorder).embed_texts(["一"])
    assert len(recorder.requests) == 1


def test_402_is_not_retried_and_maps_quota_exceeded():
    config = make_config()
    recorder = Recorder(lambda _attempt, _body: httpx.Response(402, json={"error": {"message": "credits"}}))
    with pytest.raises(ModelQuotaExceeded):
        _client(config, recorder).embed_texts(["一"])
    assert len(recorder.requests) == 1


def test_5xx_exhausts_retries_then_model_unavailable():
    config = make_config(MODEL_MAX_RETRIES="2")
    recorder = Recorder(lambda _attempt, _body: httpx.Response(503, json={"error": {"message": "down"}}))
    with pytest.raises(ModelUnavailable):
        _client(config, recorder).embed_texts(["一"])
    assert len(recorder.requests) == 3  # 1 次初始 + 2 次重试


def test_usage_tokens_unknown_stay_none():
    config = make_config()

    def respond(_attempt, body):
        vectors = [unit_vector() for _ in body["input"]]
        payload = embedding_payload(vectors, tokens=None)
        return httpx.Response(200, json=payload)

    response = _client(config, Recorder(respond)).embed_texts(["一"])
    assert response.usage is not None
    assert response.usage.input_tokens is None
    assert response.usage.estimated_cost is None


def test_query_instruction_and_document_input_are_separated():
    config = make_config()
    query = build_query_embedding_input(config, "国贸专业就业方向？")
    assert query.startswith("Instruct: Given a campus career planning question")
    assert "Query: 国贸专业就业方向？" in query
    doc = build_document_embedding_input("第一段文档正文")
    assert "Instruct:" not in doc
    assert doc == "第一段文档正文"
    provider_auto = make_config(EMBEDDING_INSTRUCTION_MODE="provider_auto")
    assert build_query_embedding_input(provider_auto, "国贸专业就业方向？") == "国贸专业就业方向？"
