"""A per-minute rate limit on one key moves the call to the next key instead of waiting."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from app.services.providers import OpenAICompatibleProvider


class RateLimited(Exception):
    def __str__(self) -> str:
        return "Error code: 429 - rate_limit_exceeded: Limit 8000, Used 7900 tokens per minute (TPM)"


def _response(text: str) -> MagicMock:
    resp = MagicMock()
    resp.choices[0].message.content = text
    resp.usage.prompt_tokens = resp.usage.completion_tokens = resp.usage.total_tokens = 1
    return resp


def _provider(primary: MagicMock, second: MagicMock) -> OpenAICompatibleProvider:
    provider = OpenAICompatibleProvider(
        base_url="https://example.invalid/v1", api_key="key-1", model="qwen/qwen3.8-27b",
        fallback_models=["openai/gpt-oss-120b"], fallback_api_keys=["key-2"],
    )
    provider._client = primary
    provider._extra_clients = [second]
    return provider


def test_busy_key_switches_to_the_next_key_without_sleeping():
    primary, second = MagicMock(), MagicMock()
    primary.chat.completions.create.side_effect = RateLimited()
    second.chat.completions.create.return_value = _response('{"ok": true}')
    provider = _provider(primary, second)
    with patch("app.services.providers.time.sleep") as sleep:
        assert provider.chat_complete([{"role": "user", "content": "hi"}]) == '{"ok": true}'
    sleep.assert_not_called()
    # same model on the second key, not the fallback model
    assert second.chat.completions.create.call_args.kwargs["model"] == "qwen/qwen3.8-27b"
    # the busy pair is skipped on the next call
    second.chat.completions.create.return_value = _response('{"again": true}')
    assert provider.chat_complete([{"role": "user", "content": "hi"}]) == '{"again": true}'
    assert primary.chat.completions.create.call_count == 1


def test_last_candidate_still_waits_and_retries():
    primary, second = MagicMock(), MagicMock()
    primary.chat.completions.create.side_effect = RateLimited()
    second.chat.completions.create.side_effect = [RateLimited(), RateLimited(), RateLimited(), RateLimited(),
                                                  RateLimited(), RateLimited(), RateLimited(), RateLimited()]
    provider = _provider(primary, second)
    provider._fallback_models = []  # two candidates: key 1 and key 2
    with patch("app.services.providers.time.sleep") as sleep:
        with pytest.raises(RateLimited):
            provider.chat_complete([{"role": "user", "content": "hi"}])
    assert sleep.called  # the final candidate keeps the old wait-and-retry behaviour
