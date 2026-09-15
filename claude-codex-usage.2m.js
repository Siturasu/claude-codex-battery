#!/usr/bin/env bun
// <xbar.title>Claude & Codex Usage</xbar.title>
// <xbar.version>v1.4.1</xbar.version>
// <xbar.author>개발부스러기</xbar.author>
// <xbar.desc>Claude Code 5시간 블록 + Codex rate limit을 메뉴바에 배터리 아이콘으로 상시 표시</xbar.desc>
// SwiftBar 플러그인: 2분마다 갱신. 메뉴바=배터리 잔량 아이콘(자체 PNG), 클릭=상세 게이지.

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
// 바이너리 경로 자동 탐지 (환경별로 다름 — 이식성)
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
  return name; // 최후: PATH에 의존
}
const CCUSAGE = findBin("ccusage");
const CODEX_BIN = findBin("codex");
const CODEX_SESSIONS = `${HOME}/.codex/sessions`;
const now = Math.floor(Date.now() / 1000);

// ── 자동 업데이트 (알림 + 원클릭) ──
const VERSION = "1.4.1";
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
// 캐시된 최신 버전을 읽고, 24h+ 지났으면 백그라운드로 GitHub VERSION만 조용히 확인
// (렌더를 막지 않음 — codex 자동갱신과 동일한 spawn+unref 패턴)
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

