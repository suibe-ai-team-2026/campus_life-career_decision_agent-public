"""OpenRouter chat 测试：JSON 模式、response_format 兼容回退、重试、错误映射、token。"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from app.errors import ModelAuthFailed, ModelQuotaExceeded, ModelTimeout, ModelUnavailable
from app.providers.openrouter import OpenRouterClient
from tests.fakes import chat_payload, make_config, make_mock_http


class Recorder:
    def __init__(self, respond) -> None:
        self.respond = respond
        self.requests: list[dict[str, Any]] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content) if request.content else None
        self.requests.append({"body": body, "url": str(request.url)})
        return self.respond(len(self.requests) - 1, body)


def _client(config, recorder, sleeps: list[float] | None = None) -> OpenRouterClient:
    return OpenRouterClient(
        config,
        http_client=make_mock_http(recorder),
        sleep=(sleeps.append if sleeps is not None else (lambda _seconds: None)),
    )


MESSAGES = [{"role": "user", "content": "只输出 JSON"}]


def test_json_mode_is_requested_and_usage_parsed():
    config = make_config()
    recorder = Recorder(lambda _attempt, _body: httpx.Response(200, json=chat_payload('{"ok": true}')))
    response = _client(config, recorder).chat(MESSAGES, operation="test_chat")
    first_body = recorder.requests[0]["body"]
    assert first_body["response_format"] == {"type": "json_object"}
    assert first_body["model"] == "deepseek/deepseek-chat"
    assert first_body["temperature"] == 0.1
    assert response.content == '{"ok": true}'
    assert response.usage is not None
    assert response.usage.input_tokens == 100 and response.usage.output_tokens == 40
    assert response.usage.estimated_cost is not None


def test_response_format_unsupported_is_retried_without_field():
    config = make_config()
    sleeps: list[float] = []

    def respond(attempt, body):
        if attempt == 0:
            return httpx.Response(400, json={"error": {"message": "response_format is not supported"}})
        assert "response_format" not in body
        return httpx.Response(200, json=chat_payload('{"ok": true}'))

    response = _client(config, Recorder(respond), sleeps).chat(MESSAGES, operation="test_chat")
    assert response.content == '{"ok": true}'
    assert sleeps == []  # 兼容回退不消耗 429/5xx 的退避重试


def test_5xx_retries_then_succeeds():
    config = make_config()
    sleeps: list[float] = []

    def respond(attempt, _body):
        if attempt == 0:
            return httpx.Response(500, json={"error": {"message": "upstream"}})
        return httpx.Response(200, json=chat_payload('{"ok": true}'))

    response = _client(config, Recorder(respond), sleeps).chat(MESSAGES, operation="test_chat")
    assert response.content == '{"ok": true}'
    assert len(sleeps) == 1


def test_5xx_exhausted_maps_model_unavailable():
    config = make_config(MODEL_MAX_RETRIES="1")
    recorder = Recorder(lambda _attempt, _body: httpx.Response(502, json={"error": {"message": "bad gateway"}}))
    with pytest.raises(ModelUnavailable):
        _client(config, recorder).chat(MESSAGES, operation="test_chat")
    assert len(recorder.requests) == 2


def test_timeout_maps_model_timeout():
    config = make_config(MODEL_MAX_RETRIES="1")

    def respond(_attempt, _body):
        raise httpx.TimeoutException("timeout")

    with pytest.raises(ModelTimeout):
        _client(config, Recorder(respond)).chat(MESSAGES, operation="test_chat")


def test_auth_and_quota_errors_are_not_retried():
    config = make_config()
    recorder = Recorder(lambda _attempt, _body: httpx.Response(401, json={"error": {"message": "bad key"}}))
    with pytest.raises(ModelAuthFailed):
        _client(config, recorder).chat(MESSAGES, operation="test_chat")
    assert len(recorder.requests) == 1

    recorder = Recorder(lambda _attempt, _body: httpx.Response(402, json={"error": {"message": "no credits"}}))
    with pytest.raises(ModelQuotaExceeded):
        _client(config, recorder).chat(MESSAGES, operation="test_chat")
    assert len(recorder.requests) == 1


def test_content_list_is_flattened():
    config = make_config()
    payload = chat_payload("")
    payload["choices"][0]["message"]["content"] = [
        {"type": "text", "text": '{"ok": '},
        {"type": "text", "text": "true}"},
    ]

    def respond(_attempt, _body):
        return httpx.Response(200, json=payload)

    response = _client(config, Recorder(respond)).chat(MESSAGES, operation="test_chat")
    assert response.content == '{"ok": true}'


def test_empty_content_is_invalid_output():
    config = make_config()

    def respond(_attempt, _body):
        return httpx.Response(200, json={"choices": [{"message": {"content": ""}}], "usage": {}})

    from app.errors import ModelOutputInvalid

    with pytest.raises(ModelOutputInvalid):
        _client(config, Recorder(respond)).chat(MESSAGES, operation="test_chat")
