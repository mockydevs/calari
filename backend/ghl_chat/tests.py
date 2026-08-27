"""No live credentials or network: regression coverage for the chat boundary."""
import copy
import csv
import io
import json
import uuid
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied
from rest_framework.test import APIClient

from projects.models import Clients, GhlConnection
from . import ai, services
from .exports import build_exports, csv_cell, render_csv, render_pdf
from .models import Account, Audit, Conversation, Execution, Grant, Run
from .permissions import accounts_for
from .reporting import date_window, new_contacts
from .tasks import drain_chat
from .transport import (ChatError, LiveGateway, bind_params, check_location,
                        needs_confirmation, redact, unpack, verify_single_location)
from .views import run_payload


def operation(operation_id='search-contacts-advanced', write=False):
    return {
        'operationId': operation_id, 'domain': 'contacts', 'method': 'POST',
        'path': '/contacts/search', 'kind': 'write' if write else 'read',
        'readOnlyHint': not write, 'destructiveHint': False,
        'requiresApproval': write, 'idempotencyRequired': write,
        'requiredScopes': ['contacts.write' if write else 'contacts.readonly'],
        'parameters': [],
        'requestBodyFields': [{'name': name, 'required': name == 'locationId'}
                              for name in ('locationId', 'pageLimit', 'filters', 'sort', 'searchAfter', 'name')],
    }


def step(action, **kwargs):
    return {'action': action, **kwargs}


