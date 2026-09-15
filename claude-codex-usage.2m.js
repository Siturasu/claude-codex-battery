#!/usr/bin/env bun
// <xbar.title>Claude & Codex Usage</xbar.title>
// <xbar.version>v1.5.1</xbar.version>
// <xbar.author>Denny Kim</xbar.author>
// <xbar.desc>Shows remaining Claude Code 5h-block and Codex rate limits as battery icons in the menu bar</xbar.desc>
// SwiftBar plugin, refreshes every 2 minutes. Menu bar = battery icons (self-rendered PNG), click = detailed gauges.

import { execSync, spawn } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import zlib from "node:zlib";

const HOME = homedir();
// ── UI language: en (default) · ko · ja · zh-Hans · zh-Hant · es ─────────────
// Resolution: CCB_LANG env → ~/.claude/swiftbar/.lang (written by the app's
// Settings → Language) → system language → English.
const SUPPORTED_LANGS = ["en", "ko", "ja", "zh-Hans", "zh-Hant", "es"];
const LANG_FILE_PATH = `${HOME}/.claude/swiftbar/.lang`;
function normLang(raw) {
  const l = String(raw).toLowerCase();
  if (l.startsWith("ko")) return "ko";
  if (l.startsWith("ja")) return "ja";
  if (l.startsWith("es")) return "es";
  if (l.startsWith("zh")) {
    if (
      l.includes("hant") ||
      l.includes("-tw") ||
      l.includes("-hk") ||
      l.includes("-mo")
    )
      return "zh-Hant";
    return "zh-Hans";
  }
  if (l.startsWith("en")) return "en";
  return raw;
}
const UI_LANG = (() => {
  if (process.env.CCB_LANG) {
    const n = normLang(process.env.CCB_LANG);
    if (SUPPORTED_LANGS.includes(n)) return n;
  }
  try {
    const n = normLang(readFileSync(LANG_FILE_PATH, "utf8").trim());
    if (SUPPORTED_LANGS.includes(n)) return n;
  } catch {}
  if (process.platform !== "darwin" && process.env.LANG) {
    const n = normLang(process.env.LANG);
    if (SUPPORTED_LANGS.includes(n)) return n;
  }
  try {
    const out = execSync("defaults read -g AppleLanguages 2>/dev/null", {
      encoding: "utf8",
      timeout: 3000,
    });
    const m = out.match(/"\s*([A-Za-z-]+)/);
    if (m) {
      const n = normLang(m[1]);
      if (SUPPORTED_LANGS.includes(n)) return n;
    }
  } catch {}
  return "en";
})();
// Third-language table, keyed by the English string ({0}/{1} are placeholders).
// Korean lives at the call sites (first argument of L/tf); English is the key.
const TR3 = {
  "% left": {
    ja: "残り%",
    "zh-Hans": "剩余 %",
    "zh-Hant": "剩餘 %",
    es: "% restante",
  },
  "C5·CW·CF = Claude 5h·weekly·Fable": {
    ja: "C5·CW·CF = Claude 5時間·週間·Fable",
    "zh-Hans": "C5·CW·CF = Claude 5小时·每周·Fable",
    "zh-Hant": "C5·CW·CF = Claude 5小時·每週·Fable",
    es: "C5·CW·CF = Claude 5h·semanal·Fable",
  },
  "X5·XW = Codex 5h·weekly": {
    ja: "X5·XW = Codex 5時間·週間",
    "zh-Hans": "X5·XW = Codex 5小时·每周",
    "zh-Hant": "X5·XW = Codex 5小時·每週",
    es: "X5·XW = Codex 5h·semanal",
  },
  "X = Codex credits": {
    ja: "X = Codexクレジット",
    "zh-Hans": "X = Codex 额度",
    "zh-Hant": "X = Codex 額度",
    es: "X = créditos de Codex",
  },
  "5h left  ": {
    ja: "5時間残り ",
    "zh-Hans": "5小时剩余",
    "zh-Hant": "5小時剩餘",
    es: "5h rest.  ",
  },
  "wk left  ": {
    ja: "週間残り  ",
    "zh-Hans": "每周剩余 ",
    "zh-Hant": "每週剩餘 ",
    es: "sem rest. ",
  },
  left: { ja: "残り", "zh-Hans": "剩余", "zh-Hant": "剩餘", es: "rest." },
  used: { ja: "使用", "zh-Hans": "已用", "zh-Hant": "已用", es: "usado" },
  reset: {
    ja: "リセット済み",
    "zh-Hans": "已重置",
    "zh-Hant": "已重置",
    es: "reiniciado",
  },
  resets: {
    ja: "リセット",
    "zh-Hans": "重置",
    "zh-Hant": "重置",
    es: "reinicia",
  },
  "live (Anthropic usage API — all devices combined)": {
    ja: "ライブ (Anthropic usage API — 全デバイス合算)",
    "zh-Hans": "实时（Anthropic usage API — 所有设备合计）",
    "zh-Hant": "即時（Anthropic usage API — 所有裝置合計）",
    es: "en vivo (Anthropic usage API — todos los dispositivos)",
  },
  "live (ChatGPT usage API — all devices combined)": {
    ja: "ライブ (ChatGPT usage API — 全デバイス合算)",
    "zh-Hans": "实时（ChatGPT usage API — 所有设备合计）",
    "zh-Hant": "即時（ChatGPT usage API — 所有裝置合計）",
    es: "en vivo (ChatGPT usage API — todos los dispositivos)",
  },
  "cached {0} ago (fallback — check Claude Code login/network)": {
    ja: "{0}前のキャッシュ (フォールバック — Claude Codeのログイン/ネットワークを確認)",
    "zh-Hans": "{0} 前的缓存（回退 — 请检查 Claude Code 登录/网络）",
    "zh-Hant": "{0} 前的快取（備援 — 請檢查 Claude Code 登入/網路）",
    es: "caché de hace {0} (respaldo — revisa sesión/red de Claude Code)",
  },
  "live query failed — check login/network (local log from {0} ago)": {
    ja: "ライブ取得失敗 — ログイン/ネットワークを確認 ({0}前のローカルログ)",
    "zh-Hans": "实时查询失败 — 请检查登录/网络（{0} 前的本地日志）",
    "zh-Hant": "即時查詢失敗 — 請檢查登入/網路（{0} 前的本機日誌）",
    es: "consulta en vivo fallida — revisa sesión/red (registro local de hace {0})",
  },
  "block cost": {
    ja: "ブロック費用",
    "zh-Hans": "时段费用",
    "zh-Hant": "時段費用",
    es: "costo del bloque",
  },
  tokens: {
    ja: "tokens",
    "zh-Hans": "tokens",
    "zh-Hant": "tokens",
    es: "tokens",
  },
  "today by model": {
    ja: "今日のモデル別",
    "zh-Hans": "今日按模型",
    "zh-Hant": "今日按模型",
    es: "hoy por modelo",
  },
  total: { ja: "計", "zh-Hans": "共", "zh-Hant": "共", es: "total" },
  "credits  unlimited": {
    ja: "クレジット 無制限",
    "zh-Hans": "额度 无限",
    "zh-Hant": "額度 無限",
    es: "créditos  ilimitados",
  },
  "credits  exhausted · limit reached (0)": {
    ja: "クレジット切れ · 上限到達 (0)",
    "zh-Hans": "额度用尽 · 已达上限 (0)",
    "zh-Hant": "額度用盡 · 已達上限 (0)",
    es: "créditos agotados · límite alcanzado (0)",
  },
  "buy credits in Codex settings or wait for reset": {
    ja: "Codex設定でクレジットを購入するかリセットを待つ",
    "zh-Hans": "在 Codex 设置中购买额度或等待重置",
    "zh-Hant": "在 Codex 設定中購買額度或等待重置",
    es: "compra créditos en los ajustes de Codex o espera el reinicio",
  },
  "credits  balance": {
    ja: "クレジット残高",
    "zh-Hans": "额度余额",
    "zh-Hant": "額度餘額",
    es: "créditos  saldo",
  },
  "Run Claude Code or Codex and usage will appear here": {
    ja: "Claude CodeまたはCodexを使うと使用量が表示されます",
    "zh-Hans": "运行 Claude Code 或 Codex 后将显示用量",
    "zh-Hant": "執行 Claude Code 或 Codex 後將顯示用量",
    es: "Usa Claude Code o Codex y el consumo aparecerá aquí",
  },
  "Update to v{0} (current v{1})": {
    ja: "v{0}へアップデート (現在 v{1})",
    "zh-Hans": "更新到 v{0}（当前 v{1}）",
    "zh-Hant": "更新到 v{0}（目前 v{1}）",
    es: "Actualizar a v{0} (actual v{1})",
  },
  "Update now — replace with latest from GitHub (current v{0})": {
    ja: "今すぐ更新 — GitHubの最新版に置き換え (現在 v{0})",
    "zh-Hans": "立即更新 — 替换为 GitHub 最新版（当前 v{0}）",
    "zh-Hant": "立即更新 — 替換為 GitHub 最新版（目前 v{0}）",
    es: "Actualizar ahora — reemplazar con lo último de GitHub (actual v{0})",
  },
  "Refresh now": {
    ja: "今すぐ更新",
    "zh-Hans": "立即刷新",
    "zh-Hant": "立即重新整理",
    es: "Actualizar ahora",
  },
  "Open ccusage dashboard": {
    ja: "ccusageダッシュボードを開く",
    "zh-Hans": "打开 ccusage 面板",
    "zh-Hant": "開啟 ccusage 面板",
    es: "Abrir panel de ccusage",
  },
  "battery size": {
    ja: "バッテリーサイズ",
    "zh-Hans": "电池大小",
    "zh-Hant": "電池大小",
    es: "tamaño de batería",
  },
  "small (default)": {
    ja: "小 (標準)",
    "zh-Hans": "小（默认）",
    "zh-Hant": "小（預設）",
    es: "pequeño (predet.)",
  },
  small: { ja: "小", "zh-Hans": "小", "zh-Hant": "小", es: "pequeño" },
  big: { ja: "大", "zh-Hans": "大", "zh-Hant": "大", es: "grande" },
  "click for": {
    ja: "クリックで",
    "zh-Hans": "点击切换为",
    "zh-Hant": "點擊切換為",
    es: "clic para",
  },
  "Disable widget (re-enable in SwiftBar settings)": {
    ja: "ウィジェットを無効化 (SwiftBar設定で再有効化)",
    "zh-Hans": "停用小组件（在 SwiftBar 设置中重新启用）",
    "zh-Hant": "停用小工具（在 SwiftBar 設定中重新啟用）",
    es: "Desactivar widget (reactivar en ajustes de SwiftBar)",
  },
};
// L: plain string — ko from the call site, en as-is, others looked up by the English key
const L = (ko, en) =>
  UI_LANG === "ko" ? ko : UI_LANG === "en" ? en : (TR3[en]?.[UI_LANG] ?? en);
// tf: templated string with {0}/{1} placeholders
const tf = (ko, en, ...args) => {
  let s = L(ko, en);
  args.forEach((a, i) => {
    s = s.replaceAll(`{${i}}`, a);
  });
  return s;
};

// Locate binaries (paths differ per machine — portability)
function findBin(name, extra = []) {
  const cands = [
    ...extra,
    `${HOME}/.bun/bin/${name}`,
    "/opt/homebrew/bin/" + name,
    "/usr/local/bin/" + name,
  ];
  for (const c of cands) {
    try {
      if (existsSync(c)) return c;
    } catch {}
  }
  try {
    const p = execSync(`command -v ${name} 2>/dev/null`, {
      encoding: "utf8",
    }).trim();
    if (p) return p;
  } catch {}
  return name; // last resort: rely on PATH
}
const CCUSAGE = findBin("ccusage");
const CODEX_SESSIONS = `${HOME}/.codex/sessions`;
const now = Math.floor(Date.now() / 1000);

// ── Auto-update (notification + one click) ──
const VERSION = "1.5.1";
const SELF_DIR = dirname(process.argv[1] || `${HOME}/.swiftbar-plugins/x`);
const REPO_RAW =
  "https://raw.githubusercontent.com/Siturasu/claude-codex-battery/main";
const UPDATE_CACHE = `${HOME}/.claude/swiftbar/.update-check.json`;
function cmpVer(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}
// Read the cached latest version; if 24h+ old, quietly check GitHub's VERSION file
// in the background (doesn't block rendering — detached spawn + unref)
function getUpdateInfo() {
  let cache = null;
  try {
    cache = JSON.parse(readFileSync(UPDATE_CACHE, "utf8"));
  } catch {}
  const age = cache?.checkedAt ? now - cache.checkedAt : Infinity;
  if (age > 24 * 3600) {
    try {
      const cmd =
        `latest=$(curl -fsL --max-time 8 "${REPO_RAW}/VERSION" 2>/dev/null | tr -d '[:space:]'); ` +
        `[ -n "$latest" ] && printf '{"checkedAt":%s,"latest":"%s"}' "${now}" "$latest" > "${UPDATE_CACHE}"`;
      const child = spawn("/bin/sh", ["-c", cmd], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
    } catch {}
  }
  const latest = cache?.latest;
  return { latest, hasUpdate: !!latest && cmpVer(latest, VERSION) > 0 };
}

// ══ Battery icon PNG renderer (pure JS, node:zlib only) ══════════
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const mk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    mk("IHDR", ihdr),
    mk("IDAT", idat),
    mk("IEND", Buffer.alloc(0)),
  ]);
}
const SCALE = 2;
function makeCanvas(wl, hl) {
  const w = wl * SCALE,
    h = hl * SCALE;
  const buf = Buffer.alloc(w * h * 4, 0);
  const set = (x, y, col) => {
    if (x < 0 || y < 0 || x >= wl || y >= hl) return;
    const [r, g, b, a = 255] = col;
    for (let dy = 0; dy < SCALE; dy++)
      for (let dx = 0; dx < SCALE; dx++) {
        const px = ((y * SCALE + dy) * w + (x * SCALE + dx)) * 4;
        buf[px] = r;
        buf[px + 1] = g;
        buf[px + 2] = b;
        buf[px + 3] = a;
      }
  };
  return { w, h, buf, set };
}
const _rect = (cv, x, y, rw, rh, col) => {
  for (let j = 0; j < rh; j++)
    for (let i = 0; i < rw; i++) cv.set(x + i, y + j, col);
};
const _stroke = (cv, x, y, rw, rh, col) => {
  for (let i = 1; i < rw - 1; i++) {
    cv.set(x + i, y, col);
    cv.set(x + i, y + rh - 1, col);
  }
  for (let j = 1; j < rh - 1; j++) {
    cv.set(x, y + j, col);
    cv.set(x + rw - 1, y + j, col);
  }
};
// ── Size presets: big (default) / small — toggled via the dropdown row or ~/.claude/swiftbar/.batt-size ──
const SIZE_FILE = `${HOME}/.claude/swiftbar/.batt-size`;
let SIZE = "small";
try {
  if (readFileSync(SIZE_FILE, "utf8").trim() === "big") SIZE = "big";
} catch {}
// ── 숫자 테두리: 밝은 메뉴바에서 노란 숫자가 안 보일 때 검은 1px 외곽선 — ~/.claude/swiftbar/.batt-outline (on/off, 기본 off) ──
const OUTLINE_FILE = `${HOME}/.claude/swiftbar/.batt-outline`;
let OUTLINE = false;
try {
  if (readFileSync(OUTLINE_FILE, "utf8").trim() === "on") OUTLINE = true;
} catch {}

