import secrets
import string

from django.conf import settings
from django.contrib.auth import get_user_model, authenticate
from django.db.models import Q
from django.utils import timezone
from django.core.mail import send_mail
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework import status
from drf_spectacular.utils import extend_schema, OpenApiResponse
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.exceptions import TokenError
from .serializers import (
    LoginSerializer, UserSerializer, RegisterSerializer,
    UpdateUserSerializer, ChangePasswordSerializer, ResetPasswordSerializer,
    ForgotPasswordSerializer, ResetPasswordConfirmSerializer,
)
from .models import PasswordResetToken
from projects.tasks import send_notification_email

User = get_user_model()


def _is_manager(user):
    """Check if user has manager-level permissions (superuser or admin)."""
    return user.is_superuser or user.role in ('superuser', 'admin')


def _is_superuser(user):
    """Check if user is a superuser."""
    return user.is_superuser or user.role == 'superuser'


def _can_manage_team(user):
    """Managers, or members granted the 'team' feature, may manage staff."""
    return _is_manager(user) or (hasattr(user, 'has_feature') and user.has_feature('team'))


def _get_client_ip(request):
    x_forwarded = request.META.get('HTTP_X_FORWARDED_FOR')
    if x_forwarded:
        return x_forwarded.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR')


def _set_token_cookies(response, access_token, refresh_token):
    jwt_settings = settings.SIMPLE_JWT
    response.set_cookie(
        jwt_settings['AUTH_COOKIE'],
        str(access_token),
        max_age=int(jwt_settings['ACCESS_TOKEN_LIFETIME'].total_seconds()),
        httponly=jwt_settings['AUTH_COOKIE_HTTP_ONLY'],
        samesite=jwt_settings['AUTH_COOKIE_SAMESITE'],
        secure=jwt_settings['AUTH_COOKIE_SECURE'],
        path='/',
    )
    response.set_cookie(
        jwt_settings['AUTH_COOKIE_REFRESH'],
        str(refresh_token),
        max_age=int(jwt_settings['REFRESH_TOKEN_LIFETIME'].total_seconds()),
        httponly=jwt_settings['AUTH_COOKIE_HTTP_ONLY'],
        samesite=jwt_settings['AUTH_COOKIE_SAMESITE'],
        secure=jwt_settings['AUTH_COOKIE_SECURE'],
        path='/',
    )
    return response


def _clear_token_cookies(response):
    jwt_settings = settings.SIMPLE_JWT
    response.delete_cookie(jwt_settings['AUTH_COOKIE'], path='/')
    response.delete_cookie(jwt_settings['AUTH_COOKIE_REFRESH'], path='/')
    return response


# ─── Token / Auth API ───

@extend_schema(
    tags=['Auth — Token'],
    summary='Login',
    description='Authenticate with username/email and password. JWT tokens are set as httpOnly cookies on success.',
    request=LoginSerializer,
    responses={200: OpenApiResponse(description='Login successful — tokens set in cookies'), 401: OpenApiResponse(description='Invalid credentials')},
)
@api_view(['POST'])
@permission_classes([AllowAny])
def token_obtain(request):
    """POST /api/token/ — Login and set JWT cookies"""
    serializer = LoginSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    username_or_email = serializer.validated_data['username_or_email']
    password = serializer.validated_data['password']

    # Try username first, then email
    user = authenticate(request, username=username_or_email, password=password)
    if user is None:
        try:
            user_obj = User.objects.get(email=username_or_email)
            user = authenticate(request, username=user_obj.username, password=password)
        except User.DoesNotExist:
            pass

    if user is None or not user.is_active:
        return Response({'error': 'Invalid credentials'}, status=status.HTTP_401_UNAUTHORIZED)

    # Update login tracking
    user.last_login = timezone.now()
    user.last_login_ip = _get_client_ip(request)
    user.save(update_fields=['last_login', 'last_login_ip'])

    # Generate tokens
    refresh = RefreshToken.for_user(user)
    user_data = UserSerializer(user).data

    response = Response({
        'success': True,
        'user': user_data,
    }, status=status.HTTP_200_OK)

    return _set_token_cookies(response, refresh.access_token, refresh)


