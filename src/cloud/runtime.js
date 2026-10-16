import { SyncEngine } from "./engine.js";
import { createAdapter } from "./adapter.js";
import { clone } from "./model.js";
const prefix = "jialian.cloud.v1:";
const read = (key) => {
  try {
    return JSON.parse(localStorage.getItem(prefix + key) || "null");
  } catch {
    return null;
  }
};
const write = (key, value) =>
  localStorage.setItem(prefix + key, JSON.stringify(value));
const legacy = (() => {
  try {
    return JSON.parse(localStorage.getItem("jialian.prototype.v1") || "null");
  } catch {
    return null;
  }
})();
const days = Array.from({ length: 7 }, () => ({
  title: "休息",
  parts: [],
  kind: "休息",
  minutes: 0,
  icon: "leaf",
  sessions: [],
  sets: [],
}));
for (const [i, parts] of [
  [0, ["胸", "三头"]],
  [2, ["背", "二头"]],
  [4, ["肩", "核心"]],
  [6, ["臀腿"]],
])
  days[i] = {
    ...days[i],
    title: parts.join("＋"),
    parts,
    kind: "力量",
    minutes: 25,
    icon: "dumbbell",
  };
const blank = {
  privateContent: {
    version: 9,
    days,
    weeklyDays: 4,
    weekStart: "2026-10-12",
    page: "week",
    selected: 2,
    calendarMode: "month",
    historyMonth: "2026-10",
    dayOrigin: "week",
    calendarDate: 14,
    calendarISO: "2026-10-14",
    multiStart: "2026-09",
    shareMode: "results",
    nickname: false,
    timer: null,
  },
  modelContent: null,
};
if (!read("account:guest") && legacy)
  write("account:guest", {
    snapshot: legacy,
    meta: { revisions: {}, pending: {}, conflicts: {}, lastSync: null },
    records: [],
  });
const adapter = createAdapter(__JIALIAN_CONFIG__);
let info = { owner: "guest", status: "local", pending: 0, conflicts: {} },
  dialog,
  accountName = "",
  authBusy = false,
  applied = null;
