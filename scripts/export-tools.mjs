import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { toolDefinitions } from '../lib/tools.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = process.env.PUBLIC_BASE_URL?.replace(/\/$/, '');
if (!base || !base.startsWith('https://')) { console.error('Set PUBLIC_BASE_URL to your publicly reachable HTTPS backend URL.'); process.exitCode = 1; }
else {
  const directory = join(root, 'vaani/generated');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'tool-schemas.json'), JSON.stringify(toolDefinitions, null, 2));
  for (const tool of toolDefinitions) {
    const body = Object.fromEntries(tool.parameters.required.map(key => {
      const prop = tool.parameters.properties[key];
      return [key, key === 'action_id' ? '{{unique_action_id}}' : prop.type === 'integer' ? 1 : prop.type === 'boolean' ? true : prop.enum?.[0] || `{{${key}}}`];
    }));
    // Intentionally export a placeholder rather than a secret into shareable tool documents.
    const curl = `# ${tool.name}\n# ${tool.description}\n# In Vaani, replace REPLACE_WITH_TOOL_API_KEY with TOOL_API_KEY from your .env.\n# Body values are illustrative. Configure the parameter schema using tool-schemas.json.\ncurl -X POST '${base}/api/tools/${tool.name}' \\\n  -H 'Authorization: Bearer REPLACE_WITH_TOOL_API_KEY' \\\n  -H 'Content-Type: application/json' \\\n  -d '${JSON.stringify(body)}'\n`;
    await writeFile(join(directory, `${tool.name}.curl.txt`), curl);
  }
  console.log(`Exported ${toolDefinitions.length} tool definitions and cURL import templates to vaani/generated/.\nImport each into Vaani Training > Tools, add the bearer secret in Vaani, and copy its description and full parameter schema. No secrets were written to these files.`);
}