@extend_schema(
    tags=['Auth — Token'],
    summary='Refresh access token',
    description='Issues a new access token using the refresh_token cookie. No request body needed.',
    request=None,
    responses={200: OpenApiResponse(description='Access token refreshed'), 401: OpenApiResponse(description='Missing or invalid refresh token')},
)
@api_view(['POST'])
@permission_classes([AllowAny])
def token_refresh(request):
    """POST /api/token/refresh/ — Refresh access token from cookie"""
    refresh_token = request.COOKIES.get(settings.SIMPLE_JWT.get('AUTH_COOKIE_REFRESH'))
    if not refresh_token:
        return Response({'error': 'No refresh token'}, status=status.HTTP_401_UNAUTHORIZED)

    try:
        refresh = RefreshToken(refresh_token)
        new_access = refresh.access_token  # derive access from the *current* refresh first
        response = Response({'success': True}, status=status.HTTP_200_OK)

        jwt_settings = settings.SIMPLE_JWT
        response.set_cookie(
            jwt_settings['AUTH_COOKIE'],
            str(new_access),
            max_age=int(jwt_settings['ACCESS_TOKEN_LIFETIME'].total_seconds()),
            httponly=jwt_settings['AUTH_COOKIE_HTTP_ONLY'],
            samesite=jwt_settings['AUTH_COOKIE_SAMESITE'],
            secure=jwt_settings['AUTH_COOKIE_SECURE'],
            path='/',
        )

        # Actually rotate: blacklist the consumed refresh token, then mint a NEW
        # one (fresh jti/exp/iat). The previous code re-set the *same* refresh
        # token, so ROTATE_REFRESH_TOKENS / BLACKLIST_AFTER_ROTATION were no-ops
        # and a leaked refresh token stayed valid for its full lifetime. This
        # mirrors SimpleJWT's own TokenRefreshSerializer.
        if jwt_settings.get('ROTATE_REFRESH_TOKENS'):
            if jwt_settings.get('BLACKLIST_AFTER_ROTATION'):
                try:
                    refresh.blacklist()
                except AttributeError:
                    # blacklist app not installed — nothing to invalidate
                    pass
            refresh.set_jti()
            refresh.set_exp()
            refresh.set_iat()
            response.set_cookie(
                jwt_settings['AUTH_COOKIE_REFRESH'],
                str(refresh),
                max_age=int(jwt_settings['REFRESH_TOKEN_LIFETIME'].total_seconds()),
                httponly=jwt_settings['AUTH_COOKIE_HTTP_ONLY'],
                samesite=jwt_settings['AUTH_COOKIE_SAMESITE'],
                secure=jwt_settings['AUTH_COOKIE_SECURE'],
                path='/',
            )

        return response
    except TokenError:
        response = Response({'error': 'Invalid or expired refresh token'}, status=status.HTTP_401_UNAUTHORIZED)
        return _clear_token_cookies(response)


@extend_schema(
    tags=['Auth — Token'],
    summary='Logout',
    description='Blacklists the refresh token and clears both JWT cookies.',
    request=None,
    responses={200: OpenApiResponse(description='Logged out successfully')},
)
@api_view(['POST'])
@permission_classes([AllowAny])
def token_logout(request):
    """POST /api/token/logout/ — Blacklist refresh token and clear cookies"""
    refresh_token = request.COOKIES.get(settings.SIMPLE_JWT.get('AUTH_COOKIE_REFRESH'))
    if refresh_token:
        try:
            token = RefreshToken(refresh_token)
            token.blacklist()
        except TokenError:
            pass

    response = Response({'success': True}, status=status.HTTP_200_OK)
    return _clear_token_cookies(response)


@extend_schema(
    tags=['Auth — Profile'],
    summary='Get / update current user',
    description="GET returns the authenticated user's profile. PATCH updates the user's own editable fields (full_name, job_title, profile_notes).",
    responses={200: UserSerializer},
)
@api_view(['GET', 'PATCH'])
@permission_classes([IsAuthenticated])
def me(request):
    """GET/PATCH /api/auth/me/ — current user profile (self-service update)"""
    user = request.user
    if request.method == 'PATCH':
        for field in ('full_name', 'job_title', 'profile_notes'):
            if field in request.data:
                setattr(user, field, request.data[field] or '')
        user.save()
    return Response(UserSerializer(user).data)