const engine = new SyncEngine({
  read,
  write,
  remote: async (input) => {
    if (!adapter) throw new Error("云端尚未配置");
    return adapter.remote(input);
  },
  initial: blank,
  guest: () => read("account:guest")?.snapshot,
  notify: (value) => {
    info = value;
    window.openai.widgetState = value.snapshot;
    if (
      document.getElementById("lianri-mobile") &&
      applied !== JSON.stringify(value.snapshot)
    ) {
      applied = JSON.stringify(value.snapshot);
      window.dispatchEvent(
        new CustomEvent("openai:set_globals", {
          detail: { globals: { widgetState: value.snapshot } },
        }),
      );
    }
    refreshTrigger();
    refreshStatus();
  },
});
window.openai = {
  widgetState: engine.snapshot,
  async setWidgetState(snapshot) {
    try {
      applied = JSON.stringify(snapshot);
      engine.save(snapshot);
    } catch {
      info.error = "本机存储失败，请导出记录后清理空间";
      info.status = "storage-error";
      refreshStatus();
    }
  },
};
const escape = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function statusText() {
  if (!adapter) return "仅保存在本机";
  if (info.owner === "guest") return "未登录 · 本机保存";
  return (
    {
      syncing: "正在同步",
      conflict: "有修改冲突，请处理",
      offline: "暂未同步 · 本机已保存",
      synced: "已同步到云端",
      pending: "等待同步",
      "storage-error": "本机保存失败",
    }[info.status] || "本机已保存"
  );
}
function refreshTrigger() {
  const header = document.querySelector(
    "#lianri-mobile .lr-brand",
  )?.parentElement;
  if (!header) return;
  let b = header.querySelector(".jl-account-trigger");
  if (!b) {
    b = document.createElement("button");
    b.type = "button";
    b.className = "jl-account-trigger";
    b.addEventListener("click", openAccount);
    header.append(b);
  }
  const text =
    info.owner === "guest"
      ? "账号"
      : info.status === "synced"
        ? "已同步"
        : info.status === "conflict"
          ? "冲突"
          : "待同步";
  if (b.textContent !== text) b.textContent = text;
  b.setAttribute("aria-label", `账号：${statusText()}`);
}
function refreshStatus() {
  const el = dialog?.querySelector("[data-cloud-status]");
  if (el)
    el.textContent =
      statusText() + (info.pending ? ` · ${info.pending} 条待同步` : "");
  const error = dialog?.querySelector("[data-cloud-error]");
  if (error && info.error) error.textContent = info.error;
}
function closeAccount() {
  const old = dialog;
  old?.close();
  old?.remove();
  if (dialog === old) dialog = null;
}
function openAccount() {
  if (dialog?.open) return;
  dialog = document.createElement("dialog");
  const panel = dialog;
  dialog.className = "jl-account-dialog";
  document.body.append(dialog);
  const signed = info.owner !== "guest";
  dialog.innerHTML = `<div class="jl-account-head"><h2>${signed ? "我的账号" : "登录与备份"}</h2><button data-close aria-label="关闭">×</button></div><p data-cloud-status>${escape(statusText())}</p>${signed ? `<p>${escape(accountName || "已登录")}</p><div class="jl-account-actions"><button data-sync>立即同步</button><button data-import>导入本机游客记录</button><button data-export>导出账号记录</button><button data-logout>退出登录</button></div><div data-conflicts></div>` : adapter ? `<form><label>用户名（英文、数字、下划线）<input name="account" autocomplete="username" required minlength="3" maxlength="32" pattern="[A-Za-z0-9][A-Za-z0-9_.-]{2,31}"></label><label>密码<input name="password" type="password" autocomplete="current-password" required minlength="8" maxlength="128"></label><button class="jl-primary" type="submit">登录</button><label>邀请码（如需要）<input name="inviteCode" autocomplete="off" maxlength="128"></label><button type="button" data-register>注册账号</button></form><p class="jl-note">记录先保存在手机，登录后可以备份、换机同步。</p>` : "<p>云端尚未配置，当前仍可在本机记录训练。</p>"}<p data-cloud-error role="alert"></p><div data-import-choice hidden><p>把这台手机的游客记录合并到当前账号？</p><button class="jl-primary" data-import-confirm>导入并同步</button><button data-import-skip>仅使用账号数据</button></div>`;
  dialog.querySelector("[data-close]").onclick = closeAccount;
  dialog.addEventListener("close", () => {
    panel.remove();
    if (dialog === panel) {
      dialog = null;
    }
  });
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
  const error = (message) => {
    const el = dialog?.querySelector("[data-cloud-error]");
    if (el) el.textContent = message;
  };
  const busy = (state) => {
    authBusy = state;
    dialog
      .querySelectorAll("button:not([data-close])")
      .forEach((b) => (b.disabled = state));
  };
  const authenticated = async (data) => {
    const uid = data?.user?.id || data?.session?.sub;
    if (!uid) throw new Error("登录信息不完整，请重试");
    accountName = data.user?.email || data.user?.username || "已登录";
    await engine.useAccount(uid);
    closeAccount();
    openAccount();
    if (!read(`import-dismissed:${uid}`) && read("account:guest")?.snapshot) {
      dialog.querySelector("[data-import-choice]").hidden = false;
    }
  };
  const authAction = (fn) => async () => {
    if (authBusy || engine.busy) return error("正在同步，请稍后再操作账号");
    busy(true);
    error("");
    try {
      await fn();
    } catch (e) {
      error(e.message || "账号操作失败");
    } finally {
      authBusy = false;
      if (dialog) busy(false);
    }
  };
  const form = dialog.querySelector("form");
  if (form) {
    const values = () => ({
      account: form.elements.account.value.trim(),
      password: form.elements.password.value,
    });
    form.onsubmit = (e) => {
      e.preventDefault();
      authAction(async () => {
        const v = values();
        await authenticated(await adapter.login(v.account, v.password));
      })();
    };
    dialog.querySelector("[data-register]").onclick = authAction(async () => {
      const v = values();
      if (
        !/^[A-Za-z0-9][A-Za-z0-9_.-]{2,31}$/.test(v.account) ||
        v.password.length < 8
      )
        throw new Error("请填写 3–32 位用户名和至少 8 位密码");
      await authenticated(
        await adapter.register(
          v.account,
          v.password,
          form.elements.inviteCode.value.trim(),
        ),
      );
    });
  }
  const bind = (selector, fn) => {
    const node = dialog.querySelector(selector);
    if (node) node.onclick = fn;
  };
  bind("[data-sync]", async () => {
    await engine.sync();
    renderConflicts();
  });
  const offerImport = () => {
    dialog.querySelector("[data-import-choice]").hidden = false;
  };
  bind("[data-import]", offerImport);
  bind("[data-import-confirm]", () => {
    engine.importGuest();
    write(`import-dismissed:${info.owner}`, true);
    dialog.querySelector("[data-import-choice]").hidden = true;
    engine.sync().then(renderConflicts);
  });
  bind("[data-import-skip]", () => {
    write(`import-dismissed:${info.owner}`, true);
    dialog.querySelector("[data-import-choice]").hidden = true;
  });
  bind(
    "[data-logout]",
    authAction(async () => {
      await adapter.logout();
      engine.useGuest();
      accountName = "";
      closeAccount();
      openAccount();
    }),
  );
  bind("[data-export]", async () => {
    const bundle = {
      localSnapshot: engine.snapshot,
      pending: engine.meta.pending,
      cachedRecords: engine.records,
    };
    try {
      bundle.server = await adapter.exportData();
    } catch {
      bundle.serverUnavailable = true;
    }
    const blob = new Blob([JSON.stringify(bundle, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = "jialian-backup.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });
  dialog.showModal();
  refreshStatus();
  renderConflicts();
}
function renderConflicts() {
  const box = dialog?.querySelector("[data-conflicts]");
  if (!box) return;
  box.innerHTML = Object.entries(info.conflicts)
    .map(
      ([key, c]) =>
        `<section class="jl-conflict"><strong>${escape(c.local.date || "训练偏好")} · 修改冲突</strong><p>本机：${escape(c.local.deleted ? "已删除" : c.local.data.title || "每周 " + c.local.data.weeklyDays + " 天")}${c.local.data?.minutes ? " " + c.local.data.minutes + " 分钟" : ""}</p><p>云端：${escape(c.remote?.deleted ? "已删除" : c.remote?.data?.title || "训练偏好")}${c.remote?.data?.minutes ? " " + c.remote.data.minutes + " 分钟" : ""}</p><button data-choice="local" data-key="${escape(key)}">保留本机修改</button><button data-choice="remote" data-key="${escape(key)}">使用云端版本</button></section>`,
    )
    .join("");
  box.querySelectorAll("[data-choice]").forEach(
    (b) =>
      (b.onclick = () => {
        engine.resolve(b.dataset.key, b.dataset.choice);
        renderConflicts();
      }),
  );
}
function mount() {
  const style = document.createElement("style");
  style.textContent = `
.jl-account-trigger{margin-left:8px;min-height:44px;color:var(--lr-muted);font-size:11px!important;white-space:nowrap}
.jl-account-dialog{width:min(390px,calc(100% - 24px));max-height:85dvh;overflow:auto;border:1px solid light-dark(#e8eae2,#36453a);border-radius:24px;padding:24px;background:light-dark(#faf9f5,#19221d);color:light-dark(#23382c,#eff5ed);font:14px/1.6 'PingFang SC',sans-serif}
.jl-account-dialog::backdrop{background:#15271e66}.jl-account-head{display:flex;align-items:center;justify-content:space-between}.jl-account-head h2{font-size:22px;margin:0}.jl-account-head button{font-size:26px;background:transparent;border:0}
.jl-account-dialog p{font-size:12px;color:light-dark(#737c71,#a7b4a6)}.jl-account-dialog label{display:block;font-size:12px;margin:16px 0}.jl-account-dialog input{display:block;width:100%;padding:12px;margin-top:7px;font-size:16px;border:1px solid light-dark(#e8eae2,#36453a);border-radius:12px;background:light-dark(#fff,#253029);color:inherit}
.jl-account-dialog button{min-height:44px;padding:10px 14px;border:0;border-radius:12px;font:inherit;color:inherit;background:light-dark(#edf2e9,#2b3b2f);margin:4px 3px 4px 0}.jl-account-dialog button:disabled{opacity:.45}.jl-account-dialog .jl-primary{background:light-dark(#284934,#b9dcc2);color:light-dark(#f8faf5,#1c3324)}.jl-account-actions{display:grid;gap:5px}.jl-conflict{margin:16px 0;border-top:1px solid light-dark(#e8eae2,#36453a);padding-top:12px}.jl-account-dialog [data-cloud-error]{color:light-dark(#994831,#ffb8a1)}
`;
  document.head.append(style);
  refreshTrigger();
  const observer = new MutationObserver(() => refreshTrigger());
  observer.observe(document.querySelector("#lianri-mobile .lr-main"), {
    childList: true,
    subtree: true,
  });
  if (adapter)
    adapter
      .session()
      .then(async (data) => {
        const uid = data?.user?.id || data?.session?.sub;
        if (uid) {
          accountName = data.user?.email || data.user?.username || "";
          await engine.useAccount(uid);
        } else {
          engine.useGuest();
        }
      })
      .catch(() => {
        info.status = info.owner === "guest" ? "local" : "offline";
        info.error = "暂时无法验证登录状态，本机记录仍保留";
        refreshStatus();
        refreshTrigger();
      });
  window.addEventListener("online", () => engine.sync());
  document.addEventListener("visibilitychange", () => {
    if (
      document.visibilityState === "visible" &&
      Date.now() - (engine.meta.lastSync || 0) > 60000
    )
      engine.sync();
  });
}
if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", mount, { once: true });
else mount();
