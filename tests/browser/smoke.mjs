// Browser smoke test: drives the real panel (tests/browser/index.html, backed by
// mock-hass.js) in headless Chromium over the DevTools protocol.
//
//   node tests/browser/smoke.mjs [screenshot-dir]
//
// Needs Node 22+ and Chromium (set CHROME=/path/to/chrome if it isn't `chromium`). Serves
// the repo itself on a free port; exits non-zero if any check fails.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";

const REPO = resolve(import.meta.dirname, "../..");
const SHOTS = process.argv[2] || null;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };

const server = createServer((req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
  // Stand-in for HA's link-preview image endpoint.
  if (path === "/api/hakanban/preview_image") path = "/custom_components/hakanban/brand/icon.png";
  try {
    const body = readFileSync(join(REPO, path));
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;
const URL_ = `http://127.0.0.1:${PORT}/tests/browser/index.html`;

const profile = mkdtempSync(join(tmpdir(), "hakanban-smoke-"));
const DEVTOOLS = 9333;
const chrome = spawn(process.env.CHROME || "chromium", [
  "--headless=new", `--remote-debugging-port=${DEVTOOLS}`, "--no-first-run",
  `--user-data-dir=${profile}`, "--window-size=1500,950", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, seq = 0;
const pending = new Map();
function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej }));
}
async function ev(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(expr.slice(0, 80) + " => " + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}
async function shot(name) {
  if (!SHOTS) return;
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(r.data, "base64"));
}
// A trusted mouse click at the element's centre (scrolled into view first).
async function realClick(expr) {
  const [x, y] = await ev(`(() => { const el = (${expr}); el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
  for (const type of ["mousePressed", "mouseReleased"]) {
    await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  }
  await sleep(60);
}
const results = [];
function check(name, ok, extra = "") {
  results.push([name, !!ok]);
  console.log((ok ? "PASS" : "FAIL") + " - " + name + (extra && !ok ? "  " + extra : ""));
}

// helpers injected into the page
const H = `
  window.P = () => document.querySelector("hakanban-panel").shadowRoot;
  window.B = () => P().querySelector("hakanban-board").shadowRoot;
  window.D = () => { const h = [...document.querySelectorAll(".hakanban-dialog-host")].pop(); return h && h.shadowRoot; };
  window.M = () => { const m = document.querySelector("hakanban-card-detail"); return m && m.shadowRoot; };
  window.visibleTitles = () => [...B().querySelectorAll(".hk-card .hk-card-title")].map(e => e.textContent);
  window.cardEl = (t) => [...B().querySelectorAll(".hk-card")].find(e => e.querySelector(".hk-card-title").textContent === t);
  window.tick = () => new Promise(r => setTimeout(r, 30));
  true;
`;

try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEVTOOLS}/json`)).json();
      target = list.find((t) => t.type === "page");
    } catch { await sleep(100); }
  }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Network.setCacheDisabled", { cacheDisabled: true });
  await send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: URL_ });
  await sleep(1500);
  await ev(H);
  // Auto-accept confirm() in the harness (dialogs block CDP otherwise).
  await ev(`window.confirm = () => true; true`);
  const C = (t) => `P().querySelector("hakanban-board").board.columns.flatMap(x => x.cards).find(c => c.title === "${t}")`;

  // ---- board render
  const titles = await ev(`visibleTitles()`);
  check("board renders cards", titles.length === 7, JSON.stringify(titles));
  check("archived card hidden from board", !titles.includes("Old archived thing"));
  check("epic card has EPIC tag + progress", await ev(`!!cardEl("Kitchen renovation").querySelector(".hk-epic-tag") && cardEl("Kitchen renovation").textContent.includes("1/2")`));
  check("child shows epic ref", await ev(`(cardEl("Pick tiles").querySelector(".hk-epic-ref")||{}).textContent?.includes("Kitchen renovation")`));
  check("archive badge counts 1", await ev(`P().querySelector("#archive-btn .hk-count")?.textContent === "1"`));
  await shot("01-board");

  // ---- filters
  await ev(`P().querySelector("#filter-btn").click(); tick()`);
  check("filter bar opens", await ev(`!!P().querySelector(".hk-filterbar")`));
  const epicId = await ev(`(() => { const o=[...P().querySelectorAll('[data-fsel="epic"] option')].find(o=>o.textContent.includes("Kitchen")); return o && o.value; })()`);
  await ev(`(() => { const s=P().querySelector('[data-fsel="epic"]'); s.value=${JSON.stringify(epicId)}; s.dispatchEvent(new Event("change")); return tick(); })()`);
  check("epic filter shows epic + children", JSON.stringify((await ev(`visibleTitles()`)).sort()) === JSON.stringify(["Kitchen renovation", "Pick tiles", "Remove old cabinets"]), JSON.stringify(await ev(`visibleTitles()`)));
  check("filter badge shows 1", await ev(`P().querySelector("#filter-btn .hk-count")?.textContent === "1"`));
  await ev(`P().querySelector('[data-fseg="status"][data-v="open"]').click(); tick()`);
  check("status=open hides completed", JSON.stringify((await ev(`visibleTitles()`)).sort()) === JSON.stringify(["Kitchen renovation", "Pick tiles"]));
  await shot("02-filters");
  await ev(`P().querySelector("[data-clearf]").click(); tick()`);
  check("clear filters restores all", (await ev(`visibleTitles()`)).length === 7);
  await ev(`(() => { const s=P().querySelector('[data-fsel="due"]'); s.value="overdue"; s.dispatchEvent(new Event("change")); return tick(); })()`);
  check("due=overdue", JSON.stringify(await ev(`visibleTitles()`)) === JSON.stringify(["Walk the dog"]));
  await ev(`P().querySelector("[data-clearf]").click(); tick()`);
  await ev(`P().querySelector('[data-fseg="type"][data-v="epic"]').click(); tick()`);
  check("type=epic", JSON.stringify(await ev(`visibleTitles()`)) === JSON.stringify(["Kitchen renovation"]));
  await ev(`P().querySelector("[data-clearf]").click(); tick()`);
  // label any vs all
  await ev(`P().querySelector('[data-flabel="green"]').click(); tick()`);
  await ev(`P().querySelector('[data-flabel="red"]').click(); tick()`);
  check("labels any (green|red)", (await ev(`visibleTitles()`)).length === 3, JSON.stringify(await ev(`visibleTitles()`)));
  await ev(`P().querySelector('[data-fseg="labelMode"][data-v="all"]').click(); tick()`);
  check("labels all (green&red)", JSON.stringify(await ev(`visibleTitles()`)) === JSON.stringify(["Pick tiles"]));
  await ev(`P().querySelector("[data-clearf]").click(); tick()`);
  await ev(`P().querySelector("#filter-btn").click(); tick()`);

  // ---- label manager
  await ev(`P().querySelector("#labels-btn").click(); tick()`);
  check("label manager opens with 3 labels", await ev(`D().querySelectorAll(".hk-lm-row").length === 3`));
  await ev(`(async () => { const i=D().querySelector('[data-name="green"]'); i.value="Errand"; i.dispatchEvent(new Event("change")); await tick(); })()`);
  check("rename label", await ev(`window.__mockHass && P().querySelector('[data-board]') && D().querySelector('[data-name="green"]').value === "Errand"`) && await ev(`cardEl("Buy milk").querySelector(".hk-label").textContent === "Errand"`));
  await ev(`(async () => { D().querySelector('[data-pick="blue"]').click(); await tick(); D().querySelector('[data-recolor="#ff78cb"]').click(); await tick(); })()`);
  check("recolor label", await ev(`cardEl("Kitchen renovation").querySelector(".hk-label").style.background.includes("255, 120, 203")`));
  await ev(`(async () => { const i=D().querySelector("#hk-lm-new"); i.value="Urgent"; D().querySelector('[data-newcolor="#344563"]').click(); D().querySelector("#hk-lm-add").click(); await tick(); })()`);
  check("add label", await ev(`D().querySelectorAll(".hk-lm-row").length === 4`));
  await shot("03-labels");
  await ev(`(async () => { D().querySelector('[data-del="red"]').click(); await tick(); })()`);
  check("delete label strips cards", await ev(`D().querySelectorAll(".hk-lm-row").length === 3 && !cardEl("Walk the dog").querySelector(".hk-label")`));
  await ev(`D().querySelector("#hk-lm-done").click(); tick()`);
  check("label manager closes", await ev(`!D()`));

  // ---- list settings / auto-archive
  await ev(`B().querySelector('[data-colsettings="c3"]').click(); tick()`);
  check("list settings opens", await ev(`!!D() && !!D().querySelector("#hk-cs-auto")`));
  await ev(`(async () => { const a=D().querySelector("#hk-cs-auto"); a.checked=true; a.dispatchEvent(new Event("change")); D().querySelector("#hk-cs-days").value="14"; D().querySelector("#hk-cs-save").click(); await tick(); })()`);
  check("column shows auto-archive badge", await ev(`B().querySelector('.hk-col[data-col="c3"] .hk-col-auto')?.textContent.includes("14d")`));
  check("update_column sent days", await ev(`window.__hkLog.includes("update_column")`));
  await shot("04-list-auto");

  // ---- archive drawer
  await ev(`P().querySelector("#archive-btn").click(); tick()`);
  check("archive lists 1 card", await ev(`D().querySelectorAll(".hk-archive-item").length === 1`));
  await shot("05-archive");
  await ev(`(async () => { D().querySelector("[data-restore]").click(); await tick(); })()`);
  check("restore empties archive", await ev(`D().querySelectorAll(".hk-archive-item").length === 0`));
  check("restored card back on board", (await ev(`visibleTitles()`)).includes("Old archived thing"));
  await ev(`D().querySelector("[data-close]").click(); tick()`);

  // ---- epic card modal
  await ev(`cardEl("Kitchen renovation").click(); tick()`);
  check("epic modal shows children", await ev(`M().querySelectorAll(".hk-epic-child").length === 2`));
  await ev(`(async () => { const i=M().querySelector("#hk-epic-new"); i.value="Order worktop"; i.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter"})); await tick(); })()`);
  check("new child created in epic", await ev(`M().querySelectorAll(".hk-epic-child").length === 3`) && await ev(`cardEl("Order worktop")?.closest(".hk-col").dataset.col === "c1"`));
  await ev(`(async () => { const s=M().querySelector("#hk-epic-link"); const o=[...s.options].find(o=>o.textContent.includes("Buy milk")); s.value=o.value; s.dispatchEvent(new Event("change")); await tick(); })()`);
  check("link existing card", await ev(`M().querySelectorAll(".hk-epic-child").length === 4`));
  await shot("06-epic-modal");
  await ev(`(async () => { M().querySelector(".hk-epic-child [data-unlink]").click(); await tick(); })()`);
  check("unlink child", await ev(`M().querySelectorAll(".hk-epic-child").length === 3`));
  await ev(`(async () => { M().querySelector('.hk-epic-child[data-open-card]').click(); await tick(); })()`);
  check("clicking child opens it", await ev(`!!M().querySelector("#hk-epic")`));
  check("child's epic select shows parent", await ev(`M().querySelector("#hk-epic").selectedOptions[0].textContent.includes("Kitchen")`));
  await shot("07-child-modal");
  await ev(`(async () => { const s=M().querySelector("#hk-epic"); s.value=""; s.dispatchEvent(new Event("change")); await tick(); })()`);
  check("detach via select", await ev(`M().querySelector("#hk-epic").value === ""`));
  await ev(`(async () => { M().querySelector('[data-type="epic"]').click(); await tick(); })()`);
  check("promote to epic", await ev(`!!M().querySelector("#hk-epic-new")`));
  await ev(`(async () => { M().querySelector('#hk-manage-labels').click(); await tick(); })()`);
  check("edit labels from card modal", await ev(`!!D() && D().querySelectorAll(".hk-lm-row").length === 3`));
  await ev(`D().querySelector("#hk-lm-done").click(); tick()`);
  await ev(`(async () => { M().querySelector('#hk-archive').click(); await tick(); })()`);
  check("archived card modal stays open with banner", await ev(`!!M()?.querySelector(".hk-archived-banner")`));
  await ev(`M().querySelector("#hk-close").click(); tick()`);

  // ---- link previews
  await ev(`document.addEventListener("click", (e) => { if (e.composedPath()[0].closest?.("a[href^='http']")) e.preventDefault(); }, true); true`);
  const wait = (ms = 150) => ev(`new Promise(r => setTimeout(r, ${ms}))`);
  check("board renders", (await ev(`visibleTitles()`)).length > 3);
  await ev(`cardEl("Write the report").querySelector(".hk-card-title").click(); tick()`);
  await ev(`(async () => { M().querySelector("#hk-desc-render").click(); await tick(); })()`);
  await ev(`(async () => {
    M().querySelector("#hk-desc").value = "Read https://example.com/article. Also <https://quiet.example.com/x> and https://nopreview.example.com/ and [ours](" + location.origin + "/hakanban/card/x)";
    M().querySelector("#hk-desc-save").click(); await tick();
  })()`);
  check("bare URLs in the description are links",
    await ev(`[...M().querySelectorAll("#hk-desc-render a")].map(a => a.getAttribute("href")).join(" ")`) ===
      `https://example.com/article https://quiet.example.com/x https://nopreview.example.com/ ${await ev("location.origin")}/hakanban/card/x`);
  check("trailing full stop stays outside the link", await ev(`M().querySelector("#hk-desc-render").textContent.includes("article. Also")`));
  check("<url> is linked without brackets, marked no-preview",
    await ev(`(() => { const a = M().querySelector('#hk-desc-render a[href="https://quiet.example.com/x"]'); return !!a && a.hasAttribute("data-noembed") && !M().querySelector("#hk-desc-render").textContent.includes("<https"); })()`));
  await wait();
  check("only the previewable URLs were fetched", JSON.stringify(await ev(`__previewCalls`)) === JSON.stringify(["https://example.com/article", "https://nopreview.example.com/"]), JSON.stringify(await ev(`__previewCalls`)));
  check("description shows one preview", await ev(`M().querySelectorAll(".hk-section .hk-embeds .hk-embed").length`) === 1);
  check("preview: site, title link, description, colour",
    await ev(`(() => { const e = M().querySelector(".hk-embed"); const t = e.querySelector("a.hk-embed-title");
      return e.querySelector(".hk-embed-site").textContent.trim() === "Example News" && t.textContent === "An example article"
        && t.getAttribute("href") === "https://example.com/article" && t.target === "_blank"
        && e.querySelector(".hk-embed-desc").textContent.startsWith("What the article") && e.style.borderLeftColor === "rgb(255, 136, 0)"; })()`));
  check("no placeholders left behind", await ev(`M().querySelectorAll(".hk-embed.loading").length`) === 0);
  await realClick(`M().querySelector('#hk-desc-render a[href="https://example.com/article"]')`);
  check("clicking a link doesn't open the description editor", await ev(`!M().querySelector("#hk-desc") && !!M().querySelector("#hk-desc-render")`));

  // comments
  const comment = (t) => ev(`(async () => { const i = M().querySelector("#hk-comment"); i.value = ${JSON.stringify(t)}; M().querySelector("#hk-comment-add").click(); await tick(); })()`);
  await comment("watch https://video.example.com/watch?v=1&t=2 later");
  await comment("look https://img.example.com/cat.png");
  await comment("broken https://broken.example.com/");
  await wait(250);
  check("comment URL is a link (with &)", await ev(`!!M().querySelector('.hk-comment a[href="https://video.example.com/watch?v=1&t=2"]')`));
  check("comment preview sits inside the comment's text block, after the link",
    await ev(`(() => { const c = [...M().querySelectorAll(".hk-comment")].find(c => c.textContent.includes("watch")); const t = c.querySelector(".hk-comment-text"); return !!t && t.innerHTML.indexOf("hk-embeds") > t.innerHTML.indexOf("video.example.com/watch"); })()`));
  check("comment shows a large preview", await ev(`(() => { const c = [...M().querySelectorAll(".hk-comment")].find(c => c.textContent.includes("watch")); const e = c.querySelector(".hk-embed.large"); return !!e && e.querySelector(".hk-embed-title").textContent === "A video"; })()`));
  check("image link shows the image", await ev(`(() => { const c = [...M().querySelectorAll(".hk-comment")].find(c => c.textContent.includes("look")); const a = c.querySelector("a.hk-embed-image"); return !!a && a.getAttribute("href") === "https://img.example.com/cat.png" && !!a.querySelector("img"); })()`));
  check("broken preview image is removed, preview kept", await ev(`(() => { const c = [...M().querySelectorAll(".hk-comment")].find(c => c.textContent.includes("broken")); const e = c.querySelector(".hk-embed"); return !!e && !e.querySelector("img"); })()`));
  await shot("lp-1-modal");
  await ev(`M().querySelector(".hk-comment").scrollIntoView({ block: "start" }); true`); await sleep(100); await shot("lp-1b-comments");
  await realClick(`[...M().querySelectorAll(".hk-comment")].find(c => c.textContent.includes("look")).querySelector("a.hk-embed-image img")`);
  check("image preview loads fine", await ev(`[...M().querySelectorAll(".hk-comment")].find(c => c.textContent.includes("look")).querySelector("img").naturalWidth > 0`));

  // re-render from a push keeps previews without refetching
  const calls = (await ev(`__previewCalls`)).length;
  await ev(`(async () => { await __panel._api.updateCard(${C("Write the report")}.id, { title: "Write the report!" }); await tick(); })()`);
  check("previews survive a re-render, no refetch", await ev(`M().querySelectorAll(".hk-embeds > :not(.loading)").length`) === 4 && (await ev(`__previewCalls`)).length === calls);
  await ev(`(async () => { await __panel._api.updateCard(${C("Write the report!")}.id, { title: "Write the report" }); await tick(); })()`);

  // checklist items: linked, no preview, clicking the link doesn't start editing
  await ev(`(async () => { const id = ${C("Write the report")}.id; const cl = await __panel._api.addChecklist(id, "Links"); await __panel._api.addCheckItem(id, cl.id, "see https://example.com/article"); await tick(); })()`);
  check("checklist item URL is a link", await ev(`!!M().querySelector('.hk-check-text a[href="https://example.com/article"]')`));
  check("checklist item has no preview", await ev(`!M().querySelector(".hk-check-item .hk-embed")`));
  await realClick(`M().querySelector('.hk-check-text a[href="https://example.com/article"]')`);
  check("clicking a checklist link doesn't start editing", await ev(`!M().querySelector(".hk-check-edit")`));

  // board tile title isn't linkified (it's a drag handle / opens the card)
  await ev(`M().querySelector("#hk-close").click(); tick()`);
  await ev(`(async () => { await __panel._api.updateCard(${C("Write the report")}.id, { title: "Write https://example.com/article" }); await tick(); })()`);
  check("board card title URL stays plain text", await ev(`!cardEl("Write https://example.com/article").querySelector(".hk-card-title a")`));
  await shot("lp-2-board");

  // ---- the board shows no previews (only the open card does)
  const previewCallsBeforeBoard = (await ev(`__previewCalls`)).length;
  await wait(200);
  check("board card shows no link preview", await ev(`!cardEl("Write https://example.com/article").querySelector(".hk-embed, .hk-embeds, img")`));
  await ev(`(async () => { await __panel._api.updateCard(${C("Buy milk")}.id, { description: "like https://img.example.com/cat.png" }); await tick(); })()`);
  await wait(200);
  check("board card with an image link shows no image", await ev(`!cardEl("Buy milk").querySelector("img")`));
  check("board never asks for previews", (await ev(`__previewCalls`)).length === previewCallsBeforeBoard);
  await shot("lp-3-board");

  // ---- previews sit right under the line with their link
  await ev(`cardEl("Buy milk").querySelector(".hk-card-title").click(); tick()`);
  await ev(`(async () => { M().querySelector("#hk-desc-render").click(); await tick(); })()`);
  await ev(`(async () => {
    M().querySelector("#hk-desc").value = "Intro line\\nRead https://example.com/article now\\nAfter line\\n- item https://video.example.com/watch?v=1&t=2\\nLast line";
    M().querySelector("#hk-desc-save").click(); await tick();
  })()`);
  await wait(200);
  const descOrder = await ev(`(() => { const h = M().querySelector("#hk-desc-render").innerHTML;
    return [h.indexOf("Intro line"), h.indexOf("example.com/article"), h.indexOf("An example article"), h.indexOf("After line"), h.indexOf("video.example.com"), h.indexOf("A video"), h.indexOf("Last line")]; })()`);
  check("each preview sits right under its link's line, inside the description", descOrder.every((v, k) => v >= 0 && (k === 0 || v > descOrder[k - 1])), JSON.stringify(descOrder));
  check("no previews left at the bottom of the description", await ev(`!M().querySelector("#hk-desc-render + .hk-embeds")`));
  check("no blank line after a preview", await ev(`![...M().querySelectorAll("#hk-desc-render .hk-embeds")].some(e => e.nextSibling?.nodeName === "BR")`));
  await realClick(`M().querySelector("#hk-desc-render .hk-embed-desc")`);
  check("clicking a preview doesn't open the description editor", await ev(`!M().querySelector("#hk-desc")`));
  await shot("lp-3b-inline");
  await ev(`M().querySelector("#hk-close").click(); tick()`);

  // ---- videos
  check("video embed URLs", JSON.stringify(await ev(`import("/custom_components/hakanban/static/util.js").then(u => [
      "https://youtu.be/dQw4w9WgXcQ?t=90", "https://www.youtube.com/shorts/abcdefghijk", "https://m.youtube.com/watch?v=abcdefghijk",
      "https://vimeo.com/123456", "https://example.com/watch?v=abcdefghijk", "https://www.youtube.com/channel/UC123"].map(u.videoEmbedUrl))`)) === JSON.stringify([
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&start=90", "https://www.youtube-nocookie.com/embed/abcdefghijk?autoplay=1",
      "https://www.youtube-nocookie.com/embed/abcdefghijk?autoplay=1", "https://player.vimeo.com/video/123456?autoplay=1", null, null]));
  await ev(`(async () => { const id = ${C("Walk the dog")}.id;
    await __panel._api.addComment(id, "song https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s");
    await __panel._api.addComment(id, "clip https://cdn.example.com/clip.mp4"); await tick(); })()`);
  await ev(`cardEl("Walk the dog").querySelector(".hk-card-title").click(); tick()`);
  await wait(200);
  check("videos get a play button", await ev(`M().querySelectorAll(".hk-embed-play").length`) === 2);
  await realClick(`M().querySelector('.hk-embed-play[data-play-kind="embed"]')`);
  check("▶ opens the YouTube player (no-cookie, start time)",
    await ev(`(() => { const f = D()?.querySelector(".hk-video iframe"); return !!f && f.getAttribute("src") === "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&start=42" && D().querySelector("h2").textContent === "A YouTube video"; })()`));
  await ev(`D().querySelector(".hk-video iframe").__mark = 1; true`);
  await ev(`(async () => { await __panel._api.updateCard(${C("Walk the dog")}.id, { title: "Walk the dog!" }); await tick(); })()`);
  check("player keeps playing through a live update", await ev(`D()?.querySelector(".hk-video iframe")?.__mark === 1`));
  await shot("lp-4-player");
  await ev(`D().querySelector("#hk-video-close").click(); tick()`);
  check("Close closes the player, card stays open", await ev(`!D() && !!M()`));
  await realClick(`M().querySelector('.hk-embed-play[data-play-kind="file"]')`);
  check("▶ on a video file plays it", await ev(`D()?.querySelector(".hk-video video")?.getAttribute("src") === "https://cdn.example.com/clip.mp4"`));
  await ev(`D().querySelector("#hk-video-close").click(); tick()`);
  await ev(`M().querySelector("#hk-close").click(); tick()`);
  await ev(`(async () => { await __panel._api.updateCard(${C("Walk the dog!")}.id, { title: "Walk the dog" }); await tick(); })()`);

  const errors = await ev(`window.__errors`);
  check("no page errors", errors.length === 0, JSON.stringify(errors));
} catch (e) {
  console.log("ERROR", e.stack || e);
  results.push(["script", false]);
} finally {
  const failed = results.filter(([, ok]) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} browser checks passed`);
  try { ws?.close(); } catch {}
  chrome.kill();
  server.close();
  await sleep(200);
  rmSync(profile, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
