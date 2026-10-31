import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { vaaniRequest } from '../lib/vaani.mjs';
import { agentIdentity } from '../lib/agent-config.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
try {
  if (!process.env.VAANI_API_KEY) throw new Error('Set VAANI_API_KEY in .env first.');
  const prompt = await readFile(join(root, 'vaani/agent-prompt.md'), 'utf8');
  const identity = agentIdentity(prompt,process.env);
  let agentId = process.env.VAANI_AGENT_ID;
  if (agentId) {
    await vaaniRequest(`/api/agent/${encodeURIComponent(agentId)}/persona`, { identity }, 'PATCH');
  } else {
    const created = await vaaniRequest('/api/create-agent', { agent_display_name: 'Relay — Relief Coordination', config: { persona: { identity } } });
    agentId = created.agent_id || created.output?.agent_id;
    if (!agentId) throw new Error('Agent response did not include agent_id. Inspect your Vaani console before running setup again.');
    // Persist immediately so a subsequent configuration error cannot lose the created identity.
    await mkdir(join(root, 'vaani/generated'), { recursive: true });
    await writeFile(join(root, 'vaani/generated/agent.json'), JSON.stringify({ agent_id: agentId, created_at: new Date().toISOString() }, null, 2), { mode: 0o600 });
  }
  console.log(`Agent configured on Vaani.\nVAANI_AGENT_ID=${agentId}\n\nAdd this ID to .env and restart Relay. In Vaani: review STT/LLM/TTS providers, import the REST tools, assign an inbound number, configure webhook delivery, and publish. Setup does not invent or invoke an undocumented publish endpoint.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
