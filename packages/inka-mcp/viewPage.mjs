/**
 * What the MCP's views (MCP Apps: screenshotView.mjs, dropView.mjs) share: the
 * page, the ext-apps client inlined in it, a status line, and connecting.
 *
 * The client's sandbox loads nothing from another origin unless the resource
 * declares it, so the page carries everything: the ext-apps client, inlined.
 * That bundle is an ES module whose one export list ends the file; the page
 * can't import from its own inline script, so the list is replaced by a
 * binding of App. The version is pinned in package.json: a bundle that no
 * longer ends that way is refused when the server starts.
 */
import { appClientSource } from './appClient.mjs';

/** The ext-apps client, with `App` bound in place of its export list. */
function appClient() {
  const bundle = appClientSource;
  const exportList = bundle.match(/export\s*\{([^}]*)\};?\s*$/);
  if (!exportList) throw new Error('inka-mcp: the ext-apps bundle no longer ends in its export list, so a view cannot inline it');
  const app = exportList[1].split(',').map((entry) => entry.trim().split(/\s+as\s+/)).find(([, name]) => name === 'App');
  if (!app) throw new Error('inka-mcp: the ext-apps bundle exports no App');
  return `${bundle.slice(0, exportList.index)}\nconst App = ${app[0]};`;
}

// Every step a view doesn't get past is said on the page: an empty panel (as
// Claude's Android app first showed) can't tell anyone what went wrong.
const CONNECT = `
const status = document.getElementById('status');
const say = (text) => { status.textContent = text; status.hidden = !text; };
window.addEventListener('error', (event) => say('The view failed: ' + event.message));
/**
 * The connection to the conversation, as \`name\`; \`onResult(result, app)\` is
 * handed each tool result. It asks to connect until the client answers. A
 * client that starts listening after the view has asked never hears it (the
 * frame on claude.ai stayed 0px tall, on Claude's Android app an empty
 * panel), and the SDK asks once.
 */
async function connect(name, onResult) {
  say('Connecting to the conversation…');
  for (let attempt = 1; ; attempt++) {
    const app = new App({ name, version: '0.0.1' });
    app.ontoolresult = (result) => onResult(result, app);
    let abandoned = false;
    const answered = app.connect().then(() => true, (error) => {
      if (abandoned) return false;
      say('The view could not connect to the conversation: ' + error.message);
      throw error;
    });
    const unanswered = new Promise((done) => { setTimeout(() => done(false), Math.min(500 * attempt, 3000)); });
    if (await Promise.race([answered, unanswered])) return app;
    abandoned = true;
    await app.close();
  }
}
`;

/** A view's HTML: `body` after the status line, and `script` run with `say` and `connect`. */
export function viewHtml({ title, style, body, script }) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>${title}</title>
<style>
  body { margin: 0; }
  #status { margin: 0; padding: 8px 0; font: 13px/1.4 system-ui, sans-serif; color: #888; }
${style}
</style></head>
<body><p id="status" hidden></p>${body}
<script type="module">
${appClient()}
${CONNECT}
${script}
</script>
</body></html>`;
}