class BoundaryTests(SimpleTestCase):
    @override_settings(SETTINGS_MODULE='config.settings_local')
    def test_local_worker_once_drains_without_sleeping(self):
        with patch('ghl_chat.management.commands.run_ghl_chat.drain_chat') as drain, patch('ghl_chat.management.commands.run_ghl_chat.time.sleep') as sleep:
            call_command('run_ghl_chat', once=True)
        drain.assert_called_once_with()
        sleep.assert_not_called()

    @override_settings(SETTINGS_MODULE='config.settings')
    def test_local_worker_refuses_production_settings(self):
        with patch('ghl_chat.management.commands.run_ghl_chat.drain_chat') as drain:
            with self.assertRaises(CommandError):
                call_command('run_ghl_chat', once=True)
        drain.assert_not_called()

    def test_success_envelopes_and_negative_results(self):
        payload = {'success': True, 'status': 200, 'operationId': 'op', 'data': {'contacts': [], 'total': 0}}
        for envelope in ({'structuredContent': payload}, {'content': [{'type': 'text', 'text': json.dumps(payload)}]}):
            self.assertEqual(unpack(envelope, 'op'), payload)
        for payload in ({'success': False}, {'error': 'secret'}, {'success': True, 'status': 422, 'operationId': 'op'},
                        {'success': True, 'status': 200, 'operationId': 'another'}, {'success': True, 'status': True}):
            with self.subTest(payload=payload), self.assertRaises(ChatError):
                unpack({'structuredContent': payload}, 'op')
        with self.assertRaises(ChatError):
            unpack({'isError': True, 'content': [{'type': 'text', 'text': 'SECRET'}]})

    def test_location_grants_must_be_single_complete_and_matching(self):
        for result in ({'locations': [{'id': 'loc'}]}, {'data': {'locations': [{'locationId': 'loc'}], 'total': 1}}):
            verify_single_location(result, 'loc')
        for result in ({}, {'locations': [{'id': 'other'}]}, {'locations': []},
                       {'locations': [{'id': 'loc'}, {'id': 'other'}]},
                       {'locations': [{'id': 'loc'}], 'nextPageToken': 'more'},
                       {'data': {'locations': [{'id': 'loc'}], 'meta': {'hasMore': True}}},
                       {'locations': [{'id': 'loc'}], 'total': 2}):
            with self.subTest(result=result), self.assertRaises(ChatError):
                verify_single_location(result, 'loc')

    def test_pit_location_service_failure_is_not_a_successful_empty_grant(self):
        with self.assertRaises(ChatError):
            unpack({'structuredContent': {'success': False, 'error': 'upstream error', 'status': 500}})

    def test_mutation_classification_fails_closed_on_every_missing_flag(self):
        self.assertFalse(needs_confirmation(operation()))
        self.assertTrue(needs_confirmation(operation(write=True)))
        for key in ('kind', 'readOnlyHint', 'requiresApproval', 'destructiveHint', 'idempotencyRequired', 'method'):
            op = operation()
            op.pop(key)
            self.assertTrue(needs_confirmation(op), key)
        for method in ('DELETE', 'PUT', 'PATCH'):
            self.assertTrue(needs_confirmation({**operation(), 'method': method}))

    def test_nested_cross_location_ids_are_rejected(self):
        check_location({'contacts': [{'locationId': 'loc'}]}, 'loc')
        for value in ({'body': {'location_id': 'other'}}, {'rows': [{'locationIds': ['loc', 'other']}]}):
            with self.assertRaises(ChatError):
                check_location(value, 'loc')

    def test_parameter_binding_and_required_fields(self):
        op = operation()
        bound = bind_params(op, {'body': {'name': 'Demo'}}, 'loc')
        self.assertEqual(bound['body']['locationId'], 'loc')
        op['parameters'] = [{'in': 'path', 'name': 'contactId', 'required': True}]
        for params in ({}, {'path': {'contactId': ''}}, {'path': {'contactId': None}}):
            with self.assertRaises(ChatError):
                bind_params(op, params, 'loc')
        self.assertEqual(bind_params(op, {'path': {'contactId': 'id'}}, 'loc')['path']['contactId'], 'id')

    def test_headers_global_scope_undocumented_inputs_and_wrong_account_blocked(self):
        for params in ({'headers': {'Authorization': 'secret'}}, {'query': {'companyId': 'agency'}},
                       {'body': {'locationId': 'other'}}, {'query': {'url': 'https://attacker.example'}},
                       {'body': {'unknown': 'value'}}, {'path': []}):
            with self.subTest(params=params), self.assertRaises(ChatError):
                bind_params(operation(), params, 'loc')
        with self.assertRaises(ChatError):
            bind_params({**operation(), 'domain': 'oauth'}, {}, 'loc')
        for op in ({**operation(), 'requestBodyFields': None}, {**operation(), 'path': 'https://attacker.example'}):
            with self.assertRaises(ChatError):
                bind_params(op, {}, 'loc')

    def test_contact_catalogue_omits_server_owned_location_body_field(self):
        op = operation()
        op['requestBodyFields'] = [field for field in op['requestBodyFields'] if field['name'] != 'locationId']
        self.assertEqual(bind_params(op, {'body': {'pageLimit': 100}}, 'loc')['body'],
                         {'pageLimit': 100, 'locationId': 'loc'})
        with self.assertRaises(ChatError):
            bind_params(op, {'body': {'locationId': 'other'}}, 'loc')
        for altered in ({**op, 'operationId': 'another'}, {**op, 'path': '/other'}, {**op, 'method': 'PUT'}):
            with self.assertRaises(ChatError):
                bind_params(altered, {'body': {'locationId': 'loc'}}, 'loc')

    def test_sensitive_keys_and_echoed_credentials_are_redacted(self):
        result = redact({'access_token': 'secret', 'children': [{'note': 'echo pit-private', 'password': 'pwd'}],
                         'error': 'Bearer abcdef'}, ('pit-private',))
        text = json.dumps(result)
        for forbidden in ('secret', 'pit-private', 'pwd', 'abcdef'):
            self.assertNotIn(forbidden, text)

    def test_gateway_uses_only_fixed_host_and_checks_token_location(self):
        conn = SimpleNamespace(location_id='loc', revision='revision')
        account = SimpleNamespace(client=SimpleNamespace(ghl_connection=conn))
        schemas = {name: {'type': 'object', 'properties': {}} for name in
                   ('search_operations', 'describe_operation', 'execute_operation', 'list_locations')}
        with patch('ghl_chat.transport.connection_token', return_value='pit-private'), \
                patch('ghl_chat.transport.location_details', return_value={'timezone': 'UTC'}), \
                patch('ghl_chat.transport.Client') as client:
            client.return_value.discover.return_value = schemas
            client.return_value.rpc.return_value = {'structuredContent': {'locations': [{'id': 'loc'}]}}
            gateway = LiveGateway(account)
            self.assertEqual(gateway.client.url, 'https://services.leadconnectorhq.com/mcp/anthropic/v2')
            client.return_value.rpc.return_value = {'structuredContent': {'locations': [{'id': 'other'}]}}
            with self.assertRaises(ChatError):
                LiveGateway(account)

    def test_provider_failure_is_sanitized(self):
        with patch('ghl_chat.ai._chat', side_effect=RuntimeError('sk-secret with customer details')):
            with self.assertRaises(ChatError) as error:
                ai.next_step('Question', [], [], [], {})
            self.assertNotIn('sk-secret', str(error.exception))

    def restricted_gateway(self):
        gateway = LiveGateway.__new__(LiveGateway)
        gateway.location, gateway.timezone, gateway.restricted_read = 'loc', 'UTC', True
        gateway._execute = Mock(return_value={'contacts': [{'id': 'one', 'locationId': 'loc'}], 'total': 1})
        return gateway

    def report_params(self):
        return {'body': {'locationId': 'loc', 'pageLimit': 100,
                         'sort': [{'field': 'dateAdded', 'direction': 'desc'}],
                         'filters': [{'field': 'dateAdded', 'operator': 'range',
                                      'value': {'gte': '2026-01-01T00:00:00Z', 'lte': '2026-01-31T23:59:59Z'}}]}}

    def test_restricted_mode_only_executes_pinned_scoped_date_report(self):
        gateway = self.restricted_gateway()
        with self.assertRaises(ChatError):
            gateway.execute(operation(), self.report_params())
        gateway._execute.assert_not_called()
        self.assertEqual(gateway.execute_contact_report(operation(), self.report_params())['total'], 1)
        gateway._execute.assert_called_once()

    def test_restricted_mode_rejects_unscoped_rows_and_unbounded_or_arbitrary_queries(self):
        gateway = self.restricted_gateway()
        for result in ({'contacts': [{'id': 'one'}]}, {'contacts': [{'locationId': 'other'}]}, {'error': 'oops'}):
            gateway._execute.return_value = result
            with self.assertRaises(ChatError):
                gateway.execute_contact_report(operation(), self.report_params())
        for body_patch in ({'locationId': 'other'}, {'pageLimit': 1}, {'filters': []},
                           {'filters': [{'field': 'email', 'operator': 'eq', 'value': 'someone@example.com'}]},
                           {'contactId': 'another-account-id'}):
            params = self.report_params()
            params['body'].update(body_patch)
            gateway._execute.reset_mock()
            with self.assertRaises(ChatError):
                gateway.execute_contact_report(operation(), params)
            gateway._execute.assert_not_called()
        for op in ({**operation(), 'path': '/other'}, operation('arbitrary'), operation(write=True)):
            with self.assertRaises(ChatError):
                gateway.execute_contact_report(op, self.report_params())

    def test_failed_location_listing_enters_restricted_mode_not_generic_access(self):
        account = SimpleNamespace(client=SimpleNamespace(ghl_connection=SimpleNamespace(location_id='loc', revision='r')))
        names = ('search_operations', 'describe_operation', 'execute_operation', 'list_locations')
        with patch('ghl_chat.transport.connection_token', return_value='pit-test'), \
                patch('ghl_chat.transport.location_details', return_value={'timezone': 'UTC'}), \
                patch('ghl_chat.transport.Client') as client:
            client.return_value.discover.return_value = {name: {'type': 'object', 'properties': {}} for name in names}
            client.return_value.rpc.return_value = {'structuredContent': {'success': False, 'error': 'upstream', 'status': 500}}
            gateway = LiveGateway(account)
            self.assertTrue(gateway.restricted_read)
            with self.assertRaises(ChatError):
                gateway.execute(operation(), {})

    def test_provider_context_and_contract_are_bounded(self):
        with patch('ghl_chat.ai._chat', return_value=json.dumps({'action': 'answer', 'answer': 'Clarify'})) as call:
            self.assertEqual(ai.next_step('Question', [], [], [], {})['action'], 'answer')
            self.assertEqual(call.call_args.kwargs['op'], 'ghl_chat')
            self.assertEqual(call.call_args.kwargs['timeout'], 25)
            with self.assertRaises(ChatError):
                ai.next_step('X' * 100001, [], [], [], {})
            self.assertEqual(call.call_count, 1)


