/**
 * Canvas regression for the whiteboard board.
 *
 * Drives a headless Chrome over the DevTools Protocol and asserts the pixels
 * the board actually puts on the canvas: buffer sizing, the marker colour and
 * width, the live preview during a gesture, `Rellenar`, and gradient fills
 * with two and three colour stops.
 *
 * Why CDP instead of a browser harness: a headless (or hidden) tab never
 * fires `requestAnimationFrame`, and the board repaints from rAF, so the
 * canvas stays a 1×1 buffer and nothing can be observed. The script therefore
 * injects a timer-based rAF polyfill before any document loads, and drives
 * the pointer through `Input.dispatchMouseEvent` so the board receives
 * trusted events (a synthetic `PointerEvent` would make `setPointerCapture`
 * throw).
 *
 * Usage:
 *   npm run dev                       # in another shell
 *   node scripts/board-canvas-check.mjs
 *
 * Environment:
 *   CHROME_PATH   path to chrome.exe  (default: the standard Windows install)
 *   ORIGIN        app origin          (default: http://localhost:3000)
 *   CDP_PORT      debugging port      (default: 9334)
 */

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const CHROME =
  process.env.CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = Number(process.env.CDP_PORT ?? 9334);
const ORIGIN = process.env.ORIGIN ?? "http://localhost:3000";
const BOARD = `${ORIGIN}/board/PREVIEW-TEST-01`;

