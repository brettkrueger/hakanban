// A tiny in-browser mock of the Home Assistant websocket connection that emulates
// the hakanban/* backend, so we can smoke-test the real frontend modules without HA.

function uid() {
  uid.n = (uid.n || 0) + 1;
  return "id" + uid.n;
}

function makeSeed() {
  const board = {
    id: "b1",
    title: "Demo Board",
    background: "#0079bf",
    archived: false,
    labels: [
      { id: "green", name: "", color: "#61bd4f" },
      { id: "red", name: "Bug", color: "#eb5a46" },
      { id: "blue", name: "", color: "#0079bf" },
    ],
    columns: [
      { id: "c1", title: "To Do", order: 0, archived: false, cards: [] },
      { id: "c2", title: "Doing", order: 1000, archived: false, cards: [] },
      { id: "c3", title: "Done", order: 2000, archived: false, done: true, cards: [] },
    ],
  };
  let n = 0;
  const mk = (col, title, extra = {}) => ({
    id: uid(),
    board_id: "b1",
    column_id: col,
    order: 0,
    number: ++n,
    card_type: extra.card_type || "task",
    epic_id: extra.epic_id || null,
    title,
    description: extra.description || "",
    labels: extra.labels || [],
    assignees: [],
    due: extra.due || null,
    due_complete: false,
    status: extra.status || "needs_action",
    checklists: [],
    comments: [],
    cover: null,
    archived: !!extra.archived,
    updated: "2026-06-15T10:00:00",
  });
  const epic = mk("c2", "Kitchen renovation", { card_type: "epic", labels: ["blue"] });
  board.columns[0].cards = [
    mk("c1", "Buy milk", { labels: ["green"] }),
    mk("c1", "Walk the dog", { due: "2026-06-10T09:00:00", labels: ["red"] }),
    mk("c1", "Pick tiles", { epic_id: epic.id, labels: ["green", "red"] }),
  ];
  board.columns[1].cards = [epic, mk("c2", "Write the report", { description: "**Important** task" })];
  board.columns[2].cards = [
    mk("c3", "Ship it", { status: "completed" }),
    mk("c3", "Remove old cabinets", { status: "completed", epic_id: epic.id }),
    mk("c3", "Old archived thing", { status: "completed", archived: true }),
  ];
  // normalise order; cards in the done list are completed (like the real migration)
  board.columns.forEach((col) => col.cards.forEach((cd, i) => {
    cd.order = i * 1000;
    if (col.done) { cd.status = "completed"; cd.completed = "2026-11-14T18:30:00Z"; }
  }));
  return { boards: [board] };
}

const state = makeSeed();
const subscribers = new Set();

function findBoard(id) {
  return state.boards.find((b) => b.id === id);
}
function allCards() {
  const out = [];
  state.boards.forEach((b) => b.columns.forEach((c) => c.cards.forEach((cd) => out.push([b, c, cd]))));
  return out;
}
function findCard(id) {
  return allCards().find(([, , cd]) => cd.id === id);
}
// Mirror HakanbanData.full_payload(): archived cards leave the columns and are listed
// per board under archived_cards.
function payload() {
  const p = JSON.parse(JSON.stringify(state));
  p.boards.forEach((b) => {
    b.archived_cards = [];
    b.columns.forEach((c) => {
      b.archived_cards.push(...c.cards.filter((cd) => cd.archived));
      c.cards = c.cards.filter((cd) => !cd.archived);
    });
  });
  p.can_undo = false;
  p.can_redo = false;
  return p;
}
function notify() {
  const p = payload();
  subscribers.forEach((cb) => cb(p));
}
function reindex(cards) {
  cards.forEach((c, i) => (c.order = i * 1000));
}
// Mirror HakanbanData's done lists: status follows the list on boards that have one.
function setCompletion(card, done) {
  const was = card.status === "completed";
  card.due_complete = done;
  if (done && !was) { card.status = "completed"; card.completed = new Date().toISOString(); }
  if (!done && was) { card.status = "needs_action"; delete card.completed; }
}
function doneCols(board) {
  return board.columns.filter((c) => c.done && !c.archived);
}
function syncCard(board, card) {
  if (!doneCols(board).length) return;
  setCompletion(card, !!board.columns.find((c) => c.id === card.column_id)?.done);
}

