import pg from "pg";
import { buildApp } from "./app.js";
import { migrate } from "./migrate.js";
if (!process.env.DATABASE_URL && !process.env.PGHOST)
  throw Error("DATABASE_URL or PGHOST is required");
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  connectionTimeoutMillis: 10000,
});
const sessionDays = Number(process.env.SESSION_DAYS || 30);
if (!Number.isInteger(sessionDays) || sessionDays < 1 || sessionDays > 90)
  throw Error("SESSION_DAYS must be 1–90");
await migrate(pool);
const app = await buildApp({
  pool,
  logger: {
    redact: [
      "req.headers.authorization",
      "req.body.password",
      "req.body.oldPassword",
      "req.body.newPassword",
    ],
  },
  corsOrigins: (
    process.env.CORS_ORIGINS || "https://localhost,http://localhost"
  )
    .split(",")
    .map((v) => v.trim()),
  registrationEnabled: process.env.REGISTRATION_ENABLED !== "false",
  inviteCode: process.env.REGISTRATION_INVITE_CODE || "",
  sessionDays,
  trustProxy: process.env.TRUST_PROXY === "true" ? 1 : false,
});
await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT || 3000) });
let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    await app.close();
    await pool.end();
    process.exit(0);
  });
