import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createFamilySync } from "../src/lib/family-sync.js";
import { createEmptyData } from "../src/lib/demo.js";

const copies = [];
afterEach(() => {
  for (const sync of copies.splice(0)) sync.destroy();
});
const clone = (value) => structuredClone(value);
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
function database(data = createEmptyData()) {
  let row = { data: clone(data), revision: 1 };
  const writes = [];
  return {
    writes,
    get row() { return clone(row); },
    replace(data) { row = { data: clone(data), revision: row.revision + 1 }; },
    async readPlan() { return clone(row); },
    async updatePlan(data, revision) {
      writes.push({ data: clone(data), revision });
      if (revision !== row.revision) return null;
      row = { data: clone(data), revision: revision + 1 };
      return clone(row);
    },
  };
}
function mount(client, options = {}) {
  let displayed = client.row.data;
  const statuses = [];
  const sync = createFamilySync({
    client,
    initialData: displayed,
    initialRevision: client.row.revision,
    delay: 100000,
    pollInterval: 0,
    onData(data) { displayed = data; },
    onStatus(status) { statuses.push(status); },
    ...options,
  });
  displayed = sync.data;
  copies.push(sync);
  return {
    sync,
    statuses,
    get displayed() { return clone(displayed); },
    edit(change) {
      const next = clone(displayed);
      change(next);
      displayed = next;
      sync.save(next);
    },
  };
}
function supplier(id, name, price = 1000) {
  return { id, name, categoryId: "local", price, phone: "", favorite: false, rating: 0, notes: "" };
}
function guest(id, name) {
  return { id, name, phone: "", partySize: 1, status: "pending", notes: "" };
}

test("two relatives preserve independent records and changes to different fields", async () => {
  const initial = createEmptyData();
  initial.suppliers.push(supplier("venue", "Local"));
  const db = database(initial);
  const first = mount(db);
  const second = mount(db);
  first.edit((data) => {
    data.wedding.budget = 20000;
    data.suppliers[0].price = 3000;
    data.guestsList.push(guest("alice", "Alice"));
  });
  second.edit((data) => {
    data.wedding.guests = 80;
    data.suppliers[0].phone = "11999999999";
    data.guestsList.push(guest("bruno", "Bruno"));
  });
  assert.equal(await first.sync.flush(), true);
  assert.equal(await second.sync.flush(), true);
  assert.equal(db.row.data.wedding.budget, 20000);
  assert.equal(db.row.data.wedding.guests, 80);
  assert.equal(db.row.data.suppliers[0].price, 3000);
  assert.equal(db.row.data.suppliers[0].phone, "11999999999");
  assert.deepEqual(db.row.data.guestsList.map((person) => person.id), ["alice", "bruno"]);
  assert.equal(first.sync.pending, false);
  assert.equal(second.sync.pending, false);
  await first.sync.flush();
  assert.deepEqual(first.displayed, db.row.data);
  assert.equal(db.writes.length, 2, "refreshing must not write the received data back");
});

test("a revision conflict rereads the latest row before retrying", async () => {
  const db = database();
  const write = db.updatePlan.bind(db);
  let conflict = true;
  db.updatePlan = async (data, revision) => {
    if (conflict) {
      conflict = false;
      const newer = db.row.data;
      newer.wedding.guests = 60;
      db.replace(newer);
      return null;
    }
    return write(data, revision);
  };
  const device = mount(db);
  device.edit((data) => { data.wedding.budget = 15000; });
  assert.equal(await device.sync.flush(), true);
  assert.equal(db.row.data.wedding.guests, 60);
  assert.equal(db.row.data.wedding.budget, 15000);
  assert.equal(device.sync.revision, 3);
  assert.equal(device.sync.pending, false);
});

test("failed saves remain pending and retry includes later family changes", async () => {
  const db = database();
  const write = db.updatePlan.bind(db);
  db.updatePlan = async () => { throw new Error("offline"); };
  const device = mount(db);
  device.edit((data) => { data.wedding.budget = 45000; });
  assert.equal(await device.sync.flush(), false);
  assert.equal(device.sync.pending, true);
  assert.equal(device.statuses.at(-1).state, "error");
  assert.equal(db.row.data.wedding.budget, 0);
  const newer = db.row.data;
  newer.guestsList.push(guest("carlos", "Carlos"));
  db.replace(newer);
  db.updatePlan = write;
  assert.equal(await device.sync.retry(), true);
  assert.equal(device.sync.pending, false);
  assert.equal(db.row.data.wedding.budget, 45000);
  assert.equal(device.displayed.guestsList[0].name, "Carlos");
  assert.equal(device.statuses.at(-1).state, "saved");
});

