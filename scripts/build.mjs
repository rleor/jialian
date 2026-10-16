import { readFile, mkdir, writeFile } from "node:fs/promises";
import { build } from "esbuild";
const source = await readFile(
  new URL("../prototype/jialian-mobile.html", import.meta.url),
  "utf8",
);
const fragment = source.replace(/@import url\([^;]+;/g, "");
const config = { apiBaseUrl: process.env.JIALIAN_API_BASE_URL || "" };
if (config.apiBaseUrl) {
  const url = new URL(config.apiBaseUrl);
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
  )
    throw Error("JIALIAN_API_BASE_URL must use HTTPS (except localhost)");
}
const result = await build({
  entryPoints: ["src/entry.js"],
  bundle: true,
  write: false,
  minify: true,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  define: { __JIALIAN_CONFIG__: JSON.stringify(config) },
});
const mobileCSS = `
html,body{margin:0;min-height:100%;background:light-dark(#faf9f5,#19221d);color-scheme:light dark}
*{box-sizing:border-box}button,input,select,textarea{font:inherit}button{cursor:pointer}
#lianri-mobile{padding:0;min-height:100dvh}
#lianri-mobile .lr-phone{width:100%;min-height:100dvh;border:0;border-radius:0;box-shadow:none;padding-top:env(safe-area-inset-top)}
#lianri-mobile .lr-status,#lianri-mobile .lr-home-indicator{display:none}
#lianri-mobile .lr-nav{padding-bottom:max(16px,env(safe-area-inset-bottom));position:sticky;bottom:0;z-index:10}
#lianri-mobile .lr-main{padding-top:16px}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
`;
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#284934"><title>家练</title></head><body><script>${result.outputFiles[0].text}</script>${fragment}<style>${mobileCSS}</style></body></html>`;
await mkdir("dist", { recursive: true });
await writeFile("dist/index.html", html);
console.log("Built dist/index.html (offline resources, local persistence)");
