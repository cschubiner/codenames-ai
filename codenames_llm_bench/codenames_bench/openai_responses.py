from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import requests


DEFAULT_BASE_URL = "https://api.openai.com/v1/responses"


@dataclass
class LLMResponse:
    parsed: Any
    raw: Dict[str, Any]
    output_text: str
    usage: Dict[str, Any]
    response_id: Optional[str]
    model: Optional[str]


class SQLiteCache:
    """
    Very small caching layer for deterministic calls (e.g., temperature=0).
    You probably do NOT want caching when temperature>0.
    """
    def __init__(self, path: str) -> None:
        self.path = path
        os.makedirs(os.path.dirname(path), exist_ok=True) if os.path.dirname(path) else None
        self._init()

    def _init(self) -> None:
        con = sqlite3.connect(self.path)
        try:
            con.execute(
                "CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value TEXT, created_at REAL)"
            )
            con.commit()
        finally:
            con.close()

    def get(self, key: str) -> Optional[Dict[str, Any]]:
        con = sqlite3.connect(self.path)
        try:
            cur = con.execute("SELECT value FROM cache WHERE key=?", (key,))
            row = cur.fetchone()
            if not row:
                return None
            return json.loads(row[0])
        finally:
            con.close()

    def set(self, key: str, value: Dict[str, Any]) -> None:
        con = sqlite3.connect(self.path)
        try:
            con.execute(
                "INSERT OR REPLACE INTO cache (key, value, created_at) VALUES (?, ?, ?)",
                (key, json.dumps(value), time.time()),
            )
            con.commit()
        finally:
            con.close()


class OpenAIResponsesClient:
    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = DEFAULT_BASE_URL,
        timeout_s: float = 60.0,
        cache: Optional[SQLiteCache] = None,
    ) -> None:
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY")
        if not self.api_key:
            raise RuntimeError("OPENAI_API_KEY not set. Export it before running.")
        self.base_url = base_url
        self.timeout_s = timeout_s
        self.cache = cache

    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def _cache_key(self, payload: Dict[str, Any]) -> str:
        # Do NOT include API key. Just hash payload.
        blob = json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
        return hashlib.sha256(blob).hexdigest()

    def create_json(
        self,
        *,
        model: str,
        input_items: List[Dict[str, str]],
        schema_name: str,
        schema: Dict[str, Any],
        temperature: float = 0.7,
        top_p: float = 1.0,
        max_output_tokens: int = 256,
        store: bool = False,
        mode: str = "json_schema",  # or "json_object"
        retries: int = 5,
        cache_deterministic_only: bool = True,
    ) -> LLMResponse:
        """
        Calls the Responses API and parses the first assistant output_text as JSON.

        Structured outputs are sent via:
          text: { format: { type: "json_schema", name: ..., schema: ..., strict: true } }

        Per OpenAI docs: https://platform.openai.com/docs/guides/structured-outputs
        """
        if mode not in ("json_schema", "json_object"):
            raise ValueError("mode must be json_schema or json_object")

        payload: Dict[str, Any] = {
            "model": model,
            "input": input_items,
            "temperature": temperature,
            "top_p": top_p,
            "max_output_tokens": max_output_tokens,
            "store": store,
            "text": {
                "format": {
                    "type": mode,
                }
            },
        }
        if mode == "json_schema":
            payload["text"]["format"].update({
                "name": schema_name,
                "schema": schema,
                "strict": True,
            })

        use_cache = (
            self.cache is not None
            and (not cache_deterministic_only or (temperature == 0 and top_p == 1.0))
        )
        cache_key = self._cache_key(payload) if use_cache else None

        if use_cache and cache_key:
            cached = self.cache.get(cache_key)
            if cached is not None:
                return self._parse_response(cached)

        backoff = 1.0
        last_err: Optional[Exception] = None
        for attempt in range(retries):
            try:
                resp = requests.post(
                    self.base_url,
                    headers=self._headers(),
                    data=json.dumps(payload),
                    timeout=self.timeout_s,
                )
                if resp.status_code == 429 or 500 <= resp.status_code < 600:
                    # Retryable
                    time.sleep(backoff)
                    backoff *= 2
                    continue
                resp.raise_for_status()
                data = resp.json()

                if use_cache and cache_key:
                    self.cache.set(cache_key, data)

                return self._parse_response(data)
            except Exception as e:
                last_err = e
                time.sleep(backoff)
                backoff *= 2

        raise RuntimeError(f"OpenAI request failed after {retries} retries: {last_err}")

    def _parse_response(self, data: Dict[str, Any]) -> LLMResponse:
        output_text = extract_output_text(data)
        parsed = None
        try:
            parsed = json.loads(output_text)
        except Exception:
            # Should be rare with Structured Outputs; attempt a salvage.
            parsed = _salvage_json(output_text)

        usage = data.get("usage", {}) or {}
        return LLMResponse(
            parsed=parsed,
            raw=data,
            output_text=output_text,
            usage=usage,
            response_id=data.get("id"),
            model=data.get("model"),
        )


def extract_output_text(resp_json: Dict[str, Any]) -> str:
    """
    Extracts the first assistant output_text from a Responses API JSON payload.
    """
    # Common: resp_json["output"] is a list of items; assistant message content in output_text.
    for item in resp_json.get("output", []) or []:
        if item.get("type") == "message" and item.get("role") == "assistant":
            for c in item.get("content", []) or []:
                if c.get("type") == "output_text":
                    return c.get("text", "")
                if c.get("type") == "refusal":
                    # Structured outputs doc: refusal is separate from schema output
                    raise RuntimeError(f"Model refusal: {c.get('refusal', '')}")

    # Fallbacks (SDKs may provide helpers, but raw JSON may also include other shapes)
    if "output_text" in resp_json and isinstance(resp_json["output_text"], str):
        return resp_json["output_text"]

    raise RuntimeError("No output_text found in response JSON.")


def _salvage_json(text: str) -> Any:
    """
    Very small best-effort parser if the model returns JSON with extra text.
    Structured Outputs should prevent this, but keep it for robustness.
    """
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        return json.loads(text[start:end+1])
    raise
