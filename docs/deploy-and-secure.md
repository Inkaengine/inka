---
"@type": Document
UID: docs-deploy-and-secure-000000001
allow_discussion: false
contributors: []
creators:
  - admin
description: What to run, where to put it on your network, how editors' logins
  reach the front end, and the settings that keep editing private.
effective: 2025-01-01T00:00:00
exclude_from_nav: false
expires: null
id: deploy-and-secure
is_folderish: false
language: "##DEFAULT##"
layout: document_view
preview_caption: null
preview_image: null
review_state: published
rights: ""
subjects:
  - deployment
  - security
title: Deploy and secure Inka
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
  <block type="title" _="${h1}" />
  <block type="codeExample">
    <region name="tabs" widget="object_list">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/text}" />
    </region>
  </block>
---

# Deploy and secure Inka

What to run, where to put it on your network, how editors' logins reach the front end, and the settings that keep editing private. Read [How Inka works](./architecture.md) first for the three layers.

## What you run

- **The Inka editor.** One Node.js server. Only editors use it.
- **Your CMS**, with its [adapter](./adapters/index.md). Inka does not replace it or store content of its own.
- **An editing front end.** Your front end with the bridge script, which Inka opens in an iframe. This can be a separate editing build of the same code, such as a single-page app build.
- **Your public front end.** Your site as the public sees it. It reads published content from the CMS and never loads Inka or the bridge.

## Where it sits on your network

- Put the Inka editor and the editing front end where only editors can reach them: behind login, and behind a VPN if you want.
- Editors' browsers need to reach the Inka editor, the editing front end and the CMS API.
- The public front end needs read access to published content in the CMS, and nothing else. It never calls Inka.

If Inka is down, the public site is not affected. Only editing stops.

## Configuration

Inka is configured with environment variables:

- `RAZZLE_API_PATH`: the URL of the CMS API that editors' browsers use.
- `RAZZLE_INTERNAL_API_PATH` (optional): the address the Inka server uses to reach the same API from inside your network.
- `RAZZLE_DEFAULT_IFRAME_URL`: the front ends offered in the front-end switcher, as `Name|EditURL[|PublishURL],…`. The optional publish URL is for a public site on a different origin from its editing build. If this is set when the editor is built, that value is fixed into the browser code and wins; otherwise the value at run time is used.
- `PORT`: the port the server listens on.

Don't set `RAZZLE_PUBLIC_URL`. Inka follows whichever front end the editor has selected; pinning one public URL breaks link handling for the others. See [URL flattening](./architecture.md#url-flattening-and-publicurl).

Build with `pnpm build` and run with `pnpm start:prod`. It needs Node.js 22 or 24.

## Stateless, so it can scale to zero

Inka keeps no content, no database and no files. Content, users and history stay in the CMS. Each editor's own settings, such as the front ends they have added, are kept in their browser.

- **Scale to zero.** Stop the server between editing sessions and start it on the next request.
- **Scale out.** Run more than one instance behind a load balancer. There is no shared state to synchronise.
- **Recover by redeploying.** There is nothing to back up or restore in Inka itself. Back up the CMS as you do now.

## Self-hosted or managed

Inka is open source under the MIT licence, and you can run it on your own infrastructure. Nothing phones home.

PretaGov, which develops Inka, also runs it as a managed service: a dedicated instance for each customer, kept up to date, in front of your CMS.

## How an editor's login reaches the front end

This is how the code does it today:

1. The editor signs in to Inka. Inka gets a token from the CMS (for Plone, a JSON Web Token from `@login`) and keeps it in a cookie on the Inka origin.
2. Inka opens the editing front end in an iframe. It adds the token to the iframe URL as the `access_token` parameter, and names the iframe `hydra-edit:<Inka origin>` (or `hydra-view:` when previewing).
3. The bridge reads `access_token`, keeps it in `sessionStorage` so client-side navigation keeps working, and sets an `access_token` cookie on the front end's host (12 hours, `SameSite=None; Secure`) so your server-side code can read it too.
4. Your front end sends the token to the CMS API as `Authorization: Bearer <token>`, with the editor's own permissions. That is how the preview can show unpublished pages. `getAccessToken()` and `getAuthHeaders()` from the bridge return it.

The token is the editor's CMS session token, so its lifetime is set by the CMS. Plone's default is 12 hours.

**The token is passed as a URL parameter, and that has costs.** A URL can end up in the editing front end's access logs, in the iframe's browser history, and in the `Referer` header of requests the page makes. To reduce this:

- Keep the editing front end private, as above. The token is only ever sent to it.
- Don't log query strings on the editing front end, or strip `access_token` from its logs.
- Send `Referrer-Policy: no-referrer` (or `same-origin`) from the editing front end.
- Serve everything over HTTPS.
- Keep the CMS token lifetime short, and let editors sign out when they finish.

## Pin the bridge to Inka's origin

The bridge learns Inka's origin from the iframe name. It sends messages only to that origin, and accepts messages only from that origin or from its own page. Inka, for its part, acts only on messages from the origin of the front end it opened.

A page that frames your editing front end could set a different iframe name. So pin the origin yourself:

- **Pass `adminOrigin`** to `initBridge`. It takes priority over the iframe name.
- **Send `frame-ancestors`** from the editing front end, naming only your Inka origin, so no other site can frame it.

### Javascript

```javascript
initBridge({
  adminOrigin: 'https://inka.example.org',
  onEditChange: (formData) => renderPage(formData),
});
```

### Headers

```text
Content-Security-Policy: frame-ancestors https://inka.example.org
Referrer-Policy: no-referrer
```

## Keep the bridge out of the public build

The public site doesn't need the bridge. Either build a separate editing version of your front end that includes it, or load it only when the page is inside Inka's iframe (see [lazy loading the bridge](./frontend-guide/advanced.md#lazy-load-the-bridge)). If one build serves both, send the `frame-ancestors` header above from it as well.

## Secure the server-render endpoint

A [server-rendered front end](./frontend-guide/server-rendered-frontends.md) has a render endpoint that the bridge posts to on every edit. The request carries the whole page as it is being edited, including content that is not published. Treat it as part of editing, not the public site:

- Serve it only from the editing front end, never from the public site.
- Check the caller. With the endpoint on the same origin as the page, the bridge's request carries the `access_token` cookie the bridge set. Verify that token (check its signature, or ask the CMS and cache the answer for a short time) and refuse requests without one.
- Don't log or store the request body.
- Render only the block types you know, and escape what you output.

## Report a vulnerability

Report security problems privately, as described in [SECURITY.md](https://github.com/Inkaengine/inka/blob/main/SECURITY.md): through GitHub's private vulnerability reporting, or by email to <security@pretagov.com>. Please don't open a public issue.

## Supported versions and fix times

Security fixes go into the latest release, and into the previous minor release for 6 months after the next one. The published fix times are:

- actively exploited: within 72 hours;
- critical or high: within 14 days;
- medium or low: in the next scheduled release.

PretaGov offers an optional security and maintenance subscription. It gives you security fixes on the version you run, to the same timescales, with advance notice of security releases, dependencies kept current and monthly reporting. Contact <security@pretagov.com>.
