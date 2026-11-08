"""Pyscript Mail Intel Interface - Home Assistant Smart Mail & Deliveries.

Integrates with mail_intel_core, exposes pyscript.mail_intel_scan_now service,
schedules 10-minute cron polling, registers packages with 17Track, and publishes
sensor.mail_intel_dashboard_data.
"""

import sys
import re
import logging
import importlib

if "/config/mail_intel" not in sys.path:
    sys.path.append("/config/mail_intel")

import mail_intel_core
importlib.reload(mail_intel_core)

_LOGGER = logging.getLogger("mail_intel")
SEVENTEENTRACK_ENTRY_ID = "01M6KMKCDW0Z9932FXD5ZQE1WS"


def publish_state(data):
    if not data:
        return

    attrs = data.get("attributes", {})
    # Publish state and attributes to Home Assistant state machine
    state.set(
        "sensor.mail_intel_dashboard_data",
        value=data.get("state", "Active"),
        new_attributes=attrs
    )
    _LOGGER.info("sensor.mail_intel_dashboard_data published successfully.")

    # 17Track Integration Hook
    try:
        if service.has_service("seventeentrack", "add_package"):
            pkgs = attrs.get("delivering_today", []) + attrs.get("in_transit", [])
            for p in pkgs:
                t_num = p.get("tracking_number")
                if t_num and not t_num.startswith("AMZ-") and not t_num.startswith("ALI-") and not re.match(r"^\d{3}-\d{7}-\d{7}$", t_num):
                    friendly = f"{p.get('merchant_or_sender', 'Package')} - {p.get('items_summary', '')}".strip(" -")
                    service.call(
                        "seventeentrack",
                        "add_package",
                        package_tracking_number=t_num,
                        package_friendly_name=friendly[:50],
                        config_entry_id=SEVENTEENTRACK_ENTRY_ID
                    )
    except Exception as ex:
        _LOGGER.warning("17Track registration error: %s", ex)


@service
def mail_intel_scan_now():
    """Manual service trigger to scan IMAP and update sensor."""
    _LOGGER.info("pyscript.mail_intel_scan_now service invoked")
    data = task.executor(mail_intel_core.run_full_sync)
    publish_state(data)


@service
def mail_intel_toggle_mask(package_key=None, tracking_number=None):
    """Toggle is_masked flag for a package and immediately update sensor."""
    key = package_key or tracking_number
    if not key:
        _LOGGER.warning("mail_intel_toggle_mask called without package_key")
        return
    _LOGGER.info("Toggling mask for package: %s", key)
    data = task.executor(mail_intel_core.toggle_package_mask, key)
    publish_state(data)


@service
def mail_intel_hide_package(package_key=None, tracking_number=None):
    """Hide a package from dashboard and immediately update sensor."""
    key = package_key or tracking_number
    if not key:
        _LOGGER.warning("mail_intel_hide_package called without package_key")
        return
    _LOGGER.info("Hiding package: %s", key)
    data = task.executor(mail_intel_core.hide_package, key)
    publish_state(data)


@service
def mail_intel_unhide_all():
    """Unhide all packages and immediately update sensor."""
    _LOGGER.info("Unhiding all packages")
    data = task.executor(mail_intel_core.unhide_all_packages)
    publish_state(data)


@time_trigger("cron(*/10 * * * *)")
def mail_intel_cron():
    """Periodic 10-minute cron poll."""
    _LOGGER.info("Mail Intel periodic 10-minute scan triggered")
    data = task.executor(mail_intel_core.run_full_sync)
    publish_state(data)


@time_trigger("startup")
def mail_intel_startup():
    """Run initial scan upon Home Assistant startup."""
    _LOGGER.info("Mail Intel startup trigger running")
    data = task.executor(mail_intel_core.run_full_sync)
    publish_state(data)
