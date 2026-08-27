import hashlib
import json
import time
from datetime import timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.utils import timezone
from django.utils.module_loading import import_string
from rest_framework.exceptions import PermissionDenied

from . import ai
from .exports import build_exports
from .models import Audit, Execution, Run
from .permissions import authorize
from .reporting import new_contacts
from .transport import ChatError, LiveGateway, bind_params, needs_confirmation, redact


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), default=str).encode()).hexdigest()


def audit(run, event, detail=None):
    return Audit.objects.create(account=run.conversation.account, actor=run.conversation.owner,
                                run=run, event=event, detail=detail or {})


def current_revision(account):
    if account.synthetic:
        return 'synthetic-v1'
    try:
        account.client.refresh_from_db()
        from projects.models import GhlConnection
        return str(GhlConnection.objects.get(client_id=account.client_id).revision)
    except Exception:
        raise ChatError('The GHL connection was removed. Reconnect and start a new request.') from None


def gateway_for(account):
    if account.synthetic:
        if not getattr(settings, 'GHL_CHAT_ALLOW_SYNTHETIC', False) or not getattr(settings, 'GHL_CHAT_SYNTHETIC_GATEWAY', ''):
            raise ChatError('Synthetic accounts are disabled in this installation.')
        return import_string(settings.GHL_CHAT_SYNTHETIC_GATEWAY)(account)
    return LiveGateway(account)


def check_access(run, *, write=False, revision=None):
    owner = get_user_model().objects.get(pk=run.conversation.owner_id)
    account = run.conversation.account
    authorize(owner, account, write=write)
    if revision and current_revision(account) != revision:
        raise ChatError('The account connection changed. This request is no longer authorized; ask again.')


def finish(run, status='done'):
    check_access(run)
    run.status = status
    run.finished_at = timezone.now()
    if run.account_snapshot.get('synthetic'):
        marker = 'Synthetic demo only. No live GHL account was queried or modified.'
        if marker not in run.limitations:
            run.limitations.insert(0, marker)
        run.answer = run.answer.replace('GHL reported', 'The synthetic simulator reported').replace('GHL confirmed', 'The synthetic simulator confirmed')
    if run.account_snapshot.get('restricted_read'):
        marker = 'Restricted read mode: GHL could not establish a complete single-location token grant. Only the fixed location-scoped new-contact date report is enabled; all generic operations and mutations are blocked.'
        if marker not in run.limitations:
            run.limitations.insert(0, marker)
    build_exports(run)
    run.save()
    audit(run, status, {'rows': len(run.rows), 'evidence_count': len(run.evidence)})


def compact_operation(op):
    keys = ('operationId', 'domain', 'summary', 'description', 'method', 'path', 'requiredScopes', 'kind',
            'readOnlyHint', 'destructiveHint', 'requiresApproval', 'idempotencyRequired',
            'parameters', 'requestBodyFields', 'payloadExample', 'responseProjection')
    return {k: v for k, v in op.items() if k in keys}


def append_result(run, op, params, data):
    data = redact(data)
    if isinstance(data, list):
        rows = data
    else:
        projection = op.get('responseProjection') or {}
        key = projection.get('collectionKey') if isinstance(projection, dict) else None
        rows = data.get(key) if key else None
        if not isinstance(rows, list):
            arrays = [v for v in data.values() if isinstance(v, list)]
            rows = arrays[0] if len(arrays) == 1 else [data]
    rows = [r if isinstance(r, dict) else {'value': r} for r in rows]
    if len(run.rows) + len(rows) > 2000 or len(json.dumps(run.rows + rows)) > 2_000_000:
        raise ChatError('The result exceeds the 2,000-row / 2 MB conversation limit. Use a narrower query.')
    run.rows.extend(rows)
    run.evidence.append({'operationId': op['operationId'], 'method': op.get('method'), 'path': op.get('path'),
                         'params': params, 'returned': len(rows), 'captured_at': timezone.now().isoformat()})
    run.limitations.append('Generic operation results contain only returned pages. Pagination, totals and account-wide completeness have not been verified. Row counts are not lead totals.')
    return {'operationId': op['operationId'], 'rows': rows[:20], 'returned': len(rows), 'sample_truncated': len(rows) > 20,
            'limitations': run.limitations[-1:]}