class ContactReportTests(SimpleTestCase):
    def gateway(self, pages):
        return SimpleNamespace(location='loc', timezone='America/New_York', execute=Mock(side_effect=pages))

    def row(self, index=1, **extra):
        return {'id': str(index), 'dateAdded': '2026-03-08T14:00:00Z', 'locationId': 'loc', **extra}

    def test_date_window_uses_account_dst_and_inclusive_days(self):
        first, stop = date_window('2026-03-08', '2026-03-08', 'America/New_York')
        self.assertEqual(first.isoformat(), '2026-03-08T05:00:00+00:00')
        self.assertEqual(stop.isoformat(), '2026-03-09T04:00:00+00:00')
        self.assertEqual((stop - first).total_seconds(), 23 * 3600)
        for first, end, zone in [('2026-03-09', '2026-03-08', 'UTC'), ('2020-01-01', '2026-01-01', 'UTC'),
                                  ('bad', '2026-03-08', 'UTC'), ('2026-03-08', '2026-03-08', 'Bad/Zone'),
                                  ('9999-12-31', '9999-12-31', 'UTC')]:
            with self.assertRaises(ChatError):
                date_window(first, end, zone)

    def test_new_contacts_reconciles_rows_and_sends_range_filter(self):
        gateway = self.gateway([{'contacts': [self.row()], 'total': 1}])
        answer, rows, evidence, limits = new_contacts(gateway, operation(), '2026-03-08', '2026-03-08')
        self.assertTrue(answer.startswith('1 new contacts'))
        self.assertEqual(len(rows), 1)
        self.assertEqual(evidence[0]['reported_total'], 1)
        self.assertIn('not new opportunities', limits[-1])
        body = gateway.execute.call_args.args[1]['body']
        self.assertEqual(body['filters'][0]['operator'], 'range')
        self.assertEqual(body['filters'][0]['value']['gte'], '2026-03-08T05:00:00+00:00')
        self.assertEqual(body['filters'][0]['value']['lte'], '2026-03-09T03:59:59.999000+00:00')

    def test_zero_only_when_server_succeeded_and_total_reconciles(self):
        answer, rows, _, _ = new_contacts(self.gateway([{'contacts': [], 'total': 0}]), operation(), '2026-03-08', '2026-03-08')
        self.assertTrue(answer.startswith('0 new contacts'))
        self.assertEqual(rows, [])
        with self.assertRaises(ChatError):
            new_contacts(self.gateway([ChatError('non-success')]), operation(), '2026-03-08', '2026-03-08')

    def test_no_fabricated_pagination_cursor(self):
        gateway = self.gateway([{'contacts': [self.row()], 'total': 2}])
        answer, _, _, limits = new_contacts(gateway, operation(), '2026-03-08', '2026-03-08')
        self.assertTrue(answer.startswith('At least 1'))
        self.assertTrue(any('no supported searchAfter' in item for item in limits))
        self.assertEqual(gateway.execute.call_count, 1)

    def test_explicit_pagination_cursor_preserved(self):
        calls = []
        pages = iter([{'contacts': [self.row()], 'total': 2, 'searchAfter': ['opaque', 7]},
                      {'contacts': [self.row(2)], 'total': 2}])
        gateway = self.gateway([])
        gateway.execute.side_effect = lambda op, params: (calls.append(copy.deepcopy(params)), next(pages))[1]
        answer, rows, _, _ = new_contacts(gateway, operation(), '2026-03-08', '2026-03-08')
        self.assertTrue(answer.startswith('2 new contacts'))
        self.assertNotIn('searchAfter', calls[0]['body'])
        self.assertEqual(calls[1]['body']['searchAfter'], ['opaque', 7])
        self.assertEqual(len(rows), 2)

    def test_duplicate_records_and_repeated_cursor_mark_partial(self):
        gateway = self.gateway([{'contacts': [self.row()], 'total': 3, 'searchAfter': 'same'},
                                {'contacts': [self.row()], 'total': 3, 'searchAfter': 'same'}])
        answer, rows, _, limits = new_contacts(gateway, operation(), '2026-03-08', '2026-03-08')
        self.assertTrue(answer.startswith('At least 1'))
        self.assertEqual(len(rows), 1)
        self.assertTrue(any('Duplicate' in limit for limit in limits))
        self.assertTrue(any('repeated' in limit for limit in limits))

    def test_changed_totals_bad_dates_and_missing_ids_are_never_complete(self):
        pages = [{'contacts': [self.row()], 'total': 2, 'meta': {'searchAfter': 'next'}},
                 {'contacts': [self.row(2), self.row(3, dateAdded='2025-01-01T00:00:00Z'), self.row(4, id=None)], 'total': 3}]
        answer, rows, _, limits = new_contacts(self.gateway(pages), operation(), '2026-03-08', '2026-03-08')
        self.assertTrue(answer.startswith('At least 2'))
        self.assertEqual(len(rows), 2)
        self.assertTrue(any('total changed' in limit for limit in limits))
        self.assertTrue(any('creation time' in limit for limit in limits))
        self.assertTrue(any('stable contact ID' in limit for limit in limits))

    def test_result_bytes_and_page_count_bounded(self):
        gateway = self.gateway([{'contacts': [self.row(note='X' * 2_000_000)], 'total': 1}])
        answer, rows, _, limits = new_contacts(gateway, operation(), '2026-03-08', '2026-03-08')
        self.assertEqual(rows, [])
        self.assertTrue(answer.startswith('At least 0'))
        self.assertTrue(any('2 MB' in limit for limit in limits))
        gateway = self.gateway([{'contacts': [self.row(index)], 'total': 21, 'searchAfter': str(index)} for index in range(20)])
        _, rows, _, limits = new_contacts(gateway, operation(), '2026-03-08', '2026-03-08')
        self.assertEqual(len(rows), 20)
        self.assertTrue(any('20-page' in limit for limit in limits))


class ChatWorkflowTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = get_user_model().objects.create_user(username='chat-admin', role='admin')
        self.user = get_user_model().objects.create_user(username='chat-user')
        self.other = get_user_model().objects.create_user(username='chat-other')
        client = Clients.objects.create(name='Synthetic test fixture')
        self.account = Account.objects.create(client=client)
        self.connection = GhlConnection.objects.create(client=client, location_id='loc', encrypted_token='unused-test-placeholder')
        Grant.objects.create(account=self.account, user=self.user, can_execute=True)
        self.conversation = Conversation.objects.create(account=self.account, owner=self.user, title='New conversation')
        self.client.force_authenticate(self.user)
        self.gateway = SimpleNamespace(location='loc', timezone='UTC', revision=str(self.connection.revision),
                                       search=Mock(), describe=Mock(), execute=Mock())
        self.network_guard = patch('requests.sessions.Session.request', side_effect=AssertionError('Live network is forbidden in chat tests'))
        self.network_guard.start()
        self.addCleanup(self.network_guard.stop)

    def make_run(self, **kwargs):
        return Run.objects.create(conversation=self.conversation, question='Test query', request_key=uuid.uuid4(), **kwargs)

    def process(self, run, steps):
        with patch('ghl_chat.services.gateway_for', return_value=self.gateway), patch('ghl_chat.services.ai.next_step', side_effect=steps):
            services.process_run(run.pk)
        run.refresh_from_db()

    def proposal(self, run, **overrides):
        op = operation('update-contact', write=True)
        proposal = {'operation': op, 'params': {'body': {'locationId': 'loc', 'name': 'Demo'}},
                    'connection_revision': str(self.connection.revision), 'account_id': self.account.pk,
                    'location_id': 'loc', 'expires_at': (timezone.now() + timedelta(minutes=15)).isoformat(), **overrides}
        proposal['hash'] = services.digest(proposal)
        run.proposal = proposal
        run.account_snapshot = {'name': self.account.client.name, 'location_id': 'loc', 'timezone': 'UTC'}
        run.status = 'awaiting_confirmation'
        run.save()
        self.gateway.describe.return_value = op
        return proposal

    def confirm(self, run, decision='approve', **kwargs):
        return self.client.post(f'/api/ghl-chat/runs/{run.pk}/confirm/',
                                {'decision': decision, 'proposal_hash': run.proposal.get('hash'), **kwargs}, format='json')

    def test_requests_queue_work_without_api_ai_or_eager_celery(self):
        with patch('ghl_chat.services.gateway_for') as gateway, patch('ghl_chat.ai._chat') as provider, patch('ghl_chat.tasks.drain_chat.delay') as task:
            response = self.client.post(f'/api/ghl-chat/conversations/{self.conversation.pk}/messages/',
                                        {'question': 'What changed?', 'request_key': str(uuid.uuid4())}, format='json')
        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.data['status'], 'queued')
        gateway.assert_not_called()
        provider.assert_not_called()
        task.assert_not_called()

    def test_request_uuid_prevents_duplicate_execution_and_cannot_change_question(self):
        key = str(uuid.uuid4())
        endpoint = f'/api/ghl-chat/conversations/{self.conversation.pk}/messages/'
        first = self.client.post(endpoint, {'question': 'Question', 'request_key': key}, format='json')
        repeated = self.client.post(endpoint, {'question': 'Question', 'request_key': key}, format='json')
        changed = self.client.post(endpoint, {'question': 'Other question', 'request_key': key}, format='json')
        self.assertEqual(first.data['id'], repeated.data['id'])
        self.assertEqual(changed.status_code, 400)
        self.assertEqual(Run.objects.count(), 1)

    def test_accounts_conversations_exports_and_confirmations_are_private(self):
        run = self.make_run(csv_data='id\n1', pdf=b'%PDF')
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get('/api/ghl-chat/accounts/').data['accounts'], [])
        for endpoint in (f'conversations/{self.conversation.pk}/', f'runs/{run.pk}/', f'runs/{run.pk}/export/csv/'):
            self.assertEqual(self.client.get('/api/ghl-chat/' + endpoint).status_code, 404)
        self.assertEqual(self.confirm(run).status_code, 404)
        # Account access does not grant access to another staff member's chat.
        Grant.objects.create(account=self.account, user=self.other, can_execute=True)
        self.assertEqual(self.client.get(f'/api/ghl-chat/runs/{run.pk}/').status_code, 404)

    def test_manager_can_enable_connected_accounts_and_manage_grants(self):
        self.assertEqual(self.client.get(f'/api/ghl-chat/accounts/{self.account.pk}/grants/').status_code, 403)
        self.client.force_authenticate(self.admin)
        self.account.enabled = False
        self.account.save()
        response = self.client.post('/api/ghl-chat/accounts/', {'client_id': self.account.client_id}, format='json')
        self.assertEqual(response.status_code, 201)
        self.account.refresh_from_db()
        self.assertTrue(self.account.enabled)
        endpoint = f'/api/ghl-chat/accounts/{self.account.pk}/grants/'
        response = self.client.get(endpoint)
        self.assertEqual(response.data, {'grants': [{'user_id': self.user.pk, 'name': self.user.display_name, 'can_execute': True}]})
        self.assertEqual(self.client.post(endpoint, {'user_id': self.other.pk, 'can_execute': 'true'}, format='json').status_code, 400)
        self.assertEqual(self.client.post(endpoint, {'user_id': self.other.pk, 'can_execute': False}, format='json').status_code, 200)
        self.assertTrue(Grant.objects.filter(user=self.other).exists())
        self.client.post(endpoint, {'user_id': self.other.pk, 'revoke': True}, format='json')
        self.assertFalse(Grant.objects.filter(user=self.other).exists())
        self.assertTrue(Audit.objects.filter(event='grant_revoked').exists())

    def test_removed_staff_and_disabled_accounts_have_no_access(self):
        self.user.deleted_at = timezone.now()
        self.user.save()
        self.assertFalse(accounts_for(self.user).exists())
        self.user.deleted_at = None
        self.user.save()
        self.account.enabled = False
        self.account.save()
        self.assertFalse(accounts_for(self.user).exists())

    def test_synthetic_accounts_are_opt_in_without_privileged_auth(self):
        self.account.synthetic = True
        self.account.save()
        self.assertFalse(accounts_for(self.admin).exists())
        with override_settings(GHL_CHAT_ALLOW_SYNTHETIC=True):
            self.assertTrue(accounts_for(self.admin).exists())
            self.assertFalse(accounts_for(self.other).exists())
        with self.assertRaises(ChatError):
            services.gateway_for(self.account)

    def test_generic_reads_discover_describe_and_save_real_results(self):
        run = self.make_run()
        op = operation('list-things')
        self.gateway.search.return_value = [op]
        self.gateway.describe.return_value = op
        self.gateway.execute.return_value = {'items': [{'id': 'one'}, {'id': 'two'}]}
        self.process(run, [step('search', query='things'), step('execute', operation_id='list-things'),
                           step('execute', operation_id='list-things', params_json='{}'), step('answer', answer='Two rows returned.')])
        self.assertEqual(run.status, 'done')
        self.assertEqual(len(run.rows), 2)
        self.assertEqual(run.evidence[0]['operationId'], 'list-things')
        self.assertTrue(run.csv_data)
        self.assertTrue(bytes(run.pdf).startswith(b'%PDF'))
        self.assertTrue(any('only returned pages' in item for item in run.limitations))
        self.gateway.execute.assert_called_once()

    def test_hallucinated_operations_never_execute(self):
        run = self.make_run()
        self.process(run, [step('execute', operation_id='invented-operation')])
        self.assertEqual(run.status, 'failed')
        self.gateway.execute.assert_not_called()
        self.assertIn('not discovered', run.answer)

    def test_restricted_mode_blocks_generic_plan_before_operation_execution(self):
        run = self.make_run()
        self.gateway.restricted_read = True
        self.process(run, [step('execute', operation_id='arbitrary')])
        self.assertEqual(run.status, 'failed')
        self.assertTrue(run.account_snapshot['restricted_read'])
        self.gateway.execute.assert_not_called()
        self.gateway.describe.assert_not_called()

    def test_restricted_contact_report_returns_warning_snapshot_and_exports(self):
        run = self.make_run()
        self.gateway.restricted_read = True
        self.gateway.search.return_value = [operation()]
        self.gateway.describe.return_value = operation()
        self.gateway.execute_contact_report = Mock(return_value={'contacts': [], 'total': 0})
        self.process(run, [step('new_contacts', start_date='2026-01-01', end_date='2026-01-31')])
        self.assertEqual(run.status, 'done')
        self.assertTrue(run.account_snapshot['restricted_read'])
        self.assertTrue(any('Restricted read mode' in item for item in run.limitations))
        self.assertTrue(run.account_snapshot['current_date'])
        self.assertTrue(run.pdf_available)
        self.gateway.execute.assert_not_called()

    def test_poll_and_conversation_page_do_not_load_artifacts_or_full_rows(self):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext
        runvertr = self.make_run(status='done', rows=[{'id': 'one'}], csv_data='CSV CONTENT', pdf=b'%PDF')
        with CaptureQueriesContext(connection) as queries:
            response = self.client.get(f'/api/ghl-chat/runs/{runvertr.pk}/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['row_count'], 1)
        selects = ' '.join(query['sql'] for query in queries if query['sql'].startswith('SELECT'))
        for field in ('"rows"', '"csv_data"', '"pdf"'):
            self.assertNotIn(field, selects)
        for index in range(26):
            self.make_run(status='done')
        with CaptureQueriesContext(connection) as queries:
            response = self.client.get(f'/api/ghl-chat/conversations/{self.conversation.pk}/')
        self.assertEqual(len(response.data['runs']), 25)
        self.assertEqual(response.data['run_count'], 27)
        self.assertTrue(response.data['has_more'])
        selects = ' '.join(query['sql'] for query in queries if query['sql'].startswith('SELECT'))
        for field in ('"rows"', '"csv_data"', '"pdf"'):
            self.assertNotIn(field, selects)
        self.assertEqual(len(self.client.get(f'/api/ghl-chat/conversations/{self.conversation.pk}/?page=2').data['runs']), 2)

    def test_plan_date_range_survives_final_summary_step(self):
        run = self.make_run()
        self.gateway.search.return_value = []
        self.process(run, [step('search', start_date='2026-01-01', end_date='2026-01-31'),
                           step('answer', answer='No operation available', start_date='', end_date='')])
        self.assertEqual(run.plan['start_date'], '2026-01-01')
        self.assertEqual(run.plan['end_date'], '2026-01-31')

    def test_write_is_not_claimed_if_connection_becomes_restricted(self):
        run = self.make_run()
        self.proposal(run)
        self.confirm(run)
        self.gateway.restricted_read = True
        self.process(run, [])
        self.assertEqual(run.status, 'failed')
        self.assertFalse(Execution.objects.exists())
        self.gateway.execute.assert_not_called()

    def test_writes_require_reviewed_human_confirmation_then_execute_once(self):
        run = self.make_run()
        op = operation('update-contact', write=True)
        self.gateway.search.return_value = [op]
        self.gateway.describe.return_value = op
        self.process(run, [step('search'), step('execute', operation_id='update-contact'),
                           step('execute', operation_id='update-contact', params_json='{"body":{"name":"Demo"}}')])
        self.assertEqual(run.status, 'awaiting_confirmation')
        self.gateway.execute.assert_not_called()
        self.assertEqual(self.confirm(run).status_code, 202)
        self.gateway.execute.return_value = {'id': 'updated', 'locationId': 'loc'}
        self.process(run, [])
        self.assertEqual(run.status, 'done')
        self.assertEqual(Execution.objects.filter(run=run).count(), 1)
        self.gateway.execute.assert_called_once()
        self.assertEqual(self.gateway.execute.call_args.kwargs['key'], str(run.pk))
        self.process(run, [])
        self.assertEqual(self.gateway.execute.call_count, 1)
        self.assertEqual(self.confirm(run).status_code, 409)

    def test_rejection_has_no_side_effect(self):
        run = self.make_run()
        self.proposal(run)
        self.assertEqual(self.confirm(run, 'reject').status_code, 200)
        self.process(run, [])
        self.assertEqual(run.status, 'rejected')
        self.gateway.execute.assert_not_called()
        self.assertFalse(Execution.objects.exists())

    def test_bad_hash_expiry_revision_or_read_only_grant_blocks_approval(self):
        run = self.make_run()
        self.proposal(run)
        self.assertEqual(self.confirm(run, proposal_hash='forged').status_code, 400)
        self.proposal(run, expires_at=(timezone.now() - timedelta(seconds=1)).isoformat())
        self.assertEqual(self.confirm(run).status_code, 400)
        self.proposal(run, expires_at='2026-09-01T00:00:00')
        self.assertEqual(self.confirm(run).status_code, 400)
        self.proposal(run, connection_revision='stale')
        self.assertEqual(self.confirm(run).status_code, 400)
        self.proposal(run)
        Grant.objects.filter(user=self.user).update(can_execute=False)
        self.assertEqual(self.confirm(run).status_code, 403)

    def test_revocation_after_approval_blocks_worker(self):
        run = self.make_run()
        self.proposal(run)
        self.assertEqual(self.confirm(run).status_code, 202)
        Grant.objects.filter(user=self.user).delete()
        self.process(run, [])
        self.assertEqual(run.status, 'failed')
        self.gateway.execute.assert_not_called()

    def test_connection_rotation_during_gateway_init_blocks_write(self):
        run = self.make_run()
        self.proposal(run)
        self.confirm(run)
        self.gateway.revision = 'rotated-after-first-check'
        self.process(run, [])
        self.assertEqual(run.status, 'failed')
        self.assertFalse(Execution.objects.exists())
        self.gateway.execute.assert_not_called()

    def test_metadata_changes_after_approval_block_write(self):
        run = self.make_run()
        self.proposal(run)
        self.confirm(run)
        self.gateway.describe.return_value = {**operation('update-contact', write=True), 'summary': 'Changed contract'}
        self.process(run, [])
        self.assertEqual(run.status, 'failed')
        self.gateway.execute.assert_not_called()

    def test_ambiguous_mutation_is_unknown_and_never_retried(self):
        run = self.make_run()
        self.proposal(run)
        self.confirm(run)
        self.gateway.execute.side_effect = TimeoutError('SECRET token body')
        self.process(run, [])
        self.assertEqual(run.status, 'unknown')
        self.assertNotIn('SECRET', run.answer)
        self.assertTrue(Execution.objects.filter(run=run).exists())
        self.process(run, [])
        self.gateway.execute.assert_called_once()
        # Another request key cannot bypass the same account/operation receipt.
        another = self.make_run()
        self.proposal(another)
        self.confirm(another)
        self.process(another, [])
        self.assertEqual(another.status, 'failed')
        self.assertIn('already been claimed', another.answer)
        self.gateway.execute.assert_called_once()

    def test_stale_worker_is_marked_unknown_without_reexecution(self):
        run = self.make_run(status='executing', started_at=timezone.now() - timedelta(minutes=6))
        drain_chat()
        run.refresh_from_db()
        self.assertEqual(run.status, 'unknown')
        self.gateway.execute.assert_not_called()

    def test_revocation_between_reads_blocks_next_remote_call(self):
        run = self.make_run()
        op = operation('read-things')
        self.gateway.search.return_value = [op]
        self.gateway.describe.return_value = op
        def execute(*args, **kwargs):
            Grant.objects.filter(user=self.user).delete()
            return {'items': [{'id': 'one'}]}
        self.gateway.execute.side_effect = execute
        self.process(run, [step('search'), step('execute', operation_id='read-things'),
                           step('execute', operation_id='read-things'), step('execute', operation_id='read-things')])
        self.assertEqual(run.status, 'failed')
        self.gateway.execute.assert_called_once()

    def test_preview_bounded_csv_full_and_artifact_links_truthful(self):
        run = self.make_run(status='done', rows=[{'id': index} for index in range(105)])
        build_exports(run)
        run.save()
        payload = run_payload(run)
        self.assertEqual(len(payload['rows']), 100)
        self.assertEqual(payload['row_count'], 105)
        self.assertTrue(payload['rows_truncated'])
        self.assertEqual(len(list(csv.reader(io.StringIO(run.csv_data)))) - 1, 105)
        self.assertTrue(payload['csv_url'])
        self.assertTrue(payload['pdf_url'])
        with patch('ghl_chat.exports.render_pdf', side_effect=RuntimeError('Missing native lib')):
            build_exports(run)
        run.save()
        self.assertIsNone(run_payload(run)['pdf_url'])
        self.assertTrue(run_payload(run)['csv_url'])
        self.assertTrue(run.export_error)

    def test_export_download_auth_and_audit(self):
        run = self.make_run(status='done', csv_data='id\r\n1\r\n')
        response = self.client.get(f'/api/ghl-chat/runs/{run.pk}/export/csv/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Cache-Control'], 'private, no-store')
        self.assertTrue(Audit.objects.filter(run=run, event='export_downloaded').exists())
        self.assertEqual(self.client.get(f'/api/ghl-chat/runs/{run.pk}/export/pdf/').status_code, 409)

    def test_provider_routing_has_no_fallback_or_secret_logging(self):
        from builds.services import _chat
        for provider, target in [('OPENAI', '_openai_complete'), ('ANTHROPIC', '_anthropic_complete')]:
            with self.subTest(provider=provider), patch('builds.services._active_provider', return_value=provider), \
                    patch('builds.services._model', return_value='configured-model'), \
                    patch('builds.services._daily_token_cap', return_value=0), \
                    patch('builds.services.' + target, side_effect=RuntimeError('SECRET customer data')) as complete, \
                    patch('builds.services._record_ai_log') as log:
                with self.assertRaises(RuntimeError):
                    _chat([], op='ghl_chat', timeout=25)
                complete.assert_called_once()
                self.assertEqual(complete.call_args.kwargs['request_options'], {'timeout': 25, 'max_retries': 0})
                self.assertEqual(log.call_args.args[-1], 'RuntimeError')


