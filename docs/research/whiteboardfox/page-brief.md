# Whiteboard Mod — homepage clone brief

Target: `https://whiteboardfox.com` → canonical page `https://r8.whiteboardfox.com/` (server-side redirect; the site ships a Spanish string table when `Accept-Language` is `es`). This clone reproduces the **English** variant, rebranded as **Whiteboard Mod**.

> Measurements below record the **source** values for fidelity. Where this build deliberately differs (brand colour, removed fun/work step, local board, device identity) the entry says so inline.

## Route map

| Source | Local | Files |
| --- | --- | --- |
| `/` (home) | `/` | `src/app/page.tsx`, `src/components/sites/whiteboardfox/*` |
| `/lobby.jsp` | `/lobby` | `src/app/lobby/page.tsx`, `lobby-section.tsx` (rebuild: identity capture) |
| `/<diagramName>` | `/board/[id]` | `src/app/board/[id]/page.tsx`, `board-section.tsx` (identical copy of the source board screen) |
| `/pricing.jsp` | `/pro` | `src/app/pro/page.tsx`, `pro-section.tsx` (replaces Pricing; free activation) |
| `/login.jsp` | `/account` | `src/app/account/page.tsx`, `account-section.tsx` (replaces Sign In; device profile) |
| `/options.jsp` | `/options` | `src/app/options/page.tsx` |
| `/privacy.html` | `/privacy` | `src/app/privacy/page.tsx` (rebuilt locally) |
| `/terms.html` | `/terms` | `src/app/terms/page.tsx` (rebuilt locally) |
| `/post/<id>` | `/board/post-<id>` | the board id a gallery card used to link to |

Source routes with no local counterpart, deleted rather than left as dead links: `/pricing` and `/login`.
## Brand palette (replaces the source blue)

| Token | Value | Replaces |
| --- | --- | --- |
| `--color-brand` | `#e0533f` | `#233f98` body text / primary ink |
| `--color-brand-dark` | `#c8402d` | hover states |
| `--color-brand-soft` | `#e8836f` | `#5271bb` footer, feature strip, muted text |
| `--color-brand-border` | `#d1553f` | `#3f3ea9` field borders |
| `--color-brand-tint` | `#fbeeeb` | `#efefef` pale button fills |

`--primary` in `:root` is coral too. The orange CTA stays `#ff6a00`.

## Global chrome

