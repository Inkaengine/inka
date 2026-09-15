# Object-browser Folder Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. (No subagents — user standing rule; execute inline.)

**Goal:** Upload a file into the folder being browsed in the object browser and have it auto-selected, in all content modes (link / image / multiple), from both the sidebar and the canvas.

**Architecture:** Add an upload affordance (Dropzone + Upload button) to `ObjectBrowserBody` — the shared component behind every picker, so the sidebar and the canvas link editor both get it. On upload: `createContent` into `currentFolder`, refresh the listing, then `handleSelectItem` the new item (select+close for single modes, add for multiple). MIME decides `Image` vs `File`. Reuses the image-widget upload mechanism.

**Tech Stack:** React/Volto admin, `createContent`/`readAsDataURL`/`validateFileUploadSize`, `react-dropzone`, vitest unit, Playwright integration (`--project=admin-mock`), mock Plone API session upload storage.

**Spec:** `docs/superpowers/specs/2026-07-24-object-browser-upload-design.md`

---

## File structure

- Create `packages/volto-hydra/src/utils/uploadPayload.js` — pure `buildUploadPayload(file, dataUrl)` (MIME → `{@type, title, image|file:{…}}`).
- Create `packages/volto-hydra/src/utils/uploadPayload.test.js` — vitest.
- Modify `.../Sidebar/ObjectBrowserBody.jsx` — imports, connect `createContent`, `handleUpload`, `refreshListing`, Dropzone + Upload button UI.
- Create `tests-playwright/fixtures/content/upload-folder/data.json` — a folderish target to browse into and upload to.
- Create `tests-playwright/integration/object-browser-upload.spec.ts` — sidebar link, canvas link, image mode.

Unit: `pnpm exec vitest run <path>`. Integration: `--project=admin-mock`.

---

## Task 1: Pure `buildUploadPayload` helper

**Files:**
- Create: `packages/volto-hydra/src/utils/uploadPayload.js`
- Test: `packages/volto-hydra/src/utils/uploadPayload.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { buildUploadPayload } from './uploadPayload';

describe('buildUploadPayload', () => {
  it('maps an image file to @type Image with an image field', () => {
    const file = { name: 'p.png', type: 'image/png' };
    const p = buildUploadPayload(file, 'data:image/png;base64,QUJD');
    expect(p).toEqual({
      '@type': 'Image',
      title: 'p.png',
      image: {
        data: 'QUJD',
        encoding: 'base64',
        'content-type': 'image/png',
        filename: 'p.png',
      },
    });
  });

  it('maps a non-image file to @type File with a file field', () => {
    const file = { name: 'notes.txt', type: 'text/plain' };
    const p = buildUploadPayload(file, 'data:text/plain;base64,SGk=');
    expect(p['@type']).toBe('File');
    expect(p.file).toEqual({
      data: 'SGk=',
      encoding: 'base64',
      'content-type': 'text/plain',
      filename: 'notes.txt',
    });
  });

  it('treats a missing/empty MIME type as a File', () => {
    const p = buildUploadPayload({ name: 'x', type: '' }, 'data:application/octet-stream;base64,AA==');
    expect(p['@type']).toBe('File');
  });

  it('throws on an unparseable data URL (fail loudly)', () => {
    expect(() => buildUploadPayload({ name: 'x', type: 'image/png' }, 'not-a-data-url')).toThrow();
  });
});
```

- [ ] **Step 2: Run — expect FAIL (module missing)**

Run: `pnpm exec vitest run packages/volto-hydra/src/utils/uploadPayload.test.js 2>&1 | tee /tmp/test-output.log`

- [ ] **Step 3: Implement**

```js
// packages/volto-hydra/src/utils/uploadPayload.js
/**
 * Build a createContent payload from a dropped/picked file and its data URL.
 * image/* → Plone Image (image field); anything else → File (file field).
 *
 * @param {{name: string, type: string}} file
 * @param {string} dataUrl - result of readAsDataURL(file)
 * @returns {object} createContent body
 */
export function buildUploadPayload(file, dataUrl) {
  const fields = dataUrl.match(/^data:(.*);(.*),(.*)$/);
  if (!fields) {
    throw new Error(`buildUploadPayload: unparseable data URL for ${file.name}`);
  }
  const isImage = (file.type || '').startsWith('image/');
  const field = isImage ? 'image' : 'file';
  return {
    '@type': isImage ? 'Image' : 'File',
    title: file.name,
    [field]: {
      data: fields[3],
      encoding: fields[2],
      'content-type': fields[1],
      filename: file.name,
    },
  };
}
```

