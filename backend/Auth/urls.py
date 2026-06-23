from django.urls import path
from . import views

app_name = 'auth_app'

urlpatterns = [
    # Token endpoints
    path('api/token/', views.token_obtain, name='token_obtain'),
    path('api/token/refresh/', views.token_refresh, name='token_refresh'),
    path('api/token/logout/', views.token_logout, name='token_logout'),

    # Auth management endpoints
    path('api/auth/me/', views.me, name='me'),
    path('api/auth/change-password/', views.change_password, name='change_password'),
    path('api/auth/reset-password/', views.reset_password, name='reset_password'),
    path('api/auth/register/', views.register_user, name='register'),
    path('api/auth/users/', views.list_users, name='list_users'),
    path('api/auth/users/<int:user_id>/', views.update_user, name='update_user'),
    path('api/auth/users/<int:user_id>/deactivate/', views.deactivate_user, name='deactivate_user'),
    path('api/auth/users/<int:user_id>/activate/', views.activate_user, name='activate_user'),
    path('api/auth/users/<int:user_id>/delete/', views.delete_user, name='delete_user'),

    # Forgot / reset password (self-service)
    path('api/auth/forgot-password/', views.forgot_password, name='forgot_password'),
    path('api/auth/reset-password-confirm/', views.reset_password_confirm, name='reset_password_confirm'),
]
