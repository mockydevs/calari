"""Deterministic new-contact reporting; never equate contacts and opportunities."""
from datetime import date, datetime, time, timedelta, timezone
import json
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .transport import ChatError, needs_confirmation, redact


def date_window(start, end, account_timezone):
    try:
        first, last = date.fromisoformat(start), date.fromisoformat(end)
        zone = ZoneInfo(account_timezone)
        if last < first or (last - first).days > 366:
            raise ValueError()
        begin = datetime.combine(first, time.min, zone).astimezone(timezone.utc)
        stop = datetime.combine(last + timedelta(days=1), time.min, zone).astimezone(timezone.utc)
        return begin, stop
    except (ValueError, TypeError, OverflowError, ZoneInfoNotFoundError):
        raise ChatError('Choose explicit YYYY-MM-DD dates in order, no more than 366 days apart, and a valid account timezone.') from None


def new_contacts(gateway, operation, start, end, checkpoint=lambda: None):
    if operation.get('operationId') != 'search-contacts-advanced' or needs_confirmation(operation):
        raise ChatError('The discovered contact-search operation is not verified read-only.')
    begin, stop = date_window(start, end, gateway.timezone)
    body = {'locationId': gateway.location, 'pageLimit': 100,
            'sort': [{'field': 'dateAdded', 'direction': 'desc'}],
            'filters': [{'field': 'dateAdded', 'operator': 'range',
                         'value': {'gte': begin.isoformat(), 'lte': (stop - timedelta(milliseconds=1)).isoformat()}}]}
    rows, seen, cursors, evidence, limits = [], set(), set(), [], []
    expected = None
    complete = False
    for page in range(1, 21):
        checkpoint()
        execute = gateway.execute_contact_report if getattr(gateway, 'restricted_read', False) else gateway.execute
        data = execute(operation, {'body': body})
        if not isinstance(data, dict):
            raise ChatError('GHL contact search did not return a valid data envelope.')
        batch, total = data.get('contacts'), data.get('total')
        if not isinstance(batch, list) or len(batch) > 100 or any(not isinstance(r, dict) for r in batch):
            raise ChatError('GHL contact search did not return a valid contacts list.')
        if type(total) is not int or total < 0:
            total = None
        if page == 1:
            expected = total
        elif total != expected:
            limits.append('The reported total changed while paging; this is not a stable snapshot.')
        evidence.append({'operationId': operation['operationId'], 'page': page, 'returned': len(batch), 'reported_total': total,
                         'filter': body['filters'], 'timezone': gateway.timezone})
        before = len(rows)
        for row in batch:
            rid = row.get('id')
            try:
                added = datetime.fromisoformat(str(row.get('dateAdded', '')).replace('Z', '+00:00'))
                if not added.tzinfo or not begin <= added < stop:
                    raise ValueError()
            except ValueError:
                limits.append('A record had a missing or out-of-range creation time and was excluded.')
                continue
            if not isinstance(rid, str) or not rid:
                limits.append('A record without a stable contact ID was excluded.')
                continue
            if rid in seen:
                limits.append('Duplicate contact IDs occurred across pages and were deduplicated.')
                continue
            seen.add(rid)
            # Export underlying rows, not just the summary. Do not send them all to AI.
            rows.append(redact(row))
            if len(json.dumps(rows)) > 2_000_000:
                rows.pop()
                limits.append('Stopped at the 2 MB result safety limit; remaining records were not retrieved.')
                break
        if limits and limits[-1].startswith('Stopped at the 2 MB'):
            break
        if expected is not None and len(rows) == expected and not limits:
            complete = True
            break
        if expected is not None and len(rows) > expected:
            limits.append('Returned unique records exceed the reported total.')
            break
        if not batch:
            limits.append('Pagination ended without a reconciled total.')
            break
        # Accept only an explicit server-returned cursor. Never fabricate a
        # searchAfter value from a date or ID, even if it seems plausible.
        cursor = data.get('searchAfter')
        if not cursor and isinstance(data.get('meta'), dict):
            cursor = data['meta'].get('searchAfter')
        if not cursor:
            limits.append('GHL returned no supported searchAfter cursor; remaining pages could not be verified.')
            break
        encoded = json.dumps(cursor, sort_keys=True)
        if encoded in cursors or (page > 1 and len(rows) == before):
            limits.append('Pagination repeated a cursor or made no progress; stopped safely.')
            break
        cursors.add(encoded)
        body['searchAfter'] = cursor
    else:
        limits.append('Stopped at the 20-page / 2,000-record safety limit.')
    limits = list(dict.fromkeys(limits))
    limits.append('New contacts are records created in this date range, not new opportunities, messages or unique real-world people. Deleted records and data outside the token scopes are not observable.')
    qualifier = '' if complete else 'At least '
    answer = f'{qualifier}{len(rows)} new contacts from {start} through {end} ({gateway.timezone}, inclusive calendar dates).'
    if not complete:
        answer += ' This is an incomplete count; do not use it as the account total.'
    if expected is not None:
        answer += f' GHL reported {expected} matching records; {len(rows)} unique underlying records were verified.'
    return answer, rows, evidence, limits
