# Whiteboard Mod — clone deliverable

A working Next.js rebuild of `https://whiteboardfox.com`, rebranded and reworked into **Whiteboard Mod**: coral brand colour, no accounts, device-based identity, and boards that are an identical copy of the original board screen.

## Customisations on top of the clone

This build deliberately departs from the source in these ways:

1. **Rebranded to Whiteboard Mod with a coral palette.** Every "Whiteboard Fox" string, title and metadata is now "Whiteboard Mod". The source's brand blue (text, footer, feature strip, field borders, focus) is replaced by coral via Tailwind theme tokens.
2. **`Start Drawing` goes straight to Options.** The source's *"I'm drawing for fun / work"* interstitial is gone.
3. **No accounts at all.** Identity is the device, and the only profile field is the nickname. A device with no nickname is forced to the Lobby before it can open a board.
4. **Boards are an identical copy of the original board screen, with an upgraded Draw tool.** `/board/<id>` reproduces the source's `#menuStrip`, canvas and `.liveUsersPanel` at the measured geometry, and a new board mints its own id. The Draw pop-up swaps the source's 7-colour palette and 4 width buttons for an artist's colour wheel, a slider + editable number, a style selector (Marker / Rellenar / Relleno degradado / Caligrafía) and a full gradient settings section (Lineal / Radial, a live preview and one row per colour stop).
5. **Every generated board lives on `whiteboardmod.com`.** Share links read `https://whiteboardmod.com/board/<id>`, and the footer's privacy/terms links stay local (`/privacy`, `/terms`) instead of pointing back at the source site.
6. **Pro is free.** `/pro` activates it in one click, no plans, no gateway. The header no longer links to it.
7. **No Top Posts / Following tabs and no Sign In.**
8. **The board is also a room.** Whiteboard Mod is a mix of whiteboardfox (the drawing) and here.fm (the room): under the board's **Clear** button sits a room bar with **Invite**, **Chat**, a reaction picker and the **microphone**, and a here.fm-style bar runs along the bottom of the board with your avatar, an `@`, an emoji button and a "Say something..." field. See *The room* below.
9. **The board has a host.** The device that opens a board first owns it: it is the **host**, everybody else is a **user**. The host clears the board and paints its background colour; a guest can watch and draw, but not repaint or wipe the board. See *The board's options* below.
10. **The board carries media.** An **Import** button under **Erase** brings in a picture, a file, an audio file or a recorded voice note, and every imported piece behaves like here.fm's elements: it can be moved, turned, resized, pinned, locked, mirrored, duplicated and thrown away. See *Importing media* below.
11. **The homepage has no gallery.** The source's snapshot grid (12 cards per page, `of 160` paging) was removed, along with its thumbnails, its pagination types and the `GalleryPost` model. The hero, the Options overlay and the rest of the page are untouched.

### The board's options

The Options panel used to be a copy of the source's *Opciones* modal. It is now three tabs that all do something:

| Tab | What it holds |
| --- | --- |
| **Colours** | **BG color** — the colour of the board itself, painted behind the ink and the grid. The source's "Quick Colours" row is gone: the colour wheel is the only control, and it is bound to the whole board. **Only the host may change it**; a guest sees the wheel disabled and a note saying so, and the board ignores a colour typed into it. |
| **Participants** | The users list, moved here from the toolbar, with each row's role. |
| **Settings** | **Show grid**, **Snap to grid**, **Grid size** and **Auto-save interval** — all of them real. **Flip colors** replaces the source's *Dark mode*: it is the photographic negative of the board (white becomes black, coral becomes cyan, a picture becomes its negative) and it is **personal**, so one person can flip the board for themselves without changing what anybody else sees. |

The board's own settings (background colour, grid, snapping, grid size, auto-save interval) live in `localStorage` under `wf_board_settings_<boardId>` and are shared by every tab of that board; "Flip colors" lives under `wf_flip_colors`, because it is a view, not a setting of the board.

| Module | Responsibility |
| --- | --- |
| `use-board-settings.ts` | The board's settings, the per-device colour flip, and the `useSyncExternalStore` plumbing that keeps them in step. |
| `use-board-host.ts` | Who owns the board: the first device to open it claims the role, and the claim never changes hands. |
| `use-board-doc.ts` | The document, now including the imported items, so a transform on a picture is one undo step like any other edit. |
| `src/lib/board/document.ts` | Saving and restoring a board: the strokes and the media are written to `localStorage` under `wf_board_document_<boardId>`. |
| `src/lib/board/imported.ts` | The imported-item model and its geometry: centre, intrinsic size, uniform scale, rotation. |
| `src/lib/board/color.ts` | `invertColor`, the negative of a colour, which is what *Flip colors* applies to the whole board. |

### Importing media

Under **Erase** there is an **Import** button, and its menu carries here.fm's three ways in — **Image or file**, **Audio** and **Record voice note** (here.fm's fourth option, *Share Web App*, has no meaning on a whiteboard and is left out). A picture lands in the middle of what the user is looking at, selected, with its small options underneath.

An imported piece is not a stroke, so it carries its own geometry: its centre, its intrinsic size, a uniform `scale` and a `rotation`. That is what lets the panel show a size and an angle, and lets the undo history restore it by value.

