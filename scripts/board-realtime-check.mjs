/**
 * Two-device realtime regression for the board.
 *
 * Opens two independent headless Chrome profiles against the same board and
 * checks what the collaboration server promises: every device appears in the
 * users list, strokes cross between them, undo only rolls back the device that
 * pressed it, and only the host may clear.
 *
 * The custom server (Next + Socket.io) must be running:
 *
 *   npm run build
 *   npm start
 *
 * Usage:
 *   node scripts/board-realtime-check.mjs
 *
 * Environment:
 *   CHROME_PATH   path to chrome.exe  (default: the standard Windows install)
 *   ORIGIN        app origin          (default: http://localhost:3000)
 */

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const CHROME =
  process.env.CHROME_PATH ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ORIGIN = process.env.ORIGIN ?? "http://localhost:3000";
const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const BOARD = `${ORIGIN}/board/RT-${SUFFIX}`;

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
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

const chromeProcesses = [];
const profiles = [];

function launch(name, port) {
  const dir = path.join(os.tmpdir(), `wbmod-rt-${name}-${SUFFIX}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  profiles.push(dir);
  const child = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${dir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--window-size=1200,900",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  chromeProcesses.push(child);
  return { port };
}

function cleanup() {
  for (const child of chromeProcesses) {
    try {
      child.kill();
    } catch {
      // Already gone.
    }
  }
  for (const dir of profiles) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // The browser still holds a file; the OS temp folder will reclaim it.
    }
  }
}
process.on("exit", cleanup);

async function waitForDevtools(port) {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return;
    } catch {
      // Not up yet.
    }
    await sleep(200);
  }
  throw new Error(`devtools never came up on ${port}`);
}

async function openDevice(name, port, nickname, deviceId) {
  await waitForDevtools(port);
  const res = await fetch(
    `http://127.0.0.1:${port}/json/new?${encodeURIComponent("about:blank")}`,
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
    width: 1200,
    height: 900,
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
        `evaluate failed: ${r.exceptionDetails.text} ${
          r.exceptionDetails.exception?.description ?? ""
        }`,
      );
    }
    return r.result.value;
  };

  const goto = async (url) => {
    await cdp.send("Page.navigate", { url });
    await sleep(1800);
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

  const draw = async (y) => {
    await mouse("mousePressed", 300, y, 1);
    for (let x = 300; x <= 500; x += 10) {
      await mouse("mouseMoved", x, y, 1);
      await sleep(16);
    }
    await mouse("mouseReleased", 500, y, 0);
    await sleep(250);
  };

  /** The darkest ink in a small box around a viewport point. */
  const sample = (x, y) =>
    evaluate(`(() => {
      const c = document.querySelector('[data-testid="boardCanvas"]');
      if (!c) return { ink: 0, missing: true };
      const r = c.getBoundingClientRect();
      const scale = c.width / r.width;
      const ctx = c.getContext('2d');
      const half = 2;
      const px = Math.round((${x} - r.left) * scale) - half;
      const py = Math.round((${y} - r.top) * scale) - half;
      const data = ctx.getImageData(px, py, 5, 5).data;
      let best = { r: 255, g: 255, b: 255, ink: 0 };
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const ink = 255 - Math.min(r, g, b);
        if (ink > best.ink) best = { r, g, b, ink };
      }
      return best;
    })()`);

  const openParticipants = async () => {
    await evaluate(`document.querySelector('[data-testid="tool-options"]').click(); 'open'`);
    await sleep(400);
    await evaluate(
      `document.querySelector('[data-testid="options-tab-participants"]').click(); 'participants'`,
    );
    await sleep(400);
  };
  const closeParticipants = async () => {
    await evaluate(
      `document.querySelector('[data-testid="options-menu-close"]')?.click(); 'close'`,
    );
    await sleep(400);
  };
  const participantNames = async () => {
    await openParticipants();
    const names = await evaluate(
      `Array.from(document.querySelectorAll('[data-testid="participant-name"]')).map((el) => el.textContent.trim())`,
    );
    const roles = await evaluate(
      `Array.from(document.querySelectorAll('[data-testid="participant-role"]')).map((el) => el.textContent.trim())`,
    );
    await closeParticipants();
    return { names, roles };
  };

  await goto(`${ORIGIN}/lobby`);
  await evaluate(
    `localStorage.setItem('wf_nickname', ${JSON.stringify(nickname)});
     localStorage.setItem('wf_device_id', ${JSON.stringify(deviceId)});
     localStorage.removeItem('wf_board_hosts');
     'ok'`,
  );
  await goto(BOARD);

  return {
    name,
    cdp,
    evaluate,
    mouse,
    draw,
    sample,
    participantNames,
    close: () => ws.close(),
  };
}