- [ ] **Step 4: Run — expect PASS (4 tests)**
- [ ] **Step 5: Commit** — `feat(ob-upload): pure buildUploadPayload helper`

---

## Task 2: Upload logic in ObjectBrowserBody

**Files:**
- Modify: `.../Sidebar/ObjectBrowserBody.jsx`

- [ ] **Step 1: Imports + connect**

- `import { getContent, createContent } from '@plone/volto/actions/content/content';` (getContent already imported — extend it).
- `import { readAsDataURL } from 'promise-file-reader';`
- `import { validateFileUploadSize } from '@plone/volto/helpers/FormValidation/FormValidation';`
- `import { buildUploadPayload } from '../../../../../utils/uploadPayload';`
- `import loadable from '@loadable/component';` and `const Dropzone = loadable(() => import('react-dropzone'));`
- Add `createContent` to the `connect(...)` mapDispatch alongside `searchContent, getContent`.
- State: add `uploading: false`.

- [ ] **Step 2: `refreshListing` + `handleUpload`**

```jsx
  refreshListing = () => {
    this.props.searchContent(
      this.state.currentFolder,
      {
        'path.depth': 1,
        sort_on: 'getObjPositionInParent',
        metadata_fields: '_all',
        b_size: 1000,
      },
      `${this.props.block}-${this.props.mode}`,
    );
  };

  handleUpload = (file) => {
    if (!file) return;
    if (!validateFileUploadSize(file, this.props.intl.formatMessage)) return;
    this.setState({ uploading: true });
    readAsDataURL(file).then((dataUrl) => {
      const payload = buildUploadPayload(file, dataUrl);
      this.props
        .createContent(this.state.currentFolder, payload, `${this.props.block}-ob-upload`)
        .then((created) => {
          this.setState({ uploading: false });
          if (!created) return;
          this.refreshListing();
          // Auto-select via the normal path: select+close (single) or add (multiple).
          this.handleSelectItem(created);
        })
        .catch(() => this.setState({ uploading: false }));
    });
  };
```

> Verify at impl: `this.props.createContent(...)` returns the dispatched promise resolving to the created item (same shape as `getContent`, used in the deep-link work). Confirm `validateFileUploadSize`'s signature (file, formatMessage). `currentFolder` is folderish because the OB only lists folders you navigate into; if a non-folder can be current, upload to its parent as `ImageWidget` does.

- [ ] **Step 3: Verify admin utils unaffected**

Run: `pnpm exec vitest run packages/volto-hydra/src/utils 2>&1 | tee /tmp/test-output.log`

- [ ] **Step 4: Commit** — `feat(ob-upload): createContent-into-folder + auto-select in ObjectBrowserBody`

---

## Task 3: Upload UI (Dropzone + button)

**Files:**
- Modify: `.../Sidebar/ObjectBrowserBody.jsx` (render)

- [ ] **Step 1: Render the affordance**

In `render()`, wrap the `ObjectBrowserNav` region in a `Dropzone` (drag-drop, `noClick`), and add a visible **Upload** button with a hidden file input. Show only when the current location is folderish (all modes).

```jsx
{/* Upload into the current folder */}
<Dropzone
  disableClick
  onDrop={(files) => files?.[0] && this.handleUpload(files[0])}
  className="ob-upload-dropzone"
>
  {({ getRootProps, getInputProps }) => (
    <div {...(getRootProps ? getRootProps() : {})}>
      <button
        type="button"
        className="ob-upload-button"
        onClick={() => this.uploadInputRef?.current?.click()}
      >
        {this.state.uploading ? 'Uploading…' : 'Upload'}
      </button>
      <input
        ref={this.uploadInputRef}
        type="file"
        className="ob-upload-input"
        style={{ display: 'none' }}
        onChange={(e) => e.target.files?.[0] && this.handleUpload(e.target.files[0])}
      />
      {/* existing ObjectBrowserNav here, or beside */}
    </div>
  )}
</Dropzone>
```

> Match the installed `react-dropzone` API (render-prop vs `getRootProps`) — check what `ImageWidget` uses (`packages/.../ImageWidget.jsx:391`) and mirror it exactly. Create `this.uploadInputRef = React.createRef()` in the constructor. The hidden input must be reachable by Playwright `setInputFiles` — give it the distinctive class `ob-upload-input` and DON'T set `accept` (any file type).

