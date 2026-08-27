"""GHL chat boundary. Existing context/Slack read-only allowlists stay untouched."""
import json
import re
import time
from datetime import datetime, timedelta

from onboarding.mcp import Client, McpError
from projects.ghl import GhlError, connection_token, location_details


class ChatError(Exception):
    """Credential-free errors safe for the conversation."""


def unpack(result, operation=None):
    if not isinstance(result, dict) or result.get('isError'):
        raise ChatError('GHL rejected the operation. Check its inputs and granted scopes; no result count is available.')
    data = result.get('structuredContent')
    if not isinstance(data, dict):
        for part in result.get('content', []):
            if part.get('type') == 'text':
                try:
                    data = json.loads(part.get('text', ''))
                except (ValueError, TypeError):
                    continue
                if isinstance(data, dict):
                    break
    if not isinstance(data, dict) or data.get('success') is False or data.get('error'):
        raise ChatError('GHL returned an unsuccessful or unsupported result. This is not a zero count.')
    if operation and (data.get('success') is not True or type(data.get('status')) is not int
                      or not 200 <= data['status'] < 300 or data.get('operationId') != operation):
        raise ChatError('GHL did not confirm this operation succeeded. Do not retry a mutation until reconciled.')
    return data


def redact(value, secrets=()):
    """Credentials never enter model context, previews, audit rows or exports."""
    if isinstance(value, dict):
        return {key: '[REDACTED]' if re.sub(r'[^a-z]', '', key.lower()) in {
            'authorization', 'accesstoken', 'refreshtoken', 'apitoken', 'apikey',
            'privateintegrationtoken', 'password', 'secret', 'clientsecret',
            'encryptedtoken', 'token', 'cardnumber', 'cvv', 'cvc',
        } else redact(child, secrets) for key, child in value.items()}
    if isinstance(value, list):
        return [redact(child, secrets) for child in value]
    if isinstance(value, str):
        for secret in secrets:
            if secret:
                value = value.replace(secret, '[REDACTED]')
        value = re.sub(r'(?i)\bBearer\s+[^\s\"<>]+', 'Bearer [REDACTED]', value)
    return value


def verify_single_location(result, location):
    """Accept known complete location lists; unknown envelopes fail closed."""
    payload = result.get('data', result)
    if not isinstance(payload, dict):
        raise ChatError('GHL returned an unsupported location grant envelope.')
    rows = payload.get('locations')
    paging = [result, payload]
    for container in list(paging):
        paging.extend(container[key] for key in ('meta', 'pagination') if isinstance(container.get(key), dict))
    incomplete = any(container.get(key) for container in paging for key in
                     ('nextPageToken', 'nextCursor', 'nextPage', 'hasMore', 'hasNextPage'))
    invalid_total = any(container[key] != 1 for container in paging for key in ('total', 'totalLocations')
                        if key in container and container[key] is not None)
    if (not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict)
            or rows[0].get('id', rows[0].get('locationId')) != location or incomplete or invalid_total):
        raise ChatError('Use a verified single-location private integration. Multi-account or incomplete location grants are not accepted.')


def check_location(value, location):
    if isinstance(value, dict):
        for key, child in value.items():
            if key.lower().replace('_', '') in ('locationid', 'locationids'):
                if child != location and child != [location]:
                    raise ChatError('Cross-account parameters or results were blocked.')
            check_location(child, location)
    elif isinstance(value, list):
        for child in value:
            check_location(child, location)


def needs_confirmation(operation):
    # Unknown metadata fails closed. POST searches are read-only only when all
    # independent catalogue safety flags explicitly agree.
    return not (
        operation.get('kind') == 'read' and operation.get('readOnlyHint') is True
        and operation.get('requiresApproval') is False
        and operation.get('destructiveHint') is False
        and operation.get('idempotencyRequired') is False
        and operation.get('method') in ('GET', 'HEAD', 'POST')
    )


