from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated, BasePermission
from rest_framework.filters import OrderingFilter, SearchFilter
from django_filters.rest_framework import DjangoFilterBackend

from .models import Connection, IntegrationMap, CallInsight, IntegrationEvent
from .serializers import (
    ConnectionSerializer, IntegrationMapSerializer,
    CallInsightSerializer, IntegrationEventSerializer,
)


def _is_manager(user) -> bool:
    return bool(user and user.is_authenticated and (
        user.is_superuser or getattr(user, "role", None) in ("superuser", "admin")
    ))


class IsManager(BasePermission):
    """Onboarding config + credentials are admin/manager territory (secrets)."""
    def has_permission(self, request, view):
        return _is_manager(request.user)


class ConnectionViewSet(viewsets.ModelViewSet):
    queryset = Connection.objects.all()
    serializer_class = ConnectionSerializer
    permission_classes = [IsManager]
    filter_backends = [DjangoFilterBackend, OrderingFilter]
    filterset_fields = ["provider", "active"]
    ordering = ["provider", "-updated_at"]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class IntegrationMapViewSet(viewsets.ModelViewSet):
    queryset = IntegrationMap.objects.select_related("client").all()
    serializer_class = IntegrationMapSerializer
    permission_classes = [IsManager]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["client", "active"]
    search_fields = ["client__name", "client_number"]
    ordering = ["client_number", "client_id"]


class CallInsightViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = CallInsight.objects.select_related("client").prefetch_related("events").all()
    serializer_class = CallInsightSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, SearchFilter, OrderingFilter]
    filterset_fields = ["client", "status"]
    search_fields = ["title", "summary"]
    ordering = ["-created_at"]


class IntegrationEventViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = IntegrationEvent.objects.select_related("call_insight").all()
    serializer_class = IntegrationEventSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, OrderingFilter]
    filterset_fields = ["call_insight", "target", "status"]
    ordering = ["-created_at"]
