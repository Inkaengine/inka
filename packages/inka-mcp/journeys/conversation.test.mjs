import { describe, it, expect } from 'vitest';
import { agentTurn, asText, asRagas, calls, saves } from './conversation.mjs';

/** Claude Code's stream-json events for one agent turn: a look at the page, a preview, then an answer. */
const EVENTS = [
  { type: 'system', subtype: 'init' },
  { type: 'assistant', message: { content: [
    { type: 'text', text: 'Let me look at it.' },
    { type: 'tool_use', id: 't1', name: 'mcp__inka__view_page', input: { path: '/volunteer', viewport: 'mobile' } },
  ] } },
  { type: 'user', message: { content: [
    { type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: '{"renderedText":"Volunteer"}' }, { type: 'image', source: {} }] },
  ] } },
  { type: 'assistant', message: { content: [
    { type: 'tool_use', id: 't2', name: 'mcp__inka__edit_blocks', input: { path: '/volunteer', ops: [], dryRun: true } },
  ] } },
  { type: 'user', message: { content: [
    { type: 'tool_result', tool_use_id: 't2', is_error: true, content: 'the page changed since it was read' },
  ] } },
  { type: 'assistant', message: { content: [{ type: 'text', text: 'Here is how it looks on a phone.' }] } },
  { type: 'result', subtype: 'success', result: 'Here is how it looks on a phone.' },
];

describe('agentTurn', () => {
  it('collects what the agent said and each tool it used, with its outcome', () => {
    const turn = agentTurn(EVENTS);
    expect(turn.role).toBe('agent');
    expect(turn.text).toBe('Let me look at it.\n\nHere is how it looks on a phone.');
    expect(turn.tools).toEqual([
      { name: 'view_page', input: { path: '/volunteer', viewport: 'mobile' }, isError: false, result: '{"renderedText":"Volunteer"}', pictures: 1 },
      { name: 'edit_blocks', input: { path: '/volunteer', ops: [], dryRun: true }, isError: true, result: 'the page changed since it was read', pictures: 0 },
    ]);
  });

  it('fails loudly on a result for a tool call it never saw', () => {
    expect(() => agentTurn([{ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'nope', content: '' }] } }]))
      .toThrow(/nope/);
  });
});

describe('a conversation', () => {
  const turns = [{ role: 'person', text: 'How does it look on a phone?' }, agentTurn(EVENTS)];

  it('reads to the person as the chat does: words, and the pictures shown, not the tool calls', () => {
    const text = asText(turns, { audience: 'person' });
    expect(text).toContain('Claude showed you 1 picture');
    expect(text).not.toContain('view_page');
  });

  it('reads to the judge with each tool used', () => {
    const text = asText(turns, { audience: 'judge' });
    expect(text).toMatch(/\[tool view_page .*viewport.*mobile.*1 picture\]/);
    expect(text).toMatch(/\[tool edit_blocks .*ERROR: the page changed/);
  });

  it('lists calls by tool, and counts only real saves', () => {
    expect(calls(turns, 'view_page')).toHaveLength(1);
    expect(saves(turns)).toEqual([]);
    const saved = [...turns, { role: 'agent', text: '', tools: [{ name: 'edit_blocks', input: { ops: [] }, isError: false, result: '', pictures: 0 }] }];
    expect(saves(saved).map((t) => t.name)).toEqual(['edit_blocks']);
  });

  it('exports as a Ragas multi-turn sample', () => {
    const sample = asRagas(turns, 'see the page on a phone');
    expect(sample.reference).toBe('see the page on a phone');
    expect(sample.user_input[0]).toEqual({ type: 'human', content: 'How does it look on a phone?' });
    expect(sample.user_input[1]).toMatchObject({ type: 'ai', tool_calls: [{ name: 'view_page', args: { path: '/volunteer', viewport: 'mobile' } }, { name: 'edit_blocks' }] });
    expect(sample.user_input.filter((m) => m.type === 'tool')).toHaveLength(2);
    expect(sample.user_input.at(-1)).toEqual({ type: 'ai', content: 'Here is how it looks on a phone.' });
  });
});
