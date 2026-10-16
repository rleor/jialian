import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { randomUUID, randomBytes } from "node:crypto";
import {
  hashPassword,
  verifyPassword,
  hashToken,
  equalText,
} from "./password.js";
import { createStore } from "./store.js";
import core from "./sync-core.cjs";
const credentialsSchema = {
  type: "object",
  required: ["username", "password"],
  additionalProperties: false,
  properties: {
    username: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_.-]{2,31}$" },
    password: { type: "string", minLength: 8, maxLength: 128 },
    inviteCode: { type: "string", maxLength: 128 },
  },
};
const httpError = (statusCode, message) =>
  Object.assign(new Error(message), { statusCode });
const publicUser = (row) => ({ id: row.id, username: row.username });
export async function buildApp({
  pool,
  logger = false,
  corsOrigins = ["https://localhost", "http://localhost"],
  registrationEnabled = true,
  inviteCode = "",
  sessionDays = 30,
  trustProxy = false,
  rateLimits = true,
}) {
  const app = Fastify({ logger, bodyLimit: 2 * 1024 * 1024, trustProxy });
  await app.register(cors, {
    origin: corsOrigins,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });
  await app.register(rateLimit, {
    global: rateLimits,
    max: 240,
    timeWindow: "1 minute",
  });
  const dummyHash = await hashPassword(randomBytes(32).toString("hex"));
  async function issueSession(user) {
    const token = randomBytes(32).toString("base64url"),
      expiresAt = new Date(Date.now() + sessionDays * 86400000),
      client = await pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query(
        "SELECT id,username,password_hash FROM users WHERE id=$1 FOR UPDATE",
        [user.id],
      );
      if (
        !locked.rows.length ||
        locked.rows[0].password_hash !== user.password_hash
      )
        throw httpError(401, "账号有变化，请重新登录");
      await client.query(
        "INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)",
        [hashToken(token), user.id, expiresAt],
      );
      await client.query("COMMIT");
      return {
        ok: true,
        user: publicUser(user),
        session: { accessToken: token, expiresAt: expiresAt.toISOString() },
      };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  async function authenticate(request) {
    const token = request.headers.authorization?.match(
      /^Bearer ([A-Za-z0-9_-]{43})$/,
    )?.[1];
    if (!token) throw httpError(401, "请先登录");
    const r = await pool.query(
      "SELECT u.id,u.username,s.token_hash FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()",
      [hashToken(token)],
    );
    if (!r.rows.length) throw httpError(401, "登录已过期，请重新登录");
    request.user = r.rows[0];
  }
  const authConfig = {
    rateLimit: rateLimits ? { max: 20, timeWindow: "15 minutes" } : false,
  };
  app.get("/health", async () => {
    await pool.query("SELECT 1");
    return { ok: true, service: "jialian" };
  });
  app.post(
    "/v1/auth/register",
    { schema: { body: credentialsSchema }, config: authConfig },
    async (request) => {
      if (!registrationEnabled) throw httpError(403, "注册暂未开放");
      if (inviteCode && !equalText(inviteCode, request.body.inviteCode || ""))
        throw httpError(403, "邀请码不正确");
      const username = request.body.username.toLowerCase(),
        id = randomUUID(),
        passwordHash = await hashPassword(request.body.password);
      try {
        await pool.query(
          "INSERT INTO users(id,username,password_hash) VALUES($1,$2,$3)",
          [id, username, passwordHash],
        );
      } catch (e) {
        if (e.code === "23505") throw httpError(409, "用户名已被使用");
        throw e;
      }
      return issueSession({ id, username, password_hash: passwordHash });
    },
  );
  app.post(
    "/v1/auth/login",
    { schema: { body: credentialsSchema }, config: authConfig },
    async (request) => {
      const r = await pool.query(
        "SELECT id,username,password_hash FROM users WHERE username=$1",
        [request.body.username.toLowerCase()],
      );
      const valid = await verifyPassword(
        request.body.password,
        r.rows[0]?.password_hash || dummyHash,
      );
      if (!r.rows.length || !valid) throw httpError(401, "用户名或密码不正确");
      return issueSession(r.rows[0]);
    },
  );
  app.get("/v1/auth/me", { preHandler: authenticate }, (request) => ({
    ok: true,
    user: publicUser(request.user),
  }));
  app.post("/v1/auth/logout", { preHandler: authenticate }, async (request) => {
    await pool.query("DELETE FROM auth_sessions WHERE token_hash=$1", [
      request.user.token_hash,
    ]);
    return { ok: true };
  });
  app.post(
    "/v1/auth/password",
    {
      preHandler: authenticate,
      config: authConfig,
      schema: {
        body: {
          type: "object",
          required: ["oldPassword", "newPassword"],
          additionalProperties: false,
          properties: {
            oldPassword: { type: "string", minLength: 8, maxLength: 128 },
            newPassword: { type: "string", minLength: 8, maxLength: 128 },
          },
        },
      },
    },
    async (request) => {
      const r = await pool.query(
        "SELECT password_hash FROM users WHERE id=$1",
        [request.user.id],
      );
      if (
        !(await verifyPassword(
          request.body.oldPassword,
          r.rows[0]?.password_hash || dummyHash,
        ))
      )
        throw httpError(401, "原密码不正确");
      const passwordHash = await hashPassword(request.body.newPassword),
        client = await pool.connect();
      try {
        await client.query("BEGIN");
        const changed = await client.query(
          "UPDATE users SET password_hash=$1 WHERE id=$2 AND password_hash=$3 RETURNING id",
          [passwordHash, request.user.id, r.rows[0].password_hash],
        );
        if (!changed.rows.length)
          throw httpError(409, "密码刚刚有变化，请重新登录");
        await client.query(
          "DELETE FROM auth_sessions WHERE user_id=$1 AND token_hash<>$2",
          [request.user.id, request.user.token_hash],
        );
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
      return { ok: true };
    },
  );
  app.post(
    "/v1/sync",
    {
      preHandler: authenticate,
      schema: {
        body: {
          type: "object",
          required: ["action"],
          additionalProperties: false,
          properties: {
            action: { enum: ["pull", "push"] },
            offset: { type: "integer", minimum: 0, maximum: 100000 },
            operations: {
              type: "array",
              maxItems: 20,
              items: { type: "object" },
            },
          },
        },
      },
    },
    async (request) => {
      const uid = request.user.id;
      if (request.body.action === "pull") {
        const offset = request.body.offset || 0;
        const r = await pool.query(
          "SELECT document FROM sync_records WHERE owner=$1 ORDER BY id LIMIT 50 OFFSET $2",
          [uid, offset],
        );
        return {
          ok: true,
          records: r.rows.map((row) => row.document),
          nextOffset: r.rows.length === 50 ? offset + 50 : null,
        };
      }
      if (!Array.isArray(request.body.operations))
        throw httpError(400, "请提供同步操作");
      try {
        for (const op of request.body.operations) core.validateOperation(op);
      } catch (e) {
        throw httpError(400, e.message);
      }
      const results = [];
      for (const op of request.body.operations)
        results.push(await core.mutate(createStore(pool, uid), uid, op));
      return { ok: true, results };
    },
  );
  app.get("/v1/export", { preHandler: authenticate }, async (request) => {
    const r = await pool.query(
      "SELECT document FROM sync_records WHERE owner=$1 ORDER BY id",
      [request.user.id],
    );
    return {
      ok: true,
      version: 1,
      exportedAt: new Date().toISOString(),
      user: publicUser(request.user),
      records: r.rows.map((row) => row.document),
    };
  });
  app.post(
    "/v1/account/delete",
    {
      preHandler: authenticate,
      config: authConfig,
      schema: {
        body: {
          type: "object",
          required: ["password"],
          additionalProperties: false,
          properties: {
            password: { type: "string", minLength: 8, maxLength: 128 },
          },
        },
      },
    },
    async (request) => {
      const r = await pool.query(
        "SELECT password_hash FROM users WHERE id=$1",
        [request.user.id],
      );
      if (
        !(await verifyPassword(
          request.body.password,
          r.rows[0]?.password_hash || dummyHash,
        ))
      )
        throw httpError(401, "密码不正确");
      const removed = await pool.query(
        "DELETE FROM users WHERE id=$1 AND password_hash=$2 RETURNING id",
        [request.user.id, r.rows[0].password_hash],
      );
      if (!removed.rows.length)
        throw httpError(409, "密码刚刚有变化，请重新登录");
      return { ok: true };
    },
  );
  app.setErrorHandler((error, request, reply) => {
    const status =
      error.statusCode || (/提交标识重复/.test(error.message) ? 409 : 500);
    if (status >= 500)
      request.log.error({ code: error.code || "INTERNAL" }, "Request failed");
    const message = error.validation
      ? "请求格式不正确"
      : status < 500
        ? error.message
        : "服务暂时不可用，请稍后重试";
    reply.code(status).send({ ok: false, message });
  });
  return app;
}