@extend_schema(
    tags=['Auth — Profile'],
    summary='Change own password',
    description='Allows the authenticated user to change their own password. Re-issues JWT cookies on success.',
    request=ChangePasswordSerializer,
    responses={200: OpenApiResponse(description='Password changed — new tokens set in cookies'), 400: OpenApiResponse(description='Current password is incorrect')},
)
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def change_password(request):
    """POST /api/auth/change-password/ — Change own password"""
    serializer = ChangePasswordSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    user = request.user
    if not user.check_password(serializer.validated_data['current_password']):
        return Response({'error': 'Current password is incorrect'}, status=status.HTTP_400_BAD_REQUEST)

    user.set_password(serializer.validated_data['new_password'])
    user.save()

    # Re-issue tokens
    refresh = RefreshToken.for_user(user)
    response = Response({'success': True, 'message': 'Password changed successfully'})
    return _set_token_cookies(response, refresh.access_token, refresh)


@extend_schema(
    tags=['Auth — User Management'],
    summary='Admin reset password',
    description="Manager (admin/superuser) resets another user's password. Admins cannot reset superuser passwords.",
    request=ResetPasswordSerializer,
    responses={200: OpenApiResponse(description='Password reset successfully'), 403: OpenApiResponse(description='Permission denied')},
)
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def reset_password(request):
    """POST /api/auth/reset-password/ — Manager resets another user's password"""
    if not _is_manager(request.user):
        return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

    serializer = ResetPasswordSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    user = User.objects.get(id=serializer.validated_data['user_id'])

    # Admins cannot reset superuser passwords
    if _is_superuser(user) and not _is_superuser(request.user):
        return Response({'error': 'Only superusers can reset superuser passwords'}, status=status.HTTP_403_FORBIDDEN)

    user.set_password(serializer.validated_data['new_password'])
    user.save()

    return Response({'success': True, 'message': 'Password reset successfully'})


@extend_schema(
    tags=['Auth — User Management'],
    summary='Create user',
    description='Manager (admin/superuser) creates a new portal user. Admins cannot create superuser accounts.',
    request=RegisterSerializer,
    responses={201: UserSerializer, 403: OpenApiResponse(description='Permission denied')},
)
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def register_user(request):
    """POST /api/auth/register/ — Manager creates new user"""
    if not _is_manager(request.user):
        return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

    serializer = RegisterSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data

    # Admins cannot create superusers
    if data.get('role') == 'superuser' and not _is_superuser(request.user):
        return Response({'error': 'Only superusers can create superuser accounts'}, status=status.HTTP_403_FORBIDDEN)

    user = User.objects.create_user(
        username=data['username'],
        email=data['email'],
        password=data['password'],
        full_name=data.get('full_name', ''),
        role=data.get('role', 'viewer'),
        job_title=data.get('job_title', ''),
    )

    if data.get('role') == 'superuser':
        user.is_superuser = True
        user.is_staff = True
        user.save()

    return Response({
        'success': True,
        'message': 'User created successfully',
        'user': UserSerializer(user).data,
    }, status=status.HTTP_201_CREATED)


@extend_schema(
    tags=['Auth — User Management'],
    summary='List all users',
    description='Returns all portal users ordered by most recent join date. Requires admin or superuser role.',
    responses={200: UserSerializer(many=True)},
)
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def list_users(request):
    """GET /api/auth/users/ — Manager lists all users"""
    if not _can_manage_team(request.user):
        return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

    users = User.objects.all().order_by('-date_joined')
    return Response(UserSerializer(users, many=True).data)


@extend_schema(
    tags=['Auth — User Management'],
    summary='Update user',
    description="Manager partially updates a user's profile fields. Role escalation to superuser requires superuser caller.",
    request=UpdateUserSerializer,
    responses={200: UserSerializer, 403: OpenApiResponse(description='Permission denied'), 404: OpenApiResponse(description='User not found')},
)
@api_view(['PATCH'])
@permission_classes([IsAuthenticated])
def update_user(request, user_id):
    """PATCH /api/auth/users/<id>/ — Manager updates user"""
    if not _can_manage_team(request.user):
        return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

    try:
        user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

    # Admins cannot edit superuser accounts
    if _is_superuser(user) and not _is_superuser(request.user):
        return Response({'error': 'Only superusers can edit superuser accounts'}, status=status.HTTP_403_FORBIDDEN)

    serializer = UpdateUserSerializer(data=request.data, context={'user_instance': user})
    serializer.is_valid(raise_exception=True)

    # Admins cannot escalate role to superuser
    if serializer.validated_data.get('role') == 'superuser' and not _is_superuser(request.user):
        return Response({'error': 'Only superusers can assign superuser role'}, status=status.HTTP_403_FORBIDDEN)

    for field, value in serializer.validated_data.items():
        setattr(user, field, value)

    # Feature grants (per-member access to admin-area features). Only true managers
    # may grant features — a 'team'-granted member must not escalate privileges.
    if 'feature_permissions' in request.data and _is_manager(request.user):
        from .models import FEATURE_KEYS
        requested = request.data.get('feature_permissions') or []
        if isinstance(requested, list):
            user.feature_permissions = [k for k in requested if k in FEATURE_KEYS]

    # Sync superuser flag with role
    if 'role' in serializer.validated_data:
        new_role = serializer.validated_data['role']
        if new_role == 'superuser':
            user.is_superuser = True
            user.is_staff = True
            user.role = 'superuser'
        else:
            user.is_superuser = False
            user.is_staff = False
            user.role = new_role

    user.save()
    return Response({'success': True, 'user': UserSerializer(user).data})


