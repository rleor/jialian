export function createAdapter(
  config,
  { fetchFn = globalThis.fetch, storage = globalThis.localStorage } = {},
) {
  if (!config.apiBaseUrl) return null;
  const url = new URL(config.apiBaseUrl),
    base = url.href.replace(/\/$/, "");
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
  )
    throw Error("后台地址必须使用 HTTPS");
  const key = `jialian.auth.v1:${base}`;
  const read = () => {
    try {
      return JSON.parse(storage.getItem(key) || "null");
    } catch {
      return null;
    }
  };
  function remember(data) {
    storage.setItem(
      key,
      JSON.stringify({ user: data.user, session: data.session }),
    );
    return data;
  }
  async function request(
    path,
    { method = "GET", data, authenticated = true } = {},
  ) {
    const token = read()?.session?.accessToken;
    const response = await fetchFn(`${base}${path}`, {
      method,
      headers: {
        ...(data !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(authenticated && token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
      signal: AbortSignal.timeout(15000),
    });
    let body;
    try {
      body = await response.json();
    } catch {
      throw Error("后台响应格式不正确");
    }
    if (!response.ok || !body.ok)
      throw Object.assign(new Error(body.message || "请求失败，请稍后重试"), {
        status: response.status,
      });
    return body;
  }
  return {
    async session() {
      if (!read()?.session?.accessToken) return null;
      try {
        return await request("/v1/auth/me");
      } catch (error) {
        if (error.status === 401) {
          storage.removeItem(key);
          return null;
        }
        throw error;
      }
    },
    async login(username, password) {
      return remember(
        await request("/v1/auth/login", {
          method: "POST",
          data: { username, password },
          authenticated: false,
        }),
      );
    },
    async register(username, password, inviteCode) {
      return remember(
        await request("/v1/auth/register", {
          method: "POST",
          data: { username, password, ...(inviteCode ? { inviteCode } : {}) },
          authenticated: false,
        }),
      );
    },
    async logout() {
      try {
        await request("/v1/auth/logout", { method: "POST" });
      } catch (error) {
        return { ok: true, localOnly: true };
      } finally {
        storage.removeItem(key);
      }
    },
    remote: (data) => request("/v1/sync", { method: "POST", data }),
    exportData: () => request("/v1/export"),
    changePassword: (oldPassword, newPassword) =>
      request("/v1/auth/password", {
        method: "POST",
        data: { oldPassword, newPassword },
      }),
  };
}
