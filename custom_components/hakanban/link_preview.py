"""Link previews: fetch a web page and pull out its title, description and image.

The panel can't fetch other sites itself (CORS), so it asks Home Assistant. Only public
addresses are fetched: a hostname that resolves to a private, loopback or link-local
address is refused (checked on every redirect, by the connector's resolver, so DNS can't
be swapped between check and connect). Results are cached in memory, failures too.

Deliberately free of Home Assistant imports so the tests can load it on its own.
"""

from __future__ import annotations

import ipaddress
import re
import time
from html.parser import HTMLParser
from typing import Any, Callable
from urllib.parse import urljoin, urlsplit

import aiohttp
from aiohttp.abc import AbstractResolver
from aiohttp.resolver import ThreadedResolver

USER_AGENT = "Mozilla/5.0 (compatible; Hakanban link preview; +https://github.com/neilellis/hakanban)"
MAX_BYTES = 1024 * 1024  # metadata lives in <head>; never read more than this
MAX_REDIRECTS = 5
TIMEOUT = aiohttp.ClientTimeout(total=10)
TTL_OK = 6 * 3600
TTL_FAIL = 600
CACHE_SIZE = 256

_IMAGE_KEYS = ("og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src")
_HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{3,8}$")
_META_CHARSET = re.compile(rb"""<meta[^>]+charset=["']?([\w-]+)""", re.I)

_CACHE: dict[str, tuple[float, dict[str, Any] | str]] = {}


class LinkPreviewError(Exception):
    """No preview for this URL (unreachable, refused, not a page, no metadata)."""


