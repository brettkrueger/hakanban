# Hakanban protocol & data contract

This is the shared interface between the Python integration, the websocket API, and the
frontend (panel + Lovelace card). Everything below is the source of truth.

## Store document (`.storage/hakanban.json`, `version: 1`)

```jsonc
{
  "boards": {
    "<board_id>": {
      "id": "<board_id>",
      "title": "My Board",
      "background": null,              // CSS colour / gradient name, or null
      "archived": false,
      "label_defs": [                  // per-board label palette
        { "id": "<label_id>", "name": "Bug", "color": "#eb5a46" }
      ],
      "columns": [
        { "id": "<column_id>", "title": "To Do", "order": 0, "archived": false,
          "auto_archive_days": null,    // int N: archive cards after N days in this list
          "done": false }               // true: cards in this list are completed
      ],
      "card_seq": 12,                  // monotonic per-board card number counter
      "created": "<iso8601>"
    }
  },
  "cards": {
    "<card_id>": {
      "id": "<card_id>",
      "board_id": "<board_id>",
      "column_id": "<column_id>",
      "order": 2000,                   // sparse integer order within the column
      "number": 7,                     // human card number (#7), unique per board
      "card_type": "task",             // "task" | "epic"
      "epic_id": null,                 // id of an epic card on the same board, or null
      "title": "Buy milk",
      "description": "",               // markdown
      "labels": ["<label_id>", ...],   // ordered: the board shows them in this order
      "blocked_by": ["<card_id>", ...], // cards on the same board that must be finished first
      "assignees": ["person.neil", ...], // HA person entity ids (see Assignees)
      "due": null,                     // iso8601 or null
      "due_complete": false,           // deprecated: mirrors status == completed
      "status": "needs_action",        // "needs_action" | "completed"
      "completed": "<iso8601>",        // when it was completed; present only when status == completed
      "checklists": [
        { "id": "<id>", "title": "Steps", "items": [ { "id": "<id>", "text": "x", "done": false } ] }
      ],
      "comments": [ { "id": "<id>", "author": "Neil", "ts": "<iso8601>", "text": "..." } ],
      "cover": null,
      "archived": false,
      "created": "<iso8601>",
      "updated": "<iso8601>",
      "column_entered": "<iso8601>"    // when the card entered its column (or was restored)
    }
  }
}
```

Fields added after v0.1.8 (`card_type`, `epic_id`, `column_entered`, `auto_archive_days`,
`done`, `blocked_by`) are back-filled on load, so older stores need no migration. A list without a `done`
key gets `done: true` if its title is "Done" (case-insensitive); see *Done lists* for how
existing cards are brought into line.

`status` deliberately mirrors `todo.TodoItemStatus` so each card maps 1:1 onto a todo item.

## Frontend payload (what the WS API returns / pushes)

The frontend never sees the raw store. It gets boards with columns→cards **nested and sorted**:

```jsonc
{ "boards": [
  { "id", "title", "background", "archived",
    "labels": [ {id,name,color} ],
    "columns": [
      { "id", "title", "order", "archived",
        "cards": [ { ...full card... } ]   // sorted by order, archived excluded
      }
    ],
    "archived_cards": [ { ...full card... } ]  // this board's archived cards, newest first
  } ],
  "can_undo": true,   // is there a mutation to undo?  (store-wide history)
  "can_redo": false   // is there an undone mutation to redo?
}
```

Produced by `HakanbanData.full_payload()`; `board_payload(board_id)` produces a single board
object (without the `can_undo`/`can_redo` flags).

## WebSocket API

All commands are objects `{ "id": <n>, "type": "hakanban/<cmd>", ... }`.
Mutations return the affected object in `result`; **state propagation happens via the
subscription** (every connected client receives the new full payload), so a client can apply an
optimistic update and reconcile on the next push.

