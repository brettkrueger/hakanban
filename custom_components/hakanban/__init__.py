"""The Hakanban integration — a Trello-style Kanban board native to Home Assistant."""

from __future__ import annotations

from datetime import timedelta

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.event import async_track_time_interval

from .const import AUTO_ARCHIVE_INTERVAL_MINUTES, DATA_MANAGER, DATA_UNSUB, DOMAIN
from .data import HakanbanData
from .frontend import async_register_frontend, async_unregister_panel
from .services import async_setup_services, async_unload_services
from .store import HakanbanStore
from .websocket_api import async_register_websocket_api

PLATFORMS: list[Platform] = [Platform.TODO, Platform.CALENDAR]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Hakanban from a config entry."""
    store = HakanbanStore(hass)
    manager = HakanbanData(hass, store)
    await manager.async_load()

    domain_data = hass.data.setdefault(DOMAIN, {})
    domain_data[DATA_MANAGER] = manager

    # Websocket API (panel + Lovelace card talk to this).
    async_register_websocket_api(hass)
    # hakanban.* services for automations / scripts / Assist.
    await async_setup_services(hass)
    # Static assets + sidebar panel + auto-loaded Lovelace card.
    await async_register_frontend(hass)

    # Each column becomes a todo entity grouped under its board device.
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Per-column "archive after N days": sweep now (catches up after downtime) and hourly.
    @callback
    def _auto_archive(_now=None) -> None:
        manager.auto_archive()

    _auto_archive()
    domain_data[DATA_UNSUB] = async_track_time_interval(
        hass, _auto_archive, timedelta(minutes=AUTO_ARCHIVE_INTERVAL_MINUTES)
    )
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        async_unregister_panel(hass)
        async_unload_services(hass)
        unsub = hass.data[DOMAIN].pop(DATA_UNSUB, None)
        if unsub:
            unsub()
        manager: HakanbanData = hass.data[DOMAIN][DATA_MANAGER]
        await manager.async_save_now()
        hass.data.pop(DOMAIN, None)
    return unload_ok