def is_public_address(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """True for addresses on the public internet (not private, loopback, link-local…)."""
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


# ---------------------------------------------------------------------- parsing
class _MetaParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.meta: dict[str, str] = {}
        self.icons: list[tuple[str, str]] = []  # (rel, href)
        self.title: str | None = None
        self._in_title = False
        self._title_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "meta":
            key = (a.get("property") or a.get("name") or "").strip().lower()
            if key and "content" in a and key not in self.meta:
                self.meta[key] = a["content"]
        elif tag == "link" and a.get("href"):
            rel = a.get("rel", "").lower().split()
            if "icon" in rel or "apple-touch-icon" in rel:
                self.icons.append((" ".join(rel), a["href"]))
        elif tag == "title" and self.title is None:
            self._in_title = True

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self._title_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "title" and self._in_title:
            self._in_title = False
            self.title = "".join(self._title_parts)


def _clean(text: str | None, limit: int) -> str | None:
    text = " ".join((text or "").split())
    if not text:
        return None
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _http_url(base: str, href: str | None) -> str | None:
    if not href or not href.strip():
        return None
    url = urljoin(base, href.strip())
    return url if urlsplit(url).scheme in ("http", "https") else None


def _host(url: str) -> str:
    host = urlsplit(url).hostname or ""
    return host[4:] if host.startswith("www.") else host


def parse_preview(html: str, url: str) -> dict[str, Any]:
    """Preview fields from a page's HTML; ``url`` is the page's (final) address."""
    parser = _MetaParser()
    parser.feed(html)
    meta = parser.meta
    image = next((u for k in _IMAGE_KEYS if (u := _http_url(url, meta.get(k)))), None)
    icons = sorted(parser.icons, key=lambda i: i[0] == "apple-touch-icon")
    icon = next((u for _, href in icons if (u := _http_url(url, href))), None)
    color = (meta.get("theme-color") or "").strip()
    return {
        "kind": "page",
        "url": url,
        "title": _clean(meta.get("og:title") or meta.get("twitter:title") or parser.title, 300),
        "description": _clean(
            meta.get("og:description") or meta.get("twitter:description") or meta.get("description"), 500
        ),
        "image": image,
        "site_name": _clean(meta.get("og:site_name") or meta.get("application-name"), 100) or _host(url),
        "icon": icon or urljoin(url, "/favicon.ico"),
        "color": color if _HEX_COLOR.match(color) else None,
        # The page asks for its image to be shown big (YouTube, news sites…).
        "large": bool(image) and meta.get("twitter:card", "").strip() == "summary_large_image",
    }


# ------------------------------------------------------------------------ fetch
class _GuardedResolver(AbstractResolver):
    """Resolves like aiohttp does, then drops every address ``allow`` refuses."""

    def __init__(self, allow: Callable[[Any], bool]) -> None:
        self._inner = ThreadedResolver()
        self._allow = allow

    async def resolve(self, host: str, port: int = 0, family: Any = 0) -> list[Any]:
        results = [
            r for r in await self._inner.resolve(host, port, family)
            if self._allow(ipaddress.ip_address(r["host"]))
        ]
        if not results:
            raise OSError(f"{host} has no public address")
        return results

    async def close(self) -> None:
        await self._inner.close()


def _check_url(url: str, allow: Callable[[Any], bool]) -> None:
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise LinkPreviewError("only http(s) links have previews")
    try:
        ip = ipaddress.ip_address(parts.hostname)
    except ValueError:
        return  # a hostname: the resolver checks what it resolves to
    if not allow(ip):
        raise LinkPreviewError("private addresses aren't fetched")


def _decode(body: bytes, charset: str | None) -> str:
    if not charset and (m := _META_CHARSET.search(body[:4096])):
        charset = m.group(1).decode("ascii", "ignore")
    try:
        return body.decode(charset or "utf-8", "replace")
    except LookupError:
        return body.decode("utf-8", "replace")


async def _fetch(url: str, allow: Callable[[Any], bool]) -> dict[str, Any]:
    connector = aiohttp.TCPConnector(resolver=_GuardedResolver(allow))
    headers = {"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml,image/*;q=0.8"}
    async with aiohttp.ClientSession(connector=connector, timeout=TIMEOUT, trust_env=False) as session:
        for _ in range(MAX_REDIRECTS + 1):
            _check_url(url, allow)
            async with session.get(url, headers=headers, allow_redirects=False) as resp:
                if resp.status in (301, 302, 303, 307, 308) and resp.headers.get("Location"):
                    url = urljoin(url, resp.headers["Location"])
                    continue
                if resp.status != 200:
                    raise LinkPreviewError(f"HTTP {resp.status}")
                if resp.content_type.startswith("image/"):
                    return {
                        "kind": "image", "url": url, "image": url, "title": None,
                        "description": None, "site_name": _host(url), "icon": None, "color": None, "large": True,
                    }
                if resp.content_type not in ("text/html", "application/xhtml+xml"):
                    raise LinkPreviewError(f"not a web page ({resp.content_type})")
                body = b""
                while len(body) < MAX_BYTES and (chunk := await resp.content.read(65536)):
                    body += chunk
                preview = parse_preview(_decode(body[:MAX_BYTES], resp.charset), url)
                if not (preview["title"] or preview["description"]):
                    raise LinkPreviewError("the page has no title or description")
                return preview
    raise LinkPreviewError("too many redirects")


async def async_fetch_preview(
    url: str,
    *,
    allow: Callable[[Any], bool] = is_public_address,
    cache: dict[str, tuple[float, dict[str, Any] | str]] | None = None,
) -> dict[str, Any]:
    """Preview for ``url`` (cached); raises LinkPreviewError when there isn't one."""
    cache = _CACHE if cache is None else cache
    now = time.monotonic()
    hit = cache.get(url)
    if hit and hit[0] > now:
        if isinstance(hit[1], str):
            raise LinkPreviewError(hit[1])
        return hit[1]
    try:
        result: dict[str, Any] | str = await _fetch(url, allow)
    except LinkPreviewError as err:
        result = str(err)
    except (aiohttp.ClientError, OSError, TimeoutError, ValueError) as err:
        result = f"couldn't fetch the page ({type(err).__name__})"
    cache.pop(url, None)
    cache[url] = (now + (TTL_FAIL if isinstance(result, str) else TTL_OK), result)
    while len(cache) > CACHE_SIZE:
        cache.pop(next(iter(cache)))
    if isinstance(result, str):
        raise LinkPreviewError(result)
    return result
