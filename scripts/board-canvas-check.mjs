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
    for (let i = 3; i < col.length; i += 4) { if (col[i] > 0) { run++; maxRun = Math.max(maxRun, run); } else run = 0; }
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
  check(
    "dragging a selected shape moves it",
    oldSpot.g < 120 && newSpot.g > 150 && newSpot.r < 100 && newSpot.b < 100,
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
  // TEST 9 — the room: bar under Clear, chat, invite and reactions
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
