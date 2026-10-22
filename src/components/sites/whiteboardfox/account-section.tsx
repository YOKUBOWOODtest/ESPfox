"use client";

import { useState } from "react";
import { Column } from "./column";
import {
  displayName,
  readStoredNickname,
  setNickname,
  useDeviceUser,
} from "./use-device-user";
import { usePro } from "./use-pro";

const inputClass =
  "w-[320px] rounded-[5px] border border-solid border-brand-border bg-white px-[10px] py-[8px] text-[18px] font-[300] text-brand";

/**
 * Full profile page. Identity comes from the device id, so the nickname is the
 * only editable field; everything else is read-only reference.
 */
export function AccountSection() {
  const user = useDeviceUser();
  const pro = usePro();
  /**
   * Seeded from storage rather than `user.nickname`: during hydration the store
   * still reports its server snapshot (`null`), which would leave the field
   * blank and then overwrite a real nickname on save.
   */
  const [draft, setDraft] = useState(() => readStoredNickname() ?? "");
  const [saved, setSaved] = useState(false);

  const save = () => {
    setNickname(draft);
    setSaved(true);
  };

  return (
    <Column>
      <div className="px-[50px] py-[50px]">
        <h1 className="pb-[10px] text-[48px] font-[100]">Perfil</h1>
        <p className="max-w-[700px] text-[20px]" style={{ lineHeight: "160%" }}>
          No hay cuentas ni inicio de sesión. Te identificamos automáticamente
          por este dispositivo, y el apodo es lo único que puedes cambiar.
        </p>

        <div className="mt-[24px] text-[18px]" style={{ lineHeight: "200%" }}>
          <div>
            ID del dispositivo:{" "}
            <code data-testid="account-device-id" className="text-brand-soft">
              {user.id || "…"}
            </code>
          </div>
          <div>
            Plan: <strong>{pro ? "Pro activo" : "Gratis"}</strong>
          </div>
        </div>

        <div className="mt-[24px]">
          <label htmlFor="account-nickname" className="block text-[16px]">
            Apodo
          </label>
          <input
            id="account-nickname"
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
            id="saveNicknameButton"
            onClick={save}
            className="ml-[10px] inline-block cursor-pointer rounded-[5px] bg-[#ff6a00] px-[20px] py-[9px] text-center text-[20px] font-[300] text-white"
            style={{ fontFamily: "Roboto, sans-serif" }}
          >
            Guardar apodo
          </button>

          <p className="mt-[10px] text-[18px]" aria-live="polite">
            {saved ? "Apodo guardado: " : "Nombre actual: "}
            <strong data-testid="account-nickname">
              {saved ? draft.trim() || "Invitado" : displayName(user)}
            </strong>
          </p>
        </div>
      </div>
    </Column>
  );
}