// ══ 배터리 아이콘 PNG 렌더 (순수 JS, node:zlib만) ══════════
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
// ── 크기 프리셋: big(기본) / small — 드롭다운 ↕ 행 또는 ~/.claude/swiftbar/.batt-size 로 전환 ──
const SIZE_FILE = `${HOME}/.claude/swiftbar/.batt-size`;
let SIZE = "big";
try {
  if (readFileSync(SIZE_FILE, "utf8").trim() === "small") SIZE = "small";
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

// 4x6 픽셀 폰트 (big 프리셋)
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
// 3x5 클래식 픽셀 폰트 (small 프리셋)
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
// 프리셋별 지오메트리: font/자간, 캡슐(bw×bh), 배치(capw·간격), 캔버스 높이, 숫자 y오프셋
const PRESET =
  SIZE === "small"
    ? { font: FONT35, adv: () => 4, bw: 14, bh: 9, capw: 16, gap: 3, ggap: 7, pad: 1, lblgap: 2, H: 9, dy: 2 }
    : { font: FONT46, adv: (ch) => (ch === "1" ? 4 : 5), bw: 18, bh: 10, capw: 20, gap: 5, ggap: 10, pad: 2, lblgap: 3, H: 12, dy: 3 };
const NUM = PRESET.font;
// altCol/boundaryX 지정 시: 픽셀 x가 채움 경계(boundaryX) 왼쪽이면 altCol(밝은 채움 위 대비),
// 오른쪽(빈 배경)이면 col. 지정 없으면 col 단색(그룹 라벨용).
const chAdv = PRESET.adv; // big: 5px('1'만 4px 커닝 — "100" 물림 방지), small: 4px
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
// 실제 macOS 배터리 인디케이터 색 (Apple HIG system colors, 다크/라이트 각각)
function heatRemain(r, dark) {
  if (r <= 20) return dark ? [255, 69, 58] : [255, 59, 48]; // systemRed
  if (r < 50) return dark ? [255, 214, 10] : [255, 204, 0]; // systemYellow
  return dark ? [48, 209, 88] : [52, 199, 89]; // systemGreen
}
const heatRemainHex = (r) =>
  r <= 20 ? "#FF453A" : r < 50 ? "#FFD60A" : "#30D158"; // 드롭다운 게이지 (다크 기준)
// 캡슐 하나: 테두리 + 잔량 채움 + 안에 잔량 숫자(100 포함, 항상 표시)
function drawCapsule(cv, x, midY, remain, ink, dark) {
  const bw = PRESET.bw,
    bh = PRESET.bh,
    by = midY - Math.floor(bh / 2);
  _stroke(cv, x, by, bw, bh, ink);
  _rect(cv, x + bw, by + 3, 2, bh - 6, ink); // 단자
  if (remain != null) {
    const innerW = bw - 4;
    const v = Math.max(0, Math.min(100, remain));
    const fw = Math.round((v / 100) * innerW);
    if (fw > 0) _rect(cv, x + 2, by + 2, fw, bh - 4, heatRemain(remain, dark));
    const s = String(Math.round(v));
    const tx = x + Math.floor((bw - numW(s)) / 2);
    // 채움(밝은 system color) 위 픽셀은 어두운 숫자, 빈 배경 위는 ink → 어디서나 대비 확보
    drawNum(cv, tx, midY - PRESET.dy, s, ink, [30, 30, 30], x + 2 + (fw > 0 ? fw : 0));
  }
  return x + bw + 2;
}
// 캡슐 N개(items=[{label,remain}]). 그룹(C=Claude / X=Codex) 앞에 라벨 문자.
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
      for (let i = 0; i < s.length; i++) _blit(buf, DW, DH, x + i * GW, numY, s[i], col);
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

// ── 게이지 렌더 (부분 블록, 의존성 0) ──────────────────────
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
// 사용률 → 색 (GitHub 신호색)
function heat(pct) {
  if (pct >= 80) return "#f85149"; // 빨강
  if (pct >= 50) return "#d29922"; // 노랑
  return "#3fb950"; // 초록
}

// ── 공용 유틸 ──────────────────────────────────────────────
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

// ── 1. Claude Code: 활성 5시간 블록 ────────────────────────
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

// ── 1b. Claude 오늘 모델별 사용 (Opus/Sonnet/Fable/Haiku) ──
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

// ── 1c. Claude 실제 rate limit — Anthropic OAuth usage API 직접 조회 ──
// 이 맥의 Claude Code 로그인 토큰(키체인)으로 /usage와 같은 데이터를 서버에서 직접
// 가져온다. 수치는 계정 단위 합산이라 다른 디바이스·데스크톱앱·웹 사용분도 포함.
// 실패 시 폴백: 자체 캐시(마지막 성공 응답) → 레거시 usage-cache.json 파일.
const CLAUDE_STATE_DIR = `${HOME}/.claude/swiftbar`;
const CLAUDE_USAGE_CACHE = `${CLAUDE_STATE_DIR}/.claude-usage.json`;
const LEGACY_USAGE_FILES = [
  `${HOME}/.claude/MEMORY/STATE/usage-cache.json`,
  `${HOME}/.claude/PAI/MEMORY/STATE/usage-cache.json`,
];

// 토큰은 반환값으로만 존재 — 파일·로그·프로세스 인자 어디에도 남기지 않는다
function readClaudeToken() {
  // 옵트아웃: 키체인 접근/라이브 조회를 원치 않으면 `touch ~/.claude/swiftbar/.no-live`
  // — 키체인 프롬프트에서 '거부'를 누르면 2분마다 다시 뜨므로, 그 대신 이 스위치를 쓴다.
  if (existsSync(`${CLAUDE_STATE_DIR}/.no-live`)) return null;
  try {
    const raw = execSync(
      'security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null',
      { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    const t = JSON.parse(raw)?.claudeAiOauth?.accessToken;
    if (t) return t;
  } catch {}
  try {
    // 키체인이 없는 환경(예: 수동 이전) 대비 — Claude Code의 파일 자격증명
    const raw = readFileSync(`${HOME}/.claude/.credentials.json`, "utf8");
    return JSON.parse(raw)?.claudeAiOauth?.accessToken ?? null;
  } catch {}
  return null;
}

function fetchClaudeUsageLive() {
  const token = readClaudeToken();
  if (!token) return null;
  try {
    // Authorization 헤더는 stdin(-H @-)으로 전달 — ps 프로세스 목록에 토큰 노출 방지
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

// 5시간 세션 / 주간 전체 / Fable 주간(weekly_scoped) 사용률
function getClaudeUsage() {
  const src = fetchClaudeUsageLive() ?? readClaudeUsageFallback();
  if (!src) return null;
  const { data: d, measuredAt, live } = src;
  try {
    const toTs = (iso) => (iso ? Math.floor(Date.parse(iso) / 1000) : null);
    const win = (o) =>
      o ? { pct: o.utilization ?? 0, resetsAt: toTs(o.resets_at) } : null;
    // Fable(또는 최상위 모델) 주간 scoped 한도
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

// ── 2. Codex: 가장 신선한 rate_limits ──────────────────────
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
function getCodex() {
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
        // prolite=primary/secondary(%), premium=credits(잔액) — 둘 중 하나라도 있으면 유효
        if (rl && (rl.primary || rl.secondary || rl.credits)) {
          return {
            measuredAt: Math.floor(f.mtime / 1000),
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
function windowState(w) {
  if (!w) return null;
  const stale = w.resets_at && w.resets_at < now;
  return {
    pct: stale ? 0 : (w.used_percent ?? 0),
    resetsIn: w.resets_at ? w.resets_at - now : null,
    stale,
  };
}
// 소진 + 오래됨일 때만 하루 최대 몇 회 Codex를 백그라운드로 굴려 리셋 감지 (throttle 6h)
function maybeAutoRefreshCodex(codex) {
  try {
    if (!codex) return;
    // 소진 판정: credits 소진 OR 어떤 창이든 100% 사용
    let exhausted = false;
    if (codex.credits) {
      const cr = codex.credits;
      exhausted = !cr.unlimited && (!cr.has_credits || Number(cr.balance) <= 0);
    } else {
      const p = windowState(codex.primary),
        s = windowState(codex.secondary);
      exhausted = Boolean((p && p.pct >= 100) || (s && s.pct >= 100));
    }
    if (!exhausted) return;
    if (now - codex.measuredAt < 2 * 3600) return; // 2h+ 오래됐을 때만
    const tsFile = `${HOME}/.claude/swiftbar/.codex-refresh-ts`;
    let last = 0;
    try {
      last = parseInt(readFileSync(tsFile, "utf8").trim(), 10) || 0;
    } catch {}
    if (now - last < 6 * 3600) return; // throttle: 6h 간격 (하루 최대 4회)
    writeFileSync(tsFile, String(now));
    // detached 백그라운드 실행 — 위젯을 막지 않음. 완료되면 세션 로그 갱신됨.
    const child = spawn(
      "/bin/sh",
      [
        "-c",
        `echo "reply ok" | "${CODEX_BIN}" exec --sandbox read-only --skip-git-repo-check - >/dev/null 2>&1`,
      ],
      { detached: true, stdio: "ignore", cwd: HOME },
    );
    child.unref();
  } catch {}
}

// ── 렌더링 ─────────────────────────────────────────────────
const claude = getClaude();
const cusage = getClaudeUsage();
const cmodels = getClaudeModels();
const codex = getCodex();
maybeAutoRefreshCodex(codex); // 소진+오래됨 시 백그라운드 갱신 (throttle)
const out = [];

// 메뉴바: 배터리 잔량 아이콘 (전부 "남은 %")
//   Claude(usage-cache): C5=5시간세션 · CW=주간전체 · CF=Fable 주간
//   Codex(rate_limits) : X5=5시간 · XW=주간
const rem = (pct) => (pct == null ? null : Math.max(0, 100 - pct));
// 한쪽만 쓰는 사용자 대응: 데이터가 있는 서비스만 표시
const hasClaude = !!cusage || !!(claude && !claude.error);
const hasCodex = !!codex;
const battItems = [];
// Claude — usage-cache 있으면 3종, 없어도 ccusage 블록이 있으면 C5만. 둘 다 없으면 Claude 배터리 생략.
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
// Codex — 세션 데이터 있을 때만. Codex 안 쓰는 사람에겐 X 배터리 자체를 안 그림.
if (codex && (codex.primary || codex.secondary)) {
  // prolite: 5시간·주간 % 창
  const p = windowState(codex.primary);
  const s = windowState(codex.secondary);
  battItems.push(
    ...pickItems(
      "X",
      { has: !!p, remain: p ? Math.max(0, 100 - p.pct) : null },
      { has: !!s, remain: s ? Math.max(0, 100 - s.pct) : null },
      null,
    ),
  );
} else if (codex && codex.credits) {
  // premium: 크레딧 잔액 (총량 미제공 → 있음=100 / 소진=0 / 무제한=100)
  const cr = codex.credits;
  const remain = cr.unlimited
    ? 100
    : cr.has_credits && Number(cr.balance) > 0
      ? 100
      : 0;
  battItems.push({ label: "X", remain });
}
// 잔량 숫자가 캡슐 안에 들어감 → 메뉴바는 이미지만. 라벨은 드롭다운 범례.
// 둘 다 없으면(신규/양쪽 미사용) 배터리 대신 안내 아이콘.
if (battItems.length) {
  out.push(`| image=${renderBatteryImage(isDarkMode(), battItems)}`);
} else {
  out.push("🔋 —");
}
out.push("---");
const codexLegend =
  codex?.credits && !codex.primary && !codex.secondary
    ? "X = Codex 크레딧"
    : "X5·XW = Codex 5시간·주간";
const legendParts = [];
if (hasClaude) legendParts.push("C5·CW·CF = Claude 5시간·주간·Fable");
if (hasCodex) legendParts.push(codexLegend);
if (legendParts.length) {
  out.push(
    `🔋 남은 %  ·  ${legendParts.join("  ·  ")} | size=11 color=#8b949e`,
  );
  out.push("---");
}

// Claude 상세 — hasClaude일 때만 (Claude Code 안 쓰면 섹션 자체 생략)
if (hasClaude) {
  out.push("Claude Code | size=13 color=#8b949e");
  if (cusage) {
    const winRow = (label, w) => {
      if (!w) return;
      const r = Math.max(0, 100 - (w.pct ?? 0));
      const reset = w.resetsAt
        ? w.resetsAt < now
          ? "리셋됨"
          : `리셋 ${fmtDur(w.resetsAt - now)}`
        : "";
      out.push(
        `${label} ▕${bar(r, 20)}▏ ${Math.round(r)}%  (사용 ${Math.round(w.pct ?? 0)}%)${reset ? "  ·  " + reset : ""} | font=Menlo color=${heatRemainHex(r)}`,
      );
    };
    winRow("5시간 남음", cusage.fiveHour);
    winRow("주간 남음 ", cusage.weekly);
    if (cusage.fable) winRow(`${cusage.fable.model} 남음`, cusage.fable);
    out.push(
      cusage.live
        ? `라이브 (Anthropic usage API — 전 디바이스 합산) | size=11 color=#8b949e`
        : `측정 ${fmtDur(now - cusage.measuredAt)} 전 (캐시 폴백 — Claude Code 로그인·네트워크 확인) | size=11 color=#d29922`,
    );
  }
  if (claude && !claude.error) {
    out.push(
      `블록 비용  $${claude.cost.toFixed(2)}  ·  ${fmtTok(claude.tokens)} 토큰  ·  $${claude.costPerHour?.toFixed(1) ?? "?"}/h | font=Menlo size=11 color=#8b949e`,
    );
  }
  // 오늘 모델별 사용 (최대 모델 대비 막대)
  if (cmodels && cmodels.models.length) {
    out.push(
      `오늘 모델별  ·  합 $${cmodels.total.toFixed(0)} | size=11 color=#8b949e`,
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

// Codex 상세 — hasCodex일 때만 (Codex 안 쓰면 섹션 자체 생략)
if (hasCodex) {
  out.push(
    `Codex${codex?.plan ? " · " + codex.plan : codex?.limitId ? " · " + codex.limitId : ""} | size=13 color=#8b949e`,
  );
  const p = windowState(codex.primary);
  const s = windowState(codex.secondary);
  // premium: primary/secondary 없이 크레딧 잔액만
  if (!p && !s && codex.credits) {
    const cr = codex.credits;
    if (cr.unlimited) {
      out.push("크레딧  무제한 | font=Menlo color=#3fb950");
    } else if (!cr.has_credits || Number(cr.balance) <= 0) {
      out.push("크레딧  소진 · 한도 초과 (0) | font=Menlo color=#f85149");
      out.push(
        "      Codex 설정에서 크레딧 구매 또는 리셋 대기 | font=Menlo size=11 color=#8b949e",
      );
    } else {
      out.push(`크레딧  잔액 ${cr.balance} | font=Menlo color=#3fb950`);
    }
  }
  if (p) {
    const reset = p.stale
      ? "리셋됨"
      : p.resetsIn != null
        ? `리셋 ${fmtDur(p.resetsIn)}`
        : "";
    const pr = Math.max(0, 100 - p.pct);
    out.push(
      `5시간 남음 ▕${bar(pr, 20)}▏ ${Math.round(pr)}%  (사용 ${Math.round(p.pct)}%) | font=Menlo color=${heatRemainHex(pr)}`,
    );
    out.push(`      ${reset} | font=Menlo size=11 color=#8b949e`);
  }
  if (s) {
    const reset = s.stale
      ? "리셋됨"
      : s.resetsIn != null
        ? `리셋 ${fmtDur(s.resetsIn)}`
        : "";
    const sr = Math.max(0, 100 - s.pct);
    out.push(
      `주간 남음  ▕${bar(sr, 20)}▏ ${Math.round(sr)}%  (사용 ${Math.round(s.pct)}%) | font=Menlo color=${heatRemainHex(sr)}`,
    );
    out.push(`      ${reset} | font=Menlo size=11 color=#8b949e`);
  }
  const age = now - codex.measuredAt;
  const staleWarn = age > 3 * 3600; // 3시간+ 오래됨 → 리셋됐을 수 있음
  out.push(
    `측정 ${fmtDur(age)} 전${staleWarn ? "  ·  ⚠ 리셋됐을 수 있음, Codex 쓰면 갱신" : " (Codex 세션 기준)"} | size=11 color=${staleWarn ? "#d29922" : "#8b949e"}`,
  );
  out.push("---");
}

// 둘 다 없으면(신규/양쪽 미사용) 안내
if (!hasClaude && !hasCodex) {
  out.push(
    "Claude Code나 Codex를 실행하면 사용량이 표시됩니다 | size=12 color=gray",
  );
  out.push("---");
}

// 새 버전이 있으면 강조 원클릭 업데이트, 없어도 수동 업데이트 행은 항상 노출
const upd = getUpdateInfo();
if (upd.hasUpdate) {
  out.push(
    `🆕 v${upd.latest} 업데이트 (현재 v${VERSION}) | bash="${SELF_DIR}/.ccb-update.sh" terminal=false refresh=true color=#28963f`,
  );
} else {
  out.push(
    `⬆️ 지금 업데이트 — GitHub 최신으로 교체 (현재 v${VERSION}) | bash="${SELF_DIR}/.ccb-update.sh" terminal=false refresh=true`,
  );
}
out.push("🔄 지금 새로고침 | refresh=true");
// ccusage가 있을 때만(선택 의존) 대시보드 바로가기 노출
if (claude && !claude.error) {
  out.push(
    `📊 ccusage 대시보드 열기 | bash="${CCUSAGE}" param1=blocks param2=--active terminal=true`,
  );
}
out.push(
  `v${VERSION}  ·  Claude & Codex Usage Battery | size=11 color=#8b949e`,
);
// 크기 전환 — .batt-size 파일에 반대 프리셋을 기록하고 즉시 새로고침
{
  const other = SIZE === "big" ? "small" : "big";
  out.push(
    `↕ 배터리 크기: ${SIZE === "big" ? "크게 (기본)" : "작게"} — 클릭하면 ${other === "big" ? "크게" : "작게"}로 | bash=/bin/sh param1=-c param2="mkdir -p '${HOME}/.claude/swiftbar' && echo ${other} > '${SIZE_FILE}'" terminal=false refresh=true size=11 color=#8b949e`,
  );
}
// 표시 항목 전환 — 서비스별로 메뉴바에 어떤 창을 배터리로 띄울지 (submenu)
{
  const showLabel = (m) =>
    m === "5h" ? "5시간" : m === "week" ? "주간" : m === "both" ? "5시간+주간" : "급한 쪽";
  const opt = (file, cur, val, text) =>
    `--${cur === val ? "✓ " : "   "}${text} | bash=/bin/sh param1=-c param2="mkdir -p '${SWDIR}' && echo ${val} > '${file}'" terminal=false refresh=true size=11 color=${cur === val ? "#3fb950" : "#8b949e"}`;
  out.push(`🔧 Claude 표시: ${showLabel(CLAUDE_SHOW)} | size=11 color=#8b949e`);
  out.push(opt(CLAUDE_SHOW_FILE, CLAUDE_SHOW, "5h", "5시간만 (기본)"));
  out.push(opt(CLAUDE_SHOW_FILE, CLAUDE_SHOW, "week", "주간만"));
  out.push(opt(CLAUDE_SHOW_FILE, CLAUDE_SHOW, "both", "5시간 + 주간 둘 다"));
  out.push(opt(CLAUDE_SHOW_FILE, CLAUDE_SHOW, "worst", "급한 쪽 하나만"));
  out.push(`🔧 Codex 표시: ${showLabel(CODEX_SHOW)} | size=11 color=#8b949e`);
  out.push(opt(CODEX_SHOW_FILE, CODEX_SHOW, "5h", "5시간만 (기본)"));
  out.push(opt(CODEX_SHOW_FILE, CODEX_SHOW, "week", "주간만"));
  out.push(opt(CODEX_SHOW_FILE, CODEX_SHOW, "both", "5시간 + 주간 둘 다"));
  out.push(opt(CODEX_SHOW_FILE, CODEX_SHOW, "worst", "급한 쪽 하나만"));
}
out.push(
  `⭐ github.com/Siturasu/claude-codex-battery | href=https://github.com/Siturasu/claude-codex-battery size=11 color=#8b949e`,
);
// 위젯 끄기 — SwiftBar의 플러그인 비활성화 URL. 재활성화: SwiftBar 메뉴 → Plugins
out.push(
  `✕ 위젯 끄기 (SwiftBar 설정에서 재활성화) | href=swiftbar://disableplugin?plugin=claude-codex-usage size=11 color=#8b949e`,
);

console.log(out.join("\n"));
