"use client";

import { Avatar } from "./board-icons";
import { useDeviceUser } from "./use-device-user";
import type { Participant } from "./use-board";

/**
 * Live participants panel.
 *
 * Mirrors the source's `.liveUsersPanel` / `#usersTable` chrome, but the row
 * layout follows this build's identity model: the nickname is the prominent
 * line and the device id sits underneath it in small type, so it is clear that
 * a participant *is* a browser rather than an account.
 */
export function BoardUsersPanel({
  participants,
  search,
  onSearchChange,
  onClose,
  embedded = false,
}: {
  participants: Participant[];
  search: string;
  onSearchChange: (value: string) => void;
  onClose: () => void;
  /** When true, renders without absolute positioning for embedding in another panel. */
  embedded?: boolean;
}) {
  const visible = participants.filter((participant) =>
    `${participant.nickname} ${participant.deviceId}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );

  if (embedded) {
    return (
      <div className="liveUsersPanel" data-testid="participants-panel" style={{ height: "100%", minHeight: 300 }}>
        <div className="usersScrollArea" style={{ height: "calc(100% - 50px)", overflow: "auto" }}>
          <table id="usersTable">
            <colgroup>
              <col />
            </colgroup>
            <tbody>
              {visible.map((participant) => (
                <UserRow key={participant.key} participant={participant} />
              ))}
            </tbody>
          </table>
          {visible.length === 0 && <div className="noUsersFound">No users found</div>}
        </div>

        <div className="usersSearchRow">
          <div className="usersSearchBar">
            <input
              type="text"
              className="usersSearchBox"
              placeholder="Search user.."
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              data-testid="users-search"
            />
            <div
              className="usersSearchClear"
              onClick={() => onSearchChange("")}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  onSearchChange("");
                }
              }}
            >
              <span className="usersSearchClearIcon">✕</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="liveUsersPanel"
      data-testid="participants-panel"
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        width: 300,
        height: "100%",
        zIndex: 5,
      }}
    >
      <div className="usersPanelHeader">
        <span>Users</span>
        <button
          type="button"
          className="pencilMenuClose"
          aria-label="Close users panel"
          onClick={onClose}
          data-testid="participants-close"
        >
          ✕
        </button>
      </div>

      <div className="usersScrollArea">
        <table id="usersTable">
          <colgroup>
            <col />
          </colgroup>
          <tbody>
            {visible.map((participant) => (
              <UserRow key={participant.key} participant={participant} />
            ))}
          </tbody>
        </table>
        {visible.length === 0 && <div className="noUsersFound">No users found</div>}
      </div>

      <div className="usersSearchRow">
        <div className="usersSearchBar">
          <input
            type="text"
            className="usersSearchBox"
            placeholder="Search user.."
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            data-testid="users-search"
          />
          <div
            className="usersSearchClear"
            onClick={() => onSearchChange("")}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                onSearchChange("");
              }
            }}
          >
            <span className="usersSearchClearIcon">✕</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * One row of `#usersTable`.
 *
 * The nickname uses the source's `.userName` link styling at a larger size, and
 * `.userDeviceId` carries the device id beneath it in small type.
 */
function UserRow({ participant }: { participant: Participant }) {
  const user = useDeviceUser();
  return (
    <tr data-self={participant.self ? "true" : "false"} data-testid="participant-row">
      <td>
        <div className="avatar-container">
          <Avatar
            hue={participant.avatarHue}
            imageUrl={participant.self ? user.avatar ?? undefined : undefined}
          />
          <div className={`${participant.status} userStatus`} />
        </div>
      </td>
      <td>
        <div className="userIdentity">
          <span className="userName" data-testid="participant-name">
            {participant.nickname}
            {participant.self && " (You)"}
          </span>
          {participant.role === "host" && (
            <span className="roleBadge" data-testid="participant-role">
              Host
            </span>
          )}
          <span className="userDeviceId" data-testid="participant-device-id">
            {participant.deviceId}
          </span>
        </div>
      </td>
    </tr>
  );
}
