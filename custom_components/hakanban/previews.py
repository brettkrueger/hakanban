"""Home Assistant side of link previews: the allow-list from the integration's options,
and the endpoint that serves preview images so viewers' browsers never contact the
linked sites themselves. The fetching and parsing live in link_preview.py."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from aiohttp import web
from yarl import URL

from homeassistant.components.http.auth import async_sign_path
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.http import KEY_HASS, HomeAssistantView

from .const import CONF_PREVIEW_HOSTS, DATA_PREVIEW_POLICY, DOMAIN, PREVIEW_IMAGE_URL
from .link_preview import LinkPreviewError, Policy, async_fetch_image, clear_cache

# How long a preview's image links work. The panel asks again after a reload.
IMAGE_LINK_LIFETIME = timedelta(hours=24)


def preview_policy(hass: HomeAssistant) -> Policy:
    return hass.data.get(DOMAIN, {}).get(DATA_PREVIEW_POLICY) or Policy()


def async_apply_options(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Load the allow-list from the entry's options; cached previews may now differ."""
    try:
        policy = Policy.from_text(entry.options.get(CONF_PREVIEW_HOSTS, ""))
    except ValueError:
        policy = Policy()  # the options form validates, so this is only hand-edited storage
    hass.data[DOMAIN][DATA_PREVIEW_POLICY] = policy
    clear_cache()


def proxied(preview: dict[str, Any], refresh_token_id: str | None, hass: HomeAssistant) -> dict[str, Any]:
    """The preview with its image and icon pointing at HA's image endpoint (signed for the
    asking user, since <img> can't send an auth header)."""

    def sign(url: str | None) -> str | None:
        if not url:
            return None
        path = str(URL(PREVIEW_IMAGE_URL).with_query({"url": url}))
        return async_sign_path(hass, path, IMAGE_LINK_LIFETIME, refresh_token_id=refresh_token_id)

    return {**preview, "image": sign(preview.get("image")), "icon": sign(preview.get("icon"))}


class PreviewImageView(HomeAssistantView):
    """GET /api/hakanban/preview_image?url=… — a link preview's image, fetched by HA."""

    url = PREVIEW_IMAGE_URL
    name = f"api:{DOMAIN}:preview_image"

    async def get(self, request: web.Request) -> web.Response:
        hass = request.app[KEY_HASS]
        try:
            body, content_type = await async_fetch_image(
                request.query.get("url", ""), policy=preview_policy(hass)
            )
        except LinkPreviewError:
            return web.Response(status=404)
        return web.Response(
            body=body,
            content_type=content_type,
            headers={
                "Cache-Control": "private, max-age=86400",
                "X-Content-Type-Options": "nosniff",
                "Content-Security-Policy": "default-src 'none'; sandbox",
            },
        )
