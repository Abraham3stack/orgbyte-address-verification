import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const openapiPath = 'docs/openapi.yaml';

if (!existsSync(openapiPath)) {
  console.log('Skipped: docs/openapi.yaml does not exist yet (planned for Phase 3).');
  process.exit(0);
}

const result = spawnSync('npx', ['swagger-cli', 'validate', openapiPath], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

process.exit(result.status ?? 1);
