/**
 * Keyboard, delete and eyedropper regression for the board.
 *
 * The canvas check covers ink geometry and the realtime check covers two
 * devices. This one covers the editing affordances added on top:
 *
 *   - Ctrl+Z / Ctrl+Shift+Z undo and redo from the keyboard, without the
 *     canvas having to hold focus;
 *   - a selected stroke can be thrown away with Delete, and the floating
 *     "Eliminar" button appears while something is selected;
 *   - the eyedropper samples the colour under the pointer and feeds it back
 *     into the colour field.
 *
 * Same headless setup as `board-canvas-check.mjs`: trusted CDP mouse and key
 * events, and a timer-based rAF polyfill because a headless tab never paints.
 *
 * Usage:
 *   npm run build && npm start       # in another shell
 *   node scripts/board-ux-check.mjs
 *
 * Environment:
 *   CHROME_PATH   path to chrome.exe  (default: the standard Windows install)
 *   ORIGIN        app origin          (default: http://localhost:3000)
 *   CDP_PORT      debugging port      (default: 9335)
 */

import { spawn, spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const CHROME =
  process.env.CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = Number(process.env.CDP_PORT ?? 9335);
const ORIGIN = process.env.ORIGIN ?? "http://localhost:3000";
const BOARD = `${ORIGIN}/board/UX-${Date.now()}`;

const userDataDir = path.join(os.tmpdir(), `wbmod-ux-profile-${Date.now()}`);
fs.rmSync(userDataDir, { recursive: true, force: true });
fs.mkdirSync(userDataDir, { recursive: true });

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--window-size=1500,950",
    "about:blank",
  ],
  { stdio: "ignore" },
);

function cleanup() {
  // Chrome's children outlive `kill()` on Windows, and one of them keeps the
  // profile directory locked, so take the whole tree down.
  try {
    spawnSync("taskkill", ["/PID", String(chrome.pid), "/T", "/F"], {
      stdio: "ignore",
    });
  } catch {
    // The browser may already be gone.
  }
  try {
    chrome.kill();
  } catch {
    // The browser may already be gone.
  }
}
process.on("exit", cleanup);

async function waitForDevtools() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return;
    } catch {
      // Not up yet.
    }
    await sleep(250);
  }
  throw new Error("devtools never came up");
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
}

