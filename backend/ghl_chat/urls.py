from django.urls import path
from . import views

urlpatterns = [
    path('accounts/', views.accounts),
    path('accounts/<int:account_id>/grants/', views.grants),
    path('accounts/<int:account_id>/audit/', views.audit_log),
    path('conversations/', views.conversations),
    path('conversations/<uuid:conversation_id>/', views.conversation_detail),
    path('conversations/<uuid:conversation_id>/messages/', views.messages),
    path('runs/<uuid:run_id>/', views.run_detail),
    path('runs/<uuid:run_id>/confirm/', views.confirm),
    path('runs/<uuid:run_id>/export/<str:kind>/', views.export),
]
