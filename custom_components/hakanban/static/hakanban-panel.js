// <hakanban-panel> — the full-page sidebar app. Home Assistant injects `hass`.

import { STYLES } from "./styles.js";
import { HakanbanApi } from "./api.js";
import {
  escapeHtml, contrastText, debounce, formatDue,
  emptyFilter, activeFilterCount, boardEpics,
} from "./util.js";
import { openDialog, openLabelManager, colorInputHtml, wireColorInput } from "./dialogs.js";
import "./board-view.js";

const BACKGROUNDS = [
  "", "#0079bf", "#519839", "#b04632", "#89609e", "#cd5a91",
  "#4bbf6b", "#00aecc", "#838c91",
  "linear-gradient(135deg,#667eea,#764ba2)",
  "linear-gradient(135deg,#f093fb,#f5576c)",
];

export class HakanbanPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._activeBoardId = localStorage.getItem("hakanban_active_board") || null;
    this._filter = emptyFilter();
    this._showFilter = false;
    this._showBg = false;
    this._built = false;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._api) {
      this._api = new HakanbanApi(hass);
      this._start();
    } else {
      this._api.setHass(hass);
      if (this._boardEl) this._boardEl.hass = hass;
    }
  }

  connectedCallback() {
    if (this._hass && !this._api) {
      this._api = new HakanbanApi(this._hass);
      this._start();
    }
  }

  disconnectedCallback() {
    if (this._unsub) this._unsub.then((u) => u && u()).catch(() => {});
    if (this._onKeydown) {
      window.removeEventListener("keydown", this._onKeydown);
      this._onKeydown = null;
    }
  }

  // Ctrl/⌘+Z = undo, Ctrl/⌘+Shift+Z or Ctrl+Y = redo. Skipped while typing in a
  // field so the browser's native text undo keeps working.
  _setupKeyboard() {
    if (this._onKeydown) return;
    this._onKeydown = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = (e.key || "").toLowerCase();
      if (key !== "z" && key !== "y") return;
      const target = (e.composedPath && e.composedPath()[0]) || e.target;
      const tag = (target && target.tagName) || "";
      if (target && (target.isContentEditable || /^(input|textarea|select)$/i.test(tag))) return;
      e.preventDefault();
      if (key === "y" || (key === "z" && e.shiftKey)) {
        if (this._data?.can_redo) this._api.redo();
      } else if (this._data?.can_undo) {
        this._api.undo();
      }
    };
    window.addEventListener("keydown", this._onKeydown);
  }

  async _start() {
    this._build();
    this._setupKeyboard();
    this._unsub = this._api.subscribe((payload) => {
      this._data = payload;
      if (!this._activeBoardId || !payload.boards.find((b) => b.id === this._activeBoardId)) {
        this._activeBoardId = payload.boards[0]?.id || null;
      }
      this._pruneFilter();
      this._renderToolbar();
      this._renderBoard();
    });
  }

  _activeBoard() {
    return (this._data?.boards || []).find((b) => b.id === this._activeBoardId) || null;
  }

  _build() {
    this.shadowRoot.innerHTML = `<style>${STYLES}</style>
      <div class="hk-root">
        <div class="hk-toolbar" id="toolbar"></div>
        <div id="filterbar"></div>
        <div id="host" style="flex:1;min-height:0;display:flex"></div>
      </div>`;
    this._boardEl = document.createElement("hakanban-board");
    this._boardEl.style.flex = "1";
    this._boardEl.style.minWidth = "0";
    this._boardEl.api = this._api;
    this._boardEl.hass = this._hass;
    this.shadowRoot.getElementById("host").appendChild(this._boardEl);
    this._built = true;
  }

  _renderToolbar() {
    const boards = this._data?.boards || [];
    const tabs = boards
      .map(
        (b) =>
          `<button class="hk-tab ${b.id === this._activeBoardId ? "active" : ""}" data-board="${b.id}">${escapeHtml(b.title)}</button>`
      )
      .join("");
    const nFilters = activeFilterCount(this._filter);
    const nArchived = (this._activeBoard()?.archived_cards || []).length;
    const canUndo = !!this._data?.can_undo;
    const canRedo = !!this._data?.can_redo;
    const tb = this.shadowRoot.getElementById("toolbar");
    tb.innerHTML = `
      <span class="hk-title">📋 Hakanban</span>
      <div class="hk-board-tabs">${tabs}
        <button class="hk-iconbtn" id="add-board" title="New board">+</button>
      </div>
      <button class="hk-iconbtn" id="undo-btn" title="Undo (Ctrl/⌘+Z)" ${canUndo ? "" : "disabled"}>↶</button>
      <button class="hk-iconbtn" id="redo-btn" title="Redo (Ctrl/⌘+Shift+Z)" ${canRedo ? "" : "disabled"}>↷</button>
      <input class="hk-search" id="search" type="search" placeholder="Search cards…" value="${escapeHtml(this._filter.query)}">
      <button class="hk-iconbtn ${this._showFilter ? "on" : ""}" id="filter-btn" title="Filter cards">⚑${nFilters ? `<span class="hk-count">${nFilters}</span>` : ""}</button>
      <button class="hk-iconbtn" id="labels-btn" title="Edit labels">🏷</button>
      <button class="hk-iconbtn" id="archive-btn" title="Archived cards">🗄${nArchived ? `<span class="hk-count" style="background:#838c91">${nArchived}</span>` : ""}</button>
      <button class="hk-iconbtn" id="bg-btn" title="Board background">🎨</button>
      <button class="hk-iconbtn" id="edit-board" title="Rename board">✎</button>
      <button class="hk-iconbtn" id="del-board" title="Delete board">🗑</button>`;

    tb.querySelector("#undo-btn").addEventListener("click", () => this._api.undo());
    tb.querySelector("#redo-btn").addEventListener("click", () => this._api.redo());

    tb.querySelectorAll("[data-board]").forEach((el) => {
      el.addEventListener("click", () => {
        // Nothing to do when re-selecting the active tab; skip the re-render.
        if (el.dataset.board === this._activeBoardId) return;
        this._activeBoardId = el.dataset.board;
        localStorage.setItem("hakanban_active_board", el.dataset.board);
        // Labels and epics are per board, so other filters don't carry across.
        this._filter = { ...emptyFilter(), query: this._filter.query };
        this._renderToolbar();
        this._renderBoard();
      });
    });

    tb.querySelector("#add-board").addEventListener("click", async () => {
      const board = await this._api.createBoard("New Board");
      this._activeBoardId = board.id;
      localStorage.setItem("hakanban_active_board", board.id);
    });
    tb.querySelector("#edit-board").addEventListener("click", () => {
      const board = this._activeBoard();
      if (board) this._openRenameDialog(board.id);
    });
    tb.querySelector("#del-board").addEventListener("click", () => {
      const board = this._activeBoard();
      if (board && confirm(`Delete board "${board.title}" and all its cards?`))
        this._api.deleteBoard(board.id);
    });
    tb.querySelector("#filter-btn").addEventListener("click", () => {
      this._showFilter = !this._showFilter;
      this._showBg = false;
      this._renderFilterbar();
      this._applyFilter();
    });
    tb.querySelector("#labels-btn").addEventListener("click", () => {
      if (this._activeBoard()) openLabelManager(() => this._activeBoard(), this._api);
    });
    tb.querySelector("#archive-btn").addEventListener("click", () => this._openArchive());
    tb.querySelector("#bg-btn").addEventListener("click", () => {
      this._showBg = !this._showBg;
      this._showFilter = false;
      this._renderFilterbar();
    });

    const search = tb.querySelector("#search");
    const apply = debounce(() => {
      this._filter.query = search.value;
      this._applyFilter();
    }, 150);
    search.addEventListener("input", apply);

    this._renderFilterbar();
  }

  _renderFilterbar() {
    const bar = this.shadowRoot.getElementById("filterbar");
    const board = this._activeBoard();
    if (!board) { bar.innerHTML = ""; return; }
    const f = this._filter;
    let html = "";
    if (this._showFilter) {
      const chips = (board.labels || [])
        .map(
          (l) =>
            `<span class="hk-label-chip ${f.labels.has(l.id) ? "selected" : ""}" data-flabel="${l.id}" style="background:${l.color};color:${contrastText(l.color)}">${escapeHtml(l.name || "·")}</span>`
        )
        .join("");
      const seg = (key, opts) =>
        `<span class="hk-seg">${opts
          .map(([v, t]) => `<button data-fseg="${key}" data-v="${v}" class="${f[key] === v ? "on" : ""}">${t}</button>`)
          .join("")}</span>`;
      const epics = boardEpics(board)
        .map((e) => `<option value="${e.id}" ${f.epic === e.id ? "selected" : ""}>#${e.number} ${escapeHtml(e.title)}</option>`)
        .join("");
      html = `<div class="hk-filterbar">
        <span class="hk-fgroup"><strong>Labels</strong>${chips || "<em>None</em>"}
          ${f.labels.size > 1 ? seg("labelMode", [["any", "Any"], ["all", "All"]]) : ""}</span>
        <span class="hk-fgroup"><strong>Due</strong>
          <select data-fsel="due">
            ${[["", "Any"], ["overdue", "Overdue"], ["soon", "Due within 24h"], ["has", "Has a due date"], ["none", "No due date"]]
              .map(([v, t]) => `<option value="${v}" ${f.due === v ? "selected" : ""}>${t}</option>`).join("")}
          </select></span>
        <span class="hk-fgroup"><strong>Status</strong>${seg("status", [["", "All"], ["open", "Open"], ["completed", "Done"]])}</span>
        <span class="hk-fgroup"><strong>Type</strong>${seg("type", [["", "All"], ["task", "Tasks"], ["epic", "Epics"]])}</span>
        <span class="hk-fgroup"><strong>Epic</strong>
          <select data-fsel="epic">
            <option value="">Any</option>
            <option value="__none" ${f.epic === "__none" ? "selected" : ""}>Not in an epic</option>
            ${epics}
          </select></span>
        <button class="hk-btn secondary" data-clearf ${activeFilterCount(f) ? "" : "disabled"}>Clear filters</button>
      </div>`;
    } else if (this._showBg) {
      const current = board.background || "";
      const sw = BACKGROUNDS.map(
        (bg) =>
          `<span class="hk-swatch ${bg === current ? "selected" : ""}" data-bg="${escapeHtml(bg)}" title="${escapeHtml(bg || "None")}" style="width:28px;height:28px;border:1px solid var(--hk-divider);background:${bg || "var(--card-background-color)"}"></span>`
      ).join("");
      // Seed the custom picker with the current colour (gradients fall back to grey).
      html = `<div class="hk-row" style="padding:8px 16px;border-bottom:1px solid var(--hk-divider)"><strong style="margin-right:6px">Background:</strong>${sw}
        <span class="hk-muted" style="margin-left:6px">Custom</span>${colorInputHtml("hk-bg", current)}</div>`;
    }
    bar.innerHTML = html;

    const changed = () => { this._renderFilterbar(); this._applyFilter(); };
    bar.querySelectorAll("[data-flabel]").forEach((el) =>
      el.addEventListener("click", () => {
        const id = el.dataset.flabel;
        f.labels.has(id) ? f.labels.delete(id) : f.labels.add(id);
        changed();
      })
    );
    bar.querySelectorAll("[data-fseg]").forEach((el) =>
      el.addEventListener("click", () => { f[el.dataset.fseg] = el.dataset.v; changed(); })
    );
    bar.querySelectorAll("[data-fsel]").forEach((el) =>
      el.addEventListener("change", () => { f[el.dataset.fsel] = el.value; changed(); })
    );
    const clearf = bar.querySelector("[data-clearf]");
    if (clearf) clearf.addEventListener("click", () => {
      this._filter = { ...emptyFilter(), query: f.query };
      changed();
    });
    bar.querySelectorAll("[data-bg]").forEach((el) =>
      el.addEventListener("click", () => this._api.updateBoard(board.id, { background: el.dataset.bg || null }))
    );
    if (this._showBg) {
      wireColorInput(this.shadowRoot, "hk-bg", (hex) => this._api.updateBoard(board.id, { background: hex }));
    }
  }

  // Drop filter values that no longer exist on the board (deleted label / epic).
  _pruneFilter() {
    const board = this._activeBoard();
    if (!board) return;
    const labelIds = new Set((board.labels || []).map((l) => l.id));
    for (const id of [...this._filter.labels]) if (!labelIds.has(id)) this._filter.labels.delete(id);
    const e = this._filter.epic;
    if (e && e !== "__none" && !boardEpics(board).some((x) => x.id === e)) this._filter.epic = "";
  }

  _applyFilter() {
    if (this._boardEl) this._boardEl.filter = this._filter;
    // Refresh the toolbar badge in place so the search box keeps focus.
    const btn = this.shadowRoot.getElementById("filter-btn");
    if (btn) {
      const n = activeFilterCount(this._filter);
      btn.innerHTML = `⚑${n ? `<span class="hk-count">${n}</span>` : ""}`;
      btn.classList.toggle("on", this._showFilter);
    }
  }

  _openArchive() {
    if (!this._activeBoard()) return;
    const { root, close } = openDialog("Archived cards", `<div id="hk-arch"></div>`, { width: 560 });
    const render = () => {
      const board = this._activeBoard();
      if (!board) { close(); return; }
      const colTitle = (id) => (board.columns.find((c) => c.id === id) || {}).title || "deleted list";
      const items = (board.archived_cards || [])
        .map(
          (c) => `<div class="hk-archive-item">
            <span class="ttl" data-open="${c.id}" title="Open card">${c.card_type === "epic" ? '<span class="hk-epic-tag" style="margin:0 4px 0 0">EPIC</span>' : ""}#${c.number} ${escapeHtml(c.title)}</span>
            <span class="meta">${escapeHtml(colTitle(c.column_id))} · ${escapeHtml(formatDue(c.updated))}</span>
            <button class="hk-btn secondary" data-restore="${c.id}">Restore</button>
            <button class="hk-btn secondary" data-del="${c.id}" title="Delete permanently">🗑</button>
          </div>`
        )
        .join("");
      root.getElementById("hk-arch").innerHTML = `
        <div class="hk-archive-list">${items || '<p class="hk-muted">Nothing archived on this board.</p>'}</div>
        <div class="hk-modal-actions"><span class="grow"></span><button class="hk-btn" data-close>Close</button></div>`;
      root.querySelector("[data-close]").addEventListener("click", close);
      root.querySelectorAll("[data-open]").forEach((el) =>
        el.addEventListener("click", () => { close(); this._boardEl.openCard(el.dataset.open); })
      );
      root.querySelectorAll("[data-restore]").forEach((el) =>
        el.addEventListener("click", async () => {
          await this._api.updateCard(el.dataset.restore, { archived: false });
          render();
        })
      );
      root.querySelectorAll("[data-del]").forEach((el) =>
        el.addEventListener("click", async () => {
          if (!confirm("Delete this card permanently? (Undo is still available.)")) return;
          await this._api.deleteCard(el.dataset.del);
          render();
        })
      );
    };
    render();
  }

  // Modal rename, opened from the toolbar's ✎ button (keeps tab clicks for
  // switching boards only, and avoids inline-edit clashes with re-render).
  _openRenameDialog(boardId) {
    const board = (this._data?.boards || []).find((b) => b.id === boardId);
    if (!board) return;
    this.shadowRoot.querySelector(".hk-dialog-back")?.remove(); // one at a time

    const back = document.createElement("div");
    back.className = "hk-modal-back hk-dialog-back";
    back.innerHTML = `
      <div class="hk-modal hk-dialog" role="dialog" aria-modal="true" style="width:min(420px,100%)">
        <h2>Rename board</h2>
        <div class="hk-row" style="margin-top:12px">
          <input type="text" id="hk-rename-input" style="flex:1" value="${escapeHtml(board.title)}" maxlength="120">
        </div>
        <div class="hk-modal-actions">
          <span class="grow"></span>
          <button class="hk-btn secondary" id="hk-rename-cancel">Cancel</button>
          <button class="hk-btn" id="hk-rename-save">Save</button>
        </div>
      </div>`;
    this.shadowRoot.appendChild(back);

    const input = back.querySelector("#hk-rename-input");
    const close = () => back.remove();
    const save = () => {
      const v = input.value.trim();
      if (v && v !== board.title) this._api.updateBoard(boardId, { title: v });
      close();
    };
    back.addEventListener("mousedown", (e) => { if (e.target === back) close(); });
    back.querySelector("#hk-rename-cancel").addEventListener("click", close);
    back.querySelector("#hk-rename-save").addEventListener("click", save);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); save(); }
      else if (e.key === "Escape") { e.preventDefault(); close(); }
    });
    input.focus();
    input.select();
  }

  _renderBoard() {
    const board = this._activeBoard();
    if (!this._boardEl) return;
    if (!board) {
      this._boardEl.board = null;
      return;
    }
    this._boardEl.filter = this._filter;
    this._boardEl.board = board;
  }
}

if (!customElements.get("hakanban-panel")) {
  customElements.define("hakanban-panel", HakanbanPanel);
}