def bind_params(operation, params, location):
    if not isinstance(params, dict) or set(params) - {'path', 'query', 'body'}:
        raise ChatError('Only documented path, query and body parameters are accepted. Headers and URLs cannot be overridden.')
    params = json.loads(json.dumps(params))
    if len(json.dumps(params)) > 24000 or any(not isinstance(v, dict) for v in params.values()):
        raise ChatError('Operation parameters are invalid or too large.')
    check_location(params, location)
    # Agency/global APIs cannot be made safe merely by attaching a locationId.
    if operation.get('domain') in ('saas', 'users', 'oauth', 'companies', 'snapshots') or any(
        k in json.dumps(params).lower() for k in ('companyid', 'agencyid', 'authorization', 'accesstoken', 'apitoken')
    ):
        raise ChatError('Agency-wide, credential and global permission operations are disabled in this location-scoped workspace.')
    parameters = operation.get('parameters')
    fields = operation.get('requestBodyFields')
    if (not isinstance(parameters, list) or not isinstance(fields, list)
            or any(not isinstance(field, dict) for field in parameters + fields)):
        raise ChatError('The operation input contract is incomplete. Nothing was executed.')
    if not isinstance(operation.get('path'), str) or not operation['path'].startswith('/') or '://' in operation['path']:
        raise ChatError('The operation path is invalid.')
    for field in parameters:
        area, name = field.get('in'), field.get('name')
        if area not in ('path', 'query') or not name:
            continue
        if name in ('locationId', 'location_id'):
            params.setdefault(area, {})[name] = location
        if field.get('required') and params.get(area, {}).get(name) in (None, ''):
            raise ChatError(f'Missing required {area} parameter: {name}.')
    if '{locationId}' in operation.get('path', ''):
        params.setdefault('path', {})['locationId'] = location
    for field in fields:
        name = field.get('name')
        if name in ('locationId', 'location_id'):
            params.setdefault('body', {})[name] = location
        if field.get('required') and params.get('body', {}).get(name) in (None, ''):
            raise ChatError(f'Missing required body field: {name}.')
    for area in ('path', 'query'):
        allowed = {field.get('name') for field in parameters if field.get('in') == area}
        if area == 'path' and '{locationId}' in operation['path']:
            allowed.add('locationId')
        if set(params.get(area, {})) - allowed:
            raise ChatError('Undocumented path or query parameters were blocked.')
    # Body metadata may flatten nested fields; validate top-level keys only.
    allowed_body = {field.get('name', '').split('.')[0].split('[')[0] for field in fields}
    # MCP v2 omits locationId from this specific operation's body catalogue.
    # The REST search still accepts it; bind it here as a server-owned scope,
    # never as an arbitrary undocumented parameter supplied by the model.
    if (operation.get('operationId') == 'search-contacts-advanced'
            and operation.get('method') == 'POST'
            and operation.get('path') in ('/contacts/search', '/contacts/search/')):
        params.setdefault('body', {})['locationId'] = location
        allowed_body.add('locationId')
    if set(params.get('body', {})) - allowed_body:
        raise ChatError('Undocumented request body fields were blocked.')
    return params