const userDataDir = path.join(os.tmpdir(), "wbmod-cdp-profile");
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
  const goto = async (url) => {
    await cdp.send("Page.navigate", { url });
    await sleep(2500);
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

  // ---- profile ------------------------------------------------------------
  await goto(`${ORIGIN}/lobby`);
  await evaluate(`localStorage.setItem('wf_nickname','Zorro');
    localStorage.setItem('wf_device_id','WM-A3F9-2C71');
    localStorage.setItem('wf_pro','true'); 'ok'`);

  await goto(BOARD);
  const geo = await evaluate(`(() => {
    const c = document.querySelector('[data-testid="boardCanvas"]');
    const r = c.getBoundingClientRect();
    const bar = document.querySelector('[data-testid="room-chat-bar"]');
    return {
      left: r.left,
      top: r.top,
      bufW: c.width,
      bufH: c.height,
      barH: bar ? bar.getBoundingClientRect().height : 0,
    };
  })()`);
  check(
    "canvas buffer sized to the viewport",
    geo.bufW === 1360 && geo.bufH === 950 - geo.barH,
    JSON.stringify(geo),
  );

  // ---- panel helpers ------------------------------------------------------
  const openPanel = async () => {
    await evaluate(`(() => {
      const btn = document.querySelector('[data-testid="tool-draw"]');
      btn.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window, detail: 2 }));
      return 'dblclick';
    })()`);
    await sleep(500);
  };
  const closePanel = async () => {
    await evaluate(`document.querySelector('[data-testid="draw-panel-close"]')?.click(); 'closed'`);
    await sleep(300);
  };
  /** Types a hex value into the nth colour wheel's hex field and commits it. */
  const setHex = async (index, hex) => {
    await evaluate(`(() => {
      const p = document.querySelector('[data-testid="draw-panel"]');
      const inputs = p.querySelectorAll('[data-testid="color-wheel-hex"]');
      const input = inputs[${index}];
      if (!input) return 'missing';
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, '${hex}');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return 'typed';
    })()`);
    await sleep(350);
    await evaluate(`(() => {
      const p = document.querySelector('[data-testid="draw-panel"]');
      const inputs = p.querySelectorAll('[data-testid="color-wheel-hex"]');
      inputs[${index}].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return 'enter';
    })()`);
    await sleep(350);
  };
  const pickStyle = async (label) => {
    await evaluate(`(() => {
      const p = document.querySelector('[data-testid="draw-panel"]');
      const btn = Array.from(p.querySelectorAll('button')).find(b => b.textContent.trim() === '${label}');
      if (btn) btn.click();
      return 'clicked ${label}';
    })()`);
    await sleep(400);
  };
  const pickSize = async (size) => {
    await evaluate(`(() => {
      const p = document.querySelector('[data-testid="draw-panel"]');
      const btn = Array.from(p.querySelectorAll('button')).find(b => b.textContent.trim() === '${size}');
      if (btn) btn.click();
      return 'clicked ${size}';
    })()`);
    await sleep(400);
  };
  /** Picks the gradient ramp projection. */
  const pickGradientType = async (type) => {
    await evaluate(`(() => {
      const el = document.querySelector('[data-testid="gradient-type-${type}"] input');
      if (!el) return 'missing';
      el.click();
      return 'clicked ${type}';
    })()`);
    await sleep(400);
  };
  /** Moves a gradient stop along the ramp. */
  const setStopPosition = async (index, percent) => {
    await evaluate(`(() => {
      const input = document.querySelector('[data-testid="gradient-position-${index}"]');
      if (!input) return 'missing';
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, '${percent}');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return 'set';
    })()`);
    await sleep(400);
  };
  const readStyle = () =>
    evaluate(`(() => {
      const p = document.querySelector('[data-testid="draw-panel"]');
      const wheels = Array.from(p.querySelectorAll('[data-testid="color-wheel-hex-value"]')).map(i => i.value);
      return { wheels, width: p.querySelector('[data-testid="draw-width-number"]')?.value };
    })()`);

  const sampleAt = (x, y) =>
    evaluate(`(() => {
      const c = document.querySelector('[data-testid="boardCanvas"]');
      const ctx = c.getContext('2d');
      const d = ctx.getImageData(${x}, ${y}, 1, 1).data;
      return { r: d[0], g: d[1], b: d[2], a: d[3] };
    })()`);

  /** A checksum of a canvas region, so two snapshots can be compared. */
  const regionHash = (x0, y0, x1, y1) =>
    evaluate(`(() => {
      const c = document.querySelector('[data-testid="boardCanvas"]');
      const ctx = c.getContext('2d');
      const d = ctx.getImageData(${x0}, ${y0}, ${x1 - x0}, ${y1 - y0}).data;
      let sum = 0, painted = 0;
      for (let i = 0; i < d.length; i += 4) {
        sum = (sum + (d[i] + d[i + 1] * 3 + d[i + 2] * 7 + d[i + 3] * 11) * ((i % 997) + 1)) >>> 0;
        if (d[i + 3] > 0) painted++;
      }
      return { sum, painted };
    })()`);

  /**
   * Counts the selection-box pixels in a region.
   *
   * The selection chrome is the brand coral `#e0533f`; the marker red
   * `#ff0000` is close enough in hue but has no green in it, so the match is
   * tightened around the coral's own green level.
   */
  const countSelection = (x0, y0, x1, y1) =>
    evaluate(`(() => {
      const c = document.querySelector('[data-testid="boardCanvas"]');
      const ctx = c.getContext('2d');
      const d = ctx.getImageData(${x0}, ${y0}, ${x1 - x0}, ${y1 - y0}).data;
      let hits = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (Math.abs(d[i] - 224) < 30 && Math.abs(d[i + 1] - 83) < 25 && Math.abs(d[i + 2] - 63) < 25) hits++;
      }
      return hits;
    })()`);

  /**
   * The bounding box of the green fill inside a region, in canvas pixels.
   *
   * The fill is `rgb(0,255,0)`, which nothing else on the board shares: the
   * selection chrome is the brand coral (a green of 83) and the grid is a pale
   * grey, so a strict green match isolates the ink.
   */
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

  /**
   * The bounding box of the imported magenta picture, in canvas pixels.
   *
   * The import check drops a plain magenta square on the board. Nothing else on
   * the board is magenta — the gradients that are already there run between
   * red, blue and green — so a strict match isolates the imported item.
   */
  const blueBounds = (x0, y0, x1, y1) =>
    evaluate(`(() => {
      const c = document.querySelector('[data-testid="boardCanvas"]');
      const ctx = c.getContext('2d');
      const w = ${x1 - x0}, h = ${y1 - y0};
      const d = ctx.getImageData(${x0}, ${y0}, w, h).data;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, hits = 0;
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const i = (y * w + x) * 4;
          if (d[i + 3] > 0 && d[i] > 180 && d[i + 2] > 180 && d[i + 1] < 90) {
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

  const canvasX = (clientX) => clientX - geo.left;
  const canvasY = (clientY) => clientY - geo.top;

  // =========================================================================
  // TEST 1 — marker: live preview + committed stroke use the chosen colour
  // =========================================================================
  await openPanel();
  await setHex(0, "FF0000");
  await pickSize("20");
  const markerStyle = await readStyle();
  check(
    "marker colour committed",
    markerStyle.wheels[0] === "#ff0000",
    JSON.stringify(markerStyle),
  );
  check("marker width committed", markerStyle.width === "20", markerStyle.width);
  await closePanel();

  // Draw a stroke, sampling BEFORE the pointer is released.
  const m = { x: 400, y: 320 };
  await mouse("mousePressed", m.x, m.y, 1);
  for (let i = 1; i <= 10; i++) {
    await mouse("mouseMoved", m.x + i * 25, m.y, 1);
    await sleep(30);
  }
  await sleep(300);
  const livePixel = await sampleAt(canvasX(m.x + 250), canvasY(m.y));
  await mouse("mouseReleased", m.x + 250, m.y, 0);
  await sleep(300);
  const committedPixel = await sampleAt(canvasX(m.x + 250), canvasY(m.y));

  check(
    "LIVE preview uses the selected colour",
    livePixel.r > 180 && livePixel.g < 90 && livePixel.b < 90,
    JSON.stringify(livePixel),
  );
  check(
    "committed stroke uses the selected colour",
    committedPixel.r > 180 && committedPixel.g < 90 && committedPixel.b < 90,
    JSON.stringify(committedPixel),
  );

  const thickness = await evaluate(`(() => {
    const c = document.querySelector('[data-testid="boardCanvas"]');
    const ctx = c.getContext('2d');
    const col = ctx.getImageData(${canvasX(m.x + 250)}, 0, 1, c.height).data;
    let maxRun = 0, run = 0;
    // The marker's own colour, so the board's background and its grid do not
    // count as part of the stroke.
    for (let i = 0; i < col.length; i += 4) {
      const red = col[i] > 180 && col[i + 1] < 90 && col[i + 2] < 90;
      if (red) { run++; maxRun = Math.max(maxRun, run); } else run = 0;
    }
    return maxRun;
  })()`);
  check(
    "stroke width honoured (~20px)",
    thickness >= 16 && thickness <= 24,
    `measured ${thickness}px`,
  );

  // =========================================================================
  // TEST 2 — Rellenar (solid fill) behaves like the lasso
  // =========================================================================
  await openPanel();
  await pickStyle("Rellenar");
  await setHex(0, "00FF00");
  const fillStyle = await readStyle();
  check(
    "fill colour committed",
    fillStyle.wheels[0] === "#00ff00",
    JSON.stringify(fillStyle),
  );
  await closePanel();

  const f = { x: 400, y: 500 };
  await mouse("mousePressed", f.x, f.y, 1);
  for (const [dx, dy] of [
    [100, 0],
    [100, 100],
    [0, 100],
    [-100, 0],
  ]) {
    await mouse("mouseMoved", f.x + dx, f.y + dy, 1);
    await sleep(40);
  }
  await sleep(200);
  await mouse("mouseReleased", f.x - 100, f.y + 100, 0);
  await sleep(400);

  const fillCentre = await sampleAt(canvasX(f.x), canvasY(f.y + 50));
  check(
    "fill covers the lassoed area",
    fillCentre.g > 150 && fillCentre.r < 100 && fillCentre.b < 100,
    JSON.stringify(fillCentre),
  );

  // =========================================================================
  // TEST 3 — Relleno degradado (gradient fill) with two colours
  // =========================================================================
  await openPanel();
  await pickStyle("Relleno degradado");
  const stopsShown = await evaluate(
    `document.querySelectorAll('[data-testid="draw-panel"] [data-testid^="gradient-swatch-"]').length`,
  );
  check("gradient shows one row per stop", stopsShown === 2, `stops=${stopsShown}`);

  const gradientUi = await evaluate(`(() => {
    const p = document.querySelector('[data-testid="draw-panel"]');
    const preview = p.querySelector('[data-testid="gradient-preview"]');
    const linear = p.querySelector('[data-testid="gradient-type-linear"] input');
    const radial = p.querySelector('[data-testid="gradient-type-radial"] input');
    return {
      preview: Boolean(preview),
      previewCss: preview ? getComputedStyle(preview).backgroundImage : '',
      linearChecked: Boolean(linear && linear.checked),
      radialChecked: Boolean(radial && radial.checked),
    };
  })()`);
  check(
    "gradient preview renders the ramp",
    gradientUi.preview && gradientUi.previewCss.includes("gradient"),
    JSON.stringify(gradientUi.previewCss.slice(0, 80)),
  );
  check(
    "gradient type defaults to Lineal",
    gradientUi.linearChecked && !gradientUi.radialChecked,
    JSON.stringify({ linear: gradientUi.linearChecked, radial: gradientUi.radialChecked }),
  );

  // Click the second stop to open its editor.
  await evaluate(`document.querySelector('[data-testid="gradient-swatch-1"]').click(); 'clicked'`);
  await sleep(500);
  const wheelCount = await evaluate(
    `document.querySelectorAll('[data-testid="draw-panel"] [data-testid="color-wheel-hex"]').length`,
  );
  check("stop editor opens a colour wheel", wheelCount === 2, `wheels=${wheelCount}`);
  await setHex(0, "FF0000");
  await setHex(1, "0000FF");
  const gradStyle = await readStyle();
  check(
    "gradient colours committed",
    gradStyle.wheels[0] === "#ff0000" && gradStyle.wheels[1] === "#0000ff",
    JSON.stringify(gradStyle),
  );
  await closePanel();

  const g = { x: 400, y: 700 };
  await mouse("mousePressed", g.x, g.y, 1);
  // The path starts top-left and ends bottom-left, so the gradient axis is vertical.
  for (const [dx, dy] of [
    [160, 0],
    [160, 120],
    [0, 120],
  ]) {
    await mouse("mouseMoved", g.x + dx, g.y + dy, 1);
    await sleep(40);
  }
  await sleep(200);
  await mouse("mouseReleased", g.x, g.y + 120, 0);
  await sleep(500);

  const gradStart = await sampleAt(canvasX(g.x + 12), canvasY(g.y + 12));
  const gradEnd = await sampleAt(canvasX(g.x + 12), canvasY(g.y + 108));

  check(
    "gradient starts near the first colour (red)",
    gradStart.r > 150 && gradStart.b < 120,
    JSON.stringify(gradStart),
  );
  check(
    "gradient ends near the second colour (blue)",
    gradEnd.b > 120 && gradEnd.r < 150,
    JSON.stringify(gradEnd),
  );

  // =========================================================================
  // TEST 4 — radial gradient
  // =========================================================================
  await openPanel();
  await pickStyle("Relleno degradado");
  await pickGradientType("radial");
  const radialChecked = await evaluate(
    `Boolean(document.querySelector('[data-testid="gradient-type-radial"] input')?.checked)`,
  );
  check("radial type can be selected", radialChecked, `checked=${radialChecked}`);
  await closePanel();

  const rad = { x: 800, y: 450 };
  await mouse("mousePressed", rad.x, rad.y, 1);
  for (const [dx, dy] of [
    [160, 0],
    [160, 120],
    [0, 120],
  ]) {
    await mouse("mouseMoved", rad.x + dx, rad.y + dy, 1);
    await sleep(40);
  }
  await sleep(200);
  await mouse("mouseReleased", rad.x, rad.y + 120, 0);
  await sleep(500);

  // The radial ramp is centred on the shape's centroid, which is the middle
  // of the lassoed rectangle.
  const radCentre = await sampleAt(canvasX(rad.x + 80), canvasY(rad.y + 60));
  const radCorner = await sampleAt(canvasX(rad.x + 6), canvasY(rad.y + 6));
  console.log("radial samples:", JSON.stringify({ radCentre, radCorner }));
  check(
    "radial gradient starts at the centre",
    radCentre.r > 150 && radCentre.b < 120,
    JSON.stringify(radCentre),
  );
  check(
    "radial gradient reaches blue at the edge",
    radCorner.b > 120 && radCorner.r < 120,
    JSON.stringify(radCorner),
  );

  // =========================================================================
  // TEST 5 — gradient with more than two colours
  // =========================================================================
  await openPanel();
  await pickStyle("Relleno degradado");
  await pickGradientType("linear");
  const stopsBefore = await evaluate(
    `document.querySelectorAll('[data-testid="draw-panel"] [data-testid^="gradient-swatch-"]').length`,
  );
  await evaluate(`document.querySelector('[data-testid="gradient-add-stop-1"]').click(); 'added'`);
  await sleep(600);
  const stopsAfter = await evaluate(
    `document.querySelectorAll('[data-testid="draw-panel"] [data-testid^="gradient-swatch-"]').length`,
  );
  check(
    "the + button adds a gradient stop",
    stopsAfter === stopsBefore + 1,
    `${stopsBefore} -> ${stopsAfter}`,
  );

  // The newly added stop is the one being edited; make it green.
  await setHex(1, "00FF00");
  const stopPositions = await evaluate(
    `Array.from(document.querySelectorAll('[data-testid="draw-panel"] [data-testid^="gradient-position-"]')).map(i => i.value)`,
  );
  check(
    "the new stop lands between its neighbours",
    stopPositions.length === 3 && stopPositions[2] === "100",
    JSON.stringify(stopPositions),
  );
  await closePanel();

  const t = { x: 400, y: 200 };
  await mouse("mousePressed", t.x, t.y, 1);
  for (const [dx, dy] of [
    [160, 0],
    [160, 120],
    [0, 120],
  ]) {
    await mouse("mouseMoved", t.x + dx, t.y + dy, 1);
    await sleep(40);
  }
  await sleep(200);
  await mouse("mouseReleased", t.x, t.y + 120, 0);
  await sleep(500);

  const threeTop = await sampleAt(canvasX(t.x + 12), canvasY(t.y + 12));
  const threeMid = await sampleAt(canvasX(t.x + 12), canvasY(t.y + 60));
  const threeEnd = await sampleAt(canvasX(t.x + 12), canvasY(t.y + 108));
  console.log("three-stop samples:", JSON.stringify({ threeTop, threeMid, threeEnd }));
  check(
    "three-stop gradient: first stop is red",
    threeTop.r > 150 && threeTop.g < 120,
    JSON.stringify(threeTop),
  );
  check(
    "three-stop gradient: middle stop is blue",
    threeMid.b > 120 && threeMid.r < 120,
    JSON.stringify(threeMid),
  );
  check(
    "three-stop gradient: last stop is green",
    threeEnd.g > 150 && threeEnd.r < 120,
    JSON.stringify(threeEnd),
  );

  // =========================================================================
  // TEST 6 — a stop's position along the ramp
  // =========================================================================
  await openPanel();
  await pickStyle("Relleno degradado");
  // Drop the third stop again so the ramp has a single colour change.
  await evaluate(`document.querySelector('[data-testid="gradient-swatch-2"]').click(); 'clicked'`);
  await sleep(500);
  await evaluate(`document.querySelector('[data-testid="gradient-remove-stop"]').click(); 'removed'`);
  await sleep(600);
  const stopsLeft = await evaluate(
    `document.querySelectorAll('[data-testid="draw-panel"] [data-testid^="gradient-swatch-"]').length`,
  );
  check("a stop can be removed", stopsLeft === 2, `stops=${stopsLeft}`);

  await setStopPosition(1, 25);
  const positions = await evaluate(
    `Array.from(document.querySelectorAll('[data-testid="draw-panel"] [data-testid^="gradient-position-"]')).map(i => i.value)`,
  );
  check(
    "the position slider moves a stop",
    positions.length === 2 && positions[1] === "25",
    JSON.stringify(positions),
  );
  await closePanel();

  const pos = { x: 800, y: 200 };
  await mouse("mousePressed", pos.x, pos.y, 1);
  for (const [dx, dy] of [
    [160, 0],
    [160, 120],
    [0, 120],
  ]) {
    await mouse("mouseMoved", pos.x + dx, pos.y + dy, 1);
    await sleep(40);
  }
  await sleep(200);
  await mouse("mouseReleased", pos.x, pos.y + 120, 0);
  await sleep(500);

  // The axis runs 120px; the blue stop now sits at 25% of it.
  const early = await sampleAt(canvasX(pos.x + 12), canvasY(pos.y + 12));
  const later = await sampleAt(canvasX(pos.x + 12), canvasY(pos.y + 72));
  console.log("position samples:", JSON.stringify({ early, later }));
  check(
    "the ramp reaches the second colour before the end of the axis",
    later.b > 150 && later.r < 60,
    JSON.stringify(later),
  );
  check(
    "the ramp is still mixed near the start",
    early.r > 60 && early.b > 60,
    JSON.stringify(early),
  );

  // =========================================================================
  // TEST 7 — the Select tool drags a selected shape
  // =========================================================================
  await evaluate(`document.querySelector('[data-testid="tool-select"]').click(); 'select'`);
  await sleep(400);

  // Lasso around the green rectangle painted in TEST 2.
  await mouse("mousePressed", 270, 470, 1);
  for (const [dx, dy] of [
    [260, 0],
    [260, 160],
    [0, 160],
  ]) {
    await mouse("mouseMoved", 270 + dx, 470 + dy, 1);
    await sleep(40);
  }
  await sleep(200);
  await mouse("mouseReleased", 270, 630, 0);
  await sleep(400);

  const selectionPixels = await countSelection(
    canvasX(280),
    canvasY(460),
    canvasX(520),
    canvasY(640),
  );
  check(
    "the Select tool lasso selects the shape",
    selectionPixels > 0,
    `selection pixels=${selectionPixels}`,
  );

  // Grab the shape by its body and drag it 150px to the right.
  await mouse("mousePressed", 450, 540, 1);
  for (let i = 1; i <= 8; i += 1) {
    await mouse("mouseMoved", 450 + i * 18.75, 540, 1);
    await sleep(40);
  }
  await sleep(200);
  await mouse("mouseReleased", 600, 540, 0);
  await sleep(500);

  const oldSpot = await sampleAt(canvasX(450), canvasY(540));
  const newSpot = await sampleAt(canvasX(600), canvasY(540));
  console.log("move samples:", JSON.stringify({ oldSpot, newSpot }));
  /** Whether a pixel is the green of the shape that was dragged. */
  const isGreen = (pixel) => pixel.g > 150 && pixel.r < 100 && pixel.b < 100;
  check(
    "dragging a selected shape moves it",
    !isGreen(oldSpot) && isGreen(newSpot),
    JSON.stringify({ oldSpot, newSpot }),
  );

  // =========================================================================
  // TEST 8 — the Select tool never paints, even with a fill style active
  // =========================================================================
  await openPanel();
  await pickStyle("Relleno degradado");
  await closePanel();
  await evaluate(`document.querySelector('[data-testid="tool-select"]').click(); 'select'`);
  await sleep(400);

  const before = await regionHash(
    canvasX(1000),
    canvasY(750),
    canvasX(1160),
    canvasY(870),
  );
  await mouse("mousePressed", 1000, 750, 1);
  for (const [dx, dy] of [
    [160, 0],
    [160, 120],
    [0, 120],
  ]) {
    await mouse("mouseMoved", 1000 + dx, 750 + dy, 1);
    await sleep(40);
  }
  await sleep(200);
  await mouse("mouseReleased", 1000, 870, 0);
  await sleep(500);
  const after = await regionHash(
    canvasX(1000),
    canvasY(750),
    canvasX(1160),
    canvasY(870),
  );
  check(
    "the Select tool lasso paints no shape",
    after.sum === before.sum && after.painted === before.painted,
    JSON.stringify({ before, after }),
  );

  // =========================================================================
  // TEST 9 — the Select tool scales from the opposite edge, and undo undoes it
  // =========================================================================
  // A solid green rectangle. A fill is easy to measure — its ink is exactly
  // the polygon — and a thin brush keeps the selection box tight around it.
  await evaluate(`document.querySelector('[data-testid="tool-draw"]').click(); 'draw'`);
  await sleep(300);
  await openPanel();
  await pickStyle("Rellenar");
  await pickSize("1");
  await setHex(0, "00FF00");
  const rectStyle = await readStyle();
  await closePanel();

  const RECT = { x: 120, y: 700, w: 100, h: 100 };
  /** The half of the brush width the selection box pads the ink with. */
  const half = Number(rectStyle.width) / 2;
  /** Canvas coordinates to page coordinates. */
  const pageX = (v) => v + geo.left;
  const pageY = (v) => v + geo.top;
  /** The region the rectangle and its scaled versions live in. */
  const region = [60, 590, 300, 880];

  await mouse("mousePressed", pageX(RECT.x), pageY(RECT.y), 1);
  for (const [dx, dy] of [
    [RECT.w, 0],
    [RECT.w, RECT.h],
    [0, RECT.h],
  ]) {
    await mouse("mouseMoved", pageX(RECT.x + dx), pageY(RECT.y + dy), 1);
    await sleep(40);
  }
  await sleep(200);
  await mouse("mouseReleased", pageX(RECT.x), pageY(RECT.y + RECT.h), 0);
  await sleep(500);

  const drawn = await greenBounds(...region);
  check(
    "the rectangle is drawn where it was asked for",
    drawn !== null &&
      Math.abs(drawn.minX - RECT.x) <= 5 &&
      Math.abs(drawn.minY - RECT.y) <= 5 &&
      Math.abs(drawn.maxX - (RECT.x + RECT.w)) <= 5 &&
      Math.abs(drawn.maxY - (RECT.y + RECT.h)) <= 5,
    JSON.stringify(drawn),
  );

  // Lasso it with the Select tool.
  await evaluate(`document.querySelector('[data-testid="tool-select"]').click(); 'select'`);
  await sleep(400);
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
  await sleep(200);
  await mouse("mouseReleased", pageX(RECT.x - 20), pageY(RECT.y + RECT.h + 20), 0);
  await sleep(500);

  const rectSelection = await countSelection(
    canvasX(pageX(RECT.x - 40)),
    canvasY(pageY(RECT.y - 60)),
    canvasX(pageX(RECT.x + RECT.w + 40)),
    canvasY(pageY(RECT.y + RECT.h + 20)),
  );
  check("the rectangle is selected", rectSelection > 0, `coral=${rectSelection}`);

  // Drag the top handle 100px up. The bottom edge has to stay put, the top
  // has to follow the pointer, and the shape must not turn inside out.
  const handleX = RECT.x + RECT.w / 2;
  const handleY = RECT.y - half;
  await mouse("mousePressed", pageX(handleX), pageY(handleY), 1);
  for (let step = 1; step <= 10; step += 1) {
    await mouse("mouseMoved", pageX(handleX), pageY(handleY - step * 10), 1);
    await sleep(30);
  }
  await sleep(200);
  await mouse("mouseReleased", pageX(handleX), pageY(handleY - 100), 0);
  await sleep(500);

  const scaled = await greenBounds(...region);
  console.log("scaled bounds:", JSON.stringify(scaled));
  check(
    "dragging the top handle up stretches the shape without flipping it",
    scaled !== null &&
      scaled.minY >= RECT.y - 105 &&
      scaled.minY <= RECT.y - 94 &&
      scaled.maxY >= RECT.y + RECT.h - 6 &&
      scaled.maxY <= RECT.y + RECT.h + 6 &&
      scaled.maxX - scaled.minX >= RECT.w - 8 &&
      scaled.maxX - scaled.minX <= RECT.w + 8,
    JSON.stringify(scaled),
  );
  check(
    "the bottom edge of the shape stayed where it was",
    scaled !== null && Math.abs(scaled.maxY - (RECT.y + RECT.h)) <= 6,
    JSON.stringify(scaled),
  );

  // Undo has to take the scale back.
  await evaluate(`document.querySelector('[data-testid="tool-undo"]').click(); 'undo'`);
  await sleep(500);
  const unscaled = await greenBounds(...region);
  check(
    "undo takes the scale back",
    unscaled !== null &&
      Math.abs(unscaled.minY - RECT.y) <= 5 &&
      Math.abs(unscaled.maxY - (RECT.y + RECT.h)) <= 5 &&
      Math.abs(unscaled.minX - RECT.x) <= 5 &&
      Math.abs(unscaled.maxX - (RECT.x + RECT.w)) <= 5,
    JSON.stringify(unscaled),
  );

  // Move the selection, then undo the move as well.
  await mouse("mousePressed", pageX(handleX), pageY(RECT.y + RECT.h / 2), 1);
  for (let step = 1; step <= 6; step += 1) {
    await mouse(
      "mouseMoved",
      pageX(handleX + step * 10),
      pageY(RECT.y + RECT.h / 2),
      1,
    );
    await sleep(30);
  }
  await sleep(200);
  await mouse("mouseReleased", pageX(handleX + 60), pageY(RECT.y + RECT.h / 2), 0);
  await sleep(500);

  const moved = await greenBounds(...region);
  check(
    "the Select tool drags the shape",
    moved !== null && Math.abs(moved.minX - (RECT.x + 60)) <= 8,
    JSON.stringify(moved),
  );

  await evaluate(`document.querySelector('[data-testid="tool-undo"]').click(); 'undo'`);
  await sleep(500);
  const movedBack = await greenBounds(...region);
  check(
    "undo takes the move back",
    movedBack !== null &&
      Math.abs(movedBack.minX - RECT.x) <= 5 &&
      Math.abs(movedBack.maxX - (RECT.x + RECT.w)) <= 5 &&
      Math.abs(movedBack.minY - RECT.y) <= 5,
    JSON.stringify(movedBack),
  );

  // =========================================================================
  // TEST 10 — the room: bar under Clear, chat, invite and reactions
  // =========================================================================
  const roomLayout = await evaluate(`(() => {
    const bar = document.querySelector('[data-testid="room-bar"]');
    const clear = document.querySelector('[data-testid="tool-clear"]');
    if (!bar || !clear) return null;
    const b = bar.getBoundingClientRect();
    const c = clear.getBoundingClientRect();
    return { barTop: b.top, barBottom: b.bottom, clearBottom: c.bottom, left: b.left };
  })()`);
  check(
    "the room bar sits under the Clear button",
    roomLayout !== null &&
      roomLayout.barTop >= roomLayout.clearBottom - 1 &&
      roomLayout.left < 140,
    JSON.stringify(roomLayout),
  );

  const roomControls = await evaluate(`(() => ({
    invite: !!document.querySelector('[data-testid="room-invite"]'),
    chat: !!document.querySelector('[data-testid="room-chat"]'),
    emoji: !!document.querySelector('[data-testid="room-emoji"]'),
    mic: !!document.querySelector('[data-testid="room-mic"]'),
    meter: !!document.querySelector('[data-testid="room-mic-meter"]'),
    bar: !!document.querySelector('[data-testid="room-chat-bar"]'),
    input: !!document.querySelector('[data-testid="room-chat-input"]'),
  }))()`);
  check(
    "the room controls are all on the board",
    Object.values(roomControls).every(Boolean),
    JSON.stringify(roomControls),
  );

  // The invite popover hands out the address of this very board.
  await evaluate(`document.querySelector('[data-testid="room-invite"]').click(); 'clicked'`);
  await sleep(400);
  const inviteLink = await evaluate(
    `document.querySelector('[data-testid="room-invite-link"]')?.value ?? ''`,
  );
  check(
    "the invite popover offers the board's own address",
    inviteLink.includes("/board/") && inviteLink.includes(BOARD.split("/board/")[1] ?? ""),
    inviteLink,
  );
  await evaluate(`document.querySelector('[data-testid="room-invite"]').click(); 'closed'`);
  await sleep(300);

  // Say something.
  await evaluate(`(() => {
    const input = document.querySelector('[data-testid="room-chat-input"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'hola room');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return 'typed';
  })()`);
  await sleep(250);
  await evaluate(`document.querySelector('[data-testid="room-chat-send"]').click(); 'sent'`);
  await sleep(500);

  const said = await evaluate(`(() => {
    const node = document.querySelector('[data-testid="room-message-text"]');
    return {
      text: node?.textContent ?? '',
      bubbles: document.querySelectorAll('[data-testid="room-message"]').length,
    };
  })()`);
  check(
    "a message shows up in the room",
    said.text === "hola room" && said.bubbles === 1,
    JSON.stringify(said),
  );

  const stored = await evaluate(
    `Object.keys(localStorage).filter(k => k.startsWith('wf_room_')).length`,
  );
  check("the room is kept per board", stored === 1, `rooms=${stored}`);

  // A reaction floats over the board.
  await evaluate(`document.querySelector('[data-testid="room-emoji"]').click(); 'clicked'`);
  await sleep(400);
  await evaluate(`document.querySelector('[data-testid="room-emoji-option"]').click(); 'sent'`);
  await sleep(500);
  const reactions = await evaluate(
    `document.querySelectorAll('[data-testid="room-reaction"]').length`,
  );
  check("a reaction floats over the board", reactions === 1, `reactions=${reactions}`);

  // The room survives a reload.
  await goto(BOARD);
  const survived = await evaluate(`(() => ({
    messages: document.querySelectorAll('[data-testid="room-message"]').length,
    text: document.querySelector('[data-testid="room-message-text"]')?.textContent ?? '',
  }))()`);
  check(
    "the room is still there after a reload",
    survived.messages === 1 && survived.text === "hola room",
    JSON.stringify(survived),
  );

  // A message that arrives while the chat is closed is worth a badge.
  const boardId = BOARD.split("/board/")[1];
  await evaluate(`document.querySelector('[data-testid="room-chat"]').click(); 'closed'`);
  await sleep(400);
  await evaluate(`(() => {
    const key = 'wf_room_' + ${JSON.stringify(boardId)};
    const room = JSON.parse(localStorage.getItem(key) || '{"messages":[],"reactions":[]}');
    room.messages.push({
      id: 'm-unread',
      author: 'Ana',
      deviceId: 'WM-OTHER-TAB',
      text: 'hola desde otra pestaña',
      ts: Date.now(),
    });
    const raw = JSON.stringify(room);
    localStorage.setItem(key, raw);
    // Another tab's write reaches this one through the storage event.
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: raw }));
    return 'injected';
  })()`);
  await sleep(600);
  const badge = await evaluate(
    `document.querySelector('[data-testid="room-unread"]')?.textContent ?? ''`,
  );
  check(
    "a message that arrives while the chat is closed is badged",
    badge === "1",
    `badge=${badge}`,
  );

  // Opening the chat clears the badge again.
  await evaluate(`document.querySelector('[data-testid="room-chat"]').click(); 'opened'`);
  await sleep(400);
  const badgeAfter = await evaluate(
    `document.querySelector('[data-testid="room-unread"]')?.textContent ?? ''`,
  );
  check(
    "opening the chat clears the badge",
    badgeAfter === "",
    `badge=${badgeAfter}`,
  );

  // =========================================================================
  // TEST 11 — the host keeps the board's own tools
  // =========================================================================
  const hostState = await evaluate(`(() => {
    const clear = document.querySelector('[data-testid="tool-clear"]');
    const hosts = JSON.parse(localStorage.getItem('wf_board_hosts') || '{}');
    return {
      disabled: clear ? clear.disabled : null,
      title: clear ? clear.title : '',
      host: hosts[${JSON.stringify(boardId)}] ?? null,
      device: localStorage.getItem('wf_device_id'),
    };
  })()`);
  check(
    "the device that opened the board is its host, and may clear it",
    hostState.disabled === false && hostState.host === hostState.device,
    JSON.stringify(hostState),
  );

  await evaluate(`document.querySelector('[data-testid="tool-options"]').click(); 'options'`);
  await sleep(500);
  await evaluate(`document.querySelector('[data-testid="options-tab-participants"]').click(); 'tab'`);
  await sleep(500);
  const roles = await evaluate(`(() => {
    const rows = Array.from(document.querySelectorAll('[data-testid="participant-row"]'));
    return rows.map((row) => ({
      self: row.getAttribute('data-self'),
      role: row.querySelector('[data-testid="participant-role"]')?.textContent ?? '',
    }));
  })()`);
  check(
    "the participants list says who the host is",
    roles.some((row) => row.self === "true" && row.role === "Host"),
    JSON.stringify(roles),
  );
  await evaluate(`document.querySelector('[data-testid="options-menu-close"]')?.click(); 'closed'`);
  await sleep(300);

  // Another device: a guest, with no rights over the board itself.
  await evaluate(`localStorage.setItem('wf_device_id','WM-OTHER-7788'); 'ok'`);
  await goto(BOARD);
  const guestState = await evaluate(`(() => {
    const clear = document.querySelector('[data-testid="tool-clear"]');
    return { disabled: clear ? clear.disabled : null, title: clear ? clear.title : '' };
  })()`);
  check(
    "a device that did not open the board cannot clear it",
    guestState.disabled === true,
    JSON.stringify(guestState),
  );

  await evaluate(`document.querySelector('[data-testid="tool-options"]').click(); 'options'`);
  await sleep(500);
  const guestColours = await evaluate(`(() => {
    const panel = document.querySelector('[data-testid="options-panel"]');
    const wheel = panel.querySelector('[data-testid="color-wheel"]');
    const note = panel.querySelector('[data-testid="bg-color-host-only"]');
    return {
      wheel: wheel ? wheel.getAttribute('data-disabled') : 'missing',
      note: note ? note.textContent.trim() : '',
    };
  })()`);
  check(
    "the background colour belongs to the host alone",
    guestColours.wheel === "true" && guestColours.note.length > 0,
    JSON.stringify(guestColours),
  );

  // A guest that types a colour anyway must not get its way.
  const guestBgBefore = await sampleAt(37, 37);
  await evaluate(`(() => {
    const input = document.querySelector('[data-testid="options-panel"] [data-testid="color-wheel-hex"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '00FF00');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return 'typed';
  })()`);
  await sleep(600);
  const guestBgAfter = await sampleAt(37, 37);
  check(
    "a guest's attempt to repaint the board is ignored",
    guestBgBefore.r === guestBgAfter.r &&
      guestBgBefore.g === guestBgAfter.g &&
      guestBgBefore.b === guestBgAfter.b,
    JSON.stringify({ guestBgBefore, guestBgAfter }),
  );

  // Back to the host.
  await evaluate(`localStorage.setItem('wf_device_id','WM-A3F9-2C71'); 'ok'`);
  await goto(BOARD);

  // =========================================================================
  // TEST 12 — the host paints the board's own colour
  // =========================================================================
  await evaluate(`document.querySelector('[data-testid="tool-options"]').click(); 'options'`);
  await sleep(500);
  await evaluate(`(() => {
    const input = document.querySelector('[data-testid="options-panel"] [data-testid="color-wheel-hex"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'FFEEDD');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return 'typed';
  })()`);
  await sleep(350);
  await evaluate(`(() => {
    const input = document.querySelector('[data-testid="options-panel"] [data-testid="color-wheel-hex"]');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return 'enter';
  })()`);
  await sleep(700);
  const painted = await sampleAt(37, 37);
  check(
    "the host's colour reaches the board",
    painted.r === 255 && painted.g === 238 && painted.b === 221,
    JSON.stringify(painted),
  );
  const savedSettings = await evaluate(
    `localStorage.getItem('wf_board_settings_' + ${JSON.stringify(boardId)})`,
  );
  check(
    "the board's colour is kept with the board",
    String(savedSettings).includes("ffeedd"),
    String(savedSettings),
  );

  // =========================================================================
  // TEST 13 — flip colours: a personal view of the board
  // =========================================================================
  await evaluate(`document.querySelector('[data-testid="options-tab-settings"]').click(); 'tab'`);
  await sleep(500);
  await evaluate(`document.querySelector('[data-testid="settings-flip-colors"]').click(); 'flip'`);
  await sleep(800);
  const flipped = await sampleAt(37, 37);
  check(
    "flip colours turns the board into its negative",
    flipped.r === 0 && flipped.g === 17 && flipped.b === 34,
    JSON.stringify(flipped),
  );
  await evaluate(`document.querySelector('[data-testid="settings-flip-colors"]').click(); 'unflip'`);
  await sleep(800);
  const unflipped = await sampleAt(37, 37);
  check(
    "turning the flip off puts the colours back",
    unflipped.r === 255 && unflipped.g === 238 && unflipped.b === 221,
    JSON.stringify(unflipped),
  );

  // =========================================================================
  // TEST 14 — the grid, and snapping to it
  // =========================================================================
  const gridOn = await sampleAt(80, 37);
  check(
    "the grid is drawn",
    gridOn.r === 232 && gridOn.g === 232 && gridOn.b === 232,
    JSON.stringify(gridOn),
  );
  await evaluate(`document.querySelector('[data-testid="settings-show-grid"]').click(); 'grid'`);
  await sleep(800);
  const gridOff = await sampleAt(80, 37);
  check(
    "the grid can be turned off",
    gridOff.r === 255 && gridOff.g === 238 && gridOff.b === 221,
    JSON.stringify(gridOff),
  );
  await evaluate(`document.querySelector('[data-testid="settings-show-grid"]').click(); 'grid'`);
  await sleep(800);

  // Snapping: a fill drawn well off the grid lands on it.
  await evaluate(`document.querySelector('[data-testid="settings-snap-to-grid"]').click(); 'snap'`);
  await sleep(500);
  await evaluate(`document.querySelector('[data-testid="tool-draw"]').click(); 'draw'`);
  await sleep(300);
  await openPanel();
  await pickStyle("Rellenar");
  await setHex(0, "00FF00");
  await closePanel();

  /** World coordinates of the rectangle the fill is dragged over. */
  const SNAP = { x: 907, y: 641, w: 110, h: 100 };
  await mouse("mousePressed", pageX(SNAP.x), pageY(SNAP.y), 1);
  for (const [dx, dy] of [
    [SNAP.w, 0],
    [SNAP.w, SNAP.h],
    [0, SNAP.h],
  ]) {
    await mouse("mouseMoved", pageX(SNAP.x + dx), pageY(SNAP.y + dy), 1);
    await sleep(40);
  }
  await sleep(200);
  await mouse("mouseReleased", pageX(SNAP.x), pageY(SNAP.y + SNAP.h), 0);
  await sleep(600);

  const snapped = await greenBounds(860, 580, 1120, 780);
  check(
    "a fill snaps to the grid",
    snapped !== null &&
      Math.abs(snapped.minX - 880) <= 6 &&
      Math.abs(snapped.minY - 640) <= 6 &&
      Math.abs(snapped.maxX - 1040) <= 6 &&
      Math.abs(snapped.maxY - 720) <= 6,
    JSON.stringify(snapped),
  );
  await evaluate(`document.querySelector('[data-testid="settings-snap-to-grid"]').click(); 'snap'`);
  await sleep(400);

  // =========================================================================
  // TEST 15 — importing media, and editing it like here.fm does
  // =========================================================================
  const stripOrder = await evaluate(`(() => {
    const strip = document.querySelector('#menuStrip');
    const ids = Array.from(strip.querySelectorAll('[data-testid]')).map((el) =>
      el.getAttribute('data-testid'),
    );
    const erase = document.querySelector('[data-testid="tool-erase"]').getBoundingClientRect();
    const imp = document.querySelector('[data-testid="tool-import"]').getBoundingClientRect();
    return { ids, eraseBottom: erase.bottom, importTop: imp.top };
  })()`);
  check(
    "the Import button sits right under Erase",
    stripOrder.ids.indexOf("tool-import") === stripOrder.ids.indexOf("tool-erase") + 1 &&
      stripOrder.importTop >= stripOrder.eraseBottom - 1,
    JSON.stringify(stripOrder),
  );

  await evaluate(`document.querySelector('[data-testid="tool-import"]').click(); 'clicked'`);
  await sleep(500);
  const importMenu = await evaluate(`(() => {
    const menu = document.querySelector('[data-testid="import-menu"]');
    if (!menu) return null;
    return {
      options: Array.from(menu.querySelectorAll('.importMenuOption')).map((o) =>
        o.textContent.trim(),
      ),
      file: !!menu.querySelector('[data-testid="import-image-file"] input[type=file]'),
      audio: !!menu.querySelector('[data-testid="import-audio"] input[type=file]'),
      voice: !!menu.querySelector('[data-testid="import-voice"]'),
    };
  })()`);
  check(
    "the Import menu offers here.fm's three ways in",
    importMenu !== null &&
      importMenu.options.join("|") === "Image or file|Audio|Record voice note" &&
      importMenu.file &&
      importMenu.audio &&
      importMenu.voice,
    JSON.stringify(importMenu),
  );

  // A magenta square, 120 by 120, with a green patch in its top-left corner.
  // The patch is what makes "Mirror" observable: a plain square looks the same
  // either way round.
  await evaluate(`(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 120;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(0, 0, 120, 120);
    ctx.fillStyle = '#00ff00';
    ctx.fillRect(8, 8, 28, 28);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const file = new File([blob], 'magenta-square.png', { type: 'image/png' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.querySelector('[data-testid="import-image-file"] input');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return 'imported';
  })()`);
  await sleep(1500);

  /** The middle of the board, where an import lands. */
  const MID = { x: Math.round(geo.bufW / 2), y: Math.round(geo.bufH / 2) };
  const landed = await blueBounds(MID.x - 200, MID.y - 200, MID.x + 200, MID.y + 200);
  check(
    "an imported picture lands in the middle of the board",
    landed !== null &&
      Math.abs(landed.minX - (MID.x - 60)) <= 4 &&
      Math.abs(landed.minY - (MID.y - 60)) <= 4 &&
      Math.abs(landed.maxX - (MID.x + 60)) <= 4 &&
      Math.abs(landed.maxY - (MID.y + 60)) <= 4,
    JSON.stringify(landed),
  );

  // The small options under the item are drawn on the canvas.
  const chrome = await countSelection(MID.x - 80, MID.y + 78, MID.x + 80, MID.y + 96);
  check(
    "the item shows its small options underneath",
    chrome > 0,
    `coral=${chrome}`,
  );

  // The three-dot menu.
  await evaluate(`document.querySelector('[data-testid="tool-select"]').click(); 'select'`);
  await sleep(400);
  await mouse("mousePressed", pageX(MID.x + 12), pageY(MID.y + 86), 1);
  await mouse("mouseReleased", pageX(MID.x + 12), pageY(MID.y + 86), 0);
  await sleep(600);
  const itemMenu = await evaluate(`(() => {
    const menu = document.querySelector('[data-testid="item-menu"]');
    if (!menu) return null;
    return {
      entries: Array.from(menu.querySelectorAll('button')).map((b) => b.textContent.trim()),
      left: menu.getBoundingClientRect().left,
    };
  })()`);
  const wanted = [
    "Move to front",
    "Move to back",
    "Pin",
    "Lock",
    "Mirror",
    "Duplicate",
    "Download Original",
    "Set as my avatar",
    "Delete",
  ];
  check(
    "the three-dot menu carries here.fm's options",
    itemMenu !== null && wanted.every((label) => itemMenu.entries.includes(label)),
    JSON.stringify(itemMenu),
  );

  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 'esc'`);
  await sleep(400);
  const menuGone = await evaluate(`!document.querySelector('[data-testid="item-menu"]')`);
  check("Escape closes the item menu", menuGone, `closed=${menuGone}`);

  // Growing the item: the resize handle is at the right of the options row.
  await mouse("mousePressed", pageX(MID.x + 36), pageY(MID.y + 86), 1);
  for (let step = 1; step <= 8; step += 1) {
    await mouse(
      "mouseMoved",
      pageX(MID.x + 36 + step * 4.5),
      pageY(MID.y + 86 + step * 10.75),
      1,
    );
    await sleep(30);
  }
  await sleep(200);
  await mouse("mouseReleased", pageX(MID.x + 72), pageY(MID.y + 172), 0);
  await sleep(600);
  const grown = await blueBounds(MID.x - 260, MID.y - 260, MID.x + 260, MID.y + 260);
  check(
    "the resize handle grows the item",
    grown !== null &&
      Math.abs(grown.maxX - grown.minX - 240) <= 10 &&
      Math.abs(grown.maxY - grown.minY - 240) <= 10,
    JSON.stringify(grown),
  );

  // Turning the item: the rotate handle is at the left of the options row.
  const handle = { x: MID.x - 12, y: MID.y + 146 };
  const angle = Math.atan2(handle.y - MID.y, handle.x - MID.x);
  const turnTo = {
    x: MID.x + Math.cos(angle - Math.PI / 4) * 146.5,
    y: MID.y + Math.sin(angle - Math.PI / 4) * 146.5,
  };
  await mouse("mousePressed", pageX(handle.x), pageY(handle.y), 1);
  for (let step = 1; step <= 8; step += 1) {
    await mouse(
      "mouseMoved",
      pageX(handle.x + ((turnTo.x - handle.x) * step) / 8),
      pageY(handle.y + ((turnTo.y - handle.y) * step) / 8),
      1,
    );
    await sleep(30);
  }
  await sleep(200);
  await mouse("mouseReleased", pageX(turnTo.x), pageY(turnTo.y), 0);
  await sleep(600);
  const turned = await blueBounds(MID.x - 260, MID.y - 260, MID.x + 260, MID.y + 260);
  check(
    "the rotate handle turns the item",
    turned !== null &&
      Math.abs(turned.maxX - turned.minX - 339) <= 14 &&
      Math.abs(turned.maxY - turned.minY - 339) <= 14,
    JSON.stringify(turned),
  );

  // Undo takes both transforms back, and the item is where it was.
  await evaluate(`document.querySelector('[data-testid="tool-undo"]').click(); 'undo'`);
  await sleep(500);
  await evaluate(`document.querySelector('[data-testid="tool-undo"]').click(); 'undo'`);
  await sleep(600);
  const undone = await blueBounds(MID.x - 200, MID.y - 200, MID.x + 200, MID.y + 200);
  check(
    "undo takes the transforms back",
    undone !== null &&
      Math.abs(undone.maxX - undone.minX - 120) <= 8 &&
      Math.abs(undone.maxY - undone.minY - 120) <= 8,
    JSON.stringify(undone),
  );

  // --- the Select tool: drag, options, and the three-dot actions -----------
  const dropped = { x: MID.x + 80, y: MID.y + 40 };
  await mouse("mousePressed", pageX(MID.x), pageY(MID.y), 1);
  for (let step = 1; step <= 8; step += 1) {
    await mouse("mouseMoved", pageX(MID.x + step * 10), pageY(MID.y + step * 5), 1);
    await sleep(25);
  }
  await mouse("mouseReleased", pageX(dropped.x), pageY(dropped.y), 0);
  await sleep(500);
  const dragged = await blueBounds(
    dropped.x - 160,
    dropped.y - 160,
    dropped.x + 160,
    dropped.y + 160,
  );
  check(
    "the Select tool drags the item",
    dragged !== null &&
      Math.abs(dragged.minX - (dropped.x - 60)) <= 6 &&
      Math.abs(dragged.minY - (dropped.y - 60)) <= 6 &&
      Math.abs(dragged.maxX - dragged.minX - 120) <= 6 &&
      Math.abs(dragged.maxY - dragged.minY - 120) <= 6,
    JSON.stringify(dragged),
  );

  const openMenuAt = async (x, y) => {
    await mouse("mousePressed", pageX(x), pageY(y), 1);
    await mouse("mouseReleased", pageX(x), pageY(y), 0);
    await sleep(500);
  };
  const menuButtons = () =>
    evaluate(
      `Array.from(document.querySelectorAll('[data-testid="item-menu"] button')).map((b) => b.textContent.trim())`,
    );

  await openMenuAt(dropped.x + 12, dropped.y + 86);
  const movedMenu = await menuButtons();
  check(
    "the menu shows the reference options in order",
    movedMenu.join("|") === wanted.join("|"),
    JSON.stringify(movedMenu),
  );

  // Pin toggles, and keeps the item in front of the others.
  await evaluate(`document.querySelector('[data-testid="item-menu-pin"]').click(); 'pin'`);
  await sleep(400);
  await openMenuAt(dropped.x + 12, dropped.y + 86);
  const pinnedLabels = await menuButtons();
  check(
    "Pin pins the item",
    pinnedLabels.includes("Unpin") && !pinnedLabels.includes("Pin"),
    JSON.stringify(pinnedLabels),
  );
  await evaluate(`document.querySelector('[data-testid="item-menu-pin"]').click(); 'unpin'`);
  await sleep(400);
  await openMenuAt(dropped.x + 12, dropped.y + 86);
  const unpinnedLabels = await menuButtons();
  check(
    "Pin toggles back to Unpin",
    unpinnedLabels.includes("Pin") && !unpinnedLabels.includes("Unpin"),
    JSON.stringify(unpinnedLabels),
  );

  // A press on the background puts the options away — both the menu and the
  // row of small options drawn on the canvas.
  const away = { x: MID.x + 440, y: MID.y + 300 };
  await mouse("mousePressed", pageX(away.x), pageY(away.y), 1);
  await mouse("mouseReleased", pageX(away.x), pageY(away.y), 0);
  await sleep(500);
  const menuClosedByBackground = await evaluate(`!document.querySelector('[data-testid="item-menu"]')`);
  const chromeGone = await countSelection(
    dropped.x - 80,
    dropped.y + 76,
    dropped.x + 80,
    dropped.y + 96,
  );
  check(
    "a press on the background puts the options away",
    menuClosedByBackground && chromeGone === 0,
    `menuGone=${menuClosedByBackground} coral=${chromeGone}`,
  );

  // Picking the picture up again brings them back, without moving it.
  await mouse("mousePressed", pageX(dropped.x), pageY(dropped.y), 1);
  await mouse("mouseReleased", pageX(dropped.x), pageY(dropped.y), 0);
  await sleep(500);
  const chromeBack = await countSelection(
    dropped.x - 80,
    dropped.y + 76,
    dropped.x + 80,
    dropped.y + 96,
  );
  const stillMoved = await blueBounds(
    dropped.x - 160,
    dropped.y - 160,
    dropped.x + 160,
    dropped.y + 160,
  );
  check(
    "selecting the picture again brings the options back",
    chromeBack > 0 &&
      stillMoved !== null &&
      Math.abs(stillMoved.minX - (dropped.x - 60)) <= 4 &&
      Math.abs(stillMoved.minY - (dropped.y - 60)) <= 4,
    `coral=${chromeBack} bounds=${JSON.stringify(stillMoved)}`,
  );

  // Lock: the item keeps its place.
  await openMenuAt(dropped.x + 12, dropped.y + 86);
  await evaluate(`document.querySelector('[data-testid="item-menu-lock"]').click(); 'lock'`);
  await sleep(400);
  await openMenuAt(dropped.x + 12, dropped.y + 86);
  const lockedLabels = await menuButtons();
  check(
    "Lock locks the item",
    lockedLabels.includes("Unlock") && !lockedLabels.includes("Lock"),
    JSON.stringify(lockedLabels),
  );
  await evaluate(
    `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); 'esc'`,
  );
  await sleep(300);
  await mouse("mousePressed", pageX(dropped.x), pageY(dropped.y), 1);
  for (let step = 1; step <= 5; step += 1) {
    await mouse("mouseMoved", pageX(dropped.x + step * 8), pageY(dropped.y), 1);
    await sleep(25);
  }
  await mouse("mouseReleased", pageX(dropped.x + 40), pageY(dropped.y), 0);
  await sleep(500);
  const lockedStill = await blueBounds(
    dropped.x - 160,
    dropped.y - 160,
    dropped.x + 160,
    dropped.y + 160,
  );
  check(
    "a locked item cannot be dragged",
    lockedStill !== null && Math.abs(lockedStill.minX - (dropped.x - 60)) <= 4,
    JSON.stringify(lockedStill),
  );
  await openMenuAt(dropped.x + 12, dropped.y + 86);
  await evaluate(`document.querySelector('[data-testid="item-menu-lock"]').click(); 'unlock'`);
  await sleep(400);

  // Mirror: the green patch changes sides.
  const markerLeft = await sampleAt(dropped.x - 38, dropped.y - 38);
  await openMenuAt(dropped.x + 12, dropped.y + 86);
  await evaluate(`document.querySelector('[data-testid="item-menu-mirror"]').click(); 'mirror'`);
  await sleep(500);
  const markerRight = await sampleAt(dropped.x + 38, dropped.y - 38);
  const markerLeftAfter = await sampleAt(dropped.x - 38, dropped.y - 38);
  check(
    "Mirror flips the picture",
    markerLeft.g > 150 &&
      markerLeft.r < 120 &&
      markerRight.g > 150 &&
      markerRight.r < 120 &&
      markerLeftAfter.r > 180,
    JSON.stringify({ markerLeft, markerRight, markerLeftAfter }),
  );
  await openMenuAt(dropped.x + 12, dropped.y + 86);
  await evaluate(`document.querySelector('[data-testid="item-menu-mirror"]').click(); 'mirror'`);
  await sleep(500);

  // Download Original hands the file to the browser.
  await evaluate(`(() => {
    window.__itemDownloads = [];
    window.__anchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      window.__itemDownloads.push({ href: this.href, name: this.download });
    };
    return 'stubbed';
  })()`);
  await openMenuAt(dropped.x + 12, dropped.y + 86);
  await evaluate(`document.querySelector('[data-testid="item-menu-download"]').click(); 'download'`);
  await sleep(300);
  const downloads = await evaluate(`window.__itemDownloads`);
  check(
    "Download Original saves the file",
    downloads.length === 1 &&
      downloads[0].name === "magenta-square.png" &&
      (downloads[0].href.startsWith("data:image/png") ||
        downloads[0].href.startsWith("blob:")),
    JSON.stringify(
      downloads.map((download) => ({
        name: download.name,
        href: String(download.href).slice(0, 22),
      })),
    ),
  );
  await evaluate(`HTMLAnchorElement.prototype.click = window.__anchorClick; 'restored'`);

  // Set as my avatar shows the picture in the room bar.
  await openMenuAt(dropped.x + 12, dropped.y + 86);
  await evaluate(`document.querySelector('[data-testid="item-menu-avatar"]').click(); 'avatar'`);
  await sleep(900);
  const avatar = await evaluate(`(() => {
    const stored = localStorage.getItem('wf_avatar') || '';
    return {
      stored: stored.slice(0, 22),
      shown: !!document.querySelector('[data-testid="room-chat-avatar"]'),
    };
  })()`);
  check(
    "Set as my avatar uses the picture in the room bar",
    avatar.stored.startsWith("data:image/") && avatar.shown,
    JSON.stringify(avatar),
  );

  // Duplicate, then restack the two copies.
  await openMenuAt(dropped.x + 12, dropped.y + 86);
  await evaluate(`document.querySelector('[data-testid="item-menu-duplicate"]').click(); 'duplicate'`);
  await sleep(600);
  const doubled = await blueBounds(
    dropped.x - 180,
    dropped.y - 180,
    dropped.x + 180,
    dropped.y + 180,
  );
  check(
    "Duplicate makes a second copy",
    doubled !== null &&
      Math.abs(doubled.maxX - doubled.minX - 144) <= 8 &&
      Math.abs(doubled.maxY - doubled.minY - 144) <= 8,
    JSON.stringify(doubled),
  );

  // The copy lands 24px down-right of the original and is selected. Its green
  // patch overlaps the original, which is how the stacking is observed.
  const copyDots = { x: dropped.x + 36, y: dropped.y + 110 };
  const copyInFront = await sampleAt(dropped.x - 14, dropped.y - 14);
  await openMenuAt(copyDots.x, copyDots.y);
  await evaluate(`document.querySelector('[data-testid="item-menu-back"]').click(); 'back'`);
  await sleep(500);
  const copyBehind = await sampleAt(dropped.x - 14, dropped.y - 14);
  await openMenuAt(copyDots.x, copyDots.y);
  await evaluate(`document.querySelector('[data-testid="item-menu-front"]').click(); 'front'`);
  await sleep(500);
  const copyBackInFront = await sampleAt(dropped.x - 14, dropped.y - 14);
  check(
    "Move to back and Move to front restack the copies",
    copyInFront.g > 150 &&
      copyBehind.r > 180 &&
      copyBackInFront.g > 150,
    JSON.stringify({ copyInFront, copyBehind, copyBackInFront }),
  );

  for (let step = 0; step < 3; step += 1) {
    await evaluate(`document.querySelector('[data-testid="tool-undo"]').click(); 'undo'`);
    await sleep(400);
  }
  const single = await blueBounds(
    dropped.x - 160,
    dropped.y - 160,
    dropped.x + 160,
    dropped.y + 160,
  );
  check(
    "undo removes the duplicate and both restacks",
    single !== null && Math.abs(single.maxX - single.minX - 120) <= 8,
    JSON.stringify(single),
  );

  // And the three-dot menu can throw the item away.
  await openMenuAt(dropped.x + 12, dropped.y + 86);
  await evaluate(`document.querySelector('[data-testid="item-menu-delete"]').click(); 'deleted'`);
  await sleep(700);
  const removed = await blueBounds(
    dropped.x - 160,
    dropped.y - 160,
    dropped.x + 160,
    dropped.y + 160,
  );
  check("the three-dot menu deletes the item", removed === null, JSON.stringify(removed));

  // =========================================================================
  // TEST 16 — a resized picture can still be picked up
  // =========================================================================
  // The hit test is in the item's own frame, so it must use the scaled size
  // once: shrinking a picture used to shrink its grab area twice.
  await evaluate(`document.querySelector('[data-testid="tool-import"]').click(); 'clicked'`);
  await sleep(400);
  await evaluate(`(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 120;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(0, 0, 120, 120);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const file = new File([blob], 'small-square.png', { type: 'image/png' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = document.querySelector('[data-testid="import-image-file"] input');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return 'imported';
  })()`);
  await sleep(1500);

  // Shrink it to about half its size with the resize handle.
  await mouse("mousePressed", pageX(MID.x + 36), pageY(MID.y + 86), 1);
  for (let step = 1; step <= 8; step += 1) {
    await mouse(
      "mouseMoved",
      pageX(MID.x + 36 - (18 * step) / 8),
      pageY(MID.y + 86 - (43 * step) / 8),
      1,
    );
    await sleep(25);
  }
  await mouse("mouseReleased", pageX(MID.x + 18), pageY(MID.y + 43), 0);
  await sleep(600);
  const shrunk = await blueBounds(
    MID.x - 120,
    MID.y - 120,
    MID.x + 120,
    MID.y + 120,
  );
  check(
    "the resize handle can shrink the item",
    shrunk !== null && Math.abs(shrunk.maxX - shrunk.minX - 60) <= 8,
    JSON.stringify(shrunk),
  );

  // Grab it near its edge — inside the 60px picture, outside the 30px square
  // the double-scaled hit test used to answer on.
  await mouse("mousePressed", pageX(MID.x + 22), pageY(MID.y), 1);
  for (let step = 1; step <= 8; step += 1) {
    await mouse("mouseMoved", pageX(MID.x + 22 + step * 6.25), pageY(MID.y), 1);
    await sleep(25);
  }
  await mouse("mouseReleased", pageX(MID.x + 72), pageY(MID.y), 0);
  await sleep(600);
  const pickedUp = await blueBounds(
    MID.x - 60,
    MID.y - 120,
    MID.x + 200,
    MID.y + 120,
  );
  check(
    "a resized picture can still be dragged by the Select tool",
    pickedUp !== null &&
      Math.abs(pickedUp.minX - (MID.x - 30 + 50)) <= 8 &&
      Math.abs(pickedUp.maxX - pickedUp.minX - 60) <= 8,
    JSON.stringify(pickedUp),
  );

  // =========================================================================
  // summary
  // =========================================================================
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  ws.close();
  cleanup();
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error("FAILED:", error.message);
  cleanup();
  process.exitCode = 1;
});