def ask(run):
    account = run.conversation.account
    check_access(run)
    gateway = gateway_for(account)
    revision = gateway.revision
    try:
        account_now = timezone.now().astimezone(ZoneInfo(gateway.timezone))
    except (ValueError, TypeError, ZoneInfoNotFoundError):
        raise ChatError('The account timezone is invalid. Ask an administrator to repair the connection timezone.') from None
    run.account_snapshot = {'id': account.pk, 'name': account.client.name, 'location_id': gateway.location,
                            'timezone': gateway.timezone, 'synthetic': account.synthetic,
                            'restricted_read': bool(getattr(gateway, 'restricted_read', False)),
                            'current_date': account_now.date().isoformat(), 'account_now': account_now.isoformat()}
    run.save(update_fields=['account_snapshot'])
    history = [{'question': r.question, 'answer': r.answer[:3000], 'status': r.status}
               for r in reversed(list(run.conversation.runs.exclude(pk=run.pk).order_by('-created_at')[:8]))]
    discovered, described, results = {}, {}, []
    deadline = time.monotonic() + 150

    def checkpoint(write=False):
        if time.monotonic() > deadline:
            raise ChatError('The query time limit was reached. Narrow the request; saved evidence may be incomplete.')
        check_access(run, write=write, revision=revision)

    for _ in range(6):
        checkpoint()
        if account.synthetic and hasattr(gateway, 'next_step'):
            step = gateway.next_step(run.question, history, list(described.values()) or list(discovered.values()), results)
        else:
            step = ai.next_step(run.question, history, list(described.values()) or list(discovered.values()), results, run.account_snapshot)
        run.plan.update({k: str(step[k])[:1000] for k in ('action', 'start_date', 'end_date', 'operation_id') if step.get(k)})
        action = step.get('action')
        if action == 'answer':
            run.answer = str(step.get('answer') or 'Please clarify the requested operation.')[:12000]
            # An AI-only answer without operation evidence cannot be a claim of execution.
            if not run.evidence:
                run.limitations.append('No GHL operation was executed for this response. This is a clarification or catalogue explanation, not verified account data.')
            finish(run)
            return
        if action == 'search':
            checkpoint()
            query = str(step.get('query') or run.question)[:2048]
            rows = gateway.search(query)
            discovered.update({r['operationId']: compact_operation(r) for r in rows if isinstance(r, dict) and r.get('operationId')})
            audit(run, 'catalogue_search', {'query': query, 'operation_ids': list(discovered)})
            results.append({'search': query, 'operations': list(discovered.values()), 'note': 'Only catalogue discovery; no customer data queried.'})
            continue
        if action == 'new_contacts':
            operation_id = 'search-contacts-advanced'
            if operation_id not in discovered:
                rows = gateway.search('search contacts advanced dateAdded')
                discovered.update({r['operationId']: compact_operation(r) for r in rows if isinstance(r, dict) and r.get('operationId')})
            if operation_id not in discovered:
                raise ChatError('New-contact search is not available to this connection. Nothing was counted.')
            op = compact_operation(gateway.describe(operation_id))
            run.answer, run.rows, run.evidence, run.limitations = new_contacts(gateway, op, step.get('start_date'), step.get('end_date'), checkpoint)
            finish(run)
            return
        if action != 'execute':
            raise ChatError('The AI proposed an unsupported action; nothing was executed.')
        if getattr(gateway, 'restricted_read', False):
            raise ChatError('Restricted read mode: GHL could not establish a complete single-location token grant. Ask for new contacts created between explicit dates. Generic operations and all mutations are blocked.')
        operation_id = step.get('operation_id')
        if operation_id not in discovered:
            raise ChatError('The proposed operation was not discovered in this account. Nothing was executed.')
        op = compact_operation(gateway.describe(operation_id))
        described[operation_id] = op
        # Feed full input contract back to the AI before accepting its parameters.
        if not any(r.get('described') == operation_id for r in results):
            results.append({'described': operation_id, 'operation': op})
            continue
        try:
            params = bind_params(op, json.loads(step.get('params_json') or '{}'), gateway.location)
        except (ValueError, TypeError):
            raise ChatError('The AI proposed invalid operation parameters. Please clarify the inputs.') from None
        if needs_confirmation(op):
            checkpoint(write=True)
            proposal = {'operation': op, 'params': params, 'connection_revision': revision,
                        'account_id': account.pk, 'location_id': gateway.location,
                        'expires_at': (timezone.now() + timedelta(minutes=15)).isoformat()}
            proposal['hash'] = digest(proposal)
            run.proposal = proposal
            run.status = 'awaiting_confirmation'
            run.answer = 'Review the exact account, operation and parameters below. No mutation has been executed. Confirm only if they match your intent.'
            run.save()
            audit(run, 'confirmation_requested', {'proposal_hash': proposal['hash'], 'operationId': operation_id})
            return
        checkpoint()
        data = gateway.execute(op, params)
        results.append(append_result(run, op, params, data))
        audit(run, 'read_completed', {'operationId': operation_id, 'rows': len(run.rows)})
        run.save(update_fields=['evidence', 'rows', 'limitations', 'plan'])
    run.answer = 'The bounded operation budget was reached. Review the saved evidence and ask a narrower follow-up.'
    run.limitations.append('Stopped after six planning steps; the requested workflow may be incomplete.')
    finish(run)


