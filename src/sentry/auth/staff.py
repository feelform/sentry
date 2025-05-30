from __future__ import annotations

import ipaddress
import logging
from datetime import datetime, timedelta, timezone

from django.conf import settings
from django.contrib.auth.models import AnonymousUser
from django.core.signing import BadSignature
from django.http import HttpRequest
from django.utils import timezone as django_timezone
from django.utils.crypto import constant_time_compare, get_random_string

from sentry import options
from sentry.auth.elevated_mode import ElevatedMode, InactiveReason
from sentry.auth.system import is_system_auth
from sentry.users.models.user import User
from sentry.utils.auth import has_completed_sso

logger = logging.getLogger("sentry.staff")

SESSION_KEY = "_staff"

COOKIE_NAME = getattr(settings, "STAFF_COOKIE_NAME", "staff")

COOKIE_SALT = getattr(settings, "STAFF_COOKIE_SALT", "")

COOKIE_SECURE = getattr(settings, "STAFF_COOKIE_SECURE", settings.SESSION_COOKIE_SECURE)

COOKIE_DOMAIN = getattr(settings, "STAFF_COOKIE_DOMAIN", settings.SESSION_COOKIE_DOMAIN)

COOKIE_PATH = getattr(settings, "STAFF_COOKIE_PATH", settings.SESSION_COOKIE_PATH)

COOKIE_HTTPONLY = getattr(settings, "STAFF_COOKIE_HTTPONLY", True)

# the maximum time the session can stay alive
MAX_AGE = timedelta(hours=2)

ALLOWED_IPS = frozenset(getattr(settings, "STAFF_ALLOWED_IPS", settings.INTERNAL_IPS) or ())

STAFF_ORG_ID = getattr(settings, "STAFF_ORG_ID", None)

UNSET = object()


def is_active_staff(request: HttpRequest) -> bool:
    if is_system_auth(getattr(request, "auth", None)):
        return True
    staff = getattr(request, "staff", None) or Staff(request)
    return staff.is_active


# TODO(schew2381): Delete after staff is GA'd and the options are removed
def has_staff_option(user: User | AnonymousUser) -> bool:
    """
    This checks two options, the first being whether or not staff has been GA'd.
    If not, it falls back to checking the second option which by email specifies which
    users staff is enabled for.
    """
    if options.get("staff.ga-rollout"):
        return True

    if (email := getattr(user, "email", None)) is None:
        return False
    return email in options.get("staff.user-email-allowlist")


def _seconds_to_timestamp(seconds: str) -> datetime:
    return datetime.fromtimestamp(float(seconds), timezone.utc)


