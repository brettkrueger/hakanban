"""Standalone logic tests for HakanbanData.

Home Assistant isn't a dependency of the test runner, so we stub the thin slice of
its API that data.py / store.py import, then exercise the *real* manager code for the
risky bits: ordering, moves across columns, bulk paste, completion events, deletes.

Run:  python3 tests/test_logic.py
"""

import datetime
import importlib.util
import os
import sys
import types

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PKG_DIR = os.path.join(REPO, "custom_components", "hakanban")


# --------------------------------------------------------------------- HA stubs
def _stub_homeassistant():
    ha = types.ModuleType("homeassistant")

    core = types.ModuleType("homeassistant.core")
    core.HomeAssistant = type("HomeAssistant", (), {})
    core.callback = lambda f: f

    helpers = types.ModuleType("homeassistant.helpers")
    storage = types.ModuleType("homeassistant.helpers.storage")
    storage.Store = type("Store", (), {})
    dispatcher = types.ModuleType("homeassistant.helpers.dispatcher")
    dispatcher.async_dispatcher_send = lambda *a, **k: None

    util = types.ModuleType("homeassistant.util")
    dt = types.ModuleType("homeassistant.util.dt")
    dt.utcnow = lambda: datetime.datetime(2026, 6, 16, 12, 0, 0, tzinfo=datetime.timezone.utc)
    dt.DEFAULT_TIME_ZONE = datetime.timezone.utc
    uuid_mod = types.ModuleType("homeassistant.util.uuid")
    counter = {"n": 0}

    def _rid():
        counter["n"] += 1
        return f"id{counter['n']:04d}"

    uuid_mod.random_uuid_hex = _rid

    for name, mod in {
        "homeassistant": ha,
        "homeassistant.core": core,
        "homeassistant.helpers": helpers,
        "homeassistant.helpers.storage": storage,
        "homeassistant.helpers.dispatcher": dispatcher,
        "homeassistant.util": util,
        "homeassistant.util.dt": dt,
        "homeassistant.util.uuid": uuid_mod,
    }.items():
        sys.modules[name] = mod


