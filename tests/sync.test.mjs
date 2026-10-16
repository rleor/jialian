import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { SyncEngine } from "../src/cloud/engine.js";
import { extract, applyRecords, clone } from "../src/cloud/model.js";
const { mutate, requireUser, digest } = createRequire(import.meta.url)(
  "../cloudfunctions/jialian-sync/core.js",
);
const uuid = (() => {
  let n = 0;
  return () => `operation-${++n}`;
})();
const snapshot = () => ({
  privateContent: {
    version: 9,
    weeklyDays: 4,
    days: Array.from({ length: 7 }, () => ({
      title: "休息",
      parts: [],
      kind: "休息",
      minutes: 0,
      sessions: [],
      sets: [],
    })),
  },
});
const workout = (id = "first") => ({
  id,
  title: "肩",
  parts: ["肩"],
  kind: "力量",
  minutes: 15,
  status: "完整完成",
  effort: "",
  sets: [],
});
function fakeStore() {
  const rows = new Map();
  let lock = Promise.resolve();
  return {
    rows,
    transaction(fn) {
      const run = lock.then(async () => {
        const copy = new Map([...rows].map(([k, v]) => [k, clone(v)]));
        const result = await fn({
          get: async (c, id) => copy.get(`${c}:${id}`) || null,
          set: async (c, id, data) => copy.set(`${c}:${id}`, clone(data)),
        });
        rows.clear();
        for (const [k, v] of copy) rows.set(k, v);
        return result;
      });
      lock = run.catch(() => {});
      return run;
    },
  };
}
const op = (key = "workout:2026-10-14:first", id = "operation-first") => ({
  id,
  key,
  type: "workout",
  date: "2026-10-14",
  baseRevision: 0,
  deleted: false,
  data: workout(),
});
function remote(store, uid) {
  return async (event) => {
    if (event.action === "pull") {
      const records = [...store.rows]
        .filter(([k, v]) => k.startsWith("jialian_data:") && v.owner === uid)
        .map(([, v]) => clone(v));
      return { records, nextOffset: null };
    }
    return {
      results: await Promise.all(
        event.operations.map((o) => mutate(store, uid, o)),
      ),
    };
  };
}
function engine(store, uid = "user-a", disk = new Map()) {
  const initial = snapshot(),
    e = new SyncEngine({
      read: (k) => clone(disk.get(k)),
      write: (k, v) => disk.set(k, clone(v)),
      initial,
      guest: () => disk.get("account:guest")?.snapshot,
      remote: remote(store, uid),
      uuid,
    });
  e.schedule = () => {};
  return { e, disk };
}
test("cloud functions refuse guests; owner IDs are isolated", async () => {
  assert.throws(() => requireUser({ uid: "guest", isAnonymous: true }));
  assert.throws(() => requireUser({}));
  const store = fakeStore();
  await mutate(store, "user-a", op());
  assert.equal(
    (await remote(store, "user-b")({ action: "pull" })).records.length,
    0,
  );
  await mutate(store, "user-b", op());
  assert.equal(
    (await remote(store, "user-a")({ action: "pull" })).records.length,
    1,
  );
});
test("same submission retried after lost response is idempotent", async () => {
  const store = fakeStore(),
    request = op();
  const a = await mutate(store, "user-a", request),
    b = await mutate(store, "user-a", request);
  assert.deepEqual(a, b);
  assert.equal(a.revision, 1);
  assert.equal(
    [...store.rows].filter(([k]) => k.startsWith("jialian_data:")).length,
    1,
  );
});
test("tampering with the same mutation ID is refused", async () => {
  const store = fakeStore();
  await mutate(store, "user-a", op());
  await assert.rejects(
    () =>
      mutate(store, "user-a", { ...op(), data: { ...workout(), minutes: 20 } }),
    /提交标识/,
  );
});
test("stale edit does not overwrite another device", async () => {
  const store = fakeStore();
  await mutate(store, "user-a", op());
  const r = await mutate(store, "user-a", op(undefined, "operation-other"));
  assert.equal(r.conflict, true);
  assert.equal(r.remote.data.minutes, 15);
});
test("server validates dates and session fields", async () => {
  const store = fakeStore();
  await assert.rejects(() =>
    mutate(store, "user-a", { ...op(), date: "2026-02-30" }),
  );
  await assert.rejects(() =>
    mutate(store, "user-a", { ...op(), data: { ...workout(), minutes: -5 } }),
  );
  await assert.rejects(() =>
    mutate(store, "user-a", {
      ...op(),
      data: {
        ...workout(),
        sets: [{ exercise: "x", reps: 0, weight: 1, basis: "total" }],
      },
    }),
  );
});
test("offline changes persist and upload once after restart", async () => {
  const store = fakeStore(),
    { e, disk } = engine(store);
  await e.useAccount("user-a");
  const s = snapshot();
  s.privateContent.days[2].sessions = [workout()];
  e.remote = async () => {
    throw Error("offline");
  };
  e.save(s);
  await e.sync();
  assert.equal(e.status, "offline");
  assert.equal(Object.keys(e.meta.pending).length, 1);
  const resumed = engine(store, "user-a", disk).e;
  await resumed.sync();
  assert.equal(Object.keys(resumed.meta.pending).length, 0);
  assert.equal(resumed.status, "synced");
  assert.equal(resumed.snapshot.privateContent.days[2].sessions.length, 1);
});
test("logging into a different account does not upload guest data automatically", async () => {
  const store = fakeStore(),
    { e } = engine(store);
  const s = snapshot();
  s.privateContent.days[2].sessions = [workout()];
  e.save(s);
  await e.useAccount("user-a");
  assert.equal(e.snapshot.privateContent.days[2].sessions.length, 0);
  assert.equal(
    (await remote(store, "user-a")({ action: "pull" })).records.length,
    0,
  );
  e.useGuest();
  assert.equal(e.snapshot.privateContent.days[2].sessions.length, 1);
});
test("explicit guest import preserves sessions and does not duplicate them", async () => {
  const store = fakeStore(),
    { e } = engine(store);
  const s = snapshot();
  s.privateContent.days[2].sessions = [workout()];
  e.save(s);
  await e.useAccount("user-a");
  e.importGuest();
  await e.sync();
  e.importGuest();
  await e.sync();
  assert.equal(e.snapshot.privateContent.days[2].sessions.length, 1);
  assert.equal(Object.keys(e.meta.conflicts).length, 0);
});
test("concurrent sessions from two devices merge", async () => {
  const store = fakeStore(),
    a = engine(store).e,
    b = engine(store).e;
  await a.useAccount("user-a");
  await b.useAccount("user-a");
  const sa = snapshot(),
    sb = snapshot();
  sa.privateContent.days[2].sessions = [workout("first")];
  sb.privateContent.days[2].sessions = [workout("second")];
  a.save(sa);
  b.save(sb);
  await a.sync();
  await b.sync();
  await a.sync();
  assert.equal(a.snapshot.privateContent.days[2].sessions.length, 2);
  assert.equal(a.snapshot.privateContent.days[2].record.minutes, 30);
});
test("conflict keeps local edit until user explicitly chooses cloud version", async () => {
  const store = fakeStore(),
    a = engine(store).e,
    b = engine(store).e;
  await a.useAccount("user-a");
  const sa = snapshot();
  sa.privateContent.days[2].sessions = [workout()];
  a.save(sa);
  await a.sync();
  await b.useAccount("user-a");
  const x = clone(a.snapshot),
    y = clone(b.snapshot);
  x.privateContent.days[2].sessions[0].minutes = 20;
  y.privateContent.days[2].sessions[0].minutes = 25;
  a.save(x);
  b.save(y);
  await a.sync();
  await b.sync();
  assert.equal(b.status, "conflict");
  assert.equal(b.snapshot.privateContent.days[2].sessions[0].minutes, 25);
  const key = Object.keys(b.meta.conflicts)[0];
  b.resolve(key, "remote");
  assert.equal(b.snapshot.privateContent.days[2].sessions[0].minutes, 20);
});
test("deletion is a versioned tombstone and reaches another device", async () => {
  const store = fakeStore(),
    a = engine(store).e,
    b = engine(store).e;
  await a.useAccount("user-a");
  const s = snapshot();
  s.privateContent.days[2].sessions = [workout()];
  a.save(s);
  await a.sync();
  await b.useAccount("user-a");
  const clean = clone(a.snapshot);
  clean.privateContent.days[2].sessions = [];
  a.save(clean);
  await a.sync();
  await b.sync();
  assert.equal(b.snapshot.privateContent.days[2].sessions.length, 0);
  assert.equal(b.snapshot.privateContent.days[2].record, undefined);
});
test("pending local data survives pull and running timer stays local", () => {
  const s = snapshot();
  s.privateContent.timer = { day: 2, status: "running", saved: false };
  s.privateContent.days[2].sets = [{ exercise: "划船" }];
  const docs = extract(s),
    pending = {};
  pending["workout:2026-10-14:first"] = {
    ...op(),
    data: workout(),
    deleted: false,
  };
  const result = applyRecords(s, Object.values(docs), pending);
  assert.equal(result.privateContent.days[2].sessions.length, 1);
  assert.deepEqual(result.privateContent.timer, s.privateContent.timer);
  assert.equal(result.privateContent.days[2].sets.length, 1);
});
test("CloudBase storage adapter uses actual SDK transaction return shape", async () => {
  const { createStore } = createRequire(import.meta.url)(
    "../cloudfunctions/jialian-sync/store.js",
  );
  const db = {
    async runTransaction(fn) {
      return fn({
        collection: () => ({
          doc: () => ({
            get: async () => ({ data: [] }),
            set: async () => ({ updated: 1 }),
          }),
        }),
      });
    },
  };
  const result = await mutate(createStore(db), "user-a", op());
  assert.equal(result.revision, 1);
});
test("navigation and timer ticks do not create network work", async () => {
  const store = fakeStore(),
    { e } = engine(store);
  await e.useAccount("user-a");
  let calls = 0;
  e.schedule = () => calls++;
  const s = clone(e.snapshot);
  s.privateContent.page = "day";
  s.privateContent.timer = { day: 2, status: "running", activeMs: 4000 };
  e.save(s);
  assert.equal(calls, 0);
  assert.equal(e.status, "synced");
  assert.equal(Object.keys(e.meta.pending).length, 0);
});
