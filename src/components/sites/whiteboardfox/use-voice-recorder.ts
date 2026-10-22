"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Voice notes.
 *
 * here.fm lets a room record a voice note and drop it on the board. The
 * recording is done with `MediaRecorder`, which needs a microphone stream; the
 * browser asks for permission, so every failure mode has to be visible rather
 * than silent.
 *
 * The state machine is deliberately explicit:
 *
 *   idle        nothing is being recorded
 *   requesting  the browser is asking for the microphone
 *   recording   the microphone is live
 *   denied      the user (or the browser) refused
 *   unsupported this browser cannot record at all
 */

export type RecorderStatus =
  | "idle"
  | "requesting"
  | "recording"
  | "denied"
  | "unsupported";

export interface VoiceRecording {
  /** The recording, as a data URL so it can be saved with the board. */
  src: string;
  /** How long the recording is, in seconds. */
  duration: number;
}

/** Reads a blob as a data URL. */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the recording"));
    reader.readAsDataURL(blob);
  });
}

export function useVoiceRecorder() {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);

  // The elapsed time is read from the clock rather than counted, so a late
  // tick cannot make the label drift away from the recording.
  useEffect(() => {
    if (status !== "recording") {
      return;
    }
    const timer = window.setInterval(() => {
      setElapsed((Date.now() - startedAtRef.current) / 1000);
    }, 200);
    return () => window.clearInterval(timer);
  }, [status]);

  /** Asks for the microphone and starts recording. */
  const start = useCallback(async () => {
    if (typeof window === "undefined") {
      return;
    }
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setStatus("unsupported");
      setError("This browser cannot record audio.");
      return;
    }
    setStatus("requesting");
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
      };
      recorder.start();
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      setElapsed(0);
      setStatus("recording");
    } catch {
      setStatus("denied");
      setError("The microphone is not available.");
    }
  }, []);

  /**
   * Stops the recording and hands the audio back.
   *
   * The promise resolves once the recorder has flushed its last chunk, so the
   * data URL is never missing the end of the note.
   */
  const stop = useCallback(async (): Promise<VoiceRecording | null> => {
    const recorder = recorderRef.current;
    if (!recorder) {
      return null;
    }
    recorderRef.current = null;
    const duration = (Date.now() - startedAtRef.current) / 1000;
    const finished = new Promise<Blob>((resolve) => {
      recorder.addEventListener(
        "stop",
        () => {
          resolve(
            new Blob(chunksRef.current, {
              type: recorder.mimeType || "audio/webm",
            }),
          );
        },
        { once: true },
      );
    });
    if (recorder.state !== "inactive") {
      recorder.stop();
    }
    const blob = await finished;
    setStatus("idle");
    setElapsed(0);
    if (blob.size === 0) {
      setError("Nothing was recorded.");
      return null;
    }
    return { src: await blobToDataUrl(blob), duration };
  }, []);

  /** Throws the recording away. */
  const cancel = useCallback(() => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    setStatus("idle");
    setElapsed(0);
    setError(null);
  }, []);

  return { status, elapsed, error, start, stop, cancel };
}
