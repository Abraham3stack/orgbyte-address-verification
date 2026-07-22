import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const openapiPath = 'docs/openapi.yaml';

if (!existsSync(openapiPath)) {
  console.error('OpenAPI validation failed: docs/openapi.yaml is required from Phase 3 onward.');
  process.exit(1);
}

const result = spawnSync('npx', ['swagger-cli', 'validate', openapiPath], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

process.exit(result.status ?? 1);