The options under a selected item are the ones here.fm shows, drawn on the canvas in screen space so they keep their size at every zoom: **Download**, **Rotate**, the **three dots** and **Resize**. The three-dot menu carries here.fm's list — *Move to front*, *Move to back*, *Pin*, *Lock*, *Mirror*, *Duplicate* and a red *Delete* — minus *Make Deck*, which is a here.fm feature, and with the lock's submenu collapsed into one flag.

### Brand palette

Declared in `src/app/globals.css` as Tailwind theme colours:

| Token | Value | Replaces |
| --- | --- | --- |
| `--color-brand` | `#e0533f` | `#233f98` text / primary ink |
| `--color-brand-dark` | `#c8402d` | hover states that darkened the blue |
| `--color-brand-soft` | `#e8836f` | `#5271bb` footer, feature strip, muted text |
| `--color-brand-border` | `#d1553f` | `#3f3ea9` field / select borders |
| `--color-brand-tint` | `#fbeeeb` | `#efefef` pale button fills |

`--primary` in `:root` is also coral, so shadcn primitives match. The orange CTA (`#ff6a00`) is unchanged: it was already distinct from the brand blue.

### Device identity

| Stored key | Purpose |
| --- | --- |
| `wf_device_id` | Stable per-browser id, e.g. `WM-E049-91D1`. Minted on first use, read-only afterwards. Derived from `crypto.randomUUID()` (two 2-byte blocks, so it stays globally unique but readable), with `crypto.getRandomValues` and then `Math.random` as fallbacks. |
| `wf_nickname` | The nickname chosen by the visitor. The **only** editable profile field. |
| `wf_pro` | `"true"` once Pro has been activated. |
| `wf_joined_boards` | Boards this device opened, newest first; powers the Lobby's recent list. |
| `wf_board_hosts` | `{ boardId: deviceId }` — which device owns which board. The first claim wins. |
| `wf_board_settings_<boardId>` | The board's own settings: background colour, grid, snapping, grid size, auto-save interval. |
| `wf_board_document_<boardId>` | The board's saved document: the strokes and the imported media. |
| `wf_flip_colors` | Whether *this* device sees the board as its negative. Personal, not a property of the board. |

Identity flow:

1. `/` → `Start Drawing` calls `hasProfile()`. With no nickname the visitor is redirected to `/lobby?from=board`; otherwise the Options overlay opens immediately.
2. `/lobby` shows the device id and a nickname field. `Crear pizarrón` stays disabled until a nickname exists.
3. `/board/<id>` runs the same gate, so a deep link cannot bypass it. The board reads the nickname and id from storage, so identity is inherited automatically.
4. `/board/new` mints a fresh id and rewrites the URL with `replaceState` so the link is shareable.

The header chip shows `@nickname` plus a `PRO` badge when Pro is active.

### Whiteboard screen

`/board/<id>` (`BoardSection`) is a **faithful copy of the source board screen**, measured from the live reference `https://r9.whiteboardfox.com/96635256-2598-4487` rather than guessed. It reproduces, at identical geometry, the original's:

- `#menuStrip` — the 140px-wide, full-height grey (`#EEEEEE`) tool column with the source's seven 140×70 buttons in source order: Undo, Draw, Erase, Move, Select, Options, Clear, each a 32px icon above a 13px label, with the active tool marked by the source's `1px inset #666666` border. **Import** was added between Erase and Move (the eighth button), so the column now runs to `y=560` instead of `y=490`.
- `#canvasId` — the canvas filling the remaining viewport (`860×700` at a 1000×700 window), with pointer drawing at DPR-accurate buffer size.
- `.liveUsersPanel` — the original's users panel: `.usersScrollArea` wrapping `#usersTable` (60px rows), each row an `.avatar-container` with the generated SVG avatar (`#FFFFFF88` circle + `hsl(h,75%,43%)` silhouette) and a `.userStatus` dot — green `#00c004` online, grey `#a1a1a1` offline, purple `#835eff` for Pro — beside the account name in small type, plus the search row and both `.whoDrewBtn` actions.
- The transient `#snackbar`.

Toolbar glyphs are the source's own `images/*.png` (`Undo`, `Eraser`, `Move`, `Select`, `Cog`, `Trash`) downloaded byte-for-byte into `public/sites/whiteboardfox/board/`; the pencil is the one button with an inline SVG in the source, so its path is reproduced verbatim.

Each board shows its share link as `https://whiteboardmod.com/board/<id>`.

### Canvas engine

The canvas is an **infinite, stroke-based document**, not the source's flat point array. The distinction matters because it is what makes vectorial erasure and selection possible at all.

