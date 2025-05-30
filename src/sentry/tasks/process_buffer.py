import logging
from typing import Any

import sentry_sdk
from django.apps import apps
from django.conf import settings

from sentry.tasks.base import instrumented_task
from sentry.taskworker.config import TaskworkerConfig
from sentry.taskworker.namespaces import buffer_tasks
from sentry.utils.locking import UnableToAcquireLock
from sentry.utils.locking.lock import Lock

logger = logging.getLogger(__name__)


def get_process_lock(lock_name: str) -> Lock:
    from sentry.locks import locks

    return locks.get(f"buffer:{lock_name}", duration=60, name=lock_name)


@instrumented_task(
    name="sentry.tasks.process_buffer.process_pending",
    queue="buffers.process_pending",
    taskworker_config=TaskworkerConfig(
        namespace=buffer_tasks,
    ),
)
def process_pending() -> None:
    """
    Process pending buffers.
    """
    from sentry import buffer

    lock = get_process_lock("process_pending")

    try:
        with lock.acquire():
            buffer.backend.process_pending()
    except UnableToAcquireLock as error:
        logger.warning("process_pending.fail", extra={"error": error})


@instrumented_task(
    name="sentry.tasks.process_buffer.process_pending_batch",
    queue="buffers.process_pending_batch",
    taskworker_config=TaskworkerConfig(
        namespace=buffer_tasks,
    ),
)
def process_pending_batch() -> None:
    """
    Process pending buffers in a batch.
    """
    from sentry import buffer

    lock = get_process_lock("process_pending_batch")

    try:
        with lock.acquire():
            buffer.backend.process_batch()
    except UnableToAcquireLock as error:
        logger.warning("process_pending_batch.fail", extra={"error": error})


@instrumented_task(
    name="sentry.tasks.process_buffer.process_incr",
    queue="counters-0",
    taskworker_config=TaskworkerConfig(
        namespace=buffer_tasks,
    ),
)
def process_incr(
    columns: dict[str, int] | None = None,
    filters: dict[str, Any] | None = None,
    extra: dict[str, Any] | None = None,
    signal_only: bool | None = None,
    model_name: str | None = None,
    **kwargs,
):
    """
    Processes a buffer event.
    """
    from sentry import buffer

    model = None
    if model_name:
        assert "." in model_name, "model_name must be in form `sentry.Group`"
        model = apps.get_model(model_name)

    if model:
        sentry_sdk.set_tag("model", model._meta.model_name)

    buffer.backend.process(
        model=model,
        columns=columns,
        filters=filters,
        extra=extra,
        signal_only=signal_only,
        **kwargs,
    )


def buffer_incr(model, *args, **kwargs):
    """
    Call `buffer.incr` as a task on the given model, either directly or via celery depending on
    `settings.SENTRY_BUFFER_INCR_AS_CELERY_TASK`.

    See `Buffer.incr` for an explanation of the args and kwargs to pass here.
    """
    (buffer_incr_task.delay if settings.SENTRY_BUFFER_INCR_AS_CELERY_TASK else buffer_incr_task)(
        app_label=model._meta.app_label, model_name=model._meta.model_name, args=args, kwargs=kwargs
    )


@instrumented_task(
    name="sentry.tasks.process_buffer.buffer_incr_task",
    queue="buffers.incr",
    taskworker_config=TaskworkerConfig(
        namespace=buffer_tasks,
    ),
)
def buffer_incr_task(app_label: str, model_name: str, args: Any, kwargs: Any):
    """
    Call `buffer.incr`, resolving the model first.

    `model_name` must be in form `app_label.model_name` e.g. `sentry.group`.
    """
    from sentry import buffer

    sentry_sdk.set_tag("model", model_name)

    buffer.backend.incr(apps.get_model(app_label=app_label, model_name=model_name), *args, **kwargs)
