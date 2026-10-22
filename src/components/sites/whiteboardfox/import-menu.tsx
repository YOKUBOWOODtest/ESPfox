"use client";

import { useRef, useState } from "react";
import { ImportIcon } from "./board-icons";
import { useVoiceRecorder } from "./use-voice-recorder";
import {
  AUDIO_CARD_HEIGHT,
  AUDIO_CARD_WIDTH,
  type ImportedMedia,
} from "@/lib/board/imported";

/**
 * The Import button and its menu.
 *
 * here.fm's room offers exactly three ways to bring media in:
 *
 *   - Upload Image or File
 *   - Upload Audio
 *   - Record Voice Note
 *
 * (its fourth option, "Share Web App", embeds another web app in the room and
 * has no meaning on a whiteboard, so it is left out).
 *
 * The menu hangs off the tool strip and opens to the right of it, the same way
 * the Options panel does, so the 140px strip is never covered.
 */

/**
 * How big a file may be before it is kept as an object URL.
 *
 * Small files are inlined as data URLs, which means they survive a reload and
 * can be written to the board's own saved copy. Anything bigger stays as an
 * object URL, which the browser frees when the tab closes.
 */
const MAX_INLINE_BYTES = 1_500_000;

/** The longest edge an imported picture may have, in world units. */
const MAX_IMAGE_EDGE = 480;

/** The longest edge a picture may have before it is scaled down. */
const FILE_CARD_WIDTH = 240;
const FILE_CARD_HEIGHT = 72;

/** Reads a blob as a data URL. */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(reader.error ?? new Error("Could not read the file"));
    reader.readAsDataURL(blob);
  });
}

/**
 * The address of a file.
 *
 * Small files become data URLs, so they can be saved with the board; large
 * ones become object URLs, which are cheap but do not outlive the tab.
 */
async function fileSource(file: File): Promise<string> {
  if (file.size <= MAX_INLINE_BYTES) {
    try {
      return await blobToDataUrl(file);
    } catch {
      // Fall back to the object URL when the file cannot be read.
    }
  }
  return URL.createObjectURL(file);
}

/** The natural size of an image, once it has been decoded. */
function imageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () =>
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve({ width: 0, height: 0 });
    image.src = src;
  });
}

/** The length of an audio file, once its metadata has loaded. */
function audioDuration(src: string): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio();
    audio.preload = "metadata";
    audio.onloadedmetadata = () => resolve(Number.isFinite(audio.duration) ? audio.duration : 0);
    audio.onerror = () => resolve(0);
    audio.src = src;
  });
}

/** Scales a picture down so its longest edge is at most `MAX_IMAGE_EDGE`. */
function fitImage(width: number, height: number) {
  if (width <= 0 || height <= 0) {
    return { width: MAX_IMAGE_EDGE, height: MAX_IMAGE_EDGE };
  }
  const longest = Math.max(width, height);
  if (longest <= MAX_IMAGE_EDGE) {
    return { width, height };
  }
  const factor = MAX_IMAGE_EDGE / longest;
  return { width: width * factor, height: height * factor };
}

export interface ImportMenuProps {
  /** Called with the media that was brought in; the board places it. */
  onImport: (media: ImportedMedia) => void;
}

export function ImportMenu({ onImport }: ImportMenuProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const recorder = useVoiceRecorder();
  /** The two file inputs, opened by their labels. */
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  /** Handles a picked image or any other file. */
  const handleFile = async (file: File | undefined) => {
    if (!file) {
      return;
    }
    setBusy("file");
    setMessage(null);
    try {
      const src = await fileSource(file);
      if (file.type.startsWith("image/")) {
        const natural = await imageSize(src);
        const fitted = fitImage(natural.width, natural.height);
        onImport({
          kind: "image",
          name: file.name,
          src,
          width: fitted.width,
          height: fitted.height,
          duration: 0,
        });
      } else {
        onImport({
          kind: "file",
          name: file.name,
          src,
          width: FILE_CARD_WIDTH,
          height: FILE_CARD_HEIGHT,
          duration: 0,
        });
      }
      setOpen(false);
    } catch {
      setMessage("That file could not be read.");
    } finally {
      setBusy(null);
    }
  };

  /** Handles a picked audio file. */
  const handleAudio = async (file: File | undefined) => {
    if (!file) {
      return;
    }
    setBusy("audio");
    setMessage(null);
    try {
      const src = await fileSource(file);
      const duration = await audioDuration(src);
      onImport({
        kind: "audio",
        name: file.name,
        src,
        width: AUDIO_CARD_WIDTH,
        height: AUDIO_CARD_HEIGHT,
        duration,
      });
      setOpen(false);
    } catch {
      setMessage("That audio file could not be read.");
    } finally {
      setBusy(null);
    }
  };

  /** Records a voice note and drops it on the board. */
  const handleVoice = async () => {
    if (recorder.status === "recording") {
      setBusy("voice");
      const recording = await recorder.stop();
      setBusy(null);
      if (recording) {
        onImport({
          kind: "voice",
          name: "Voice note",
          src: recording.src,
          width: AUDIO_CARD_WIDTH,
          height: AUDIO_CARD_HEIGHT,
          duration: recording.duration,
        });
        setOpen(false);
      }
      return;
    }
    await recorder.start();
  };

  return (
    <div className="importWrap">
      <button
        type="button"
        className="menu-button"
        title="Import an image, a file, an audio file or a voice note"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
          setMessage(null);
        }}
        data-testid="tool-import"
      >
        <span className="html-face">
          <ImportIcon />
          Import
        </span>
      </button>

      {open && (
        <div className="importMenu" data-testid="import-menu">
          <div className="importMenuTitle">Import</div>

          <label className="importMenuOption" data-testid="import-image-file">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                void handleFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            {busy === "file" ? "Reading file…" : "Image or file"}
          </label>

          <label className="importMenuOption" data-testid="import-audio">
            <input
              ref={audioInputRef}
              type="file"
              accept="audio/*"
              hidden
              onChange={(event) => {
                void handleAudio(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            {busy === "audio" ? "Reading audio…" : "Audio"}
          </label>

          <button
            type="button"
            className="importMenuOption"
            onClick={() => {
              void handleVoice();
            }}
            disabled={busy === "voice"}
            data-testid="import-voice"
          >
            {recorder.status === "recording"
              ? `Stop recording (${recorder.elapsed.toFixed(1)}s)`
              : busy === "voice"
                ? "Saving…"
                : "Record voice note"}
          </button>

          {recorder.status === "recording" && (
            <div className="importRecording" data-testid="import-recording">
              <span className="importRecordingDot" />
              <span>{recorder.elapsed.toFixed(1)}s</span>
              <button
                type="button"
                className="importRecordingCancel"
                onClick={recorder.cancel}
                data-testid="import-voice-cancel"
              >
                Cancel
              </button>
            </div>
          )}

          {(recorder.error ?? message) && (
            <p className="importMenuMessage" data-testid="import-error">
              {recorder.error ?? message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
