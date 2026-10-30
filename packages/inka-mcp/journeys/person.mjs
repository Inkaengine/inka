/**
 * The simulated person: a model playing someone who looks after a website,
 * with a goal, replying to the agent the way they would in the chat. It sees
 * what the chat shows them (the agent's words, and that pictures were shown),
 * never the tools.
 */
import { ask } from './claude.mjs';
import { asText } from './conversation.mjs';

const SYSTEM = `You are role-playing a person who looks after a website and is chatting with Claude, an AI assistant connected to the site. You are not technical: you don't know what blocks, JSON or fields are, and you talk about pages as visitors see them.

You are given who you are, what you want, and the conversation so far. Write your next message to Claude: short and natural, as this person would type it. Answer Claude's questions from what you know as this person; if Claude asks something you couldn't know, say so plainly.

Set done to true, with an empty reply, when what you wanted has happened, when you have decided not to go ahead, or when Claude is going in circles. Never invent progress Claude has not shown you.`;

const SCHEMA = {
  type: 'object',
  properties: { reply: { type: 'string' }, done: { type: 'boolean' } },
  required: ['reply', 'done'],
};

/** The person's next message, or done. */
export async function nextFromPerson({ person, turns, model, cwd }) {
  const prompt = `WHO YOU ARE: ${person.who}\n\nWHAT YOU WANT: ${person.wants}\n\nTHE CONVERSATION SO FAR:\n\n${asText(turns, { audience: 'person' })}`;
  const { answer, costUsd } = await ask({ model, system: SYSTEM, prompt, schema: SCHEMA, cwd });
  if (!answer.done && !answer.reply.trim()) throw new Error('the simulated person gave an empty reply without being done');
  return { ...answer, costUsd };
}
