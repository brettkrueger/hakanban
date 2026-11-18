"""Tests for link_preview: page metadata parsing, the private-address guard and the fetch.

Needs aiohttp (Home Assistant ships it), but not Home Assistant itself. The fetch tests
run a real aiohttp server on 127.0.0.1; they pass an ``allow`` predicate that admits only
that address, so the private-address guard still refuses everything else.

Run:  python3 tests/test_link_preview.py
"""

import asyncio
import importlib.util
import ipaddress
import os
import sys

from aiohttp import web

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location(
    "link_preview", os.path.join(REPO, "custom_components", "hakanban", "link_preview.py")
)
lp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lp)

FAILED = []
PASSED = [0]


def check(name, cond, detail=""):
    if cond:
        PASSED[0] += 1
    else:
        FAILED.append(name)
        print(f"FAIL {name} {detail}")


# ----------------------------------------------------------------------- parsing
page = """<!doctype html><html><head>
<title>Fallback title</title>
<meta property="og:title" content="Tom &amp; Jerry&#39;s page">
<meta property="og:description" content="A   description
 over lines">
<meta property="og:image" content="/img/cover.png">
<meta property="og:site_name" content="Example">
<meta name="theme-color" content="#ff8800">
<link rel="shortcut icon" href="favicon-32.png">
</head><body><h1>hi</h1></body></html>"""
p = lp.parse_preview(page, "https://example.com/a/b?x=1")
check("og:title with entities", p["title"] == "Tom & Jerry's page", p)
check("description whitespace collapsed", p["description"] == "A description over lines", p)
check("relative og:image resolved", p["image"] == "https://example.com/img/cover.png", p)
check("site name", p["site_name"] == "Example", p)
check("theme colour", p["color"] == "#ff8800", p)
check("relative icon resolved", p["icon"] == "https://example.com/a/favicon-32.png", p)
check("kind page", p["kind"] == "page", p)
check("small image by default", p["large"] is False, p)
p = lp.parse_preview('<meta property="og:title" content="v"><meta property="og:image" content="https://i.example.com/v.jpg">'
                     '<meta name="twitter:card" content="summary_large_image">', "https://example.com/")
check("summary_large_image asks for a large image", p["large"] is True, p)
p = lp.parse_preview('<meta property="og:title" content="v"><meta name="twitter:card" content="summary_large_image">', "https://example.com/")
check("no image, not large", p["large"] is False, p)

p = lp.parse_preview(
    """<html><head><title> Just a
    title </title><meta name="description" content="Plain description">
    <meta name="twitter:image" content="https://cdn.example.com/t.jpg"></head></html>""",
    "https://example.com/",
)
check("<title> fallback", p["title"] == "Just a title", p)
check("meta description fallback", p["description"] == "Plain description", p)
check("twitter:image fallback", p["image"] == "https://cdn.example.com/t.jpg", p)
check("site name falls back to host", p["site_name"] == "example.com", p)
check("icon falls back to /favicon.ico", p["icon"] == "https://example.com/favicon.ico", p)
check("no theme colour", p["color"] is None, p)

p = lp.parse_preview(
    '<meta property="og:title" content="x"><meta property="og:image" content="javascript:alert(1)">'
    '<meta name="theme-color" content="red;background:url(x)">',
    "https://example.com/",
)
check("non-http image dropped", p["image"] is None, p)
check("unsafe colour dropped", p["color"] is None, p)

p = lp.parse_preview(f'<title>{"t" * 1000}</title><meta name="description" content="{"d" * 2000}">', "https://e.com/")
check("long title truncated", len(p["title"]) <= 300 and p["title"].endswith("…"), len(p["title"]))
check("long description truncated", len(p["description"]) <= 500 and p["description"].endswith("…"))

p = lp.parse_preview("<html><body>nothing here</body></html>", "https://example.com/x")
check("page without metadata has no title", p["title"] is None, p)


# ------------------------------------------------------------------ address guard
for addr, ok in [
    ("8.8.8.8", True),
    ("2606:4700:4700::1111", True),
    ("127.0.0.1", False),
    ("10.1.2.3", False),
    ("192.168.1.10", False),
    ("172.16.0.5", False),
    ("169.254.169.254", False),
    ("100.64.0.1", False),
    ("0.0.0.0", False),
    ("::1", False),
    ("fe80::1", False),
    ("fd00::1", False),
    ("::ffff:127.0.0.1", False),
]:
    check(f"is_public_address {addr}", lp.is_public_address(ipaddress.ip_address(addr)) is ok)


