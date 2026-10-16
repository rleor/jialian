function createStore(db) {
  return {
    transaction(fn) {
      // node-sdk 3.18 returns the callback value directly, not { result: value }.
      return db.runTransaction(async (tx) =>
        fn({
          async get(collection, id) {
            const response = await tx.collection(collection).doc(id).get();
            return Array.isArray(response.data)
              ? response.data[0] || null
              : response.data || null;
          },
          set: (collection, id, value) =>
            tx.collection(collection).doc(id).set(value),
        }),
      );
    },
  };
}
module.exports = { createStore };