- `<body>`: `font-family: Roboto, sans-serif; font-size: 20px; font-weight: 300; color: var(--color-brand); background: #fff` (source colour `#233f98`).
- Fonts: `Hammersmith One` (logo only) + `Roboto` weights 100/300 from Google Fonts.
- Content column: fixed `width: 1010px; margin: 0 auto` at every breakpoint — the page does **not** collapse on mobile (`scrollWidth` stays 1010 at a 390px viewport). This is reproduced deliberately.
- Header strip: `background: #eeeeee`, inner row `20px 50px 10px`, space-between, 91px tall.
  - Logo: the source pairs `images/icon.png` 64×64 with the text `Whiteboard Mod`, 32px Hammersmith One, `word-spacing: -8px`. **The clone keeps only the wordmark** — the illustration next to it was removed.
  - Right (clone): `Lobby`, then the device chip (replaces the source's `Pricing` link, 20px spacer and `Sign In`). `.mainLink` = no underline, coral, underline on hover. **The `Activa tu pro` → `/pro` nav link was removed**, so the header no longer advertises Pro; `/pro` itself still works when reached directly.
- Footer strip: coral, inner `10px 50px`, 12px/300 text: `© 2026 Whiteboard Mod · Privacy Policy · Terms of Service`.

## Local customisations (not in the source)

- **Rebrand.** All "Whiteboard Fox" strings, titles and metadata are "Whiteboard Mod"; the brand blue is coral.
- **`Start Drawing` skips the fun/work question.** It opens the Options overlay directly, or redirects to `/lobby?from=board` when the device has no nickname. `use-user-type.ts`, `wf_user_type` and the two glyph icons were deleted.
- **`Activa tu pro` replaced `Pricing`, and was then dropped from the header.** `/pro` activates Pro in one click. No plan table, price, form or payment link (`form` count on `/pro` is 0; no external links). Flips `wf_pro`. The nav link that pointed at it has been removed, so Pro is no longer advertised in the chrome.
- **The logo illustration is gone.** The header shows the `Whiteboard Mod` wordmark on its own; the source's `images/icon.png` mark next to it was removed.
- **Sign In is gone.** No login or registration UI exists anywhere.
- **Device identity replaces auth.** `wf_device_id` (e.g. `WM-E049-91D1`) is minted on first use and persisted; `wf_nickname` is the only editable profile field. `hasProfile()` gates every board route.
- **Boards copy the original screen.** `/board/<id>` is a faithful rebuild of the source's board (see *Board screen* below). `/board/new` mints an id and rewrites the URL. Gallery cards link to `/board/post-<id>`. Share links use `https://whiteboardmod.com`.
- **Gallery tabs removed.** The page always renders the post grid; there is no `#top-posts-tab`, no `#followers-posts-tab` and no "Sign in to check out posts" notice.
- **Pro changes the options panel.** Non-Pro still sends `force-auth-participants=true`; Pro sends `false`. `my followers` is disabled everywhere (no followers concept).
- **The board is also a room.** Whiteboard Mod mixes whiteboardfox (the drawing) with here.fm (the room): a room bar under the board's **Clear** button (invite, chat, reaction, mic) and a here.fm-style chat bar along the bottom of the board. See *Room layer* below.
- **The board has a host.** The device that opens a board first owns it and is shown as the **Host** in the participants list; everybody else is a **user**. The host clears the board and paints its background colour. The claim is stored in `localStorage` under `wf_board_hosts` as `{boardId: deviceId}` and the first claim wins, so the host cannot be displaced. See *The board's options* below.
- **The board carries media.** An **Import** button under **Erase** brings in a picture, a file, an audio file or a recorded voice note, and every imported piece is editable the way here.fm's elements are. See *Importing media* below.
- **The board's options really work.** The Options panel is now Colours / Participants / Settings: *Colours* holds **BG color**, the board's own colour (the source's "Quick Colours" row is gone); *Settings* holds **Show grid**, **Snap to grid**, **Grid size**, **Auto-save interval** and **Flip colors**, which replaces the source's *Dark mode*. See *The board's options* below.
- **The homepage has no gallery.** The source's snapshot grid, its pagination, its like toggle and its 36 thumbnails were deleted, together with `gallery.tsx`, `gallery-data.ts` and the `GalleryPost` type. The page is now the hero, the Options overlay and the feature strip.

## Hero (measured at 800px viewport, source)

- Grid: `padding: 0 0 10px 50px`, `grid-template-columns: 1fr 1fr`, `gap: 20px` → resolves to `470px 470px`, 532px tall.
- `#left-container` = column 1; column 2 is the ad slot (`background: #FCFCFC`, centered) — **ads are intentionally omitted** (third-party ad iframes, nothing to reproduce).
- `h1` "Simple Online<br>Whiteboard": `padding: 60px 0 10px`, `font-size: 58px` (declared) → computed 52px because `#left-container` is a 470px grid item with `padding-left: 100px`; real box 470×226 with `line-height: 78px`.
- Subtitle: `line-height: 160%` → 32px, "Share a virtual whiteboard in real-time<br>using any modern web browser".
- CTA `#startDrawingButton`: `background: #ff6a00`, white, `border-radius: 5px`, `padding: 15px 80px`, 28px/300, 422×64, followed by `images/go.png` 30×30 vertically centered. `margin: 40px 0`.
- ID row: 16px text, "Or enter a Whiteboard ID:" + `input` (border 1px `#233f98`, `padding: 2px 4px`, radius 5px, 14px, width 163px, placeholder `eg. 34567-8901-2345`) + `Go` button (`#efefef`, 1px `#233f98`, radius 5px, `padding: 5px`).

### Options overlay (`#optionsEl`)

Absolutely positioned panel shown by **Start Drawing** / **More Options** state, hidden by default.

- `width: 480px`, `background: #eeeeee`, `padding: 10px`, `box-shadow: 5px 5px 30px #333`, `visibility: hidden`, `z-index: 100`. Measured open: 480×358 at x=150.
- Header row "Options" + `images/close-button.png` 24×24 floated right.
- Inner white card `padding: 20px 20px 20px 40px`, `line-height: 160%`, top margin 3px.
- Radio group "Other participants can:" — `#editLimited` "Draw and erase their own drawing" (default checked), `#editFull` "Draw and erase anything", `#broadcast` "Only view my drawing". 13×13 controls at x=200, rows 37px apart.
- Row `margin: 20px 0`: checkbox `#invitees-check` + "Invite" + `select` (`1px solid #3f3ea9`, radius 5px, `padding: 3px`, 18px, `#3f3ea9`) with options `my followers` (selected) / `anyone` + "to join".
- Actions bar `#createWhiteboardFormActions`: 50px tall, `padding: 0 20px 0 10px`, buttons floated right, `More Options` (`#eeeeee` / `#233f98`, 22px, `padding: 10px 20px 10px 20px`, radius 5px, 177.6×47) and `Create Whiteboard` (`#ff6a00` / white, same metrics, 163.2×47).
- Hidden `#copyLimited-msg` 14px: "Copy and image upload for participants will be disabled".

### First-visit "How will you use Whiteboard Fox?" state — **removed in this build**

Source behaviour, recorded for reference: when cookie `user_type` is `NA` the prompt replaces the form — 100%×100% flex column, two `.user-type-choice` buttons (`padding: 30px 20px`, `1px solid` border, radius 4px, `margin: 12px 0`, 12px gap, centered inline 24×24 SVG) — "I'm Drawing for Fun" (pencil) and "I'm Drawing for Work" (pen), hover inverting to the brand colour on white. *Fun* stored the cookie and revealed the form; *Work* navigated straight to `/diagramName?copyLimited=false&broadcast=false&expiry=14`.

**Whiteboard Mod does not reproduce this.** `Start Drawing` opens the Options overlay immediately (or sends an unidentified device to the Lobby), so the form is always the visible state. `use-user-type.ts`, `icons.tsx` and the `wf_user_type` key were deleted.

## Gallery — **removed in this build**

The measurements below are the source's, kept for the record. **Whiteboard Mod does not reproduce the gallery**: the component, its data, its types and its 36 thumbnails were deleted (`gallery.tsx`, `gallery-data.ts`, `src/types/whiteboardfox.ts`, `public/sites/whiteboardfox/gallery/*`), and `src/app/page.tsx` no longer renders it. The homepage is the hero, the Options overlay and the feature strip only. The route map's `/post/<id>` row survives as the board id the cards used to link to.

- Container `max-w-5xl mx-auto flex flex-wrap gap-4`, but nested in the 1010px column with `padding: 0 50px 10px 50px` → 910px wide, 66→944px (measurements at 800px vw), top at y=647.
- Tabs: `ul` with two `li` (`w-full sm:flex`), `my-6` → 64px tall, buttons `p-4` + `border-b-2`; active = `border-[#5272bc] text-[#5272bc]`, inactive = `border-gray-200` (+ inherited `text-gray-700` from the `ul`).
- `#posts-container`: `flex flex-wrap p-6 gap-6 rounded-lg ring-1 ring-gray-900/10 bg-gray-100` → `#f3f4f6`, radius 8px, 24px padding, 878px wide.
- Cards (`template#post-template`): `rounded-md shadow bg-white border border-gray-200`, `w-full sm:w-[calc(50%-1rem)] md:w-[calc(33.33%-1rem)]` → 3 per row / 260.63×177.77 measured, radius 6px, 1px `#e5e7eb`, `shadow-sm`-equivalent.
  - Thumbnail anchor `.aspect-ratio-600-315` = `padding-top: 52.5%` → 258.63×135.77, `<img class="post-image absolute inset-0 w-full object-cover">`.
  - Pin badge (top-left, `mt-2 ml-2`, 24×24, `#808080` fill) shown only when `pinTs` is set.
  - Overflow dropdown (top-right, `mt-2 mr-2`): three-dot toggle 48×24, menu `absolute right-0 top-6 w-48 bg-white rounded shadow border border-gray-200` with one `Report NSFW` item (warning SVG 16×16 + label, `text-sm text-gray-700 px-4 py-2 hover:bg-gray-100`). Closes on outside click; opening one closes the others.
  - Editor's Choice badge (`#is-editor-pick`, `mr-1`, 24×24, `currentColor` = `#233f98`) when `isEditorPick`.
  - Like button: heart 24×24 `text-slate-500 hover:text-slate-900`; `stroke/fill` become `#F05252` when liked. Source leaves `.post-like-count` empty and never gives it an id (the `if(false)` branch), so no count renders.
  - Footer `w-full p-2 flex items-center`, 40px tall; `.post-description truncate text-sm flex-1` is always empty in the source too (its `if(false)` guard), so the footer shows only the badge and heart, right aligned.
- Pagination (`#pagination-container`, `mt-8`, 878×34): `select` (12px/500, white, 1px gray-300, radius 6px, 97×34) + `currPage-span` (` of 160`), right side `Previous` / `Next` (12px/500, `#e5e7eb`, radius 6px, `padding: 8px 12px`, disabled → `opacity: .5`).
- Data: `GET /api/gallery-posts?page=<n>&type=TOP` (CORS-locked to `Origin: https://r8.whiteboardfox.com`). 12 posts/page, `totalCount: 1909` → 160 pages at capture time. Thumbnails: `https://s1.whiteboardfox.com/sendGalleryPostThumbnail?file=<postFileName||_id>` — **returns PNG bytes despite the `.jpg`-style URL** (600×315, verified magic `89 50 4E 47`), so local files use `.png`.
- "Following" tab (`#followers-gallery`) is hidden and, when opened, shows the gray-100 notice card (`ring-1 ring-gray-900/10`, `p-6 rounded-lg`, 24px warning SVG + `text-lg`) reading "Sign in to check out posts from people you follow" with an underlined `/login.jsp` link.

## Features strip

`background: #5271bb`, inner 1010px, `padding: 30px 50px 50px 50px`, white, 16px/100.
Three `inline-block` columns of 277/276/277px with `margin-right: 20px` / `margin: 0 20px` / `margin-left: 20px`, `text-align: center`, `vertical-align: top`: `users-circle-x2.png` / `thunder-circle-x2.png` / `tablet-circle-x2.png` at 76×76 (source files are 152×152 @2x), `h3` 26px/100 with `padding: 10px 0`, then the copy.

## Contact

White section, inner 1010px, `margin: 20px 0 10px 50px`, `background: url(images/speech-bubbles.png) right top no-repeat / contain`. `h1` "Questions or Comments?" 48px/100, `padding: 20px 0 10px`; then "To contact us email:" and a block-level mailto `support@whiteboardfox.com` pill (300px, centered, `#5271bb`, white, radius 3px, 18px).

## Board screen

Measured from the live reference `https://r9.whiteboardfox.com/96635256-2598-4487` at a 1000×700 viewport. The source board is a full-viewport GWT application; this build reproduces its chrome with the same ids and class names, so the two can be diffed side by side. Captured markup and stylesheet: `board.source.html`, `board.css`.

| Element | Source | Clone |
| --- | --- | --- |
| `#menuStrip` | 0,0 140×700, `#EEEEEE`, absolute | 0,0 140×700, `rgb(238,238,238)`, fixed parent |
| Menu buttons | seven 140×70 at y 0…420 | eight 140×70 at y 0…490 — the source's seven, plus **Import** under Erase |
| Button label | 13px, `color:#000` | 13px, `rgb(0,0,0)` |
| Active tool | `1px inset #666666` | `1px inset rgb(102,102,102)` |
| `#canvasId` | 140,0 860×700 | 140,0 860×648² |
| `#colorsPanel` | grey plate, 1px black border, 7×70px cells | same, 70×70 cells |
| User row | 60px | 60px |
| `.userName` | `#0066cc`, width 200px | `rgb(0,102,204)`, 200px |
| `.userStatus.online` | `#00c004` | `rgb(0,192,4)` |
| `.userStatus.offline` | `#a1a1a1` | `rgb(161,161,161)` |
| `.userStatus.pro` | `#835eff` | `rgb(131,94,255)` |

Palette fills, copied from the live DOM:

| Name | Fill |
| --- | --- |
| Black | `#4a4a4aff` |
| Blue | `#2761a4ff` |
| Aquamarine | `#44bff2ff` |
| Red | `#c1086cff` |
| Green | `#98bb13ff` |
| Purple | `#ac90e3ff` |
| Yellow | `#e6b82eff` |

Toolbar glyphs are the source's own PNGs (`Undo`, `Eraser`, `Move`, `Select`, `Cog`, `Trash`) downloaded byte-for-byte to `public/sites/whiteboardfox/board/`. Pencil is the only inline-SVG button in the source, so its path (including the `rotate(-45 …) scale(1.1 1.15) rotate(45 …)` group) is reproduced verbatim.

Deliberate differences: pan/zoom, lasso, per-item erase and `Who drew what?` need the GWT engine and the server-side document, so the buttons reproduce appearance and state while drawing, undo and clear fully work. Participants beyond the visitor are deterministic rows derived from the board id. The share link reads `https://whiteboardmod.com/board/<id>`.

## Room layer (here.fm)

The board is also a room. The reference was `https://again.here.fm/1875608d-1773-4407-af88-db7dd3f7c33f` — the room no longer exists, but its DOM and stylesheet were inspected before it went, and they describe the layout that was copied. here.fm is the functional spec; whiteboardfox's board stays the substrate, and the accent stays coral.

Facts taken from the reference room's own stylesheet:

| Element | Reference (here.fm) | Clone |
| --- | --- | --- |
| Bottom bar | avatar · `@` · emoji · "Say something..." | same, plus a mic chip and a **Send** button |
| Chat bubbles | `background: #fff`, `border-radius: 10px`, `box-shadow: 0 0 13px rgba(0,0,0,.5)` | same, with the author line in coral |
| Message column | `#room-messages` floats; `#room-message-list` is `width: fit-content` | floats over the canvas on the right, 320px wide |
| Invite popover | bold 14px title | "Invite people", bold 14px |
| Primary colour | `#6b1be3` | **not used** — coral `#e0533f` |

Measured on the clone at a 1000×700 viewport:

| Element | Clone |
| --- | --- |
| Room bar | 140 wide at x=0, y=560…652 — directly under the Clear button (y=490…560) |
| Room buttons | four 30×30 circles, `rgb(224,83,63)`, `border-radius: 50%`, at x = 4 / 38 / 72 / 106, y = 596 |
| Mic meter | 132×6 at (4, 634) |
| Chat bar | 860×52 at (140, 648) — the canvas is 52px shorter than the viewport, so the bar never covers a drawing |
| Chat input | 320×32 at (595, 659); **Send** at (925, 659) |
| Message bubbles | 320 wide, right-floated at x=664 |

The room is stored per board in `localStorage` under `wf_room_<boardId>` and mirrored to the other tabs of the same browser through the `storage` event.

## The board's options

The Options panel used to be a copy of the source's *Opciones* modal. It is now three tabs, and every control in it does something:

| Tab | Control | What it does |
| --- | --- | --- |
| Colours | **BG color** | Paints the whole board behind the ink and the grid. The source's "Quick Colours" row is gone — the artist's colour wheel is the only control, and it is bound to the board itself rather than to the next stroke. |
| Participants | the users list | Moved here from the toolbar; each row now carries its role (**Host** or user). |
| Settings | **Show grid** | Draws or hides the infinite grid. |
| Settings | **Snap to grid** | Makes a stroke, a fill and a lasso point land on the grid lines. |
| Settings | **Grid size** | The base step of the grid, in world units (80 by default). The on-screen step still doubles itself when the zoom would make the grid too dense. |
| Settings | **Auto-save interval** | How often the board writes itself out, in seconds (30 by default, never below 5). |
| Settings | **Flip colors** | Replaces the source's *Dark mode*. The board becomes its photographic negative — white becomes black, coral becomes cyan, a picture becomes its negative — and it is **personal**: only the device that switched it on sees the negative. |

The board's own settings (background colour, grid, snapping, grid size, auto-save interval) live in `localStorage` under `wf_board_settings_<boardId>` and are shared by every tab of that board. **Flip colors** lives under `wf_flip_colors`, because it is a view of the board and not a property of it.

**BG color belongs to the host alone.** The guard sits in three places, so it cannot be talked around: the colour wheel refuses to speak back when it is disabled, the board's settings handler drops any `backgroundColor` change that does not come from the host, and a guest sees the wheel greyed out with the note "Only the board host can change the background colour."

The board also saves itself: the strokes and the imported media are written to `localStorage` under `wf_board_document_<boardId>` (4 MB cap) on the auto-save interval, and read back when the board is opened again.

## Importing media

Under **Erase** there is an **Import** button. Its menu carries here.fm's three ways in — **Image or file**, **Audio** and **Record voice note** — and leaves out here.fm's fourth, *Share Web App*, which has no meaning on a whiteboard. A picture lands in the middle of what the user is looking at, selected, with its small options underneath.

An imported piece is not a stroke, so it carries its own geometry: its centre, its intrinsic size, a uniform `scale` and a `rotation`. That is what lets the panel show a size and an angle, and what lets the undo history restore a transformed item by value. A transform is one undo step, like any other edit.

The options under a selected item are the ones here.fm shows, drawn on the canvas in screen space so they keep their size at every zoom: **Download**, **Rotate**, the **three dots** and **Resize**. The item's body is dragged with the **Select** tool; the rotate handle spins it around its centre and the resize handle grows it uniformly around its centre, and those two gestures start only while their own handle is pressed (the drag measures the ratio of the pointer's distance to the item's centre, so the item does not chase its own tail while it grows). A press on the background puts the menu and the options row away, and selecting the picture again brings them back.

The three-dot menu carries here.fm's list — *Move to front*, *Move to back*, *Pin*, *Lock*, *Mirror*, *Duplicate*, *Download Original*, *Set as my avatar* and a red *Delete* — minus *Make Deck*, which is a here.fm feature with no meaning here, and with the lock's submenu collapsed into a single flag. A pinned item stays in front of the stack; a locked item cannot be moved, turned or grown. *Set as my avatar* crops the picture square and stores a 128px copy in `wf_avatar`, which the room bar and the participants row then show in place of the generated silhouette.

## Verification

`npm run check` passes: ESLint clean, `tsc --noEmit` clean, `next build` prerenders 8 static routes (`/`, `/pro`, `/account`, `/lobby`, `/options`, `/privacy`, `/terms`, `/_not-found`) plus the dynamic `/board/[id]`.

A headless-Chrome-over-CDP regression (`scripts/board-canvas-check.mjs`) asserts the canvas pixel buffer end to end — buffer sizing, marker colour/width, the live preview, `Rellenar`, the gradient settings, the Select tool (drag, scale, undo), the whole room layer, the host's rights, the board settings and the imported items. It is **84/84 green**.

Geometry re-measured on the clone at a 1000px viewport against the source's numbers:

| Element | Source | Clone |
| --- | --- | --- |
| `h1` | 370×226 @ (150,91), 52px/78px | 370×226 @ (150,91), 52px/78px |
| Subtitle | 370×64, line-height 32px | 370×64, line-height 32px |
| Subtitle top | 317 | 317 |
| `#startDrawingButton` | 370×72, 28px/42px | 370×72, 28px/42px |
| Whiteboard-ID row | 163×28.4 | 163×28.4 |
| Tab strip | 910×64 @ y 635 | **removed with the gallery** |
| `#posts-container` | 878×831.1 @ (66,753) | **removed with the gallery** |
| Card | 260.6×177.8, radius 6px | **removed with the gallery** |
| Card thumbnail | 258.6×135.8 | **removed with the gallery** |
| Pagination | 878×34 | **removed with the gallery** |

¹ The gallery rows are the source's, recorded before the gallery was deleted from this build.

² The clone's canvas is 52px shorter than the source's because the here.fm-style chat bar is part of the board's layout, not an overlay — it must never cover a drawing.

Pixel-diff (`docs/design-references/comparison.png`) residuals sit at y 400–499 (29%) and y 600–699 (28%). Those bands are the intentionally empty ad column (`#FCFCFC`) and the ad-driven vertical offset, plus font rasterisation differences and the gallery thumbnails' own pixel content — not layout drift. The gallery's own band disappears entirely once the gallery is gone.

Interactions verified live in the browser (the source's, before this build's changes — the three gallery entries are the source's own, and the gallery is no longer part of the clone):

- **Start Drawing** → options overlay becomes visible (480×361 at x=150, `#eeeeee`, `5px 5px 30px #333`).
- **First visit** → the "How will you use Whiteboard Fox?" question shows in place of the form.
- **"I'm Drawing for Fun"** → stores the choice, hides the question, reveals the radio group (3 radios, `editLimited` checked) and the `More Options` / `Create Whiteboard` actions.
- **Invite → "anyone"** → `Copy and image upload for participants will be disabled` note appears.
- **Close button** → overlay returns to `visibility: hidden`.
- **Card overflow menu** → opening a second menu closes the first; an outside click closes all.
- **Like** → heart `fill`/`stroke` become `#F05252`, `aria-pressed` becomes `true`.
- **Pagination** → `Next` advances to page 2, enables `Previous`, shows the top loading bar during the swap, then swaps the first card (`9d23f4f0…` → `920b397e…`) and hides the bar.

Interactions verified for the local customisations:

- **Gallery removal** → the homepage renders no gallery at all: no `#posts-container`, no card, no pagination and no thumbnail request; the deleted `gallery-data.ts` and `GalleryPost` type are gone with it. There are still 0 links to `whiteboardfox.com` anywhere in the app.
- **Header** → the only nav link is `Lobby → /lobby`; no `Pricing`, `Sign In` or pro link exists.
- **First run** → a device with no `wf_nickname` gets `#profileEl` visible, a minted `wf_device_id`, the "Elige un apodo" copy, and exactly one editable input (`#nickname`).
- **Saving a nickname** → persists to `wf_nickname`, updates the header chip to `@Zorro`, closes the panel. Saving with no edit does not clear it.
- **Reload persistence** → `wf_device_id`, `wf_nickname` and `wf_pro` survive a reload; the chip shows `@Zorro` + `PRO`.
- **Pro activation** → `/pro` shows `Todavía no está activo` and one button; after the click: `Pro activo en este dispositivo`, button gone, chip badge `PRO`, `wf_pro="true"`. Payment audit on the page: 0 forms, 0 checkout/subscribe/price controls, 0 external links.
- **Pro unlocks options** → with Pro: invite target `anyone`, `force-auth-participants=false`, `my followers` enabled, no sign-in prompt. Without Pro: invite target `my followers`, `force-auth-participants=true`, `my followers` disabled, upsell note shown.
- **`/account`** → shows the device id read-only, 0 password/email inputs, exactly the nickname editable; editing it propagates to `wf_nickname` and the header chip.

Verified for this round's changes:

- **Rebrand** → `<title>` is `Simple Online Whiteboard - Whiteboard Mod`; the header wordmark reads `Whiteboard Mod`; no "Whiteboard Fox" text anywhere on the page.
- **Coral** → `getComputedStyle(document.body).color` is `rgb(224, 83, 63)`; footer background is the same coral; `--primary` is coral.
- **Start Drawing, no profile** → clicking `#startDrawingButton` navigates to `/lobby?from=board` and `#optionsEl` stays `hidden`.
- **Lobby capture** → `[data-testid="lobby-device-id"]` shows a minted `WM-…` id; `Crear pizarrón` has `aria-disabled="true"` until a nickname is saved; after saving, `wf_nickname` is set, the chip reads `@Zorro`, and the gate note disappears.
- **Start Drawing, with profile** → `#optionsEl` becomes `visible` with no `[data-testid="user-type-query"]` and no fun/work buttons; the form is the visible state.
- **Create Whiteboard** → lands on `/board/<minted id>`; `wf_joined_boards` gains the entry.
- **Board identity** → the board inherits the stored nickname; the users panel's first row is `<nickname> (You)` and `.userName` resolves to `rgb(0, 102, 204)`.
- **Board geometry (vs. the reference board)** → `#menuStrip` measures 140×700 at (0,0) with `background-color: rgb(238, 238, 238)` in `column` flow; `#canvasId` measures 860×648 at x=140 (648 = 700 − the 52px chat bar); the eight `.menu-button`s are 140×70 at y = 0, 70, 140, 210, 280, 350, 420, 490 with 13px labels (the source's seven, plus **Import** under Erase); the active tool carries `1px inset rgb(102, 102, 102)`.
- **Board palette** → clicking `Draw` opens `[data-testid="colorsPanel"]` (7 cells, 70×70, 1px solid black border on `rgb(238,238,238)`), and the seven `path[fill]` values equal the live DOM's `#4a4a4aff`, `#2761a4ff`, `#44bff2ff`, `#c1086cff`, `#98bb13ff`, `#ac90e3ff`, `#e6b82eff`.
- **Board users panel** → rows are 60px with a `.avatar-container` SVG (`#FFFFFF88` + `hsl(h, 75%, 43%)` circles), status dots resolve to `rgb(0, 192, 4)` (online) and `rgb(131, 94, 255)` (pro), `.usersScrollArea` / `#usersTable` / `.usersSearchBox` are present, and both `.whoDrewBtn`s read `Who drew what?` and `Search user`.
- **Board drawing** → a synthetic pointer drag paints 1870 pixels on `#canvasId`; `Undo` puts the board's own background colour back (the canvas is opaque now — it paints the board's colour rather than leaving the page's white behind).
- **Select-tool scaling** → dragging the top handle of a selected 100×100 rectangle up by 100px moves the ink from `[120,700]–[219,799]` to `[120,600]–[219,799]`: the bottom edge stays exactly where it was and the top follows the pointer, with no sign of a flip. Dragging the SE corner of a 160×100 rectangle outward by `(+40,+40)` grows it to `[120,700]–[319,839]` — the **opposite (NW) corner stays at `[120,700]`**.
- **Undo after a Select-tool change** → Undo puts the scaled rectangle back at `[120,700]–[219,799]`, and it puts a shape that was dragged 60px right back from `[180,700]–[279,799]` to `[120,700]–[219,799]`. The undo history is a list of pre-edit snapshots (50 deep), and a gesture captures one at its start and keeps it only if the document really changed, so one drag is one undo step.
- **Board deep link** → visiting `/board/<id>` directly renders the board (no `board-gate`) and inherits the stored nickname and id.
- **Board share link** → `[data-testid="board-share-path"]` reads `https://whiteboardmod.com/board/<id>`.
- **Lobby recent list** → after visiting a board, the Lobby lists it as a `/board/<id>` link.
- **New board from the Lobby** → clicking `Crear pizarrón` rewrites `/board/new` to `/board/<minted id>` via `replaceState`, and the new board's share link uses the minted id.
- **Gallery** → the gallery is gone from the page, so there is no card to follow; there are 0 links to `whiteboardfox.com` anywhere in the app.
- **Footer** → `Privacy Policy` → `/privacy` and `Terms of Service` → `/terms`, both rendering locally with the real chrome.
- **Removed UI** → no `Pricing` / `Sign In` links, no `a[href="/pricing"]` / `a[href="/login"]`, no login text, no fun/work text.
- **Room bar** → `[data-testid="room-bar"]` measures 140 wide at y=560, exactly where the Clear button ends (y=490…560); the four controls (invite, chat, emoji, mic) are 30×30 circles in `rgb(224,83,63)` at x = 4/38/72/106, y = 596, with the level meter underneath at (4, 634).
- **Invite** → the popover opens below the button and `[data-testid="room-invite-link"]` reads `https://whiteboardmod.com/board/<id>` — the board's own address.
- **Chat** → typing in `[data-testid="room-chat-input"]` and pressing **Send** renders one bubble with the text, and `localStorage` gains exactly one `wf_room_*` key.
- **Reaction** → picking an emoji puts one `[data-testid="room-reaction"]` element floating over the canvas.
- **Reload** → the room is still there after a reload; the conversation survives in `localStorage`.
- **Chat bar** → 860×52 at (140, 648) with the avatar, the nickname, the `@`, the emoji button, the "Say something..." field and **Send**; the canvas buffer is 1360×898 at a 1500×950 viewport, i.e. 52px shorter than the window.
- **Unread badge** → a message injected into the room while the chat is closed badges the Chat button with `1`; opening the chat clears it.
- **Cross-tab** → a message sent in one tab appears in the other through the `storage` event.

Verified for the options, the host and the imports:

- **Options panel** → `[data-testid="tool-options"]` opens a panel with three tabs — `options-tab-colours`, `options-tab-participants` and `options-tab-settings`. The Colours tab holds **BG color** (the artist's wheel, bound to the board) and no "Quick Colours" row; the Settings tab holds *Show grid*, *Snap to grid*, *Grid size*, *Auto-save interval* and *Flip colors*; there is no *Dark mode* anywhere.
- **The host** → the device that opened the board is stored in `wf_board_hosts` as `{ "PREVIEW-TEST-01": "WM-A3F9-2C71" }`, the participants list marks it **Host**, and its **Clear** button is enabled. A second device (`WM-OTHER-7788`) finds the Clear button disabled, with the title "Only the board host can clear the board".
- **BG color** → the host typed `#ffeedd` and the canvas reads `rgb(255,238,221)`, with the colour stored under `wf_board_settings_PREVIEW-TEST-01`. The guest's wheel carries `data-disabled="true"`, the panel shows "Only the board host can change the background colour.", and the guest's attempt to type `00FF00` leaves the canvas untouched.
- **Flip colors** → the same background reads `rgb(0,17,34)` with the flip on — the exact negative — and `rgb(255,238,221)` with it off.
- **The grid** → a line at x=80 reads `rgb(232,232,232)`; with *Show grid* off the same pixel is the background colour again. A fill lassoed over world (907,641)–(1017,741) with *Snap to grid* on landed on `[880,640]–[1039,719]`, the 80-unit lattice.
- **Import** → the **Import** button sits directly under **Erase** in the strip, and its menu offers *Image or file*, *Audio* and *Record voice note*.
- **An imported picture** → a 120×120 magenta PNG landed at `[620,389]–[739,508]`, the middle of the board, with its coral options row drawn 26px under it. The resize handle grew it to `[560,329]–[799,568]` (240×240, exactly double) and the rotate handle turned it to `[511,280]–[848,617]` (337×337, a 45° swing). Two Undo presses put it back at `[620,389]–[739,508]`. With the Select tool, dragging the item moved it to `[700,429]–[819,548]`; a press on the background hid the options (`coral=0`), and selecting it again brought them back without moving it.
- **A resized picture** → shrinking the 120px picture to 60px and grabbing it 22px from its centre (inside the picture, outside the double-scaled hit box the first build used) still moved it 50px right.
- **The three-dot menu** → it opens on the item's dots handle with *Move to front*, *Move to back*, *Pin*, *Lock*, *Mirror*, *Duplicate*, *Download Original*, *Set as my avatar* and *Delete*, in that order. *Pin* toggles to *Unpin*, *Lock* to *Unlock* and blocks dragging, *Mirror* moves the picture's green corner patch to the other side, *Download Original* hands the PNG to the browser, *Set as my avatar* stores a data URL and shows it in the room bar, *Duplicate* makes a 144×144 pair whose stacking follows *Move to back*/*Move to front* (checked through the overlapping green patch), and *Delete* leaves no magenta pixel on the canvas.

## Not reproduced (disclosed)

- Ad slots (`#home-ad`, Fuse/publift), Tawk.to chat widget, Facebook SDK, Firebase auth/UI, Google Analytics — third-party scripts with no local equivalent.
- The invitation banner (`#invite-banner-template`) depends on `GET /api/getInvitation`; only reachable when the server reports an outstanding invite.
- The `user_type` cookie is no longer used: the fun/work question was removed, so `wf_user_type` is gone.
- **Authentication is replaced, not reproduced.** The source's `login.jsp` / Firebase sign-in flow is gone; identity is the `wf_device_id` device id and the Lobby is the only entry point. This is intentional per the local customisations above — it is what allows `force-auth-participants=false` so invited participants need no account.
- **The gallery is gone.** The source's snapshot grid, its live origin-locked API (`GET /api/gallery-posts?page=<n>&type=TOP`, `totalCount: 1909` → 160 pages), its like toggle, its *Report NSFW* menu and its 36 thumbnails were all deleted rather than reimplemented. The homepage keeps the hero, the Options overlay and the feature strip.
- **The board is not networked.** There is no collaboration server: the strokes and the imported media live in the document and are written to `localStorage` on the auto-save interval — so a board survives a reload in the same browser — but they are never shared, and the other participants are deterministic demo rows derived from a hash of the board id. The screen itself is an identical copy — only the transport is missing. `Create Whiteboard` / `More Options` no longer hand off to the source's `diagramName` / `options.jsp`.
- **The room is browser-local.** here.fm talks over a websocket; here the conversation and reactions live in `localStorage` and reach the other tabs of the *same* browser through the `storage` event. Two people on two machines do not share a room yet, and the microphone is a local level meter rather than a voice stream.
- **Board pan/zoom, lasso, per-item erase and `Who drew what?` are not functional.** They require the GWT engine and the server-side document. The buttons reproduce the original's appearance and active state; drawing, undo and clear work.
- **The fun/work branch was deleted.** `wf_user_type`, `use-user-type.ts` and the two glyph icons are gone; the Options overlay has one path.
- **Pro is client-only.** `wf_pro` lives in `localStorage`: activation is per-device, syncs nowhere, and does not contact the live site. There is no plan, price, billing or gateway.
- `Create Whiteboard` creates a **local** board at `/board/new`; `More Options` links to the local `/options`. Neither hands off to the original site any more.
