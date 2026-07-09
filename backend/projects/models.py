from django.db import models
from django.utils import timezone


# ─────────────────────────────────────────────────────────────
# Clients
# ─────────────────────────────────────────────────────────────
class Clients(models.Model):
    name = models.CharField(max_length=255)
    email = models.EmailField(unique=True)
    phone_number = models.CharField(max_length=20, blank=True)
    company_name = models.CharField(max_length=255, blank=True)
    # GoHighLevel sub-account (location) id — lets the AI progress auditor inspect this
    # client's real GHL account via the GHL MCP server. Non-secret; the token lives in env.
    ghl_location_id = models.CharField(max_length=120, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return self.name


# ─────────────────────────────────────────────────────────────
# Projects
# ─────────────────────────────────────────────────────────────
class Projects(models.Model):
    STATUS_CHOICES = [
        ('active', 'Active'),
        ('on_hold', 'On Hold'),
        ('completed', 'Completed'),
        ('cancelled', 'Cancelled'),
    ]
    PRIORITY_CHOICES = [
        ('low', 'Low'),
        ('medium', 'Medium'),
        ('high', 'High'),
        ('critical', 'Critical'),
    ]
    client = models.ForeignKey(Clients, on_delete=models.CASCADE, related_name='projects')
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='active')
    priority = models.CharField(max_length=20, choices=PRIORITY_CHOICES, default='medium')
    budget = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    start_date = models.DateField()
    end_date = models.DateField()
    created_at = models.DateTimeField(auto_now_add=True)
    assigned_to = models.ForeignKey(
        'Auth.DashboardUser', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='projects',
    )

    def __str__(self):
        return self.name


# ─────────────────────────────────────────────────────────────
# Project Co-Assignments
# ─────────────────────────────────────────────────────────────
class ProjectCoAssignment(models.Model):
    ROLE_CHOICES = [
        ('lead', 'Lead'),
        ('developer', 'Developer'),
        ('designer', 'Designer'),
        ('tester', 'Tester'),
        ('reviewer', 'Reviewer'),
        ('observer', 'Observer'),
    ]
    project = models.ForeignKey(Projects, on_delete=models.CASCADE, related_name='co_assignments')
    user = models.ForeignKey(
        'Auth.DashboardUser', on_delete=models.CASCADE, related_name='co_assigned_projects',
    )
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default='developer')
    assigned_by = models.ForeignKey(
        'Auth.DashboardUser', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='co_assignments_given',
    )
    assigned_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('project', 'user')

    def __str__(self):
        return f"{self.user} → {self.project.name} ({self.role})"


# ─────────────────────────────────────────────────────────────
# Project Milestones
# ─────────────────────────────────────────────────────────────
class ProjectMilestone(models.Model):
    project = models.ForeignKey(Projects, on_delete=models.CASCADE, related_name='milestones')
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    due_date = models.DateField()
    completed = models.BooleanField(default=False)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        'Auth.DashboardUser', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='created_milestones',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['due_date']

    def __str__(self):
        return f"{self.name} — {self.project.name}"


# ─────────────────────────────────────────────────────────────
# Project Activity Log
# ─────────────────────────────────────────────────────────────
class ProjectActivity(models.Model):
    project = models.ForeignKey(Projects, on_delete=models.CASCADE, related_name='activities')
    user = models.ForeignKey(
        'Auth.DashboardUser', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='project_activities',
    )
    action = models.CharField(max_length=100)
    detail = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.action} on {self.project.name}"


# ─────────────────────────────────────────────────────────────
# Project Files
# ─────────────────────────────────────────────────────────────
class ProjectFiles(models.Model):
    project = models.ForeignKey(Projects, on_delete=models.CASCADE, related_name='files')
    file_name = models.CharField(max_length=255)
    uploaded_by = models.ForeignKey('Auth.DashboardUser', on_delete=models.SET_NULL, null=True, blank=True)
    file = models.FileField(upload_to='project_files/')
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"File for {self.project.name} uploaded by {self.uploaded_by.display_name if self.uploaded_by else 'Unknown'}"


# ─────────────────────────────────────────────────────────────
# Project Contact Persons
# ─────────────────────────────────────────────────────────────
class ProjectContactPerson(models.Model):
    project = models.ForeignKey(Projects, on_delete=models.CASCADE, related_name='contacts')
    name = models.CharField(max_length=255)
    email = models.EmailField()
    phone_number = models.CharField(max_length=20, blank=True)
    role = models.CharField(max_length=255, blank=True)

    def __str__(self):
        return f"{self.name} ({self.role}) - {self.project.name}"


