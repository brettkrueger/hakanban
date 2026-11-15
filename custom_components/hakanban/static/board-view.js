// <hakanban-board> — renders one board (columns + cards) with native drag & drop.
// Used by both the full-page panel and the embeddable Lovelace card.

import { STYLES } from "./styles.js";
import { HakanbanCardDetail } from "./card-detail.js";
import { openColumnSettings, openNewCardDialog } from "./dialogs.js";
import {
  escapeHtml,
  formatDue,
  formatTimestamp,
  dueState,
  contrastText,
  emptyFilter,
  cardMatchesFilter,
  boardCards,
  epicProgress,
  swimlanes,
  swimlaneChanges,
} from "./util.js";

// Module-level drag state (HTML5 DnD can't read dataTransfer during dragover).
let DRAG = null; // { kind: 'card'|'col', id, from?, lane? }

function cardAfter(container, y) {
  const els = [...container.querySelectorAll(".hk-card:not(.dragging)")];
  let best = { offset: -Infinity, el: null };
  for (const el of els) {
    const box = el.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > best.offset) best = { offset, el };
  }
  return best.el;
}

function colInsertionIndex(boardEl, x) {
  const cols = [...boardEl.querySelectorAll(".hk-col[data-colhead-box]")];
  for (let i = 0; i < cols.length; i++) {
    const box = cols[i].getBoundingClientRect();
    if (x < box.left + box.width / 2) return i;
  }
  return cols.length;
}

