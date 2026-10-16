import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { PGlite } from "@electric-sql/pglite";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/migrate.js";
let pool, app, embedded;
before(async () => {
  if (process.env.TEST_DATABASE_URL) {
    const url = new URL(process.env.TEST_DATABASE_URL);
    assert.equal(
      url.pathname,
      "/jialian_test",
      "Integration tests require a dedicated jialian_test database",
    );
    pool = new pg.Pool({ connectionString: url.href });
  } else {
    embedded = new PGlite();
    let lock = Promise.resolve();
    const acquire = async () => {
      let release;
      const next = new Promise((r) => (release = r)),
        previous = lock;
      lock = next;
      await previous;
      return release;
    };
    pool = {
      async query(sql, params) {
        const release = await acquire();
        try {
          return params
            ? await embedded.query(sql, params)
            : { rows: await embedded.exec(sql) };
        } finally {
          release();
        }
      },
      async connect() {
        const release = await acquire();
        return {
          query: (sql, params) =>
            params
              ? embedded.query(sql, params)
              : embedded.exec(sql).then((r) => r.at(-1)),
          release,
        };
      },
    };
  }
  await migrate(pool);
  await migrate(pool);
  await pool.query("TRUNCATE sync_mutations,sync_records,auth_sessions,users");
  app = await buildApp({ pool, rateLimits: false });
  await app.ready();
});
after(async () => {
  await app?.close();
  if (embedded) await embedded.close();
  else await pool?.end();
});
const request = (method, url, payload, token) =>
  app.inject({
    method,
    url,
    ...(payload ? { payload } : {}),
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
async function register(name) {
  const res = await request("POST", "/v1/auth/register", {
    username: name,
    password: "password123",
  });
  assert.equal(res.statusCode, 200, res.body);
  return res.json();
}
const op = (
  id = "mutation-first",
  key = "workout:2026-10-14:record-first",
) => ({
  id,
  key,
  type: "workout",
  date: "2026-10-14",
  baseRevision: 0,
  deleted: false,
  data: {
    id: "record-first",
    title: "肩",
    parts: ["肩"],
    kind: "力量",
    minutes: 15,
    status: "完整完成",
    effort: "",
    sets: [],
  },
});
test("health and repeatable migrations", async () => {
  assert.equal((await request("GET", "/health")).statusCode, 200);
});
test("registration normalizes usernames, hashes passwords and tokens, rejects duplicates", async () => {
  const account = await register("Alice");
  assert.equal(account.user.username, "alice");
  const stored = await pool.query(
    "SELECT password_hash FROM users WHERE id=$1",
    [account.user.id],
  );
  assert.match(stored.rows[0].password_hash, /^scrypt:/);
  assert.ok(!stored.rows[0].password_hash.includes("password123"));
  const tokens = await pool.query(
    "SELECT token_hash FROM auth_sessions WHERE user_id=$1",
    [account.user.id],
  );
  assert.notEqual(tokens.rows[0].token_hash, account.session.accessToken);
  assert.equal(
    (
      await request("POST", "/v1/auth/register", {
        username: "ALICE",
        password: "otherpassword",
      })
    ).statusCode,
    409,
  );
});
test("login errors do not reveal whether a username exists", async () => {
  const a = await request("POST", "/v1/auth/login", {
      username: "alice",
      password: "wrongpassword",
    }),
    b = await request("POST", "/v1/auth/login", {
      username: "unknown",
      password: "wrongpassword",
    });
  assert.equal(a.statusCode, 401);
  assert.deepEqual(a.json(), b.json());
});
test("unauthenticated sync, export and me are rejected", async () => {
  for (const [method, url, body] of [
    ["POST", "/v1/sync", { action: "pull" }],
    ["GET", "/v1/export"],
    ["GET", "/v1/auth/me"],
  ])
    assert.equal((await request(method, url, body)).statusCode, 401);
});
test("session me never returns password hashes or tokens", async () => {
  const a = await register("sessionuser");
  const res = await request("GET", "/v1/auth/me", null, a.session.accessToken);
  assert.deepEqual(Object.keys(res.json().user).sort(), ["id", "username"]);
});
test("sync owner is derived from bearer session; users cannot read each other", async () => {
  const a = await register("ownerone"),
    b = await register("ownertwo");
  const pushed = await request(
    "POST",
    "/v1/sync",
    { action: "push", operations: [op()], owner: b.user.id },
    a.session.accessToken,
  );
  assert.equal(pushed.statusCode, 200);
  const pull = await request(
    "POST",
    "/v1/sync",
    { action: "pull" },
    b.session.accessToken,
  );
  assert.equal(pull.json().records.length, 0);
});
test("duplicate submissions and concurrent same-record edits use database transactions", async () => {
  const a = await register("concurrent"),
    token = a.session.accessToken;
  const submit = (operation) =>
    request(
      "POST",
      "/v1/sync",
      { action: "push", operations: [operation] },
      token,
    );
  const [one, two] = await Promise.all([submit(op()), submit(op())]);
  assert.deepEqual(one.json(), two.json());
  const update = {
    ...op("mutation-update"),
    baseRevision: 1,
    data: { ...op().data, minutes: 20 },
  };
  const stale = {
    ...update,
    id: "mutation-stale",
    data: { ...op().data, minutes: 25 },
  };
  const results = await Promise.all([submit(update), submit(stale)]);
  assert.equal(results.filter((r) => r.json().results[0].conflict).length, 1);
  const records = (
    await request("POST", "/v1/sync", { action: "pull" }, token)
  ).json().records;
  assert.equal(records.length, 1);
  assert.equal(records[0].revision, 2);
});
test("reused mutation ID with altered payload is rejected", async () => {
  const a = await register("tamperuser");
  await request(
    "POST",
    "/v1/sync",
    { action: "push", operations: [op()] },
    a.session.accessToken,
  );
  const r = await request(
    "POST",
    "/v1/sync",
    {
      action: "push",
      operations: [{ ...op(), data: { ...op().data, minutes: 30 } }],
    },
    a.session.accessToken,
  );
  assert.equal(r.statusCode, 409);
});
test("invalid sync data is rejected before any write", async () => {
  const a = await register("invaliduser");
  const r = await request(
    "POST",
    "/v1/sync",
    {
      action: "push",
      operations: [op(), { ...op("mutation-invalid"), date: "2026-02-30" }],
    },
    a.session.accessToken,
  );
  assert.equal(r.statusCode, 400);
  assert.equal(
    (
      await request(
        "POST",
        "/v1/sync",
        { action: "pull" },
        a.session.accessToken,
      )
    ).json().records.length,
    0,
  );
});
test("password change revokes other sessions; logout revokes current session", async () => {
  const a = await register("passworduser");
  const second = (
    await request("POST", "/v1/auth/login", {
      username: "passworduser",
      password: "password123",
    })
  ).json();
  assert.equal(
    (
      await request(
        "POST",
        "/v1/auth/password",
        { oldPassword: "password123", newPassword: "newpassword123" },
        a.session.accessToken,
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (await request("GET", "/v1/auth/me", null, second.session.accessToken))
      .statusCode,
    401,
  );
  assert.equal(
    (
      await request("POST", "/v1/auth/login", {
        username: "passworduser",
        password: "password123",
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (await request("POST", "/v1/auth/logout", null, a.session.accessToken))
      .statusCode,
    200,
  );
  assert.equal(
    (await request("GET", "/v1/auth/me", null, a.session.accessToken))
      .statusCode,
    401,
  );
});
test("expired sessions cannot access user data", async () => {
  const a = await register("expireuser");
  await pool.query(
    "UPDATE auth_sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1",
    [a.user.id],
  );
  assert.equal(
    (await request("GET", "/v1/auth/me", null, a.session.accessToken))
      .statusCode,
    401,
  );
});
test("account deletion cascades records and sessions; export is per-user", async () => {
  const a = await register("deleteuser"),
    token = a.session.accessToken;
  await request(
    "POST",
    "/v1/sync",
    { action: "push", operations: [op()] },
    token,
  );
  const exported = (await request("GET", "/v1/export", null, token)).json();
  assert.equal(exported.records.length, 1);
  assert.ok(!JSON.stringify(exported).includes("password_hash"));
  assert.equal(
    (
      await request(
        "POST",
        "/v1/account/delete",
        { password: "wrongpassword" },
        token,
      )
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await request(
        "POST",
        "/v1/account/delete",
        { password: "password123" },
        token,
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (await pool.query("SELECT * FROM sync_records WHERE owner=$1", [a.user.id]))
      .rows.length,
    0,
  );
  assert.equal(
    (await request("GET", "/v1/auth/me", null, token)).statusCode,
    401,
  );
});
test("private testing can require invite code or disable registration", async () => {
  const privateApp = await buildApp({
    pool,
    rateLimits: false,
    inviteCode: "test-invite",
  });
  const denied = await privateApp.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { username: "inviteuser", password: "password123" },
  });
  assert.equal(denied.statusCode, 403);
  await privateApp.close();
  const disabled = await buildApp({
    pool,
    rateLimits: false,
    registrationEnabled: false,
  });
  assert.equal(
    (
      await disabled.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { username: "disableduser", password: "password123" },
      })
    ).statusCode,
    403,
  );
  await disabled.close();
});
test("auth endpoints are rate-limited and CORS only allows configured origins", async () => {
  const limited = await buildApp({ pool, rateLimits: true });
  for (let i = 0; i < 20; i++)
    assert.equal(
      (
        await limited.inject({
          method: "POST",
          url: "/v1/auth/login",
          payload: { username: "unknown", password: "wrongpassword" },
        })
      ).statusCode,
      401,
    );
  assert.equal(
    (
      await limited.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: { username: "unknown", password: "wrongpassword" },
      })
    ).statusCode,
    429,
  );
  const good = await limited.inject({
      url: "/health",
      headers: { origin: "https://localhost" },
    }),
    bad = await limited.inject({
      url: "/health",
      headers: { origin: "https://evil.example" },
    });
  assert.equal(
    good.headers["access-control-allow-origin"],
    "https://localhost",
  );
  assert.equal(bad.headers["access-control-allow-origin"], undefined);
  await limited.close();
});