def _load_module(pkg, name):
    spec = importlib.util.spec_from_file_location(
        f"{pkg}.{name}", os.path.join(PKG_DIR, f"{name}.py")
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules[f"{pkg}.{name}"] = mod
    spec.loader.exec_module(mod)
    return mod


class FakeStore:
    """Stands in for HakanbanStore: keeps the doc in memory."""

    def __init__(self):
        self.saved = 0

    async def async_load(self):
        return {"boards": {}, "cards": {}}

    def async_schedule_save(self, data):
        self.saved += 1

    async def async_save(self, data):
        self.saved += 1


class FakeBus:
    def __init__(self):
        self.events = []

    def async_fire(self, event_type, data=None):
        self.events.append((event_type, data or {}))


class FakeHass:
    def __init__(self):
        self.bus = FakeBus()


# ------------------------------------------------------------------------ tests
RESULTS = []


def check(name, cond):
    RESULTS.append((name, bool(cond)))
    print(("PASS" if cond else "FAIL"), "-", name)


def run():
    _stub_homeassistant()
    _load_module("hkpkg", "const")
    _load_module("hkpkg", "store")
    data = _load_module("hkpkg", "data")

    hass = FakeHass()
    mgr = data.HakanbanData(hass, FakeStore())

    # Seed a board with 3 columns (mirrors async_load's first-run seed).
    board = mgr.create_board("Test", seed=True)
    bid = board["id"]
    cols = board["columns"]
    check("board seeded with 3 columns", len(cols) == 3)
    todo, doing, done = cols[0]["id"], cols[1]["id"], cols[2]["id"]

    # Create cards; numbers increment; order is sparse + ascending.
    c1 = mgr.create_card(bid, todo, "A")
    c2 = mgr.create_card(bid, todo, "B")
    c3 = mgr.create_card(bid, todo, "C")
    check("card numbers increment", (c1["number"], c2["number"], c3["number"]) == (1, 2, 3))
    ordered = [c["id"] for c in mgr.cards_in_column(todo)]
    check("cards ordered by insertion", ordered == [c1["id"], c2["id"], c3["id"]])

    # Move C to front of 'todo'.
    mgr.move_card(c3["id"], todo, position=0)
    ordered = [c["id"] for c in mgr.cards_in_column(todo)]
    check("move within column to front", ordered == [c3["id"], c1["id"], c2["id"]])

    # Move A to 'doing' at end; it leaves 'todo'.
    mgr.move_card(c1["id"], doing, position=99)
    check("card left source column", c1["id"] not in [c["id"] for c in mgr.cards_in_column(todo)])
    check("card entered target column", [c["id"] for c in mgr.cards_in_column(doing)] == [c1["id"]])
    check("moved card column_id updated", mgr.cards[c1["id"]]["column_id"] == doing)

    # Move event fired with from/to.
    moved = [e for e in hass.bus.events if e[0] == "hakanban_card_moved"]
    check("move fired event with from/to",
          moved and moved[-1][1]["from_column"] == todo and moved[-1][1]["to_column"] == doing)

    # Bulk paste: 3 non-empty lines among blanks -> 3 cards, ordered.
    pasted = mgr.create_cards_bulk(bid, done, ["X", "  ", "Y", "", "Z"])
    check("bulk paste skips blanks", len(pasted) == 3)
    check("bulk paste order preserved",
          [c["title"] for c in mgr.cards_in_column(done)] == ["X", "Y", "Z"])

    # Completion fires the completed event and stamps completed.
    before = len([e for e in hass.bus.events if e[0] == "hakanban_card_completed"])
    mgr.update_card(c2["id"], status="completed")
    after = len([e for e in hass.bus.events if e[0] == "hakanban_card_completed"])
    check("completing a card fires completed event", after == before + 1)
    check("completed timestamp stamped", "completed" in mgr.cards[c2["id"]])

    # Labels: default palette present; toggle + delete cleans card refs.
    check("default label palette seeded", len(board["label_defs"]) == 6)
    lbl = mgr.create_label(bid, "Bug", "#eb5a46")
    mgr.update_card(c2["id"], labels=[lbl["id"]])
    mgr.delete_label(bid, lbl["id"])
    check("deleting a label removes it from cards", lbl["id"] not in mgr.cards[c2["id"]]["labels"])

    # Column reorder.
    mgr.move_column(bid, done, 0)
    new_order = [c["id"] for c in sorted(board["columns"], key=lambda c: c["order"])]
    check("column reorder puts 'done' first", new_order[0] == done)

    # Delete a card fires event and drops it.
    mgr.delete_card(c1["id"])
    check("card deleted", c1["id"] not in mgr.cards)

    # board_payload nests cards under columns, archived excluded.
    payload = mgr.board_payload(bid)
    check("payload has columns with nested cards",
          all("cards" in col for col in payload["columns"]))

    # full_payload returns the board.
    full = mgr.full_payload()
    check("full_payload returns board", any(b["id"] == bid for b in full["boards"]))

    # cards_in_board gathers cards across every column (used by the calendar entity).
    board_card_ids = {c["id"] for c in mgr.cards_in_board(bid)}
    check("cards_in_board spans columns",
          {c2["id"], c3["id"]}.issubset(board_card_ids)
          and all(c["id"] in board_card_ids for c in pasted))

    # Board titles disambiguate so two boards never share a name.
    b2 = mgr.create_board("Test")        # clashes with the seeded "Test"
    b3 = mgr.create_board("Test")        # clashes with "Test" and "Test (2)"
    check("duplicate board title -> (2)", b2["title"] == "Test (2)")
    check("third duplicate -> (3)", b3["title"] == "Test (3)")
    mgr.update_board(b3["id"], title="Test")  # rename onto a clashing name
    check("rename onto clash disambiguates", mgr.boards[b3["id"]]["title"] == "Test (3)")
    mgr.update_board(b2["id"], title="Test (2)")  # rename to its own title
    check("rename to own title is kept", mgr.boards[b2["id"]]["title"] == "Test (2)")

    # Background can be set and then cleared back to "no background" (null).
    mgr.update_board(bid, background="#0079bf")
    check("background set", mgr.boards[bid]["background"] == "#0079bf")
    mgr.update_board(bid, title="Renamed only")  # absent background -> untouched
    check("absent background left unchanged", mgr.boards[bid]["background"] == "#0079bf")
    mgr.update_board(bid, background=None)  # explicit null -> cleared
    check("background cleared by null", mgr.boards[bid]["background"] is None)

    # Undo / redo (store-wide snapshot history).
    ub = mgr.create_board("Undo Board")["id"]
    ucol = mgr.create_column(ub, "Col")["id"]
    check("can_undo after a mutation", mgr.can_undo is True)
    check("can_redo is false after a fresh mutation", mgr.can_redo is False)

    uc = mgr.create_card(ub, ucol, "Temp card")
    check("card present before undo", uc["id"] in mgr.cards)
    mgr.undo()
    check("undo removes the new card", uc["id"] not in mgr.cards)
    check("can_redo after undo", mgr.can_redo is True)
    mgr.redo()
    check("redo restores the card", uc["id"] in mgr.cards)

    # A brand-new mutation discards the redo stack.
    mgr.undo()
    check("redo available before new mutation", mgr.can_redo is True)
    mgr.create_card(ub, ucol, "Other")
    check("new mutation clears redo", mgr.can_redo is False)

    # Undo of a delete restores the whole board (and its device/entities reconcile).
    mgr.delete_board(ub)
    check("board deleted", ub not in mgr.boards)
    mgr.undo()
    check("undo restores a deleted board", ub in mgr.boards)

    # full_payload advertises availability so the panel can enable/disable buttons.
    fp = mgr.full_payload()
    check("payload exposes undo flags", "can_undo" in fp and "can_redo" in fp)

    # Undo past the start of history is a safe no-op.
    while mgr.can_undo:
        mgr.undo()
    check("undo on empty history returns False", mgr.undo() is False)
    check("redo refills from a drained undo", mgr.can_redo is True)

    # ------------------------------------------------------------ epics
    eb = mgr.create_board("Epic Board", seed=True)
    ebid = eb["id"]
    ecol, ecol2, ecol3 = (c["id"] for c in eb["columns"])
    epic = mgr.create_card(ebid, ecol, "Kitchen reno", card_type="epic")
    check("epic created with type", epic["card_type"] == "epic" and epic["epic_id"] is None)
    t1 = mgr.create_card(ebid, ecol, "Pick tiles", epic_id=epic["id"])
    t2 = mgr.create_card(ebid, ecol, "Book plumber")
    check("task defaults to type task", t2["card_type"] == "task")
    mgr.update_card(t2["id"], epic_id=epic["id"])
    check("epic_children lists both tasks",
          [c["id"] for c in mgr.epic_children(epic["id"])] == [t1["id"], t2["id"]])
    mgr.update_card(t2["id"], epic_id=None)
    check("epic_id null clears link", mgr.cards[t2["id"]]["epic_id"] is None)

    def raises(fn):
        try:
            fn()
        except data.HakanbanError:
            return True
        return False

    check("cannot link to a non-epic", raises(lambda: mgr.update_card(t2["id"], epic_id=t1["id"])))
    check("epic cannot be its own epic", raises(lambda: mgr.update_card(epic["id"], epic_id=epic["id"])))
    epic2 = mgr.create_card(ebid, ecol, "Other epic", card_type="epic")
    check("epics cannot nest", raises(lambda: mgr.update_card(epic2["id"], epic_id=epic["id"])))
    check("unknown type rejected", raises(lambda: mgr.update_card(t2["id"], card_type="story")))
    check("failed update leaves card unchanged",
          mgr.cards[t2["id"]]["card_type"] == "task" and mgr.cards[t2["id"]]["epic_id"] is None)
    other_board = mgr.create_board("Other", seed=True)
    ocol = other_board["columns"][0]["id"]
    oc = mgr.create_card(other_board["id"], ocol, "Elsewhere")
    check("cross-board epic link rejected", raises(lambda: mgr.update_card(oc["id"], epic_id=epic["id"])))

    # Demoting an epic frees its children; promoting a child drops its own link.
    mgr.update_card(t2["id"], epic_id=epic2["id"])
    mgr.update_card(epic2["id"], card_type="task")
    check("demoting epic unlinks children", mgr.cards[t2["id"]]["epic_id"] is None)
    mgr.update_card(t1["id"], card_type="epic")
    check("promoting a child clears its epic_id", mgr.cards[t1["id"]]["epic_id"] is None)
    mgr.update_card(t1["id"], card_type="task", epic_id=epic["id"])

    # Deleting an epic, or moving it / a child to another board, breaks links.
    mgr.move_card(t1["id"], ocol, to_board=other_board["id"])
    check("child moved off-board loses epic", mgr.cards[t1["id"]]["epic_id"] is None)
    mgr.move_card(t1["id"], ecol, to_board=ebid)
    mgr.update_card(t1["id"], epic_id=epic["id"])
    mgr.delete_card(epic["id"])
    check("deleting epic unlinks children", mgr.cards[t1["id"]]["epic_id"] is None)
    mgr.undo()
    check("undo of epic delete restores link", mgr.cards[t1["id"]]["epic_id"] == epic["id"])

    # ----------------------------------------------------- unarchive / clear due
    mgr.update_card(t2["id"], due="2026-07-01")
    mgr.update_card(t2["id"], due=None)
    check("due null clears the due date", mgr.cards[t2["id"]]["due"] is None)

    # ------------------------------------------------------- auto-archive
    utc = datetime.timezone.utc
    T0 = datetime.datetime(2026, 6, 16, 12, 0, 0, tzinfo=utc)  # stub utcnow
    aa = mgr.create_card(ebid, ecol3, "Old done")
    bb = mgr.create_card(ebid, ecol3, "Fresh done")
    cc = mgr.create_card(ebid, ecol2, "In progress")
    mgr.cards[aa["id"]]["column_entered"] = (T0 - datetime.timedelta(days=10)).isoformat()
    mgr.cards[cc["id"]]["column_entered"] = (T0 - datetime.timedelta(days=30)).isoformat()
    check("sweep is a no-op with no rules", mgr.auto_archive(T0) == [])

    undo_depth = len(mgr._undo_stack)
    mgr.update_column(ebid, ecol3, auto_archive_days=7)
    check("setting a rule archives overdue cards immediately", mgr.cards[aa["id"]]["archived"] is True)
    check("fresh card in the column untouched", mgr.cards[bb["id"]]["archived"] is False)
    check("other columns untouched", mgr.cards[cc["id"]]["archived"] is False)
    check("rule + sweep is one undo step", len(mgr._undo_stack) == undo_depth + 1)
    check("auto_archived event fired",
          any(e[0] == "hakanban_card_updated" and e[1].get("action") == "auto_archived"
              and e[1]["card_id"] == aa["id"] for e in hass.bus.events))
    payload = mgr.board_payload(ebid)
    check("archived cards listed in payload", aa["id"] in [c["id"] for c in payload["archived_cards"]])
    check("archived cards excluded from columns",
          all(aa["id"] != c["id"] for col in payload["columns"] for c in col["cards"]))

    depth = len(mgr._undo_stack)
    check("empty sweep adds no undo entry", mgr.auto_archive(T0) == [] and len(mgr._undo_stack) == depth)
    later = T0 + datetime.timedelta(days=8)
    swept = mgr.auto_archive(later)
    check("timed sweep archives cards past the threshold", [c["id"] for c in swept] == [bb["id"]])
    mgr.undo()
    check("undo restores auto-archived card", mgr.cards[bb["id"]]["archived"] is False)

    mgr.update_card(aa["id"], archived=False)
    check("restoring resets the column clock",
          mgr.cards[aa["id"]]["column_entered"] == T0.isoformat() and mgr.auto_archive(T0) == [])
    mgr.move_card(cc["id"], ecol3)
    check("moving into column resets the clock", mgr.cards[cc["id"]]["column_entered"] == T0.isoformat())
    mgr.update_column(ebid, ecol3, auto_archive_days=0)
    check("0 turns the rule off", mgr.boards[ebid]["columns"][2]["auto_archive_days"] is None)
    check("no sweep with rule off", mgr.auto_archive(T0 + datetime.timedelta(days=365)) == [])

    # ------------------------------------------------------------ colours
    cl = mgr.create_label(ebid, "Custom", "#ABC")
    check("3-digit hex expanded + lowercased", cl["color"] == "#aabbcc")
    mgr.update_label(ebid, cl["id"], color="12Ab9F")
    check("hex without # accepted", mgr.boards[ebid]["label_defs"][-1]["color"] == "#12ab9f")
    check("non-hex label colour rejected",
          raises(lambda: mgr.update_label(ebid, cl["id"], color='red;"><script>')))
    check("bad colour on create rejected", raises(lambda: mgr.create_label(ebid, "x", "rgb(1,2,3)")))
    check("rejected update leaves colour", mgr.boards[ebid]["label_defs"][-1]["color"] == "#12ab9f")
    mgr.update_board(ebid, background="#FF8800")
    check("hex background normalised", mgr.boards[ebid]["background"] == "#ff8800")
    mgr.update_board(ebid, background="linear-gradient(135deg,#667eea,#764ba2)")
    check("gradient background kept", mgr.boards[ebid]["background"].startswith("linear-gradient("))
    title_before = mgr.boards[ebid]["title"]
    check("unsafe background rejected",
          raises(lambda: mgr.update_board(ebid, title="Changed", background="url(javascript:x)")))
    check("rejected background leaves title untouched", mgr.boards[ebid]["title"] == title_before)
    mgr.update_board(ebid, background="")
    check("empty background clears", mgr.boards[ebid]["background"] is None)

    # Older stores get the new fields back-filled on load.
    legacy = data.HakanbanData(FakeHass(), FakeStore())
    legacy._data = {
        "boards": {"b": {"id": "b", "title": "L", "columns": [{"id": "c", "title": "C", "order": 0}],
                         "label_defs": [{"id": "l", "name": "", "color": "x;}</style>"}],
                         "background": "url(evil)", "card_seq": 1}},
        "cards": {"x": {"id": "x", "board_id": "b", "column_id": "c", "order": 0, "number": 1,
                        "title": "Old", "updated": "2026-01-01T00:00:00+00:00"}},
    }
    legacy._normalize()
    lc = legacy.cards["x"]
    check("legacy card normalised",
          lc["card_type"] == "task" and lc["epic_id"] is None
          and lc["column_entered"] == "2026-01-01T00:00:00+00:00")
    check("legacy column normalised",
          legacy.boards["b"]["columns"][0]["auto_archive_days"] is None)
    check("legacy invalid colours sanitised",
          legacy.boards["b"]["label_defs"][0]["color"] == "#838c91"
          and legacy.boards["b"]["background"] is None)

    # ---- done lists: status follows the list
    dh = FakeHass()
    dm = data.HakanbanData(dh, FakeStore())
    db = dm.create_board("Done test", seed=True)
    dbid = db["id"]
    d_todo, d_doing, d_done = (c["id"] for c in db["columns"])
    check("seeded 'Done' list is a done list",
          [c.get("done") for c in db["columns"]] == [False, False, True])
    completed_events = lambda: len([e for e in dh.bus.events if e[0] == "hakanban_card_completed"])
    t1 = dm.create_card(dbid, d_todo, "Task")
    check("new card in open list is open", t1["status"] == "needs_action" and "completed" not in t1)
    n0 = completed_events()
    dm.move_card(t1["id"], d_done)
    check("moving into done list completes + stamps time",
          t1["status"] == "completed" and t1["completed"] == "2026-06-16T12:00:00+00:00"
          and t1["due_complete"] is True)
    check("moving into done list fires completed event", completed_events() == n0 + 1)
    dm.move_card(t1["id"], d_done, position=0)
    check("reordering inside done list doesn't re-fire", completed_events() == n0 + 1)
    dm.move_card(t1["id"], d_doing)
    check("moving out of done list reopens + clears stamp",
          t1["status"] == "needs_action" and "completed" not in t1 and t1["due_complete"] is False)
    dm.update_card(t1["id"], status="completed")
    check("completing elsewhere (HA to-do / service) moves to done list",
          t1["column_id"] == d_done and t1["status"] == "completed")
    dm.update_card(t1["id"], status="needs_action")
    check("reopening moves to the first open list",
          t1["column_id"] == d_todo and t1["status"] == "needs_action")
    dm.update_card(t1["id"], due_complete=True)
    check("legacy due_complete=true completes", t1["column_id"] == d_done and t1["status"] == "completed")
    dm.update_card(t1["id"], title="Renamed", status="completed")
    check("update with unchanged status doesn't move", t1["column_id"] == d_done and t1["title"] == "Renamed")
    t2 = dm.create_card(dbid, d_done, "Born done")
    check("card created in done list starts completed", t2["status"] == "completed" and "completed" in t2)
    t3 = dm.create_card(dbid, d_todo, "Status ignored", status="completed")
    check("status follows list on create", t3["status"] == "needs_action")
    dm.move_card(t3["id"], d_doing)
    dm.update_column(dbid, d_doing, done=True)
    check("flagging a list done completes its cards", t3["status"] == "completed" and "completed" in t3)
    t4 = dm.create_card(dbid, d_todo, "Second done list")
    dm.move_card(t4["id"], d_doing)
    check("second done list also completes", t4["status"] == "completed")
    dm.update_column(dbid, d_done, done=False)
    check("unflagging a done list reopens its cards",
          t1["status"] == "needs_action" and t2["status"] == "needs_action" and t3["status"] == "completed")
    dm.undo()
    check("undo restores done flag + statuses",
          dm._column(dm.boards[dbid], d_done)["done"] is True and dm.cards[t1["id"]]["status"] == "completed")
    renamed = dm.create_column(dbid, "done ")
    check("new list titled 'done' defaults to done", renamed["done"] is True)
    other = dm.create_column(dbid, "Later")
    check("other new lists are not done", other["done"] is False)

    # No done list: status is set directly and nothing moves.
    nb = dm.create_board("Free", seed=False)
    nbid = nb["id"]
    ncol = dm.create_column(nbid, "Stuff")["id"]
    nc = dm.create_card(nbid, ncol, "Free card")
    dm.update_card(nc["id"], status="completed")
    check("board without done list: status set in place",
          nc["column_id"] == ncol and nc["status"] == "completed" and "completed" in nc)

    # Migration: cards already in a "Done" list get completed with their entry time;
    # completed cards elsewhere move into it.
    mig = data.HakanbanData(FakeHass(), FakeStore())
    mig._data = {
        "boards": {"b": {"id": "b", "title": "M", "card_seq": 2, "label_defs": [], "columns": [
            {"id": "o", "title": "To Do", "order": 0},
            {"id": "d", "title": "Done", "order": 1000},
        ]}},
        "cards": {
            "x": {"id": "x", "board_id": "b", "column_id": "d", "order": 0, "number": 1, "title": "In done",
                  "status": "needs_action", "due_complete": True,
                  "column_entered": "2026-05-01T10:00:00+00:00"},
            "y": {"id": "y", "board_id": "b", "column_id": "o", "order": 0, "number": 2, "title": "Ticked",
                  "status": "completed", "completed": "2026-05-02T10:00:00+00:00"},
        },
    }
    mig._normalize()
    check("migration: 'Done' list flagged", mig.boards["b"]["columns"][1]["done"] is True
          and mig.boards["b"]["columns"][0]["done"] is False)
    check("migration: card in Done completed at its entry time",
          mig.cards["x"]["status"] == "completed" and mig.cards["x"]["completed"] == "2026-05-01T10:00:00+00:00")
    check("migration: completed card elsewhere moved into Done, stamp kept",
          mig.cards["y"]["column_id"] == "d" and mig.cards["y"]["completed"] == "2026-05-02T10:00:00+00:00"
          and mig.cards["y"]["order"] > mig.cards["x"]["order"])

    failed = [n for n, ok in RESULTS if not ok]
    print()
    print(f"{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(run())
