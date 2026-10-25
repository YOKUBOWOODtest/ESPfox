"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Column } from "./column";
import { useJoinedBoards } from "./use-board";
import {
  displayName,
  readStoredNickname,
  setNickname,
  useDeviceUser,
} from "./use-device-user";

const inputClass =
  "w-[320px] rounded-[5px] border border-solid border-brand-border bg-white px-[10px] py-[8px] text-[18px] font-[300] text-brand";

const buttonClass =
  "inline-block cursor-pointer rounded-[5px] px-[20px] py-[9px] text-center text-[20px] font-[300] text-white";

const cardClass =
  "w-full max-w-[470px] rounded-[6px] border border-solid border-[#e5e5e5] bg-white p-[20px] shadow-sm";

/**
 * The Lobby is where a device gets its identity. There is no login: the visitor
 * is the browser, so the Lobby only has to capture a nickname and mint an id.
 */
export function LobbySection() {
  const user = useDeviceUser();
  const joined = useJoinedBoards();
  const search = useSearchParams();
  const fromBoard = search.get("from") === "board";

  /** Seeded from storage so hydration does not blank an existing nickname. */
  const [draft, setDraft] = useState(() => readStoredNickname() ?? "");
  const [saved, setSaved] = useState(false);

  const hasNickname = user.nickname !== null;

  const save = () => {
    setNickname(draft);
    setSaved(true);
  };

  return (
    <Column>
      <div className="px-[50px] py-[50px]">
        <h1 className="pb-[10px] text-[48px] font-[100]">Lobby</h1>

        {!hasNickname && (
          <p
            className="max-w-[700px] text-[20px]"
            style={{ lineHeight: "160%" }}
            data-testid="lobby-gate-note"
          >
            {fromBoard
              ? "Antes de entrar a un pizarrón necesitas un apodo: así te identificamos en la lista de participantes."
              : "Elige un apodo para empezar. No hay cuentas ni inicio de sesión: te identificamos por este dispositivo."}
          </p>
        )}

        <div className="mt-[24px] flex flex-wrap items-start gap-[20px]">
          <div className={cardClass} data-testid="lobby-identity-card">
            <h2 className="pb-[10px] text-[26px] font-[100]">Tu identidad</h2>

            <div className="text-[16px]" style={{ lineHeight: "200%" }}>
              <div>
                ID del dispositivo:{" "}
                <code data-testid="lobby-device-id" className="text-brand-soft">
                  {user.id || "…"}
                </code>
              </div>
              <div>
                Apodo actual:{" "}
                <strong data-testid="lobby-current-nickname">
                  {saved ? draft.trim() || "Invitado" : displayName(user)}
                </strong>
              </div>
            </div>

            <div className="mt-[16px]">
              <label htmlFor="lobby-nickname" className="block text-[16px]">
                Apodo
              </label>
              <input
                id="lobby-nickname"
                type="text"
                maxLength={24}
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setSaved(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    save();
                  }
                }}
                placeholder="Elige un apodo"
                className={inputClass}
                style={{ fontFamily: "Roboto, sans-serif" }}
              />
              <button
                type="button"
                id="lobbySaveNicknameButton"
                onClick={save}
                className={`${buttonClass} ml-[10px] bg-[#ff6a00]`}
                style={{ fontFamily: "Roboto, sans-serif" }}
              >
                Guardar apodo
              </button>
            </div>

            <p className="mt-[10px] text-[14px] text-brand-soft">
              El apodo es lo único que puedes cambiar; el ID es fijo para este
              navegador.
            </p>

            <div className="mt-[16px]">
              {/* Static hosts need a full page load here: `/board/new` is a
                  rewrite to the board shell, not a prerendered Next route. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a
                href="/board/new"
                aria-disabled={!hasNickname}
                onClick={(event) => {
                  if (!hasNickname) {
                    event.preventDefault();
                  }
                }}
                className={`${buttonClass} ${
                  hasNickname
                    ? "bg-brand"
                    : "cursor-not-allowed bg-[#d9d9d9] text-[#8a8a8a]"
                }`}
                id="lobbyCreateBoard"
                style={{ fontFamily: "Roboto, sans-serif" }}
              >
                Crear pizarrón
              </a>
            </div>
          </div>

          <div className={cardClass} data-testid="lobby-recent-card">
            <h2 className="pb-[10px] text-[26px] font-[100]">
              Pizarrones recientes
            </h2>
            {joined.length === 0 ? (
              <p className="text-[16px] text-brand-soft">
                Todavía no has entrado a ningún pizarrón.
              </p>
            ) : (
              <ul className="text-[16px]" style={{ lineHeight: "200%" }}>
                {joined.map((board) => (
                  <li key={board.id}>
                    <a
                      href={`/board/${board.id}`}
                      className="text-brand underline"
                    >
                      {board.id}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </Column>
  );
}