// ── 메뉴바 표시 항목 커스텀 (서비스별) ──────────────────────
// 값: "5h"(기본) | "week"(주간) | "both"(둘 다) | "worst"(더 급한 쪽 하나)
const SWDIR = `${HOME}/.claude/swiftbar`;
const CLAUDE_SHOW_FILE = `${SWDIR}/.batt-claude`;
const CODEX_SHOW_FILE = `${SWDIR}/.batt-codex`;
const VALID_SHOW = ["5h", "week", "both", "worst"];
function readShow(file) {
  try {
    const v = readFileSync(file, "utf8").trim();
    if (VALID_SHOW.includes(v)) return v;
  } catch {}
  return "5h"; // 기본값: 5시간
}
const CLAUDE_SHOW = readShow(CLAUDE_SHOW_FILE);
const CODEX_SHOW = readShow(CODEX_SHOW_FILE);
// 모드에 따라 표시할 캡슐 배열 생성. five/week/fable = {has, remain}(remain은 잔량%, null 허용)
function pickItems(prefix, five, week, fable) {
  const out = [];
  const mode = prefix === "C" ? CLAUDE_SHOW : CODEX_SHOW;
  const add = (tag, r) => out.push({ label: prefix + tag, remain: r });
  if (mode === "both") {
    if (five.has) add("5", five.remain);
    if (week.has) add("W", week.remain);
    if (fable && fable.has) add("F", fable.remain);
  } else if (mode === "week") {
    if (week.has) add("W", week.remain);
    else if (five.has) add("5", five.remain); // 주간 없으면 5h 폴백
  } else if (mode === "worst") {
    const cand = [];
    if (five.has) cand.push(["5", five.remain]);
    if (week.has) cand.push(["W", week.remain]);
    if (fable && fable.has) cand.push(["F", fable.remain]);
    if (cand.length) {
      cand.sort((a, b) => (a[1] ?? 101) - (b[1] ?? 101)); // 잔량 적은 순
      add(cand[0][0], cand[0][1]);
    }
  } else {
    // "5h" 기본
    if (five.has) add("5", five.remain);
    else if (week.has) add("W", week.remain); // 5h 없으면 주간 폴백
  }
  return out;
}

// 4x6 pixel font (big preset)
const FONT46 = {
  0: ["0110", "1001", "1001", "1001", "1001", "0110"],
  1: ["0010", "0110", "0010", "0010", "0010", "0111"],
  2: ["0110", "1001", "0010", "0100", "1000", "1111"],
  3: ["1110", "0001", "0110", "0001", "1001", "0110"],
  4: ["0010", "0110", "1010", "1111", "0010", "0010"],
  5: ["1111", "1000", "1110", "0001", "1001", "0110"],
  6: ["0110", "1000", "1110", "1001", "1001", "0110"],
  7: ["1111", "0001", "0010", "0100", "0100", "0100"],
  8: ["0110", "1001", "0110", "1001", "1001", "0110"],
  9: ["0110", "1001", "1001", "0111", "0001", "0110"],
  C: ["0110", "1001", "1000", "1000", "1001", "0110"],
  X: ["1001", "1001", "0110", "0110", "1001", "1001"],
};
// 3x5 classic pixel font (small preset)
const FONT35 = {
  0: ["111", "101", "101", "101", "111"],
  1: ["010", "110", "010", "010", "111"],
  2: ["111", "001", "111", "100", "111"],
  3: ["111", "001", "111", "001", "111"],
  4: ["101", "101", "111", "001", "001"],
  5: ["111", "100", "111", "001", "111"],
  6: ["111", "100", "111", "101", "111"],
  7: ["111", "001", "001", "001", "001"],
  8: ["111", "101", "111", "101", "111"],
  9: ["111", "101", "111", "001", "111"],
  C: ["111", "100", "100", "100", "111"],
  X: ["101", "101", "010", "101", "101"],
};
// Per-preset geometry: font/advance, capsule (bw×bh), layout (capw·gaps), canvas height, digit y-offset
const PRESET =
  SIZE === "small"
    ? {
        font: FONT35,
        adv: () => 4,
        bw: 14,
        bh: 9,
        capw: 16,
        gap: 3,
        ggap: 7,
        pad: 1,
        lblgap: 2,
        H: 9,
        dy: 2,
      }
    : {
        font: FONT46,
        adv: (ch) => (ch === "1" ? 4 : 5),
        bw: 18,
        bh: 10,
        capw: 20,
        gap: 5,
        ggap: 10,
        pad: 2,
        lblgap: 3,
        H: 12,
        dy: 3,
      };
const NUM = PRESET.font;
// With altCol/boundaryX: pixels left of the fill boundary use altCol (contrast on the bright
// fill), pixels right of it (empty background) use col. Without them: solid col (group labels).
const chAdv = PRESET.adv; // big: 5px ('1' kerns to 4px so "100" doesn't collide), small: 4px
function drawNum(cv, x, y, str, col, altCol, boundaryX) {
  let cx = x;
  for (const ch of str) {
    const g = NUM[ch];
    if (g)
      for (let r = 0; r < g.length; r++)
        for (let c = 0; c < g[r].length; c++)
          if (g[r][c] === "1") {
            const px = cx + c;
            cv.set(px, y + r, altCol && px < boundaryX ? altCol : col);
          }
    cx += chAdv(ch);
  }
  return cx;
}
const numW = (s) => [...s].reduce((w, ch) => w + chAdv(ch), 0) - 1;
// Real macOS battery indicator colors (Apple HIG system colors, dark/light variants)
function heatRemain(r, dark) {
  if (r <= 20) return dark ? [255, 69, 58] : [255, 59, 48]; // systemRed
  if (r < 50) return dark ? [255, 214, 10] : [255, 204, 0]; // systemYellow
  return dark ? [48, 209, 88] : [52, 199, 89]; // systemGreen
}
const heatRemainHex = (r) =>
  r <= 20 ? "#FF453A" : r < 50 ? "#FFD60A" : "#30D158"; // dropdown gauges (dark theme)
