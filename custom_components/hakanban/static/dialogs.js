// Modal dialogs shared by the panel, the board view and the card modal.
// Each dialog mounts on document.body in its own shadow root (like the card modal), so a
// board re-render from a live push never wipes it out.

import { STYLES } from "./styles.js";
import { escapeHtml, contrastText, boardCards, normalizeHex } from "./util.js";

export const PALETTE = [
  "#61bd4f", "#f2d600", "#ff9f1a", "#eb5a46", "#c377e0",
  "#0079bf", "#00c2e0", "#51e898", "#ff78cb", "#344563",
];

// Mount a dialog shell. Returns { root, close } where root is the shadow root.
export function openDialog(title, bodyHtml, { width = 460 } = {}) {
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
  const onKey = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); close(); }
  };
  window.addEventListener("keydown", onKey, true);
  root.querySelector(".hk-modal-back").addEventListener("mousedown", (e) => {
    if (e.target.classList.contains("hk-modal-back")) close();
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
