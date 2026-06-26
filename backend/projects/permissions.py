"""Object-level write permissions for the projects domain.

Model: reads stay open to any authenticated staff member (internal tool), but
create/update/delete is limited to managers (admin/superuser) or the people who
own / are assigned to the record. This closes the IDOR where any authenticated
user could edit or delete *any* project, task, or client.
"""
from rest_framework.permissions import BasePermission, SAFE_METHODS


def is_manager(user):
    return bool(
        user
        and user.is_authenticated
        and (user.is_superuser or getattr(user, "role", None) in ("superuser", "admin"))
    )


class IsManagerOrProjectMember(BasePermission):
    """Project writes require a manager, the assignee, or a co-assignee."""

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated)

    def has_object_permission(self, request, view, obj):
        if request.method in SAFE_METHODS or is_manager(request.user):
            return True
        return _is_project_member(request.user, obj)


class IsManagerOrTaskOwner(BasePermission):
    """Task writes require a manager, the task creator/assignee, or a member of
    the task's project."""

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated)

    def has_object_permission(self, request, view, obj):
        if request.method in SAFE_METHODS or is_manager(request.user):
            return True
        uid = request.user.id
        if obj.assigned_to_id == uid or obj.created_by_id == uid:
            return True
        return _is_project_member(request.user, obj.project)


class IsManagerOrReadOnly(BasePermission):
    """Anyone authenticated may read; only managers may write. Used for records
    with no per-user owner (e.g. Clients)."""

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False
        return request.method in SAFE_METHODS or is_manager(request.user)


def _is_project_member(user, project):
    if project is None:
        return False
    if project.assigned_to_id == user.id:
        return True
    return project.co_assignments.filter(user_id=user.id).exists()