// One capsule: outline + remaining fill + the remaining number inside (always shown, incl. 100)
function drawCapsule(cv, x, midY, remain, ink, dark) {
  const bw = PRESET.bw,
    bh = PRESET.bh,
    by = midY - Math.floor(bh / 2);
  _stroke(cv, x, by, bw, bh, ink);
  _rect(cv, x + bw, by + 3, 2, bh - 6, ink); // terminal nub
  if (remain != null) {
    const innerW = bw - 4;
    const v = Math.max(0, Math.min(100, remain));
    const fw = Math.round((v / 100) * innerW);
    if (fw > 0) _rect(cv, x + 2, by + 2, fw, bh - 4, heatRemain(remain, dark));
    const s = String(Math.round(v));
    const tx = x + Math.floor((bw - numW(s)) / 2);
    // Dark digits over the bright fill, ink digits over the empty background → contrast everywhere
    drawNum(
      cv,
      tx,
      midY - PRESET.dy,
      s,
      ink,
      [30, 30, 30],
      x + 2 + (fw > 0 ? fw : 0),
    );
  }
  return x + bw + 2;
}
// SLIM 스타일: 그룹 라벨(C/X) + 잔량 숫자(신호색) + 아래 얇은 밑줄 게이지. 배터리 캡슐 없음.
// ── 예쁜 폰트 글리프 아틀라스 (JetBrains Mono Bold, 안티에일리싱) ──
// 각 글리프 = alpha 바이트(GW×GH), base64. 순수 백엔드로 신호색을 입혀 device 해상도로 블릿.
const GLYPH_SETS = {big:{GW:15,GH:18,g:{"0":"AAAAAFe25vnmtlcAAAAAAAAGtP////////+yBQAAAACP////4sHi////iwAAAA31//9wAQABc///9AwAADb//9AAAAAAANH//zQAAEv//6oAAAAAAKr//0sAAEz//6gAAAAAAKj//0wAAEz//6gAb69vAKj//0wAAEz//6ga////Gqj//0wAAEz//6gDtPe0A6j//0wAAEz//6gAAAAAAKj//0wAAEz//6gAAAAAAKj//0wAAEv//6oAAAAAAKr//0sAADb//9EAAAAAANL//zQAAA31//9zAQABdv//9AwAAACP////4sHj////jAAAAAAGtf////////+0BgAAAAAAAVu55/rnuVsAAAAA","1":"AAAAAABo+P//+AAAAAAAAAAADaf/////+AAAAAAAAAAu2f//////+AAAAAAAAADn///2jv//+AAAAAAAAADs/9AqKP//+AAAAAAAAADqjQYAKP//+AAAAAAAAAA4AAAAKP//+AAAAAAAAAAAAAAAKP//+AAAAAAAAAAAAAAAKP//+AAAAAAAAAAAAAAAKP//+AAAAAAAAAAAAAAAKP//+AAAAAAAAAAAAAAAKP//+AAAAAAAAAAAAAAAKP//+AAAAAAAAAAAAAAAKP//+AAAAAAAAAAAAAAAKP//+AAAAAAAAADA1NTU2v///tTU1KgAAADo/////////////8wAAADo/////////////8wA","2":"AAAAAE+z5fnlsE0AAAAAAAAEqP////////+fAQAAAACL////48Pt////cwAAABL3//+FAgAMtv//5QMAAE3//+MCAAAAJP///x8AADOEhGIAAAAAAv7//y4AAAAAAAAAAAAALP///Q8AAAAAAAAAAAAAov//vQAAAAAAAAAAAABl////PwAAAAAAAAAAAF79//+QAAAAAAAAAAAAX/3//6kCAAAAAAAAAABg/f//qQQAAAAAAAAAAGD9//+jAwAAAAAAAAAAYf3//5wCAAAAAAAAAABh/f//lQEAAAAAAAAAAB/9///6uLi4uLi4uFMAACj//////////////3QAACj//////////////3QA","3":"AADg////////////rAAAAADg////////////rAAAAAChuLi4uLi4+P//mAAAAAAAAAAAAAKV//+xCAAAAAAAAAAABaf//6EEAAAAAAAAAAAKtv//jwEAAAAAAAAAAADA///XQAIAAAAAAAAAAAD0/////9xAAAAAAAAAAAD0///////6OwAAAAAAAAAAAAg70///ywAAAAAAAAAAAAAALv///xYAAAAAAAAAAAAAAfj//zAAABcsLBwAAAAAAPT//zMAAHn//78AAAAAFP///yUAAEb///5WAAAIo///7wQAAAPS////2cHr////hAAAAAAk3/////////+rBQAAAAAADnnK8vvptVMAAAAA","4":"AAAAAAAAACj3//9eAAAAAAAAAAAABMr//7MAAAAAAAAAAAAAfv//7xoAAAAAAAAAAAAy+v//XgAAAAAAAAAAAAfV//+0AAAAAAAAAAAAAIz//+8aAAAAAAAAAAAAPf3//18AAAAAAAAAAAAM3f//tAAAdP//tAAAAACa///vGgAAdP//tAAAAEf///9fAAAAdP//tAAAAIj//7YAAAAAdP//tAAAAIj//3gAAAAAdP//tAAAAIj/////////////tAAAAIj/////////////tAAAAGbAwMDAwMDA3f//tAAAAAAAAAAAAAAAdP//tAAAAAAAAAAAAAAAdP//tAAAAAAAAAAAAAAAdP//tAAA","5":"AADU////////////lAAAAADU////////////lAAAAADU///BuLi4uLi4agAAAADU//8hAAAAAAAAAAAAAADU//8jAAAAAAAAAAAAAADU//8mAAAAAAAAAAAAAADU///DuLameyUAAAAAAADU//////////2DAAAAAADU////////////agAAAAAAAAAAAAUyxv//5wEAAAAAAAAAAAAAG////yYAAAAAAAAAAAAAAOb//zwAABc0NCMAAAAAAOH//z8AAGT//84AAAAACPv//y8AADH///9oAAAElP//9AcAAADA////3sHm////iwAAAAAZ1f////////+0BgAAAAAACXDF8PvruVoBAAAA","6":"AAAAAAAASP///z4AAAAAAAAAAAAD1f//ogAAAAAAAAAAAABq///vFgAAAAAAAAAAAA/r//9qAAAAAAAAAAAAAIz//8sCAAAAAAAAAAAAI/n//TQAAAAAAAAAAAAArv//li5UQA0AAAAAAAA4///5xP////J7AQAAAAC3////////////iAAAACH+//+0LwsvtP///SMAAG3//9MFAAAABdP//3cAAJ3//4IAAAAAAIT//5sAAKD//3cAAAAAAHf//6AAAIL//7MAAAAAALP//4IAADT///9uAQABbv///zMAAACx////5MLk////sAAAAAAQv/////////+/DwAAAAAAAl255vnmuV0CAAAA","7":"AFT///////////////8AAFT///////////////8AAFT///G4uLi4uNf///sAAFT//8wAAAAAALj//6gAAFT//8wAAAAAKP7//zkAADWkpIIAAAAAl///ygAAAAAAAAAAAAAR9f//WwAAAAAAAAAAAAB3///mBQAAAAAAAAAAAATi//99AAAAAAAAAAAAAFb///gWAAAAAAAAAAAAAMb//58AAAAAAAAAAAAANf///zEAAAAAAAAAAAAApv//wQAAAAAAAAAAAAAa+v//UgAAAAAAAAAAAACF///gAwAAAAAAAAAAAAjr//90AAAAAAAAAAAAAGX///QRAAAAAAAAAAAAANP//5cAAAAAAAAA","8":"AAAAAVy46ProuFwBAAAAAAAJvP////////+/CgAAAACV////4sHj////mQAAAAX4//9+AgACgP//+gcAAB7///IBAAAAAvL//yIAAAX6//kNAAAADfr/+wcAAACT//+5LQgtu///lAAAAAAHnPv///////ucBwAAAAAAPL3//////708AAAAAABn/f//4sLj///9ZAAAACD5//1gAAAAYP3/+B8AAH3//50AAAAAAJ3//3wAAKH//2wAAAAAAGz//6AAAJH//5gAAAAAAJn//48AAFP///xZAAAAWfz//1EAAAPO////4cHh////ywIAAAAazv/////////NGQAAAAAABGW85/rnu2MEAAAA","9":"AAAAA2G65vnkt1oBAAAAAAAWyf////////+9DgAAAAHD////4cLh////rQAAAEX///1dAAAAXf3//zEAAIr//58AAAAAAKD//4AAAKT//3MAAAAAAHT//58AAJH//6AAAAAAAKD//5sAAFT///1aAAAAWv3//2oAAAXW////4MHg/////R4AAAAn4f//////////tQAAAAAAEYTX9+zW////OAAAAAAAAAAAAA3o//+tAAAAAAAAAAAAAIf///kjAAAAAAAAAAAAHvf//4sAAAAAAAAAAAAAp///6w8AAAAAAAAAAAA4////aQAAAAAAAAAAAADG///VAwAAAAAAAAAAAFj///9IAAAAAAAA","C":"AAAAAEGn4fjrxW8GAAAAAAAAjf/////////TFwAAAABg////7MLY////vgAAAADS//+sCQAAVv///zQAAAX9//8nAAAAAMf//2kAABf///8JAAAAACU4OBsAABj///8IAAAAAAAAAAAAABj///8IAAAAAAAAAAAAABj///8IAAAAAAAAAAAAABj///8IAAAAAAAAAAAAABj///8IAAAAAAAAAAAAABj///8IAAAAAAAAAAAAABf///8JAAAAACtAQB8AAAX9//8nAAAAAMj//2gAAADS//+pCAAAVv///zMAAABi////68LX////vgAAAAAAkf/////////TFwAAAAAAAEWq4/nsxW8HAAAA","X":"ALv//8AAAAAAAKr//7kAADL+//9CAAAALf7//jAAAACn///DAAAAr///owAAAAAi+v//RgAy///4HwAAAAAAkv//xgCz//+MAAAAAAAAFfL//2z//+8RAAAAAAAAAH7///z//3UAAAAAAAAAAAvo////4QgAAAAAAAAAAABv////aQAAAAAAAAAAAACj////rAAAAAAAAAAAADH+/////zgAAAAAAAAAALv//9D//8IAAAAAAAAASP//6R31//9NAAAAAAAC0v//dACK///VAwAAAABh///lCQAT8f//ZAAAAAnj//9nAAAAgP//5QoAAHr//9wEAAAADu3//3oAFPH//1sAAAAAAHb///EU","-":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAXLi4uLi4uLhcAAAAAAAAgP////////+AAAAAAAAAgP////////+AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}},small:{GW:11,GH:13,g:{"0":"AAAeoef53ooMAAAAG+j///7//8kFAACM/9gsA0Lz/1gAAL7/aAAAAJz/igAAyP9YAAAAjP+UAADI/1iE5FuM/5QAAMj/WI32X4z/lAAAyP9YAAAAjP+UAADI/1gAAACM/5QAAL7/aAAAAJz/igAAjf/YKwNC8/9ZAAAc6f///v//ywYAAAAfouf534sNAAA=","1":"AAAAQeb//zAAAAAAAn79////MAAAAAB1//6d//8wAAAAAIDpSRD//zAAAAAARRcAEP//MAAAAAAAAAAQ//8wAAAAAAAAABD//zAAAAAAAAAAEP//MAAAAAAAAAAQ//8wAAAAAAAAABD//zAAAAAAAwgIF///NggHAAB8//////////AAAHz/////////8AA=","2":"AAAZneb424EIAAAAGeX///7//7sBAACS/+QwBmv//0cAAMn8eAAAANr/eQAAAAAAAAAA4f9sAAAAAAAAAFH//SEAAAAAAAA08f+QAAAAAAAANO//uQUAAAAAADTv/7kJAAAAAAA07/+zBwAAAAAANO//rgUAAAAAAACr///5+Pj4+KoAAKz/////////sAA=","3":"AHj/////////IAAAdPj4+Pj6//8eAAAAAAAAGNL/eQAAAAAAACHc/WgAAAAAAAAk5v+GAQAAAAAAAFz////ZNAAAAAAALHyF0//pEQAAAAAAAAAM7P9bAAAAAAAAAADF/30AAKq8SgAAAND/egAAvf/NIgRe/v9PAAA++////v//xwMAAAAvsOT11H0KAAA=","4":"AAAAAABx//EfAAAAAAAAMPj/WwAAAAAAAArX/6UAAAAAAAAAm//gDwAAAAAAAFP//TwAAAAAAAAd7v+EACD//yQAAL7/yQQAIP//JAAA8P9BAAAg//8kAADw//n4+Pn//yQAAPD/////////JAAAAAAAAAAg//8kAAAAAAAAACD//yQAAAAAAAAAIP//JAA=","5":"AHD/////////DAAAcP/9+Pj4+PgLAABw/7AAAAAAAAAAAHD/sQAAAAAAAAAAcP+zAAAAAAAAAABw////+tuVFgAAAGz4+Pj8///fDAAAAAAAAAJH+P9kAAAAAAAAAAC9/4gAAICUPQAAAL3/hwAAuf/LIQNI9/9hAAA++v///v//2AkAAAAvreP214oRAAA=","6":"AAAAADz//0wAAAAAAAABy/+3AAAAAAAAAF3/+icAAAAAAAAJ4/+LAAAAAAAAAH3/5w0AAAAAAAAP8v+93fXDPAAAAHn//9+76//5LgAA2P+oBAAP0f+fAAT+/zwAAABx/80AAPX/SwAAAID/xQAAsv/TKwRC7v+EAAAp8f///v//2xEAAAAkpej535ARAAA=","7":"AMz//////////xQAzP/7+Pj4+v//EwDM/3QAAACU/9cBAMz/dAAAD/P/agAADxQJAABz/+8LAAAAAAAAA9//jQAAAAAAAABS//0hAAAAAAAAAML/rwAAAAAAAAAx//9BAAAAAAAAAKH/0gAAAAAAAAAX+f9kAAAAAAAAAIH/7AkAAAAAAAAH6f+HAAAAAAA=","8":"AAAio+j5344RAAAAH+v///7//9IHAACJ/+ArA0b2/1kAAKD/kQAAAML/bwAAWv/gKwJG9vwrAAAAc+v//v/bUAAAAAqm/P////WBAAAAmf/SMgpH7P9iAADy/0QAAAB1/74AA/z/QAAAAHH/ywAAx//LKAM85/+RAAA59////v//4hgAAAAqp+j54ZQVAAA=","9":"AAAmpOf43owPAAAAL/T///7//9YNAAC7/80pBD7q/3wAAfn/RQAAAHn/wQAD/P9EAAAAef/PAADH/8wnAzzp/6QAAD/7///+////RwAAADm99Oj3/9AAAAAAAAAATP//TAAAAAAAAATY/7wAAAAAAAAAbv/9LwAAAAAAABHt/5wAAAAAAAAAkP/zGAAAAAA=","C":"AAATkuH55JkYAAAADNf///7//+ATAABp//Q+AzPr/3wAAJf/rAAAAHfEgwAAoP+gAAAAAAAAAACg/6AAAAAAAAAAAKD/oAAAAAAAAAAAoP+gAAAAAAAAAACg/6AAAAAAAAAAAJf/rAAAAHrIhQAAav/0PgIy6/98AAAN2f///v//4RMAAAAUluP55p0ZAAA=","X":"E/H/egAAAKH/zQEAfP/sDAAk/P9FAAAL5/94AKH/vAAAAABr/+ss/P40AAAAAAXc/+D/qQAAAAAAAFr///skAAAAAAAACfb/zAAAAAAAAAB1////RQAAAAAAE+//wf/QAgAAAACQ/8sY9f9fAAAAI/n/RQCI/+IIAACs/78AABHw/3gAOf//OAAAAHv/8RQ=","-":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB4+Pj4+PhFAAAAAHz//////0gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="}}};
const _GS = GLYPH_SETS[SIZE] || GLYPH_SETS.big;
const GW = _GS.GW, GH = _GS.GH;
const IH = Math.round(GH * 1.8); // 아이콘 높이 (숫자 축소분 보정 → 아이콘 크기 유지)
const GLYPH_BYTES = Object.fromEntries(
  Object.entries(_GS.g).map(([k, v]) => [k, Buffer.from(v, "base64")]),
);
function _blit(buf, DW, DH, x, y, ch, color) {
  const g = GLYPH_BYTES[ch];
  if (!g) return;
  const [r, gg, b] = color;
  for (let gy = 0; gy < GH; gy++)
    for (let gx = 0; gx < GW; gx++) {
      const a = g[gy * GW + gx];
      if (!a) continue;
      const px = x + gx,
        py = y + gy;
      if (px < 0 || py < 0 || px >= DW || py >= DH) continue;
      const o = (py * DW + px) * 4;
      const ba = buf[o + 3];
      if (ba === 0) {
        buf[o] = r; buf[o + 1] = gg; buf[o + 2] = b; buf[o + 3] = a;
      } else {
        const af = a / 255, ia = 1 - af;
        buf[o] = Math.round(r * af + buf[o] * ia);
        buf[o + 1] = Math.round(gg * af + buf[o + 1] * ia);
        buf[o + 2] = Math.round(b * af + buf[o + 2] * ia);
        buf[o + 3] = Math.max(ba, a);
      }
    }
}
// 글리프를 8방향 1px 오프셋으로 먼저 외곽선색으로 찍고 그 위에 본색을 얹어 테두리 효과
function _blitOutlined(buf, DW, DH, x, y, ch, color, outline) {
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++)
      if (dx || dy) _blit(buf, DW, DH, x + dx, y + dy, ch, outline);
  _blit(buf, DW, DH, x, y, ch, color);
}
function _fill(buf, DW, DH, x, y, w, h, color) {
  const [r, g, b] = color;
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const px = x + i, py = y + j;
      if (px < 0 || py < 0 || px >= DW || py >= DH) continue;
      const o = (py * DW + px) * 4;
      buf[o] = r; buf[o + 1] = g; buf[o + 2] = b; buf[o + 3] = 255;
    }
}
// SLIM 스타일(예쁜 폰트): 라벨(C/X) + 잔량 숫자(신호색) + 아래 얇은 밑줄 게이지. device 해상도 렌더링.
// ── 커스텀 아이콘: ~/.claude/swiftbar/icon-claude.png · icon-codex.png 있으면 라벨로 사용 ──
// 자체 PNG 디코더(8-bit, colorType 0/2/3/4/6, non-interlaced) + 면적평균 리사이즈 + 알파 합성. 의존성 0.
function decodePNG(buf) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) return null;
  let p = 8, w = 0, h = 0, bitDepth = 0, colorType = 0, interlace = 0;
  let idat = [], plte = null, trns = null;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const d = p + 8;
    if (type === "IHDR") { w = buf.readUInt32BE(d); h = buf.readUInt32BE(d + 4); bitDepth = buf[d + 8]; colorType = buf[d + 9]; interlace = buf[d + 12]; }
    else if (type === "PLTE") plte = buf.subarray(d, d + len);
    else if (type === "tRNS") trns = buf.subarray(d, d + len);
    else if (type === "IDAT") idat.push(buf.subarray(d, d + len));
    else if (type === "IEND") break;
    p = d + len + 4;
  }
  if (bitDepth !== 8 || interlace !== 0) return null;
  const ch = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0;
  if (!ch) return null;
  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(idat)); } catch { return null; }
  const stride = w * ch;
  const out = Buffer.alloc(stride * h);
  const paeth = (a, b, c) => { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  let ri = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[ri++];
    for (let x = 0; x < stride; x++) {
      const v = raw[ri++];
      const a = x >= ch ? out[y * stride + x - ch] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= ch && y > 0 ? out[(y - 1) * stride + x - ch] : 0;
      let r;
      if (f === 0) r = v; else if (f === 1) r = v + a; else if (f === 2) r = v + b; else if (f === 3) r = v + ((a + b) >> 1); else if (f === 4) r = v + paeth(a, b, c); else return null;
      out[y * stride + x] = r & 255;
    }
  }
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    let R, G, B, A = 255;
    if (colorType === 0) { R = G = B = out[i]; if (trns && trns.length >= 2 && out[i] === trns[1]) A = 0; }
    else if (colorType === 2) { R = out[i * 3]; G = out[i * 3 + 1]; B = out[i * 3 + 2]; if (trns && trns.length >= 6 && R === trns[1] && G === trns[3] && B === trns[5]) A = 0; }
    else if (colorType === 3) { const idx = out[i]; R = plte[idx * 3]; G = plte[idx * 3 + 1]; B = plte[idx * 3 + 2]; A = trns && idx < trns.length ? trns[idx] : 255; }
    else if (colorType === 4) { R = G = B = out[i * 2]; A = out[i * 2 + 1]; }
    else { R = out[i * 4]; G = out[i * 4 + 1]; B = out[i * 4 + 2]; A = out[i * 4 + 3]; }
    rgba[i * 4] = R; rgba[i * 4 + 1] = G; rgba[i * 4 + 2] = B; rgba[i * 4 + 3] = A;
  }
  return { w, h, rgba };
}
function resizeRGBA(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  for (let dy = 0; dy < dh; dy++) {
    const sy0 = Math.floor((dy * sh) / dh), sy1 = Math.max(sy0 + 1, Math.floor(((dy + 1) * sh) / dh));
    for (let dx = 0; dx < dw; dx++) {
      const sx0 = Math.floor((dx * sw) / dw), sx1 = Math.max(sx0 + 1, Math.floor(((dx + 1) * sw) / dw));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = sy0; sy < sy1; sy++) for (let sx = sx0; sx < sx1; sx++) {
        const o = (sy * sw + sx) * 4, al = src[o + 3];
        r += src[o] * al; g += src[o + 1] * al; b += src[o + 2] * al; a += al; n++;
      }
      const oo = (dy * dw + dx) * 4;
      if (a > 0) { out[oo] = Math.round(r / a); out[oo + 1] = Math.round(g / a); out[oo + 2] = Math.round(b / a); out[oo + 3] = Math.round(a / n); }
      else { out[oo] = out[oo + 1] = out[oo + 2] = out[oo + 3] = 0; }
    }
  }
  return out;
}
function _blitRGBA(buf, DW, DH, x, y, src, sw, sh) {
  for (let sy = 0; sy < sh; sy++) for (let sx = 0; sx < sw; sx++) {
    const so = (sy * sw + sx) * 4, a = src[so + 3];
    if (!a) continue;
    const px = x + sx, py = y + sy;
    if (px < 0 || py < 0 || px >= DW || py >= DH) continue;
    const o = (py * DW + px) * 4, ba = buf[o + 3];
    if (ba === 0) { buf[o] = src[so]; buf[o + 1] = src[so + 1]; buf[o + 2] = src[so + 2]; buf[o + 3] = a; }
    else { const af = a / 255, ia = 1 - af; buf[o] = Math.round(src[so] * af + buf[o] * ia); buf[o + 1] = Math.round(src[so + 1] * af + buf[o + 1] * ia); buf[o + 2] = Math.round(src[so + 2] * af + buf[o + 2] * ia); buf[o + 3] = Math.max(ba, a); }
  }
}
function _blitTinted(buf, DW, DH, x, y, src, sw, sh, color) {
  const [r, g, b] = color;
  for (let sy = 0; sy < sh; sy++) for (let sx = 0; sx < sw; sx++) {
    const a = src[(sy * sw + sx) * 4 + 3];
    if (!a) continue;
    const px = x + sx, py = y + sy;
    if (px < 0 || py < 0 || px >= DW || py >= DH) continue;
    const o = (py * DW + px) * 4, ba = buf[o + 3];
    if (ba === 0) { buf[o] = r; buf[o + 1] = g; buf[o + 2] = b; buf[o + 3] = a; }
    else { const af = a / 255, ia = 1 - af; buf[o] = Math.round(r * af + buf[o] * ia); buf[o + 1] = Math.round(g * af + buf[o + 1] * ia); buf[o + 2] = Math.round(b * af + buf[o + 2] * ia); buf[o + 3] = Math.max(ba, a); }
  }
}
const ICON_FILES = { C: `${SWDIR}/icon-claude.png`, X: `${SWDIR}/icon-codex.png` };
function loadIcon(prefix) {
  try {
    const dec = decodePNG(readFileSync(ICON_FILES[prefix]));
    if (!dec) return null;
    const dh = IH;
    let dw = Math.round((IH * dec.w) / dec.h);
    dw = Math.max(1, Math.min(dw, IH * 2));
    const rgba = resizeRGBA(dec.rgba, dec.w, dec.h, dw, dh);
    // 단색 실루엣이면서 (거의 검정 또는 거의 흰색)이면 테마색으로 tint → 다크/라이트 어디서나 보이게
    let mono = true, c0 = null;
    for (let i = 0; i < dw * dh; i++) {
      if (rgba[i * 4 + 3] < 128) continue;
      const R = rgba[i * 4], G = rgba[i * 4 + 1], B = rgba[i * 4 + 2];
      if (!c0) c0 = [R, G, B];
      else if (Math.abs(R - c0[0]) > 28 || Math.abs(G - c0[1]) > 28 || Math.abs(B - c0[2]) > 28) { mono = false; break; }
    }
    let tint = false;
    if (mono && c0) {
      const mx = Math.max(c0[0], c0[1], c0[2]), mn = Math.min(c0[0], c0[1], c0[2]);
      if (mx < 60 || mn > 200) tint = true; // 거의 검정 / 거의 흰색
    }
    return { rgba, w: dw, h: dh, tint };
  } catch {
    return null;
  }
}
const LABEL_ASSET = { C: loadIcon("C"), X: loadIcon("X") };