test("local edits during an in-flight save survive the acknowledgement", async () => {
  const db = database();
  const write = db.updatePlan.bind(db);
  const started = deferred();
  const release = deferred();
  let first = true;
  db.updatePlan = async (data, revision) => {
    if (first) {
      first = false;
      started.resolve();
      await release.promise;
    }
    return write(data, revision);
  };
  const device = mount(db);
  device.edit((data) => { data.wedding.budget = 10000; });
  const saving = device.sync.flush();
  await started.promise;
  device.edit((data) => {
    data.wedding.budget = 12000;
    data.guestsList.push(guest("daniela", "Daniela"));
  });
  release.resolve();
  assert.equal(await saving, true);
  assert.equal(db.writes.length, 2);
  assert.equal(db.row.data.wedding.budget, 12000);
  assert.equal(db.row.data.guestsList[0].name, "Daniela");
  assert.equal(device.sync.pending, false);
});

test("edits arriving during a read-only poll are merged and saved", async () => {
  const db = database();
  const read = db.readPlan.bind(db);
  const started = deferred();
  const release = deferred();
  let first = true;
  db.readPlan = async () => {
    if (first) {
      first = false;
      started.resolve();
      await release.promise;
    }
    return read();
  };
  const device = mount(db);
  const refreshing = device.sync.flush();
  await started.promise;
  device.edit((data) => { data.wedding.budget = 17000; });
  const newer = db.row.data;
  newer.wedding.guests = 90;
  db.replace(newer);
  release.resolve();
  assert.equal(await refreshing, true);
  assert.equal(db.row.data.wedding.budget, 17000);
  assert.equal(db.row.data.wedding.guests, 90);
  assert.equal(device.sync.pending, false);
});

test("poll receives family changes without a save feedback loop", async () => {
  const db = database();
  const received = deferred();
  let changes = 0;
  const device = mount(db, {
    pollInterval: 5,
    onData(data) {
      changes++;
      assert.equal(data.wedding.budget, 19000);
      received.resolve();
    },
  });
  const newer = db.row.data;
  newer.wedding.budget = 19000;
  db.replace(newer);
  await received.promise;
  device.sync.destroy();
  assert.equal(changes, 1);
  assert.equal(db.writes.length, 0);
  assert.equal(device.sync.pending, false);
});

test("local deletions do not remove newly added remote records", async () => {
  const initial = createEmptyData();
  initial.suppliers.push(supplier("old", "Anterior"));
  const db = database(initial);
  const device = mount(db);
  device.edit((data) => { data.suppliers = []; });
  const newer = db.row.data;
  newer.suppliers.push(supplier("new", "Novo"));
  db.replace(newer);
  assert.equal(await device.sync.flush(), true);
  assert.deepEqual(db.row.data.suppliers.map((item) => item.id), ["new"]);
});

test("failed reads never save an empty replacement", async () => {
  const db = database();
  db.readPlan = async () => { throw new Error("offline"); };
  const device = mount(db);
  device.edit((data) => { data.wedding.budget = 30000; });
  assert.equal(await device.sync.flush(), false);
  assert.equal(db.writes.length, 0);
  assert.equal(device.sync.pending, true);
  db.readPlan = async () => null;
  assert.equal(await device.sync.retry(), false);
  assert.equal(db.writes.length, 0);
});

test("destroy ignores an in-flight response and cancels all future work", async () => {
  const db = database();
  const read = deferred();
  db.readPlan = () => read.promise;
  const device = mount(db);
  const flushing = device.sync.flush();
  device.sync.destroy();
  const changed = db.row;
  changed.data.wedding.budget = 99000;
  read.resolve(changed);
  assert.equal(await flushing, false);
  assert.equal(device.displayed.wedding.budget, 0);
  assert.equal(await device.sync.retry(), false);
  assert.equal(db.writes.length, 0);
});

function journalStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
}

test("pending edits survive reload and merge with newer family data", async () => {
  const db = database();
  const storage = journalStorage();
  const storageKey = "family-project-user-pending";
  const first = mount(db, { storage, storageKey });
  first.edit((data) => {
    data.wedding.budget = 28000;
    data.guestsList.push(guest("elisa", "Elisa"));
  });
  const read = db.readPlan.bind(db);
  db.readPlan = async () => { throw new Error("offline"); };
  assert.equal(await first.sync.flush(), false);
  const saved = JSON.parse(storage.getItem(storageKey));
  assert.equal(saved.version, 1);
  assert.equal(saved.baseline.wedding.budget, 0);
  assert.equal(saved.desired.wedding.budget, 28000);
  first.sync.destroy();
  assert.ok(storage.getItem(storageKey), "destroy must preserve unsent edits");

  const newer = db.row.data;
  newer.wedding.guests = 120;
  newer.guestsList.push(guest("fabio", "Fábio"));
  db.replace(newer);
  db.readPlan = read;
  const recovered = mount(db, { storage, storageKey });
  assert.equal(recovered.sync.pending, true);
  assert.equal(recovered.displayed.wedding.budget, 28000);
  assert.equal(recovered.displayed.wedding.guests, 120);
  assert.deepEqual(recovered.displayed.guestsList.map((item) => item.id), ["fabio", "elisa"]);
  assert.equal(recovered.sync.revision, 2, "recovery uses the freshly read revision");
  assert.equal(await recovered.sync.flush(), true);
  assert.equal(db.row.data.wedding.budget, 28000);
  assert.equal(db.row.data.wedding.guests, 120);
  assert.equal(storage.getItem(storageKey), null, "acknowledged data needs no pending journal");
  assert.equal(recovered.sync.pending, false);
});

test("recovered pending data automatically flushes without another edit", async () => {
  const db = database();
  const storage = journalStorage();
  const storageKey = "recovery";
  const desired = db.row.data;
  desired.wedding.budget = 21000;
  storage.setItem(storageKey, JSON.stringify({
    version: 1,
    baseline: db.row.data,
    desired,
    revision: 1,
  }));
  const saved = deferred();
  const recovered = mount(db, {
    storage,
    storageKey,
    delay: 0,
    onStatus(status) {
      if (status.state === "saved") saved.resolve();
    },
  });
  await saved.promise;
  assert.equal(db.row.data.wedding.budget, 21000);
  assert.equal(recovered.sync.pending, false);
  assert.equal(storage.getItem(storageKey), null);
});

test("malformed journals are ignored and cannot replace valid server data", () => {
  const db = database();
  const storage = journalStorage();
  for (const malformed of [
    "{broken",
    JSON.stringify({ version: 1, revision: 1, baseline: {}, desired: {} }),
    JSON.stringify({ version: 2, revision: 1, baseline: db.row.data, desired: db.row.data }),
    JSON.stringify({ version: 1, revision: -1, baseline: db.row.data, desired: db.row.data }),
  ]) {
    storage.setItem("broken", malformed);
    const device = mount(db, { storage, storageKey: "broken" });
    assert.equal(device.sync.pending, false);
    assert.deepEqual(device.displayed, db.row.data);
  }
});

test("journal failure still permits a network save and reports memory-only pending data", async () => {
  const db = database();
  const storage = {
    getItem() { throw new Error("storage blocked"); },
    setItem() { throw new Error("storage blocked"); },
    removeItem() { throw new Error("storage blocked"); },
  };
  const device = mount(db, { storage, storageKey: "blocked" });
  device.edit((data) => { data.wedding.budget = 32000; });
  assert.equal(device.statuses.at(-1).state, "error");
  const read = db.readPlan.bind(db);
  db.readPlan = async () => { throw new Error("offline"); };
  assert.equal(await device.sync.flush(), false);
  assert.match(device.statuses.at(-1).message, /apenas na memória/);
  db.readPlan = read;
  assert.equal(await device.sync.retry(), true);
  assert.equal(db.row.data.wedding.budget, 32000);
  assert.equal(device.sync.pending, false);
});
