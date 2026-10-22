"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The room microphone.
 *
 * here.fm shows a little level meter next to your avatar so people can see
 * that they are talking. This hook does the same with the real input level:
 * the stream is analysed with an `AnalyserNode` and the RMS is turned into a
 * 0..1 value that the meter draws.
 *
 * The microphone is off until it is asked for, and every failure mode is a
 * state rather than an exception: a browser without `getUserMedia`, a denied
 * permission and a missing device all end up in a state the button can show.
 */

export type MicState = "off" | "starting" | "on" | "denied" | "unavailable";

export interface MicApi {
  state: MicState;
  /** Input level, from 0 (silence) to 1. */
  level: number;
  /** Turns the microphone on, or off when it is already running. */
  toggle: () => void;
}

/** Older WebKit builds only expose the prefixed constructor. */
type AudioContextConstructor = new () => AudioContext;

function audioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === "undefined") return null;
  const prefixed = (window as unknown as { webkitAudioContext?: AudioContextConstructor })
    .webkitAudioContext;
  return prefixed ?? window.AudioContext ?? null;
}

export function useRoomMic(): MicApi {
  const [state, setState] = useState<MicState>("off");
  const [level, setLevel] = useState(0);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const frameRef = useRef(0);

  const release = useCallback(() => {
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void contextRef.current?.close().catch(() => undefined);
    contextRef.current = null;
    setLevel(0);
  }, []);

  // The microphone never outlives the board.
  useEffect(() => release, [release]);

  const start = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setState("unavailable");
      return;
    }
    setState("starting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setState("denied");
      return;
    }
    streamRef.current = stream;

    const Constructor = audioContextConstructor();
    if (!Constructor) {
      setState("unavailable");
      return;
    }
    const context = new Constructor();
    contextRef.current = context;
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    const source = context.createMediaStreamSource(stream);
    source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);

    const read = () => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) {
        const centred = (sample - 128) / 128;
        sum += centred * centred;
      }
      // The RMS of a normal voice is well under 1, so it is scaled up before
      // it is clamped to the meter's range.
      const rms = Math.sqrt(sum / samples.length);
      setLevel(Math.min(1, rms * 3));
      frameRef.current = requestAnimationFrame(read);
    };
    frameRef.current = requestAnimationFrame(read);
    setState("on");
  }, []);

  const toggle = useCallback(() => {
    if (state === "on" || state === "starting") {
      release();
      setState("off");
      return;
    }
    void start();
  }, [release, start, state]);

  return { state, level, toggle };
}