- [ ] **Step 2: Verify build (no unit for UI — covered by Task 4)**

Run: `pnpm exec vitest run packages/volto-hydra/src/utils 2>&1 | tee /tmp/test-output.log`

- [ ] **Step 3: Commit** — `feat(ob-upload): Dropzone + Upload button in the object browser`

---

## Task 4: Integration — sidebar, canvas, image

**Files:**
- Create: `tests-playwright/fixtures/content/upload-folder/data.json`
- Create: `tests-playwright/integration/object-browser-upload.spec.ts`

- [ ] **Step 1: Fixture** — a folderish `upload-folder` (`is_folderish: true` or a Folder type) reachable under `/_test_data`, plus a page with a button (link field) to open the OB from, and a page with an image block for image mode. Reuse `deep-link-page-b` (button) if convenient; add `upload-folder` as the upload target.

- [ ] **Step 2: Failing integration test (sidebar link mode)**

```ts
import { test, expect } from '../fixtures';
import { AdminUIHelper } from '../helpers/AdminUIHelper';

test('upload a file into a folder from the object browser and link to it', async ({ page }) => {
  const helper = new AdminUIHelper(page);
  await helper.login();
  await helper.navigateToEdit('/deep-link-page-b');
  const iframe = helper.getIframe();

  // Open the button's link editor → object browser, navigate into the folder.
  await iframe.locator('[data-block-uid="btnb"] [data-edit-link="href"]').click();
  await page.locator('.quanta-toolbar button[title*="Edit link"]').click();
  const browse = await helper.getLinkEditorBrowseButton();
  await browse.click();
  const ob = await helper.waitForObjectBrowser();
  await helper.objectBrowserNavigateToFolder(ob, /Test Data/);
  await helper.objectBrowserNavigateToFolder(ob, /Upload Folder/);

  // Upload a text file into the folder.
  await page.locator('.ob-upload-input').setInputFiles({
    name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello'),
  });

  // The link is set to the uploaded File in that folder.
  await iframe.locator('[data-block-uid="btnb"] [data-edit-link="href"]').click();
  await page.locator('.quanta-toolbar button[title*="Edit link"]').click();
  await expect(page.locator('input[name="link"]')).toHaveValue(/upload-folder\/notes/);
});
```

- [ ] **Step 3: Run — iterate to green**

Run: `pnpm exec playwright test tests-playwright/integration/object-browser-upload.spec.ts --project=admin-mock --workers=1 2>&1 | tee /tmp/test-output.log`

- [ ] **Step 4: Add canvas + image cases**

- Canvas link: same as above but assert this proves the canvas-opened OB (it already opens via the canvas link editor — the test above IS the canvas path since it uses the quanta toolbar link editor). Add a **sidebar** link-widget variant if a fixture with a sidebar `object_browser` link field exists, to cover both entry points.
- Image mode: open an image block's browser, navigate into the folder, upload a 1×1 PNG (reuse the PNG buffer from `inline-media-link-editing.spec.ts`), assert an `@type: Image` is created and set as the block image.

- [ ] **Step 5: Commit** — `test(ob-upload): upload into folder from link + image browsers`

---

## Verification

1. Unit: `pnpm exec vitest run packages/volto-hydra/src/utils/uploadPayload.test.js` — green.
2. Integration: `pnpm exec playwright test tests-playwright/integration/object-browser-upload.spec.ts --project=admin-mock` — green.
3. No OB regressions: `pnpm exec playwright test tests-playwright/integration/copy-from-target.spec.ts tests-playwright/integration/inline-media-link-editing.spec.ts --project=admin-mock`.
4. Push; CI runs the full sweep.

## Risks / watch-items

- **react-dropzone API shape** — mirror `ImageWidget` exactly (version-specific render prop).
- **createContent promise** — confirm it resolves with the created item; else read the subrequest (`content.subrequests[key].data`) in `componentDidUpdate` like `ImageWidget` does.
- **currentFolder folderish** — guard/upload-to-parent for a non-folder current location.
- **Listing refresh timing** — `refreshListing()` re-dispatches the search; auto-select doesn't depend on the refresh (it uses the created item directly), so ordering is safe.
- **Mock createContent** — confirm it returns the created item under `currentFolder` with a resolvable `@id` and lists it on the next search (session upload storage).
