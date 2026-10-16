const { createHash } = require("node:crypto");
const digest = (value) => createHash("sha256").update(value).digest("hex");
const validDate = (v) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
function check(condition, message = "数据格式不正确") {
  if (!condition) throw new Error(message);
}
function validateOperation(op) {
  check(op && typeof op === "object" && !Array.isArray(op));
  check(typeof op.id === "string" && /^[a-zA-Z0-9-]{8,80}$/.test(op.id));
  check(typeof op.key === "string" && op.key.length <= 180);
  check(Number.isSafeInteger(op.baseRevision) && op.baseRevision >= 0);
  check(typeof op.deleted === "boolean");
  check(["preferences", "plan", "workout"].includes(op.type));
  if (op.type === "preferences") check(op.key === "preferences");
  else {
    check(validDate(op.date));
    check(op.key.startsWith(`${op.type}:${op.date}`));
  }
  if (op.type === "plan") check(op.key === `plan:${op.date}`);
  if (op.type === "workout")
    check(op.key === `workout:${op.date}:${op.data?.id || op.workoutId}`);
  if (op.deleted) return;
  const d = op.data;
  check(
    d &&
      typeof d === "object" &&
      !Array.isArray(d) &&
      Buffer.byteLength(JSON.stringify(d)) <= 100000,
  );
  if (op.type === "preferences") {
    check(
      Number.isInteger(d.weeklyDays) && d.weeklyDays >= 1 && d.weeklyDays <= 6,
    );
    return;
  }
  check(
    typeof d.title === "string" && d.title.length > 0 && d.title.length <= 120,
  );
  check(["力量", "有氧", "休息", "活动", "混合"].includes(d.kind));
  check(
    Array.isArray(d.parts) &&
      d.parts.length <= 12 &&
      d.parts.every((p) => typeof p === "string" && p.length <= 30),
  );
  check(
    Number.isFinite(d.minutes) &&
      d.minutes >= (op.type === "workout" ? 0.01 : 0) &&
      d.minutes <= 1440,
  );
  if (op.type === "workout") {
    check(typeof d.id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(d.id));
    check(["完整完成", "部分完成", "改练其他"].includes(d.status));
    check(["", "轻松", "合适", "很累"].includes(d.effort));
    check(Array.isArray(d.sets) && d.sets.length <= 300);
    for (const s of d.sets) {
      check(typeof s.exercise === "string" && s.exercise.length <= 120);
      check(Number.isInteger(s.reps) && s.reps > 0 && s.reps <= 500);
      check(Number.isFinite(s.weight) && s.weight >= 0 && s.weight <= 500);
      check(["per_hand", "total", "bodyweight"].includes(s.basis));
    }
  }
}
async function mutate(store, uid, op, now = Date.now()) {
  validateOperation(op);
  const recordId = digest(`${uid}|${op.key}`),
    receiptId = digest(`${uid}|${op.id}`),
    operationHash = digest(JSON.stringify(op));
  return store.transaction(async (tx) => {
    const receipt = await tx.get("jialian_mutations", receiptId);
    if (receipt) {
      check(receipt.hash === operationHash, "提交标识重复，请重新同步");
      return receipt.result;
    }
    const previous = await tx.get("jialian_data", recordId);
    check(!previous || previous.owner === uid, "无权访问");
    const revision = previous?.revision || 0;
    if (revision !== op.baseRevision)
      return { key: op.key, id: op.id, conflict: true, remote: previous };
    const next = {
      owner: uid,
      key: op.key,
      type: op.type,
      date: op.date || null,
      revision: revision + 1,
      deleted: op.deleted,
      data: op.deleted ? null : op.data,
      updatedAt: now,
    };
    await tx.set("jialian_data", recordId, next);
    const result = {
      key: op.key,
      id: op.id,
      revision: next.revision,
      updatedAt: now,
    };
    await tx.set("jialian_mutations", receiptId, {
      owner: uid,
      hash: operationHash,
      result,
      createdAt: now,
    });
    return result;
  });
}
function requireUser(info) {
  check(info?.uid && !info.isAnonymous, "请先登录账号");
  return info.uid;
}
module.exports = { mutate, validateOperation, requireUser, digest };