class ExportTests(SimpleTestCase):
    def test_csv_formula_injection_and_quoted_cells(self):
        for value in ('=SUM(A1)', '+1', '-2', '@thing', '  =SUM(A1)', '\tformula', '\nformula'):
            self.assertTrue(csv_cell(value).startswith("'"))
        raw = render_csv([{'=header': '=1', 'name': 'Quoted, "Name"\nSecond line', 'nested': {'a': 1}}])
        rows = list(csv.reader(io.StringIO(raw.lstrip('\ufeff'))))
        self.assertEqual(rows[0][0], "'=header")
        self.assertEqual(rows[1][0], "'=1")
        self.assertEqual(rows[1][1], 'Quoted, "Name"\nSecond line')

    def test_pdf_contains_question_account_range_answer_limits_without_native_dlls(self):
        from pypdf import PdfReader
        run = SimpleNamespace(id=uuid.uuid4(), account_snapshot={'name': 'Demo Account', 'location_id': 'demo', 'timezone': 'UTC'},
                              created_at=timezone.now(), status='done', plan={'start_date': '2026-01-01', 'end_date': '2026-01-31'},
                              question='How many new contacts?', answer='5 new contacts.', limitations=['Incomplete token scope.'],
                              evidence=[{'operationId': 'search-contacts-advanced', 'returned': 5}], rows=[{'id': 1}])
        pdf = render_pdf(run)
        self.assertTrue(pdf.startswith(b'%PDF'))
        extracted = '\n'.join(page.extract_text() for page in PdfReader(io.BytesIO(pdf)).pages)
        for required in ('Demo Account', '2026-01-01', '2026-01-31', 'How many new contacts?', '5 new contacts.', 'Incomplete token scope.'):
            self.assertIn(required, extracted)
