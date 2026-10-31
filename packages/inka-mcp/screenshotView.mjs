/**
 * The screenshot view: an MCP App that shows the person what a tool showed the
 * model. A picture in a tool result goes to the model only; a client that
 * shows MCP Apps (claude.ai, Claude Desktop) draws this page in the
 * conversation under the tool call, and hands it the call's result. It shows
 * the result's pictures, and nothing for a call without any.
 *
 * The client's sandbox loads nothing from another origin unless the resource
 * declares it, so the page carries everything: the ext-apps client, inlined.
 * That bundle is an ES module whose one export list ends the file; the page
 * can't import from its own inline script, so the list is replaced by a
 * binding of App. The version is pinned in package.json: a bundle that no
 * longer ends that way is refused when the server starts.
 */
import { appClientSource } from './appClient.mjs';

export const SCREENSHOT_VIEW = 'ui://inka/screenshot';

/** The ext-apps client, with `App` bound in place of its export list. */
function appClient() {
  const bundle = appClientSource;
  const exportList = bundle.match(/export\s*\{([^}]*)\};?\s*$/);
  if (!exportList) throw new Error('inka-mcp: the ext-apps bundle no longer ends in its export list, so the screenshot view cannot inline it');
  const app = exportList[1].split(',').map((entry) => entry.trim().split(/\s+as\s+/)).find(([, name]) => name === 'App');
  if (!app) throw new Error('inka-mcp: the ext-apps bundle exports no App');
  return `${bundle.slice(0, exportList.index)}\nconst App = ${app[0]};`;
}

const SHOW = `{
  const shots = document.getElementById('shots');
  const app = new App({ name: 'Inka screenshot', version: '0.0.1' });
  app.ontoolresult = ({ content }) => {
    shots.replaceChildren(...content.filter((part) => part.type === 'image').map((part) => {
      const img = document.createElement('img');
      img.src = 'data:' + part.mimeType + ';base64,' + part.data;
      img.alt = 'The page as a visitor sees it';
      return img;
    }));
  };
  await app.connect();
}`;

/** The view's HTML. */
export function screenshotViewHtml() {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>Screenshot</title>
<style>
  body { margin: 0; }
  img { display: block; width: 100%; height: auto; border-radius: 8px; }
  img + img { margin-top: 8px; }
</style></head>
<body><div id="shots"></div>
<script type="module">
${appClient()}
${SHOW}
</script>
</body></html>`;
}