class Staff(ElevatedMode):
    allowed_ips = frozenset(ipaddress.ip_network(str(v), strict=False) for v in ALLOWED_IPS)

    def __init__(self, request, allowed_ips=UNSET) -> None:
        self.uid: str | None = None
        self.request = request
        if allowed_ips is not UNSET:
            self.allowed_ips = frozenset(
                ipaddress.ip_network(str(v), strict=False) for v in allowed_ips or ()
            )
        self._populate()

    @property
    def is_active(self) -> bool:
        # We have a wsgi request with no user or user is None
        if not hasattr(self.request, "user") or self.request.user is None:
            return False
        # if we've been logged out
        if not self.request.user.is_authenticated:
            return False
        # if staff status was changed
        if not self.request.user.is_staff:
            return False
        # if the user has changed
        if str(self.request.user.id) != self.uid:
            return False
        return self._is_active

    def is_privileged_request(self) -> tuple[bool, InactiveReason]:
        """
        Returns ``(bool is_privileged, RequestStatus reason)``
        """
        allowed_ips = self.allowed_ips

        # _admin should have always completed SSO to gain status.
        # We expect ORG_ID to always be set in production.
        if STAFF_ORG_ID and not has_completed_sso(self.request, STAFF_ORG_ID):
            return False, InactiveReason.INCOMPLETE_SSO

        # if there's no IPs configured, we allow assume its the same as *
        if not allowed_ips:
            return True, InactiveReason.NONE
        ip = ipaddress.ip_address(str(self.request.META["REMOTE_ADDR"]))
        if not any(ip in addr for addr in allowed_ips):
            return False, InactiveReason.INVALID_IP
        return True, InactiveReason.NONE

    def get_session_data(self, current_datetime: datetime | None = None):
        """
        Return the current session data, with native types coerced.
        """
        request = self.request

        try:
            cookie_token = request.get_signed_cookie(
                key=COOKIE_NAME,
                default=None,
                salt=COOKIE_SALT,
                max_age=MAX_AGE.total_seconds(),
            )
        except BadSignature:
            logger.exception(
                "staff.bad-cookie-signature",
                extra={"ip_address": request.META["REMOTE_ADDR"], "user_id": request.user.id},
            )
            return

        data = request.session.get(SESSION_KEY)
        if not cookie_token:
            if data:
                logger.warning(
                    "staff.missing-cookie-token",
                    extra={"ip_address": request.META["REMOTE_ADDR"], "user_id": request.user.id},
                )
            return
        elif not data:
            logger.warning(
                "staff.missing-session-data",
                extra={"ip_address": request.META["REMOTE_ADDR"], "user_id": request.user.id},
            )
            return

        session_token = data.get("tok")
        if not session_token:
            logger.warning(
                "staff.missing-session-token",
                extra={"ip_address": request.META["REMOTE_ADDR"], "user_id": request.user.id},
            )
            return

        if not constant_time_compare(cookie_token, session_token):
            logger.warning(
                "staff.invalid-token",
                extra={"ip_address": request.META["REMOTE_ADDR"], "user_id": request.user.id},
            )
            return

        if data["uid"] != str(request.user.id):
            logger.warning(
                "staff.invalid-uid",
                extra={
                    "ip_address": request.META["REMOTE_ADDR"],
                    "user_id": request.user.id,
                    "expected_user_id": data["uid"],
                },
            )
            return

        if current_datetime is None:
            current_datetime = django_timezone.now()

        try:
            expires_date = _seconds_to_timestamp(data["exp"])
        except (TypeError, ValueError):
            logger.warning(
                "staff.invalid-expiration",
                extra={"ip_address": request.META["REMOTE_ADDR"], "user_id": request.user.id},
                exc_info=True,
            )
            return

        if expires_date < current_datetime:
            logger.info(
                "staff.session-expired",
                extra={"ip_address": request.META["REMOTE_ADDR"], "user_id": request.user.id},
            )
            return

        return data

    def _populate(self) -> None:
        current_datetime = django_timezone.now()

        request = self.request
        user = getattr(request, "user", None)
        if not hasattr(request, "session"):
            data = None
        elif not (user and user.is_staff):
            data = None
        else:
            data = self.get_session_data(current_datetime=current_datetime)

        if not data:
            self._set_logged_out()
        else:
            self._set_logged_in(
                expires=_seconds_to_timestamp(data["exp"]), token=data["tok"], user=user
            )

            if not self.is_active:
                if self._inactive_reason:
                    logger.warning(
                        "staff.%s",
                        self._inactive_reason,
                        extra={
                            "ip_address": request.META["REMOTE_ADDR"],
                            "user_id": request.user.id,
                        },
                    )
                else:
                    logger.warning(
                        "staff.inactive-unknown-reason",
                        extra={
                            "ip_address": request.META["REMOTE_ADDR"],
                            "user_id": request.user.id,
                        },
                    )

    def _set_logged_in(self, expires: datetime, token: str, user, current_datetime=None):
        # we bind uid here, as if you change users in the same request
        # we wouldn't want to still support staff auth (given
        # the staff check happens right here)
        assert user.is_staff
        if current_datetime is None:
            current_datetime = django_timezone.now()
        self.token: str | None = token
        self.uid = str(user.id)
        # do we have a valid staff session?
        self.is_valid = True
        # is the session active? (it could be valid, but inactive)
        self._is_active, self._inactive_reason = self.is_privileged_request()

        session_info = {
            "exp": expires.strftime("%s"),
            "tok": self.token,
            # XXX(dcramer): do we really need the uid safety mechanism
            "uid": self.uid,
        }
        # Only update the staff key in the session if it doesn't exist or has changed
        if (
            SESSION_KEY not in self.request.session
            or self.request.session[SESSION_KEY] != session_info
        ):
            self.request.session[SESSION_KEY] = session_info

    def _set_logged_out(self) -> None:
        self.uid = None
        self.token = None
        self._is_active = False
        self._inactive_reason = InactiveReason.NONE
        self.is_valid = False
        self.request.session.pop(SESSION_KEY, None)

    def set_logged_in(self, user: User | AnonymousUser, current_datetime=None) -> None:
        """
        Mark a session as staff-enabled.
        """
        request = self.request
        if current_datetime is None:
            current_datetime = django_timezone.now()

        self._set_logged_in(
            expires=current_datetime + MAX_AGE,
            token=get_random_string(12),
            user=user,
            current_datetime=current_datetime,
        )
        logger.info(
            "staff.logged-in",
            extra={"ip_address": request.META["REMOTE_ADDR"], "user_id": user.id},
        )

    def set_logged_out(self) -> None:
        """
        Mark a session as staff-disabled.
        """
        request = self.request
        self._set_logged_out()
        logger.info(
            "staff.logged-out",
            extra={"ip_address": request.META["REMOTE_ADDR"], "user_id": request.user.id},
        )

    def on_response(self, response) -> None:
        request = self.request

        # Re-bind the cookie
        if self.is_active:
            response.set_signed_cookie(
                COOKIE_NAME,
                self.token,
                salt=COOKIE_SALT,
                # set max_age to None, as we want this cookie to expire on browser close
                max_age=None,
                secure=request.is_secure() if COOKIE_SECURE is None else COOKIE_SECURE,
                httponly=COOKIE_HTTPONLY,
                path=COOKIE_PATH,
                domain=COOKIE_DOMAIN,
            )
        # otherwise if the session is invalid and there's a cookie set, clear it
        elif not self.is_valid and request.COOKIES.get(COOKIE_NAME):
            response.delete_cookie(COOKIE_NAME)