class LiveGateway:
    def __init__(self, account):
        try:
            self.connection = account.client.ghl_connection
        except Exception:
            raise ChatError('Connect this client to a dedicated GHL private integration first.') from None
        self.location = self.connection.location_id
        self.revision = str(self.connection.revision)
        self.restricted_read = False
        try:
            token = connection_token(self.connection)
            details = location_details(token, self.location)
        except GhlError as exc:
            raise ChatError(str(exc)) from None
        self._token = token
        self.timezone = details.get('timezone')
        if not self.timezone:
            raise ChatError('GHL did not return the account timezone. Date reporting is disabled until it is available.')
        self.client = Client('ghl', token, location=self.location, deadline=time.monotonic() + 150)
        self.client.url = 'https://services.leadconnectorhq.com/mcp/anthropic/v2'
        try:
            self.schemas = self.client.discover()
        except McpError:
            raise ChatError('GHL catalogue discovery failed. Check the private integration and its scopes.') from None
        if not {'search_operations', 'describe_operation', 'execute_operation', 'list_locations'} <= set(self.schemas):
            raise ChatError('This connection does not expose the required GHL operation catalogue.')
        # Explicitly reject agency/multiple-location grants. The portal has a
        # separate encrypted PIT per client, never an agency-wide shared token.
        try:
            result = self.call('list_locations', {})
        except ChatError:
            # Agency PITs can pass the REST identity check too, so an unavailable
            # location listing NEVER authorizes generic operations or mutations.
            # Only a separately pinned, forced-location contact report can run.
            self.restricted_read = True
        else:
            verify_single_location(result, self.location)

    def call(self, name, args, operation=None):
        schema = self.schemas.get(name, {})
        props = schema.get('properties', {})
        if schema.get('type') != 'object' or not set(args) <= set(props) or not set(schema.get('required', [])) <= set(args):
            raise ChatError('GHL tool contract changed. Administrator review is required.')
        try:
            return redact(unpack(self.client.rpc('tools/call', {'name': name, 'arguments': args}), operation), (self._token,))
        except McpError:
            raise ChatError('GHL could not complete the request. Check connection, scopes and rate limits.') from None

    def search(self, query):
        result = self.call('search_operations', {'query': query[:2048], 'limit': 20})
        rows = result.get('results')
        if not isinstance(rows, list):
            raise ChatError('GHL operation discovery returned an invalid catalogue.')
        return rows

    def describe(self, operation_id):
        result = self.call('describe_operation', {'operationId': operation_id})
        op = result.get('operation')
        if not isinstance(op, dict) or op.get('operationId') != operation_id:
            raise ChatError('GHL did not describe the requested operation. Nothing was executed.')
        return op

    def execute(self, operation, params, *, key=None, reason=''):
        if self.restricted_read:
            raise ChatError('GHL could not establish a complete single-location grant. Only the restricted new-contact date report is available; generic operations and all mutations are blocked.')
        return self._execute(operation, params, key=key, reason=reason)

    def execute_contact_report(self, operation, params):
        """Narrow independent read policy; never rely solely on AI/catalogue flags."""
        if not self.restricted_read:
            return self.execute(operation, params)
        body = params.get('body', {})
        fields = {'locationId', 'pageLimit', 'sort', 'filters', 'searchAfter'}
        if (operation.get('operationId') != 'search-contacts-advanced' or operation.get('method') != 'POST'
                or operation.get('path') not in ('/contacts/search', '/contacts/search/') or needs_confirmation(operation)
                or set(params) != {'body'} or not isinstance(body, dict) or set(body) - fields
                or body.get('locationId') != self.location or body.get('pageLimit') != 100
                or body.get('sort') != [{'field': 'dateAdded', 'direction': 'desc'}]):
            raise ChatError('The restricted report only permits the verified location-scoped contact date search.')
        filters = body.get('filters')
        if (not isinstance(filters, list) or len(filters) != 1 or not isinstance(filters[0], dict)
                or set(filters[0]) != {'field', 'operator', 'value'} or filters[0].get('field') != 'dateAdded'
                or filters[0].get('operator') != 'range' or not isinstance(filters[0].get('value'), dict)
                or set(filters[0]['value']) != {'gte', 'lte'}):
            raise ChatError('The restricted report requires one bounded creation-date range.')
        try:
            begin, stop = [datetime.fromisoformat(filters[0]['value'][key].replace('Z', '+00:00')) for key in ('gte', 'lte')]
            if not begin.tzinfo or not stop.tzinfo or not timedelta(0) <= stop - begin <= timedelta(days=368):
                raise ValueError()
        except (ValueError, TypeError, AttributeError):
            raise ChatError('The restricted report requires a valid bounded creation-date range.') from None
        data = self._execute(operation, params)
        rows = data.get('contacts') if isinstance(data, dict) else None
        if not isinstance(rows, list) or any(not isinstance(row, dict) or row.get('locationId') != self.location for row in rows):
            raise ChatError('GHL did not return explicit matching location IDs for every contact. The restricted report was blocked; no count is available.')
        return data

    def _execute(self, operation, params, *, key=None, reason=''):
        args = {'operationId': operation['operationId'], 'params': bind_params(operation, params, self.location), 'locationId': self.location}
        if key:
            args.update(idempotencyKey=key, reason=reason[:500])
        result = self.call('execute_operation', args, operation['operationId'])
        data = result.get('data')
        if not isinstance(data, (dict, list)):
            raise ChatError('GHL returned an unsupported data envelope.')
        check_location(data, self.location)
        return data