async function main() {
  await waitForDevtools();
  const res = await fetch(
    `http://127.0.0.1:${PORT}/json/new?${encodeURIComponent("about:blank")}`,
    { method: "PUT" },
  );
  const target = await res.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  const cdp = new CDP(ws);

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1500,
    height: 950,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
      window.cancelAnimationFrame = (id) => clearTimeout(id);
    `,
  });

  const evaluate = async (expression) => {
    const r = await cdp.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error(
        `evaluate failed: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ""}`,
      );
    }
    return r.result.value;
  };
  /**
   * Navigates and waits for the page to be usable.
   *
   * On Render's free tier a sleeping service can take a minute to answer, so a
   * fixed sleep is not enough; the caller names the selector that proves the
   * page it wanted is on screen (or none, which waits for `load`).
   */
  const goto = async (url, selector) => {
    await cdp.send("Page.navigate", { url });
    for (let attempt = 0; attempt < 150; attempt += 1) {
      await sleep(1000);
      let ready = false;
      try {
        ready = await evaluate(
          selector
            ? `!!document.querySelector(${JSON.stringify(selector)})`
            : `document.readyState === 'complete'`,
        );
      } catch {
        // The previous document is going away; ask again next second.
      }
      if (ready) {
        await sleep(1200);
        return;
      }
    }
    throw new Error(`page never became ready: ${url}`);
  };
  const mouse = async (type, x, y, buttons) => {
    await cdp.send("Input.dispatchMouseEvent", {
      type,
      x,
      y,
      button: "left",
      buttons,
      clickCount: type === "mousePressed" ? 1 : 0,
      pointerType: "mouse",
    });
  };
  const key = async (keyName, code, modifiers = 0) => {
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      modifiers,
      key: keyName,
      code,
      windowsVirtualKeyCode: code === "Delete" ? 46 : 90,
      nativeVirtualKeyCode: code === "Delete" ? 46 : 90,
    });
    await cdp.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      modifiers,
      key: keyName,
      code,
    });
    await sleep(500);
  };

  // ---- profile ------------------------------------------------------------
  await goto(`${ORIGIN}/lobby`);
  await evaluate(`localStorage.setItem('wf_nickname','Zorro');
    localStorage.setItem('wf_device_id','WM-A3F9-2C71');
    localStorage.setItem('wf_pro','true'); 'ok'`);

  await goto(BOARD, '[data-testid="boardCanvas"]');
  const geo = await evaluate(`(() => {
    const c = document.querySelector('[data-testid="boardCanvas"]');
    const r = c.getBoundingClientRect();
    return { left: r.left, top: r.top };
  })()`);
  const pageX = (v) => v + geo.left;
  const pageY = (v) => v + geo.top;

  const greenBounds = (x0, y0, x1, y1) =>
    evaluate(`(() => {
      const c = document.querySelector('[data-testid="boardCanvas"]');
      const ctx = c.getContext('2d');
      const w = ${x1 - x0}, h = ${y1 - y0};
      const d = ctx.getImageData(${x0}, ${y0}, w, h).data;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, hits = 0;
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const i = (y * w + x) * 4;
          if (d[i + 3] > 0 && d[i + 1] > 150 && d[i] < 120 && d[i + 2] < 120) {
            hits += 1;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (!hits) return null;
      return { minX: minX + ${x0}, minY: minY + ${y0}, maxX: maxX + ${x0}, maxY: maxY + ${y0}, hits };
    })()`);

  const openPanel = async () => {
    await evaluate(`(() => {
      const btn = document.querySelector('[data-testid="tool-draw"]');
      btn.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window, detail: 2 }));
      return 'dblclick';
    })()`);
    await sleep(500);
  };
  const pickLabel = async (label) => {
    await evaluate(`(() => {
      const p = document.querySelector('[data-testid="draw-panel"]');
      const btn = Array.from(p.querySelectorAll('button')).find(b => b.textContent.trim() === '${label}');
      if (btn) btn.click();
      return 'clicked';
    })()`);
    await sleep(350);
  };
  const setHex = async (hex) => {
    await evaluate(`(() => {
      const p = document.querySelector('[data-testid="draw-panel"]');
      const input = p.querySelector('[data-testid="color-wheel-hex"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, '${hex}');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return 'typed';
    })()`);
    await sleep(300);
    await evaluate(`(() => {
      const p = document.querySelector('[data-testid="draw-panel"]');
      p.querySelector('[data-testid="color-wheel-hex"]')
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return 'enter';
    })()`);
    await sleep(350);
  };
  const closePanel = async () => {
    await evaluate(`document.querySelector('[data-testid="draw-panel-close"]')?.click(); 'closed'`);
    await sleep(300);
  };

  const RECT = { x: 900, y: 600, w: 100, h: 100 };
  const REGION = [840, 540, 1060, 760];
  const drawRect = async () => {
    await mouse("mousePressed", pageX(RECT.x), pageY(RECT.y), 1);
    for (const [dx, dy] of [
      [RECT.w, 0],
      [RECT.w, RECT.h],
      [0, RECT.h],
    ]) {
      await mouse("mouseMoved", pageX(RECT.x + dx), pageY(RECT.y + dy), 1);
      await sleep(40);
    }
    await sleep(150);
    await mouse("mouseReleased", pageX(RECT.x), pageY(RECT.y + RECT.h), 0);
    await sleep(500);
  };

  // ---- draw a green fill so there is something to undo -------------------
  await openPanel();
  await pickLabel("Rellenar");
  await pickLabel("1");
  await setHex("00FF00");
  await closePanel();
  await drawRect();

  const drawn = await greenBounds(...REGION);
  check("a green rectangle is on the board", drawn !== null, JSON.stringify(drawn));

  // ---- Ctrl+Z / Ctrl+Shift+Z ---------------------------------------------
  await key("z", "KeyZ", 2);
  const afterUndo = await greenBounds(...REGION);
  check("Ctrl+Z undoes the stroke", afterUndo === null, JSON.stringify(afterUndo));

  await key("Z", "KeyZ", 10);
  const afterRedo = await greenBounds(...REGION);
  check(
    "Ctrl+Shift+Z brings it back",
    afterRedo !== null &&
      Math.abs(afterRedo.minX - drawn.minX) <= 2 &&
      Math.abs(afterRedo.minY - drawn.minY) <= 2,
    JSON.stringify(afterRedo),
  );

  // ---- select + Delete ----------------------------------------------------
  await evaluate(`document.querySelector('[data-testid="tool-select"]').click(); 'select'`);
  await sleep(350);
  await mouse("mousePressed", pageX(RECT.x - 20), pageY(RECT.y - 20), 1);
  for (const [dx, dy] of [
    [RECT.w + 40, 0],
    [RECT.w + 40, RECT.h + 40],
    [0, RECT.h + 40],
  ]) {
    await mouse(
      "mouseMoved",
      pageX(RECT.x - 20 + dx),
      pageY(RECT.y - 20 + dy),
      1,
    );
    await sleep(40);
  }
  await sleep(150);
  await mouse("mouseReleased", pageX(RECT.x - 20), pageY(RECT.y + RECT.h + 20), 0);
  await sleep(600);

  const deleteButton = await evaluate(
    `!!document.querySelector('[data-testid="selection-delete"]')`,
  );
  check("the Eliminar button appears with a selection", deleteButton === true);

  await key("Delete", "Delete", 0);
  const afterDelete = await greenBounds(...REGION);
  check("Delete removes the selection", afterDelete === null, JSON.stringify(afterDelete));

  // ---- eyedropper ---------------------------------------------------------
  // The draw tool was still active when Delete ran, so there is no need to
  // click the pencil again — and clicking it while it is active would toggle
  // the panel shut.
  await openPanel();
  await setHex("00FF00");
  await closePanel();
  await drawRect();
  await sleep(300);
  const greenAgain = await greenBounds(...REGION);
  check("a second green rectangle is ready to sample", greenAgain !== null);

  // Leave the panel open (it holds the pipette) and make the current colour
  // magenta: if the pipette press fell through to the pencil, it would leave a
  // magenta mark on the green fill.
  await openPanel();
  await setHex("FF00FF");
  await evaluate(`document.querySelector('[data-testid="color-eyedropper"]').click(); 'pipette'`);
  await sleep(350);
  const hintShown = await evaluate(
    `!!document.querySelector('[data-testid="eyedropper-hint"]')`,
  );
  check("the eyedropper hint appears", hintShown === true);

  const centreX = pageX(RECT.x + RECT.w / 2);
  const centreY = pageY(RECT.y + RECT.h / 2);
  await mouse("mousePressed", centreX, centreY, 1);
  await mouse("mouseReleased", centreX, centreY, 0);
  await sleep(500);

  const pickedHex = await evaluate(`(() => {
    const p = document.querySelector('[data-testid="draw-panel"]');
    return {
      hex: p.querySelector('[data-testid="color-wheel-hex"]')?.value ?? null,
      hint: !!document.querySelector('[data-testid="eyedropper-hint"]'),
    };
  })()`);
  check(
    "the eyedropper takes the colour under the pointer",
    pickedHex.hex === "00FF00",
    JSON.stringify(pickedHex),
  );
  check(
    "picking a colour leaves eyedropper mode",
    pickedHex.hint === false,
    JSON.stringify(pickedHex),
  );

  const box = 100;
  const magenta = await evaluate(`(() => {
    const c = document.querySelector('[data-testid="boardCanvas"]');
    const ctx = c.getContext('2d');
    const size = ${box};
    const x = ${RECT.x + RECT.w / 2 - box / 2};
    const y = ${RECT.y + RECT.h / 2 - box / 2};
    const d = ctx.getImageData(x, y, size, size).data;
    let hits = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 180 && d[i + 1] < 120 && d[i + 2] > 180) hits += 1;
    }
    return hits;
  })()`);
  check(
    "the eyedropper press does not draw a stroke",
    magenta === 0,
    `magenta=${magenta}`,
  );

  // ---- report -------------------------------------------------------------
  const failed = results.filter((entry) => !entry.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  // The DevTools socket keeps the event loop alive; close it and leave with a
  // status the caller can trust.
  try {
    ws.close();
  } catch {
    // Already gone.
  }
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
