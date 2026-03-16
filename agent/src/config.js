// Shared config loader — reads config.json once and exports it.

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = join(__dirname, '..', 'config.json');

let _config = null;

export function getConfig() {
  if (!_config) {
    _config = JSON.parse(readFileSync(configPath, 'utf-8'));
  }
  return _config;
}
