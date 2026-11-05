/**
 * The drop view: an MCP App in which the person drops their own files for a
 * page change. A client like claude.ai can't hand a chat attachment's bytes to
 * a tool, so the assistant asks for a file (ask_for_files) and the client
 * shows this page under that call. Each file dropped is staged through a tool
 * for the view alone (stage_dropped), as stage_media stages one: kept on the
 * MCP server, not on the site. The view then tells the assistant each file's
 * media id with a message in the conversation; where the client takes no
 * message from a view, it shows the ids for the person to pass on.
 */
import { viewHtml } from './viewPage.mjs';

export const DROP_VIEW = 'ui://inka/drop';

const DROP = (maxBytes) => `{
  const zone = document.getElementById('zone');
  const choose = document.getElementById('choose');
  const asked = document.getElementById('asked');
  const list = document.getElementById('files');
  const MAX_BYTES = ${maxBytes};
  const line = (text) => list.appendChild(Object.assign(document.createElement('li'), { textContent: text }));
  /** The file's bytes, base64. */
  const base64Of = (file) => new Promise((done, failed) => {
    const reader = new FileReader();
    reader.onload = () => done(reader.result.slice(reader.result.indexOf(',') + 1));
    reader.onerror = () => failed(reader.error);
    reader.readAsDataURL(file);
  });
  const app = await connect('Inka files', (result) => {
    const text = result.content.find((part) => part.type === 'text');
    asked.textContent = 'The assistant asks for: ' + JSON.parse(text.text).asked;
    say('');
  });
  if (status.textContent === 'Connecting to the conversation…') say('');
  const stage = async (files) => {
    const staged = [];
    for (const file of files) {
      if (file.size > MAX_BYTES) { line(file.name + ': larger than ' + MAX_BYTES + ' bytes, the most a file may be'); continue; }
      if (!file.type) { line(file.name + ": the browser can't tell what kind of file it is"); continue; }
      const answer = await app.callServerTool({
        name: 'stage_dropped', arguments: { name: file.name, type: file.type, data: await base64Of(file) },
      });
      if (answer.isError) { line(file.name + ': ' + answer.content.map((part) => part.text).join(' ')); continue; }
      const [held] = answer.structuredContent.files;
      line(file.name + ': staged, not on the site until the change is saved');
      staged.push(held);
    }
    if (!staged.length) return;
    const message = 'I dropped files for the page change. They are staged, not on the site yet:\\n'
      + staged.map((held) => '- ' + held.name + ' (' + held.type + '): ' + held.media).join('\\n');
    if (!app.getHostCapabilities()?.message) {
      say('This conversation takes no message from the view. Tell the assistant: ' + message);
      return;
    }
    const sent = await app.sendMessage({ role: 'user', content: [{ type: 'text', text: message }] });
    if (sent.isError) say('The conversation refused the message. Tell the assistant: ' + message);
  };
  zone.addEventListener('dragover', (event) => { event.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    zone.classList.remove('over');
    stage([...event.dataTransfer.files]);
  });
  choose.addEventListener('change', () => stage([...choose.files]));
}`;

/** The view's HTML; `maxBytes` is the most a file may be. */
export function dropViewHtml({ maxBytes }) {
  return viewHtml({
    title: 'Add files',
    style: `  body { font: 14px/1.4 system-ui, sans-serif; }
  #zone { display: block; border: 2px dashed #999; border-radius: 8px; padding: 24px; text-align: center; cursor: pointer; }
  #zone.over { border-color: #2a7ae2; background: rgba(42, 122, 226, 0.08); }
  #zone small { display: block; margin-top: 4px; color: #888; }
  #choose { display: none; }
  #files { padding-left: 20px; }`,
    body: `<p id="asked"></p>
<label id="zone">Drop files here, or click to choose
<small>Staged for the page change: not on the site until the change is saved. At most ${Math.round(maxBytes / 1024 / 1024)} MB each.</small>
<input id="choose" type="file" multiple></label>
<ul id="files"></ul>`,
    script: DROP(maxBytes),
  });
}
