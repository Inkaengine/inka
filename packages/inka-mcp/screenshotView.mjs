/**
 * The screenshot view: an MCP App that shows the person what a tool showed the
 * model. A picture in a tool result goes to the model only; a client that
 * shows MCP Apps (claude.ai, Claude Desktop) draws this page in the
 * conversation under the tool call, and hands it the call's result. It shows
 * the result's pictures, and nothing for a call without any. A client may hand
 * it the result without them (Claude does): the result names them too
 * (`pictures`, ids), and the view asks the server for each (`picture`).
 */
import { viewHtml } from './viewPage.mjs';

export const SCREENSHOT_VIEW = 'ui://inka/screenshot';

const SHOW = `{
  const shots = document.getElementById('shots');
  const draw = (pictures) => shots.replaceChildren(...pictures.map(({ mimeType, data }) => {
    const img = document.createElement('img');
    img.src = 'data:' + mimeType + ';base64,' + data;
    img.alt = 'The page as a visitor sees it';
    return img;
  }));
  /**
   * The ids of the pictures the result names (its text is the tool's JSON):
   * null for a call that took none, [] when the server keeps none.
   */
  const named = (result) => {
    const text = result.content.find((part) => part.type === 'text');
    if (!text) return null;
    try {
      return JSON.parse(text.text).pictures ?? null;
    } catch (error) {
      if (error instanceof SyntaxError) return null;
      throw error;
    }
  };
  const show = async (result, app) => {
    const pictures = result.content.filter((part) => part.type === 'image');
    if (pictures.length) {
      draw(pictures);
      say('');
      return;
    }
    const ids = named(result);
    if (ids === null) {
      // A call that took no picture: nothing to show, and the panel stays shut.
      say('');
      return;
    }
    if (!ids.length) {
      say("This site's MCP server keeps no pictures for this view; the assistant still sees them.");
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
  await connect('Inka screenshot', show);
  if (!shots.children.length && status.textContent === 'Connecting to the conversation…') say('Waiting for the result…');
}`;

/** The view's HTML. */
export function screenshotViewHtml() {
  return viewHtml({
    title: 'Screenshot',
    style: `  img { display: block; width: 100%; height: auto; border-radius: 8px; }
  img + img { margin-top: 8px; }`,
    body: '<div id="shots"></div>',
    script: SHOW,
  });
}