| type | params | result |
|------|--------|--------|
| `hakanban/get` | — | full payload `{boards:[…]}` |
| `hakanban/subscribe` | — | streams full payload `{boards:[…]}` immediately and on every change |
| `hakanban/undo` | — | `{can_undo, can_redo}` — reverts the last mutation (store-wide) |
| `hakanban/redo` | — | `{can_undo, can_redo}` — re-applies the last undone mutation |
| `hakanban/create_board` | `title`, `background?` | board |
| `hakanban/update_board` | `board_id`, `title?`, `background?`, `archived?` | board |
| `hakanban/delete_board` | `board_id` | `{deleted: board_id}` |
| `hakanban/create_column` | `board_id`, `title` | column |
| `hakanban/update_column` | `board_id`, `column_id`, `title?`, `archived?`, `auto_archive_days?` (int ≥ 0; 0/null = off), `done?` (bool) | column |
| `hakanban/delete_column` | `board_id`, `column_id` | `{deleted: column_id}` |
| `hakanban/move_column` | `board_id`, `column_id`, `position` (int) | `{ok: true}` |
| `hakanban/create_card` | `board_id`, `column_id`, `title`, `description?`, `labels?`, `due?`, `card_type?`, `epic_id?`, `blocked_by?`, `assignees?` | card |
| `hakanban/paste_cards` | `board_id`, `column_id`, `text` (newline-separated) **or** `titles[]` | `{cards:[…]}` |
| `hakanban/update_card` | `card_id`, any of `title/description/labels/assignees/due/status/cover/archived/card_type/epic_id/blocked_by` (`due`, `cover`, `epic_id`, `blocked_by`, `assignees` accept `null` to clear; legacy `due_complete` is an alias for `status`) | card |
| `hakanban/move_card` | `card_id`, `to_column`, `position?` (int), `to_board?` | card |
| `hakanban/delete_card` | `card_id` | `{deleted: card_id}` |
| `hakanban/create_label` | `board_id`, `name`, `color` | label |
| `hakanban/update_label` | `board_id`, `label_id`, `name?`, `color?` | label |
| `hakanban/delete_label` | `board_id`, `label_id` | `{deleted: label_id}` |
| `hakanban/add_comment` | `card_id`, `text` | comment |
| `hakanban/add_checklist` | `card_id`, `title` | checklist |
| `hakanban/add_check_item` | `card_id`, `checklist_id`, `text` | item |
| `hakanban/toggle_check_item` | `card_id`, `checklist_id`, `item_id`, `done` | `{ok:true}` |
| `hakanban/update_checklist` | `card_id`, `checklist_id`, `title` (blank → "Checklist") | checklist |
| `hakanban/delete_checklist` | `card_id`, `checklist_id` | `{deleted: checklist_id}` |
| `hakanban/update_check_item` | `card_id`, `checklist_id`, `item_id`, `text?` (non-blank), `done?` | item |
| `hakanban/delete_check_item` | `card_id`, `checklist_id`, `item_id` | `{deleted: item_id}` |
| `hakanban/move_check_item` | `card_id`, `checklist_id`, `item_id`, `position` (int ≥ 0, clamped), `to_checklist?` (another checklist on the same card) | item |

The subscription push message body is the full payload `{ "boards": [...] }`.

Board titles are kept unique: `create_board` and `update_board` append ` (n)` to the requested
title if another board already uses it (so each board — and its device — has a distinct name).

Undo/redo is **store-wide** and snapshot-based: every mutation (from the panel, Lovelace card,
`hakanban.*`/`todo.*` services or Assist) snapshots the whole document first, so any single
action can be reverted regardless of which client made it. A new mutation clears the redo stack;
history is capped at `UNDO_HISTORY_LIMIT` (50) states and reset to empty on load.

Colours are validated server-side because they're rendered into inline CSS. Label `color`
must be hex (`#rgb`, `#rrggbb`, with or without `#`) and is stored as lowercase `#rrggbb`.
A board `background` is `null`/empty (none), a hex colour (same rules), or a
`linear-gradient(...)` made only of letters, digits, `#`, `.`, `,`, `%`, `-` and spaces.
Anything else is rejected with `invalid_request`; invalid values already in an older store
are reset on load (labels to `#838c91`, backgrounds to `null`).

The card's type field is `card_type`, not `type`, because `type` is the websocket message's
own command key.

### Epics

A card with `card_type: "epic"` groups other cards on the **same board** through their
`epic_id`. Rules enforced by `HakanbanData` (violations raise `HakanbanError`):

* `epic_id` must point at an epic on the same board; a card can't be its own epic and epics
  don't nest (an epic's `epic_id` is always `null`).
* Demoting an epic to a task, deleting it, or moving it to another board unlinks its
  children. Moving a child to another board clears its `epic_id`.

Epic progress is derived in the frontend: children = cards whose `epic_id` is the epic,
excluding archived cards that were never completed; done = `status == "completed"`.

### Dependencies

`blocked_by` lists cards that must be finished before this one. Rules enforced by
`HakanbanData` (violations raise `HakanbanError` and change nothing):

* Every id must be a card on the **same board**; a card can't depend on itself, and a link
  that would close a cycle (directly or through other cards) is refused. Duplicates are
  dropped, order is kept.
* Deleting a card removes it from every `blocked_by`. Moving a card to another board clears
  its own `blocked_by` and removes it from other cards'.
* A card is **blocked** while any blocker is neither `completed` nor `archived`. This is
  derived (the frontend computes it from the payload); nothing stops a blocked card from
  being moved or completed.
* `hakanban_card_unblocked` fires for each open, live card that was blocked before a
  mutation and isn't after it (blocker completed, archived, deleted, removed from the list,
  or its list flagged done).

On load, `blocked_by` is back-filled to `[]` and ids that are missing, the card itself, or on
another board are dropped.

### Assignees

`assignees` holds HA **person** entity ids (`person.<name>`), in order, de-duplicated.
Anything else is refused with `HakanbanError` (nothing is changed). Existence isn't
checked, so a person removed from HA stays on their cards; the frontend shows their name
from the id, greyed out. Names and pictures are never stored: the frontend reads them from
`hass.states[person.*]`, and treats the person whose `user_id` matches `hass.user.id` as
"me".

