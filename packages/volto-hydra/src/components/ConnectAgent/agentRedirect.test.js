import { describe, it, expect } from 'vitest';
import { agentRedirect } from './agentRedirect';

const MCP = 'https://mcp.example.org';

describe('agentRedirect', () => {
  it("allows a listener on this computer's loopback, over plain http", () => {
    for (const uri of ['http://127.0.0.1:5000/callback', 'http://localhost:5000/cb', 'http://[::1]:5000/cb']) {
      expect(agentRedirect(uri, MCP)).toBe('local');
    }
  });

  it("allows exactly this site's MCP server's callback", () => {
    expect(agentRedirect('https://mcp.example.org/oauth/callback', MCP)).toBe('hosted');
    expect(agentRedirect('https://mcp.example.org/oauth/callback', `${MCP}/`)).toBe('hosted');
  });

  it('refuses anything else', () => {
    for (const uri of [
      'https://example.org/callback',
      'https://127.0.0.1:5000/callback',
      'http://127.0.0.1.example.org/callback',
      'https://mcp.example.org/elsewhere',
      'https://mcp.example.org.evil.example/oauth/callback',
      'http://mcp.example.org/oauth/callback',
      'not a url',
    ]) {
      expect(agentRedirect(uri, MCP), uri).toBeNull();
    }
  });

  it('allows no hosted server when the site configures none', () => {
    expect(agentRedirect('https://mcp.example.org/oauth/callback', undefined)).toBeNull();
  });
});
