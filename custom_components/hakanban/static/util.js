// Small dependency-free helpers shared across the panel and card.

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Tiny, safe-ish markdown subset: bold, italic, code, links, line breaks, bullets.
// Pass the board to turn "#12" into a link to card 12.
export function renderMarkdown(text, board) {
  if (!text) return "";
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>'
  );
  // unordered lists
  html = html.replace(/(?:^|\n)[-*] (.+)/g, "\n<li>$1</li>");
  html = html.replace(/(<li>[\s\S]*?<\/li>)/g, "<ul>$1</ul>");
  html = html.replace(/\n/g, "<br>");
  return board ? linkCardRefs(html, board) : html;
}

// Plain text (comments, checklist items, titles) with "#12" references linked.
export function renderRefs(text, board) {
  return linkCardRefs(escapeHtml(text), board);
}

// ---- card references ("#12") ---------------------------------------------

// number -> card for a board (live cards win over archived ones).
export function cardsByNumber(board) {
  const map = new Map();
  for (const c of boardCards(board)) {
    if (!map.has(c.number) || map.get(c.number).archived) map.set(c.number, c);
  }
  return map;
}

// Turn "#12" in already-escaped HTML into a clickable reference to card 12. Skips tags,
// links and code spans, and entities like "&#39;" or URL fragments ("/page#12").
// Numbers that don't match a card on the board are left as plain text.
export function linkCardRefs(html, board) {
  if (!html || !board || !html.includes("#")) return html;
  const byNum = cardsByNumber(board);
  return html
    .split(/(<code>[\s\S]*?<\/code>|<a\b[\s\S]*?<\/a>|<[^>]+>)/)
    .map((part, i) => {
      if (i % 2) return part;
      return part.replace(/(^|[^\w&#/])#(\d+)(?!\w)/g, (m, pre, num) => {
        const card = byNum.get(Number(num));
        if (!card) return m;
        const done = card.status === "completed";
        const state = card.archived ? " (archived)" : done ? " (done)" : "";
        const cls = `hk-ref${done ? " done" : ""}${card.archived ? " archived" : ""}`;
        return `${pre}<span class="${cls}" role="link" tabindex="0" data-ref="${card.id}" title="${escapeHtml(card.title + state)}">#${num}</span>`;
      });
    })
    .join("");
}

// ---- dependencies ----------------------------------------------------------
// card.blocked_by lists cards that must be finished first. A blocker stops counting once
// it's completed or archived (archived-but-open work is treated as dropped).

export function cardIndex(board) {
  return Object.fromEntries(boardCards(board).map((c) => [c.id, c]));
}

export function openBlockers(card, byId) {
  return (card.blocked_by || [])
    .map((id) => byId[id])
    .filter((b) => b && b.status !== "completed" && !b.archived);
}

export function isBlocked(card, byId) {
  return openBlockers(card, byId).length > 0;
}

// Live cards that list `card` as a blocker.
export function dependents(card, byId) {
  return Object.values(byId)
    .filter((c) => !c.archived && (c.blocked_by || []).includes(card.id))
    .sort((a, b) => a.number - b.number);
}

// Is `card` (transitively) waiting on `target`? Used to hide choices that would make a cycle.
export function dependsOn(card, target, byId) {
  const seen = new Set();
  const stack = [card];
  while (stack.length) {
    const cur = stack.pop();
    for (const id of cur?.blocked_by || []) {
      if (id === target.id) return true;
      if (!seen.has(id)) { seen.add(id); stack.push(byId[id]); }
    }
  }
  return false;
}

export function formatDue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hasTime = iso.includes("T");
  const opts = hasTime
    ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
    : { month: "short", day: "numeric" };
  return d.toLocaleString(undefined, opts);
}

// Full local date + time, for "Completed …" stamps and tooltips.
export function formatTimestamp(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function dueState(iso, complete) {
  if (!iso || complete) return complete ? "done" : "";
  const now = new Date();
  const d = new Date(iso);
  const soon = new Date(now.getTime() + 24 * 3600 * 1000);
  if (d < now) return "overdue";
  if (d < soon) return "soon";
  return "";
}

// "#abc", "abc", "#AABBCC" -> "#aabbcc"; anything else -> null. Mirrors the backend's
// _normalize_color so the UI can validate before sending.
export function normalizeHex(value) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(value ?? "").trim());
  if (!m) return null;
  let d = m[1].toLowerCase();
  if (d.length === 3) d = [...d].map((ch) => ch + ch).join("");
  return "#" + d;
}