| Module | Responsibility |
| --- | --- |
| `src/lib/board/stroke.ts` | `Point`/`Stroke`/`Transform` model and pure geometry: `hitStroke`, `lassoHitsStroke`, `pointInPolygon`, `unionBounds`, `handleAnchor` (where a handle sits and what stays put while it moves), plus translate/scale/rotate-about-pivot maths. |
| `src/lib/board/camera.ts` | Infinite pan/zoom: `screenToWorld`, `worldToScreen`, `panBy`, `zoomAt` (cursor-anchored), `clampScale` (0.1×–8×), `formatZoom`. |
| `src/lib/board/grid.ts` | Adaptive infinite grid: `BASE_STEP` 40 world units, doubled until on-screen spacing reaches `MIN_SCREEN_STEP` 18px, with every 5th line drawn heavier. The board's own grid size is the base, and the grid can be turned off entirely. |
| `src/lib/board/render.ts` | One-frame painter: background, grid, strokes, lasso path, selection box with 8 scale handles + 1 rotate handle, the imported items and their small options, eraser ring. Pure — no React. |
| `src/lib/board/imported.ts` | The imported items: `ImportedItem` (centre, intrinsic size, uniform scale, rotation, flags) and the geometry that goes with them — corners, hit test, the audio card's play button. |
| `src/lib/board/document.ts` | The saved board: the strokes and the imported media, written to and read back from `localStorage` (4 MB cap). |
| `use-board-doc.ts` | The document: strokes in a ref, `commitStroke`, `eraseAt`, `selectWithLasso`, `moveSelection`/`scaleSelection`/`rotateSelection`, the imported items (`addItem`/`updateItem`/`removeItem`/`duplicateItem`/`reorderItem`), an undo history (`beginEdit`/`endEdit`/`undo`), `clearAll`. |

Behaviour:

