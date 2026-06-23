from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from .models import DashboardUser


@admin.register(DashboardUser)
class DashboardUserAdmin(UserAdmin):
    list_display = ['username', 'email', 'full_name', 'role', 'is_active',
                    'is_superuser', 'date_joined', 'last_login']
    list_filter = ['role', 'is_active', 'is_superuser']
    search_fields = ['username', 'email', 'full_name']
    fieldsets = UserAdmin.fieldsets + (
        ('Profile', {'fields': ('role', 'full_name', 'job_title',
                                'last_login_ip', 'profile_notes')}),
    )
