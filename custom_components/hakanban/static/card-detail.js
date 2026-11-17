// <hakanban-card-detail> — the full card modal. Self-contained; talks to the API
// directly and relies on the live subscription to refresh the board behind it.

import { STYLES } from "./styles.js";
import { openLabelManager } from "./dialogs.js";
import {
  escapeHtml,
  renderMarkdown,
  formatDue,
  formatTimestamp,
  contrastText,
  boardCards,
  boardEpics,
  epicChildren,
  epicProgress,
  renderRefs,
  cardIndex,
  openBlockers,
  dependents,
  dependsOn,
  cardPath,
  cardUrl,
  copyText,
  peopleList,
  personInfo,
  myPersonId,
  avatarHtml,
} from "./util.js";

export class HakanbanCardDetail extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._editingDesc = false;
  }

  setContext({ card, board, api, hass, onClose, onOpenCard }) {
    this._hass = hass;
    this._card = card;
    this._board = board;
    this._api = api;
    this._onClose = onClose;
    this._onOpenCard = onOpenCard;
    this.render();
  }

  // Kept current by the board (no re-render: people changes re-render via update()).
  set hass(hass) {
    this._hass = hass;
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
    const byId = cardIndex(b);

    // The card's own labels, in its order (drag or ←/→ to reorder), then the rest to add.
    const onCard = (c.labels || []).map((id) => labelById[id]).filter(Boolean);
    const cardLabelsHtml = onCard
      .map((l) => `<span class="hk-label-chip selected hk-sortable" draggable="true" tabindex="0" data-card-label="${l.id}"
          title="Drag (or focus and press ←/→) to reorder · Delete to remove"
          style="background:${l.color};color:${contrastText(l.color)}">${escapeHtml(l.name || "·")}<button class="hk-chip-x" data-label-remove="${l.id}" title="Remove label" aria-label="Remove label">✕</button></span>`)
      .join("");
    const labelsHtml = (b.labels || [])
      .filter((l) => !selected.has(l.id))
      .map((l) => `<span class="hk-label-chip" data-label="${l.id}" title="Add label" style="background:${l.color};color:${contrastText(l.color)}">${escapeHtml(l.name || "·")}</span>`)
      .join("");

    // Assignees: HA people. Chips (✕ to unassign), "Assign me", and a picker for the rest.
    const people = peopleList(this._hass);
    const me = myPersonId(this._hass);
    const assigned = c.assignees || [];
    const assigneeChips = assigned
      .map((id) => personInfo(this._hass, id))
      .map((p) => `<span class="hk-person-chip ${p.missing ? "missing" : ""}" data-person="${escapeHtml(p.id)}">${avatarHtml(p, "hk-avatar-sm")}${escapeHtml(p.name)}<button class="hk-chip-x" data-unassign="${escapeHtml(p.id)}" title="Unassign" aria-label="Unassign ${escapeHtml(p.name)}">✕</button></span>`)
      .join("");
    const spareOpts = people
      .filter((p) => !assigned.includes(p.id))
      .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join("");
    const assigneesHtml = `
          <div class="hk-section">
            <h3>Assignees</h3>
            <div class="hk-row hk-wrap" id="hk-assignees">
              ${assigneeChips}
              ${me && !assigned.includes(me) ? `<button class="hk-btn secondary" id="hk-assign-me">Assign me</button>` : ""}
              ${spareOpts ? `<select id="hk-assign" class="hk-dep-select"><option value="">+ Assign someone…</option>${spareOpts}</select>` : ""}
              ${!people.length && !assigned.length ? `<span class="hk-muted">No people in Home Assistant yet. Add them under Settings → People.</span>` : ""}
            </div>
          </div>`;

    // Dependencies
    const depRow = (x, removeAttr) => `<div class="hk-epic-child ${x.status === "completed" ? "done" : ""}" data-open-card="${x.id}">
        <span class="num">#${x.number}</span><span class="ttl">${escapeHtml(x.title)}</span>
        <span class="col">${x.archived ? "archived" : x.status === "completed" ? "✓ done" : escapeHtml((b.columns.find((col) => col.id === x.column_id) || {}).title || "")}</span>
        <button class="hk-btn secondary" ${removeAttr}="${x.id}" title="Remove dependency">✕</button>
      </div>`;
    const blockerCards = (c.blocked_by || []).map((id) => byId[id]).filter(Boolean).sort((x, z) => x.number - z.number);
    const waitingCards = dependents(c, byId);
    const stillOpen = c.status === "completed" ? [] : openBlockers(c, byId);
    const candidates = Object.values(byId)
      .filter((x) => !x.archived && x.status !== "completed" && x.id !== c.id)
      .sort((x, z) => x.number - z.number);
    const blockerOpts = candidates
      .filter((x) => !(c.blocked_by || []).includes(x.id) && !dependsOn(x, c, byId))
      .map((x) => `<option value="${x.id}">#${x.number} ${escapeHtml(x.title)}</option>`).join("");
    const waitingOpts = candidates
      .filter((x) => !(x.blocked_by || []).includes(c.id) && !dependsOn(c, x, byId))
      .map((x) => `<option value="${x.id}">#${x.number} ${escapeHtml(x.title)}</option>`).join("");
    const depsHtml = `
          <div class="hk-section">
            <h3>Dependencies</h3>
            <div class="hk-dep-head">Blocked by${stillOpen.length ? ` <span class="hk-dep-state">⛔ waiting on ${stillOpen.length}</span>` : blockerCards.length ? ` <span class="hk-dep-state ok">✓ ready</span>` : ""}</div>
            ${blockerCards.map((x) => depRow(x, "data-dep-remove")).join("")}
            ${blockerOpts ? `<div class="hk-row"><select id="hk-dep-add" class="hk-dep-select"><option value="">+ Add a card this is waiting on…</option>${blockerOpts}</select></div>` : ""}
            <div class="hk-dep-head">Blocks</div>
            ${waitingCards.map((x) => depRow(x, "data-dep-unblock")).join("")}
            ${waitingOpts ? `<div class="hk-row"><select id="hk-dep-block" class="hk-dep-select"><option value="">+ Add a card waiting on this…</option>${waitingOpts}</select></div>` : ""}
          </div>`;

    // Checklists: rename / delete a list, tick, edit (click the text), delete, and drag
    // (or Alt+↑/↓) items to reorder them or move them between this card's checklists.
    const checklistsHtml = (c.checklists || [])
      .map((cl) => {
        const total = cl.items.length;
        const done = cl.items.filter((i) => i.done).length;
        const pct = total ? Math.round((100 * done) / total) : 0;
        const items = cl.items
          .map((i) => {
            const key = `${cl.id}:${i.id}`;
            if (this._editItem === key) {
              return `<div class="hk-check-item editing" data-item="${key}">
                  <input type="checkbox" disabled ${i.done ? "checked" : ""} aria-hidden="true">
                  <input type="text" class="hk-check-edit" data-keep="item-edit" value="${escapeHtml(i.text)}" aria-label="Item text">
                  <button class="hk-btn" data-item-save>Save</button>
                  <button class="hk-btn secondary" data-item-cancel>Cancel</button>
                </div>`;
            }
            return `<div class="hk-check-item ${i.done ? "done" : ""}" draggable="true" data-item="${key}">
                <span class="hk-drag-handle" title="Drag to reorder" aria-hidden="true">⋮⋮</span>
                <input type="checkbox" data-check="${key}" ${i.done ? "checked" : ""} aria-label="Done">
                <span class="hk-check-text" tabindex="0" data-item-text="${key}" data-keep="item-${key}" title="Click to edit · Alt+↑/↓ to move">${renderRefs(i.text, b)}</span>
                <button class="hk-icon-btn" data-item-delete="${key}" title="Delete item" aria-label="Delete item">✕</button>
              </div>`;
          })
          .join("");
        return `<div class="hk-section hk-checklist">
            <div class="hk-cl-head">
              <input type="text" class="hk-cl-title" data-cl-title="${cl.id}" data-keep="cl-title-${cl.id}" value="${escapeHtml(cl.title)}" aria-label="Checklist name" title="Click to rename">
              <span class="hk-muted">${done}/${total}</span>
              <button class="hk-btn secondary" data-cl-delete="${cl.id}">Delete</button>
            </div>
            ${total ? `<div class="hk-progress hk-cl-progress"><span style="width:${pct}%"></span></div>` : ""}
            <div class="hk-check-items" data-cl-items="${cl.id}">${items}</div>
            <div class="hk-row"><input type="text" class="hk-add-check" data-cl="${cl.id}" data-keep="add-${cl.id}" placeholder="Add an item…" title="Enter adds it · paste several lines to add one item per line"></div>
          </div>`;
      })
      .join("");

    const commentsHtml = (c.comments || [])
      .slice()
      .reverse()
      .map(
        (cm) =>
          `<div class="hk-comment"><span class="who">${escapeHtml(cm.author)}</span><span class="when">${formatDue(cm.ts)}</span><div>${renderRefs(cm.text, b)}</div></div>`
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
              <input type="text" id="hk-epic-new" data-keep="epic-new" placeholder="New card in this epic…" style="flex:1">
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

    // A live push re-renders the whole modal; keep whatever field the user is typing in.
    const active = this.shadowRoot.activeElement;
    const keep = active?.dataset?.keep
      ? { key: active.dataset.keep, value: active.value, start: active.selectionStart, end: active.selectionEnd }
      : null;
    this._rendering = true; // blur handlers ignore the blur caused by replacing the DOM
    this.shadowRoot.innerHTML = `
      <style>${STYLES}</style>
      <div class="hk-modal-back">
        <div class="hk-modal" role="dialog" aria-modal="true">
          ${c.archived ? `<div class="hk-archived-banner">🗄 This card is archived.</div>` : ""}
          ${isEpic ? `<span class="hk-epic-tag">EPIC</span>` : ""}
          <h2><textarea class="hk-title-edit" rows="1" data-keep="title">${escapeHtml(c.title)}</textarea></h2>
          <div class="hk-meta"><a class="hk-card-link" id="hk-copy-link" href="${cardPath(c.id)}" title="Copy a link to this card">${
            this._copied ? "✓ Link copied" : `🔗 #${c.number}`
          }</a> · in <strong>${escapeHtml(colTitle(c.column_id))}</strong>${
            c.status === "completed" && c.completed
              ? ` · <span class="hk-completed-at">✓ Completed ${escapeHtml(formatTimestamp(c.completed))}</span>`
              : ""
          }${
            stillOpen.length
              ? ` · <span class="hk-blocked-at" title="Waiting on ${escapeHtml(stillOpen.map((x) => `#${x.number} ${x.title}`).join(", "))}">⛔ Blocked by ${stillOpen.map((x) => `#${x.number}`).join(", ")}</span>`
              : ""
          }</div>

          ${assigneesHtml}

          <div class="hk-section">
            <h3>Type</h3>
            <div class="hk-seg">
              <button data-type="task" class="${isEpic ? "" : "on"}">Task</button>
              <button data-type="epic" class="${isEpic ? "on" : ""}">Epic</button>
            </div>
          </div>

          ${epicHtml}

          ${depsHtml}

          <div class="hk-section">
            <h3>Labels${onCard.length > 1 ? ` <span class="hk-muted hk-hint">drag to reorder</span>` : ""}</h3>
            ${onCard.length ? `<div class="hk-label-row" id="hk-card-labels">${cardLabelsHtml}</div>` : ""}
            <div class="hk-label-row hk-label-add">${labelsHtml}
              <span class="hk-label-chip" id="hk-manage-labels" style="background:var(--hk-divider);color:var(--hk-text)">✎ Edit labels</span>
            </div>
          </div>

          <div class="hk-section">
            <h3>Due date</h3>
            <div class="hk-row">
              <input type="datetime-local" id="hk-due" value="${dueLocal}">
              <button class="hk-btn secondary" id="hk-due-clear">Clear</button>
            </div>
          </div>

          <div class="hk-section">
            <h3>Description</h3>
            ${
              this._editingDesc
                ? `<textarea class="hk-desc-edit" id="hk-desc" data-keep="desc">${escapeHtml(c.description || "")}</textarea>
                   <div class="hk-row" style="margin-top:6px"><button class="hk-btn" id="hk-desc-save">Save</button><button class="hk-btn secondary" id="hk-desc-cancel">Cancel</button></div>`
                : `<div class="hk-desc-render" id="hk-desc-render">${renderMarkdown(c.description, b) || '<span style="color:var(--hk-subtle)">Add a more detailed description…</span>'}</div>`
            }
          </div>

          ${checklistsHtml}
          <div class="hk-row"><button class="hk-btn secondary" id="hk-add-checklist">+ Add checklist</button></div>

          <div class="hk-section">
            <h3>Activity</h3>
            <div class="hk-row"><input type="text" id="hk-comment" data-keep="comment" placeholder="Write a comment…" style="flex:1"><button class="hk-btn" id="hk-comment-add">Comment</button></div>
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

    this._rendering = false;
    this._wire();
    const kept = keep && this.shadowRoot.querySelector(`[data-keep="${keep.key}"]`);
    if (kept) {
      if ("value" in kept) kept.value = keep.value;
      kept.focus();
      try { kept.setSelectionRange(keep.start, keep.end); } catch (_) { /* not a text field */ }
    } else if (this._editItem) {
      const el = this.shadowRoot.querySelector(".hk-check-edit");
      if (el) { el.focus(); el.select(); }
    }
    if (this._focusLabel) {
      this.shadowRoot.querySelector(`[data-card-label="${this._focusLabel}"]`)?.focus();
      this._focusLabel = null;
    }
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

    // The card's number is its link: click copies it; Ctrl/⌘/middle-click opens it in a new
    // tab and right-click → Copy link address work natively because it's a real <a href>.
    $("#hk-copy-link").addEventListener("click", async (e) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      if (!(await copyText(cardUrl(c.id)))) {
        prompt("Copy this link:", cardUrl(c.id));
        return;
      }
      this._copied = true;
      this.render();
      clearTimeout(this._copiedTimer);
      this._copiedTimer = setTimeout(() => {
        this._copied = false;
        if (this.isConnected) this.render();
      }, 1500);
    });

    const titleEl = $(".hk-title-edit");
    const saveTitle = () => {
      const v = titleEl.value.trim();
      if (v && v !== c.title) api.updateCard(c.id, { title: v });
    };
    titleEl.addEventListener("blur", () => { if (!this._rendering) saveTitle(); });
    titleEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); titleEl.blur(); }
    });

    // "#12" references (description, comments, checklist items) open that card.
    root.querySelectorAll("[data-ref]").forEach((el) => {
      const go = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this._onOpenCard) this._onOpenCard(el.dataset.ref);
      };
      el.addEventListener("click", go);
      el.addEventListener("keydown", (e) => { if (e.key === "Enter") go(e); });
    });

    // Labels: click a spare label to add it (at the end), ✕ / Delete to remove one,
    // drag or ←/→ to reorder the card's own labels.
    const current = () => (c.labels || []).filter((id) => (this._board.labels || []).some((l) => l.id === id));
    const setLabels = (labels) => {
      if (labels.join() !== (c.labels || []).join()) api.updateCard(c.id, { labels });
    };
    root.querySelectorAll(".hk-label-chip[data-label]").forEach((chip) =>
      chip.addEventListener("click", () => setLabels([...current(), chip.dataset.label]))
    );
    root.querySelectorAll("[data-label-remove]").forEach((btn) =>
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        setLabels(current().filter((id) => id !== btn.dataset.labelRemove));
      })
    );
    const labelRow = $("#hk-card-labels");
    if (labelRow) {
      let dragEl = null;
      let dropped = false;
      const chips = () => [...labelRow.querySelectorAll("[data-card-label]")];
      labelRow.querySelectorAll("[data-card-label]").forEach((chip) => {
        chip.addEventListener("dragstart", (e) => {
          dragEl = chip;
          dropped = false;
          chip.classList.add("dragging");
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", chip.dataset.cardLabel);
        });
        chip.addEventListener("dragend", () => {
          chip.classList.remove("dragging");
          dragEl = null;
          // Cancelled (Esc / dropped elsewhere): undo the live preview.
          if (dropped) setLabels(chips().map((x) => x.dataset.cardLabel));
          else this.render();
        });
        chip.addEventListener("keydown", (e) => {
          const ids = current();
          const i = ids.indexOf(chip.dataset.cardLabel);
          if (i < 0) return;
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            const j = i + (e.key === "ArrowLeft" ? -1 : 1);
            if (j < 0 || j >= ids.length) return;
            e.preventDefault();
            [ids[i], ids[j]] = [ids[j], ids[i]];
            this._focusLabel = chip.dataset.cardLabel;
            setLabels(ids);
          } else if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            setLabels(ids.filter((id) => id !== chip.dataset.cardLabel));
          }
        });
      });
      // Live preview: move the dragged chip as the pointer passes the others (chips wrap).
      labelRow.addEventListener("dragover", (e) => {
        if (!dragEl) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const before = chips().find((ch) => {
          if (ch === dragEl) return false;
          const r = ch.getBoundingClientRect();
          return e.clientY < r.top || (e.clientY <= r.bottom && e.clientX < r.left + r.width / 2);
        });
        if (before !== dragEl.nextElementSibling) labelRow.insertBefore(dragEl, before || null);
      });
      labelRow.addEventListener("drop", (e) => {
        if (!dragEl) return;
        e.preventDefault();
        dropped = true;
      });
    }

    // Assignees
    const assignSel = $("#hk-assign");
    if (assignSel) assignSel.addEventListener("change", () => {
      if (assignSel.value) api.updateCard(c.id, { assignees: [...(c.assignees || []), assignSel.value] });
    });
    const assignMe = $("#hk-assign-me");
    if (assignMe) assignMe.addEventListener("click", () => {
      const me = myPersonId(this._hass);
      if (me) api.updateCard(c.id, { assignees: [...(c.assignees || []), me] });
    });
    root.querySelectorAll("[data-unassign]").forEach((btn) =>
      btn.addEventListener("click", () =>
        api.updateCard(c.id, { assignees: (c.assignees || []).filter((id) => id !== btn.dataset.unassign) })
      )
    );

    // Dependencies
    const depAdd = $("#hk-dep-add");
    if (depAdd) depAdd.addEventListener("change", () => {
      if (depAdd.value) api.updateCard(c.id, { blocked_by: [...(c.blocked_by || []), depAdd.value] });
    });
    const depBlock = $("#hk-dep-block");
    if (depBlock) depBlock.addEventListener("change", () => {
      const other = cardIndex(this._board)[depBlock.value];
      if (other) api.updateCard(other.id, { blocked_by: [...(other.blocked_by || []), c.id] });
    });
    root.querySelectorAll("[data-dep-remove]").forEach((btn) =>
      btn.addEventListener("click", () =>
        api.updateCard(c.id, { blocked_by: (c.blocked_by || []).filter((id) => id !== btn.dataset.depRemove) })
      )
    );
    root.querySelectorAll("[data-dep-unblock]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const other = cardIndex(this._board)[btn.dataset.depUnblock];
        if (other) api.updateCard(other.id, { blocked_by: (other.blocked_by || []).filter((id) => id !== c.id) });
      })
    );

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
        const btn = e.target.closest("button");
        if (btn && btn !== el) return; // ✕ buttons inside a row
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
    $("#hk-due-clear").addEventListener("click", () =>
      api.updateCard(c.id, { due: null })
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
    const findItem = (key) => {
      const [clId, itemId] = key.split(":");
      const cl = (c.checklists || []).find((x) => x.id === clId);
      return { clId, itemId, cl, item: cl?.items.find((i) => i.id === itemId) };
    };
    $("#hk-add-checklist").addEventListener("click", async () => {
      const cl = await api.addChecklist(c.id, "Checklist");
      // Straight into renaming it (the push has already re-rendered by now).
      const el = cl?.id && root.querySelector(`[data-cl-title="${cl.id}"]`);
      if (el) { el.focus(); el.select(); }
    });
    root.querySelectorAll("[data-cl-title]").forEach((inp) => {
      const cl = (c.checklists || []).find((x) => x.id === inp.dataset.clTitle);
      let sent = cl.title;
      const commit = () => {
        const v = inp.value.trim();
        if (!v) inp.value = cl.title;
        else if (v !== sent) { sent = v; api.updateChecklist(c.id, cl.id, v); }
      };
      inp.addEventListener("keydown", (e) => {
        // A push may re-render (and re-focus a fresh copy of this field) during commit(),
        // so blur whichever copy is live rather than `inp`.
        const blurLive = () => root.querySelector(`[data-cl-title="${cl.id}"]`)?.blur();
        if (e.key === "Enter") { e.preventDefault(); commit(); blurLive(); }
        else if (e.key === "Escape") { e.stopPropagation(); inp.value = cl.title; blurLive(); }
      });
      inp.addEventListener("blur", () => { if (!this._rendering) commit(); });
    });
    root.querySelectorAll("[data-cl-delete]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const cl = (c.checklists || []).find((x) => x.id === btn.dataset.clDelete);
        if (cl.items.length && !confirm(`Delete the checklist "${cl.title}" and its ${cl.items.length} item(s)?`)) return;
        api.deleteChecklist(c.id, cl.id);
      })
    );
    root.querySelectorAll("input[data-check]").forEach((cb) => {
      cb.addEventListener("change", () => {
        const { clId, itemId } = findItem(cb.dataset.check);
        api.updateCheckItem(c.id, clId, itemId, { done: cb.checked });
      });
    });
    root.querySelectorAll("[data-item-text]").forEach((el) => {
      const startEdit = () => { this._editItem = el.dataset.itemText; this.render(); };
      el.addEventListener("click", (e) => { if (!e.target.closest("[data-ref]")) startEdit(); });
      el.addEventListener("keydown", (e) => {
        const { clId, itemId, cl } = findItem(el.dataset.itemText);
        if (e.key === "Enter") { e.preventDefault(); startEdit(); }
        else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
          e.preventDefault();
          const i = cl.items.findIndex((x) => x.id === itemId);
          const j = i + (e.key === "ArrowUp" ? -1 : 1);
          if (j < 0 || j >= cl.items.length) return;
          // Optimistic: reorder locally so focus can follow the item at once.
          cl.items.splice(j, 0, cl.items.splice(i, 1)[0]);
          this.render();
          root.querySelector(`[data-item-text="${clId}:${itemId}"]`)?.focus();
          api.moveCheckItem(c.id, clId, itemId, j);
        } else if (e.key === "Delete") {
          e.preventDefault();
          api.deleteCheckItem(c.id, clId, itemId);
        }
      });
    });
    root.querySelectorAll("[data-item-delete]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const { clId, itemId } = findItem(btn.dataset.itemDelete);
        api.deleteCheckItem(c.id, clId, itemId);
      })
    );
    const editEl = $(".hk-check-edit");
    if (editEl) {
      const { clId, itemId, item } = findItem(this._editItem);
      let finished = false;
      const finish = (save) => {
        if (finished) return;
        finished = true;
        this._editItem = null;
        const v = editEl.value.trim();
        if (save && item && v !== item.text) {
          if (v) {
            item.text = v; // optimistic
            api.updateCheckItem(c.id, clId, itemId, { text: v });
          } else {
            api.deleteCheckItem(c.id, clId, itemId); // emptied = removed
          }
        }
        this.render();
      };
      editEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); finish(true); }
        else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); }
      });
      editEl.addEventListener("blur", () => { if (!this._rendering) finish(true); });
      // mousedown so the click doesn't blur (and save) the field first
      root.querySelector("[data-item-save]").addEventListener("mousedown", (e) => { e.preventDefault(); finish(true); });
      root.querySelector("[data-item-cancel]").addEventListener("mousedown", (e) => { e.preventDefault(); finish(false); });
    }
    const addItems = (clId, lines) => {
      const texts = lines.map((l) => l.trim()).filter(Boolean);
      // Sequential so they land in order.
      texts.reduce((p, t) => p.then(() => api.addCheckItem(c.id, clId, t)), Promise.resolve());
    };
    root.querySelectorAll(".hk-add-check").forEach((inp) => {
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && inp.value.trim()) {
          addItems(inp.dataset.cl, [inp.value]);
          inp.value = "";
        } else if (e.key === "Escape" && inp.value) {
          e.stopPropagation();
          inp.value = "";
        }
      });
      // Inputs flatten newlines, so catch a multi-line paste and add one item per line.
      inp.addEventListener("paste", (e) => {
        const text = e.clipboardData?.getData("text") || "";
        if (!/\r?\n/.test(text.trim())) return;
        e.preventDefault();
        addItems(inp.dataset.cl, [inp.value + text.split(/\r?\n/)[0], ...text.split(/\r?\n/).slice(1)]);
        inp.value = "";
      });
    });
    // Drag items to reorder, including into another checklist on this card.
    let dragItem = null;
    let dropped = false;
    root.querySelectorAll(".hk-check-item[draggable]").forEach((row) => {
      row.addEventListener("dragstart", (e) => {
        if (e.target !== row) return;
        dragItem = row;
        dropped = false;
        row.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", row.dataset.item);
      });
      row.addEventListener("dragend", () => {
        row.classList.remove("dragging");
        const el = dragItem;
        dragItem = null;
        if (!el) return;
        if (!dropped) { this.render(); return; } // cancelled: undo the live preview
        const list = el.closest("[data-cl-items]");
        const toCl = list.dataset.clItems;
        const position = [...list.querySelectorAll("[data-item]")].indexOf(el);
        const { clId, itemId, cl } = findItem(el.dataset.item);
        if (toCl === clId && cl.items[position]?.id === itemId) return;
        api.moveCheckItem(c.id, clId, itemId, position, toCl);
      });
    });
    root.querySelectorAll("[data-cl-items]").forEach((list) => {
      list.addEventListener("dragover", (e) => {
        if (!dragItem) return;
        e.preventDefault();
        const before = [...list.querySelectorAll("[data-item]")].find((r) => {
          if (r === dragItem) return false;
          const box = r.getBoundingClientRect();
          return e.clientY < box.top + box.height / 2;
        });
        if (before !== dragItem.nextElementSibling || dragItem.parentElement !== list) list.insertBefore(dragItem, before || null);
      });
      list.addEventListener("drop", (e) => {
        if (!dragItem) return;
        e.preventDefault();
        dropped = true;
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