- **Stroke-based erasure.** Pressing with the Erase tool deletes every stroke it touches *entirely*; there is no pixel painting, so a stroke can never be left half-erased.
- **Lasso selection and transform.** The Select tool traces a free-form lasso; strokes it touches are selected, then a dashed coral bounding box with 8 square scale handles (4 corners + 4 edge midpoints) and a round rotate handle appears above it.
- **A selected shape can be dragged around.** Pressing on the selection's own ink — or, for a filled shape, anywhere inside its fill — and dragging moves every selected stroke, in addition to the scale and rotate handles. A press on empty canvas still starts a fresh lasso, so a new selection can always be drawn.
- **Scaling pivots on the opposite edge, so it cannot flip by accident.** Dragging a handle measures the factor against the box **as it was when the gesture started** — not against the live bounds — and the pivot is the **opposite** edge or corner, so that side stays put and the handle tracks the pointer. The factor is `(pointer − pivot) / (handle − pivot)`, so it is 1 before the drag, grows as the handle is pulled away, and only turns negative (a deliberate flip) when the handle is dragged *past* the pivot. Every pointer move applies the **ratio** between the new factor and the last one, per axis, so the shape can never oscillate. The old centre-pivot maths turned a plain upward drag into a mirror image, which is what made the shape appear to flip and spin.
- **The selection box hugs the ink, and keeps hugging it while it is scaled.** The box is padded by half the brush width, because a thick stroke's ink runs that far past its centreline — but the padding follows the stroke's own scale, so the handle stays under the pointer instead of drifting away from it as the shape grows.
- **Undo takes back every change, including the Select tool's.** The document keeps a history of pre-edit snapshots (50 deep). A gesture — a move, a scale, a rotation, an erase — captures one snapshot when it starts and keeps it only if the document really changed, so one drag is one undo step and a click that moved nothing does not eat a step.
- **The Select tool never paints.** The lasso's purpose is recorded on the gesture itself (`fillType: "fill" | "gradient-fill" | null`) instead of being read from the live Draw-panel state, so switching to *Rellenar* or *Relleno degradado* and then picking the Select tool still selects rather than filling the lassoed area.
- **Draw options on double-click.** A single click picks the Draw tool; a double click (on the button or the canvas) opens the Draw options panel (`draw-panel.tsx`), which has a **Main** and a **Shapes** tab. The Main tab departs from the source, which offers only 7 fixed colours, 4 fixed widths and a smoothing slider:
  - **Artist's colour wheel instead of the 7-colour palette.** A 200px hue ring, a saturation/value square in its centre, a hex field, Brightness and Saturation sliders, and a row of the last 8 colours, in `color-wheel.tsx`. The model is **HSV, not HSL**: "this blue, but darker" is a single multiply on value, whereas HSL lightness would desaturate towards white and black at once, so a pure hue could never be reached at full brightness. Stroke colours carry their alpha inline (`#rrggbbaa`), so the wheel edits the `#rrggbb` prefix and the opacity slider owns the alpha. Picking a hue while saturation is 0 (a fresh wheel starts on the grey `#4a4a4a`) lifts saturation to 1, because otherwise picking a hue on a grey does nothing visible.
  - **Width slider with an editable number instead of 4 buttons.** A `range` 1–64 plus a `number` field and a live thickness preview line, next to the source's five width groups (Finest / Correcto / Medio / Grande / Enorme ×4, 1–20). The number field keeps a draft string tagged with the width it came from, so it stays typeable (a value bound straight to `style.width` would snap back the instant the box is cleared) without a syncing effect.
  - **Style selector: Marker / Rellenar / Relleno degradado / Caligrafía.** The source splits these across separate toolbar buttons; here they are variants of the one Draw tool, so every colour/width control lives in a single place.
  - **Gradient settings: Lineal / Radial, a preview, and a row per colour stop.** In *Relleno degradado* the panel grows an **"Ajustes del degradado"** section: a **Lineal / Radial** radio pair (lineal is the default), a full-width live **preview** of the ramp, and one row per colour stop holding a square **swatch**, a **position slider** and a round **+** button. Clicking a swatch opens the colour wheel for that stop; the + button inserts a new stop after that one, its colour being the anchor's hue rotated by 60°. The ramp's first stop *is* the main colour, so the wheel at the top of the panel and the ramp never drift apart. The renderer honours each stop's own position: **lineal** ramps along the lasso's own axis (where it started → where it ended) and **radial** ramps from the shape's centroid outwards. Both a third colour and a radial projection are **whiteboardMOD extensions**: the source only ever ramps between a pair, along a straight axis.
  - **Smoothing is gone** (the source's 0–15 slider). Opacity (1–100%) is unchanged.
  - **Fill and gradient fill use the source's lasso gesture.** Nothing is explained in the UI and no message is shown: you draw a closed shape and it fills when you release, exactly like the original.
- **Camera in a ref, repaints on rAF.** Panning and zooming never route through React state, so dragging the view cannot fan out into dozens of renders per second. Structural changes (a stroke finishing, a selection committing) bump a version counter, and that repaints synchronously.
- **The canvas mounts behind a gate, and the paint effects follow it.** `/board/<id>` renders a "Loading whiteboard…" placeholder until the device profile resolves. The ResizeObserver therefore watches a callback-ref mirror of the canvas element rather than the ref itself — a plain `useRef` would leave the effect running against a `null` canvas on its first pass, and the buffer would never be sized.

Presence is honest: because there is no collaboration backend, the panel lists exactly one participant — the visitor themself. The row shows the nickname in large type (`1.15em`) with the device id directly beneath it in small monospace (`0.68em`), which makes it explicit that a participant *is* a browser rather than an account. Remote participants slot into the same `participants` array when a transport is added; nothing in the panel has to change.

### The room (here.fm's half)

Whiteboard Mod is a mix of whiteboardfox and [here.fm](https://here.fm): the canvas is whiteboardfox's, the room around it is here.fm's. The reference room was inspected at `https://again.here.fm/1875608d-1773-4407-af88-db7dd3f7c33f` — the room itself is gone, but its DOM and stylesheet still describe the layout that was copied.

**Directly under the Clear button** sits the room bar, a coral block at the bottom of the 140px tool column:

| Control | What it does |
| --- | --- |
| **Invite** | Opens a popover with the board's own address (`https://whiteboardmod.com/board/<id>`) and a **Copy link** button. |
| **Chat** | Shows or hides the conversation; it carries a badge with the number of messages that arrived while it was closed. |
| **Reaction** | Opens the emoji palette; picking one floats that emoji up over the board. |
| **Mic** | Turns the local microphone on and off, with a live input-level meter underneath. |

**Along the bottom of the board** runs the chat bar, the same shape as here.fm's: the visitor's avatar, their nickname, the microphone's state, an `@` that drops a mention into the field, an emoji button that opens the same palette, the **"Say something..."** input and a **Send** button. The bar is part of the board's layout rather than an overlay, so it never covers a drawing — the canvas is 52px shorter than the viewport.

**The conversation** floats over the canvas on the right, like here.fm's `#room-messages` column: white bubbles with a 10px radius and a soft shadow, the author in coral above the message.

**Reactions** float up from the bottom of the board and fade out after 4.5 seconds.

Layout facts taken from the reference room's own stylesheet, then restyled in coral: here.fm's bubbles are `background: #fff`, `border-radius: 10px`, `box-shadow: 0 0 13px rgba(0,0,0,.5)`; its message column is `width: fit-content`; its invite title is bold 14px. here.fm's own primary (`#6b1be3`) is **not** used — the accent stays Whiteboard Mod's coral.

#### How the room is stored

| Module | Responsibility |
| --- | --- |
| `src/lib/board/room.ts` | The room model: `RoomMessage`, `RoomReaction`, the storage key, parsing, merging and committing. |
| `use-room.ts` | The hook: reads the room through `useSyncExternalStore`, mirrors it to the other tabs, and sends messages and reactions. |
| `use-room-mic.ts` | The microphone: `getUserMedia` → `AnalyserNode` → an RMS level from 0 to 1. |
| `room-bar.tsx` | The room bar under Clear, with the invite popover. |
| `room-chat.tsx` | The chat bar, the message bubbles and the reaction layer. |
| `room-emoji-picker.tsx` | The palette both places share. |

The room lives in `localStorage` under `wf_room_<boardId>` and is mirrored to the other tabs of the same browser through the `storage` event, which is as far as a server-less build can reach. The model is an append-only list of messages (the last 200 are kept) plus a list of reactions that expire after 45 seconds. Writes merge with the stored room first, so two tabs talking at once cannot drop each other's messages.

Two details worth naming:

- **The room is read through `useSyncExternalStore`, not `useState`.** The browser's storage is the source of truth and the store in front of it is only a cache; the repo's ESLint (`react-hooks/set-state-in-effect`) also rejects a `setState` inside an effect body, which is what a `useState` version would have needed.
- **The unread badge is derived, not stored.** It counts the messages newer than the moment the conversation was last opened, so it cannot drift out of step with the list it describes.

### What Pro unlocks

Pro is a local flag (no server), and turning it on changes two things:

- The options panel no longer sends `force-auth-participants=true`, so invited participants need no account.
- The copy-limited note only appears for the unrestricted invite target.

`my followers` is always disabled: this build has no followers concept.

## Run it

```bash
npm install
npm run dev      # http://localhost:3000
```

Other scripts: `npm run build`, `npm run start`, `npm run lint`, `npm run typecheck`, `npm run check` (lint + typecheck + build).

## Routes

| Local route | Source | Status |
| --- | --- | --- |
| `/` | `/` | Fully rebuilt |
| `/lobby` | `/lobby.jsp` | Rebuilt: mandatory nickname capture + recent boards |
| `/board/[id]` | `/<diagramName>` | Rebuilt as an identical copy of the source board screen |
| `/pro` | `/pricing.jsp` | Replaces Pricing: free one-click Pro activation |
| `/account` | `/login.jsp` | Replaces Sign In: device profile, nickname only |
| `/options` | `/options.jsp` | Real chrome + notice |
| `/privacy` | `/privacy.html` | Rebuilt locally, so the footer no longer leaves the site |
| `/terms` | `/terms.html` | Rebuilt locally, so the footer no longer leaves the site |

`/pricing` and `/login` were deleted rather than kept as dead routes, since neither concept exists in this build. `/board/new` mints an id client-side, so the route stays prerenderable.

The footer's `Privacy Policy` and `Terms of Service` links stay on `whiteboardmod.com` (`/privacy`, `/terms`) rather than pointing back at the original site. `WHITEBOARDMOD_ORIGIN` is `https://whiteboardmod.com`, which is also the origin shown in every board's share link.

## What was rebuilt

The homepage in full, including every interaction that is actually reachable without the source's backend:

- **Global chrome** — `#eeeeee` header with the `Hammersmith One` wordmark (no logo illustration) plus Lobby and the device chip; coral footer. Both fonts are self-hosted through `next/font`.
- **Hero** — fixed 1010px column, two-column grid, `Simple Online Whiteboard` heading, real-time subtitle, orange `Start Drawing` button with the `go.png` glyph, and the Whiteboard-ID jump field (now navigating to the local board).
- **Options overlay** — opened by `Start Drawing`. Reproduces the three "Other participants can…" radios, the Invite checkbox and target select (including the copy-limited note), the `More Options` / `Create Whiteboard` actions, and the creating-spinner state. The fun/work question was removed.
- **Gallery** — removed. The source's snapshot grid (12 real snapshots per page, editor's-choice badges, the overflow menu, the like toggle and the `of 160` pagination) had no counterpart in this build, so the component, its data, its types and the 36 thumbnails were deleted rather than kept as a dead grid.
- **Lobby** — device id, nickname capture, and a recent-boards list.
- **Board** — an identical copy of the source board screen (menu strip, canvas, users panel, snackbar) with a `whiteboardmod.com` share link, a Draw options panel that replaces the source's 7 colours with an artist's colour wheel, its 4 widths with a slider + editable number, and fill, gradient fill and a full gradient settings section (Lineal / Radial, a live preview, and a swatch + position slider + `+` row per colour stop) — plus the room layer: a room bar under Clear (invite, chat, reaction, mic) and a here.fm-style chat bar along the bottom; an Options panel reworked into Colours (the host's board colour) / Participants / Settings (grid, snapping, grid size, auto-save, and a personal colour flip); an Import button under Erase that brings in pictures, files, audio and voice notes, each editable like here.fm's elements; and a host role, so only the board's owner can clear it or repaint it.
- **Profile overlay and `/account`** — device id (read-only) plus an editable nickname.
- **Features strip** and **Questions or Comments?** contact section, with the original icons and `speech-bubbles.png` background.

Assets (`go.png`, `close-button.png`, the three 152×152 feature icons, `speech-bubbles.png`) are downloaded into `public/sites/whiteboardfox/`. The gallery's 36 thumbnails went with the gallery itself. The source's `icon.png` logo mark was dropped along with the header's pro link, so it is no longer shipped.

## Fidelity

Measured against the live page at a 1000px viewport: `h1`, subtitle, CTA and ID row match the source's dimensions and positions exactly; the tab strip, gallery container, card box, card thumbnail and pagination matched too, and were then removed with the gallery. Details and the full measurement table are in `docs/research/whiteboardfox/page-brief.md`.

The board screen was measured the same way, against the live reference `https://r9.whiteboardfox.com/96635256-2598-4487` at a 1000×700 viewport: `#menuStrip` `0,0 140×700` on `#EEEEEE`, `#canvasId` `140,0 860×700`, seven 140×70 buttons with 13px labels, and the seven palette fills copied value-for-value (the palette itself was later replaced by the colour wheel). The clone's canvas is now 860×648, because the room's chat bar takes the bottom 52px rather than floating over the drawing, and the column now holds eight buttons (Import was added under Erase). See `docs/research/whiteboardfox/board.source.html` and `board.css`.

One deliberate reproduction: the source is **not responsive** — its content column stays 1010px at every width, so a phone scrolls horizontally. The clone keeps that behaviour rather than inventing a mobile layout. See `docs/design-references/local-home-mobile-390.png`.

The room half was measured the same way, against here.fm's own DOM and stylesheet: the bottom bar's shape (avatar · `@` · emoji · "Say something..."), the floating message column on the right, the white 10px-radius bubbles and the invite popover. The colours were re-pointed at coral — here.fm's purple `#6b1be3` is reference only.

## Not reproduced (and why)

- Ad slots (Fuse/publift), Tawk.to chat, Facebook SDK, Firebase auth/UI, Google Analytics — third-party scripts. The hero's right column keeps the source's `#FCFCFC` panel but stays empty, which is exactly how the source renders with an ad blocker; this is the main source of the remaining pixel diff.
- The invitation banner, which needs `GET /api/getInvitation`.
- **The homepage's gallery is gone.** The source's snapshot grid, its live origin-locked paging API (`totalCount: 1909` → 160 pages), its like toggle, its *Report NSFW* menu and its 36 thumbnails were deleted: the page is now the hero, the Options overlay and the feature strip only.
- **Authentication is replaced, not reproduced.** The source's `login.jsp` / Firebase sign-in flow is gone; identity is a `localStorage` device profile, and the Lobby is the only entry point.
- **The board is local, not realtime.** There is no collaboration server, so the participants panel lists only the visitor (the host). The strokes and the imported media live in the `use-board-doc` document and are written to `localStorage` on the auto-save interval, so a board survives a reload *in the same browser* — but they are never relayed to a server. The source's `diagramName` handoff is no longer used. The screen, the drawing model and the tools are faithful — only the transport is missing.
- **The room is browser-local.** here.fm talks over a websocket; this build has no server, so a board's conversation and reactions live in `localStorage` and reach the other tabs of the *same* browser through the `storage` event. Two people on two machines do not share a room yet, and the microphone is a local level meter rather than a voice stream. The model (append-only messages, expiring reactions, per-board keys) is already the shape a transport would need.
- **`Who drew what?` is not implemented.** It needs the server-side per-stroke author records that do not exist without a backend; the button reproduces the original's appearance and state.
- **The fun/work branch is gone.** `wf_user_type` and `use-user-type.ts` were deleted, so the Options overlay has a single path.
- **Pro has no server side.** The flag lives in `localStorage`, so "activation" is per-device and does not sync anywhere.

## Files

```
src/app/                                  routes (/, /lobby, /board/[id], /pro, /account,
                                          /options, /privacy, /terms)
src/app/whiteboardfox.css                 body typography (coral), wf-spin / wf-progress keyframes
src/app/whiteboard-mod-board.css          board chrome copied from the source Whiteboard.css,
                                          plus the room layer (.room* rules)
src/app/globals.css                       coral brand tokens + --primary
src/lib/board/stroke.ts                   stroke model + pure geometry (hit test, lasso, transforms)
src/lib/board/camera.ts                   infinite pan/zoom (zoomAt, panBy, screenToWorld)
src/lib/board/grid.ts                     adaptive infinite grid step
src/lib/board/color.ts                    HSV/RGB/hex maths (withAlpha, rotateHue, luminance, invertColor)
src/lib/board/render.ts                   single-frame painter (background, grid, strokes, lasso,
                                          handles, fills, imported items and their options)
src/lib/board/imported.ts                 imported-item model + geometry (corners, hit test, play button)
src/lib/board/document.ts                 saving and restoring a board (strokes + media)
src/lib/board/room.ts                     the room model: messages, reactions, localStorage
src/components/sites/whiteboardfox/       hero, options panel, dropdown, features,
                                          contact, header, footer, shell, data
  use-device-user.ts                      device id (UUID-derived) + nickname store, hasProfile()
  use-board.ts                            board participants (self only) + joined-boards store
  use-board-doc.ts                        stroke document: erasure, lasso, transforms, items, undo
  use-board-host.ts                       the board's host: the first device to open it owns it
  use-board-settings.ts                   the board's settings + this device's colour flip
  use-lobby-gate.ts                       redirects unidentified devices to the Lobby
  lobby-section.tsx                       nickname capture + recent boards
  board-section.tsx                       the board screen: camera, tools, gestures, panels
  draw-panel.tsx                          Draw options panel (colour wheel, styles, gradient settings)
  color-wheel.tsx                         artist's HSV colour wheel (ring, square, sliders, hex)
  options-menu.tsx                        options panel: colours / participants / settings
  import-menu.tsx                         the Import button, its menu and the voice recorder
  item-menu.tsx                           the three-dot menu of an imported item
  use-voice-recorder.ts                   MediaRecorder wrapper for the voice notes
  board-users-panel.tsx                   #usersTable rows (nickname large, device id small, role)
  board-icons.tsx                         pencil SVG, toolbar PNGs, Avatar
  use-pro.ts                              free Pro flag store (localStorage)
  room-bar.tsx                            room bar under Clear (invite, chat, reaction, mic)
  room-chat.tsx                           chat bar, message bubbles, floating reactions
  room-emoji-picker.tsx                   the emoji palette the room bar and chat bar share
  use-room.ts                             the room hook (useSyncExternalStore + storage event)
  use-room-mic.ts                         microphone state and input level
  profile-panel.tsx, account-section.tsx  profile UI (nickname is the only editable field)
  user-chip.tsx, pro-section.tsx          header chip + /pro activation UI
public/sites/whiteboardfox/               9 site images
public/sites/whiteboardfox/board/         the source's 6 toolbar PNGs
docs/research/whiteboardfox/              page-brief.md, source.html, style.css, output.css,
                                          board.source.html, board.css, posts.json,
                                          gallery-posts.json
docs/design-references/                   source + local screenshots, comparison.png,
                                          board-draw-tools.png (marker + gradient fill)
scripts/board-canvas-check.mjs            headless-Chrome canvas regression (68 checks)
```

## Checks run

- `npm run check` — ESLint clean (0 errors, 0 warnings), `tsc --noEmit` clean, `next build` prerenders 8 static routes (`/`, `/pro`, `/account`, `/lobby`, `/options`, `/privacy`, `/terms`, `/_not-found`) plus the dynamic `/board/[id]`.
- A headless-Chrome-over-CDP regression exercises the canvas end to end — buffer sizing, marker colour/width commits, the live preview, `Rellenar`, and the gradient settings (type radios, preview, stop rows, add/remove, position slider) with two-, three-stop, radial and repositioned ramps — asserting the resulting pixels, plus the Select tool dragging a selected shape and never painting, scaling a shape from its opposite edge without flipping it, and Undo taking both the scale and the move back. 68/68 green, including the room checks (the bar sits under Clear, every room control is on the board, the invite popover offers the board's own address, a message shows up and is stored under one key per board, a reaction floats, the room survives a reload, and the unread badge appears for a message that arrives while the chat is closed and clears when it is opened again), the host checks (the device that opened the board owns it, the participants list says so, another device cannot clear the board and cannot repaint it), the board-settings checks (the host's colour reaches the canvas, *Flip colors* turns the board into its negative and back, the grid can be turned off, and a fill snaps to the grid), and the import checks (the Import button sits under Erase, its menu offers here.fm's three ways in, an imported picture lands in the middle of the board with its small options under it, the three-dot menu carries here.fm's list, the resize and rotate handles work, Undo takes both back, and *Delete* throws the item away). Run it with `npm run dev` in one shell and `node scripts/board-canvas-check.mjs` in another.
- Layout compared numerically against the live page via the browser's computed styles.
- Pixel diff of the source and clone at 1000×700 — residual differences are the empty ad column, the ad-driven vertical offset, font rasterisation, and thumbnail content.
- Every interaction above was exercised in a real browser and its resulting DOM state asserted.
- Board screen measured against `https://r9.whiteboardfox.com/96635256-2598-4487` and asserted locally: `#menuStrip` 140×700 `rgb(238,238,238)` in column flow, `#canvasId` 860×648 at x=140 (648 = 700 − the 52px chat bar), eight 140×70 buttons at y=0…490 with 13px labels and the active-tool inset border (the source's seven, plus **Import** under Erase), the source's palette cells at 70×70 with all seven fills equal to the live DOM (the clone replaces that palette with the colour wheel), and a `.liveUsersPanel` whose rows are 60px with dots `rgb(0,192,4)`/`rgb(131,94,255)`.
- Creating a board from the Lobby rewrites `/board/new` to `/board/<minted id>`, and the share link reads `https://whiteboardmod.com/board/<id>`. A pointer drag paints, Undo clears it — and also takes back a Select-tool move, scale or rotation — and no page in the app links to `whiteboardfox.com`.

### Canvas engine assertions (numerical, in-browser)

Each of these was measured from the canvas pixel buffer rather than eyeballed:

| Behaviour | Evidence |
| --- | --- |
| Grid renders | Vertical lines spaced exactly 40px at 100% zoom, shades `#e8e8e8` (minor) / `#d5d5d5` (major). |
| Wheel zoom | `100%` → `75%` after three wheel steps (1/1.1³), cursor-anchored. |
| Adaptive grid step | At 24% zoom the world step doubles 40 → 160, so on-screen spacing stays ~38px instead of collapsing to 9.6px; line count holds at 22. |
| Move-tool pan | Dragging `+120,+60` screen px moves the camera to `-120,-60` world units, i.e. the view follows the drag. |
| Stroke-based erasure | A stroke occupying 736 ink pixels (bounds `[118,248]–[301,251]`) dropped to **0 ink pixels** after a single press anywhere on it — the whole stroke went, not a patch. |
| Lasso selection | A lasso enclosing two strokes produced a coral selection box (1060 coral pixels, bounds `[143,116]–[446,256]`). |
| Scale handles | Exactly 8 square handles (corners `(130,118) (459,118) (459,281) (130,281)` + edge midpoints `(295,118) (459,200) (295,281) (130,200)`). |
| Rotate handle | One round handle 26px above the top edge, at `(295,92)`. |
| Scaling | Dragging the SE handle outward by `(+40,+40)` grew a 160×100 green rectangle from `[120,700]–[279,799]` to `[120,700]–[319,839]` — the **opposite (NW) corner stayed exactly where it was** (`[120,700]`), the width grew 160 → 200 and the height 100 → 140. |
| Rotating | A 90° swing of the rotate handle swapped the ink's width and height (160×100 → 100×160, `[150,670]–[249,829]`) with the pixel count preserved (15776 → 15776). |
| Undo takes a scale back | After the drag above, Undo put the rectangle back at `[120,700]–[279,799]` — the selection's own transform, not just the last stroke, is undone. |
| Undo takes a move back | Dragging the selected rectangle 60px right moved its ink to `[180,700]–[279,799]`; Undo put it back at `[120,700]–[279,799]`. |
| Draw double-click | `dblclick` on Draw opens the Draw options panel: colour wheel (hue ring + saturation/value square + hex), gradient settings (Lineal/Radial radios, preview bar, one swatch + position slider + `+` row per stop), style selector, width slider + editable number, opacity. |
| Live preview uses the current style | Mid-gesture, before the pointer is released, the canvas already carries the chosen colour (`rgb(255,0,0)` for `#ff0000`) — the paint loop reads the style through refs, so the in-progress stroke cannot fall back to the mount-time style. |
| Marker commit | The committed stroke keeps the chosen colour and width; the measured vertical run of ink was 20px for a width-20 stroke. |
| Fill (`Rellenar`) | A lasso drawn and released fills its interior: the centre of a closed rectangle reads `rgb(0,255,0)` for a green fill. |
| Gradient fill, two stops | A rectangle lassoed from the top-left to the bottom-left ramps along that axis: the top reads `rgb(228,0,26)` and the bottom `rgb(24,0,230)`. |
| Gradient fill, three stops | With a third colour added, the same axis reads red → blue → green at 10%, 50% and 90% of the ramp; the new stop lands at 50% of the ramp and pushes the old last stop to the end. |
| Gradient fill, radial | A radial ramp is centred on the shape's centroid: the middle of a 160×120 rectangle reads `rgb(253,0,1)` (the first colour) and its corner `rgb(23,0,232)` (the last). |
| Gradient fill, stop position | Dragging the second stop to 25% of the ramp turns the axis fully blue after a quarter of its length, so a point 60% down reads `rgb(0,0,255)` while a point 10% down is still a red/blue blend `rgb(148,0,106)`. |
| Select tool moves a shape | With the Select tool, a lasso around the green rectangle drew the coral selection box (910 coral pixels); dragging the shape 150px right emptied its old spot (the board's background, `rgb(255,255,255)`) and filled the new one (`rgb(0,255,0)`). |
| The board's own colour | The host typed `#ffeedd` into the Options panel's BG color field; the canvas background reads `rgb(255,238,221)` and the board's settings are stored under `wf_board_settings_<boardId>`. A second device sees the wheel disabled and the note "Only the board host can change the background colour." — and its attempt to type a colour leaves the canvas untouched. |
| Flip colors | With the flip on, the same background reads `rgb(0,17,34)` — the exact negative — and switching it off puts `rgb(255,238,221)` back. |
| The grid | A grid line at x=80 reads `rgb(232,232,232)`; with *Show grid* off the same pixel is the background colour again. |
| Snap to grid | A fill lassoed over world (907,641)–(1017,741) landed on `[880,640]–[1039,719]`, i.e. on the 80-unit lattice instead of where it was dragged. |
| An imported picture | A 120×120 magenta PNG dropped through the Import menu landed at `[620,389]–[739,508]` — the middle of the board — with its coral options row drawn 26px under it. |
| The item's small options | The resize handle grew the picture to `[560,329]–[799,568]` (240×240, exactly double) and the rotate handle turned it to `[511,280]–[848,617]` (337×337, a 45° swing). Two Undo presses put it back at `[620,389]–[739,508]`. |
| The three-dot menu | It opens on the item's dots handle and carries *Move to front*, *Move to back*, *Pin*, *Lock*, *Mirror*, *Duplicate* and *Delete*; *Delete* leaves no magenta pixel on the canvas. |
| Select tool never paints | With *Relleno degradado* still active in the Draw panel and the Select tool picked, a lasso over an empty area left the region's pixel checksum untouched (`sum=2509251976`, `painted=948` before and after) — no shape was created. |
| Lobby gate | With `wf_nickname` cleared, `/board/GATE-TEST-0001` renders the gate instead of the canvas and then redirects to `/lobby?from=board`, minting a fresh `WM-xxxx-xxxx` id. |
| Participants row | Exactly 1 row: `Zorro (You)` at `23px` with `WM-A3F9-2C71` at `13.6px` directly beneath. |
| Room bar under Clear | The room block starts at `y=560`, exactly where the Clear button ends (`y=490…560`), and is 140px wide — the tool column's own width. |
| Room controls | Four coral round buttons (30×30, `rgb(224,83,63)`, `border-radius: 50%`) in one row at `x=4/38/72/106`, with a 132×6 level meter under them. |
| Invite popover | Opens below the button and reads `https://whiteboardmod.com/board/PREVIEW-TEST-01` — the board's own address, not a placeholder. |
| Chat bar | 860×52 at `x=140`, pinned to the bottom of the board; the canvas is 52px shorter than the viewport, so the bar never covers a drawing. |
| A message | Sending `hola room` renders one bubble with that text and stores the room under exactly one key (`wf_room_<boardId>`); it is still there after a reload. |
| A reaction | Picking an emoji puts one floating element over the canvas. |
| Unread badge | A message that arrives while the chat is closed badges the Chat button (`1`); opening the chat clears it. |

> Note for anyone re-running these: the browser harness keeps tabs `hidden`, and a hidden tab never fires `requestAnimationFrame`. The canvas repaints from rAF for continuous gestures (pan, in-progress lasso, live transforms), so those are only observable in a visible tab. Everything that repaints through a React state change — stroke commits, tool switches, zoom label, selection commits — is measurable regardless, which is how the table above was produced.
>
> The canvas assertions above were re-run against a headless Chrome driven over CDP, with `requestAnimationFrame` polyfilled to `setTimeout` via `Page.addScriptToEvaluateOnNewDocument` (headless Chrome does not drive rAF either). Pointer input goes through `Input.dispatchMouseEvent`, so the board sees trusted events and `setPointerCapture` works. The full regression is 68/68 green.