// SLIM 스타일: 라벨(아이콘 또는 C/X) + 잔량 숫자(신호색) + 얇은 밑줄 게이지. device 해상도.
// SLIM 스타일: 라벨(아이콘/C·X) + 잔량 숫자(신호색) + 얇은 밑줄 게이지. 아이콘은 세로 중앙정렬.
function renderBatteryImage(dark, items) {
  const ink = dark ? [235, 235, 235] : [45, 45, 45];
  const dim = dark ? [92, 92, 96] : [176, 176, 182];
  const small = SIZE === "small";
  const PAD = 2, LBLGAP = small ? 2 : 3, ITEMGAP = small ? 3 : 4, GGAP = small ? 6 : 9, VGAP = small ? 2 : 3, BARH = small ? 3 : 4;
  const labelW = (g) => (LABEL_ASSET[g] ? LABEL_ASSET[g].w : GW);
  const numStr = (r) => (r == null ? "-" : String(Math.round(r)));
  const itemW = (r) => GW * numStr(r).length;
  let W = PAD * 2, pg = null;
  for (const it of items) {
    const g = it.label[0];
    if (g !== pg) { if (pg !== null) W += GGAP; W += labelW(g) + LBLGAP; pg = g; }
    else W += ITEMGAP;
    W += itemW(it.remain);
  }
  const blockH = GH + VGAP + BARH; // 숫자+게이지 묶음 높이
  const contentH = Math.max(blockH, IH);
  const numY = PAD + Math.round((contentH - blockH) / 2);
  const iconY = PAD + Math.round((contentH - IH) / 2);
  const barY = numY + GH + VGAP;
  const DW = Math.max(W, 8), DH = PAD + contentH + PAD;
  const buf = Buffer.alloc(DW * DH * 4, 0);
  let x = PAD; pg = null;
  for (const it of items) {
    const g = it.label[0];
    if (g !== pg) {
      if (pg !== null) x += GGAP;
      const ic = LABEL_ASSET[g];
      if (ic && ic.tint) _blitTinted(buf, DW, DH, x, iconY, ic.rgba, ic.w, ic.h, ink);
      else if (ic) _blitRGBA(buf, DW, DH, x, iconY, ic.rgba, ic.w, ic.h);
      else _blit(buf, DW, DH, x, numY, g, ink);
      x += labelW(g) + LBLGAP;
      pg = g;
    } else x += ITEMGAP;
    const r = it.remain;
    if (r == null) {
      _blit(buf, DW, DH, x, numY, "-", dim);
      _fill(buf, DW, DH, x, barY, GW, BARH, dim);
      x += GW;
    } else {
      const col = heatRemain(r, dark);
      const s = String(Math.round(r));
      for (let i = 0; i < s.length; i++)
        if (OUTLINE) _blitOutlined(buf, DW, DH, x + i * GW, numY, s[i], col, [0, 0, 0]);
        else _blit(buf, DW, DH, x + i * GW, numY, s[i], col);
      const w = GW * s.length;
      _fill(buf, DW, DH, x, barY, w, BARH, dim);
      const v = Math.max(0, Math.min(100, r));
      const fw = Math.round((v / 100) * w);
      if (fw > 0) _fill(buf, DW, DH, x, barY, fw, BARH, col);
      x += w;
    }
  }
  return encodePNG(DW, DH, buf).toString("base64");
}
function isDarkMode() {
  try {
    return (
      execSync("defaults read -g AppleInterfaceStyle 2>/dev/null", {
        encoding: "utf8",
        timeout: 3000,
      }).trim() === "Dark"
    );
  } catch {
    return false;
  }
}

