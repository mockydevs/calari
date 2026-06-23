"""
WebSocket consumer for the real-time Kanban task board.

Group name: project_tasks_{project_id}
Connect: validates JWT from cookie, joins the project group.
Receive: broadcasts task events (create / update / delete) to all group members.
"""

import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.conf import settings


class TaskBoardConsumer(AsyncWebsocketConsumer):
    """One consumer per browser tab viewing a project's task board."""

    async def connect(self):
        # Validate JWT from cookie
        user = await self._get_user()
        if user is None:
            await self.close(code=4401)
            return

        self.user = user
        self.project_id = self.scope['url_route']['kwargs']['project_id']
        self.group_name = f'project_tasks_{self.project_id}'

        # Check the user has access to this project
        has_access = await self._has_project_access(user, self.project_id)
        if not has_access:
            await self.close(code=4403)
            return

        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        if hasattr(self, 'group_name'):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data):
        """
        Client sends: {"type": "task_update"|"task_created"|"task_deleted", "task": {...}}
        We broadcast it to all group members.
        """
        try:
            payload = json.loads(text_data)
        except (json.JSONDecodeError, ValueError):
            return

        event_type = payload.get('type', 'task_update')
        allowed_types = {'task_update', 'task_created', 'task_deleted', 'task_moved'}
        if event_type not in allowed_types:
            return

        payload['sender_channel'] = self.channel_name
        payload['user_id'] = getattr(self.user, 'id', None)

        await self.channel_layer.group_send(
            self.group_name,
            {'type': 'board_event', 'payload': payload},
        )

    # ── Channel layer event handlers ──────────────────────────────────────

    async def board_event(self, event):
        """Forwards a group message to this WebSocket client."""
        payload = event['payload']
        # Don't echo back to the sender
        if payload.get('sender_channel') == self.channel_name:
            return
        await self.send(text_data=json.dumps(payload))

    # ── Helpers ───────────────────────────────────────────────────────────

    @database_sync_to_async
    def _get_user(self):
        from rest_framework_simplejwt.tokens import AccessToken
        from rest_framework_simplejwt.exceptions import TokenError
        from django.contrib.auth import get_user_model
        User = get_user_model()

        token_str = None
        cookie_name = settings.SIMPLE_JWT.get('AUTH_COOKIE', 'access_token')

        # Channels passes cookies via scope['cookies']
        cookies = {
            k.decode() if isinstance(k, bytes) else k: v.decode() if isinstance(v, bytes) else v
            for k, v in self.scope.get('cookies', {}).items()
        }
        token_str = cookies.get(cookie_name)

        if not token_str:
            return None
        try:
            token = AccessToken(token_str)
            user_id = token['user_id']
            return User.objects.get(id=user_id, is_active=True)
        except (TokenError, User.DoesNotExist, KeyError):
            return None

    @database_sync_to_async
    def _has_project_access(self, user, project_id):
        from .models import Projects, ProjectCoAssignment
        from django.db.models import Q
        if user.is_superuser or user.role in ('superuser', 'admin'):
            return Projects.objects.filter(pk=project_id).exists()
        return Projects.objects.filter(
            Q(pk=project_id) & (Q(assigned_to=user) | Q(co_assignments__user=user))
        ).distinct().exists()