// Pick a readable text colour for a label background.
export function contrastText(hex) {
  hex = normalizeHex(hex);
  if (!hex) return "#fff";
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return r * 0.299 + g * 0.587 + b * 0.114 > 150 ? "#172b4d" : "#fff";
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ---- filters --------------------------------------------------------------

// The board filter. `labels` is a Set of label ids; every other field is "" when off.
export function emptyFilter() {
  return {
    query: "",
    labels: new Set(),
    labelMode: "any", // "any" | "all"
    due: "",          // "" | "overdue" | "soon" | "has" | "none"
    status: "",       // "" | "open" | "completed"
    type: "",         // "" | "task" | "epic"
    epic: "",         // "" | <epic card id> | "__none" (cards without an epic)
    deps: "",         // "" | "blocked" | "ready" (open, nothing blocking it) | "blocking"
  };
}

// How many filter dimensions are active (search excluded), for the toolbar badge.
export function activeFilterCount(f) {
  if (!f) return 0;
  return (f.labels?.size ? 1 : 0) + ["due", "status", "type", "epic", "deps"].filter((k) => f[k]).length;
}

// `byId` (from cardIndex) is needed for the dependency filter.
export function cardMatchesFilter(card, f, byId) {
  if (!f) return true;
  const labels = card.labels || [];
  if (f.labels?.size) {
    const hit = f.labelMode === "all"
      ? [...f.labels].every((l) => labels.includes(l))
      : labels.some((l) => f.labels.has(l));
    if (!hit) return false;
  }
  if (f.due) {
    const ds = dueState(card.due, card.status === "completed");
    if (f.due === "has" && !card.due) return false;
    if (f.due === "none" && card.due) return false;
    if (f.due === "overdue" && ds !== "overdue") return false;
    // "Due soon" includes overdue: both need attention now.
    if (f.due === "soon" && ds !== "soon" && ds !== "overdue") return false;
  }
  if (f.status === "open" && card.status === "completed") return false;
  if (f.status === "completed" && card.status !== "completed") return false;
  if (f.type && (card.card_type || "task") !== f.type) return false;
  if (f.epic === "__none" && (card.epic_id || card.card_type === "epic")) return false;
  // An epic filter shows the epic itself alongside its children.
  if (f.epic && f.epic !== "__none" && card.epic_id !== f.epic && card.id !== f.epic) return false;
  if (f.deps && byId) {
    const open = card.status !== "completed";
    if (f.deps === "blocked" && !(open && isBlocked(card, byId))) return false;
    if (f.deps === "ready" && !(open && !isBlocked(card, byId))) return false;
    if (f.deps === "blocking" && !(open && dependents(card, byId).some((d) => d.status !== "completed"))) return false;
  }
  const query = (f.query || "").toLowerCase();
  if (query) {
    const hay = `${card.title} ${card.description || ""} #${card.number}`.toLowerCase();
    if (!hay.includes(query)) return false;
  }
  return true;
}

// ---- epics ----------------------------------------------------------------

// Every card on a board payload, including archived ones.
export function boardCards(board) {
  const live = (board?.columns || []).flatMap((c) => c.cards || []);
  return live.concat(board?.archived_cards || []);
}

export function boardEpics(board) {
  return boardCards(board)
    .filter((c) => c.card_type === "epic" && !c.archived)
    .sort((a, b) => a.number - b.number);
}

// Children of an epic. Archived children still count when completed (finished work
// that was tidied away); archived-but-open children are treated as dropped.
export function epicChildren(board, epicId) {
  return boardCards(board)
    .filter((c) => c.epic_id === epicId && (!c.archived || c.status === "completed"))
    .sort((a, b) => a.number - b.number);
}

export function epicProgress(board, epicId) {
  const kids = epicChildren(board, epicId);
  return { done: kids.filter((c) => c.status === "completed").length, total: kids.length };
}

// ---------------------------------------------------------------- swimlanes
export const SWIMLANE_MODES = [
  ["none", "No swimlanes"],
  ["type", "Type"],
  ["epic", "Epic"],
  ["label", "Label"],
  ["status", "Status"],
];

// Lanes for a grouping mode. Each lane: { key, title, color?, match(card), preset }.
// `preset` pre-fills the new-card dialog when adding a card from inside that lane.
// A card may match several label lanes (it has several labels); every other mode is exclusive.
export function swimlanes(board, mode) {
  if (!board || !mode || mode === "none") return null;
  if (mode === "type") {
    return [
      { key: "epic", title: "Epics", match: (c) => c.card_type === "epic", preset: { cardType: "epic" } },
      { key: "task", title: "Tasks", match: (c) => c.card_type !== "epic", preset: { cardType: "task" } },
    ];
  }
  if (mode === "status") {
    return [
      { key: "needs_action", title: "Open", match: (c) => c.status !== "completed", preset: {} },
      { key: "completed", title: "Done", match: (c) => c.status === "completed", preset: {} },
    ];
  }
  if (mode === "epic") {
    const epics = boardEpics(board);
    const ids = new Set(epics.map((e) => e.id));
    return [
      ...epics.map((e) => ({
        key: e.id,
        title: `#${e.number} ${e.title}`,
        epic: true,
        // The epic card sits in its own lane alongside its children.
        match: (c) => c.id === e.id || c.epic_id === e.id,
        preset: { epicId: e.id },
      })),
      {
        key: "__none",
        title: "No epic",
        match: (c) => c.card_type !== "epic" && !(c.epic_id && ids.has(c.epic_id)),
        preset: {},
      },
    ];
  }
  if (mode === "label") {
    const ids = new Set((board.labels || []).map((l) => l.id));
    return [
      ...(board.labels || []).map((l) => ({
        key: l.id,
        title: l.name || "(unnamed label)",
        color: l.color,
        match: (c) => (c.labels || []).includes(l.id),
        preset: { labels: [l.id] },
      })),
      {
        key: "__none",
        title: "No label",
        match: (c) => !(c.labels || []).some((id) => ids.has(id)),
        preset: {},
      },
    ];
  }
  return null;
}

// What dragging `card` from lane `from` to lane `to` changes, as an update_card payload.
// Returns null when nothing changes, or { error } when the move isn't allowed.
export function swimlaneChanges(mode, card, from, to) {
  if (!mode || mode === "none" || from === to || from == null || to == null) return null;
  if (mode === "type") return { card_type: to };
  if (mode === "status") return { status: to };
  if (mode === "epic") {
    if (card.card_type === "epic") return { error: "An epic stays in its own lane." };
    return { epic_id: to === "__none" ? null : to };
  }
  if (mode === "label") {
    if (to === "__none") return { labels: [] };
    const labels = new Set(card.labels || []);
    if (from !== "__none") labels.delete(from);
    labels.add(to);
    return { labels: [...labels] };
  }
  return null;
}

// ---- Deep links -------------------------------------------------------------
// The sidebar panel lives at /hakanban (PANEL_URL_PATH in const.py). A card's link is
// /hakanban/card/<id>; a board's is /hakanban/board/<id>. Ids are stable for a card's
// whole life (its #number can change if it moves to another board), so links use them.
export const PANEL_PATH = "/hakanban";

export function cardPath(cardId, prefix = PANEL_PATH) {
  return `${prefix}/card/${encodeURIComponent(cardId)}`;
}

export function boardPath(boardId, prefix = PANEL_PATH) {
  return boardId ? `${prefix}/board/${encodeURIComponent(boardId)}` : prefix;
}

export function cardUrl(cardId) {
  return location.origin + cardPath(cardId);
}

// Parse the panel's sub-path ("/card/<id>", "/board/<id>", "" ...) into { card } / { board } / {}.
export function parseRoute(path) {
  const m = /^\/(card|board)\/([^/?#]+)/.exec(path || "");
  if (!m) return {};
  let id;
  try { id = decodeURIComponent(m[2]); } catch (e) { return {}; }
  return { [m[1]]: id };
}

// Copy to the clipboard. navigator.clipboard needs a secure context, which a plain-http
// HA install isn't, so fall back to a hidden textarea + execCommand.
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* fall through */ }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
  ta.remove();
  return ok;
}
