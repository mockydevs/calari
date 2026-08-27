from django.conf import settings
from rest_framework.exceptions import PermissionDenied

from .models import Account


def accounts_for(user):
    if not user.is_active or user.deleted_at:
        return Account.objects.none()
    qs = Account.objects.filter(enabled=True, client__is_active=True)
    if not getattr(settings, 'GHL_CHAT_ALLOW_SYNTHETIC', False):
        qs = qs.filter(synthetic=False)
    return qs if user.is_manager else qs.filter(grants__user=user)


def authorize(user, account, *, write=False):
    if not accounts_for(user).filter(pk=account.pk).exists():
        raise PermissionDenied('Access to this GHL account was not granted or has been revoked.')
    if write and not (user.is_manager or account.grants.filter(user=user, can_execute=True).exists()):
        raise PermissionDenied('You have read access only. An administrator must grant execution permission.')