const handlers = {
  get: () => payload(),
  create_board: ({ title }) => {
    const b = { id: uid(), title, background: null, archived: false, labels: [], columns: [] };
    state.boards.push(b);
    return b;
  },
  update_board: ({ board_id, title, background, archived }) => {
    const b = findBoard(board_id);
    if (title != null) b.title = title;
    if (background !== undefined) b.background = background;
    if (archived != null) b.archived = archived;
    return b;
  },
  delete_board: ({ board_id }) => {
    state.boards = state.boards.filter((b) => b.id !== board_id);
    return { deleted: board_id };
  },
  create_column: ({ board_id, title }) => {
    const b = findBoard(board_id);
    const col = { id: uid(), title, order: b.columns.length * 1000, archived: false, cards: [] };
    b.columns.push(col);
    return col;
  },
  update_column: ({ board_id, column_id, title, auto_archive_days, done }) => {
    const board = findBoard(board_id);
    const col = board.columns.find((c) => c.id === column_id);
    if (title != null) col.title = title;
    if (done !== undefined) {
      col.done = done;
      board.columns.forEach((c) => c.cards.forEach((cd) => !cd.archived && syncCard(board, cd)));
    }
    if (auto_archive_days !== undefined) col.auto_archive_days = auto_archive_days || null;
    return col;
  },
  delete_column: ({ board_id, column_id }) => {
    const b = findBoard(board_id);
    b.columns = b.columns.filter((c) => c.id !== column_id);
    return { deleted: column_id };
  },
  move_column: ({ board_id, column_id, position }) => {
    const b = findBoard(board_id);
    const idx = b.columns.findIndex((c) => c.id === column_id);
    const [col] = b.columns.splice(idx, 1);
    b.columns.splice(position, 0, col);
    b.columns.forEach((c, i) => (c.order = i * 1000));
    return { ok: true };
  },
  create_card: ({ board_id, column_id, title, description, labels, due, card_type, epic_id }) => {
    const b = findBoard(board_id);
    const col = b.columns.find((c) => c.id === column_id);
    const card = {
      id: uid(), board_id, column_id, order: col.cards.length * 1000,
      number: allCards().length + 1, card_type: card_type || "task", epic_id: epic_id || null,
      title, description: description || "",
      labels: labels || [], assignees: [], due: due || null, due_complete: false,
      status: "needs_action", checklists: [], comments: [], cover: null, archived: false,
    };
    col.cards.push(card);
    syncCard(b, card);
    return card;
  },
  paste_cards: ({ board_id, column_id, titles }) => {
    const cards = (titles || []).map((t) => handlers.create_card({ board_id, column_id, title: t }));
    return { cards };
  },
  update_card: ({ card_id, status, due_complete, ...fields }) => {
    const [board, col, card] = findCard(card_id);
    Object.assign(card, fields);
    if (status !== undefined) {
      const dc = doneCols(board);
      if (!dc.length) setCompletion(card, status === "completed");
      else if ((status === "completed") !== !!col.done) {
        const target = status === "completed" ? dc[0] : board.columns.find((c) => !c.done && !c.archived);
        if (target) {
          col.cards = col.cards.filter((c) => c.id !== card_id);
          target.cards.push(card);
          card.column_id = target.id;
          reindex(target.cards);
        }
        syncCard(board, card);
      }
    }
    if (fields.card_type === "task") allCards().forEach(([, , c]) => { if (c.epic_id === card_id) c.epic_id = null; });
    if (fields.card_type === "epic") card.epic_id = null;
    return card;
  },
  move_card: ({ card_id, to_column, position }) => {
    const found = findCard(card_id);
    const [board, fromCol, card] = found;
    fromCol.cards = fromCol.cards.filter((c) => c.id !== card_id);
    const toCol = board.columns.find((c) => c.id === to_column);
    const pos = position == null ? toCol.cards.length : position;
    toCol.cards.splice(pos, 0, card);
    card.column_id = to_column;
    reindex(toCol.cards);
    syncCard(board, card);
    return card;
  },
  delete_card: ({ card_id }) => {
    const [, col] = findCard(card_id);
    col.cards = col.cards.filter((c) => c.id !== card_id);
    return { deleted: card_id };
  },
  create_label: ({ board_id, name, color }) => {
    const b = findBoard(board_id);
    const l = { id: uid(), name, color };
    b.labels.push(l);
    return l;
  },
  update_label: ({ board_id, label_id, name, color }) => {
    const l = findBoard(board_id).labels.find((x) => x.id === label_id);
    if (name != null) l.name = name;
    if (color != null) l.color = color;
    return l;
  },
  delete_label: ({ board_id, label_id }) => {
    const b = findBoard(board_id);
    b.labels = b.labels.filter((l) => l.id !== label_id);
    allCards().forEach(([, , c]) => { c.labels = c.labels.filter((l) => l !== label_id); });
    return { deleted: label_id };
  },
  add_comment: ({ card_id, text }) => {
    const [, , card] = findCard(card_id);
    const cm = { id: uid(), author: "Tester", ts: "2026-06-16T12:00:00", text };
    card.comments.push(cm);
    return cm;
  },
  add_checklist: ({ card_id, title }) => {
    const [, , card] = findCard(card_id);
    const cl = { id: uid(), title, items: [] };
    card.checklists.push(cl);
    return cl;
  },
  add_check_item: ({ card_id, checklist_id, text }) => {
    const [, , card] = findCard(card_id);
    const cl = card.checklists.find((x) => x.id === checklist_id);
    const it = { id: uid(), text, done: false };
    cl.items.push(it);
    return it;
  },
  toggle_check_item: ({ card_id, checklist_id, item_id, done }) => {
    const [, , card] = findCard(card_id);
    const cl = card.checklists.find((x) => x.id === checklist_id);
    cl.items.find((i) => i.id === item_id).done = done;
    return { ok: true };
  },
};

window.__hkLog = [];

window.__mockHass = {
  connection: {
    sendMessagePromise(msg) {
      const cmd = msg.type.replace("hakanban/", "");
      window.__hkLog.push(cmd);
      const handler = handlers[cmd];
      if (!handler) return Promise.reject(new Error("unknown " + msg.type));
      const result = handler(msg);
      // Real HA pushes the subscription event *before* the command result (the
      // dispatcher fires synchronously inside the handler), so do the same here.
      notify();
      return Promise.resolve(result);
    },
    subscribeMessage(cb, msg) {
      if (msg.type === "hakanban/subscribe") {
        subscribers.add(cb);
        Promise.resolve().then(() => cb(payload()));
        return Promise.resolve(() => subscribers.delete(cb));
      }
      return Promise.resolve(() => {});
    },
  },
  states: {},
  themes: {},
};
