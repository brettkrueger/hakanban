// Modal dialogs shared by the panel, the board view and the card modal.
// Each dialog mounts on document.body in its own shadow root (like the card modal), so a
// board re-render from a live push never wipes it out.

import { STYLES } from "./styles.js";
import {
  escapeHtml, contrastText, boardCards, boardEpics, normalizeHex,
  peopleList, personInfo, myPersonId, avatarHtml,
} from "./util.js";

export const PALETTE = [
  "#61bd4f", "#f2d600", "#ff9f1a", "#eb5a46", "#c377e0",
  "#0079bf", "#00c2e0", "#51e898", "#ff78cb", "#344563",
];

// Mount a dialog shell. Returns { root, close } where root is the shadow root.
// `beforeClose()` may return false to keep the dialog open on Escape / backdrop click.
export function openDialog(title, bodyHtml, { width = 460, beforeClose = null } = {}) {
  const host = document.createElement("div");
  host.className = "hakanban-dialog-host";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>${STYLES}</style>
    <div class="hk-modal-back">
      <div class="hk-modal hk-dialog" role="dialog" aria-modal="true" style="width:min(${width}px,100%)">
        <h2>${escapeHtml(title)}</h2>
        <div class="hk-dialog-body">${bodyHtml}</div>
      </div>
    </div>`;
  document.body.appendChild(host);
  const close = () => {
    host.remove();
    window.removeEventListener("keydown", onKey, true);
  };
  const dismiss = () => {
    if (!beforeClose || beforeClose() !== false) close();
  };
  const onKey = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); dismiss(); }
  };
  window.addEventListener("keydown", onKey, true);
  root.querySelector(".hk-modal-back").addEventListener("mousedown", (e) => {
    if (e.target.classList.contains("hk-modal-back")) dismiss();
  });
  return { root, close };
}

// A custom colour control: the browser's native colour picker (spectrum / wheel, plus an
// eyedropper in Chromium) next to a hex field. `prefix` namespaces the element ids.
// With `apply: true` an Apply button commits the hex field; picking in the native picker
// commits straight away.
export function colorInputHtml(prefix, value, { apply = true } = {}) {
  const hex = normalizeHex(value) || "#838c91";
  return `<span class="hk-color-custom">
      <input type="color" id="${prefix}-wheel" value="${hex}" title="Pick any colour">
      <input type="text" id="${prefix}-hex" class="hk-hex" value="${hex}" maxlength="7" placeholder="#rrggbb" spellcheck="false" aria-label="Hex colour">
      ${apply ? `<button class="hk-btn" id="${prefix}-apply">Apply</button>` : ""}
    </span>`;
}

// Wire a colorInputHtml control. onPick(hex) gets a normalised "#rrggbb".
export function wireColorInput(root, prefix, onPick, { apply = true } = {}) {
  const wheel = root.getElementById(`${prefix}-wheel`);
  const text = root.getElementById(`${prefix}-hex`);
  const btn = root.getElementById(`${prefix}-apply`);
  if (!wheel || !text) return;
  const validate = () => {
    const hex = normalizeHex(text.value);
    text.classList.toggle("invalid", !hex);
    if (btn) btn.disabled = !hex;
    return hex;
  };
  wheel.addEventListener("input", () => {
    text.value = wheel.value;
    validate();
    if (!apply) onPick(wheel.value);
  });
  // "change" fires when the native picker closes: commit the choice.
  wheel.addEventListener("change", () => onPick(wheel.value));
  text.addEventListener("input", () => {
    const hex = validate();
    if (hex) wheel.value = hex;
    if (hex && !apply) onPick(hex);
  });
  const commit = () => {
    const hex = validate();
    if (hex) onPick(hex);
  };
  text.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } });
  if (btn) btn.addEventListener("click", commit);
}

function swatches(selected, attr) {
  return PALETTE.map(
    (c) => `<span class="hk-swatch ${c === selected ? "selected" : ""}" ${attr}="${c}" title="${c}" style="background:${c}"></span>`
  ).join("");
}

// ---------------------------------------------------------------- labels
// getBoard() must return the *current* board payload: the WS API pushes the new payload
// before it resolves the command, so re-reading after each await sees the change.
export function openLabelManager(getBoard, api) {
  const { root, close } = openDialog("Labels", `<div id="hk-lm"></div>`, { width: 520 });
  let editing = null; // label id whose colour palette is open
  let newColor = PALETTE[0];

  const render = () => {
    const board = getBoard();
    if (!board) { close(); return; }
    const usage = {};
    for (const c of boardCards(board)) for (const l of c.labels || []) usage[l] = (usage[l] || 0) + 1;
    const rows = (board.labels || []).map((l) => `
      <div class="hk-lm-row" data-lid="${l.id}">
        <button class="hk-swatch big" data-pick="${l.id}" title="Change colour" style="background:${l.color};color:${contrastText(l.color)}">✎</button>
        <input type="text" class="hk-lm-name" data-name="${l.id}" value="${escapeHtml(l.name || "")}" placeholder="(no name)" maxlength="40">
        <span class="hk-lm-count" title="Cards using this label">${usage[l.id] || 0}</span>
        <button class="hk-btn secondary" data-del="${l.id}" title="Delete label">🗑</button>
      </div>
      ${editing === l.id ? `<div class="hk-row hk-lm-palette">${swatches(l.color, "data-recolor")}${colorInputHtml("hk-lm-recolor", l.color)}</div>` : ""}`
    ).join("");
    root.getElementById("hk-lm").innerHTML = `
      ${rows || `<p class="hk-muted">No labels yet.</p>`}
      <div class="hk-section">
        <h3>New label</h3>
        <div class="hk-row">
          <input type="text" id="hk-lm-new" placeholder="Label name" maxlength="40" style="flex:1">
          <button class="hk-btn" id="hk-lm-add">Add</button>
        </div>
        <div class="hk-row" style="margin-top:6px">${swatches(newColor, "data-newcolor")}${colorInputHtml("hk-lm-newcolor", newColor, { apply: false })}</div>
      </div>
      <div class="hk-modal-actions"><span class="grow"></span><button class="hk-btn" id="hk-lm-done">Done</button></div>`;
    wire();
  };

  const wire = () => {
    const board = getBoard();
    root.getElementById("hk-lm-done").addEventListener("click", close);
    root.querySelectorAll("[data-name]").forEach((inp) => {
      const save = async () => {
        const label = board.labels.find((l) => l.id === inp.dataset.name);
        if (label && inp.value.trim() !== (label.name || "")) {
          await api.updateLabel(board.id, label.id, { name: inp.value.trim() });
        }
      };
      inp.addEventListener("change", save);
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") inp.blur(); });
    });
    root.querySelectorAll("[data-pick]").forEach((btn) =>
      btn.addEventListener("click", () => {
        editing = editing === btn.dataset.pick ? null : btn.dataset.pick;
        render();
      })
    );
    const recolor = async (color) => {
      const id = editing;
      if (!id) return;
      editing = null;
      await api.updateLabel(board.id, id, { color });
      render();
    };
    root.querySelectorAll("[data-recolor]").forEach((sw) =>
      sw.addEventListener("click", () => recolor(sw.dataset.recolor))
    );
    wireColorInput(root, "hk-lm-recolor", recolor);
    root.querySelectorAll("[data-del]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const label = board.labels.find((l) => l.id === btn.dataset.del);
        const used = root.querySelector(`[data-lid="${btn.dataset.del}"] .hk-lm-count`)?.textContent || "0";
        const name = label?.name ? `"${label.name}"` : "this label";
        const msg = used !== "0"
          ? `Delete ${name}? It will be removed from ${used} card(s).`
          : `Delete ${name}?`;
        if (!confirm(msg)) return;
        await api.deleteLabel(board.id, btn.dataset.del);
        render();
      })
    );
    const setNewColor = (color, fromCustom = false) => {
      newColor = color;
      root.querySelectorAll("[data-newcolor]").forEach((s) =>
        s.classList.toggle("selected", s.dataset.newcolor === newColor)
      );
      if (!fromCustom) {
        root.getElementById("hk-lm-newcolor-wheel").value = color;
        root.getElementById("hk-lm-newcolor-hex").value = color;
      }
    };
    root.querySelectorAll("[data-newcolor]").forEach((sw) =>
      sw.addEventListener("click", () => setNewColor(sw.dataset.newcolor))
    );
    wireColorInput(root, "hk-lm-newcolor", (hex) => setNewColor(hex, true), { apply: false });
    const nameInput = root.getElementById("hk-lm-new");
    const add = async () => {
      await api.createLabel(board.id, nameInput.value.trim(), newColor);
      render();
      root.getElementById("hk-lm-new")?.focus();
    };
    root.getElementById("hk-lm-add").addEventListener("click", add);
    nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
  };

  render();
}

// ---------------------------------------------------------- list settings
export function openColumnSettings(board, column, api) {
  const days = column.auto_archive_days || "";
  const { root, close } = openDialog("List settings", `
    <div class="hk-section">
      <h3>Name</h3>
      <div class="hk-row"><input type="text" id="hk-cs-title" style="flex:1" maxlength="120" value="${escapeHtml(column.title)}"></div>
    </div>
    <div class="hk-section">
      <h3>Completion</h3>
      <label class="hk-row"><input type="checkbox" id="hk-cs-done" ${column.done ? "checked" : ""}> Cards in this list are done</label>
      <p class="hk-muted">Moving a card into a done list completes it and records when; moving it out
        reopens it. Completing a card from Home Assistant (e.g. ticking it in a to-do list) moves it
        to the first done list.</p>
    </div>
    <div class="hk-section">
      <h3>Automatic archival</h3>
      <div class="hk-row">
        <label class="hk-row"><input type="checkbox" id="hk-cs-auto" ${days ? "checked" : ""}> Archive cards after</label>
        <input type="number" id="hk-cs-days" min="1" max="3650" step="1" value="${days || 7}" style="width:5em" ${days ? "" : "disabled"}>
        <span>days in this list</span>
      </div>
      <p class="hk-muted">Checked hourly. The clock starts when a card enters the list (or is restored
        from the archive). Archived cards stay available from the toolbar's 🗄 Archive.</p>
    </div>
    <div class="hk-modal-actions">
      <span class="grow"></span>
      <button class="hk-btn secondary" id="hk-cs-cancel">Cancel</button>
      <button class="hk-btn" id="hk-cs-save">Save</button>
    </div>`);

  const auto = root.getElementById("hk-cs-auto");
  const dayInput = root.getElementById("hk-cs-days");
  auto.addEventListener("change", () => { dayInput.disabled = !auto.checked; });
  root.getElementById("hk-cs-cancel").addEventListener("click", close);
  const save = () => {
    const changes = {};
    const title = root.getElementById("hk-cs-title").value.trim();
    if (title && title !== column.title) changes.title = title;
    const done = root.getElementById("hk-cs-done").checked;
    if (done !== !!column.done) {
      const count = (column.cards || []).length;
      if (count && !confirm(done
        ? `Mark the ${count} card(s) in "${column.title}" as completed?`
        : `Reopen the ${count} completed card(s) in "${column.title}"?`)) return;
      changes.done = done;
    }
    const n = auto.checked ? Math.max(1, parseInt(dayInput.value, 10) || 0) : 0;
    if ((column.auto_archive_days || 0) !== n) {
      const count = (column.cards || []).length;
      if (n && count && !confirm(
        `Cards that have already been in "${column.title}" for ${n}+ days will be archived now. Continue?`
      )) return;
      changes.auto_archive_days = n;
    }
    if (Object.keys(changes).length) api.updateColumn(board.id, column.id, changes);
    close();
  };
  root.getElementById("hk-cs-save").addEventListener("click", save);
  root.querySelectorAll("input[type=text],input[type=number]").forEach((i) =>
    i.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); })
  );
  root.getElementById("hk-cs-title").focus();
}

// ---------------------------------------------------------------- new card
// Jira/Trello-style "create issue" form: fill in the whole ticket, then create it in one go.
// getBoard() returns the current board payload (labels/lists/epics can change while open).
// onOpenCard(id), if given, enables "Create & open" to jump into the full card view.
export function openNewCardDialog(getBoard, columnId, api, { onOpenCard = null, cardType = "task", epicId = "", labels = [], assignees = [], hass = null } = {}) {
  const state = {
    columnId,
    cardType,
    epicId,
    labels: new Set(labels),
    blockedBy: [],
    assignees: [...assignees],
    another: false,
  };
  const dirty = () =>
    ["hk-nc-title", "hk-nc-desc", "hk-nc-checks"].some((id) => (root.getElementById(id)?.value || "").trim());
  const { root, close } = openDialog("New card", `<div id="hk-nc"></div>`, {
    width: 620,
    beforeClose: () => !dirty() || confirm("Discard this card?"),
  });

  const labelChips = (board) =>
    (board.labels || [])
      .map((l) => `<span class="hk-label-chip ${state.labels.has(l.id) ? "selected" : ""}" data-nc-label="${l.id}"
          style="background:${l.color};color:${contrastText(l.color)}">${escapeHtml(l.name || "·")}</span>`)
      .join("") || `<span class="hk-muted">No labels on this board yet.</span>`;

  // "Assign to": chosen people as removable chips plus a picker of everyone else in HA.
  const assigneesHtml = () => {
    const people = peopleList(hass);
    const me = myPersonId(hass);
    const chips = state.assignees
      .map((id) => personInfo(hass, id))
      .map((p) => `<span class="hk-person-chip">${avatarHtml(p, "hk-avatar-sm")}${escapeHtml(p.name)}<button class="hk-chip-x" data-nc-unassign="${escapeHtml(p.id)}" title="Unassign" aria-label="Unassign ${escapeHtml(p.name)}">✕</button></span>`)
      .join("");
    const spare = people.filter((p) => !state.assignees.includes(p.id));
    const meBtn = me && !state.assignees.includes(me) ? `<button type="button" class="hk-btn secondary" data-nc-assign-me>Assign me</button>` : "";
    const opts = spare.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join("");
    if (!people.length && !chips) return `<span class="hk-muted">No people in Home Assistant yet (Settings → People).</span>`;
    return `${chips}${meBtn}${opts ? `<select id="hk-nc-assign" class="hk-dep-select"><option value="">+ Assign someone…</option>${opts}</select>` : ""}`;
  };

  // "Blocked by": chosen blockers as removable chips plus a picker of open cards.
  const blockersHtml = (board) => {
    const byId = Object.fromEntries(boardCards(board).map((c) => [c.id, c]));
    state.blockedBy = state.blockedBy.filter((id) => byId[id]);
    const chips = state.blockedBy
      .map((id) => byId[id])
      .map((c) => `<span class="hk-dep-chip">#${c.number} ${escapeHtml(c.title)}<button class="hk-chip-x" data-nc-unblock="${c.id}" title="Remove" aria-label="Remove">✕</button></span>`)
      .join("");
    const opts = Object.values(byId)
      .filter((c) => !c.archived && c.status !== "completed" && !state.blockedBy.includes(c.id))
      .sort((a, z) => a.number - z.number)
      .map((c) => `<option value="${c.id}">#${c.number} ${escapeHtml(c.title)}</option>`)
      .join("");
    return `${chips}${opts ? `<select id="hk-nc-block" class="hk-dep-select"><option value="">+ Waiting on another card…</option>${opts}</select>` : chips ? "" : `<span class="hk-muted">No open cards to depend on.</span>`}`;
  };

  const epicOptions = (board) => {
    const epics = boardEpics(board);
    if (!epics.length) return `<option value="">No epics on this board</option>`;
    return `<option value="">None</option>` + epics
      .map((e) => `<option value="${e.id}" ${e.id === state.epicId ? "selected" : ""}>#${e.number} ${escapeHtml(e.title)}</option>`)
      .join("");
  };

  const render = () => {
    const board = getBoard();
    if (!board) { close(); return; }
    if (!board.columns.some((c) => c.id === state.columnId)) state.columnId = board.columns[0]?.id;
    const isEpic = state.cardType === "epic";
    root.getElementById("hk-nc").innerHTML = `
      <div class="hk-nc-grid">
        <div class="hk-section">
          <h3>Type</h3>
          <div class="hk-seg">
            <button data-nc-type="task" class="${isEpic ? "" : "on"}">Task</button>
            <button data-nc-type="epic" class="${isEpic ? "on" : ""}">Epic</button>
          </div>
        </div>
        <div class="hk-section">
          <h3>List</h3>
          <div class="hk-row"><select id="hk-nc-col">${board.columns
            .map((c) => `<option value="${c.id}" ${c.id === state.columnId ? "selected" : ""}>${escapeHtml(c.title)}</option>`)
            .join("")}</select></div>
        </div>
        ${isEpic ? "" : `<div class="hk-section">
          <h3>Epic</h3>
          <div class="hk-row"><select id="hk-nc-epic">${epicOptions(board)}</select></div>
        </div>`}
      </div>
      <div class="hk-section">
        <h3>Title <span class="hk-req">*</span></h3>
        <input type="text" id="hk-nc-title" class="hk-nc-input" maxlength="500" placeholder="${isEpic ? "What's the epic?" : "What needs doing?"}">
      </div>
      <div class="hk-section">
        <h3>Labels</h3>
        <div class="hk-label-row" id="hk-nc-labels">${labelChips(board)}</div>
      </div>
      <div class="hk-section">
        <h3>Due date</h3>
        <div class="hk-row"><input type="datetime-local" id="hk-nc-due"></div>
      </div>
      <div class="hk-section">
        <h3>Assign to</h3>
        <div class="hk-row hk-wrap" id="hk-nc-people">${assigneesHtml()}</div>
      </div>
      <div class="hk-section">
        <h3>Blocked by</h3>
        <div class="hk-row hk-wrap" id="hk-nc-deps">${blockersHtml(board)}</div>
      </div>
      <div class="hk-section">
        <h3>Description</h3>
        <textarea class="hk-desc-edit" id="hk-nc-desc" placeholder="Add a more detailed description… (Markdown supported)"></textarea>
      </div>
      <div class="hk-section">
        <h3>Checklist</h3>
        <textarea class="hk-desc-edit hk-nc-checks" id="hk-nc-checks" placeholder="One item per line (optional)"></textarea>
      </div>
      <div class="hk-nc-error" id="hk-nc-error" hidden></div>
      <div class="hk-modal-actions">
        <label class="hk-row grow hk-muted"><input type="checkbox" id="hk-nc-another" ${state.another ? "checked" : ""}> Create another</label>
        <button class="hk-btn secondary" id="hk-nc-cancel">Cancel</button>
        ${onOpenCard ? `<button class="hk-btn secondary" id="hk-nc-open" title="Create, then open the full card">Create &amp; open</button>` : ""}
        <button class="hk-btn" id="hk-nc-create" title="Ctrl+Enter">Create</button>
      </div>`;
    wire();
  };

  // Re-render the type-dependent parts without losing what has been typed.
  const rerenderKeepingInput = () => {
    const keep = Object.fromEntries(
      ["hk-nc-title", "hk-nc-due", "hk-nc-desc", "hk-nc-checks"].map((id) => [id, root.getElementById(id).value])
    );
    render();
    for (const [id, v] of Object.entries(keep)) root.getElementById(id).value = v;
    root.getElementById("hk-nc-title").focus();
  };

  let busy = false;
  const submit = async (openAfter = false) => {
    if (busy) return;
    const titleEl = root.getElementById("hk-nc-title");
    const title = titleEl.value.trim();
    const err = root.getElementById("hk-nc-error");
    if (!title) {
      titleEl.classList.add("invalid");
      titleEl.focus();
      return;
    }
    const board = getBoard();
    const extra = { card_type: state.cardType };
    const desc = root.getElementById("hk-nc-desc").value.trim();
    if (desc) extra.description = desc;
    const labels = [...state.labels].filter((id) => (board.labels || []).some((l) => l.id === id));
    if (labels.length) extra.labels = labels;
    const due = root.getElementById("hk-nc-due").value;
    if (due) extra.due = due + ":00";
    if (state.cardType !== "epic" && state.epicId) extra.epic_id = state.epicId;
    if (state.blockedBy.length) extra.blocked_by = [...state.blockedBy];
    if (state.assignees.length) extra.assignees = [...state.assignees];
    const checks = root.getElementById("hk-nc-checks").value.split("\n").map((l) => l.trim()).filter(Boolean);

    busy = true;
    root.querySelectorAll(".hk-modal-actions button").forEach((b) => (b.disabled = true));
    err.hidden = true;
    try {
      const card = await api.createCard(board.id, state.columnId, title, extra);
      if (checks.length && card?.id) {
        const cl = await api.addChecklist(card.id, "Checklist");
        for (const text of checks) await api.addCheckItem(card.id, cl.id, text);
      }
      if (openAfter && card?.id) {
        close();
        onOpenCard(card.id);
      } else if (state.another) {
        // Keep type / list / epic / labels for rapid entry of related cards.
        render();
        root.getElementById("hk-nc-title").focus();
      } else {
        close();
      }
    } catch (e) {
      err.textContent = e?.message || String(e);
      err.hidden = false;
    } finally {
      busy = false;
      root.querySelectorAll(".hk-modal-actions button").forEach((b) => (b.disabled = false));
    }
  };

  const wire = () => {
    root.querySelectorAll("[data-nc-type]").forEach((b) =>
      b.addEventListener("click", () => {
        if (state.cardType === b.dataset.ncType) return;
        state.cardType = b.dataset.ncType;
        rerenderKeepingInput();
      })
    );
    root.getElementById("hk-nc-col").addEventListener("change", (e) => (state.columnId = e.target.value));
    root.getElementById("hk-nc-epic")?.addEventListener("change", (e) => (state.epicId = e.target.value));
    root.querySelectorAll("[data-nc-label]").forEach((chip) =>
      chip.addEventListener("click", () => {
        const id = chip.dataset.ncLabel;
        state.labels.has(id) ? state.labels.delete(id) : state.labels.add(id);
        chip.classList.toggle("selected", state.labels.has(id));
      })
    );
    const deps = root.getElementById("hk-nc-deps");
    const wireDeps = () => {
      deps.querySelector("#hk-nc-block")?.addEventListener("change", (e) => {
        if (!e.target.value) return;
        state.blockedBy.push(e.target.value);
        deps.innerHTML = blockersHtml(getBoard());
        wireDeps();
      });
      deps.querySelectorAll("[data-nc-unblock]").forEach((b) =>
        b.addEventListener("click", () => {
          state.blockedBy = state.blockedBy.filter((id) => id !== b.dataset.ncUnblock);
          deps.innerHTML = blockersHtml(getBoard());
          wireDeps();
        })
      );
    };
    wireDeps();
    const ppl = root.getElementById("hk-nc-people");
    const wirePeople = () => {
      const redraw = () => { ppl.innerHTML = assigneesHtml(); wirePeople(); };
      ppl.querySelector("#hk-nc-assign")?.addEventListener("change", (e) => {
        if (!e.target.value) return;
        state.assignees.push(e.target.value);
        redraw();
      });
      ppl.querySelector("[data-nc-assign-me]")?.addEventListener("click", () => {
        state.assignees.push(myPersonId(hass));
        redraw();
      });
      ppl.querySelectorAll("[data-nc-unassign]").forEach((b) =>
        b.addEventListener("click", () => {
          state.assignees = state.assignees.filter((id) => id !== b.dataset.ncUnassign);
          redraw();
        })
      );
    };
    wirePeople();
    root.getElementById("hk-nc-another").addEventListener("change", (e) => (state.another = e.target.checked));
    const titleEl = root.getElementById("hk-nc-title");
    titleEl.addEventListener("input", () => titleEl.classList.remove("invalid"));
    titleEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); submit(); }
    });
    root.getElementById("hk-nc").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
    });
    root.getElementById("hk-nc-cancel").addEventListener("click", () => {
      if (!dirty() || confirm("Discard this card?")) close();
    });
    root.getElementById("hk-nc-open")?.addEventListener("click", () => submit(true));
    root.getElementById("hk-nc-create").addEventListener("click", () => submit());
  };

  render();
  root.getElementById("hk-nc-title").focus();
}
