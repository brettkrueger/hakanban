// <hakanban-card-detail> — the full card modal. Self-contained; talks to the API
// directly and relies on the live subscription to refresh the board behind it.

import { STYLES } from "./styles.js";
import { openLabelManager } from "./dialogs.js";
import {
  escapeHtml,
  renderMarkdown,
  formatDue,
  contrastText,
  boardCards,
  boardEpics,
  epicChildren,
  epicProgress,
} from "./util.js";

export class HakanbanCardDetail extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._editingDesc = false;
  }

  setContext({ card, board, api, onClose, onOpenCard }) {
    this._card = card;
    this._board = board;
    this._api = api;
    this._onClose = onClose;
    this._onOpenCard = onOpenCard;
    this.render();
  }

  // Called by the parent when fresh board data arrives.
  update(card, board) {
    this._card = card;
    this._board = board;
    if (card) this.render();
    else this._close();
  }

  _close() {
    if (this._onClose) this._onClose();
    this.remove();
  }

  render() {
    const c = this._card;
    const b = this._board;
    if (!c) return;
    const labelById = Object.fromEntries((b.labels || []).map((l) => [l.id, l]));
    const selected = new Set(c.labels || []);

    const labelsHtml = (b.labels || [])
      .map((l) => {
        const text = contrastText(l.color);
        const sel = selected.has(l.id) ? "selected" : "";
        return `<span class="hk-label-chip ${sel}" data-label="${l.id}" style="background:${l.color};color:${text}">${escapeHtml(l.name || "·")}</span>`;
      })
      .join("");

    const checklistsHtml = (c.checklists || [])
      .map((cl) => {
        const total = cl.items.length;
        const done = cl.items.filter((i) => i.done).length;
        const items = cl.items
          .map(
            (i) =>
              `<label class="hk-check-item ${i.done ? "done" : ""}"><input type="checkbox" data-check="${cl.id}:${i.id}" ${i.done ? "checked" : ""}><span>${escapeHtml(i.text)}</span></label>`
          )
          .join("");
        return `<div class="hk-section"><h3>${escapeHtml(cl.title)} (${done}/${total})</h3>${items}
          <div class="hk-row"><input type="text" class="hk-add-check" data-cl="${cl.id}" placeholder="Add an item…"></div></div>`;
      })
      .join("");

    const commentsHtml = (c.comments || [])
      .slice()
      .reverse()
      .map(
        (cm) =>
          `<div class="hk-comment"><span class="who">${escapeHtml(cm.author)}</span><span class="when">${formatDue(cm.ts)}</span><div>${escapeHtml(cm.text)}</div></div>`
      )
      .join("");

    const columnsOptions = (b.columns || [])
      .map((col) => `<option value="${col.id}" ${col.id === c.column_id ? "selected" : ""}>${escapeHtml(col.title)}</option>`)
      .join("");

    const dueLocal = c.due ? String(c.due).slice(0, 16) : "";
    const colTitle = (id) => (b.columns.find((x) => x.id === id) || {}).title || "";

    // Type + epic section
    const isEpic = c.card_type === "epic";
    let epicHtml;
    if (isEpic) {
      const kids = epicChildren(b, c.id);
      const p = epicProgress(b, c.id);
      const pct = p.total ? Math.round((100 * p.done) / p.total) : 0;
      const kidsHtml = kids
        .map(
          (k) => `<div class="hk-epic-child ${k.status === "completed" ? "done" : ""}" data-open-card="${k.id}">
              <span class="num">#${k.number}</span><span class="ttl">${escapeHtml(k.title)}</span>
              <span class="col">${k.archived ? "archived" : escapeHtml(colTitle(k.column_id))}</span>
              <button class="hk-btn secondary" data-unlink="${k.id}" title="Remove from epic">✕</button>
            </div>`
        )
        .join("");
      const free = boardCards(b)
        .filter((x) => !x.archived && x.card_type !== "epic" && !x.epic_id)
        .sort((a, z) => a.number - z.number)
        .map((x) => `<option value="${x.id}">#${x.number} ${escapeHtml(x.title)}</option>`)
        .join("");
      epicHtml = `
          <div class="hk-section">
            <h3>Cards in this epic (${p.done}/${p.total})</h3>
            ${p.total ? `<div class="hk-progress" style="margin-bottom:6px"><span style="width:${pct}%"></span></div>` : ""}
            ${kidsHtml || '<p class="hk-muted">No cards yet.</p>'}
            <div class="hk-row" style="margin-top:6px">
              <input type="text" id="hk-epic-new" placeholder="New card in this epic…" style="flex:1">
              ${free ? `<select id="hk-epic-link"><option value="">+ Add existing card…</option>${free}</select>` : ""}
            </div>
          </div>`;
    } else {
      const options = boardEpics(b)
        .map((e) => `<option value="${e.id}" ${e.id === c.epic_id ? "selected" : ""}>#${e.number} ${escapeHtml(e.title)}</option>`)
        .join("");
      const parent = c.epic_id ? boardCards(b).find((x) => x.id === c.epic_id) : null;
      epicHtml = `
          <div class="hk-section">
            <h3>Epic</h3>
            <div class="hk-row">
              <select id="hk-epic">${options ? `<option value="">None</option>${options}` : `<option value="">No epics on this board</option>`}</select>
              ${parent ? `<button class="hk-btn secondary" data-open-card="${parent.id}">Open epic</button>` : ""}
            </div>
          </div>`;
    }

    this.shadowRoot.innerHTML = `
      <style>${STYLES}</style>
      <div class="hk-modal-back">
        <div class="hk-modal" role="dialog" aria-modal="true">
          ${c.archived ? `<div class="hk-archived-banner">🗄 This card is archived.</div>` : ""}
          ${isEpic ? `<span class="hk-epic-tag">EPIC</span>` : ""}
          <h2><textarea class="hk-title-edit" rows="1">${escapeHtml(c.title)}</textarea></h2>
          <div class="hk-meta">#${c.number} · in <strong>${escapeHtml(colTitle(c.column_id))}</strong></div>

          <div class="hk-section">
            <h3>Type</h3>
            <div class="hk-seg">
              <button data-type="task" class="${isEpic ? "" : "on"}">Task</button>
              <button data-type="epic" class="${isEpic ? "on" : ""}">Epic</button>
            </div>
          </div>

          ${epicHtml}

          <div class="hk-section">
            <h3>Labels</h3>
            <div class="hk-label-row">${labelsHtml}
              <span class="hk-label-chip" id="hk-manage-labels" style="background:var(--hk-divider);color:var(--hk-text)">✎ Edit labels</span>
            </div>
          </div>

          <div class="hk-section">
            <h3>Due date</h3>
            <div class="hk-row">
              <input type="datetime-local" id="hk-due" value="${dueLocal}">
              <label><input type="checkbox" id="hk-due-complete" ${c.due_complete ? "checked" : ""}> Complete</label>
              <button class="hk-btn secondary" id="hk-due-clear">Clear</button>
            </div>
          </div>

          <div class="hk-section">
            <h3>Description</h3>
            ${
              this._editingDesc
                ? `<textarea class="hk-desc-edit" id="hk-desc">${escapeHtml(c.description || "")}</textarea>
                   <div class="hk-row" style="margin-top:6px"><button class="hk-btn" id="hk-desc-save">Save</button><button class="hk-btn secondary" id="hk-desc-cancel">Cancel</button></div>`
                : `<div class="hk-desc-render" id="hk-desc-render">${renderMarkdown(c.description) || '<span style="color:var(--hk-subtle)">Add a more detailed description…</span>'}</div>`
            }
          </div>

          ${checklistsHtml}
          <div class="hk-row"><button class="hk-btn secondary" id="hk-add-checklist">+ Add checklist</button></div>

          <div class="hk-section">
            <h3>Activity</h3>
            <div class="hk-row"><input type="text" id="hk-comment" placeholder="Write a comment…" style="flex:1"><button class="hk-btn" id="hk-comment-add">Comment</button></div>
            ${commentsHtml}
          </div>

          <div class="hk-modal-actions">
            <span class="hk-row grow">Move to <select id="hk-move">${columnsOptions}</select></span>
            <button class="hk-btn secondary" id="hk-archive">${c.archived ? "Unarchive" : "Archive"}</button>
            <button class="hk-btn hk-danger" id="hk-delete">Delete</button>
            <button class="hk-btn" id="hk-close">Close</button>
          </div>
        </div>
      </div>`;

    this._wire();
  }

  _wire() {
    const root = this.shadowRoot;
    const c = this._card;
    const api = this._api;
    const $ = (sel) => root.querySelector(sel);

    $(".hk-modal-back").addEventListener("mousedown", (e) => {
      if (e.target.classList.contains("hk-modal-back")) this._close();
    });
    $("#hk-close").addEventListener("click", () => this._close());

    const titleEl = $(".hk-title-edit");
    const saveTitle = () => {
      const v = titleEl.value.trim();
      if (v && v !== c.title) api.updateCard(c.id, { title: v });
    };
    titleEl.addEventListener("blur", saveTitle);
    titleEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); titleEl.blur(); }
    });

    root.querySelectorAll(".hk-label-chip[data-label]").forEach((chip) => {
      chip.addEventListener("click", () => {
        const id = chip.dataset.label;
        const labels = new Set(c.labels || []);
        labels.has(id) ? labels.delete(id) : labels.add(id);
        api.updateCard(c.id, { labels: [...labels] });
      });
    });

    $("#hk-manage-labels").addEventListener("click", () =>
      openLabelManager(() => this._board, api)
    );

    // Type
    root.querySelectorAll("[data-type]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const type = btn.dataset.type;
        if (type === (c.card_type || "task")) return;
        if (type === "task" && epicChildren(this._board, c.id).length &&
            !confirm("Turn this epic back into a task? Its cards will be removed from the epic.")) return;
        api.updateCard(c.id, { card_type: type });
      })
    );

    // Epic membership
    const epicSel = $("#hk-epic");
    if (epicSel) epicSel.addEventListener("change", () =>
      api.updateCard(c.id, { epic_id: epicSel.value || null })
    );
    root.querySelectorAll("[data-open-card]").forEach((el) =>
      el.addEventListener("click", (e) => {
        if (e.target.closest("[data-unlink]")) return;
        if (this._onOpenCard) this._onOpenCard(el.dataset.openCard);
      })
    );
    root.querySelectorAll("[data-unlink]").forEach((btn) =>
      btn.addEventListener("click", () => api.updateCard(btn.dataset.unlink, { epic_id: null }))
    );
    const linkSel = $("#hk-epic-link");
    if (linkSel) linkSel.addEventListener("change", () => {
      if (linkSel.value) api.updateCard(linkSel.value, { epic_id: c.id });
    });
    const newChild = $("#hk-epic-new");
    if (newChild) newChild.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && newChild.value.trim()) {
        // New children start in the board's first list (usually "To Do").
        const firstCol = (this._board.columns[0] || {}).id || c.column_id;
        api.createCard(this._board.id, firstCol, newChild.value.trim(), { epic_id: c.id });
        newChild.value = "";
      }
    });

    // Due
    $("#hk-due").addEventListener("change", (e) => {
      const v = e.target.value;
      api.updateCard(c.id, { due: v ? v + ":00" : null });
    });
    $("#hk-due-complete").addEventListener("change", (e) =>
      api.updateCard(c.id, { due_complete: e.target.checked })
    );
    $("#hk-due-clear").addEventListener("click", () =>
      api.updateCard(c.id, { due: null, due_complete: false })
    );

    // Description
    if (this._editingDesc) {
      $("#hk-desc-save").addEventListener("click", () => {
        this._editingDesc = false;
        api.updateCard(c.id, { description: $("#hk-desc").value });
      });
      $("#hk-desc-cancel").addEventListener("click", () => {
        this._editingDesc = false;
        this.render();
      });
    } else {
      $("#hk-desc-render").addEventListener("click", () => {
        this._editingDesc = true;
        this.render();
      });
    }

    // Checklists
    $("#hk-add-checklist").addEventListener("click", async () => {
      await api.addChecklist(c.id, "Checklist");
    });
    root.querySelectorAll("input[data-check]").forEach((cb) => {
      cb.addEventListener("change", () => {
        const [clId, itemId] = cb.dataset.check.split(":");
        api.toggleCheckItem(c.id, clId, itemId, cb.checked);
      });
    });
    root.querySelectorAll(".hk-add-check").forEach((inp) => {
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && inp.value.trim()) {
          api.addCheckItem(c.id, inp.dataset.cl, inp.value.trim());
          inp.value = "";
        }
      });
    });

    // Comments
    const commentInput = $("#hk-comment");
    const sendComment = () => {
      if (commentInput.value.trim()) {
        api.addComment(c.id, commentInput.value.trim());
        commentInput.value = "";
      }
    };
    $("#hk-comment-add").addEventListener("click", sendComment);
    commentInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendComment();
    });

    // Actions
    $("#hk-move").addEventListener("change", (e) =>
      api.moveCard(c.id, e.target.value)
    );
    $("#hk-archive").addEventListener("click", () =>
      api.updateCard(c.id, { archived: !c.archived })
    );
    $("#hk-delete").addEventListener("click", () => {
      api.deleteCard(c.id);
      this._close();
    });
  }
}

if (!customElements.get("hakanban-card-detail")) {
  customElements.define("hakanban-card-detail", HakanbanCardDetail);
}
