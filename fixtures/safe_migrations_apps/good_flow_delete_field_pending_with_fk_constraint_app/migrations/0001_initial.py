# Generated by Django 3.1 on 2019-09-22 21:47
import django
from django.db import migrations, models

import sentry
from sentry.new_migrations.migrations import CheckedMigration


class Migration(CheckedMigration):

    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="FkTable",
            fields=[
                (
                    "id",
                    models.AutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
            ],
        ),
        migrations.CreateModel(
            name="TestTable",
            fields=[
                (
                    "id",
                    models.AutoField(
                        auto_created=True, primary_key=True, serialize=False, verbose_name="ID"
                    ),
                ),
                (
                    "fk_table",
                    sentry.db.models.fields.foreignkey.FlexibleForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        to="good_flow_delete_field_pending_with_fk_constraint_app.fktable",
                        db_index=False,
                        null=True,
                    ),
                ),
            ],
        ),
    ]
