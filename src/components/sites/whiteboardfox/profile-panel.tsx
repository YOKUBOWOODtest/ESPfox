"use client";

import { useState } from "react";
import {
  displayName,
  readStoredNickname,
  setNickname,
  useDeviceUser,
} from "./use-device-user";
import { usePro } from "./use-pro";

const inputClass =
  "w-full rounded-[5px] border border-solid border-brand-border bg-white px-[10px] py-[8px] text-[18px] font-[300] text-brand";

const actionClass =
  "inline-block cursor-pointer rounded-[5px] px-[20px] py-[10px] text-center text-[20px] font-[300] no-underline";

/**
 * Profile overlay. The device id is shown for reference but is read-only — the
 * nickname is the only thing a visitor can change, since identity is bound to
 * the browser rather than an account.
 */
export function ProfilePanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const user = useDeviceUser();
  const pro = usePro();
  /** Seeded from storage, not `user.nickname`, for the same hydration reason. */
  const [draft, setDraft] = useState(() => readStoredNickname() ?? "");

  /**
   * The draft is seeded from the stored nickname when the panel opens. Remount
   * via `key` in `UserChip` resets it, so no state-syncing effect is needed.
   */
  const save = () => {
    setNickname(draft);
    onClose();
  };

  return (
    <div
      id="profileEl"
      className="absolute top-[100px] left-[150px] z-100 w-[480px] bg-[#eeeeee] p-[10px]"
      style={{
        boxShadow: "5px 5px 30px #333333",
        visibility: open ? "visible" : "hidden",
      }}
      aria-hidden={!open}
    >
      <div>
        Perfil
        <div className="float-right">
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar perfil"
            className="cursor-pointer px-[8px] text-[22px] font-[300] leading-[24px]"
          >
            ×
          </button>
        </div>
      </div>

      <div
        className="mt-[3px] bg-white px-[40px] py-[20px]"
        style={{ lineHeight: "160%" }}
      >
        {user.nickname === null && (
          <p className="mb-[10px] text-[16px]">
            No hay cuentas ni inicio de sesión: te identificamos por este
            dispositivo. Elige un apodo para empezar.
          </p>
        )}

        <label htmlFor="nickname" className="block text-[16px]">
          Apodo
        </label>
        <input
          id="nickname"
          type="text"
          maxLength={24}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
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
        <p className="mt-[6px] text-[14px] text-brand-soft">
          Este es el único dato que puedes cambiar.
        </p>

        <div className="mt-[16px] text-[16px]">
          <div>
            ID del dispositivo:{" "}
            <code data-testid="device-id" className="text-brand-soft">
              {user.id || "…"}
            </code>
          </div>
          <div>
            Nombre actual:{" "}
            <strong data-testid="current-nickname">{displayName(user)}</strong>
          </div>
          <div>
            Plan:{" "}
            <strong data-testid="plan-state">
              {pro ? "Pro activo" : "Gratis"}
            </strong>
          </div>
        </div>
      </div>

      <div className="mt-[10px] bg-white px-[10px] py-[10px]">
        <div className="float-right">
          <button
            type="button"
            onClick={onClose}
            className={`${actionClass} mr-[10px] bg-[#eeeeee] text-brand`}
            style={{ fontFamily: "Roboto, sans-serif" }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={save}
            className={`${actionClass} bg-[#ff6a00] text-white`}
            style={{ fontFamily: "Roboto, sans-serif" }}
          >
            Guardar apodo
          </button>
        </div>
      </div>
    </div>
  );
}