@extend_schema(
    tags=['Auth — User Management'],
    summary='Deactivate user',
    description='Prevents the user from logging in. Cannot deactivate yourself or the last superuser.',
    request=None,
    responses={200: OpenApiResponse(description='User deactivated'), 400: OpenApiResponse(description='Cannot deactivate own account or last superuser'), 403: OpenApiResponse(description='Permission denied'), 404: OpenApiResponse(description='User not found')},
)
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def deactivate_user(request, user_id):
    """POST /api/auth/users/<id>/deactivate/ — Manager deactivates user"""
    if not _can_manage_team(request.user):
        return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

    if request.user.id == user_id:
        return Response({'error': 'Cannot deactivate your own account'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

    # Admins cannot deactivate superusers
    if _is_superuser(user) and not _is_superuser(request.user):
        return Response({'error': 'Only superusers can deactivate superuser accounts'}, status=status.HTTP_403_FORBIDDEN)

    # Prevent deactivating the last superuser
    if user.is_superuser or user.role == 'superuser':
        superuser_count = User.objects.filter(
            Q(is_superuser=True) | Q(role='superuser'),
            is_active=True
        ).count()
        if superuser_count <= 1:
            return Response({'error': 'Cannot deactivate the last superuser'}, status=status.HTTP_400_BAD_REQUEST)

    user.is_active = False
    user.save(update_fields=['is_active'])
    return Response({'success': True, 'message': 'User deactivated'})


@extend_schema(
    tags=['Auth — User Management'],
    summary='Activate user',
    description='Re-enables a previously deactivated user account.',
    request=None,
    responses={200: OpenApiResponse(description='User activated'), 403: OpenApiResponse(description='Permission denied'), 404: OpenApiResponse(description='User not found')},
)
@api_view(['POST'])
@permission_classes([IsAuthenticated])
def activate_user(request, user_id):
    """POST /api/auth/users/<id>/activate/ — Manager activates user"""
    if not _can_manage_team(request.user):
        return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

    try:
        user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

    # Admins cannot activate superuser accounts
    if _is_superuser(user) and not _is_superuser(request.user):
        return Response({'error': 'Only superusers can activate superuser accounts'}, status=status.HTTP_403_FORBIDDEN)

    user.is_active = True
    user.save(update_fields=['is_active'])
    return Response({'success': True, 'message': 'User activated'})


@extend_schema(
    tags=['Auth — User Management'],
    summary='Remove user',
    description='Soft-deletes a user by deactivating their account. Cannot remove yourself or the last superuser.',
    responses={200: OpenApiResponse(description='User removed (deactivated)'), 400: OpenApiResponse(description='Cannot delete own account or last superuser'), 403: OpenApiResponse(description='Permission denied'), 404: OpenApiResponse(description='User not found')},
)
@api_view(['DELETE'])
@permission_classes([IsAuthenticated])
def delete_user(request, user_id):
    """DELETE /api/auth/users/<id>/ — Manager deletes user"""
    if not _is_manager(request.user):
        return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

    if request.user.id == user_id:
        return Response({'error': 'Cannot delete your own account'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

    # Admins cannot delete superusers
    if _is_superuser(user) and not _is_superuser(request.user):
        return Response({'error': 'Only superusers can delete superuser accounts'}, status=status.HTTP_403_FORBIDDEN)

    # Prevent deleting the last superuser
    if user.is_superuser or user.role == 'superuser':
        superuser_count = User.objects.filter(
            Q(is_superuser=True) | Q(role='superuser'),
            is_active=True
        ).count()
        if superuser_count <= 1:
            return Response({'error': 'Cannot delete the last superuser'}, status=status.HTTP_400_BAD_REQUEST)

    # Soft delete: deactivate instead of hard delete
    user.is_active = False
    user.save(update_fields=['is_active'])
    return Response({'success': True, 'message': 'User deleted (deactivated)'})


# ─── Forgot / Reset Password (self-service API) ───

def _generate_temp_password(length: int = 10) -> str:
    """A strong, readable temporary password (no ambiguous 0/O/1/l/I chars)."""
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
    return ''.join(secrets.choice(alphabet) for _ in range(length))


@extend_schema(
    tags=['Auth — Password Reset'],
    summary='Email a temporary password',
    description=(
        'If an active account exists for the given email, generates a temporary '
        'password, sets it on the account, and emails it to the user. Always '
        'returns 200 to avoid email enumeration.'
    ),
    request=ForgotPasswordSerializer,
    responses={200: OpenApiResponse(description='Temporary password sent (if email exists)')},
)
@api_view(['POST'])
@permission_classes([AllowAny])
def forgot_password(request):
    """POST /api/auth/forgot-password/ — Email a temporary password to the user."""
    serializer = ForgotPasswordSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    email = serializer.validated_data['email']

    try:
        user = User.objects.get(email=email, is_active=True)
        temp_password = _generate_temp_password()
        user.set_password(temp_password)
        user.save(update_fields=['password'])
        # Retire any pending link-based reset tokens for this user.
        PasswordResetToken.objects.filter(user=user, used=False).update(used=True)

        frontend = getattr(settings, 'FRONTEND_URL', 'http://localhost:3000').rstrip('/')
        # Dispatch via Celery so the request doesn't block on SMTP. Guard the
        # dispatch: if the broker is unreachable, .delay() raises — without this
        # the request 500s AND the password has already been rotated to a temp
        # value that was never delivered, locking the user out. Swallowing the
        # error keeps the response uniform (anti-enumeration) and lets the user
        # retry once the queue is back.
        try:
            send_notification_email.delay(
                recipient_email=user.email,
                subject="Your temporary Calari password",
                context={
                    "recipient_name": user.full_name or user.username,
                    "event_type": "",
                    "event_title": "Your temporary password",
                    "event_detail": (
                        f"Use this temporary password to sign in: {temp_password} — "
                        f"then change it from your profile right away. "
                        f"If you did not request this, contact your administrator."
                    ),
                    "actor_name": "Calari",
                    "project_name": "",
                    "portal_url": f"{frontend}/login",
                    "year": timezone.now().year,
                },
            )
        except Exception:  # noqa: BLE001 — broker/kombu errors must not leak or 500
            pass
    except User.DoesNotExist:
        pass  # Silent — don't reveal whether the email exists.

    return Response({
        'success': True,
        'message': 'If an account with that email exists, a temporary password has been sent to it.',
    })


@extend_schema(
    tags=['Auth — Password Reset'],
    summary='Confirm password reset',
    description='Validates the UUID reset token and sets the new password. Single-use, expires after 1 hour.',
    request=ResetPasswordConfirmSerializer,
    responses={200: OpenApiResponse(description='Password reset successfully'), 400: OpenApiResponse(description='Invalid, expired or already-used token')},
)
@api_view(['POST'])
@permission_classes([AllowAny])
def reset_password_confirm(request):
    """POST /api/auth/reset-password-confirm/ — Confirm reset with token and new password."""
    serializer = ResetPasswordConfirmSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)

    token_uuid = serializer.validated_data['token']
    new_password = serializer.validated_data['new_password']

    try:
        reset_token = PasswordResetToken.objects.select_related('user').get(token=token_uuid)
    except PasswordResetToken.DoesNotExist:
        return Response({'error': 'Invalid or expired reset link.'}, status=status.HTTP_400_BAD_REQUEST)

    if not reset_token.is_valid:
        return Response({'error': 'This reset link has expired or already been used.'}, status=status.HTTP_400_BAD_REQUEST)

    user = reset_token.user
    user.set_password(new_password)
    user.save()

    reset_token.used = True
    reset_token.save(update_fields=['used'])

    return Response({'success': True, 'message': 'Password has been reset successfully.'})
