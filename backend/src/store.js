const tables = {
  jialian_data: "sync_records",
  jialian_mutations: "sync_mutations",
};
export function createStore(pool, uid) {
  return {
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // Serialize writes per user, including nonexistent records and duplicate operation IDs.
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
          [uid],
        );
        const result = await fn({
          async get(collection, id) {
            const table = tables[collection];
            if (!table) throw Error("Invalid collection");
            const r = await client.query(
              `SELECT document FROM ${table} WHERE id=$1 AND owner=$2`,
              [id, uid],
            );
            return r.rows[0]?.document || null;
          },
          async set(collection, id, value) {
            const table = tables[collection];
            if (!table) throw Error("Invalid collection");
            if (value.owner !== uid) throw Error("Owner mismatch");
            if (table === "sync_records")
              await client.query(
                "INSERT INTO sync_records (id,owner,logical_key,document) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET document=EXCLUDED.document WHERE sync_records.owner=EXCLUDED.owner",
                [id, uid, value.key, value],
              );
            else
              await client.query(
                "INSERT INTO sync_mutations(id,owner,document) VALUES($1,$2,$3)",
                [id, uid, value],
              );
          },
        });
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
