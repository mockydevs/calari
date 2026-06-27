"""Object-level write permissions for the builds domain.

Reads stay open to any authenticated staff member; create/update/delete on a
build (and its tasks) requires a manager, the build creator, or the assignee.
"""
from rest_framework.permissions import BasePermission, SAFE_METHODS


def is_manager(user):
    return bool(
        user
        and user.is_authenticated
        and (user.is_superuser or getattr(user, "role", None) in ("superuser", "admin"))
    )


def can_manage_builds(user):
    """Managers, or members granted the 'builds_manage' feature, may write to any
    build regardless of ownership."""
    return is_manager(user) or (
        bool(user and user.is_authenticated)
        and hasattr(user, "has_feature") and user.has_feature("builds_manage")
    )


def _owns_build(user, build):
    if build is None:
        return False
    return build.creator_id == user.id or build.assignee_id == user.id


class IsManagerOrBuildOwner(BasePermission):
    """Build writes require a manager, the creator, or the assignee."""

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated)

    def has_object_permission(self, request, view, obj):
        if request.method in SAFE_METHODS or can_manage_builds(request.user):
            return True
        return _owns_build(request.user, obj)


class IsManagerOrBuildTaskOwner(BasePermission):
    """Build-task writes require a manager, the task assignee, or someone who
    owns the parent build."""

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated)

    def has_object_permission(self, request, view, obj):
        if request.method in SAFE_METHODS or can_manage_builds(request.user):
            return True
        if obj.assignee_id == request.user.id:
            return True
        return _owns_build(request.user, obj.build)
