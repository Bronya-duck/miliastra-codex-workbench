import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--node', '--data'].includes(args[i]) || !args[i + 1]) throw new Error('Usage: node scripts/configure.mjs [--node <executable>] [--data <directory>]');
  options[args[i]] = args[i + 1];
}
const config = { mcpServers: { miliastra: {
  command: options['--node'] || process.execPath,
  args: [path.join(root, 'runtime/server.mjs')],
  cwd: path.join(root, 'runtime'),
  env: { MILIASTRA_DATA_DIR: path.resolve(options['--data'] || path.join(root, 'data')) },
} } };
const output = path.join(root, 'plugin/.mcp.json');
fs.writeFileSync(output, JSON.stringify(config, null, 2) + '\n');
console.log(JSON.stringify({ configured: true, file: output, data: config.mcpServers.miliastra.env.MILIASTRA_DATA_DIR, generated_configuration_is_private: true }));