def execute_confirmed(run):
    proposal = run.proposal
    check_access(run, write=True, revision=proposal.get('connection_revision'))
    # Approval expires even when the worker was offline at confirmation time.
    from django.utils.dateparse import parse_datetime
    expiry = parse_datetime(proposal.get('expires_at', ''))
    if not expiry or timezone.is_naive(expiry) or timezone.now() >= expiry:
        raise ChatError('Confirmation expired before execution. Ask again to review a fresh operation.')
    gateway = gateway_for(run.conversation.account)
    if getattr(gateway, 'restricted_read', False):
        raise ChatError('The connection is now in restricted read mode. The approved mutation was not executed.')
    if (gateway.revision != proposal.get('connection_revision') or gateway.location != proposal.get('location_id')
            or proposal.get('account_id') != run.conversation.account_id):
        raise ChatError('The approved account or connection changed. Nothing was executed; ask again.')
    op = compact_operation(gateway.describe(proposal['operation']['operationId']))
    if op != proposal['operation']:
        raise ChatError('The operation contract changed after approval. Nothing was executed; ask again.')
    if digest({k: v for k, v in proposal.items() if k != 'hash'}) != proposal.get('hash'):
        raise ChatError('The approved proposal changed. Nothing was executed.')
    params = bind_params(op, proposal['params'], gateway.location)
    fingerprint = digest({'account': run.conversation.account_id, 'revision': gateway.revision,
                          'operation': op['operationId'], 'params': params})
    try:
        with transaction.atomic():
            Execution.objects.create(run=run, fingerprint=fingerprint)
            audit(run, 'execution_claimed', {'operationId': op['operationId'], 'proposal_hash': proposal['hash']})
    except IntegrityError:
        raise ChatError('An identical mutation has already been claimed. Inspect its audit/result before attempting another operation.') from None
    # No application or SDK retries around this boundary. A lost response can
    # mean a completed mutation; the receipt must survive failures and restarts.
    check_access(run, write=True, revision=gateway.revision)
    data = gateway.execute(op, params, key=str(run.pk), reason=run.question)
    append_result(run, op, params, data)
    run.answer = f"GHL confirmed {op['operationId']} succeeded for {run.account_snapshot['name']}. Review the returned evidence."
    finish(run)


def process_run(run_id):
    run = Run.objects.select_related('conversation__account__client', 'conversation__owner').get(pk=run_id)
    original = run.status
    if original not in ('queued', 'execute_queued'):
        return
    active = 'executing' if original == 'execute_queued' else 'running'
    if not Run.objects.filter(pk=run_id, status=original).update(status=active, started_at=timezone.now()):
        return
    run.status, run.started_at = active, timezone.now()
    try:
        audit(run, active)
        execute_confirmed(run) if active == 'executing' else ask(run)
    except Exception as exc:
        run.status = 'unknown' if Execution.objects.filter(run=run).exists() else 'failed'
        run.answer = str(exc) if isinstance(exc, (ChatError, PermissionDenied)) else 'The background job failed safely. Ask an administrator to inspect the worker; no result count is available.'
        if run.status == 'unknown':
            run.answer = 'Mutation outcome is uncertain. It may have completed in GHL. Do not repeat it; reconcile the account using this run ID and its audit trail.'
        run.finished_at = timezone.now()
        run.save()
        audit(run, run.status, {'error_type': type(exc).__name__})
