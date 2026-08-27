import uuid

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Exists, OuterRef
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.decorators import api_view
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from projects.models import GhlConnection
from .models import Account, Audit, Conversation, Grant, Run
from .permissions import accounts_for, authorize
from .services import audit, current_revision, digest
from .transport import ChatError


def manager(user):
    if not user.is_active or user.deleted_at or not user.is_manager:
        raise PermissionDenied('Administrator access is required.')


def account_payload(account, user):
    try:
        connection = account.client.ghl_connection
    except GhlConnection.DoesNotExist:
        connection = None
    return {'id': account.pk, 'name': account.client.name, 'synthetic': account.synthetic,
            'location_id': connection.location_id if connection else ('demo-' + str(account.pk) if account.synthetic else ''),
            'timezone': (connection.business_details.get('timezone') if connection else '') or account.timezone,
            'can_execute': user.is_manager or (account.execute_granted if hasattr(account, 'execute_granted')
                                                else account.grants.filter(user=user, can_execute=True).exists())}


@api_view(['GET', 'POST'])
def accounts(request):
    if request.method == 'POST':
        manager(request.user)
        connection = get_object_or_404(GhlConnection, client_id=request.data.get('client_id'), client__is_active=True)
        account, _ = Account.objects.get_or_create(client=connection.client, defaults={'timezone': connection.business_details.get('timezone') or 'UTC'})
        if not account.enabled:
            account.enabled = True
            account.save(update_fields=['enabled'])
        Audit.objects.create(account=account, actor=request.user, event='account_enabled')
        return Response(account_payload(account, request.user), status=201)
    available = accounts_for(request.user).select_related('client__ghl_connection').defer('client__ghl_connection__encrypted_token').annotate(
        execute_granted=Exists(Grant.objects.filter(account_id=OuterRef('pk'), user=request.user, can_execute=True)))
    payload = {'accounts': [account_payload(a, request.user) for a in available],
               'manager': request.user.is_manager, 'connections': [], 'staff': []}
    if request.user.is_manager:
        manager(request.user)
        payload['connections'] = [{'client_id': c.client_id, 'name': c.client.name, 'location_id': c.location_id}
                                  for c in GhlConnection.objects.filter(client__is_active=True).select_related('client')]
        payload['staff'] = [{'id': u.pk, 'name': u.display_name} for u in get_user_model().objects.filter(is_active=True, deleted_at__isnull=True)]
    return Response(payload)


@api_view(['GET', 'POST'])
def grants(request, account_id):
    manager(request.user)
    account = get_object_or_404(accounts_for(request.user), pk=account_id)
    if request.method == 'POST':
        user = get_object_or_404(get_user_model(), pk=request.data.get('user_id'), is_active=True, deleted_at__isnull=True)
        if type(request.data.get('can_execute', False)) is not bool or type(request.data.get('revoke', False)) is not bool:
            raise ValidationError('Permission flags must be booleans.')
        with transaction.atomic():
            if request.data.get('revoke'):
                Grant.objects.filter(account=account, user=user).delete()
            else:
                Grant.objects.update_or_create(account=account, user=user, defaults={'can_execute': request.data.get('can_execute', False)})
            Audit.objects.create(account=account, actor=request.user, event='grant_revoked' if request.data.get('revoke') else 'grant_saved',
                                 detail={'user_id': user.pk, 'can_execute': request.data.get('can_execute', False)})
    return Response({'grants': [{'user_id': g.user_id, 'name': g.user.display_name, 'can_execute': g.can_execute}
                                for g in account.grants.select_related('user')]})


def conversation_payload(conversation):
    return {'id': str(conversation.pk), 'account_id': conversation.account_id, 'title': conversation.title,
            'created_at': conversation.created_at.isoformat()}


def run_payload(run):
    payload = {k: getattr(run, k) for k in ('question', 'status', 'answer', 'plan', 'proposal', 'evidence', 'limitations',
                                             'account_snapshot', 'created_at', 'started_at', 'finished_at', 'export_error')}
    payload.update(id=str(run.pk), rows=run.row_preview, row_count=run.row_count, rows_truncated=run.row_count > 100,
                   csv_url=f'/api/portal/ghl-chat/runs/{run.pk}/export/csv/' if run.csv_available else None,
                   pdf_url=f'/api/portal/ghl-chat/runs/{run.pk}/export/pdf/' if run.pdf_available else None)
    return payload


def own_conversations(user):
    return Conversation.objects.filter(owner=user, account__in=accounts_for(user)).select_related('account__client', 'owner')


def own_run(user, run_id):
    return get_object_or_404(Run.objects.defer('rows', 'csv_data', 'pdf').select_related('conversation__account__client', 'conversation__owner'),
                             pk=run_id, conversation__in=own_conversations(user))


@api_view(['GET', 'POST'])
def conversations(request):
    if request.method == 'POST':
        account = get_object_or_404(accounts_for(request.user), pk=request.data.get('account_id'))
        title = request.data.get('title') or 'New conversation'
        if not isinstance(title, str):
            raise ValidationError('Title must be text.')
        conversation = Conversation.objects.create(account=account, owner=request.user, title=title[:160])
        return Response(conversation_payload(conversation), status=201)
    return Response({'conversations': [conversation_payload(c) for c in own_conversations(request.user).order_by('-created_at')[:100]]})


