import test from "node:test";
import assert from "node:assert/strict";
import { createAdapter } from "../src/cloud/adapter.js";
function storage() {
  const map = new Map();
  return {
    getItem: (key) => map.get(key) || null,
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
    map,
  };
}
const response = (status, data) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => data,
});
test("only HTTPS and local development addresses are accepted", () => {
  assert.equal(createAdapter({}), null);
  assert.throws(() => createAdapter({ apiBaseUrl: "http://example.com" }));
  assert.ok(
    createAdapter(
      { apiBaseUrl: "http://localhost:3000" },
      { storage: storage() },
    ),
  );
});
test("self-hosted login stores only token/user and sends bearer on sync", async () => {
  const disk = storage(),
    calls = [];
  const a = createAdapter(
    { apiBaseUrl: "https://api.example.com" },
    {
      storage: disk,
      fetchFn: async (url, options) => {
        calls.push({ url, options });
        return url.endsWith("/login")
          ? response(200, {
              ok: true,
              user: { id: "user-one", username: "alice" },
              session: { accessToken: "token-one" },
            })
          : response(200, { ok: true, records: [], nextOffset: null });
      },
    },
  );
  await a.login("alice", "private-password");
  assert.ok(![...disk.map.values()].join("").includes("private-password"));
  await a.remote({ action: "pull", offset: 0 });
  assert.equal(calls[1].options.headers.Authorization, "Bearer token-one");
  assert.equal(calls[1].url, "https://api.example.com/v1/sync");
});
test("expired sessions clear client auth; network failures keep it for retry", async () => {
  const disk = storage();
  let mode = "login";
  const a = createAdapter(
    { apiBaseUrl: "https://api.example.com" },
    {
      storage: disk,
      fetchFn: async () => {
        if (mode === "network") throw Error("offline");
        if (mode === "expired")
          return response(401, { ok: false, message: "expired" });
        return response(200, {
          ok: true,
          user: { id: "one" },
          session: { accessToken: "token" },
        });
      },
    },
  );
  await a.login("alice", "password123");
  mode = "network";
  await assert.rejects(() => a.session());
  assert.equal(disk.map.size, 1);
  mode = "expired";
  assert.equal(await a.session(), null);
  assert.equal(disk.map.size, 0);
});
test("registration sends optional invite code and stores no password", async () => {
  let payload;
  const disk = storage(),
    a = createAdapter(
      { apiBaseUrl: "https://api.example.com" },
      {
        storage: disk,
        fetchFn: async (url, options) => {
          payload = JSON.parse(options.body);
          return response(200, {
            ok: true,
            user: { id: "one" },
            session: { accessToken: "token" },
          });
        },
      },
    );
  await a.register("alice", "password123", "invitation");
  assert.equal(payload.inviteCode, "invitation");
  assert.equal(payload.username, "alice");
  assert.ok(![...disk.map.values()].join("").includes("password123"));
});
test("bodyless logout does not send an empty JSON body and clears local credentials", async () => {
  const disk = storage(),
    calls = [];
  const a = createAdapter(
    { apiBaseUrl: "https://api.example.com" },
    {
      storage: disk,
      fetchFn: async (url, options) => {
        calls.push({ url, options });
        return url.endsWith("/login")
          ? response(200, {
              ok: true,
              user: { id: "one" },
              session: { accessToken: "token" },
            })
          : response(200, { ok: true });
      },
    },
  );
  await a.login("alice", "password123");
  await a.logout();
  assert.equal(calls[1].options.headers["Content-Type"], undefined);
  assert.equal(disk.map.size, 0);
});
