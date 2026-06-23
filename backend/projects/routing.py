from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    re_path(r'^ws/projects/(?P<project_id>[0-9]+)/tasks/$', consumers.TaskBoardConsumer.as_asgi()),
]
