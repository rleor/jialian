const cloudbase = require("@cloudbase/node-sdk");
const { mutate, requireUser } = require("./core");
const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const { createStore } = require("./store");
const store = createStore(db);
exports.main = async (event) => {
  try {
    const uid = requireUser(app.auth().getUserInfo()); // trusted runtime identity, never event.userId
    if (event.action === "pull") {
      const offset = event.offset || 0;
      if (!Number.isInteger(offset) || offset < 0 || offset > 100000)
        throw new Error("分页参数不正确");
      const result = await db
        .collection("jialian_data")
        .where({ owner: uid })
        .orderBy("_id", "asc")
        .skip(offset)
        .limit(50)
        .get();
      return {
        ok: true,
        records: result.data,
        nextOffset: result.data.length === 50 ? offset + 50 : null,
      };
    }
    if (event.action === "push") {
      if (!Array.isArray(event.operations) || event.operations.length > 20)
        throw new Error("单次最多同步 20 条");
      const results = [];
      for (const op of event.operations)
        results.push(await mutate(store, uid, op));
      return { ok: true, results };
    }
    throw new Error("不支持的操作");
  } catch (error) {
    // No credentials or user training content in logs/responses.
    const allowed =
      /请先登录|数据格式|分页参数|单次最多|不支持|提交标识|无权访问/;
    return {
      ok: false,
      code: "SYNC_ERROR",
      message: allowed.test(error.message)
        ? error.message
        : "云端同步暂时失败，请稍后重试",
    };
  }
};
