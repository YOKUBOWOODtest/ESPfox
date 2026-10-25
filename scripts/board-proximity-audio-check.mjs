/**
 * Proximity audio regression.
 *
 * The relay check proves the play command reaches the other device; this one
 * proves the device acts on it as a listener: the clip is loud while the view
 * sits on it, silent once the board has been panned far away, and loud again on
 * the way back. A headless tab still runs the audio element, so the volume the
 * paint loop writes can be read straight from it.
 *
 * Audio is captured by wrapping `window.Audio` before the app loads: the board
 * keeps its element in a ref, not in the DOM, so this is the only way to see it
 * from the outside.
 *
 * Usage:
 *   npm run build && npm start       # in another shell
 *   node scripts/board-proximity-audio-check.mjs
 *
 * Environment:
 *   CHROME_PATH   path to chrome.exe  (default: the standard Windows install)
 *   ORIGIN        app origin          (default: http://localhost:3000)
 *   CDP_PORT      debugging port      (default: 9336)
 */

import { spawn, spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const CHROME =
  process.env.CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = Number(process.env.CDP_PORT ?? 9336);
const ORIGIN = process.env.ORIGIN ?? "http://localhost:3000";
const BOARD = `${ORIGIN}/board/PA-${Date.now()}`;

const userDataDir = path.join(os.tmpdir(), `wbmod-pa-profile-${Date.now()}`);
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
    "--autoplay-policy=no-user-gesture-required",
    "--window-size=1500,950",
    "about:blank",
  ],
  { stdio: "ignore" },
);