`hakanban_card_assigned` fires once for each person **newly** added (on `create_card` or
`update_card`; reordering or re-sending the same people fires nothing), with the person's
`user_id` attribute (`null` for a person without an HA login).

On load, `assignees` is back-filled to `[]` and malformed entries are dropped.

### Card references

`#<number>` in a card's title, description, comments or checklist items is rendered by the
frontend as a link to the card with that number on the same board. It's display-only: nothing
is stored. Numbers without a matching card, `code` spans, links/URL fragments and HTML
entities are left as text.

### Panel URLs

The sidebar panel (`/hakanban`, `PANEL_URL_PATH`) routes on its sub-path, which HA passes to
`<hakanban-panel>` as `route.path`:

| URL | Opens |
| --- | --- |
| `/hakanban` | the board last used in this browser |
| `/hakanban/board/<board_id>` | that board |
| `/hakanban/card/<card_id>` | the card's board, with the card open (archived cards too) |

Links use the card **id**, not its `#number`, because a card keeps its id for life but gets a
new number if it moves to another board. Opening a card from the board pushes its URL (so
Back closes it); following a link inside an open card replaces it; closing the card goes
back. An unknown card id shows a toast and falls back to the board. Frontend only: nothing
is stored and no WS command is involved.

### Done lists

A list with `done: true` completes the cards in it. On a board with at least one done list a
card's `status` always matches its list:

* Moving a card into a done list sets `status: "completed"` and stamps `completed` with the
  time; moving it out sets `needs_action` and removes `completed`. Reordering within done lists
  changes nothing.
* Completing a card any other way (`update_card` with `status`, `hakanban.update_card`, the
  HA to-do list checkbox, Assist) moves it to the end of the first done list; reopening it
  moves it to the end of the first open list. Each such move also fires `hakanban_card_moved`.
* A card created in a done list starts completed; the requested `status` is ignored.
* Turning `done` on or off for a list re-syncs every live card on the board, in the same undo
  step.

On a board with no done list, `status` is set directly and cards never move.
`hakanban_card_completed` fires whenever a card becomes completed, by either route.
`due_complete` is kept only as a mirror of `status == "completed"`.

On load, in boards that have a done list, live cards already in it are completed with
`completed` = their `column_entered`, and completed cards in other lists are moved to the
end of the first done list (keeping their `completed` stamp).

### Automatic archival

A column with `auto_archive_days: N` archives every card that has been in it for at least N
days, measured from `column_entered` (set on create, on a move into a different column, and
on restore from the archive). The sweep runs on setup and then every
`AUTO_ARCHIVE_INTERVAL_MINUTES` (60). Setting the rule also applies it at once, in the same
undo step. A sweep that archives cards is one undo step; an empty sweep changes nothing
(no save, no undo entry). Each archived card fires `hakanban_card_updated` with
`action: "auto_archived"`.

## HA bus events (for automations)

| event | data |
|-------|------|
| `hakanban_card_created` | `board_id`, `column_id`, `card_id`, `title` |
| `hakanban_card_updated` | `board_id`, `card_id`, `column_id?`, `action?` (`comment_added`, `auto_archived`) |
| `hakanban_card_moved` | `board_id`, `card_id`, `from_column`, `to_column` |
| `hakanban_card_completed` | `board_id`, `card_id`, `column_id` |
| `hakanban_card_unblocked` | `board_id`, `card_id`, `column_id` |
| `hakanban_card_assigned` | `board_id`, `card_id`, `column_id`, `number`, `title`, `assignee`, `user_id` |
| `hakanban_card_deleted` | `board_id`, `card_id` |
| `hakanban_board_changed` | `board_id`, `action` |

## Services (`hakanban.*`)

`add_card` (board_id, column_id, title, description?, labels?, due?, card_type?, epic_id?,
blocked_by?, assignees?), `move_card` (card_id, to_column, position?), `update_card` (card_id, title?,
description?, labels?, due?, status?, archived?, card_type?, epic_id?, blocked_by?, assignees?), `add_comment` (card_id, text),
`create_board` (title), `create_column` (board_id, title). Plus the native `todo.*` services on
each column entity (Assist / voice).

## Entities

* One **device** per board (`identifiers={("hakanban", board_id)}`, name = board title).
* One **`todo` list entity** per column, attached to its board device. `unique_id =
  f"{board_id}_{column_id}"`. It reads/writes cards through `HakanbanData`, so the native todo
  card, Assist and `todo.*` services operate on the same data the panel shows.
* One **`calendar` entity** per board, attached to its board device. `unique_id =
  f"{board_id}_calendar"`. Every non-archived card with a `due` date surfaces as an event
  (summary `#<number> <title>`); a date-only due is an all-day event, a due with a time is a
  one-hour block. Read-only view over `HakanbanData`, so dated cards appear in HA's Calendar
  panel / dashboard card and are Assist-queryable and automatable.
