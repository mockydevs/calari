from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('Auth', '0005_dashboarduser_feature_permissions'),
    ]

    operations = [
        migrations.AddField(
            model_name='dashboarduser',
            name='deleted_at',
            field=models.DateTimeField(blank=True, db_index=True, editable=False, null=True),
        ),
    ]