@api_view(['GET'])
def conversation_detail(request, conversation_id):
    conversation = get_object_or_404(own_conversations(request.user), pk=conversation_id)
    payload = conversation_payload(conversation)
    try:
        page = int(request.query_params.get('page', '1'))
        if not 1 <= page <= 4:
            raise ValueError()
    except ValueError:
        raise ValidationError('Page must be an integer from 1 through 4.') from None
    count = conversation.runs.count()
    runs = conversation.runs.defer('rows', 'csv_data', 'pdf').order_by('-created_at', '-id')[(page - 1) * 25:page * 25]
    payload['runs'] = [run_payload(r) for r in reversed(list(runs))]
    payload.update(run_count=count, page=page, has_more=page * 25 < count)
    return Response(payload)


@api_view(['POST'])
def messages(request, conversation_id):
    question = request.data.get('question')
    if not isinstance(question, str) or not question.strip() or len(question) > 8000:
        raise ValidationError('Question must contain 1-8,000 characters.')
    try:
        key = uuid.UUID(str(request.data.get('request_key')))
    except (TypeError, ValueError):
        raise ValidationError('A UUID request_key is required for safe retries.') from None
    with transaction.atomic():
        conversation = get_object_or_404(own_conversations(request.user).select_for_update(of=('self',)), pk=conversation_id)
        existing = conversation.runs.filter(request_key=key).first()
        if existing:
            if existing.question != question.strip():
                raise ValidationError('This request_key belongs to a different question.')
            return Response(run_payload(existing))
        if conversation.runs.filter(status__in=['queued', 'running', 'awaiting_confirmation', 'execute_queued', 'executing']).exists():
            return Response({'detail': 'Wait for the current run, or reject its pending confirmation.'}, status=409)
        if conversation.runs.count() >= 100:
            raise ValidationError('This conversation reached 100 turns. Start a new conversation.')
        if Run.objects.filter(conversation__owner=request.user, status__in=['queued', 'running', 'execute_queued', 'executing']).count() >= 3:
            return Response({'detail': 'You already have three queued or running jobs.'}, status=429)
        run = Run.objects.create(conversation=conversation, request_key=key, question=question.strip())
        if conversation.title == 'New conversation':
            conversation.title = question.strip()[:160]
            conversation.save(update_fields=['title'])
        audit(run, 'queued')
    return Response(run_payload(run), status=202)


@api_view(['GET'])
def run_detail(request, run_id):
    return Response(run_payload(own_run(request.user, run_id)))


@api_view(['POST'])
def confirm(request, run_id):
    with transaction.atomic():
        permitted = own_run(request.user, run_id)
        run = Run.objects.select_for_update().get(pk=permitted.pk)
        if run.status != 'awaiting_confirmation':
            return Response({'detail': 'This proposal is no longer awaiting confirmation.'}, status=409)
        decision = request.data.get('decision')
        if decision not in ('approve', 'reject'):
            raise ValidationError('Choose approve or reject.')
        proposal = run.proposal
        if request.data.get('proposal_hash') != proposal.get('hash') or digest({k: v for k, v in proposal.items() if k != 'hash'}) != proposal.get('hash'):
            raise ValidationError('The proposal changed. Reload and review the exact current operation.')
        if decision == 'approve':
            authorize(request.user, run.conversation.account, write=True)
            expiry = parse_datetime(proposal.get('expires_at', ''))
            if not expiry or timezone.is_naive(expiry) or timezone.now() >= expiry:
                raise ValidationError('The confirmation expired. Reject it and ask again.')
            try:
                revision = current_revision(run.conversation.account)
            except ChatError as exc:
                raise ValidationError(str(exc)) from None
            if revision != proposal.get('connection_revision'):
                raise ValidationError('The connection changed. Reject this proposal and ask again.')
            run.status = 'execute_queued'
        else:
            run.status = 'rejected'
            run.answer = 'You rejected this operation. No mutation was executed.'
            run.finished_at = timezone.now()
        run.save(update_fields=['status', 'answer', 'finished_at'])
        audit(run, 'approved' if decision == 'approve' else 'rejected', {'proposal_hash': proposal['hash']})
    return Response(run_payload(run), status=202 if decision == 'approve' else 200)


@api_view(['GET'])
def export(request, run_id, kind):
    run = own_run(request.user, run_id)
    # Only load the requested artifact after authorizing ownership and grants.
    data = run.csv_data if kind == 'csv' else run.pdf if kind == 'pdf' else None
    if not data:
        return Response({'detail': 'This export has not been generated.'}, status=409)
    audit(run, 'export_downloaded', {'format': kind})
    response = HttpResponse(bytes(data) if kind == 'pdf' else data, content_type='application/pdf' if kind == 'pdf' else 'text/csv; charset=utf-8')
    response['Content-Disposition'] = f'attachment; filename="ghl-report-{run.pk}.{kind}"'
    response['Cache-Control'] = 'private, no-store'
    response['X-Content-Type-Options'] = 'nosniff'
    return response


@api_view(['GET'])
def audit_log(request, account_id):
    manager(request.user)
    account = get_object_or_404(accounts_for(request.user), pk=account_id)
    return Response({'events': list(Audit.objects.filter(account=account).order_by('-created_at').values('id', 'actor_id', 'run_id', 'event', 'detail', 'created_at')[:200])})
