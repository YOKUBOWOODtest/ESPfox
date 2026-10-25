/**
 * Audio relay regression.
 *
 * The board lets anyone start a clip and expects the whole room to hear it, at
 * the same position. The pixels cannot show that, so this check speaks to the
 * collaboration server the way two boards do: join the same board from two
 * sockets, ask one to play, and assert the other receives the command with its
 * position intact.
 *
 * Usage:
 *   npm run build && npm start       # in another shell
 *   node scripts/board-audio-check.mjs
 *
 * Environment:
 *   ORIGIN   app origin (default: http://localhost:3000)
 */

import { io } from "socket.io-client";
import { setTimeout as sleep } from "node:timers/promises";

const ORIGIN = process.env.ORIGIN ?? "http://localhost:3000";
const BOARD = `AUDIO-${Date.now()}`;
const ALICE = "WM-A111-0001";
const BOB = "WM-B222-0002";

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " :: " + detail : ""}`);
}

function connect(userId, name) {
  return new Promise((resolve, reject) => {
    const socket = io(ORIGIN, {
      transports: ["websocket"],
      reconnection: false,
      timeout: 5000,
    });
    const timer = setTimeout(() => reject(new Error(`${name} never joined`)), 7000);
    socket.on("connect", () => {
      socket.emit("board:join", {
        boardId: BOARD,
        userId,
        name,
        hue: 0,
      });
    });
    socket.on("board:state", () => {
      // The first state after joining means the server has seated the device.
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on("connect_error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function main() {
  const alice = await connect(ALICE, "Ana");
  const bob = await connect(BOB, "Beto");

  const heard = new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 4000);
    bob.on("audio:play", (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });

  alice.emit("audio:play", {
    boardId: BOARD,
    itemId: "clip-1",
    position: 12.5,
    playing: true,
  });

  const relayed = await heard;
  check("a play command reaches the other device", relayed !== null, JSON.stringify(relayed));
  check(
    "the relay keeps the clip id",
    relayed?.itemId === "clip-1",
    JSON.stringify(relayed?.itemId),
  );
  check(
    "the relay keeps the playback position",
    Math.abs(Number(relayed?.position) - 12.5) < 0.001,
    JSON.stringify(relayed?.position),
  );
  check(
    "the relay keeps the playing flag",
    relayed?.playing === true,
    JSON.stringify(relayed?.playing),
  );

  const paused = new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 4000);
    bob.once("audio:play", (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
  alice.emit("audio:play", {
    boardId: BOARD,
    itemId: "clip-1",
    position: 31,
    playing: false,
  });
  const stop = await paused;
  check(
    "a pause command reaches the other device",
    stop !== null && stop.playing === false && Math.abs(Number(stop.position) - 31) < 0.001,
    JSON.stringify(stop),
  );

  // A device that is not on the board must not hear anything.
  const stranger = io(ORIGIN, { transports: ["websocket"], reconnection: false });
  let leaked = false;
  stranger.on("audio:play", () => {
    leaked = true;
  });
  await sleep(500);
  alice.emit("audio:play", {
    boardId: BOARD,
    itemId: "clip-2",
    position: 0,
    playing: true,
  });
  await sleep(700);
  check("a device outside the board hears nothing", leaked === false);

  stranger.close();
  alice.close();
  bob.close();
  await sleep(200);

  const failed = results.filter((entry) => !entry.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

