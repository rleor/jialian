// Administrative recovery: password comes from stdin, never a CLI argument.
import pg from "pg";
import { hashPassword } from "./password.js";
const username = process.argv[2]?.toLowerCase();
if (!username || !/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(username))
  throw Error("Usage: node src/admin-reset.js username < password-from-stdin");
let password = "";
for await (const chunk of process.stdin) password += chunk;
password = password.replace(/\r?\n$/, "");
if (password.length < 8 || password.length > 128)
  throw Error("Password must be 8–128 characters");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL }),
  client = await pool.connect();
try {
  const hash = await hashPassword(password);
  await client.query("BEGIN");
  const r = await client.query(
    "UPDATE users SET password_hash=$1 WHERE username=$2 RETURNING id",
    [hash, username],
  );
  if (!r.rows.length) throw Error("Account not found");
  await client.query("DELETE FROM auth_sessions WHERE user_id=$1", [
    r.rows[0].id,
  ]);
  await client.query("COMMIT");
  console.log("Password reset; all sessions revoked");
} catch (e) {
  await client.query("ROLLBACK");
  throw e;
} finally {
  client.release();
  await pool.end();
}
