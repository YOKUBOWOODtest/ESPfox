"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { usePro } from "./use-pro";

const OTHER_PARTICIPANTS = [
  { id: "editLimited", label: "Draw and erase their own drawing" },
  { id: "editFull", label: "Draw and erase anything" },
  { id: "broadcast", label: "Only view my drawing" },
] as const;

type ParticipantOption = (typeof OTHER_PARTICIPANTS)[number]["id"];
type InviteeTarget = "NOTIFY_FOLLOWERS" | "ALLOW_ANYONE";

/**
 * Board options overlay, opened straight from `Start Drawing`.
 *
 * The source's fun/work interstitial is gone: there is no branch any more, so
 * the form is always the visible state.
 */
export function OptionsPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const pro = usePro();
  const router = useRouter();
  const [participants, setParticipants] =
    useState<ParticipantOption>("editLimited");
  const [invitees, setInvitees] = useState(true);
  const [inviteeTarget, setInviteeTarget] =
    useState<InviteeTarget>("ALLOW_ANYONE");
  const [creating, setCreating] = useState(false);

  /**
   * Pro is free here, so an activated device keeps the unrestricted invite
   * target and is never asked to sign in. Without Pro the source's defaults
   * apply: participants must have an account.
   */
  const limitCopy = invitees && inviteeTarget === "ALLOW_ANYONE";
  const forceAuthParticipants =
    !pro &&
    invitees &&
    (inviteeTarget === "ALLOW_ANYONE" || inviteeTarget === "NOTIFY_FOLLOWERS");

  /** Creates a local board, inheriting the Lobby nickname + device id. */
  const createBoard = () => {
    setCreating(true);
    router.push("/board/new");
  };

  return (
    <div
      id="optionsEl"
      className="absolute z-100 w-[480px] bg-[#eeeeee] p-[10px]"
      style={{
        boxShadow: "5px 5px 30px #333333",
        visibility: open ? "visible" : "hidden",
      }}
      aria-hidden={!open}
    >
      <div>
        Options
        <div className="float-right">
          <button type="button" onClick={onClose} aria-label="Close options">
            <Image
              src="/sites/whiteboardfox/close-button.png"
              alt=""
              width={24}
              height={24}
            />
          </button>
        </div>
      </div>

      <div className="mt-[20px] bg-white px-[40px] py-[20px]" hidden={!creating}>
        <div
          className="mb-[20px] inline-block h-[50px] w-[50px] rounded-full border-[5px] border-black/10"
          style={{
            borderTopColor: "var(--color-brand-soft)",
            animation: "wf-spin 1s ease-in-out infinite",
          }}
        />
        <p>Creating whiteboard...</p>
      </div>

      <div hidden={creating}>
        <div
          className="mt-[3px] bg-white px-[20px] py-[20px] pl-[40px]"
          style={{ fontFamily: "Roboto, sans-serif", lineHeight: "160%" }}
        >
          <form
            id="createWhiteboardForm"
            onSubmit={(event) => {
              event.preventDefault();
              createBoard();
            }}
          >
            <input type="hidden" name="copyLimited" value={String(limitCopy)} />
            <input
              type="hidden"
              name="force-auth-participants"
              value={String(forceAuthParticipants)}
            />
            <input type="hidden" name="expiry" value="14" />

            Other participants can:
            <br />
            <table>
              <tbody>
                {OTHER_PARTICIPANTS.map((option) => (
                  <tr key={option.id}>
                    <td className="pr-[10px] pt-[5px] align-top">
                      <input
                        type="radio"
                        id={option.id}
                        name="broadcast"
                        value={option.id}
                        checked={participants === option.id}
                        onChange={() => setParticipants(option.id)}
                      />
                    </td>
                    <td className="pt-[5px]">
                      <label htmlFor={option.id}>{option.label}</label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="my-[20px] flex items-center">
              <div className="pr-[10px]">
                <input
                  id="invitees-check"
                  type="checkbox"
                  checked={invitees}
                  onChange={(event) => setInvitees(event.target.checked)}
                />
              </div>
              <span className="mr-[8px]">Invite</span>
              <select
                id="invitees-select"
                className="rounded-[5px] border border-solid border-brand-border p-[3px] text-[18px] font-[300] text-brand-border"
                style={{ fontFamily: "Roboto, sans-serif" }}
                value={inviteeTarget}
                onChange={(event) => {
                  setInviteeTarget(event.target.value as InviteeTarget);
                  setInvitees(true);
                }}
              >
                {/* A board invites by device, so "anyone" is the only target. */}
                <option value="ALLOW_ANYONE">anyone</option>
                <option value="NOTIFY_FOLLOWERS" disabled>
                  my followers
                </option>
              </select>
              <span className="ml-[8px]">to join</span>
            </div>

            <p className="text-[14px]" hidden={!limitCopy}>
              Copy and image upload for participants will be disabled
            </p>

            <p
              className="text-[14px] text-brand-soft"
              data-testid="pro-options-note"
            >
              {pro
                ? "Pro activo: invita a cualquiera, sin cuenta y sin publicidad."
                : "Con Pro (gratis) puedes invitar a cualquiera sin cuenta."}
            </p>
          </form>
        </div>

        <div className="h-[50px] bg-white px-[20px] pr-[10px] pl-[10px]">
          <div className="float-right">
            <a
              href="/options"
              className="mr-[10px] inline-block rounded-[5px] bg-[#eeeeee] px-[20px] py-[10px] text-center text-[22px] font-[300] text-brand no-underline"
              style={{ fontFamily: "Roboto, sans-serif" }}
            >
              More Options
            </a>{" "}
            <button
              type="button"
              id="createWhiteboardButton"
              onClick={createBoard}
              className="inline-block cursor-pointer rounded-[5px] bg-[#ff6a00] px-[20px] py-[10px] text-center text-[22px] font-[300] text-white"
              style={{ fontFamily: "Roboto, sans-serif" }}
            >
              Create Whiteboard
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
