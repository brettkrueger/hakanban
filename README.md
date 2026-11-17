# Hakanban

**A Trello-style Kanban board that lives *inside* Home Assistant.**

[![HACS Custom](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://hacs.xyz)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Hakanban is a fast, drag-and-drop Kanban board — but instead of wrapping an external
service like Todoist or Kanboard, it stores and manages everything **natively in Home
Assistant** and reuses HA's own concepts:

- a **board** is a hub **device**,
- a **column** is a native **`todo` list entity**,
- a **card** is a **`todo` item**, enriched with labels, due dates, comments and a markdown
  description.

Because boards are built from real HA primitives, the board is **scriptable**,
**voice-addressable via Assist** ("add milk to the Groceries list"), and **reacts to and from
automations** — the one thing Trello can't do. Move a card to *Done* and fire a notification;
ring the doorbell and drop a card into *Follow up*. It's a board and an automation surface at
the same time.

![A Hakanban board running inside the Home Assistant panel](docs/example-board.jpg)

---

## Features

v1 ships the **Core + multi-line paste** scope:

- **Boards** — multiple boards, each with its own background/theme and label palette.
  Rename a board with the toolbar's ✎ button; titles are kept unique automatically.
- **Lists / columns** — create, rename, reorder, archive.
- **Cards** — create, edit, archive, with **markdown descriptions**.
- **Drag and drop** — move cards within a column and between columns, and reorder columns by
  dragging their headers (native HTML5 drag-and-drop — no build step, no external library).
- **Labels** — colour + name per board. Rename, recolour, add or delete them from the toolbar's
  🏷 button or **✎ Edit labels** on a card; deleting a label removes it from every card.
  Colours come from the preset palette, the browser's colour picker, or a typed hex value.
  In the card view, a card's own labels sit on their own row in the order the board shows
  them: drag one (or focus it and press `←`/`→`) to reorder, ✕ or `Delete` to remove it, and
  click a spare label underneath to add it at the end.
- **Card references** — type `#12` in a card title, description, comment or checklist item
  and it becomes a link to card #12 on the same board (hover for its title; struck through
  once it's done). Numbers that don't match a card, code spans and URL fragments are left alone.
- **Card links** — every card has its own URL, `/hakanban/card/<id>`. Opening a card puts
  its link in the address bar (Back closes it again), so you can bookmark it or send it to
  someone. In the card view, click the 🔗 `#number` at the top to copy the full link. On the
  board, a card's `#number` is a link too: Ctrl/⌘- or middle-click it to open the card in a
  new tab, or right-click → *Copy link address*. Following a link to a card on another board
  switches to that board; a link to a deleted card just shows the board. Boards have links
  too (`/hakanban/board/<id>`), and the address bar follows the board tab you pick.
- **Dependencies** — mark a card as **blocked by** other cards on the same board from the
  card view's *Dependencies* section (or the new card dialog). Blocked cards get a red edge
  and a ⛔ badge listing what they're waiting on; cards holding others up get a ⛓ badge with
  the count, so you can see what to do first. A blocker stops counting once it's completed or
  archived. The ⚑ filter can show only **ready** cards (open, nothing blocking them),
  **blocked** cards, or cards **blocking** others. Cycles are refused.
- **Filters** — the ⚑ bar filters by labels (match *any* or *all*), due date (overdue, due
  within 24h, has / no due date), status (open / done), type (tasks / epics), epic and
  dependencies (ready / blocked / blocking).
  Combine with search; the ⚑ button shows how many filters are active.
- **Epics** — switch any card's type to **Epic** to group cards under it. Epics show a
  progress bar (completed children / total) on the board; child cards show their epic's name.
  From an epic, add new cards to it, pull in existing cards, or open a child. Filter the board
  down to one epic.
- **New card dialog** — **+ Add a card** opens a Jira/Trello-style form so the whole ticket
  is filled in before it's created: type, list, epic, title, labels, due date, markdown
  description and an optional checklist (one item per line). **Create another** keeps the
  dialog open for quick entry of related cards; **Create & open** jumps into the full card.
  `Enter` in the title or `Ctrl`/`⌘`+`Enter` anywhere creates it. The **⚡** button next to it
  keeps the old title-only quick add (including multi-line paste).
- **Swimlanes** — the toolbar's **☰ Lanes** menu splits the board into horizontal rows by
  **type**, **epic**, **label** or **status**. Each lane has a cell per list; collapse a lane
  by clicking its header. Dragging a card into another lane changes that field (e.g. drop it in
  the *Bug* lane to swap its label to *Bug*, or into an epic's lane to add it to the epic), and
  the **+** in a lane cell opens the new card dialog pre-filled for that lane. A card with
  several labels shows in each of its label lanes. The choice is remembered per board in your
  browser.
- **Board backgrounds** — preset colours and gradients from the 🎨 bar, or any custom
  colour via the colour picker / hex field.
- **Done lists** — a list marked *done* (⚙ list settings; a list called "Done" is one by
  default) completes the cards in it. Moving a card in records the completion time, shown as
  a green ✓ badge on the card and as "✓ Completed …" in the card view; moving it out reopens
  it. Ticking a card off in Home Assistant (its to-do list, a service, Assist) moves it into the
  done list, and unticking moves it back to the first open list. Done lists show a ✓ next to
  their title.
- **Automatic archival** — in a list's ⚙ settings, archive cards after *N* days in that
  list (e.g. clear out *Done* after 7 days). Checked hourly; the clock starts when a card
  enters the list. The toolbar's 🗄 button lists archived cards so you can open, restore or
  delete them.
- **Due dates** — the badge turns green once the card is completed. Cards with a due date also surface on the
  board's native HA **`calendar` entity**, so dated tasks appear in Home Assistant's Calendar
  panel and dashboard card.
- **Checklists** — edit them right in the card view: **+ Add checklist**, click a
  checklist's name to rename it, **Delete** it, tick items, click an item's text to edit it
  (`Enter` saves, `Esc` cancels, clearing the text removes it), ✕ to delete, and drag items
  (or focus one and press `Alt`+`↑`/`↓`) to reorder them or move them into another checklist
  on the same card. Pasting several lines into *Add an item…* adds one item per line. The
  card's ☑ badge counts across all of its checklists.
- **Comments / activity** on a card.
- **Multi-line paste → many cards** — paste newline-separated text into the ⚡ quick add and get
  one card per non-empty line, created in order in a single batched call.
- **Search** across cards.
- **Undo / redo** — store-wide history with toolbar buttons and `Ctrl`/`⌘`+`Z` /
  `Ctrl`/`⌘`+`Shift`+`Z` shortcuts; reverts any change, including ones made via services or Assist.
- **Full-page sidebar panel** (the drag-drop app, auto-registered — no manual Lovelace
  resource) **+** an **embeddable Lovelace card** for dashboards.

---

## Installation

### Via HACS (recommended)

Hakanban is distributed as a **custom repository**:

1. Open **HACS** in Home Assistant.
2. Click the **three-dot menu** (top right) → **Custom repositories**.
3. Add the repository URL `https://github.com/neilellis/hakanban`, choose category
   **Integration**, and click **Add**.
4. Find **Hakanban** in the list and click **Install**.
5. **Restart** Home Assistant.
6. Go to **Settings → Devices & Services → Add Integration**, search for **Hakanban**, and add
   it.

The **Hakanban** item now appears in your sidebar.

### Manual install

1. Copy the `custom_components/hakanban` folder into your Home Assistant `/config/custom_components`
   directory.
2. **Restart** Home Assistant.
3. Go to **Settings → Devices & Services → Add Integration** and add **Hakanban**.

---

## Using it

Open the **Hakanban** panel from the sidebar:

- **Create a board**, then add **columns** (lists) to it.
- **Add cards** with **+ Add a card**, which opens the new card dialog. Open a card later to
  edit its **markdown description**, **labels**, **due date**, checklists and **comments**.
- **Drag** cards within a column, between columns, and **reorder** columns by dragging their
  headers.
- **Bulk-create:** paste a multi-line block (e.g. a shopping list) into the ⚡ quick add —
  each non-empty line becomes its own card, in order.
- **Filter by label** and **search** to find cards quickly.
- **Swimlanes:** pick a grouping from **☰ Lanes** in the toolbar.

### Embeddable Lovelace card

Drop a board onto any dashboard with the bundled card. The card is **auto-registered by the
integration** — you do **not** need to add a Lovelace resource manually.

```yaml
type: custom:hakanban-card
board: <board_id>      # the id of the board to embed
swimlanes: label       # optional: type | epic | label | status
```

---

## Home Assistant integration

This is where Hakanban earns its keep. Every column is a real HA entity, so everything that
works on a `todo` list works on your Kanban board:

- **Native To-do card** — point Home Assistant's built-in To-do List card at a column's
  `todo.*` entity.
- **Assist / voice** — "add milk to the Groceries list" adds a card to that column.
- **`todo.*` services** — `todo.add_item`, `todo.update_item`, `todo.remove_item` etc. operate
  on the same data the panel shows (no sync layer — the JSON store is the single source of
  truth).

### Entities & devices

- **One device per board** (`identifiers={("hakanban", board_id)}`, named after the board).
- **One `todo` list entity per column**, attached to its board device
  (`unique_id = "{board_id}_{column_id}"`).
- **One `calendar` entity per board** (`unique_id = "{board_id}_calendar"`), attached to its
  board device, surfacing every card with a due date as an event — point the built-in Calendar
  card at it or open the **Calendar** panel to see your dated cards.

List the column entities with `./scripts/ha states todo` and inspect one with
`./scripts/ha get todo.<board>_<column>`.

### Services (`hakanban.*`)

| Service | Fields | Description |
|---------|--------|-------------|
| `hakanban.add_card` | `board_id`, `column_id`, `title`, `description?`, `labels?`, `due?`, `card_type?`, `epic_id?`, `blocked_by?` | Create a card in a column. |
| `hakanban.move_card` | `card_id`, `to_column`, `position?` | Move a card to another column (optionally at a position). |
| `hakanban.update_card` | `card_id`, … | Update card fields (title, description, labels, due, status, archived, card_type, epic_id, blocked_by). |
| `hakanban.add_comment` | `card_id`, `text` | Add a comment to a card. |
| `hakanban.create_board` | `title` | Create a board. |
| `hakanban.create_column` | `board_id`, `title` | Create a column on a board. |

The native `todo.*` services are also available on every column entity (great for Assist and
voice).

### Bus events (for automations)

Every mutation fires a Home Assistant event you can trigger automations on:

| Event | Data |
|-------|------|
| `hakanban_card_created` | `board_id`, `column_id`, `card_id`, `title` |
| `hakanban_card_updated` | `board_id`, `card_id`, `column_id?`, `action?` (e.g. `auto_archived`) |
| `hakanban_card_moved` | `board_id`, `card_id`, `from_column`, `to_column` |
| `hakanban_card_completed` | `board_id`, `card_id`, `column_id` |
| `hakanban_card_unblocked` | `board_id`, `card_id`, `column_id` |
| `hakanban_card_deleted` | `board_id`, `card_id` |
| `hakanban_board_changed` | `board_id`, `action` |

`hakanban_card_unblocked` fires for an open card when its last open blocker is completed,
archived, deleted or removed from its `blocked_by` — handy for "this is ready to start"
notifications.

---

## Example automations

**Notify when a card is completed.** `hakanban_card_completed` fires when a card enters a
done list (or is ticked off anywhere else). To react to one specific list instead, trigger
on the move event and match the target column id:

```yaml
automation:
  - alias: "Hakanban: notify on card done"
    triggers:
      - trigger: event
        event_type: hakanban_card_moved
        event_data:
          to_column: <done_column_id>
    actions:
      - action: notify.mobile_app_neil
        data:
          title: "Kanban"
          message: "A card was moved to Done."
```

**Create a card from another automation.** When the doorbell rings, drop a card into a
"Follow up" list:

```yaml
automation:
  - alias: "Doorbell → add a Follow up card"
    triggers:
      - trigger: state
        entity_id: binary_sensor.front_doorbell
        to: "on"
    actions:
      - action: hakanban.add_card
        data:
          board_id: <board_id>
          column_id: <follow_up_column_id>
          title: "Someone rang the doorbell"
          description: "Check the Ring snapshot and follow up if needed."
```

More recipes — nightly shopping-list population, chore-complete on motion, building a column
from a script — are in **[docs/automations.md](docs/automations.md)**.

---

## Architecture

A **single JSON store** (`.storage/hakanban.json`, schema `version: 1`) is the **source of
truth** for the entire board model — boards, columns, cards, labels, comments. A central
`HakanbanData` manager owns every mutation: it persists the change, fires the relevant HA
event, pushes a live update to connected panels over the websocket, and writes state on the
affected `todo` entities.

The **`todo` entities** and the **websocket API** are thin **views** over that store — they
read and write the same data, so the native HA todo card, Assist, the `todo.*` services, the
`hakanban.*` services and the panel all stay in sync with **no sync layer**.

The full data model, websocket command schemas, event payloads and service signatures are
documented in **[docs/PROTOCOL.md](docs/PROTOCOL.md)**.

---

## Roadmap

- [x] Checklists — add, rename, delete, edit, tick and reorder from the card view
- [ ] Attachments
- [ ] Card / board templates
- [x] Swimlanes — group the board by type, epic, label or status
- [x] Calendar — boards expose dated cards as a native HA `calendar` entity
- [ ] In-panel timeline / calendar view
- [ ] Custom fields
- [ ] Butler-style automation rules (in-board "when X, do Y")

---

## Contributing

Issues and pull requests are welcome at
[`neilellis/hakanban`](https://github.com/neilellis/hakanban). Please open an issue to discuss
larger changes first, and keep frontend/backend changes consistent with
[docs/PROTOCOL.md](docs/PROTOCOL.md), which is the shared contract between the integration, the
websocket API and the frontend.

## License

[MIT](LICENSE) © Neil Ellis
