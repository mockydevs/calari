from rest_framework import serializers
from drf_spectacular.utils import extend_schema_field
from django.contrib.auth import get_user_model

User = get_user_model()


class LoginSerializer(serializers.Serializer):
    username_or_email = serializers.CharField()
    password = serializers.CharField(write_only=True)


class UserSerializer(serializers.ModelSerializer):
    effective_role = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'full_name', 'role',
            'effective_role', 'is_active', 'is_superuser', 'job_title',
            'date_joined', 'last_login', 'last_login_ip', 'profile_notes',
            'feature_permissions',
        ]
        read_only_fields = ['id', 'date_joined', 'last_login', 'last_login_ip']

    @extend_schema_field(serializers.ChoiceField(choices=['superuser', 'admin', 'viewer']))
    def get_effective_role(self, obj):
        """Return 'superuser' if Django is_superuser is set, regardless of role field."""
        if obj.is_superuser:
            return 'superuser'
        return obj.role


class RegisterSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    email = serializers.EmailField()
    full_name = serializers.CharField(max_length=255, required=False, default='')
    password = serializers.CharField(write_only=True, min_length=8)
    role = serializers.ChoiceField(choices=User.ROLE_CHOICES, default='viewer')
    job_title = serializers.CharField(max_length=255, required=False, default='')

    def validate_username(self, value):
        if User.objects.filter(username=value).exists():
            raise serializers.ValidationError("Username already exists.")
        return value

    def validate_email(self, value):
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError("Email already exists.")
        return value


class UpdateUserSerializer(serializers.Serializer):
    full_name = serializers.CharField(max_length=255, required=False)
    email = serializers.EmailField(required=False)
    role = serializers.ChoiceField(choices=User.ROLE_CHOICES, required=False)
    job_title = serializers.CharField(max_length=255, required=False)
    is_active = serializers.BooleanField(required=False)
    profile_notes = serializers.CharField(required=False, allow_blank=True)

    def validate_email(self, value):
        user = self.context.get('user_instance')
        if user and User.objects.filter(email=value).exclude(id=user.id).exists():
            raise serializers.ValidationError("Email already exists.")
        return value


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, min_length=8)
    confirm_password = serializers.CharField(write_only=True)

    def validate(self, data):
        if data['new_password'] != data['confirm_password']:
            raise serializers.ValidationError({"confirm_password": "Passwords do not match."})
        return data


class ResetPasswordSerializer(serializers.Serializer):
    user_id = serializers.IntegerField()
    new_password = serializers.CharField(write_only=True, min_length=8)
    confirm_password = serializers.CharField(write_only=True)

    def validate(self, data):
        if data['new_password'] != data['confirm_password']:
            raise serializers.ValidationError({"confirm_password": "Passwords do not match."})
        if not User.objects.filter(id=data['user_id']).exists():
            raise serializers.ValidationError({"user_id": "User not found."})
        return data


class ForgotPasswordSerializer(serializers.Serializer):
    email = serializers.EmailField()

    def validate_email(self, value):
        # Do NOT leak whether the email exists — validation is silent
        return value.lower().strip()


class ResetPasswordConfirmSerializer(serializers.Serializer):
    token = serializers.UUIDField()
    new_password = serializers.CharField(write_only=True, min_length=8)
    confirm_password = serializers.CharField(write_only=True)

    def validate(self, data):
        if data['new_password'] != data['confirm_password']:
            raise serializers.ValidationError({"confirm_password": "Passwords do not match."})
        return data


class UserSerializer(serializers.ModelSerializer):
    effective_role = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'full_name', 'role',
            'effective_role', 'is_active', 'is_superuser', 'job_title',
            'date_joined', 'last_login', 'last_login_ip', 'profile_notes',
            'feature_permissions',
        ]
        read_only_fields = ['id', 'date_joined', 'last_login', 'last_login_ip']

    @extend_schema_field(serializers.ChoiceField(choices=['superuser', 'admin', 'viewer']))
    def get_effective_role(self, obj):
        """Return 'superuser' if Django is_superuser is set, regardless of role field."""
        if obj.is_superuser:
            return 'superuser'
        return obj.role


class RegisterSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    email = serializers.EmailField()
    full_name = serializers.CharField(max_length=255, required=False, default='')
    password = serializers.CharField(write_only=True, min_length=8)
    role = serializers.ChoiceField(choices=User.ROLE_CHOICES, default='viewer')
    job_title = serializers.CharField(max_length=255, required=False, default='')

    def validate_username(self, value):
        if User.objects.filter(username=value).exists():
            raise serializers.ValidationError("Username already exists.")
        return value

    def validate_email(self, value):
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError("Email already exists.")
        return value


class UpdateUserSerializer(serializers.Serializer):
    full_name = serializers.CharField(max_length=255, required=False)
    email = serializers.EmailField(required=False)
    role = serializers.ChoiceField(choices=User.ROLE_CHOICES, required=False)
    job_title = serializers.CharField(max_length=255, required=False)
    is_active = serializers.BooleanField(required=False)
    profile_notes = serializers.CharField(required=False, allow_blank=True)

    def validate_email(self, value):
        user = self.context.get('user_instance')
        if user and User.objects.filter(email=value).exclude(id=user.id).exists():
            raise serializers.ValidationError("Email already exists.")
        return value


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, min_length=8)
    confirm_password = serializers.CharField(write_only=True)

    def validate(self, data):
        if data['new_password'] != data['confirm_password']:
            raise serializers.ValidationError({"confirm_password": "Passwords do not match."})
        return data


class ResetPasswordSerializer(serializers.Serializer):
    user_id = serializers.IntegerField()
    new_password = serializers.CharField(write_only=True, min_length=8)
    confirm_password = serializers.CharField(write_only=True)

    def validate(self, data):
        if data['new_password'] != data['confirm_password']:
            raise serializers.ValidationError({"confirm_password": "Passwords do not match."})
        if not User.objects.filter(id=data['user_id']).exists():
            raise serializers.ValidationError({"user_id": "User not found."})
        return data
