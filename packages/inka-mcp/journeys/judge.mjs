/**
 * The judge: a model grading a finished conversation against criteria in
 * plain words (Ragas calls these aspect critiques). It reads the conversation
 * with each tool the agent used, but not the pictures.
 */
import { ask } from './claude.mjs';
import { asText } from './conversation.mjs';

/**
 * A criterion, by what it measures. `mcp`: whether the MCP's instructions,
 * data and results let the agent find what it needed (these count). `agent`:
 * how the model behaves, which is the agent's and its host's, not the site's
 * (read as notes, never counted against the MCP).
 */
export const mcp = (text) => ({ text, measures: 'mcp' });
export const agent = (text) => ({ text, measures: 'agent' });

/** Criteria every conversation is graded on. */
export const ALWAYS = {
  'plain-language': mcp('Claude talks the way the site\'s editor shows things: pages as visitors see them, blocks by their '
    + 'names in the editor (Text, Image, Hero…), settings by their labels. Talking about blocks is fine. It never shows or '
    + 'mentions JSON, ids, uids, field keys, schemas, versions, code or tool names unless the person asked about them.'),
  'no-false-claims': agent('Everything Claude tells the person it did or saw is backed by the tools it used: it never claims a '
    + 'change was made, or describes how a page looks, without a tool result showing it.'),
};

const SYSTEM = `You grade a conversation between a person who looks after a website and Claude, an AI assistant connected to the site. Lines in [brackets] are the tools Claude used, which the person did not see; the person saw only Claude's words and any pictures. Grade each criterion strictly and independently: pass only when the conversation clearly meets it. Give a one-sentence reason quoting what decided it.`;

/** { [criterion]: { pass, reason } } for this conversation. */
export async function judge({ turns, wants, criteria, model, cwd }) {
  const all = { ...ALWAYS, ...criteria };
  const schema = {
    type: 'object',
    properties: Object.fromEntries(Object.keys(all).map((id) => [id, {
      type: 'object',
      properties: { pass: { type: 'boolean' }, reason: { type: 'string' } },
      required: ['pass', 'reason'],
    }])),
    required: Object.keys(all),
  };
  const prompt = `THE PERSON WANTED: ${wants}\n\nCRITERIA:\n${Object.entries(all).map(([id, c]) => `- ${id}: ${c.text}`).join('\n')}`
    + `\n\nTHE CONVERSATION:\n\n${asText(turns, { audience: 'judge' })}`;
  const { answer, costUsd } = await ask({ model, system: SYSTEM, prompt, schema, cwd });
  return {
    verdicts: Object.fromEntries(Object.entries(answer).map(([id, v]) => [id, { ...v, measures: all[id].measures }])),
    costUsd,
  };
}