export class HakanbanBoard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._composer = { openCol: null, value: "" };
    this._addCol = { open: false, value: "" };
    this._filter = emptyFilter();
    this._openCardId = null;
    this._modal = null;
    this._lanes = "none";
    this._collapsed = new Set(); // "<mode>:<lane key>"
  }

  set api(api) {
    this._api = api;
  }
  set hass(hass) {
    this._hass = hass;
  }
  set filter(f) {
    this._filter = { ...emptyFilter(), ...(f || {}) };
    this.render();
  }
  // Swimlane grouping: "none" | "type" | "epic" | "label" | "status".
  set swimlanes(mode) {
    const m = mode || "none";
    if (m === this._lanes) return;
    this._lanes = m;
    this.render();
  }
  get swimlanes() {
    return this._lanes;
  }
  set board(b) {
    this._board = b;
    this.render();
    this._syncModal();
  }
  get board() {
    return this._board;
  }

  _cardVisible(card) {
    return cardMatchesFilter(card, this._filter);
  }

  _cardHtml(card, labelById, cardById) {
    const labels = (card.labels || [])
      .map((id) => labelById[id])
      .filter(Boolean)
      .map(
        (l) =>
          `<span class="hk-label" style="background:${l.color};color:${contrastText(l.color)}">${escapeHtml(l.name || "")}</span>`
      )
      .join("");
    const done = card.status === "completed";
    const ds = dueState(card.due, done);
    const badges = [];
    badges.push(`<span class="hk-card-number">#${card.number}</span>`);
    if (done && card.completed)
      badges.push(`<span class="hk-badge hk-done-badge" title="Completed ${escapeHtml(formatTimestamp(card.completed))}">✓ ${escapeHtml(formatDue(card.completed))}</span>`);
    if (card.due)
      badges.push(`<span class="hk-badge due-${ds}">🕑 ${escapeHtml(formatDue(card.due))}</span>`);
    if (card.description) badges.push(`<span class="hk-badge">≡</span>`);
    if ((card.comments || []).length) badges.push(`<span class="hk-badge">💬 ${card.comments.length}</span>`);
    const checks = (card.checklists || []).reduce(
      (a, cl) => ({ done: a.done + cl.items.filter((i) => i.done).length, total: a.total + cl.items.length }),
      { done: 0, total: 0 }
    );
    if (checks.total) badges.push(`<span class="hk-badge">☑ ${checks.done}/${checks.total}</span>`);
    if ((card.assignees || []).length) badges.push(`<span class="hk-badge">👤 ${card.assignees.length}</span>`);

    const isEpic = card.card_type === "epic";
    let epicTop = "";
    let epicBottom = "";
    if (isEpic) {
      const p = epicProgress(this._board, card.id);
      epicTop = `<span class="hk-epic-tag">EPIC</span>`;
      badges.push(`<span class="hk-badge" title="Completed child cards">◆ ${p.done}/${p.total}</span>`);
      if (p.total) epicBottom = `<div class="hk-progress"><span style="width:${Math.round((100 * p.done) / p.total)}%"></span></div>`;
    } else if (card.epic_id && cardById[card.epic_id]) {
      const epic = cardById[card.epic_id];
      epicTop = `<div class="hk-epic-ref" title="Epic #${epic.number}: ${escapeHtml(epic.title)}">◆ ${escapeHtml(epic.title)}</div>`;
    }

    const completed = card.status === "completed" ? "completed" : "";
    return `
      <div class="hk-card ${completed} ${isEpic ? "epic" : ""}" draggable="true" data-card="${card.id}" data-col="${card.column_id}">
        ${epicTop}
        ${labels ? `<div class="hk-card-labels">${labels}</div>` : ""}
        <div class="hk-card-title">${escapeHtml(card.title)}</div>
        <div class="hk-card-badges">${badges.join("")}</div>
        ${epicBottom}
      </div>`;
  }

  _columnHtml(col, labelById, cardById) {
    const cards = (col.cards || []).filter((c) => this._cardVisible(c));
    const cardsHtml = cards.map((c) => this._cardHtml(c, labelById, cardById)).join("");
    const composerOpen = this._composer.openCol === col.id;
    const quick = `<button class="hk-btn secondary hk-quickadd" data-open="${col.id}" title="Quick add: title only (paste several lines for several cards)">⚡</button>`;
    const footer = composerOpen
      ? `<div class="hk-composer">
           <textarea data-composer="${col.id}" placeholder="Enter a title… (paste multiple lines for multiple cards)"></textarea>
           <div class="hk-composer-actions">
             <button class="hk-btn" data-add="${col.id}">Add card</button>
             <button class="hk-btn secondary" data-cancel="${col.id}">✕</button>
           </div>
         </div>`
      : `<div class="hk-composer hk-addrow"><button class="hk-btn secondary hk-addcard" data-newcard="${col.id}">+ Add a card</button>${quick}</div>`;

    return `
      <div class="hk-col" data-col="${col.id}" data-dropcol="${col.id}" data-colhead-box>
        ${this._colHeadHtml(col, cards.length)}
        <div class="hk-cards" data-cards="${col.id}">${cardsHtml}</div>
        ${footer}
      </div>`;
  }

  _colHeadHtml(col, count) {
    return `
        <div class="hk-col-head" draggable="true" data-colhead="${col.id}">
          <span class="hk-col-title" data-coltitle="${col.id}">${escapeHtml(col.title)}</span>
          ${col.done ? `<span class="hk-col-done" title="Cards in this list are done">✓</span>` : ""}
          ${col.auto_archive_days ? `<span class="hk-col-auto" title="Cards are archived after ${col.auto_archive_days} day(s) in this list">🗄 ${col.auto_archive_days}d</span>` : ""}
          <span class="hk-col-count">${count}</span>
          <button class="hk-col-menu" data-colsettings="${col.id}" title="List settings">⚙</button>
          <button class="hk-col-menu" data-colmenu="${col.id}" title="Delete list">🗑</button>
        </div>`;
  }

  // Swimlane layout: one header row of lists, then a horizontal lane per group, each with a
  // cell per list. Lanes are a view only; dragging a card into another lane edits the field
  // the board is grouped by (type, epic, label or status).
  _lanesHtml(lanes, labelById, cardById, addCol) {
    const b = this._board;
    const visible = (col) => (col.cards || []).filter((c) => this._cardVisible(c));
    const heads = (b.columns || [])
      .map((col) => `<div class="hk-col hk-col-headonly" data-col="${col.id}" data-colhead-box>${this._colHeadHtml(col, visible(col).length)}</div>`)
      .join("");
    const rows = lanes
      .map((lane) => {
        const ck = `${this._lanes}:${lane.key}`;
        const collapsed = this._collapsed.has(ck);
        const perCol = (b.columns || []).map((col) => visible(col).filter(lane.match));
        const count = perCol.reduce((n, cs) => n + cs.length, 0);
        const dot = lane.color
          ? `<span class="hk-lane-dot" style="background:${lane.color}"></span>`
          : lane.epic ? `<span class="hk-epic-tag" style="margin:0">EPIC</span>` : "";
        const cells = (b.columns || [])
          .map((col, i) => `
            <div class="hk-lane-cell" data-dropcol="${col.id}" data-lane="${escapeHtml(lane.key)}">
              <div class="hk-cards" data-cards="${col.id}">${perCol[i].map((c) => this._cardHtml(c, labelById, cardById)).join("")}</div>
              <button class="hk-btn secondary hk-lane-add" data-newcard="${col.id}" data-lane="${escapeHtml(lane.key)}" title="Add a card to ${escapeHtml(col.title)} / ${escapeHtml(lane.title)}">+</button>
            </div>`)
          .join("");
        return `
          <div class="hk-lane ${collapsed ? "collapsed" : ""}">
            <button class="hk-lane-head" data-lanetoggle="${escapeHtml(ck)}" aria-expanded="${!collapsed}">
              <span class="hk-lane-caret">${collapsed ? "▸" : "▾"}</span>${dot}
              <span class="hk-lane-title">${escapeHtml(lane.title)}</span>
              <span class="hk-col-count">${count}</span>
            </button>
            ${collapsed ? "" : `<div class="hk-lane-row">${cells}</div>`}
          </div>`;
      })
      .join("");
    return `<div class="hk-lanes"><div class="hk-lane-headrow">${heads}${addCol}</div>${rows}</div>`;
  }

  render() {
    if (!this._board) {
      this.shadowRoot.innerHTML = `<style>${STYLES}</style><div class="hk-empty">No board.</div>`;
      return;
    }
    const b = this._board;
    const labelById = Object.fromEntries((b.labels || []).map((l) => [l.id, l]));
    const cardById = Object.fromEntries(boardCards(b).map((c) => [c.id, c]));
    const lanes = swimlanes(b, this._lanes);
    const addCol = this._addCol.open
      ? `<div class="hk-add-col"><div class="hk-composer"><textarea data-addcol placeholder="List title…"></textarea>
           <div class="hk-composer-actions"><button class="hk-btn" data-addcol-go>Add list</button>
           <button class="hk-btn secondary" data-addcol-cancel>✕</button></div></div></div>`
      : `<div class="hk-add-col"><button data-addcol-open>+ Add a list</button></div>`;

    const bg = b.background ? `style="background:${escapeHtml(b.background)}"` : "";
    const inner = lanes
      ? this._lanesHtml(lanes, labelById, cardById, addCol)
      : (b.columns || []).map((c) => this._columnHtml(c, labelById, cardById)).join("") + addCol;
    this.shadowRoot.innerHTML = `<style>${STYLES}</style>
      <div class="hk-board ${lanes ? "lanes" : ""}" data-board ${bg}>${inner}</div>`;

    this._wire();
    this._restoreComposer();
  }

  _restoreComposer() {
    if (this._composer.openCol) {
      const ta = this.shadowRoot.querySelector(`textarea[data-composer="${this._composer.openCol}"]`);
      if (ta) {
        ta.value = this._composer.value;
        ta.focus();
      }
    }
    if (this._addCol.open) {
      const ta = this.shadowRoot.querySelector("textarea[data-addcol]");
      if (ta) {
        ta.value = this._addCol.value;
        ta.focus();
      }
    }
  }

  _wire() {
    const root = this.shadowRoot;
    const api = this._api;
    const boardId = this._board.id;
    const boardEl = root.querySelector("[data-board]");

    // --- card click -> open modal (suppress if a drag just happened) ---
    root.querySelectorAll(".hk-card").forEach((el) => {
      el.addEventListener("click", () => {
        if (this._justDragged) return;
        this._openCard(el.dataset.card);
      });
      el.addEventListener("dragstart", (e) => {
        DRAG = {
          kind: "card", id: el.dataset.card, from: el.dataset.col,
          lane: el.closest("[data-lane]")?.dataset.lane ?? null,
        };
        el.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", el.dataset.card);
      });
      el.addEventListener("dragend", () => {
        el.classList.remove("dragging");
        DRAG = null;
        this._justDragged = true;
        setTimeout(() => (this._justDragged = false), 50);
      });
    });

    // --- card drop targets (each column's card list) ---
    root.querySelectorAll("[data-dropcol]").forEach((colEl) => {
      const colId = colEl.dataset.dropcol;
      const list = colEl.querySelector(".hk-cards");
      colEl.addEventListener("dragover", (e) => {
        if (DRAG?.kind !== "card") return;
        e.preventDefault();
        colEl.classList.add("dragover");
      });
      colEl.addEventListener("dragleave", () => colEl.classList.remove("dragover"));
      colEl.addEventListener("drop", (e) => {
        if (DRAG?.kind !== "card") return;
        e.preventDefault();
        colEl.classList.remove("dragover");
        this._dropCard({ ...DRAG }, colId, list, e.clientY, colEl.dataset.lane ?? null);
      });
    });

    // --- column reordering ---
    root.querySelectorAll("[data-colhead]").forEach((head) => {
      head.addEventListener("dragstart", (e) => {
        DRAG = { kind: "col", id: head.dataset.colhead };
        e.dataTransfer.effectAllowed = "move";
        e.stopPropagation();
      });
      head.addEventListener("dragend", () => (DRAG = null));
    });
    boardEl.addEventListener("dragover", (e) => {
      if (DRAG?.kind !== "col") return;
      e.preventDefault();
    });
    boardEl.addEventListener("drop", (e) => {
      if (DRAG?.kind !== "col") return;
      e.preventDefault();
      const position = colInsertionIndex(boardEl, e.clientX);
      api.moveColumn(boardId, DRAG.id, position);
    });

    // --- column title rename ---
    root.querySelectorAll("[data-coltitle]").forEach((el) => {
      el.addEventListener("dblclick", () => {
        el.setAttribute("contenteditable", "true");
        el.focus();
      });
      el.addEventListener("blur", () => {
        el.removeAttribute("contenteditable");
        const v = el.textContent.trim();
        const col = this._board.columns.find((c) => c.id === el.dataset.coltitle);
        if (v && col && v !== col.title) api.updateColumn(boardId, el.dataset.coltitle, { title: v });
      });
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); el.blur(); }
      });
    });
    root.querySelectorAll("[data-colsettings]").forEach((el) =>
      el.addEventListener("click", () => {
        const col = this._board.columns.find((c) => c.id === el.dataset.colsettings);
        if (col) openColumnSettings(this._board, col, api);
      })
    );
    root.querySelectorAll("[data-colmenu]").forEach((el) =>
      el.addEventListener("click", () => {
        if (confirm("Delete this list and its cards?")) api.deleteColumn(boardId, el.dataset.colmenu);
      })
    );

    // --- swimlane collapse ---
    root.querySelectorAll("[data-lanetoggle]").forEach((el) =>
      el.addEventListener("click", () => {
        const k = el.dataset.lanetoggle;
        this._collapsed.has(k) ? this._collapsed.delete(k) : this._collapsed.add(k);
        this.render();
      })
    );

    // --- new card dialog ---
    root.querySelectorAll("[data-newcard]").forEach((btn) =>
      btn.addEventListener("click", () => this._newCard(btn.dataset.newcard, btn.dataset.lane))
    );

    // --- card composer (quick add) ---
    root.querySelectorAll("[data-open]").forEach((btn) =>
      btn.addEventListener("click", () => {
        this._composer = { openCol: btn.dataset.open, value: "" };
        this.render();
      })
    );
    root.querySelectorAll("[data-cancel]").forEach((btn) =>
      btn.addEventListener("click", () => {
        this._composer = { openCol: null, value: "" };
        this.render();
      })
    );
    root.querySelectorAll("textarea[data-composer]").forEach((ta) => {
      ta.addEventListener("input", () => (this._composer.value = ta.value));
      ta.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          this._submitCards(ta.dataset.composer, ta.value);
        }
      });
    });
    root.querySelectorAll("[data-add]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const ta = root.querySelector(`textarea[data-composer="${btn.dataset.add}"]`);
        this._submitCards(btn.dataset.add, ta.value);
      })
    );

    // --- add column ---
    const open = root.querySelector("[data-addcol-open]");
    if (open) open.addEventListener("click", () => { this._addCol = { open: true, value: "" }; this.render(); });
    const addTa = root.querySelector("textarea[data-addcol]");
    if (addTa) {
      addTa.addEventListener("input", () => (this._addCol.value = addTa.value));
      addTa.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); this._submitColumn(addTa.value); }
      });
    }
    const go = root.querySelector("[data-addcol-go]");
    if (go) go.addEventListener("click", () => this._submitColumn(root.querySelector("textarea[data-addcol]").value));
    const cancel = root.querySelector("[data-addcol-cancel]");
    if (cancel) cancel.addEventListener("click", () => { this._addCol = { open: false, value: "" }; this.render(); });
  }

  // Drop a card into list `colId` (and lane `toLane` in swimlane mode). `position` is the
  // index among the list's *full* card order, so it stays right when a filter or a lane hides
  // some cards: land just before the card under the cursor, else just after the last visible one.
  _dropCard(drag, colId, list, y, toLane) {
    const col = (this._board.columns || []).find((c) => c.id === colId);
    if (!col) return;
    let changes = null;
    if (toLane !== null && drag.lane !== null) {
      const card = this._findCard(drag.id);
      changes = card ? swimlaneChanges(this._lanes, card, drag.lane, toLane) : null;
      if (changes?.error) { alert(changes.error); return; }
      if (changes?.card_type === "task" && card.card_type === "epic" &&
          boardCards(this._board).some((c) => c.epic_id === card.id) &&
          !confirm(`Turn epic "${card.title}" into a task? Its cards will be removed from the epic.`)) return;
    }
    const full = (col.cards || []).map((c) => c.id).filter((id) => id !== drag.id);
    const shown = [...list.querySelectorAll(".hk-card")].map((n) => n.dataset.card).filter((id) => id !== drag.id);
    const after = cardAfter(list, y);
    let position;
    if (after) position = full.indexOf(after.dataset.card);
    else if (shown.length) position = full.indexOf(shown[shown.length - 1]) + 1;
    else position = full.length;
    if (position < 0) position = full.length;
    const original = (col.cards || []).map((c) => c.id);
    const unmoved = drag.from === colId && original.indexOf(drag.id) === position;
    if (!unmoved) this._api.moveCard(drag.id, colId, position);
    if (changes) this._api.updateCard(drag.id, changes);
  }

  _newCard(colId, laneKey) {
    const lane = laneKey != null ? (swimlanes(this._board, this._lanes) || []).find((l) => l.key === laneKey) : null;
    openNewCardDialog(() => this._board, colId, this._api, {
      ...(lane?.preset || {}),
      onOpenCard: (id) => this._openCard(id),
    });
  }

  _submitCards(colId, value) {
    const lines = value.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    if (lines.length === 1) this._api.createCard(this._board.id, colId, lines[0]);
    else this._api.pasteCards(this._board.id, colId, lines);
    // keep composer open for rapid entry
    this._composer = { openCol: colId, value: "" };
    this.render();
  }

  _submitColumn(value) {
    const title = value.trim();
    if (title) this._api.createColumn(this._board.id, title);
    this._addCol = { open: true, value: "" };
    this.render();
  }

  // Public so the panel's archive list can open an archived card.
  openCard(cardId) {
    this._openCard(cardId);
  }

  _openCard(cardId) {
    this._openCardId = cardId;
    const card = this._findCard(cardId);
    if (!card) return;
    if (!this._modal) {
      this._modal = new HakanbanCardDetail();
      document.body.appendChild(this._modal);
    }
    this._modal.setContext({
      card,
      board: this._board,
      api: this._api,
      onOpenCard: (id) => this._openCard(id),
      onClose: () => {
        this._openCardId = null;
        this._modal = null;
      },
    });
  }

  _findCard(cardId) {
    return boardCards(this._board).find((c) => c.id === cardId) || null;
  }

  _syncModal() {
    if (!this._openCardId || !this._modal) return;
    this._modal.update(this._findCard(this._openCardId), this._board);
  }
}

if (!customElements.get("hakanban-board")) {
  customElements.define("hakanban-board", HakanbanBoard);
}