// ── Gauge renderer (partial blocks, zero dependencies) ──────────
const FULL = "█",
  EMPTY = "░",
  PART = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];
function bar(pct, w) {
  pct = Math.max(0, Math.min(100, pct || 0));
  const filled = (pct / 100) * w;
  let fb = Math.floor(filled);
  let idx = Math.round((filled - fb) * 8);
  if (idx === 8) {
    fb++;
    idx = 0;
  }
  fb = Math.min(fb, w);
  let s = FULL.repeat(fb),
    used = fb;
  if (idx > 0 && fb < w) {
    s += PART[idx];
    used++;
  }
  s += EMPTY.repeat(Math.max(0, w - used));
  return s;
}
// Usage % → traffic-light color (GitHub palette)
function heat(pct) {
  if (pct >= 80) return "#f85149"; // red
  if (pct >= 50) return "#d29922"; // amber
  return "#3fb950"; // green
}

// ── Shared utils ──────────────────────────────────────────────
const fmtDur = (secs) => {
  if (secs <= 0) return "0m";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};
const fmtTok = (n) => {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return `${n}`;
};

// ── 1. Claude Code: active 5-hour block ────────────────────────
function getClaude() {
  try {
    const raw = execSync(`${CCUSAGE} blocks --active --json`, {
      encoding: "utf8",
      timeout: 20000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const data = JSON.parse(raw);
    const b =
      (data.blocks || []).find((x) => x.isActive) || (data.blocks || [])[0];
    if (!b) return null;
    const startTs = Math.floor(new Date(b.startTime).getTime() / 1000);
    const endTs = Math.floor(new Date(b.endTime).getTime() / 1000);
    const span = Math.max(1, endTs - startTs);
    const elapsedPct = Math.max(
      0,
      Math.min(100, ((now - startTs) / span) * 100),
    );
    return {
      elapsedPct,
      remainMin:
        b.projection?.remainingMinutes ??
        Math.max(0, Math.floor((endTs - now) / 60)),
      cost: b.costUSD || 0,
      tokens: b.totalTokens || 0,
      projCost: b.projection?.totalCost ?? null,
      costPerHour: b.burnRate?.costPerHour ?? null,
    };
  } catch (e) {
    return { error: String(e.message || e).split("\n")[0] };
  }
}

// ── 1b. Claude usage by model today (Opus/Sonnet/Fable/Haiku) ──
const MODEL_NAMES = {
  "claude-fable-5": "Fable 5",
  "claude-opus-4-8": "Opus 4.8",
  "claude-opus-4-7": "Opus 4.7",
  "claude-sonnet-5": "Sonnet 5",
  "claude-haiku-4-5-20251001": "Haiku 4.5",
};
const shortModel = (n) => MODEL_NAMES[n] || (n || "").replace("claude-", "");
function getClaudeModels() {
  try {
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    const raw = execSync(`${CCUSAGE} daily --breakdown --json --since ${ymd}`, {
      encoding: "utf8",
      timeout: 20000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const day = (JSON.parse(raw).daily || []).slice(-1)[0];
    if (!day) return null;
    const models = (day.modelBreakdowns || [])
      .map((m) => ({
        name: m.modelName,
        cost: m.cost || 0,
        tokens:
          (m.inputTokens || 0) +
          (m.outputTokens || 0) +
          (m.cacheCreationTokens || 0) +
          (m.cacheReadTokens || 0),
      }))
      .filter((m) => m.cost > 0.005)
      .sort((a, b) => b.cost - a.cost);
    if (!models.length) return null;
    return { models, total: models.reduce((s, m) => s + m.cost, 0) };
  } catch {
    return null;
  }
}

// ── 1c. Claude real rate limits — queried live from Anthropic's OAuth usage API ──
// Uses this Mac's Claude Code login token (Keychain) to fetch the same data /usage shows.
// Numbers are account-level, so usage from every device/surface is included.
// Fallbacks on failure: own cache (last good response) → legacy usage-cache.json files.
const CLAUDE_STATE_DIR = `${HOME}/.claude/swiftbar`;
const CLAUDE_USAGE_CACHE = `${CLAUDE_STATE_DIR}/.claude-usage.json`;
// Codex also supports live account-level queries: GET the ChatGPT usage endpoint
// (/backend-api/wham/usage) that Codex CLI itself polls every 60s, using the auth.json token.
// The response reports current limits without spending tokens, so it beats session logs
// (which are local and differ per machine).
const CODEX_AUTH = `${HOME}/.codex/auth.json`;
const CODEX_USAGE_CACHE = `${CLAUDE_STATE_DIR}/.codex-usage.json`;
const LEGACY_USAGE_FILES = [
  `${HOME}/.claude/MEMORY/STATE/usage-cache.json`,
  `${HOME}/.claude/PAI/MEMORY/STATE/usage-cache.json`,
];

// The token exists only as a return value — never written to files, logs, or process args
function readClaudeToken() {
  // Opt-out: `touch ~/.claude/swiftbar/.no-live` disables Keychain access / live queries
  // — clicking 'Deny' on the Keychain prompt would re-prompt every 2 minutes; use this instead.
  if (existsSync(`${CLAUDE_STATE_DIR}/.no-live`)) return null;
  try {
    if (process.platform !== "darwin") throw new Error("no keychain");
    const raw = execSync(
      'security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null',
      { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    const t = JSON.parse(raw)?.claudeAiOauth?.accessToken;
    if (t) return t;
  } catch {}
  try {
    // For environments without the Keychain item (e.g. manual migration) — file credentials
    const raw = readFileSync(`${HOME}/.claude/.credentials.json`, "utf8");
    return JSON.parse(raw)?.claudeAiOauth?.accessToken ?? null;
  } catch {}
  return null;
}

function fetchClaudeUsageLive() {
  const token = readClaudeToken();
  if (!token) return null;
  try {
    // Authorization header passed via stdin (-H @-) — keeps the token out of `ps` output
    const raw = execSync(
      `/usr/bin/curl -fsS --max-time 5 -H @- -H "anthropic-beta: oauth-2025-04-20" https://api.anthropic.com/api/oauth/usage`,
      {
        encoding: "utf8",
        timeout: 8000,
        input: `Authorization: Bearer ${token}\n`,
        stdio: ["pipe", "pipe", "ignore"],
      },
    );
    const d = JSON.parse(raw);
    if (!d?.five_hour) return null;
    try {
      mkdirSync(CLAUDE_STATE_DIR, { recursive: true });
      writeFileSync(
        CLAUDE_USAGE_CACHE,
        JSON.stringify({ fetchedAt: Math.floor(Date.now() / 1000), data: d }),
      );
    } catch {}
    return { data: d, measuredAt: Math.floor(Date.now() / 1000), live: true };
  } catch {
    return null;
  }
}

function readClaudeUsageFallback() {
  try {
    const c = JSON.parse(readFileSync(CLAUDE_USAGE_CACHE, "utf8"));
    if (c?.data?.five_hour)
      return { data: c.data, measuredAt: c.fetchedAt ?? 0, live: false };
  } catch {}
  for (const f of LEGACY_USAGE_FILES) {
    try {
      const d = JSON.parse(readFileSync(f, "utf8"));
      if (d?.five_hour)
        return {
          data: d,
          measuredAt: Math.floor(statSync(f).mtimeMs / 1000),
          live: false,
        };
    } catch {}
  }
  return null;
}

// 5-hour session / weekly overall / Fable weekly (weekly_scoped) utilization
function getClaudeUsage() {
  const src = fetchClaudeUsageLive() ?? readClaudeUsageFallback();
  if (!src) return null;
  const { data: d, measuredAt, live } = src;
  try {
    const toTs = (iso) => (iso ? Math.floor(Date.parse(iso) / 1000) : null);
    const win = (o) =>
      o ? { pct: o.utilization ?? 0, resetsAt: toTs(o.resets_at) } : null;
    // Weekly scoped cap for Fable (or whichever top model)
    let fable = null;
    for (const l of d.limits || []) {
      const mdl = l.scope?.model?.display_name;
      if (l.group === "weekly" && mdl) {
        fable = {
          pct: l.percent ?? 0,
          resetsAt: toTs(l.resets_at),
          model: mdl,
        };
        break;
      }
    }
    return {
      measuredAt,
      live,
      fiveHour: win(d.five_hour),
      weekly: win(d.seven_day),
      fable,
    };
  } catch {
    return null;
  }
}

// ── 2. Codex: freshest rate_limits ──────────────────────────────
function walkJsonl(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) walkJsonl(p, out);
    else if (ent.name.endsWith(".jsonl")) {
      try {
        out.push({ path: p, mtime: statSync(p).mtimeMs });
      } catch {}
    }
  }
}
// Read the ChatGPT token from auth.json (.no-live disables live queries, same switch as Claude)
function readCodexToken() {
  if (existsSync(`${CLAUDE_STATE_DIR}/.no-live`)) return null;
  try {
    const d = JSON.parse(readFileSync(CODEX_AUTH, "utf8"));
    const t = d?.tokens?.access_token;
    if (t) return { token: t, account: d?.tokens?.account_id || "" };
  } catch {}
  return null;
}

// Live: GET the ChatGPT usage endpoint directly → account-level current limits (same on
// every device). Field names differ from session logs (primary_window/limit_window_seconds/
// reset_at), so normalize to the session-log shape (primary/window_minutes/resets_at).
function fetchCodexUsageLive() {
  const c = readCodexToken();
  if (!c) return null;
  try {
    // Authorization via stdin (-H @-) — keeps the token out of `ps` (same pattern as Claude)
    const raw = execSync(
      `/usr/bin/curl -fsS --max-time 5 -H @- -H "ChatGPT-Account-Id: ${c.account}" -H "User-Agent: codex-cli" https://chatgpt.com/backend-api/wham/usage`,
      {
        encoding: "utf8",
        timeout: 8000,
        input: `Authorization: Bearer ${c.token}\n`,
        stdio: ["pipe", "pipe", "ignore"],
      },
    );
    const d = JSON.parse(raw);
    const rl = d?.rate_limit;
    const norm = (w) =>
      w
        ? {
            used_percent: w.used_percent ?? 0,
            window_minutes: w.limit_window_seconds
              ? Math.round(w.limit_window_seconds / 60)
              : null,
            resets_at: w.reset_at ?? null,
          }
        : null;
    // primary_window/secondary_window aren't fixed "5h/weekly" — they're whatever windows are
    // active right now (with no recent 5h usage, the weekly window can arrive as primary).
    // Classify by limit_window_seconds into the right slot (5h=primary / weekly=secondary).
    let primary = null;
    let secondary = null;
    for (const w of [rl?.primary_window, rl?.secondary_window]) {
      if (!w) continue;
      const secs = w.limit_window_seconds || 0;
      if (secs && secs <= 6 * 3600)
        primary = norm(w); // ~5 hours
      else secondary = norm(w); // ~weekly (7 days)
    }
    // credits only matter when no windows at all (premium pay-per-use). Same as session logs.
    const credits =
      !primary && !secondary && d?.credits
        ? {
            has_credits: d.credits.has_credits,
            unlimited: d.credits.unlimited,
            balance: d.credits.balance,
          }
        : null;
    if (!primary && !secondary && !credits) return null;
    const result = {
      measuredAt: Math.floor(Date.now() / 1000),
      live: true,
      limitId: null,
      plan: d?.plan_type || null,
      primary,
      secondary,
      credits,
    };
    try {
      mkdirSync(CLAUDE_STATE_DIR, { recursive: true });
      writeFileSync(CODEX_USAGE_CACHE, JSON.stringify(result));
    } catch {}
    return result;
  } catch {
    return null;
  }
}

function getCodexFromSessions() {
  if (!existsSync(CODEX_SESSIONS)) return null;
  const files = [];
  walkJsonl(CODEX_SESSIONS, files);
  files.sort((a, b) => b.mtime - a.mtime);
  for (const f of files.slice(0, 8)) {
    try {
      const lines = readFileSync(f.path, "utf8").trim().split("\n");
      for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i].includes("rate_limits")) continue;
        let obj;
        try {
          obj = JSON.parse(lines[i]);
        } catch {
          continue;
        }
        const rl = obj.payload?.rate_limits ?? obj.rate_limits;
        // prolite=primary/secondary (%), premium=credits (balance) — either shape is valid
        if (rl && (rl.primary || rl.secondary || rl.credits)) {
          return {
            measuredAt: Math.floor(f.mtime / 1000),
            live: false,
            limitId: rl.limit_id || null,
            plan: rl.plan_type || null,
            primary: rl.primary || null,
            secondary: rl.secondary || null,
            credits: rl.credits || null,
          };
        }
      }
    } catch {}
  }
  return null;
}

// Live (account-level, same on every device) first → local session logs → last live cache.
function getCodex() {
  const live = fetchCodexUsageLive();
  if (live) return live;
  const sess = getCodexFromSessions();
  if (sess) return sess;
  try {
    const c = JSON.parse(readFileSync(CODEX_USAGE_CACHE, "utf8"));
    if (c && (c.primary || c.secondary || c.credits))
      return { ...c, live: false };
  } catch {}
  return null;
}
function windowState(w) {
  if (!w) return null;
  const stale = w.resets_at && w.resets_at < now;
  return {
    pct: stale ? 0 : (w.used_percent ?? 0),
    resetsIn: w.resets_at ? w.resets_at - now : null,
    stale,
  };
}
// ── Rendering ──────────────────────────────────────────────────
const claude = getClaude();
const cusage = getClaudeUsage();
const cmodels = getClaudeModels();
const codex = getCodex();
const out = [];

// Menu bar: battery icons (all values are "remaining %")
//   Claude: C5=5h session · CW=weekly · CF=Fable weekly
//   Codex:  X5=5h · XW=weekly
const rem = (pct) => (pct == null ? null : Math.max(0, 100 - pct));

// rows → the same pixel-battery PNG the menu bar shows
function battRowsToImage(rows) {
  const items = rows.map((r) => ({ label: r.label, remain: r.remain }));
  return renderBatteryImage(true, items.length ? items : [{ label: "C5", remain: null }]);
}

// ── Terminal output modes (Linux/Chromebook & terminal fans): --cli · --statusline · --tmux · --json ──
if (process.argv.includes("--serve")) {
  const port = Number(process.env.CCB_PORT || 41414);
  Bun.serve({
    port,
    async fetch() {
      const proc = Bun.spawn(["bun", process.argv[1], "--html"], { env: process.env });
      const html = await new Response(proc.stdout).text();
      return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    },
  });
  console.log(`Claude Codex Battery window: http://localhost:${port}`);
  console.log(`Chrome → open the URL → ⋮ menu → Cast/Save → "Install as app" (or Create shortcut, open as window)`);
  await new Promise(() => {}); // keep serving
} else {
const CLI_MODE = process.argv.includes("--html")
  ? "html"
  : process.argv.includes("--json")
    ? "json"
  : process.argv.includes("--tmux")
    ? "tmux"
    : process.argv.includes("--statusline")
      ? "line"
      : process.argv.includes("--cli")
        ? "cli"
        : null;
if (CLI_MODE) {
  const rows = [];
  const resetTxt = (ts) =>
    ts ? (ts < now ? L("리셋됨", "reset") : `${L("리셋", "resets")} ${fmtDur(ts - now)}`) : "";
  if (cusage) {
    if (cusage.fiveHour) rows.push({ label: "C5", remain: rem(cusage.fiveHour.pct), reset: resetTxt(cusage.fiveHour.resetsAt) });
    if (cusage.weekly) rows.push({ label: "CW", remain: rem(cusage.weekly.pct), reset: resetTxt(cusage.weekly.resetsAt) });
    if (cusage.fable) rows.push({ label: "CF", remain: rem(cusage.fable.pct), reset: resetTxt(cusage.fable.resetsAt) });
  } else if (claude && !claude.error) {
    rows.push({ label: "C5", remain: Math.max(0, 100 - claude.elapsedPct), reset: `${L("리셋", "resets")} ${fmtDur(claude.remainMin * 60)}` });
  }
  if (codex && (codex.primary || codex.secondary)) {
    const p = windowState(codex.primary);
    const s = windowState(codex.secondary);
    const wReset = (w) => (w.stale ? L("리셋됨", "reset") : w.resetsIn != null ? `${L("리셋", "resets")} ${fmtDur(w.resetsIn)}` : "");
    if (p) rows.push({ label: "X5", remain: Math.max(0, 100 - p.pct), reset: wReset(p) });
    if (s) rows.push({ label: "XW", remain: Math.max(0, 100 - s.pct), reset: wReset(s) });
  } else if (codex && codex.credits) {
    const cr = codex.credits;
    rows.push({ label: "X", remain: cr.unlimited || (cr.has_credits && Number(cr.balance) > 0) ? 100 : 0, reset: "" });
  }
  const ansi = (r) =>
    r == null ? "\x1b[90m" : Math.round(r) >= 100 ? "\x1b[93m" : r <= 20 ? "\x1b[31m" : r < 50 ? "\x1b[33m" : "\x1b[32m";
  const R = "\x1b[0m";
  const pct = (r) => (r == null ? "--" : `${Math.round(r)}%`);
  if (CLI_MODE === "html") {
    // Full page with the real pixel-battery PNG (same renderer as the menu bar)
    const img = battRowsToImage(rows);
    const rowHtml = rows
      .map((r) => {
        const v = r.remain == null ? "--" : Math.round(r.remain);
        const color = r.remain == null ? "#8b949e" : v >= 100 ? "#ffd54a" : heatRemainHex(r.remain);
        return `<div class="row"><span class="lbl">${r.label}</span><div class="track"><div class="fill" style="width:${Math.max(0, Math.min(100, v === "--" ? 0 : v))}%;background:${color}"></div></div><span class="pct" style="color:${color}">${v}%</span><span class="reset">${r.reset}</span></div>`;
      })
      .join("");
    console.log(`<!doctype html><html><head><meta charset="utf-8"><title>Claude Codex Battery</title>
<meta http-equiv="refresh" content="120">
<style>
body{margin:0;background:#17191d;color:#e6e6e6;font:14px/1.6 ui-monospace,Menlo,monospace;display:flex;flex-direction:column;align-items:center;gap:18px;padding:26px 30px}
img{image-rendering:pixelated;height:24px;max-width:100%}
.row{display:flex;align-items:center;gap:10px;width:100%}
.lbl{width:2.2em;color:#8b949e}
.track{flex:1;height:10px;background:#2a2e35;border-radius:5px;overflow:hidden;min-width:160px}
.fill{height:100%}
.pct{width:3.2em;text-align:right}
.reset{color:#8b949e;font-size:12px;width:9em}
.foot{color:#4d5560;font-size:11px}
</style></head><body>
<img src="data:image/png;base64,${img}" alt="batteries">
<div style="width:100%">${rowHtml}</div>
<div class="foot">Claude Codex Battery · refreshes every 2 min</div>
</body></html>`);
    process.exit(0);
  }
  if (CLI_MODE === "cli") {
    for (const r of rows) {
      const v = r.remain == null ? " --" : String(Math.round(r.remain)).padStart(3);
      console.log(`${r.label.padEnd(2)} ${ansi(r.remain)}▕${bar(r.remain ?? 0, 20)}▏${v}%${R}  ${r.reset}`);
    }
    if (!rows.length) console.log(L("데이터 없음 — Claude Code/Codex 로그인 확인", "no data — check Claude Code/Codex login"));
  } else if (CLI_MODE === "line") {
    console.log(rows.map((r) => `${ansi(r.remain)}${r.label} ${pct(r.remain)}${R}`).join(" "));
  } else if (CLI_MODE === "tmux") {
    const tc = (r) =>
      r == null ? "colour244" : Math.round(r) >= 100 ? "colour220" : r <= 20 ? "colour196" : r < 50 ? "colour178" : "colour77";
    console.log(rows.map((r) => `#[fg=${tc(r.remain)}]${r.label} ${pct(r.remain)}`).join(" ") + "#[fg=default]");
  } else {
    const worst = rows.length ? Math.min(...rows.map((r) => r.remain ?? 100)) : 100;
    console.log(JSON.stringify({
      text: rows.map((r) => `${r.label} ${pct(r.remain)}`).join(" "),
      tooltip: rows.map((r) => `${r.label} ${pct(r.remain)}${r.reset ? ` (${r.reset})` : ""}`).join("\n"),
      class: worst <= 20 ? "critical" : worst < 50 ? "warning" : "good",
    }));
  }
  process.exit(0);
}
}
// Single-service users: only show the service that has data
const hasClaude = !!cusage || !!(claude && !claude.error);
const hasCodex = !!codex;
const battItems = [];
// Claude — 3 capsules with usage data, or C5 only from the ccusage block. Neither → skip.
if (cusage) {
  battItems.push(
    ...pickItems(
      "C",
      { has: cusage.fiveHour != null, remain: rem(cusage.fiveHour?.pct) },
      { has: cusage.weekly != null, remain: rem(cusage.weekly?.pct) },
      cusage.fable ? { has: true, remain: rem(cusage.fable.pct) } : null,
    ),
  );
} else if (claude && !claude.error) {
  battItems.push({ label: "C5", remain: Math.max(0, 100 - claude.elapsedPct) });
}
// Codex — only with session data. No Codex → no X batteries at all.
if (codex && (codex.primary || codex.secondary)) {
  // prolite: 5h / weekly percentage windows
  const p = windowState(codex.primary);
  const s = windowState(codex.secondary);
  // Draw only the windows active right now — omit missing ones instead of empty capsules
  battItems.push(
    ...pickItems(
      "X",
      { has: !!p, remain: p ? Math.max(0, 100 - p.pct) : null },
      { has: !!s, remain: s ? Math.max(0, 100 - s.pct) : null },
      null,
    ),
  );
} else if (codex && codex.credits) {
  // premium: credit balance (no totals available → has=100 / exhausted=0 / unlimited=100)
  const cr = codex.credits;
  const remain = cr.unlimited
    ? 100
    : cr.has_credits && Number(cr.balance) > 0
      ? 100
      : 0;
  battItems.push({ label: "X", remain });
}
// The remaining number sits inside each capsule → menu bar is image-only; labels live in the legend.
// No data at all (fresh install / neither tool used) → placeholder icon instead.
if (battItems.length) {
  out.push(`| image=${renderBatteryImage(isDarkMode(), battItems)}`);
} else {
  out.push("🔋 —");
}
out.push("---");
const codexLegend =
  codex?.credits && !codex.primary && !codex.secondary
    ? L("X = Codex 크레딧", "X = Codex credits")
    : L("X5·XW = Codex 5시간·주간", "X5·XW = Codex 5h·weekly");
const legendParts = [];
if (hasClaude)
  legendParts.push(
    L(
      "C5·CW·CF = Claude 5시간·주간·Fable",
      "C5·CW·CF = Claude 5h·weekly·Fable",
    ),
  );
if (hasCodex) legendParts.push(codexLegend);
if (legendParts.length) {
  out.push(
    `🔋 ${L("남은 %", "% left")}  ·  ${legendParts.join("  ·  ")} | size=11 color=#8b949e`,
  );
  out.push("---");
}

// Claude details — only when hasClaude (section omitted entirely otherwise)
if (hasClaude) {
  out.push("Claude Code | size=13 color=#8b949e");
  if (cusage) {
    const winRow = (label, w) => {
      if (!w) return;
      const r = Math.max(0, 100 - (w.pct ?? 0));
      const reset = w.resetsAt
        ? w.resetsAt < now
          ? L("리셋됨", "reset")
          : `${L("리셋", "resets")} ${fmtDur(w.resetsAt - now)}`
        : "";
      out.push(
        `${label} ▕${bar(r, 20)}▏ ${Math.round(r)}%  (${L("사용", "used")} ${Math.round(w.pct ?? 0)}%)${reset ? "  ·  " + reset : ""} | font=Menlo color=${heatRemainHex(r)}`,
      );
    };
    winRow(L("5시간 남음", "5h left  "), cusage.fiveHour);
    winRow(L("주간 남음 ", "wk left  "), cusage.weekly);
    if (cusage.fable)
      winRow(`${cusage.fable.model} ${L("남음", "left")}`, cusage.fable);
    out.push(
      cusage.live
        ? `${L("라이브 (Anthropic usage API — 전 디바이스 합산)", "live (Anthropic usage API — all devices combined)")} | size=11 color=#8b949e`
        : `${tf("측정 {0} 전 (캐시 폴백 — Claude Code 로그인·네트워크 확인)", "cached {0} ago (fallback — check Claude Code login/network)", fmtDur(now - cusage.measuredAt))} | size=11 color=#d29922`,
    );
  }
  if (claude && !claude.error) {
    out.push(
      `${L("블록 비용", "block cost")}  $${claude.cost.toFixed(2)}  ·  ${fmtTok(claude.tokens)} ${L("토큰", "tokens")}  ·  $${claude.costPerHour?.toFixed(1) ?? "?"}/h | font=Menlo size=11 color=#8b949e`,
    );
  }
  // Today's per-model usage (bars relative to the top model)
  if (cmodels && cmodels.models.length) {
    out.push(
      `${L("오늘 모델별", "today by model")}  ·  ${L("합", "total")} $${cmodels.total.toFixed(0)} | size=11 color=#8b949e`,
    );
    const maxCost = cmodels.models[0].cost || 1;
    for (const m of cmodels.models) {
      const g = bar((m.cost / maxCost) * 100, 12);
      const label = shortModel(m.name).padEnd(9, " ");
      out.push(
        `${label}▕${g}▏ $${m.cost.toFixed(1)}  ${fmtTok(m.tokens)} | font=Menlo`,
      );
    }
  }
  out.push("---");
}

// Codex details — only when hasCodex (section omitted entirely otherwise)
if (hasCodex) {
  out.push(
    `Codex${codex?.plan ? " · " + codex.plan : codex?.limitId ? " · " + codex.limitId : ""} | size=13 color=#8b949e`,
  );
  const p = windowState(codex.primary);
  const s = windowState(codex.secondary);
  // premium: no primary/secondary, credit balance only
  if (!p && !s && codex.credits) {
    const cr = codex.credits;
    if (cr.unlimited) {
      out.push(
        `${L("크레딧  무제한", "credits  unlimited")} | font=Menlo color=#3fb950`,
      );
    } else if (!cr.has_credits || Number(cr.balance) <= 0) {
      out.push(
        `${L("크레딧  소진 · 한도 초과 (0)", "credits  exhausted · limit reached (0)")} | font=Menlo color=#f85149`,
      );
      out.push(
        `      ${L("Codex 설정에서 크레딧 구매 또는 리셋 대기", "buy credits in Codex settings or wait for reset")} | font=Menlo size=11 color=#8b949e`,
      );
    } else {
      out.push(
        `${L("크레딧  잔액", "credits  balance")} ${cr.balance} | font=Menlo color=#3fb950`,
      );
    }
  }
  if (p) {
    const reset = p.stale
      ? L("리셋됨", "reset")
      : p.resetsIn != null
        ? `${L("리셋", "resets")} ${fmtDur(p.resetsIn)}`
        : "";
    const pr = Math.max(0, 100 - p.pct);
    out.push(
      `${L("5시간 남음", "5h left  ")} ▕${bar(pr, 20)}▏ ${Math.round(pr)}%  (${L("사용", "used")} ${Math.round(p.pct)}%) | font=Menlo color=${heatRemainHex(pr)}`,
    );
    out.push(`      ${reset} | font=Menlo size=11 color=#8b949e`);
  }
  if (s) {
    const reset = s.stale
      ? L("리셋됨", "reset")
      : s.resetsIn != null
        ? `${L("리셋", "resets")} ${fmtDur(s.resetsIn)}`
        : "";
    const sr = Math.max(0, 100 - s.pct);
    out.push(
      `${L("주간 남음 ", "wk left  ")} ▕${bar(sr, 20)}▏ ${Math.round(sr)}%  (${L("사용", "used")} ${Math.round(s.pct)}%) | font=Menlo color=${heatRemainHex(sr)}`,
    );
    out.push(`      ${reset} | font=Menlo size=11 color=#8b949e`);
  }
  const age = now - codex.measuredAt;
  out.push(
    codex.live
      ? `${L("라이브 (ChatGPT usage API — 전 디바이스 합산)", "live (ChatGPT usage API — all devices combined)")} | size=11 color=#8b949e`
      : `⚠ ${tf("라이브 조회 실패 — 로그인·네트워크 확인 ({0} 전 로컬 로그값)", "live query failed — check login/network (local log from {0} ago)", fmtDur(age))} | size=11 color=#d29922`,
  );
  out.push("---");
}

// Neither service has data (fresh install) → hint
if (!hasClaude && !hasCodex) {
  out.push(
    `${L("Claude Code나 Codex를 실행하면 사용량이 표시됩니다", "Run Claude Code or Codex and usage will appear here")} | size=12 color=gray`,
  );
  out.push("---");
}

// Highlighted one-click update when a new version exists; manual update row always shown
const upd = getUpdateInfo();
if (upd.hasUpdate) {
  out.push(
    `🆕 ${tf("v{0} 업데이트 (현재 v{1})", "Update to v{0} (current v{1})", upd.latest, VERSION)} | bash="${SELF_DIR}/.ccb-update.sh" terminal=false refresh=true color=#28963f`,
  );
} else {
  out.push(
    `⬆️ ${tf("지금 업데이트 — GitHub 최신으로 교체 (현재 v{0})", "Update now — replace with latest from GitHub (current v{0})", VERSION)} | bash="${SELF_DIR}/.ccb-update.sh" terminal=false refresh=true`,
  );
}
out.push(`🔄 ${L("지금 새로고침", "Refresh now")} | refresh=true`);
// Dashboard shortcut only when ccusage is available (optional dependency)
if (claude && !claude.error) {
  out.push(
    `📊 ${L("ccusage 대시보드 열기", "Open ccusage dashboard")} | bash="${CCUSAGE}" param1=blocks param2=--active terminal=true`,
  );
}
out.push(
  `v${VERSION}  ·  Claude & Codex Usage Battery | size=11 color=#8b949e`,
);
// Size toggle — write the other preset to .batt-size and refresh immediately
{
  const other = SIZE === "big" ? "small" : "big";
  const cur =
    SIZE === "big" ? L("크게", "big") : L("작게 (기본)", "small (default)");
  const next = other === "big" ? L("크게", "big") : L("작게", "small");
  out.push(
    `↕ ${L("배터리 크기", "battery size")}: ${cur} — ${L("클릭하면", "click for")} ${next} | bash=/bin/sh param1=-c param2="mkdir -p '${HOME}/.claude/swiftbar' && echo ${other} > '${SIZE_FILE}'" terminal=false refresh=true size=11 color=#8b949e`,
  );
}
// Outline toggle — write on/off to .batt-outline and refresh immediately
{
  const other = OUTLINE ? "off" : "on";
  const cur = OUTLINE ? L("켬", "on") : L("끔 (기본)", "off (default)");
  out.push(
    `◐ ${L("숫자 검은 테두리", "number outline")}: ${cur} — ${L("클릭하면", "click to turn")} ${OUTLINE ? L("끔", "off") : L("켬", "on")} | bash=/bin/sh param1=-c param2="mkdir -p '${HOME}/.claude/swiftbar' && echo ${other} > '${OUTLINE_FILE}'" terminal=false refresh=true size=11 color=#8b949e`,
  );
}
// Per-service menu bar item picker — which window(s) each service shows (submenu)
{
  const showLabel = (m) =>
    m === "5h"
      ? L("5시간", "5h")
      : m === "week"
        ? L("주간", "weekly")
        : m === "both"
          ? L("5시간+주간", "5h + weekly")
          : L("급한 쪽", "tightest");
  const opt = (file, cur, val, text) =>
    `--${cur === val ? "✓ " : "   "}${text} | bash=/bin/sh param1=-c param2="mkdir -p '${SWDIR}' && echo ${val} > '${file}'" terminal=false refresh=true size=11 color=${cur === val ? "#3fb950" : "#8b949e"}`;
  const opts = (file, cur) => {
    out.push(opt(file, cur, "5h", L("5시간만 (기본)", "5h only (default)")));
    out.push(opt(file, cur, "week", L("주간만", "weekly only")));
    out.push(opt(file, cur, "both", L("5시간 + 주간 둘 다", "5h + weekly")));
    out.push(opt(file, cur, "worst", L("급한 쪽 하나만", "tightest one only")));
  };
  out.push(
    `🔧 ${L("Claude 표시", "Claude shows")}: ${showLabel(CLAUDE_SHOW)} | size=11 color=#8b949e`,
  );
  opts(CLAUDE_SHOW_FILE, CLAUDE_SHOW);
  out.push(
    `🔧 ${L("Codex 표시", "Codex shows")}: ${showLabel(CODEX_SHOW)} | size=11 color=#8b949e`,
  );
  opts(CODEX_SHOW_FILE, CODEX_SHOW);
}
out.push(
  `⭐ github.com/Siturasu/claude-codex-battery | href=https://github.com/Siturasu/claude-codex-battery size=11 color=#8b949e`,
);
// Disable the widget — SwiftBar's plugin-disable URL. Re-enable: SwiftBar menu → Plugins
out.push(
  `✕ ${L("위젯 끄기 (SwiftBar 설정에서 재활성화)", "Disable widget (re-enable in SwiftBar settings)")} | href=swiftbar://disableplugin?plugin=claude-codex-usage size=11 color=#8b949e`,
);

console.log(out.join("\n"));
