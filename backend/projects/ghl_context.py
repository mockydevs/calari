"""Curated GHL reads shared by investigations and acceptance checks."""
import time
from concurrent.futures import ThreadPoolExecutor
from django.core.cache import cache
from django.utils import timezone
from onboarding.mcp import Client, McpError
from . import ghl

READ_TOOLS = {
    "opportunities_get-pipelines": {},
    "locations_get-custom-fields": {"query_model": "string"},
}
AREAS = ("pipelines", "tags", "forms", "workflows", "customFields")


def evidence(key, source, observation, *, reference="", completeness="partial", sensitivity="internal"):
    return {"key": key, "source": source, "reference": reference or key, "observation": observation,
            "completeness": completeness, "sensitivity": sensitivity, "retrieved_at": timezone.now()}


def normalized(data, area, location):
    # MCP envelopes sometimes wrap the API response in data.
    if isinstance(data.get("data"), dict):
        data = data["data"]
    rows = data.get(area)
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise ghl.GhlError("GHL returned an unsupported resource list.")
    if any(row.get("locationId", location) != location for row in rows):
        raise ghl.GhlError("GHL returned a resource outside this client location.")
    safe = []
    for row in rows[:50]:
        item = {key: str(row[key])[:160] for key in ("id", "name", "status", "dataType") if row.get(key) is not None}
        if area == "pipelines" and isinstance(row.get("stages"), list):
            item["stages"] = [{"id": str(s.get("id", ""))[:120], "name": str(s.get("name", ""))[:160]} for s in row["stages"][:50] if isinstance(s, dict)]
        safe.append(item)
    return {"area": area, "records": safe, "returned": len(rows), "limit": 50,
            "limitation": "Bounded configuration inventory. Omitted records do not prove absence; execution and wiring are not verified."}


def collect(connection, areas, *, record_reference="", allow_records=False, deadline=None, fresh=False):
    """At most 8 data reads: identity, five configuration areas, one exact record.

    No broad contact search; the staff member must supply an exact record ID.
    Record payload is checked for location ownership before any fields leave here.
    """
    deadline = deadline or time.monotonic() + 35
    token = ghl.connection_token(connection)
    location = ghl.validate_location(connection.location_id)
    areas = [area for area in AREAS if area in areas]
    identity = ghl._get(token, f"/locations/{location}", deadline=deadline).get("location", {})
    if not isinstance(identity, dict) or identity.get("id") != location:
        raise ghl.GhlError("GHL location identity could not be verified.")
    out = [evidence("ghl:location", "ghl", {"name": str(identity.get("name", ""))[:160], "location_id": location}, completeness="observed")]
    routes = {
        "pipelines": ("/opportunities/pipelines", {"locationId": location}),
        "tags": (f"/locations/{location}/tags", None),
        "forms": ("/forms/", {"locationId": location, "limit": 50}),
        "workflows": ("/workflows/", {"locationId": location}),
        "customFields": (f"/locations/{location}/customFields", None),
    }
    # Discovery is not sent to the model. Only these two tools may run.
    mcp = Client("ghl", token, location=location, deadline=deadline)
    try:
        schemas = mcp.discover()
    except McpError:
        schemas = {}

    def read(area):
        cache_key = f"ghl-context:v1:{connection.client_id}:{connection.revision}:{area}"
        cached = None if fresh else cache.get(cache_key)
        if cached:
            return cached
        transport = "REST"
        try:
            tool = {"pipelines": "opportunities_get-pipelines", "customFields": "locations_get-custom-fields"}.get(area)
            if tool and tool in schemas:
                # Calls on this MCP session are kept sequential below.
                data = mcp.read(tool, {"query_model": "all"} if area == "customFields" else {}, allowed=READ_TOOLS, schemas=schemas)
                transport = "MCP"
            else:
                path, params = routes[area]
                data = ghl._get(token, path, params, deadline=deadline)
            observation = normalized(data, area, location)
            observation["transport"] = transport
            result = evidence(f"ghl:{area}", "ghl", observation)
            cache.set(cache_key, result, 300)
            return result
        except (ghl.GhlError, McpError) as exc:
            return evidence(f"ghl:{area}", "ghl", {"area": area, "error": str(exc), "transport": transport}, completeness="unavailable")
    for area in (a for a in areas if a in ("pipelines", "customFields")):
        out.append(read(area))
    with ThreadPoolExecutor(max_workers=3) as pool:
        out.extend(pool.map(read, [a for a in areas if a not in ("pipelines", "customFields")]))
    if record_reference:
        if not allow_records:
            out.append(evidence("ghl:contact", "ghl", {"error": "Record reads require administrator opt-in for this client."}, completeness="unavailable"))
        else:
            record_id = ghl.validate_location(record_reference)
            try:
                row = ghl._get(token, f"/contacts/{record_id}", deadline=deadline).get("contact", {})
                if not isinstance(row, dict) or row.get("locationId") != location or row.get("id") != record_id:
                    raise ghl.GhlError("Exact record could not be verified within this client location.")
                # No free text, custom field values, contact details, notes or medical information.
                safe = {"id": record_id, "location_id": location, "tags": [str(t)[:120] for t in row.get("tags", [])[:50]]}
                safe["limitation"] = "Only record identity and tags inspected; no messages, clinical data, executions or submissions."
                out.append(evidence("ghl:contact", "ghl", safe, completeness="observed", sensitivity="record"))
            except ghl.GhlError as exc:
                out.append(evidence("ghl:contact", "ghl", {"error": str(exc)}, completeness="unavailable"))
    return out


def capabilities(connection):
    client = Client("ghl", ghl.connection_token(connection), location=connection.location_id)
    schemas = client.discover()
    return {"transport": "MCP + REST", "mcp_reads": [name for name in READ_TOOLS if name in schemas],
            "rest_reads": list(AREAS), "record_reads": "Exact contact ID and tags only; requires client opt-in",
            "disabled": ["writes", "outgoing messages", "payments", "clinical data", "workflow execution"],
            "note": "Discovery is not a scope test. Individual reads may still be denied."}


def verification_snapshot(connection):
    items = collect(connection, AREAS, fresh=True)
    checks = [{"area": e["observation"].get("area", e["key"]), "ok": e["completeness"] != "unavailable",
               "returned": e["observation"].get("returned", 0), "error": e["observation"].get("error", ""),
               "names": [r.get("name", "") for r in e["observation"].get("records", [])]} for e in items if e["key"] != "ghl:location"]
    return {"ok": all(c["ok"] for c in checks), "checks": checks, "evidence": items, "limitations": ghl.LIMITATIONS}
