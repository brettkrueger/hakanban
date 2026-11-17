// Shared CSS. Uses Home Assistant theme variables so it adapts to the active theme.

export const STYLES = `
:host {
  --hk-gap: 12px;
  --hk-radius: 10px;
  --hk-col-bg: var(--card-background-color, #fff);
  --hk-card-bg: var(--ha-card-background, var(--card-background-color, #fff));
  --hk-text: var(--primary-text-color, #172b4d);
  --hk-subtle: var(--secondary-text-color, #5e6c84);
  --hk-accent: var(--primary-color, #0079bf);
  --hk-divider: var(--divider-color, rgba(0,0,0,.12));
  display: block;
  color: var(--hk-text);
  font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif);
}

.hk-root { display: flex; flex-direction: column; height: 100%; min-height: 0; }

/* The full-page panel fills the viewport. HA mounts the custom panel element
   with no intrinsic height, so without this the whole app collapses to content
   height. The panel renders its own toolbar (no HA header above it), so the
   panel area is the full viewport height. */
:host(hakanban-panel) { display: block; height: 100vh; }

/* The board view fills all available height so its background covers the whole
   area, not just the columns. In the Lovelace card (host has no fixed height)
   this resolves to content height — harmless. */
:host(hakanban-board) { display: flex; flex-direction: column; height: 100%; }

.hk-toolbar {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 16px; flex-wrap: wrap;
  border-bottom: 1px solid var(--hk-divider);
  background: var(--app-header-background-color, var(--hk-accent));
  color: var(--app-header-text-color, #fff);
}
.hk-toolbar .hk-title { font-size: 1.15rem; font-weight: 600; margin-right: 8px; }
.hk-board-tabs { display: flex; gap: 4px; flex-wrap: wrap; flex: 1; min-width: 0; }
.hk-tab {
  padding: 5px 12px; border-radius: 6px; cursor: pointer;
  background: rgba(255,255,255,.16); color: inherit; border: 0;
  font-size: .9rem; white-space: nowrap;
}
.hk-tab.active { background: rgba(255,255,255,.38); font-weight: 600; }
.hk-toolbar select.hk-lanes-sel {
  padding: 5px 6px; border-radius: 6px; border: 0; max-width: 150px;
  background: rgba(255,255,255,.9); color: #172b4d; font: inherit; font-size: .85rem; cursor: pointer;
}
.hk-toolbar input.hk-search {
  padding: 6px 10px; border-radius: 6px; border: 0; min-width: 160px;
  background: rgba(255,255,255,.9); color: #172b4d;
}
.hk-iconbtn {
  background: rgba(255,255,255,.16); color: inherit; border: 0; cursor: pointer;
  width: 32px; height: 32px; border-radius: 6px; font-size: 1.1rem; line-height: 1;
}
.hk-iconbtn:hover { background: rgba(255,255,255,.34); }
.hk-iconbtn:disabled { opacity: .4; cursor: default; }
.hk-iconbtn:disabled:hover { background: rgba(255,255,255,.16); }

.hk-board {
  flex: 1; min-height: 0; display: flex; gap: var(--hk-gap);
  padding: 16px; overflow-x: auto; align-items: flex-start;
  background-size: cover; background-position: center;
}

.hk-col {
  flex: 0 0 290px; max-height: 100%;
  display: flex; flex-direction: column;
  background: var(--hk-col-bg); border-radius: var(--hk-radius);
  box-shadow: 0 1px 2px rgba(9,30,66,.18);
}
.hk-col.dragover { outline: 2px dashed var(--hk-accent); outline-offset: -2px; }
.hk-col-head {
  display: flex; align-items: center; gap: 6px; padding: 10px 12px 6px;
  cursor: grab;
}
.hk-col-title { font-weight: 600; flex: 1; font-size: .95rem; }
.hk-col-title[contenteditable="true"] { outline: 1px solid var(--hk-accent); border-radius: 4px; padding: 1px 4px; }
.hk-col-count { color: var(--hk-subtle); font-size: .8rem; }
.hk-col-menu { background: none; border: 0; cursor: pointer; color: var(--hk-subtle); font-size: 1.1rem; }

.hk-cards { padding: 4px 8px; overflow-y: auto; flex: 1; min-height: 8px; }

.hk-card {
  background: var(--hk-card-bg); border-radius: 8px; padding: 8px 10px; margin-bottom: 8px;
  box-shadow: 0 1px 1px rgba(9,30,66,.2); cursor: pointer; border: 1px solid var(--hk-divider);
}
.hk-card.dragging { opacity: .4; }
.hk-card.completed .hk-card-title { text-decoration: line-through; color: var(--hk-subtle); }
.hk-card-labels { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 8px; }
.hk-label {
  border-radius: 999px; font-size: .67rem; font-weight: 600; letter-spacing: .01em;
  display: inline-flex; align-items: center; padding: 2px 9px; line-height: 1.35;
  white-space: nowrap; overflow: hidden;
}
.hk-card-title { font-size: .9rem; line-height: 1.3; white-space: pre-wrap; word-break: break-word; }
.hk-card-badges { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; color: var(--hk-subtle); font-size: .72rem; align-items: center; }
.hk-badge { display: inline-flex; align-items: center; gap: 3px; padding: 1px 5px; border-radius: 4px; }
.hk-badge.due-overdue { background: #eb5a46; color: #fff; }
.hk-badge.due-soon { background: #f2d600; color: #172b4d; }
.hk-badge.due-done { background: #61bd4f; color: #fff; }
.hk-card-number { color: var(--hk-subtle); font-size: .7rem; }

.hk-composer { padding: 6px 8px 10px; }
.hk-composer textarea {
  width: 100%; box-sizing: border-box; resize: vertical; min-height: 38px;
  border-radius: 6px; border: 1px solid var(--hk-divider); padding: 8px;
  font: inherit; background: var(--hk-card-bg); color: var(--hk-text);
}
.hk-composer-actions { display: flex; gap: 6px; margin-top: 6px; }
.hk-btn {
  background: var(--hk-accent); color: #fff; border: 0; border-radius: 6px;
  padding: 6px 12px; cursor: pointer; font: inherit;
}
.hk-btn.secondary { background: transparent; color: var(--hk-subtle); }
.hk-btn:hover { filter: brightness(1.05); }
.hk-addcard { color: var(--hk-subtle); text-align: left; width: 100%; padding: 8px; }

.hk-add-col {
  flex: 0 0 290px; background: rgba(255,255,255,.24); border-radius: var(--hk-radius);
  padding: 8px;
}
.hk-add-col button { width: 100%; text-align: left; background: none; border: 0; cursor: pointer; color: inherit; padding: 6px; }

.hk-empty { padding: 40px; text-align: center; color: var(--hk-subtle); }

/* ---- modal ---- */
.hk-modal-back {
  position: fixed; inset: 0; background: rgba(0,0,0,.55); z-index: 9; display: flex;
  align-items: flex-start; justify-content: center; padding: 5vh 16px; overflow-y: auto;
}
.hk-modal {
  background: var(--hk-card-bg); color: var(--hk-text); width: min(720px, 100%);
  border-radius: 12px; box-shadow: 0 8px 40px rgba(0,0,0,.4); padding: 20px 24px;
}
.hk-modal h2 { margin: 0 0 4px; font-size: 1.25rem; display: flex; gap: 8px; align-items: flex-start; }
.hk-modal h2 textarea { font: inherit; font-size: 1.2rem; font-weight: 600; border: 0; background: none; resize: none; width: 100%; color: inherit; }
.hk-modal .hk-meta { color: var(--hk-subtle); font-size: .8rem; margin-bottom: 16px; }
.hk-section { margin: 16px 0; }
.hk-section h3 { font-size: .85rem; text-transform: uppercase; letter-spacing: .04em; color: var(--hk-subtle); margin: 0 0 6px; }
.hk-desc-edit { width: 100%; box-sizing: border-box; min-height: 90px; border-radius: 6px; border: 1px solid var(--hk-divider); padding: 8px; font: inherit; background: var(--hk-col-bg); color: var(--hk-text); }
.hk-desc-render { background: var(--hk-col-bg); border-radius: 6px; padding: 8px 10px; min-height: 24px; }
.hk-desc-render code { background: var(--hk-divider); padding: 1px 4px; border-radius: 4px; }
.hk-label-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.hk-label-chip { height: 28px; border-radius: 6px; padding: 0 12px; display: inline-flex; align-items: center; cursor: pointer; font-size: .8rem; border: 2px solid transparent; }
.hk-label-chip.selected { border-color: var(--hk-text); }
.hk-comment { border-top: 1px solid var(--hk-divider); padding: 8px 0; font-size: .85rem; }
.hk-comment .who { font-weight: 600; }
.hk-comment .when { color: var(--hk-subtle); font-size: .72rem; margin-left: 6px; }
.hk-modal-actions { display: flex; gap: 8px; margin-top: 18px; flex-wrap: wrap; }
.hk-modal-actions .grow { flex: 1; }
.hk-danger { background: #eb5a46; }
.hk-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.hk-row input[type="datetime-local"], .hk-row input[type="text"] { padding: 6px; border-radius: 6px; border: 1px solid var(--hk-divider); background: var(--hk-col-bg); color: var(--hk-text); font: inherit; }
.hk-check-item { display: flex; gap: 6px; align-items: center; padding: 2px 4px; border-radius: 6px; }
.hk-check-item:hover { background: var(--hk-col-bg); }
.hk-check-item.done .hk-check-text { text-decoration: line-through; color: var(--hk-subtle); }
.hk-check-item.dragging { opacity: .4; }
.hk-check-text { flex: 1; cursor: text; padding: 3px 2px; border-radius: 4px; word-break: break-word; }
.hk-check-text:focus-visible { outline: 2px solid var(--primary-color, #0079bf); }
.hk-drag-handle { cursor: grab; color: var(--hk-subtle); font-size: .75rem; letter-spacing: -2px; opacity: 0; user-select: none; }
.hk-check-item:hover .hk-drag-handle, .hk-check-item:focus-within .hk-drag-handle { opacity: 1; }
.hk-icon-btn { border: 0; background: transparent; color: var(--hk-subtle); cursor: pointer; border-radius: 4px; padding: 2px 6px; opacity: 0; }
.hk-check-item:hover .hk-icon-btn, .hk-icon-btn:focus-visible { opacity: 1; }
.hk-icon-btn:hover { background: var(--hk-divider); color: var(--hk-text); }
.hk-check-edit { flex: 1; }
.hk-check-items { min-height: 6px; margin-bottom: 4px; }
.hk-cl-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.hk-cl-head .hk-cl-title { flex: 1; font-weight: 600; font-size: .9rem; color: var(--hk-text); background: transparent; border: 1px solid transparent; border-radius: 6px; padding: 4px 6px; }
.hk-cl-head .hk-cl-title:hover { border-color: var(--hk-divider); }
.hk-cl-head .hk-cl-title:focus { border-color: var(--primary-color, #0079bf); background: var(--hk-card-bg); outline: none; }
.hk-cl-progress { margin-bottom: 6px; }
.hk-checklist .hk-add-check { flex: 1; }
.hk-muted { color: var(--hk-subtle); font-size: .8rem; }

/* ---- completion ---- */
.hk-badge.hk-done-badge { background: #61bd4f; color: #fff; }
.hk-col-done { color: #61bd4f; font-weight: 700; font-size: .9rem; }
.hk-completed-at { color: #3f9a2e; font-weight: 600; }
/* card references (#12) */
.hk-ref { color: var(--primary-color, #0079bf); font-weight: 600; cursor: pointer; border-radius: 3px; }
.hk-ref:hover, .hk-ref:focus-visible { text-decoration: underline; outline: none; }
.hk-ref.done { text-decoration: line-through; color: var(--hk-subtle); }
.hk-ref.archived { color: var(--hk-subtle); font-style: italic; }
/* dependencies */
.hk-card.blocked { box-shadow: inset 3px 0 0 #eb5a46, 0 1px 1px rgba(9,30,66,.2); }
.hk-badge.hk-blocked-badge { background: #eb5a46; color: #fff; }
.hk-badge.hk-blocking-badge { background: #ff9f1a; color: #172b4d; }
.hk-blocked-at { color: #c9372c; font-weight: 600; }
.hk-dep-head { font-size: .8rem; font-weight: 600; color: var(--hk-subtle); margin: 8px 0 4px; }
.hk-dep-head:first-of-type { margin-top: 0; }
.hk-dep-state { font-weight: 600; color: #c9372c; margin-left: 4px; }
.hk-dep-state.ok { color: #3f9a2e; }
.hk-dep-select { margin-top: 4px; max-width: 100%; }
.hk-dep-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 4px 2px 8px; border-radius: 6px; background: var(--hk-col-bg); font-size: .8rem; }
.hk-wrap { flex-wrap: wrap; }
/* reorderable card labels */
.hk-label-chip.hk-sortable { cursor: grab; gap: 6px; padding-right: 4px; }
.hk-label-chip.hk-sortable:focus-visible { outline: 2px solid var(--primary-color, #0079bf); outline-offset: 1px; }
.hk-label-chip.dragging { opacity: .4; }
.hk-chip-x { border: 0; background: rgba(0, 0, 0, .15); color: inherit; border-radius: 4px; width: 18px; height: 18px; padding: 0; font-size: .7rem; line-height: 18px; cursor: pointer; }
.hk-chip-x:hover { background: rgba(0, 0, 0, .3); }
.hk-label-add { margin-top: 6px; }
.hk-hint { font-weight: 400; font-size: .75rem; text-transform: none; letter-spacing: 0; margin-left: 4px; }

/* ---- new card dialog ---- */
.hk-nc-grid { display: flex; gap: 0 24px; flex-wrap: wrap; }
.hk-nc-grid .hk-section { margin: 8px 0; }
.hk-nc-input {
  width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: 6px; font: inherit; font-size: 1.05rem;
  border: 1px solid var(--hk-divider); background: var(--hk-col-bg); color: var(--hk-text);
}
.hk-nc-input.invalid { border-color: #eb5a46; outline: 1px solid #eb5a46; }
.hk-nc-checks { min-height: 60px; }
.hk-req { color: #eb5a46; }
.hk-nc-error { color: #eb5a46; font-size: .85rem; margin-top: 8px; }
.hk-addrow { display: flex; gap: 4px; }
.hk-addrow .hk-addcard { flex: 1; }

/* ---- swimlanes ---- */
.hk-board.lanes { display: block; overflow: auto; }
.hk-lanes { display: flex; flex-direction: column; gap: 10px; width: max-content; min-width: 100%; }
.hk-lane-headrow { display: flex; gap: var(--hk-gap); align-items: flex-start; position: sticky; top: -16px; z-index: 2; padding-top: 0; }
.hk-col-headonly { max-height: none; }
.hk-lane { display: flex; flex-direction: column; gap: 6px; }
.hk-lane-head {
  position: sticky; left: 0; align-self: flex-start; display: inline-flex; align-items: center; gap: 8px;
  background: var(--hk-col-bg); color: var(--hk-text); border: 0; border-radius: 8px; padding: 6px 12px;
  font: inherit; font-weight: 600; font-size: .9rem; cursor: pointer; box-shadow: 0 1px 2px rgba(9,30,66,.18);
}
.hk-lane-caret { color: var(--hk-subtle); width: 1em; }
.hk-lane-dot { width: 12px; height: 12px; border-radius: 50%; flex: 0 0 auto; }
.hk-lane-title { max-width: 40ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hk-lane-row { display: flex; gap: var(--hk-gap); align-items: stretch; }
.hk-lane-cell {
  flex: 0 0 290px; display: flex; flex-direction: column; min-height: 48px;
  background: var(--hk-col-bg); border-radius: var(--hk-radius); opacity: .97;
}
.hk-lane-cell.dragover { outline: 2px dashed var(--hk-accent); outline-offset: -2px; }
.hk-lane-cell .hk-cards { padding-top: 8px; overflow: visible; }
.hk-lane-add { align-self: stretch; text-align: left; padding: 2px 10px 6px; opacity: 0; transition: opacity .1s; }
.hk-lane-cell:hover .hk-lane-add, .hk-lane-add:focus { opacity: 1; }
@media (hover: none) { .hk-lane-add { opacity: 1; } }
.hk-board.lanes .hk-add-col { flex: 0 0 290px; }
.hk-quickadd { padding: 6px 8px; }

/* ---- toolbar badge (active filter count) ---- */
.hk-iconbtn { position: relative; }
.hk-iconbtn.on { background: rgba(255,255,255,.4); }
.hk-iconbtn .hk-count {
  position: absolute; top: -4px; right: -4px; min-width: 16px; height: 16px; padding: 0 3px;
  border-radius: 8px; background: #eb5a46; color: #fff; font-size: .65rem; line-height: 16px;
  box-sizing: border-box;
}

/* ---- filter bar ---- */
.hk-filterbar {
  display: flex; flex-wrap: wrap; gap: 10px 18px; align-items: center;
  padding: 8px 16px; border-bottom: 1px solid var(--hk-divider);
}
.hk-filterbar .hk-fgroup { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.hk-filterbar .hk-fgroup > strong { font-size: .8rem; color: var(--hk-subtle); }
.hk-filterbar select, .hk-row select, .hk-row input[type="number"] {
  padding: 5px 6px; border-radius: 6px; border: 1px solid var(--hk-divider);
  background: var(--hk-col-bg); color: var(--hk-text); font: inherit;
}
.hk-filterbar .hk-label-chip { height: 24px; padding: 0 10px; }
.hk-seg { display: inline-flex; border: 1px solid var(--hk-divider); border-radius: 6px; overflow: hidden; }
.hk-seg button {
  background: none; border: 0; padding: 3px 9px; cursor: pointer; color: var(--hk-subtle); font: inherit; font-size: .8rem;
}
.hk-seg button.on { background: var(--hk-accent); color: #fff; }

/* ---- epics ---- */
.hk-card.epic { border-left: 4px solid #7b5cd6; }
.hk-epic-tag {
  display: inline-block; font-size: .62rem; font-weight: 700; letter-spacing: .06em;
  color: #fff; background: #7b5cd6; border-radius: 4px; padding: 1px 6px; margin-bottom: 6px;
}
.hk-epic-ref {
  display: inline-flex; align-items: center; gap: 3px; max-width: 100%;
  font-size: .7rem; color: #7b5cd6; font-weight: 600; margin-bottom: 4px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.hk-progress { height: 5px; border-radius: 3px; background: var(--hk-divider); overflow: hidden; margin-top: 6px; }
.hk-progress > span { display: block; height: 100%; background: #61bd4f; }
.hk-epic-child {
  display: flex; gap: 8px; align-items: center; padding: 5px 6px; border-radius: 6px; cursor: pointer;
  font-size: .85rem;
}
.hk-epic-child:hover { background: var(--hk-col-bg); }
.hk-epic-child .num { color: var(--hk-subtle); font-size: .75rem; }
.hk-epic-child .col { margin-left: auto; color: var(--hk-subtle); font-size: .75rem; }
.hk-epic-child.done .ttl { text-decoration: line-through; color: var(--hk-subtle); }

/* ---- column auto-archive indicator ---- */
.hk-col-auto { font-size: .7rem; color: var(--hk-subtle); white-space: nowrap; }

/* ---- label manager ---- */
.hk-swatch {
  display: inline-block; width: 26px; height: 26px; border-radius: 6px; cursor: pointer;
  border: 2px solid transparent; box-sizing: border-box; padding: 0;
}
.hk-swatch.selected { border-color: var(--hk-text); }
.hk-swatch.big { width: 34px; height: 30px; font-size: .8rem; }
.hk-lm-row { display: flex; gap: 8px; align-items: center; padding: 4px 0; }
.hk-lm-row .hk-lm-name {
  flex: 1; padding: 6px; border-radius: 6px; border: 1px solid var(--hk-divider);
  background: var(--hk-col-bg); color: var(--hk-text); font: inherit;
}
.hk-lm-count { color: var(--hk-subtle); font-size: .75rem; min-width: 2ch; text-align: right; }
.hk-lm-palette { padding: 2px 0 8px 42px; }

/* ---- custom colour picker ---- */
.hk-color-custom { display: inline-flex; gap: 6px; align-items: center; }
.hk-color-custom input[type="color"] {
  width: 34px; height: 30px; padding: 0; border: 1px solid var(--hk-divider); border-radius: 6px;
  background: none; cursor: pointer;
}
.hk-color-custom input[type="color"]::-webkit-color-swatch-wrapper { padding: 2px; }
.hk-color-custom input[type="color"]::-webkit-color-swatch { border: 0; border-radius: 4px; }
.hk-color-custom .hk-hex {
  width: 6.5em; padding: 5px 6px; border-radius: 6px; border: 1px solid var(--hk-divider);
  background: var(--hk-col-bg); color: var(--hk-text); font: inherit; font-family: monospace;
}
.hk-color-custom .hk-hex.invalid { border-color: #eb5a46; outline: 1px solid #eb5a46; }
.hk-btn:disabled { opacity: .5; cursor: default; }

/* ---- archive drawer ---- */
.hk-archive-list { max-height: 60vh; overflow-y: auto; }
.hk-archive-item {
  display: flex; gap: 8px; align-items: center; padding: 8px 4px;
  border-bottom: 1px solid var(--hk-divider); font-size: .88rem;
}
.hk-archive-item .ttl { flex: 1; cursor: pointer; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.hk-archive-item .meta { color: var(--hk-subtle); font-size: .72rem; white-space: nowrap; }
.hk-archived-banner {
  background: #f2d600; color: #172b4d; border-radius: 6px; padding: 6px 10px; font-size: .85rem; margin-bottom: 10px;
}
`;
