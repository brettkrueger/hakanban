"""Central data manager for Hakanban.

``HakanbanData`` owns the in-memory board model (loaded from / persisted to
:class:`HakanbanStore`) and is the single mutation point. Every mutation:

* updates the in-memory model,
* schedules a debounced save,
* fires the relevant event on ``hass.bus`` (so automations can react),
* dispatches :data:`SIGNAL_BOARDS_UPDATED` (so subscribed panels live-refresh and
  todo entities reconcile / write state).

The todo entities and the websocket API are thin readers/writers on top of this.
"""

from __future__ import annotations

import copy
import datetime
import functools
import re
from typing import Any, Callable, TypeVar

from homeassistant.core import HomeAssistant
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.util import dt as dt_util
from homeassistant.util import uuid as uuid_util

from .const import (
    CARD_TYPE_EPIC,
    CARD_TYPE_TASK,
    CARD_TYPES,
    DEFAULT_LABELS,
    EVENT_BOARD_CHANGED,
    EVENT_CARD_COMPLETED,
    EVENT_CARD_CREATED,
    EVENT_CARD_DELETED,
    EVENT_CARD_MOVED,
    EVENT_CARD_UNBLOCKED,
    EVENT_CARD_UPDATED,
    ORDER_STEP,
    SIGNAL_BOARDS_UPDATED,
    STATUS_COMPLETED,
    STATUS_NEEDS_ACTION,
    UNDO_HISTORY_LIMIT,
)
from .store import HakanbanStore, empty_data

_T = TypeVar("_T")


def _uid() -> str:
    return uuid_util.random_uuid_hex()


def _now() -> str:
    return dt_util.utcnow().isoformat()


def _parse_ts(value: Any) -> datetime.datetime | None:
    """Parse a stored ISO timestamp; naive values are treated as UTC."""
    if not value:
        return None
    try:
        parsed = datetime.datetime.fromisoformat(str(value))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=datetime.timezone.utc)
    return parsed


