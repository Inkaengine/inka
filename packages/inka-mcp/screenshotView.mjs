/**
 * The screenshot view: an MCP App that shows the person what a tool showed the
 * model. A picture in a tool result goes to the model only; a client that
 * shows MCP Apps (claude.ai, Claude Desktop) draws this page in the
 * conversation under the tool call, and hands it the call's result. It shows
 * the result's pictures, and nothing for a call without any. A client may hand
 * it the result without them (Claude does): the result names them too
 * (`pictures`, ids), and the view asks the server for each (`picture`).
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

// Every step it doesn't get past is said on the page: an empty panel (as
// Claude's Android app first showed) can't tell anyone what went wrong.
const SHOW = `{
  const shots = document.getElementById('shots');
  const status = document.getElementById('status');
  const say = (text) => { status.textContent = text; status.hidden = !text; };
  window.addEventListener('error', (event) => say('The view failed: ' + event.message));
  say('Connecting to the conversation…');
  let app;
  const draw = (pictures) => shots.replaceChildren(...pictures.map(({ mimeType, data }) => {
    const img = document.createElement('img');
    img.src = 'data:' + mimeType + ';base64,' + data;
    img.alt = 'The page as a visitor sees it';
    return img;
  }));
  /** The ids of the pictures the result names: its text is the tool's JSON. */
  const named = (result) => {
    const text = result.content.find((part) => part.type === 'text');
    if (!text) return [];
    try {
      return JSON.parse(text.text).pictures ?? [];
    } catch (error) {
      if (error instanceof SyntaxError) return [];
      throw error;
    }
  };
  const show = async (result) => {
    const pictures = result.content.filter((part) => part.type === 'image');
    if (pictures.length) {
      draw(pictures);
      say('');
      return;
    }
    const ids = named(result);
    if (!ids.length) {
      say('No picture in this result (it held: ' + result.content.map((part) => part.type).join(', ') + ').');
      return;
    }
    say('Fetching the picture…');
    const fetched = await Promise.all(ids.map((id) => app.callServerTool({ name: 'picture', arguments: { id } })));
    const refused = fetched.find((answer) => answer.isError);
    if (refused) {
      say('The picture could not be had: ' + refused.content.map((part) => part.text).join(' '));
      return;
    }
    draw(fetched.map((answer) => answer.structuredContent));
    say('');
  };
  // Ask to connect until the client answers. A client that starts listening
  // after the view has asked never hears it (the frame on claude.ai stayed
  // 0px tall, on Claude's Android app an empty panel), and the SDK asks once.
  for (let attempt = 1; ; attempt++) {
    app = new App({ name: 'Inka screenshot', version: '0.0.1' });
    app.ontoolresult = show;
    let abandoned = false;
    const answered = app.connect().then(() => true, (error) => {
      if (abandoned) return false;
      say('The view could not connect to the conversation: ' + error.message);
      throw error;
    });
    const unanswered = new Promise((done) => { setTimeout(() => done(false), Math.min(500 * attempt, 3000)); });
    if (await Promise.race([answered, unanswered])) break;
    abandoned = true;
    await app.close();
  }
  if (!shots.children.length && status.textContent === 'Connecting to the conversation…') say('Waiting for the result…');
}`;

/** The view's HTML. */
export function screenshotViewHtml() {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>Screenshot</title>
<style>
  body { margin: 0; }
  img { display: block; width: 100%; height: auto; border-radius: 8px; }
  img + img { margin-top: 8px; }
  #status { margin: 0; padding: 8px 0; font: 13px/1.4 system-ui, sans-serif; color: #888; }
</style></head>
<body><p id="status" hidden></p><div id="shots"></div>
<script type="module">
${appClient()}
${SHOW}
</script>
</body></html>`;
}