function cleanup() {
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
      // Keep every audio element the board builds, so the test can read the
      // volume the proximity loop writes (it lives in a ref, not the DOM).
      (() => {
        const Original = window.Audio;
        window.__wbAudios = [];
        const Wrapped = function (...args) {
          const audio = new Original(...args);
          window.__wbAudios.push(audio);
          return audio;
        };
        Wrapped.prototype = Original.prototype;
        window.Audio = Wrapped;
      })();
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
  const waitFor = async (expression, label) => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (await evaluate(expression)) return true;
      await sleep(250);
    }
    throw new Error(`timed out waiting for ${label}`);
  };
  /** What every captured audio element is doing right now. */
  const audioState = () =>
    evaluate(`(() => (window.__wbAudios || []).map((a) => ({
      src: (a.currentSrc || a.src || '').slice(0, 24),
      preload: a.preload,
      paused: a.paused,
      muted: a.muted,
      volume: a.volume,
      time: a.currentTime,
      duration: a.duration,
    })))()`);

  // ---- profile ------------------------------------------------------------
  await goto(`${ORIGIN}/lobby`);
  await evaluate(`localStorage.setItem('wf_nickname','Sorda');
    localStorage.setItem('wf_device_id','WM-PA55-1234');
    localStorage.setItem('wf_pro','true'); 'ok'`);

  await goto(BOARD, '[data-testid="boardCanvas"]');
  const geo = await evaluate(`(() => {
    const c = document.querySelector('[data-testid="boardCanvas"]');
    const r = c.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  })()`);
  const pageX = (v) => v + geo.left;
  const pageY = (v) => v + geo.top;

  // ---- import a short silent clip ----------------------------------------
  await evaluate(`(() => {
    // A real WAV, so the browser reports a duration and can play it.
    const seconds = 8;
    const rate = 8000;
    const samples = seconds * rate;
    const buffer = new ArrayBuffer(44 + samples * 2);
    const view = new DataView(buffer);
    const write = (offset, text) => {
      for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
    };
    write(0, 'RIFF');
    view.setUint32(4, 36 + samples * 2, true);
    write(8, 'WAVE');
    write(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    write(36, 'data');
    view.setUint32(40, samples * 2, true);
    window.__wbTestFile = new File([buffer], 'prueba.wav', { type: 'audio/wav' });
    return 'ready';
  })()`);

  await evaluate(`document.querySelector('[data-testid="tool-import"]').click(); 'menu'`);
  await sleep(300);
  await evaluate(`(() => {
    const input = document.querySelector('[data-testid="import-audio"] input[type="file"]');
    const transfer = new DataTransfer();
    transfer.items.add(window.__wbTestFile);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return 'picked';
  })()`);
  await waitFor(
    `(window.__wbAudios || []).some((a) => a.preload === 'metadata' && a.duration > 0)`,
    "the clip metadata",
  );
  await sleep(800);
  const imported = await audioState();
  check(
    "the clip lands on the board",
    imported.some((entry) => entry.preload === "metadata" && entry.duration > 7),
    JSON.stringify(imported),
  );

  // ---- press the play button on the card ---------------------------------
  // The import lands at the middle of the view; the button sits at local
  // x = -width / 2 + 30, and the card is 240 wide.
  const playX = pageX(geo.width / 2 - 120 + 30);
  const playY = pageY(geo.height / 2);
  await mouse("mousePressed", playX, playY, 1);
  await mouse("mouseReleased", playX, playY, 0);
  await sleep(1200);

  const playing = await audioState();
  const player = playing.find((entry) => entry.preload === "auto");
  check(
    "pressing the play button starts the clip",
    player !== undefined && player.paused === false,
    JSON.stringify(playing),
  );
  check(
    "a clip under the view plays at full volume",
    player !== undefined && player.volume === 1 && player.muted === false,
    JSON.stringify(player),
  );

  // Keep it going for the whole trip; the clip itself is short.
  await evaluate(`(() => {
    const found = (window.__wbAudios || []).find((a) => a.preload === 'auto' && !a.paused);
    if (found) found.loop = true;
    return found ? 'looped' : 'missing';
  })()`);

  // ---- pan far away ------------------------------------------------------
  await evaluate(`document.querySelector('[data-testid="tool-move"]').click(); 'move'`);
  await sleep(300);
  const pan = async (fromX, deltaX) => {
    await mouse("mousePressed", pageX(fromX), pageY(300), 1);
    for (const step of [0.25, 0.5, 0.75, 1]) {
      await mouse(
        "mouseMoved",
        pageX(fromX + deltaX * step),
        pageY(300),
        1,
      );
      await sleep(60);
    }
    await sleep(200);
    await mouse("mouseReleased", pageX(fromX + deltaX), pageY(300), 0);
    await sleep(450);
  };
  // At 100% zoom a 1000px drag moves the view 1000 world units.
  await pan(1200, -1000);
  await pan(1200, -1000);
  const far = await audioState();
  const farPlayer = far.find((entry) => entry.preload === "auto");
  check(
    "the clip is silent once the view leaves it",
    farPlayer !== undefined && (farPlayer.volume === 0 || farPlayer.muted === true),
    JSON.stringify(farPlayer),
  );
  check(
    "leaving the clip does not stop it",
    farPlayer !== undefined && farPlayer.paused === false,
    JSON.stringify(farPlayer),
  );

  // ---- come back ---------------------------------------------------------
  await pan(200, 1000);
  await pan(200, 1000);
  const near = await audioState();
  const nearPlayer = near.find((entry) => entry.preload === "auto");
  check(
    "coming back restores the volume",
    nearPlayer !== undefined && nearPlayer.volume === 1 && nearPlayer.muted === false,
    JSON.stringify(nearPlayer),
  );

  // ---- a second press pauses --------------------------------------------
  await mouse("mousePressed", playX, playY, 1);
  await mouse("mouseReleased", playX, playY, 0);
  await sleep(900);
  const stopped = await audioState();
  const stoppedPlayer = stopped.find((entry) => entry.preload === "auto");
  check(
    "pressing again pauses the clip",
    stoppedPlayer !== undefined && stoppedPlayer.paused === true,
    JSON.stringify(stoppedPlayer),
  );

  // ---- report -------------------------------------------------------------
  const failed = results.filter((entry) => !entry.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  try {
    ws.close();
  } catch {
    // Already gone.
  }
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