_HEX_COLOR = re.compile(r"^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
# Gradients from the background picker, e.g. "linear-gradient(135deg,#667eea,#764ba2)".
# Restricted charset: colours end up in inline CSS, so nothing that could break out of it.
_GRADIENT = re.compile(r"^linear-gradient\([#0-9a-zA-Z.,%\s-]{1,200}\)$")
_FALLBACK_LABEL_COLOR = "#838c91"


def _normalize_color(value: Any) -> str:
    """Return ``value`` as lowercase ``#rrggbb``; raise for anything that isn't hex."""
    match = _HEX_COLOR.match(str(value or "").strip())
    if not match:
        raise HakanbanError(f"Invalid colour {value!r}: use a hex value like #1a2b3c")
    digits = match.group(1).lower()
    if len(digits) == 3:
        digits = "".join(ch * 2 for ch in digits)
    return f"#{digits}"


def _normalize_background(value: Any) -> str | None:
    """A board background: ``None``/empty (none), a hex colour, or a linear-gradient."""
    if value is None or not str(value).strip():
        return None
    text = str(value).strip()
    if _GRADIENT.match(text):
        return text
    return _normalize_color(text)


def _looks_done(title: Any) -> bool:
    """Default for a list's ``done`` flag: a list called "Done" completes its cards."""
    return str(title or "").strip().lower() == "done"


def _undoable(method: Callable[..., _T]) -> Callable[..., _T]:
    """Snapshot the whole document before a mutation so it can be undone.

    The snapshot is pushed onto the undo stack *before* the wrapped method runs
    (so the live update it dispatches already reports ``can_undo``), and rolled
    back if the method raises. Any new mutation clears the redo stack. Undo/redo
    themselves are deliberately *not* wrapped.
    """

    @functools.wraps(method)
    def wrapper(self: "HakanbanData", *args: Any, **kwargs: Any) -> _T:
        snapshot = copy.deepcopy(self._data)
        saved_redo = self._redo_stack
        self._undo_stack.append(snapshot)
        self._redo_stack = []
        try:
            result = method(self, *args, **kwargs)
        except Exception:
            self._undo_stack.pop()
            self._redo_stack = saved_redo
            raise
        if len(self._undo_stack) > UNDO_HISTORY_LIMIT:
            self._undo_stack.pop(0)
        return result

    return wrapper


class HakanbanError(Exception):
    """Raised for invalid Hakanban operations (unknown ids etc.)."""


class HakanbanData:
    """Owns and mutates the Hakanban board model."""

    def __init__(self, hass: HomeAssistant, store: HakanbanStore) -> None:
        self.hass = hass
        self._store = store
        self._data: dict[str, Any] = empty_data()
        self._undo_stack: list[dict[str, Any]] = []
        self._redo_stack: list[dict[str, Any]] = []

    # ------------------------------------------------------------------ load
    async def async_load(self) -> None:
        self._data = await self._store.async_load()
        self._normalize()
        if not self._data["boards"]:
            # First run: seed a starter board so the panel isn't empty.
            self.create_board("My Board", seed=True)
        # The loaded/seeded state is the baseline — nothing to undo into yet.
        self._undo_stack.clear()
        self._redo_stack.clear()

    # ------------------------------------------------------------------ undo
    @property
    def can_undo(self) -> bool:
        return bool(self._undo_stack)

    @property
    def can_redo(self) -> bool:
        return bool(self._redo_stack)

    def undo(self) -> bool:
        """Revert the most recent mutation. Returns ``False`` if nothing to undo."""
        if not self._undo_stack:
            return False
        self._redo_stack.append(copy.deepcopy(self._data))
        self._data = self._undo_stack.pop()
        self._commit(None, EVENT_BOARD_CHANGED, {"action": "undo"})
        return True

    def redo(self) -> bool:
        """Re-apply the most recently undone mutation. ``False`` if nothing to redo."""
        if not self._redo_stack:
            return False
        self._undo_stack.append(copy.deepcopy(self._data))
        self._data = self._redo_stack.pop()
        self._commit(None, EVENT_BOARD_CHANGED, {"action": "redo"})
        return True

    def _normalize(self) -> None:
        """Back-fill fields added after v0.1.8 so older stores load cleanly."""
        for board in self.boards.values():
            for col in board.get("columns", []):
                col.setdefault("auto_archive_days", None)
                # Lists created before "done lists" existed: a list titled "Done" is one.
                if "done" not in col:
                    col["done"] = _looks_done(col.get("title"))
            # Colours are rendered into inline CSS, so drop anything that isn't valid.
            for label in board.get("label_defs", []):
                try:
                    label["color"] = _normalize_color(label.get("color"))
                except HakanbanError:
                    label["color"] = _FALLBACK_LABEL_COLOR
            try:
                board["background"] = _normalize_background(board.get("background"))
            except HakanbanError:
                board["background"] = None
        for card in self.cards.values():
            card.setdefault("card_type", CARD_TYPE_TASK)
            card.setdefault("epic_id", None)
            card.setdefault("column_entered", card.get("updated") or card.get("created") or _now())
            card.setdefault("blocked_by", [])
        # Drop dependencies on cards that no longer exist or live on another board.
        for card in self.cards.values():
            card["blocked_by"] = [
                bid for bid in dict.fromkeys(card["blocked_by"])
                if bid != card["id"] and bid in self.cards
                and self.cards[bid]["board_id"] == card["board_id"]
            ]
        # Status now follows the list on boards that have a done list. Cards already sitting
        # in one are completed (stamped with when they entered it); cards completed elsewhere
        # (e.g. ticked in an HA to-do list) are moved into the done list rather than reopened.
        for board in self.boards.values():
            done_cols = self._done_columns(board)
            if not done_cols:
                continue
            done_ids = {c["id"] for c in done_cols}
            for card in self.cards_in_board(board["id"]):
                if card["column_id"] in done_ids:
                    if card.get("status") != STATUS_COMPLETED:
                        self._set_completion(card, True, card.get("column_entered"))
                elif card.get("status") == STATUS_COMPLETED:
                    target = self.cards_in_column(done_cols[0]["id"])
                    card["order"] = (target[-1]["order"] + ORDER_STEP) if target else 0
                    card["column_id"] = done_cols[0]["id"]
        for card in self.cards.values():
            # The separate "due complete" tick is gone: it mirrors completion now.
            card["due_complete"] = card.get("status") == STATUS_COMPLETED

    async def async_save_now(self) -> None:
        await self._store.async_save(self._data)

    # --------------------------------------------------------------- helpers
    @property
    def boards(self) -> dict[str, Any]:
        return self._data["boards"]

    @property
    def cards(self) -> dict[str, Any]:
        return self._data["cards"]

    def _require_board(self, board_id: str) -> dict[str, Any]:
        board = self.boards.get(board_id)
        if board is None:
            raise HakanbanError(f"Unknown board {board_id}")
        return board

    def _require_card(self, card_id: str) -> dict[str, Any]:
        card = self.cards.get(card_id)
        if card is None:
            raise HakanbanError(f"Unknown card {card_id}")
        return card

    def _column(self, board: dict[str, Any], column_id: str) -> dict[str, Any]:
        for col in board["columns"]:
            if col["id"] == column_id:
                return col
        raise HakanbanError(f"Unknown column {column_id}")

    # ------------------------------------------------------------ completion
    # A board's "done" lists complete the cards in them. On a board with at least one,
    # a card's status always matches its list: moving into a done list completes it,
    # moving out reopens it, and completing / reopening it any other way (HA to-do list,
    # services, Assist) moves it to the first done list / first open list.
    @staticmethod
    def _done_columns(board: dict[str, Any]) -> list[dict[str, Any]]:
        return sorted(
            (c for c in board["columns"] if c.get("done") and not c.get("archived")),
            key=lambda c: c.get("order", 0),
        )

    @staticmethod
    def _open_columns(board: dict[str, Any]) -> list[dict[str, Any]]:
        return sorted(
            (c for c in board["columns"] if not c.get("done") and not c.get("archived")),
            key=lambda c: c.get("order", 0),
        )

    def _column_is_done(self, board: dict[str, Any], column_id: str) -> bool:
        return any(c["id"] == column_id for c in self._done_columns(board))

    @staticmethod
    def _set_completion(card: dict[str, Any], completed: bool, when: str | None = None) -> bool:
        """Set status + the completion stamp. Returns True if the card was newly completed."""
        was = card.get("status") == STATUS_COMPLETED
        card["due_complete"] = completed
        if completed and not was:
            card["status"] = STATUS_COMPLETED
            card["completed"] = when or _now()
            return True
        if not completed and was:
            card["status"] = STATUS_NEEDS_ACTION
            card.pop("completed", None)
        return False

    def _sync_board_completion(self, board: dict[str, Any]) -> None:
        """Make every live card's status match its list (after a list's done flag changes)."""
        if not self._done_columns(board):
            return
        for card in self.cards_in_board(board["id"]):
            self._set_completion(card, self._column_is_done(board, card["column_id"]))

    @staticmethod
    def _reindex(items: list[dict[str, Any]]) -> None:
        """Sort by current order and reassign sparse integer orders in place."""
        items.sort(key=lambda i: i.get("order", 0))
        for idx, item in enumerate(items):
            item["order"] = idx * ORDER_STEP

    def _commit(
        self,
        board_id: str | None,
        event: str | None = None,
        event_data: dict[str, Any] | None = None,
    ) -> None:
        """Persist, fire an optional event, and notify listeners."""
        self._store.async_schedule_save(self._data)
        if event is not None:
            self.hass.bus.async_fire(event, event_data or {})
        async_dispatcher_send(self.hass, SIGNAL_BOARDS_UPDATED, board_id)

    # ----------------------------------------------------------------- query
    def column_ids(self) -> list[tuple[str, str]]:
        """Return ``(board_id, column_id)`` for every non-archived column."""
        out: list[tuple[str, str]] = []
        for board_id, board in self.boards.items():
            if board.get("archived"):
                continue
            for col in board["columns"]:
                if not col.get("archived"):
                    out.append((board_id, col["id"]))
        return out

    def cards_in_column(self, column_id: str, include_archived: bool = False) -> list[dict[str, Any]]:
        cards = [
            c
            for c in self.cards.values()
            if c["column_id"] == column_id and (include_archived or not c.get("archived"))
        ]
        cards.sort(key=lambda c: c.get("order", 0))
        return cards

    def cards_in_board(self, board_id: str, include_archived: bool = False) -> list[dict[str, Any]]:
        """Every card on a board (across all columns), sorted by order."""
        cards = [
            c
            for c in self.cards.values()
            if c["board_id"] == board_id and (include_archived or not c.get("archived"))
        ]
        cards.sort(key=lambda c: c.get("order", 0))
        return cards

    def board_payload(self, board_id: str) -> dict[str, Any]:
        """Board with columns -> cards nested, ready for the frontend."""
        board = self._require_board(board_id)
        columns = sorted(
            (c for c in board["columns"] if not c.get("archived")),
            key=lambda c: c.get("order", 0),
        )
        return {
            "id": board["id"],
            "title": board["title"],
            "background": board.get("background"),
            "archived": board.get("archived", False),
            "labels": board.get("label_defs", []),
            "columns": [
                {**col, "cards": self.cards_in_column(col["id"])} for col in columns
            ],
            # Archived cards (newest first) so the panel can list / restore them and
            # epics can still count their archived children.
            "archived_cards": sorted(
                (c for c in self.cards.values() if c["board_id"] == board_id and c.get("archived")),
                key=lambda c: c.get("updated", ""),
                reverse=True,
            ),
        }

    def full_payload(self) -> dict[str, Any]:
        return {
            "boards": [
                self.board_payload(bid)
                for bid, b in self.boards.items()
                if not b.get("archived")
            ],
            "can_undo": self.can_undo,
            "can_redo": self.can_redo,
        }

    # ---------------------------------------------------------------- boards
    def _unique_board_title(self, title: str, exclude_id: str | None = None) -> str:
        """Return ``title``, appending `` (n)`` so it doesn't clash with another board."""
        title = (title or "").strip() or "Untitled board"
        existing = {
            b["title"] for bid, b in self.boards.items() if bid != exclude_id
        }
        if title not in existing:
            return title
        base = re.sub(r"\s*\(\d+\)$", "", title)  # drop any trailing " (n)"
        n = 2
        while f"{base} ({n})" in existing:
            n += 1
        return f"{base} ({n})"

    @_undoable
    def create_board(
        self, title: str, background: str | None = None, seed: bool = False
    ) -> dict[str, Any]:
        board_id = _uid()
        board = {
            "id": board_id,
            "title": self._unique_board_title(title),
            "background": _normalize_background(background),
            "archived": False,
            "label_defs": [dict(label) for label in DEFAULT_LABELS],
            "columns": [],
            "card_seq": 0,
            "created": _now(),
        }
        self.boards[board_id] = board
        if seed:
            for name in ("To Do", "Doing", "Done"):
                self._add_column(board, name)
        self._commit(board_id, EVENT_BOARD_CHANGED, {"board_id": board_id, "action": "created"})
        return board

    @_undoable
    def update_board(self, board_id: str, **changes: Any) -> dict[str, Any]:
        board = self._require_board(board_id)
        # Validate before writing anything, so a bad colour can't leave a half-applied update.
        if "background" in changes:
            background = _normalize_background(changes["background"])  # None / "" clears it
        if changes.get("title") is not None:
            board["title"] = self._unique_board_title(changes["title"], exclude_id=board_id)
        if "background" in changes:
            board["background"] = background
        if changes.get("archived") is not None:
            board["archived"] = changes["archived"]
        self._commit(board_id, EVENT_BOARD_CHANGED, {"board_id": board_id, "action": "updated"})
        return board

    @_undoable
    def delete_board(self, board_id: str) -> None:
        self._require_board(board_id)
        for card_id in [cid for cid, c in self.cards.items() if c["board_id"] == board_id]:
            del self.cards[card_id]
        del self.boards[board_id]
        self._commit(board_id, EVENT_BOARD_CHANGED, {"board_id": board_id, "action": "deleted"})

    # --------------------------------------------------------------- columns
    def _add_column(self, board: dict[str, Any], title: str) -> dict[str, Any]:
        orders = [c.get("order", 0) for c in board["columns"]]
        column = {
            "id": _uid(),
            "title": title or "New list",
            "order": (max(orders) + ORDER_STEP) if orders else 0,
            "archived": False,
            "auto_archive_days": None,
            "done": _looks_done(title),
        }
        board["columns"].append(column)
        return column

    @_undoable
    def create_column(self, board_id: str, title: str) -> dict[str, Any]:
        board = self._require_board(board_id)
        column = self._add_column(board, title)
        self._commit(board_id, EVENT_BOARD_CHANGED, {"board_id": board_id, "action": "column_created"})
        return column

    @_undoable
    def update_column(self, board_id: str, column_id: str, **changes: Any) -> dict[str, Any]:
        board = self._require_board(board_id)
        column = self._column(board, column_id)
        for key in ("title", "archived"):
            if key in changes and changes[key] is not None:
                column[key] = changes[key]
        if "auto_archive_days" in changes:
            days = changes["auto_archive_days"]
            # 0 / None / negative all mean "off".
            column["auto_archive_days"] = int(days) if days and int(days) > 0 else None
            # Apply the new rule straight away, inside this same undo step.
            self._archive_cards(self._auto_archive_candidates(column_ids={column_id}))
        if "done" in changes and changes["done"] is not None:
            blocked_before = self._blocked_ids(board_id)
            column["done"] = bool(changes["done"])
            # Completes / reopens cards to match, inside this same undo step.
            self._sync_board_completion(board)
            self._fire_unblocked(blocked_before)
        self._commit(board_id, EVENT_BOARD_CHANGED, {"board_id": board_id, "action": "column_updated"})
        return column

    @_undoable
    def delete_column(self, board_id: str, column_id: str) -> None:
        board = self._require_board(board_id)
        column = self._column(board, column_id)
        for card_id in [cid for cid, c in self.cards.items() if c["column_id"] == column_id]:
            self._unlink_epic_children(card_id)
            del self.cards[card_id]
        board["columns"].remove(column)
        self._commit(board_id, EVENT_BOARD_CHANGED, {"board_id": board_id, "action": "column_deleted"})

    @_undoable
    def move_column(self, board_id: str, column_id: str, position: int) -> None:
        board = self._require_board(board_id)
        column = self._column(board, column_id)
        ordered = sorted(board["columns"], key=lambda c: c.get("order", 0))
        ordered.remove(column)
        position = max(0, min(position, len(ordered)))
        ordered.insert(position, column)
        for idx, col in enumerate(ordered):
            col["order"] = idx * ORDER_STEP
        self._commit(board_id, EVENT_BOARD_CHANGED, {"board_id": board_id, "action": "column_moved"})

    # ----------------------------------------------------------------- cards
    def _validate_epic_link(self, card: dict[str, Any] | None, board_id: str, epic_id: str | None) -> None:
        """Raise unless ``epic_id`` is a usable parent for ``card`` on ``board_id``."""
        if epic_id is None:
            return
        epic = self.cards.get(epic_id)
        if epic is None or epic.get("card_type") != CARD_TYPE_EPIC:
            raise HakanbanError(f"Card {epic_id} is not an epic")
        if epic["board_id"] != board_id:
            raise HakanbanError("An epic can only contain cards from its own board")
        if card is not None:
            if card["id"] == epic_id:
                raise HakanbanError("A card cannot be its own epic")
            if card.get("card_type") == CARD_TYPE_EPIC:
                raise HakanbanError("Epics cannot be nested inside other epics")

    def _unlink_epic_children(self, epic_id: str) -> None:
        """Detach every card that points at ``epic_id`` (epic deleted / demoted / moved)."""
        for card in self.cards.values():
            if card.get("epic_id") == epic_id:
                card["epic_id"] = None

    def epic_children(self, epic_id: str, include_archived: bool = True) -> list[dict[str, Any]]:
        """Cards belonging to an epic, sorted by card number."""
        children = [
            c for c in self.cards.values()
            if c.get("epic_id") == epic_id and (include_archived or not c.get("archived"))
        ]
        children.sort(key=lambda c: c.get("number", 0))
        return children

    # ---------------------------------------------------------- dependencies
    # ``blocked_by`` lists cards (same board) that must be finished first. A card is
    # blocked while any of them is neither completed nor archived.
    def _is_blocked(self, card: dict[str, Any]) -> bool:
        for bid in card.get("blocked_by", []):
            blocker = self.cards.get(bid)
            if blocker and blocker.get("status") != STATUS_COMPLETED and not blocker.get("archived"):
                return True
        return False

    def _blocked_ids(self, board_id: str) -> set[str]:
        return {c["id"] for c in self.cards_in_board(board_id) if self._is_blocked(c)}

    def _fire_unblocked(self, before: set[str]) -> None:
        """Fire EVENT_CARD_UNBLOCKED for open cards in ``before`` that are no longer blocked."""
        for card_id in before:
            card = self.cards.get(card_id)
            if (card is None or card.get("archived") or card.get("status") == STATUS_COMPLETED
                    or self._is_blocked(card)):
                continue
            self.hass.bus.async_fire(
                EVENT_CARD_UNBLOCKED,
                {"board_id": card["board_id"], "column_id": card["column_id"], "card_id": card_id},
            )

    def _depends_on(self, card_id: str, target_id: str) -> bool:
        """True if ``card_id`` is (transitively) blocked by ``target_id``."""
        seen: set[str] = set()
        stack = [card_id]
        while stack:
            cur = self.cards.get(stack.pop())
            if cur is None:
                continue
            for bid in cur.get("blocked_by", []):
                if bid == target_id:
                    return True
                if bid not in seen:
                    seen.add(bid)
                    stack.append(bid)
        return False

    def _validate_blockers(self, card_id: str | None, board_id: str, blocked_by: Any) -> list[str]:
        """Return a clean, de-duplicated ``blocked_by`` list or raise HakanbanError."""
        out = list(dict.fromkeys(blocked_by or []))
        for bid in out:
            blocker = self.cards.get(bid)
            if blocker is None:
                raise HakanbanError(f"Unknown card {bid}")
            if blocker["board_id"] != board_id:
                raise HakanbanError("A card can only depend on cards from its own board")
            if card_id is not None:
                if bid == card_id:
                    raise HakanbanError("A card cannot depend on itself")
                if self._depends_on(bid, card_id):
                    raise HakanbanError(
                        f"#{blocker.get('number')} already depends on this card; that would be a cycle"
                    )
        return out

    def _drop_dependency_on(self, card_id: str) -> None:
        """Remove ``card_id`` from every other card's ``blocked_by``."""
        for card in self.cards.values():
            if card_id in card.get("blocked_by", []):
                card["blocked_by"] = [b for b in card["blocked_by"] if b != card_id]

    def _new_card(self, board: dict[str, Any], column_id: str, title: str, **fields: Any) -> dict[str, Any]:
        card_type = fields.get("card_type") or CARD_TYPE_TASK
        if card_type not in CARD_TYPES:
            raise HakanbanError(f"Unknown card type {card_type}")
        epic_id = fields.get("epic_id")
        if card_type == CARD_TYPE_EPIC and epic_id:
            raise HakanbanError("Epics cannot be nested inside other epics")
        self._validate_epic_link(None, board["id"], epic_id)
        blocked_by = self._validate_blockers(None, board["id"], fields.get("blocked_by"))

        board["card_seq"] = board.get("card_seq", 0) + 1
        existing = self.cards_in_column(column_id)
        order = (existing[-1]["order"] + ORDER_STEP) if existing else 0
        card_id = _uid()
        now = _now()
        card = {
            "id": card_id,
            "board_id": board["id"],
            "column_id": column_id,
            "order": order,
            "number": board["card_seq"],
            "card_type": card_type,
            "epic_id": epic_id,
            "title": title.strip() or "Untitled",
            "description": fields.get("description", ""),
            "labels": list(fields.get("labels", [])),
            "blocked_by": blocked_by,
            "assignees": list(fields.get("assignees", [])),
            "due": fields.get("due"),
            "due_complete": False,
            "status": STATUS_NEEDS_ACTION,
            "checklists": [],
            "comments": [],
            "cover": fields.get("cover"),
            "archived": False,
            "created": now,
            "updated": now,
            "column_entered": now,
        }
        if self._done_columns(board):
            completed = self._column_is_done(board, column_id)
        else:
            completed = fields.get("status") == STATUS_COMPLETED
        self._set_completion(card, completed, now)
        self.cards[card_id] = card
        return card

    @_undoable
    def create_card(self, board_id: str, column_id: str, title: str, **fields: Any) -> dict[str, Any]:
        board = self._require_board(board_id)
        self._column(board, column_id)  # validate
        card = self._new_card(board, column_id, title, **fields)
        self._commit(
            board_id, EVENT_CARD_CREATED,
            {"board_id": board_id, "column_id": column_id, "card_id": card["id"], "title": card["title"]},
        )
        return card

    @_undoable
    def create_cards_bulk(self, board_id: str, column_id: str, titles: list[str]) -> list[dict[str, Any]]:
        """Multi-line paste: one card per non-empty title, preserving order."""
        board = self._require_board(board_id)
        self._column(board, column_id)
        created: list[dict[str, Any]] = []
        for raw in titles:
            title = raw.strip()
            if not title:
                continue
            card = self._new_card(board, column_id, title)
            created.append(card)
            self.hass.bus.async_fire(
                EVENT_CARD_CREATED,
                {"board_id": board_id, "column_id": column_id, "card_id": card["id"], "title": card["title"]},
            )
        if created:
            self._commit(board_id)
        return created

    @_undoable
    def update_card(self, card_id: str, **fields: Any) -> dict[str, Any]:
        card = self._require_card(card_id)
        was_archived = bool(card.get("archived"))
        blocked_before = self._blocked_ids(card["board_id"])
        if fields.get("status") is not None:
            if fields["status"] not in (STATUS_COMPLETED, STATUS_NEEDS_ACTION):
                raise HakanbanError(f"Unknown status {fields['status']}")
            want_done: bool | None = fields["status"] == STATUS_COMPLETED
        elif fields.get("due_complete") is not None:
            want_done = bool(fields["due_complete"])  # legacy alias for completing
        else:
            want_done = None

        # Type / epic changes are validated before anything is written.
        new_type = fields.get("card_type") or card.get("card_type", CARD_TYPE_TASK)
        if new_type not in CARD_TYPES:
            raise HakanbanError(f"Unknown card type {new_type}")
        new_epic = fields["epic_id"] if "epic_id" in fields else card.get("epic_id")
        if new_type == CARD_TYPE_EPIC:
            if "epic_id" in fields and fields["epic_id"]:
                raise HakanbanError("Epics cannot be nested inside other epics")
            new_epic = None
        if new_epic is not None:
            self._validate_epic_link({**card, "card_type": new_type}, card["board_id"], new_epic)
        if "blocked_by" in fields:
            card["blocked_by"] = self._validate_blockers(card_id, card["board_id"], fields["blocked_by"])
        if card.get("card_type", CARD_TYPE_TASK) == CARD_TYPE_EPIC and new_type != CARD_TYPE_EPIC:
            self._unlink_epic_children(card_id)  # demoted: its children become free cards
        card["card_type"] = new_type
        card["epic_id"] = new_epic

        for key in ("title", "description", "labels", "assignees", "archived"):
            if key in fields and fields[key] is not None:
                card[key] = fields[key]
        # These can be explicitly cleared with null.
        for key in ("due", "cover"):
            if key in fields:
                card[key] = fields[key]
        card["updated"] = _now()
        if was_archived and not card.get("archived"):
            # Restored: restart the column clock so auto-archive doesn't grab it again.
            card["column_entered"] = card["updated"]

        board = self._require_board(card["board_id"])
        if self._done_columns(board):
            # Completing / reopening moves the card to match; otherwise (e.g. a restore)
            # the status just follows whatever list the card is in.
            in_done = self._column_is_done(board, card["column_id"])
            target = None
            if want_done is True and not in_done:
                target = self._done_columns(board)[0]
            elif want_done is False and in_done and self._open_columns(board):
                target = self._open_columns(board)[0]
            if target is not None:
                from_column = card["column_id"]
                self._place_card(card, target["id"])
                self.hass.bus.async_fire(
                    EVENT_CARD_MOVED,
                    {"board_id": card["board_id"], "card_id": card_id,
                     "from_column": from_column, "to_column": target["id"]},
                )
            completed = self._column_is_done(board, card["column_id"])
        else:
            completed = want_done if want_done is not None else card.get("status") == STATUS_COMPLETED
        newly = self._set_completion(card, completed)
        self._fire_unblocked(blocked_before)
        event = EVENT_CARD_COMPLETED if newly else EVENT_CARD_UPDATED
        self._commit(
            card["board_id"], event,
            {"board_id": card["board_id"], "column_id": card["column_id"], "card_id": card_id},
        )
        return card

    @_undoable
    def move_card(
        self,
        card_id: str,
        to_column: str,
        position: int | None = None,
        to_board: str | None = None,
    ) -> dict[str, Any]:
        card = self._require_card(card_id)
        from_column = card["column_id"]
        board_id = to_board or card["board_id"]
        board = self._require_board(board_id)
        self._column(board, to_column)  # validate target exists
        blocked_before = self._blocked_ids(card["board_id"])

        if board_id != card["board_id"]:
            # Epic links and dependencies never cross boards.
            card["epic_id"] = None
            if card.get("card_type") == CARD_TYPE_EPIC:
                self._unlink_epic_children(card_id)
            card["blocked_by"] = []
            self._drop_dependency_on(card_id)
        card["board_id"] = board_id
        self._place_card(card, to_column, position)
        if self._done_columns(board) and self._set_completion(card, self._column_is_done(board, to_column)):
            self.hass.bus.async_fire(
                EVENT_CARD_COMPLETED,
                {"board_id": board_id, "column_id": to_column, "card_id": card_id},
            )
        self._fire_unblocked(blocked_before)

        self._commit(
            board_id, EVENT_CARD_MOVED,
            {
                "board_id": board_id,
                "card_id": card_id,
                "from_column": from_column,
                "to_column": to_column,
            },
        )
        return card

    def _place_card(self, card: dict[str, Any], to_column: str, position: int | None = None) -> None:
        """Put ``card`` into ``to_column`` at ``position`` (default: the end) and reorder."""
        from_column = card["column_id"]
        card["column_id"] = to_column
        siblings = [c for c in self.cards_in_column(to_column) if c["id"] != card["id"]]
        if position is None or position >= len(siblings):
            position = len(siblings)
        position = max(0, position)
        siblings.insert(position, card)
        for idx, sib in enumerate(siblings):
            sib["order"] = idx * ORDER_STEP
        card["updated"] = _now()
        if to_column != from_column:
            card["column_entered"] = card["updated"]

    @_undoable
    def delete_card(self, card_id: str) -> None:
        card = self._require_card(card_id)
        board_id = card["board_id"]
        blocked_before = self._blocked_ids(board_id)
        self._unlink_epic_children(card_id)
        self._drop_dependency_on(card_id)
        del self.cards[card_id]
        self._fire_unblocked(blocked_before)
        self._commit(
            board_id, EVENT_CARD_DELETED,
            {"board_id": board_id, "card_id": card_id},
        )

    # ---------------------------------------------------------- auto-archive
    def _auto_archive_candidates(
        self,
        now: datetime.datetime | None = None,
        column_ids: set[str] | None = None,
    ) -> list[dict[str, Any]]:
        """Cards that have sat in an auto-archiving column for at least its N days."""
        now = now or dt_util.utcnow()
        out: list[dict[str, Any]] = []
        for board in self.boards.values():
            if board.get("archived"):
                continue
            for col in board["columns"]:
                days = col.get("auto_archive_days")
                if not days or col.get("archived"):
                    continue
                if column_ids is not None and col["id"] not in column_ids:
                    continue
                cutoff = now - datetime.timedelta(days=days)
                for card in self.cards_in_column(col["id"]):
                    entered = _parse_ts(card.get("column_entered") or card.get("updated"))
                    if entered is not None and entered <= cutoff:
                        out.append(card)
        return out

    def _archive_cards(self, cards: list[dict[str, Any]]) -> None:
        """Archive ``cards`` in place and fire one updated event per card (no commit)."""
        now = _now()
        for card in cards:
            card["archived"] = True
            card["updated"] = now
            self.hass.bus.async_fire(
                EVENT_CARD_UPDATED,
                {
                    "board_id": card["board_id"],
                    "column_id": card["column_id"],
                    "card_id": card["id"],
                    "action": "auto_archived",
                },
            )

    def auto_archive(self, now: datetime.datetime | None = None) -> list[dict[str, Any]]:
        """Run the auto-archive sweep. Returns the cards archived (often none).

        A sweep that finds nothing touches nothing — no save, no undo entry — so the
        periodic timer doesn't flood the undo history.
        """
        candidates = self._auto_archive_candidates(now)
        if candidates:
            self._apply_auto_archive(candidates)
        return candidates

    @_undoable
    def _apply_auto_archive(self, cards: list[dict[str, Any]]) -> None:
        # The snapshot was taken before these card dicts were mutated, so undo restores them.
        self._archive_cards(cards)
        self._commit(None)

    # ---------------------------------------------------------------- labels
    @_undoable
    def create_label(self, board_id: str, name: str, color: str) -> dict[str, Any]:
        board = self._require_board(board_id)
        label = {"id": _uid(), "name": name or "", "color": _normalize_color(color)}
        board.setdefault("label_defs", []).append(label)
        self._commit(board_id, EVENT_BOARD_CHANGED, {"board_id": board_id, "action": "label_created"})
        return label

    @_undoable
    def update_label(self, board_id: str, label_id: str, **changes: Any) -> dict[str, Any]:
        board = self._require_board(board_id)
        for label in board.get("label_defs", []):
            if label["id"] == label_id:
                if changes.get("color") is not None:
                    label["color"] = _normalize_color(changes["color"])
                if changes.get("name") is not None:
                    label["name"] = changes["name"]
                self._commit(board_id, EVENT_BOARD_CHANGED, {"board_id": board_id, "action": "label_updated"})
                return label
        raise HakanbanError(f"Unknown label {label_id}")

    @_undoable
    def delete_label(self, board_id: str, label_id: str) -> None:
        board = self._require_board(board_id)
        board["label_defs"] = [l for l in board.get("label_defs", []) if l["id"] != label_id]
        for card in self.cards.values():
            if card["board_id"] == board_id and label_id in card.get("labels", []):
                card["labels"].remove(label_id)
        self._commit(board_id, EVENT_BOARD_CHANGED, {"board_id": board_id, "action": "label_deleted"})

    # -------------------------------------------------------------- comments
    @_undoable
    def add_comment(self, card_id: str, text: str, author: str | None = None) -> dict[str, Any]:
        card = self._require_card(card_id)
        comment = {"id": _uid(), "author": author or "Home Assistant", "ts": _now(), "text": text}
        card.setdefault("comments", []).append(comment)
        card["updated"] = _now()
        self._commit(
            card["board_id"], EVENT_CARD_UPDATED,
            {"board_id": card["board_id"], "card_id": card_id, "action": "comment_added"},
        )
        return comment

    # ------------------------------------------------------------ checklists
    @_undoable
    def add_checklist(self, card_id: str, title: str) -> dict[str, Any]:
        card = self._require_card(card_id)
        checklist = {"id": _uid(), "title": title or "Checklist", "items": []}
        card.setdefault("checklists", []).append(checklist)
        self._commit(card["board_id"])
        return checklist

    @_undoable
    def add_check_item(self, card_id: str, checklist_id: str, text: str) -> dict[str, Any]:
        card = self._require_card(card_id)
        for checklist in card.get("checklists", []):
            if checklist["id"] == checklist_id:
                item = {"id": _uid(), "text": text, "done": False}
                checklist["items"].append(item)
                self._commit(card["board_id"])
                return item
        raise HakanbanError(f"Unknown checklist {checklist_id}")

    def toggle_check_item(self, card_id: str, checklist_id: str, item_id: str, done: bool) -> None:
        # Kept for the existing websocket command; update_check_item does the (undoable) work.
        self.update_check_item(card_id, checklist_id, item_id, done=done)

    def _checklist(self, card: dict[str, Any], checklist_id: str) -> dict[str, Any]:
        for checklist in card.get("checklists", []):
            if checklist["id"] == checklist_id:
                return checklist
        raise HakanbanError(f"Unknown checklist {checklist_id}")

    def _check_item(self, checklist: dict[str, Any], item_id: str) -> dict[str, Any]:
        for item in checklist["items"]:
            if item["id"] == item_id:
                return item
        raise HakanbanError(f"Unknown check item {item_id}")

    def _touch(self, card: dict[str, Any]) -> None:
        card["updated"] = _now()
        self._commit(card["board_id"])

    @_undoable
    def update_checklist(self, card_id: str, checklist_id: str, title: str) -> dict[str, Any]:
        card = self._require_card(card_id)
        checklist = self._checklist(card, checklist_id)
        checklist["title"] = title.strip() or "Checklist"
        self._touch(card)
        return checklist

    @_undoable
    def delete_checklist(self, card_id: str, checklist_id: str) -> None:
        card = self._require_card(card_id)
        checklist = self._checklist(card, checklist_id)
        card["checklists"].remove(checklist)
        self._touch(card)

    @_undoable
    def update_check_item(
        self, card_id: str, checklist_id: str, item_id: str,
        text: str | None = None, done: bool | None = None,
    ) -> dict[str, Any]:
        card = self._require_card(card_id)
        item = self._check_item(self._checklist(card, checklist_id), item_id)
        if text is not None:
            if not text.strip():
                raise HakanbanError("A checklist item needs some text")
            item["text"] = text.strip()
        if done is not None:
            item["done"] = bool(done)
        self._touch(card)
        return item

    @_undoable
    def delete_check_item(self, card_id: str, checklist_id: str, item_id: str) -> None:
        card = self._require_card(card_id)
        checklist = self._checklist(card, checklist_id)
        checklist["items"].remove(self._check_item(checklist, item_id))
        self._touch(card)

    @_undoable
    def move_check_item(
        self, card_id: str, checklist_id: str, item_id: str,
        position: int, to_checklist: str | None = None,
    ) -> dict[str, Any]:
        """Reorder an item within its checklist, or move it to another checklist on the card."""
        card = self._require_card(card_id)
        source = self._checklist(card, checklist_id)
        target = self._checklist(card, to_checklist) if to_checklist else source
        item = self._check_item(source, item_id)
        source["items"].remove(item)
        position = max(0, min(int(position), len(target["items"])))
        target["items"].insert(position, item)
        self._touch(card)
        return item
