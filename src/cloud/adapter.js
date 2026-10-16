import cloudbase from "@cloudbase/js-sdk/app";
import { registerAuth } from "@cloudbase/js-sdk/auth";
import { registerFunctions } from "@cloudbase/js-sdk/functions";
registerAuth(cloudbase);
registerFunctions(cloudbase);
function result(response) {
  if (response.error) throw new Error(response.error.message || "账号操作失败");
  return response.data;
}
export function createAdapter(config) {
  if (!config.envId || !config.publishableKey) return null;
  const app = cloudbase.init({
    env: config.envId,
    region: config.region || "ap-shanghai",
    accessKey: config.publishableKey,
    timeout: 15000,
  });
  return {
    async session() {
      return result(await app.auth.getSession());
    },
    async login(account, password) {
      return result(
        await app.auth.signInWithPassword({
          ...(account.includes("@")
            ? { email: account }
            : { username: account }),
          password,
        }),
      );
    },
    async register(email, password) {
      return result(await app.auth.signUp({ email, password }));
    },
    async logout() {
      result(await app.auth.signOut());
    },
    async remote(data) {
      const response = await app.callFunction({ name: "jialian-sync", data });
      const output =
        typeof response.result === "string"
          ? JSON.parse(response.result)
          : response.result;
      if (!output?.ok) throw new Error(output?.message || "云端暂时不可用");
      return output;
    },
  };
}
