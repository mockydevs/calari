"""Bounded Streamable HTTP transport. Callers own fixed tool allowlists.

No server-initiated requests, URL discovery, redirects, sampling or mutations.
SSE *responses* are supported; legacy SSE connections are not opened.
"""
import json
import time
import uuid
import requests

ENDPOINTS = {"ghl": "https://services.leadconnectorhq.com/mcp/", "slack": "https://mcp.slack.com/mcp"}


class McpError(Exception):
    pass


class Client:
    def __init__(self, provider, token, *, location=None, deadline=None):
        self.url = ENDPOINTS[provider]
        self.deadline = deadline or time.monotonic() + 20
        self.headers = {"Authorization": f"Bearer {token}", "Accept": "application/json, text/event-stream", "Content-Type": "application/json"}
        if provider == "ghl":
            if not location:
                raise McpError("A mapped location is required.")
            self.headers["locationId"] = location

    def rpc(self, method, params=None, *, notification=False):
        remaining = self.deadline - time.monotonic()
        if remaining < 0.2:
            raise McpError("Context time budget reached; results are incomplete.")
        request_id = str(uuid.uuid4())
        payload = {"jsonrpc": "2.0", "method": method, "params": params or {}}
        if not notification:
            payload["id"] = request_id
        try:
            with requests.post(self.url, headers=self.headers, json=payload, timeout=(min(3, remaining), min(7, remaining)), allow_redirects=False, stream=True) as response:
                if response.status_code in (401, 403):
                    raise McpError("Context access denied. Reconnect or check read scopes.")
                if response.status_code == 429:
                    raise McpError("Context rate limit reached. Retry later.")
                if response.status_code not in (200, 202, 204):
                    raise McpError("Context service unavailable.")
                session = response.headers.get("Mcp-Session-Id")
                if session:
                    self.headers["Mcp-Session-Id"] = session
                if notification:
                    return {}
                body = bytearray()
                for chunk in response.iter_content(4096):
                    body.extend(chunk)
                    if len(body) > 2 * 1024 * 1024 or time.monotonic() > self.deadline:
                        raise McpError("Context response exceeded its size or time budget.")
                    if "text/event-stream" in response.headers.get("Content-Type", ""):
                        for block in bytes(body).replace(b"\r\n", b"\n").split(b"\n\n")[:-1]:
                            data = b"\n".join(line[5:].strip() for line in block.splitlines() if line.startswith(b"data:"))
                            if data:
                                parsed = json.loads(data)
                                if parsed.get("id") == request_id:
                                    return self._result(parsed)
                parsed = json.loads(body)
                if parsed.get("id") != request_id:
                    raise McpError("Context service returned a mismatched response.")
                return self._result(parsed)
        except (requests.RequestException, ValueError, UnicodeError, AttributeError):
            raise McpError("Could not retrieve context safely.") from None

    @staticmethod
    def _result(parsed):
        if parsed.get("error") or not isinstance(parsed.get("result"), dict):
            raise McpError("Context operation failed or is unavailable for this grant.")
        return parsed["result"]

    def discover(self):
        init = self.rpc("initialize", {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "calari-context", "version": "1.0"}})
        version = init.get("protocolVersion")
        if version not in ("2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"):
            raise McpError("Unsupported MCP protocol version.")
        self.headers["MCP-Protocol-Version"] = version
        self.rpc("notifications/initialized", notification=True)
        result = self.rpc("tools/list")
        rows = result.get("tools")
        if not isinstance(rows, list) or len(rows) > 200:
            raise McpError("Invalid MCP tool catalogue.")
        return {row["name"]: row.get("inputSchema", {}) for row in rows if isinstance(row, dict) and isinstance(row.get("name"), str)}

    def read(self, name, args, *, allowed, schemas):
        # Do not infer read permission from a tool name or server annotations.
        if name not in allowed or name not in schemas:
            raise McpError("This context operation is not approved or available.")
        expected = allowed[name]
        schema = schemas[name]
        properties = schema.get("properties", {})
        if schema.get("type") != "object" or set(properties) != set(expected) or any(properties[k].get("type") != kind for k, kind in expected.items()):
            raise McpError("Context tool schema changed. Administrator review required.")
        if not set(schema.get("required", [])) <= set(args) or not set(args) <= set(expected):
            raise McpError("Context tool arguments do not match the approved schema.")
        result = self.rpc("tools/call", {"name": name, "arguments": args})
        if result.get("isError"):
            raise McpError("Context operation was denied or failed.")
        if isinstance(result.get("structuredContent"), dict):
            return result["structuredContent"]
        for item in result.get("content", []):
            if item.get("type") == "text":
                try:
                    data = json.loads(item.get("text", ""))
                    if isinstance(data, dict):
                        return data
                except ValueError:
                    pass
        raise McpError("Context tool returned an unsupported result format.")