async function main() {
  launch("a", 9335);
  launch("b", 9336);
  const a = await openDevice("A", 9335, "Ana", "RT-DEVICE-A");
  const hostBefore = await a.evaluate(`(() => {
    const button = document.querySelector('[data-testid="tool-clear"]');
    return button ? { disabled: button.disabled } : null;
  })()`);
  check(
    "the first device can clear the board",
    hostBefore && hostBefore.disabled === false,
    JSON.stringify(hostBefore),
  );

  const b = await openDevice("B", 9336, "Beto", "RT-DEVICE-B");
  await sleep(1200);

  const guestsA = await a.participantNames();
  const guestsB = await b.participantNames();
  check(
    "both devices appear in A's users list",
    guestsA.names.length === 2 &&
      guestsA.names.some((name) => name.includes("Ana")) &&
      guestsA.names.some((name) => name.includes("Beto")),
    JSON.stringify(guestsA.names),
  );
  check(
    "both devices appear in B's users list",
    guestsB.names.length === 2 &&
      guestsB.names.some((name) => name.includes("Ana")) &&
      guestsB.names.some((name) => name.includes("Beto")),
    JSON.stringify(guestsB.names),
  );
  check(
    "the users list marks the first device as host",
    guestsA.roles.includes("Host") && guestsB.roles.includes("Host"),
    JSON.stringify({ a: guestsA.roles, b: guestsB.roles }),
  );

  const guestClear = await b.evaluate(`(() => {
    const button = document.querySelector('[data-testid="tool-clear"]');
    return button ? { disabled: button.disabled } : null;
  })()`);
  check(
    "a guest cannot clear the board",
    guestClear && guestClear.disabled === true,
    JSON.stringify(guestClear),
  );

  const blank = await a.sample(400, 300);
  await a.draw(300);
  await sleep(700);
  const bSeesA = await b.sample(400, 300);
  check(
    "a stroke drawn by A reaches B",
    blank.ink < 80 && bSeesA.ink > 120,
    JSON.stringify({ blank, bSeesA }),
  );

  await b.draw(400);
  await sleep(700);
  const aSeesB = await a.sample(400, 400);
  check(
    "a stroke drawn by B reaches A",
    aSeesB.ink > 120,
    JSON.stringify(aSeesB),
  );

  // Undo isolation: A's undo must take back A's stroke and nothing else.
  await a.draw(500);
  await b.draw(600);
  await sleep(900);
  const greenBefore = await a.sample(400, 500);
  const purpleBefore = await a.sample(400, 600);
  await a.evaluate(`document.querySelector('[data-testid="tool-undo"]').click(); 'undo'`);
  await sleep(1000);
  const greenAfterA = await a.sample(400, 500);
  const purpleAfterA = await a.sample(400, 600);
  const greenAfterB = await b.sample(400, 500);
  const purpleAfterB = await b.sample(400, 600);
  check(
    "A's undo removes A's newest stroke",
    greenBefore.ink > 120 && greenAfterA.ink < 80 && greenAfterB.ink < 80,
    JSON.stringify({ greenBefore, greenAfterA, greenAfterB }),
  );
  check(
    "A's undo leaves B's stroke alone",
    purpleBefore.ink > 120 && purpleAfterA.ink > 120 && purpleAfterB.ink > 120,
    JSON.stringify({ purpleBefore, purpleAfterA, purpleAfterB }),
  );
  check(
    "A's earlier stroke survives A's undo",
    (await a.sample(400, 300)).ink > 120 && (await b.sample(400, 300)).ink > 120,
  );

  // The host's clear reaches both devices.
  await a.evaluate(`document.querySelector('[data-testid="tool-clear"]').click(); 'clear'`);
  await sleep(1000);
  const clearedA = await a.sample(400, 300);
  const clearedB = await b.sample(400, 400);
  check(
    "the host's clear empties both boards",
    clearedA.ink < 80 && clearedB.ink < 80,
    JSON.stringify({ clearedA, clearedB }),
  );

  a.close();
  b.close();

  const failures = results.filter((result) => !result.pass).length;
  console.log(
    failures === 0
      ? `\n${results.length}/${results.length} checks passed`
      : `\n${results.length - failures}/${results.length} checks passed`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("REALTIME TEST ERROR", error);
  process.exit(1);
});
