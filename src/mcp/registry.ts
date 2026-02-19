/**
 * Adapter registry singleton
 * Auto-loads credentials from ~/.shipkit/credentials/ for all connected stores.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { AuthManager, type AuthCredentials } from '../auth/AuthManager.js';
import { AdapterRegistry } from '../adapters/AdapterRegistry.js';

const CREDENTIALS_DIR = join(homedir(), '.shipkit', 'credentials');

interface StoreMetadata {
  store_id: string;
  auth_type: 'service_account' | 'api_key' | 'jwt' | 'oauth';
  config: Record<string, string>;
}

let _registry: AdapterRegistry | null = null;
let _credentialsMtime: number = 0;

export function invalidateRegistry(): void {
  _registry = null;
}

export async function getRegistry(): Promise<AdapterRegistry> {
  // Check if credentials directory has been modified since last build
  if (_registry) {
    try {
      const stat = statSync(CREDENTIALS_DIR);
      const mtime = stat.mtimeMs;
      if (mtime > _credentialsMtime) {
        _registry = null;
      }
    } catch {
      // Directory doesn't exist yet — keep cached registry
    }
  }

  if (_registry) return _registry;

  const authManager = new AuthManager();

  if (existsSync(CREDENTIALS_DIR)) {
    const files = readdirSync(CREDENTIALS_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const metaRaw = await readFile(join(CREDENTIALS_DIR, file), 'utf-8');
        const meta = JSON.parse(metaRaw) as StoreMetadata;
        const credPath = join(CREDENTIALS_DIR, `${meta.store_id}.credentials`);
        if (!existsSync(credPath)) continue;

        const credFileContent = await readFile(credPath, 'utf-8');
        const creds = buildCredentials(meta, credPath, credFileContent);
        authManager.setCredentials(meta.store_id, creds);
      } catch {
        // skip corrupt credential files
      }
    }
  }

  _registry = AdapterRegistry.createDefault(authManager);

  // Record credentials mtime so we can detect external changes
  try {
    _credentialsMtime = statSync(CREDENTIALS_DIR).mtimeMs;
  } catch {
    _credentialsMtime = 0;
  }

  return _registry;
}

function buildCredentials(
  meta: StoreMetadata,
  credPath: string,
  credFileContent: string,
): AuthCredentials {
  switch (meta.auth_type) {
    case 'service_account':
      return { type: 'oauth2', config: { serviceAccountJson: credPath } };

    case 'jwt': {
      return {
        type: 'jwt',
        config: {
          privateKeyPath: credPath,
          keyId: meta.config['key_id'] ?? '',
          issuerId: meta.config['issuer_id'] ?? '',
        },
      };
    }

    case 'oauth': {
      let credData: Record<string, string> = {};
      try { credData = JSON.parse(credFileContent) as Record<string, string>; } catch {}
      return {
        type: 'oauth2',
        config: {
          clientId: credData['client_id'] ?? credData['clientId'] ?? meta.config['client_id'] ?? '',
          clientSecret: credData['client_secret'] ?? credData['clientSecret'] ?? '',
          tokenUrl: credData['token_url'] ?? credData['tokenUrl'] ??
            'https://connect-api.cloud.huawei.com/api/oauth2/v1/token',
        },
      };
    }

    case 'api_key': {
      let credData: Record<string, string> = {};
      try { credData = JSON.parse(credFileContent) as Record<string, string>; } catch {}
      return {
        type: 'apikey',
        config: {
          apiKey: credData['api_key'] ?? credData['apiKey'] ?? meta.config['api_key'] ?? '',
        },
      };
    }
  }
}
