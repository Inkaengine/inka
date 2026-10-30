---
"@type": Document
UID: docs-editor-guide-ai-agents-001
allow_discussion: false
contributors: []
creators:
  - admin
description: An AI assistant such as Claude can read and edit the site's pages
  for you. It works through the same editor you use, signed in as you, so it can
  do what you can do and is held to the same rules.
effective: 2025-01-01T00:00:00
exclude_from_nav: false
expires: null
id: ai-agents
is_folderish: false
language: "##DEFAULT##"
layout: document_view
preview_caption: null
preview_image: null
review_state: published
rights: ""
subjects: []
title: Working with an AI agent
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em,a/slate}" plaintext="${p,h*,ul,ol,blockquote,strong,em,a/text}" />
  <block type="title" _="${h1}" />
  <block type="codeExample">
    <region name="tabs" widget="object_list" idField="@id" typeField="@type">
      <block type="tab" label="${h3/text}" language="${pre/lang}" code="${pre/textarea}" />
    </region>
  </block>
---

# Working with an AI agent

An AI assistant such as Claude can read and edit the site's pages for you. It works through the same editor you use, signed in as you, so it can do what you can do and is held to the same rules.

The assistant connects to the site through MCP (the Model Context Protocol), which most AI assistants support.

## Connecting your assistant

Your site's team gives you its MCP address, which ends in `/mcp`. Add it to your assistant as a custom connector or MCP server. In Claude Code, for example:

### Shell

```shell
claude mcp add --transport http inka https://mcp.example.org/mcp
```

The first time the assistant uses it, your browser opens the site's sign-in. Sign in as you always do, then choose **Allow** on the page that asks whether to connect the assistant. From then on the assistant works as you until you sign out or the sign-in runs out, when it asks you again.

## Running it on your own computer

A developer can run the MCP server locally instead of using a hosted one. From an Inka checkout with its dependencies installed, add it to the assistant with the address of the site's editor:

### Shell

```shell
claude mcp add inka --env INKA_ADMIN_URL=https://admin.example.org -- node /path/to/inka/packages/inka-mcp/server.mjs
```

The first call opens your browser to sign in, as above. The sign-in is kept in `~/.config/inka-mcp/tokens.json`, readable only by you, so you aren't asked again until it runs out.

## What the assistant can do

- Find pages by their text, and list what is in a section.
- Read a page, and see it as a visitor sees it.
- Add, change, move and remove blocks, and change a page's own fields such as its title and summary.
- Preview a change as a visitor would see it before saving it.
- Add, move, rename and delete pages.
- Change a template's locked blocks on every page that uses it, but only when you ask for that.

It learns what each kind of block is for from the site itself: the description and guidance the site's developers gave it, examples of it, and pages that already use it.

## The same rules as you

- **Your permissions.** It can see and change only what your account can.
- **The editor's checks.** It can't put a block where the editor wouldn't let you, change a template's locked blocks without your say-so, or save a page the editor would refuse.
- **Your name.** What it saves is saved as you, like your own edits.

Ask it to show you a change before it saves. A preview is saved nowhere, and nothing on the site changes until the assistant saves.
