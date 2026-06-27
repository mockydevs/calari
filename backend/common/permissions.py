"""Canonical permission helpers shared across apps.

This is the single source of truth for the "manager" check. New code should import
from here; the per-app duplicates in builds/projects (and the inline onboarding copy)
should migrate to these to end the three-pattern fragmentation.
"""
from rest_framework.permissions import BasePermission, SAFE_METHODS

_MANAGER_ROLES = ("superuser", "admin")


def is_manager(user) -> bool:
    """A manager = Django superuser OR a user whose role is superuser/admin."""
    return bool(
        user
        and getattr(user, "is_authenticated", False)
        and (user.is_superuser or getattr(user, "role", None) in _MANAGER_ROLES)
    )


class IsManager(BasePermission):
    """Allow only managers (used for admin/config/credential endpoints)."""
    def has_permission(self, request, view):
        return is_manager(request.user)


class IsManagerOrReadOnly(BasePermission):
    """Read for any authenticated user; write for managers only."""
    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return bool(getattr(request.user, "is_authenticated", False))
        return is_manager(request.user)
