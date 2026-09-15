# Object-browser folder upload

## Problem

When picking content in the object browser (link / image / multiple pickers), the only
way to reference a file is to pick one that already exists. An author who wants to link
to (or embed) a file that isn't uploaded yet has to leave the flow, upload it elsewhere,
then come back. Let them **upload into the folder they're browsing and have it selected**,
without leaving the picker.

The image widget already implements the upload mechanism (`readAsDataURL` +
`createContent`); we reuse it.

## Where

In `ObjectBrowserBody`
(`src/customizations/volto/components/manage/Sidebar/ObjectBrowserBody.jsx`) — the single
component behind **every** picker: the sidebar link/image/multiple widgets **and** the
canvas inline link editor (`AddLinkForm` → `withObjectBrowser` → `ObjectBrowser` →
`ObjectBrowserBody`). Implementing it once therefore covers the sidebar and the canvas.

(The canvas inline image overlay already has its own upload — `onFileUpload` →
`createContent` — and is unchanged. That is the existing "images already work on canvas"
precedent, not part of this change.)

## Upload flow

A Dropzone wrapping the folder listing plus an explicit **Upload** button (hidden file
input). Shown in all content modes when the current browsed location is folderish.

`handleUpload(file)` — mirrors `ImageWidget`:

1. Target = the folder currently being browsed (the OB tracks it as `currentFolder` /
   per-mode `currentLinkFolder` / `currentImageFolder`).
2. Type by MIME: `image/*` → `{ '@type': 'Image', image: {…} }`; otherwise →
   `{ '@type': 'File', file: {…} }`. The field payload is
   `{ data, encoding, 'content-type', filename }` from `readAsDataURL(file)`.
3. `validateFileUploadSize(file)`, then `dispatch(createContent(targetFolder, payload, key))`.
4. On resolve (the dispatched promise returns the created item): re-run the current folder
   search so the item appears, and **auto-select** it via the existing
   `onSelectItem(url, item)` path — link/image modes set the value and close; multiple mode
   adds it to the selection and stays open.

Reuse `readAsDataURL`, `validateFileUploadSize`, `createContent` (same imports the image
widget uses).

**Scope:** one file per upload for the first cut. Multiple-file drop can follow.

## Content type mapping

| Dropped file        | `@type` | field   |
|---------------------|---------|---------|
| `image/*`           | `Image` | `image` |
| anything else       | `File`  | `file`  |

## Auto-select

`createContent`'s dispatched promise resolves with the new item (like `getContent`). Call
`onSelectItem(newItem['@id'], newItem)`:
- **link / image** (single-select): sets the value and closes the browser.
- **multiple**: adds the item to the selection; browser stays open for more.

## Testing (TDD — red first)

- **Integration, sidebar link mode:** open the OB → navigate into a folder →
  `setInputFiles` a small text file → assert a `File` is created in that folder, appears in
  the listing, and the link value is set to it.
- **Integration, canvas link mode:** same, but the OB is opened from the canvas inline link
  editor (proving the shared component covers the canvas) → link on the block is set to the
  uploaded file.
- **Integration, image mode:** upload a 1×1 PNG → `@type: Image` created and selected.
- Reuse the mock's session upload storage (`createContent` into a folder is already
  supported). Admin-side only, so admin-mock coverage suffices (no frontend dependency).

## Risks

- **Target folder** must be the *folderish* location currently listed; guard when the OB is
  at a non-folder (upload into its parent, as `ImageWidget` does).
- **Listing refresh** must re-run the *current* search query (same params the OB used to
  populate the folder), or the new item won't show before auto-select.
- **Dropzone vs the file input already in the DOM** — the canvas link editor and image
  overlay already render `input[type=file]`; scope the new input so tests (and users) hit
  the right one.

## Out of scope

- Multiple-file drop (single file first).
- Changing the existing canvas image overlay upload.
- New content types beyond Image/File.