# ------------------------------------------------------------------------- fetch
LOOPBACK = ipaddress.ip_address("127.0.0.1")
only_loopback = lambda ip: ip == LOOPBACK  # noqa: E731

HITS = {"og": 0}


async def og(request):
    HITS["og"] += 1
    return web.Response(
        text='<html><head><meta property="og:title" content="Served"><meta property="og:image" content="/c.png"></head></html>',
        content_type="text/html",
    )


async def big(request):
    head = '<html><head><meta property="og:title" content="Big page"></head><body>'
    return web.Response(text=head + "x" * (3 * 1024 * 1024) + "</body></html>", content_type="text/html")


async def latin1(request):
    body = '<html><head><meta charset="iso-8859-1"><title>Café</title></head></html>'.encode("latin-1")
    return web.Response(body=body, headers={"Content-Type": "text/html; charset=iso-8859-1"})


async def image(request):
    return web.Response(body=b"\x89PNG....", content_type="image/png")


async def pdf(request):
    return web.Response(body=b"%PDF-1.4", content_type="application/pdf")


async def missing(request):
    return web.Response(status=404, text="<title>Not found</title>", content_type="text/html")


async def redirect(request):
    raise web.HTTPFound(request.query["to"])


async def loop_redirect(request):
    raise web.HTTPFound("/loop")


async def main():
    app = web.Application()
    app.add_routes([
        web.get("/og", og), web.get("/big", big), web.get("/latin1", latin1),
        web.get("/image.png", image), web.get("/doc.pdf", pdf), web.get("/missing", missing),
        web.get("/redirect", redirect), web.get("/loop", loop_redirect),
    ])
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    site2 = web.TCPSite(runner, "127.0.0.2", 0)
    await site2.start()
    base2 = f"http://127.0.0.2:{site2._server.sockets[0].getsockname()[1]}"
    try:
        cache = {}

        async def fetch(url, allow=only_loopback):
            return await lp.async_fetch_preview(url, allow=allow, cache=cache)

        async def refused(url, allow=only_loopback):
            try:
                await fetch(url, allow)
            except lp.LinkPreviewError:
                return True
            return False

        p = await fetch(f"{base}/og")
        check("fetches og metadata", p["title"] == "Served" and p["image"] == f"{base}/c.png", p)
        check("url is the page's", p["url"] == f"{base}/og", p)
        await fetch(f"{base}/og")
        check("second fetch served from cache", HITS["og"] == 1, HITS)

        p = await fetch(f"{base}/redirect?to=/og")
        check("follows redirects, reports final url", p["title"] == "Served" and p["url"] == f"{base}/og", p)

        p = await fetch(f"{base}/big")
        check("large page: reads only the start", p["title"] == "Big page", p)

        p = await fetch(f"{base}/latin1")
        check("decodes the declared charset", p["title"] == "Café", p)

        p = await fetch(f"{base}/image.png")
        check("image link previews as an image", p["kind"] == "image" and p["image"] == f"{base}/image.png", p)

        check("non-html refused", await refused(f"{base}/doc.pdf"))
        check("http error refused", await refused(f"{base}/missing"))
        check("redirect loop refused", await refused(f"{base}/loop"))
        check("failure is cached too", await refused(f"{base}/missing"))
        check("non-http scheme refused", await refused("file:///etc/passwd"))
        check("ftp refused", await refused("ftp://example.com/"))

        # The real guard (no loopback exemption):
        check("literal private IP refused", await refused(f"{base}/og?guard=1", allow=lp.is_public_address))
        check("hostname resolving to private IP refused",
              await refused(f"http://localhost:{port}/og", allow=lp.is_public_address))
        check("redirect to a private IP refused",
              await refused(f"{base}/redirect?to={base2}/og"))  # 127.0.0.2 is served, but not allowed
        # Start on 127.0.0.2 (allowed) and get redirected to a hostname (localhost) whose
        # addresses (127.0.0.1, ::1) aren't: the resolver must refuse it.
        only_second = lambda ip: ip == ipaddress.ip_address("127.0.0.2")  # noqa: E731
        check("second address reachable", (await fetch(f"{base2}/og", allow=only_second))["title"] == "Served")
        check("redirect to a private hostname refused",
              await refused(f"{base2}/redirect?to=http://localhost:{port}/og", allow=only_second))
    finally:
        await runner.cleanup()


asyncio.run(main())
print(f"{PASSED[0]} passed, {len(FAILED)} failed")
sys.exit(1 if FAILED else 0)