# ─────────────────────────────────────────────────────────────
# Project Blockers
# ─────────────────────────────────────────────────────────────
class projectBlockers(models.Model):
    project = models.ForeignKey(Projects, on_delete=models.CASCADE, related_name='blockers')
    description = models.TextField()
    attachment = models.FileField(upload_to='project_blocker_attachments/', blank=True, null=True)
    reported_by = models.ForeignKey('Auth.DashboardUser', on_delete=models.SET_NULL, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    resolved = models.BooleanField(default=False)
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolved_by = models.ForeignKey(
        'Auth.DashboardUser', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='resolved_project_blockers',
    )

    def __str__(self):
        return f"Blocker for {self.project.name} reported by {self.reported_by.display_name if self.reported_by else 'Unknown'} ({'Resolved' if self.resolved else 'Unresolved'})"


# ─────────────────────────────────────────────────────────────
# Task Labels (global, reusable across projects)
# ─────────────────────────────────────────────────────────────
class TaskLabel(models.Model):
    name = models.CharField(max_length=50, unique=True)
    color = models.CharField(max_length=7, default='#4F8EF7')  # hex colour
    created_by = models.ForeignKey(
        'Auth.DashboardUser', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='created_labels',
    )

    def __str__(self):
        return self.name


# ─────────────────────────────────────────────────────────────
# Tasks
# ─────────────────────────────────────────────────────────────
class Tasks(models.Model):
    STATUS_CHOICES = [
        ('todo', 'To Do'),
        ('in_progress', 'In Progress'),
        ('in_review', 'In Review'),
        ('done', 'Done'),
    ]
    PRIORITY_CHOICES = [
        ('low', 'Low'),
        ('medium', 'Medium'),
        ('high', 'High'),
        ('critical', 'Critical'),
    ]
    project = models.ForeignKey(Projects, on_delete=models.CASCADE, related_name='tasks')
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='todo')
    priority = models.CharField(max_length=20, choices=PRIORITY_CHOICES, default='medium')
    assigned_to = models.ForeignKey(
        'Auth.DashboardUser', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='assigned_tasks',
    )
    labels = models.ManyToManyField(TaskLabel, blank=True, related_name='tasks')
    due_date = models.DateField(null=True, blank=True)
    estimated_hours = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    actual_hours = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        'Auth.DashboardUser', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='created_tasks',
    )
    completed_at = models.DateTimeField(null=True, blank=True)
    completed_by = models.ForeignKey(
        'Auth.DashboardUser', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='completed_tasks',
    )

    class Meta:
        ordering = ['due_date', '-created_at']

    @property
    def completed(self):
        return self.status == 'done'

    def save(self, *args, **kwargs):
        # Auto-set completed_at when status moves to done
        if self.status == 'done' and not self.completed_at:
            self.completed_at = timezone.now()
        elif self.status != 'done':
            self.completed_at = None
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.name} - {self.project.name} ({self.get_status_display()})"


# ─────────────────────────────────────────────────────────────
# Task Files
# ─────────────────────────────────────────────────────────────
class TaskFiles(models.Model):
    task = models.ForeignKey(Tasks, on_delete=models.CASCADE, related_name='files')
    file_name = models.CharField(max_length=255)
    uploaded_by = models.ForeignKey('Auth.DashboardUser', on_delete=models.SET_NULL, null=True, blank=True)
    file = models.FileField(upload_to='task_files/')
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"File for {self.task.name} uploaded by {self.uploaded_by.display_name if self.uploaded_by else 'Unknown'}"


# ─────────────────────────────────────────────────────────────
# Task Blockers
# ─────────────────────────────────────────────────────────────
class TaskBlockers(models.Model):
    task = models.ForeignKey(Tasks, on_delete=models.CASCADE, related_name='blockers')
    description = models.TextField()
    attachment = models.FileField(upload_to='blocker_attachments/', blank=True, null=True)
    reported_by = models.ForeignKey('Auth.DashboardUser', on_delete=models.SET_NULL, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    resolved = models.BooleanField(default=False)
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolved_by = models.ForeignKey(
        'Auth.DashboardUser', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='resolved_task_blockers',
    )

    def __str__(self):
        return f"Blocker for {self.task.name} reported by {self.reported_by.display_name if self.reported_by else 'Unknown'} ({'Resolved' if self.resolved else 'Unresolved'})"


# ─────────────────────────────────────────────────────────────
# Task Comments
# ─────────────────────────────────────────────────────────────
class TaskComment(models.Model):
    task = models.ForeignKey(Tasks, on_delete=models.CASCADE, related_name='comments')
    author = models.ForeignKey(
        'Auth.DashboardUser', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='task_comments',
    )
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f"Comment by {self.author} on {self.task.name}"


# ─────────────────────────────────────────────────────────────
# Task Checklist (subtasks)
# ─────────────────────────────────────────────────────────────
class TaskChecklist(models.Model):
    task = models.ForeignKey(Tasks, on_delete=models.CASCADE, related_name='checklist')
    title = models.CharField(max_length=255)
    completed = models.BooleanField(default=False)
    completed_by = models.ForeignKey(
        'Auth.DashboardUser', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='completed_checklist_items',
    )
    completed_at = models.DateTimeField(null=True, blank=True)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['order', 'id']

    def __str__(self):
        return f"[{'x' if self.completed else ' '}] {self.title}"


# ─────────────────────────────────────────────────────────────
# Task Activity Log
# ─────────────────────────────────────────────────────────────
class TaskActivity(models.Model):
    task = models.ForeignKey(Tasks, on_delete=models.CASCADE, related_name='activities')
    user = models.ForeignKey(
        'Auth.DashboardUser', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='task_activities',
    )
    action = models.CharField(max_length=100)
    detail = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.action} on {self.task.name}"