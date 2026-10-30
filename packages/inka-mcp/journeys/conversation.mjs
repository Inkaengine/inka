/**
 * A conversation between a person and the agent: person turns are what they
 * typed; agent turns are folded from Claude Code's stream-json events. Read
 * back for the person (as the chat shows it), for the judge (with each tool
 * used), or as a Ragas multi-turn sample.
 */

const TOOL_PREFIX = 'mcp__inka__';
/** Tools that change the site whenever they run (edit_blocks only without dryRun). */
const SAVING = ['create_page', 'delete_page', 'move_page', 'rename_page'];

const textOf = (content) => (typeof content === 'string' ? content
  : content.filter((c) => c.type === 'text').map((c) => c.text).join('\n'));

/** One agent turn from its events: { role, text, final, tools: [{ name, input, isError, result, pictures }] }. */
export function agentTurn(events) {
  const said = [];
  const tools = [];
  const byId = new Map();
  let final = [];
  for (const event of events) {
    for (const part of (event.type === 'assistant' || event.type === 'user') ? event.message.content : []) {
      if (part.type === 'text') {
        said.push(part.text);
        final.push(part.text);
      } else if (part.type === 'tool_use') {
        const tool = { name: part.name.replace(TOOL_PREFIX, ''), input: part.input, isError: false, result: null, pictures: 0 };
        tools.push(tool);
        byId.set(part.id, tool);
        final = [];
      } else if (part.type === 'tool_result') {
        const tool = byId.get(part.tool_use_id);
        if (!tool) throw new Error(`a tool result for ${part.tool_use_id}, a call this turn never made`);
        tool.isError = !!part.is_error;
        tool.result = textOf(part.content);
        tool.pictures = typeof part.content === 'string' ? 0 : part.content.filter((c) => c.type === 'image').length;
      }
    }
  }
  return { role: 'agent', text: said.join('\n\n'), final: final.join('\n\n'), tools };
}

/** Every call of tool `name` across the conversation. */
export const calls = (turns, name) => turns.flatMap((t) => t.tools ?? []).filter((t) => t.name === name);

/** The calls that changed the site. */
export const saves = (turns) => turns.flatMap((t) => t.tools ?? [])
  .filter((t) => !t.isError && (SAVING.includes(t.name) || (t.name === 'edit_blocks' && !t.input.dryRun)));

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The conversation as text. `person`: what the chat shows them (the agent's
 * words, and that pictures were shown). `judge`: also each tool used, its
 * input and outcome, shortened.
 */
export function asText(turns, { audience }) {
  return turns.map((turn) => {
    if (turn.role === 'person') return `PERSON: ${turn.text}`;
    const pictures = turn.tools.reduce((n, t) => n + t.pictures, 0);
    if (audience === 'person') {
      return `CLAUDE: ${turn.text}${pictures ? `\n(Claude showed you ${plural(pictures, 'picture')} of the page.)` : ''}`;
    }
    const used = turn.tools.map((t) => `[tool ${t.name} ${JSON.stringify(t.input).slice(0, 300)} -> `
      + `${t.isError ? `ERROR: ${t.result.slice(0, 200)}` : plural(t.pictures, 'picture')}]`);
    return [...used, `CLAUDE: ${turn.text}`].join('\n');
  }).join('\n\n');
}

/**
 * A Ragas MultiTurnSample: human, ai (with tool_calls), tool messages, and
 * `reference`, the person's goal (for AgentGoalAccuracyWithReference).
 */
export function asRagas(turns, reference) {
  const messages = turns.flatMap((turn) => {
    if (turn.role === 'person') return [{ type: 'human', content: turn.text }];
    if (!turn.tools.length) return [{ type: 'ai', content: turn.text }];
    const before = turn.text.endsWith(turn.final) ? turn.text.slice(0, turn.text.length - turn.final.length).trim() : turn.text;
    return [
      { type: 'ai', content: before, tool_calls: turn.tools.map((t) => ({ name: t.name, args: t.input })) },
      ...turn.tools.map((t) => ({ type: 'tool', content: t.isError ? `ERROR: ${t.result}` : t.result })),
      ...(turn.final ? [{ type: 'ai', content: turn.final }] : []),
    ];
  });
  return { user_input: messages, reference };
}
