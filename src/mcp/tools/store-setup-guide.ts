/**
 * store.setup-guide - Credential requirements and setup instructions per store
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

interface StoreSetupGuide {
  store_id: string;
  store_name: string;
  auth_type: string;
  platform: string;
  prerequisites: string[];
  credentials_format: Record<string, string>;
  setup_steps: string[];
  store_connect_example: Record<string, unknown>;
  docs_url: string;
}

const GUIDES: Record<string, StoreSetupGuide> = {
  app_store: {
    store_id: 'app_store',
    store_name: 'Apple App Store',
    auth_type: 'api_key (JWT ES256)',
    platform: 'iOS',
    prerequisites: [
      'Apple Developer Program membership ($99/year)',
      'macOS with Xcode Command Line Tools (for IPA upload via xcrun altool)',
      'An App Store Connect API Key (.p8 file)',
    ],
    credentials_format: {
      keyId: 'Your API Key ID (e.g. ABC123DEF4) — shown in App Store Connect',
      issuerId: 'Your Issuer ID (UUID) — shown at the top of the API Keys page',
      privateKeyPath: 'Absolute path to the downloaded .p8 private key file',
    },
    setup_steps: [
      '1. Go to https://appstoreconnect.apple.com/access/integrations/api',
      '2. Click "+" to generate a new API key',
      '3. Choose "Admin" or "App Manager" role',
      '4. Download the .p8 file (you can only download it once!)',
      '5. Note the Key ID and Issuer ID from the page',
      '6. Create a credentials JSON file with the format shown below',
      '7. Call store.connect with the file path',
    ],
    store_connect_example: {
      store_id: 'app_store',
      auth_type: 'api_key',
      credentials_path: '/path/to/apple-credentials.json',
      config: {
        key_id: 'YOUR_KEY_ID',
        issuer_id: 'YOUR_ISSUER_ID',
      },
    },
    docs_url: 'https://developer.apple.com/documentation/appstoreconnectapi/creating_api_keys_for_app_store_connect_api',
  },

  google_play: {
    store_id: 'google_play',
    store_name: 'Google Play',
    auth_type: 'service_account (OAuth2)',
    platform: 'Android',
    prerequisites: [
      'Google Play Developer account ($25 one-time)',
      'Google Cloud project linked to Play Console',
      'Service Account with "Release Manager" role',
    ],
    credentials_format: {
      type: '"service_account"',
      project_id: 'Your GCP project ID',
      private_key_id: 'Auto-generated key ID',
      private_key: 'RSA private key (in the JSON file)',
      client_email: 'service-account@project.iam.gserviceaccount.com',
    },
    setup_steps: [
      '1. Go to Google Play Console → Setup → API access',
      '2. Link or create a Google Cloud project',
      '3. Create a Service Account with "Release Manager" permission',
      '4. In Google Cloud Console, create a JSON key for the Service Account',
      '5. Download the JSON key file',
      '6. Call store.connect with the JSON file path',
    ],
    store_connect_example: {
      store_id: 'google_play',
      auth_type: 'service_account',
      credentials_path: '/path/to/service-account.json',
    },
    docs_url: 'https://developers.google.com/android-publisher/getting_started',
  },

  huawei_agc: {
    store_id: 'huawei_agc',
    store_name: 'Huawei AppGallery Connect',
    auth_type: 'oauth (Client Credentials)',
    platform: 'Android',
    prerequisites: [
      'Huawei Developer account (free)',
      'App created in AppGallery Connect',
      'API Client with appropriate permissions',
    ],
    credentials_format: {
      clientId: 'AppGallery Connect API Client ID',
      clientSecret: 'AppGallery Connect API Client Secret',
    },
    setup_steps: [
      '1. Go to https://developer.huawei.com/consumer/en/service/josp/agc/index.html',
      '2. Navigate to Users and permissions → API key → Connect API',
      '3. Create an API client, choose "Team Admin" role',
      '4. Note the Client ID and Client Secret',
      '5. Create a credentials JSON file with clientId and clientSecret',
      '6. Call store.connect with the file path',
    ],
    store_connect_example: {
      store_id: 'huawei_agc',
      auth_type: 'oauth',
      credentials_path: '/path/to/huawei-credentials.json',
      config: {
        client_id: 'YOUR_CLIENT_ID',
      },
    },
    docs_url: 'https://developer.huawei.com/consumer/en/doc/AppGallery-connect-Guides/agcapi-getstarted-0000001111845114',
  },

  xiaomi: {
    store_id: 'xiaomi',
    store_name: 'Xiaomi GetApps (小米应用商店)',
    auth_type: 'rsa (RSA Signature)',
    platform: 'Android (China)',
    prerequisites: [
      'Xiaomi Developer account',
      'Enterprise or Individual developer verification',
      'ICP filing for the app',
    ],
    credentials_format: {
      privateKey: 'RSA private key for request signing',
      account: 'Xiaomi developer account email',
    },
    setup_steps: [
      '1. Register at https://dev.mi.com/',
      '2. Complete developer identity verification',
      '3. Go to Management → API Access to get your RSA key pair',
      '4. Create a credentials JSON file with the private key',
      '5. Call store.connect with the file path',
    ],
    store_connect_example: {
      store_id: 'xiaomi',
      auth_type: 'service_account',
      credentials_path: '/path/to/xiaomi-credentials.json',
    },
    docs_url: 'https://dev.mi.com/distribute/doc/details?pId=1134',
  },

  oppo: {
    store_id: 'oppo',
    store_name: 'OPPO App Market (OPPO 软件商店)',
    auth_type: 'oauth (Token)',
    platform: 'Android (China)',
    prerequisites: [
      'OPPO Developer account',
      'Enterprise verification completed',
      'ICP filing for the app',
    ],
    credentials_format: {
      clientKey: 'OPPO Open Platform Client Key',
      clientSecret: 'OPPO Open Platform Client Secret',
    },
    setup_steps: [
      '1. Register at https://open.oppomobile.com/',
      '2. Complete enterprise verification',
      '3. Go to Management → API credentials',
      '4. Create a credentials JSON file with clientKey and clientSecret',
      '5. Call store.connect with the file path',
    ],
    store_connect_example: {
      store_id: 'oppo',
      auth_type: 'oauth',
      credentials_path: '/path/to/oppo-credentials.json',
    },
    docs_url: 'https://open.oppomobile.com/new/developmentDoc/info?id=11538',
  },

  vivo: {
    store_id: 'vivo',
    store_name: 'vivo App Store (vivo 应用商店)',
    auth_type: 'apikey (API Key + HMAC)',
    platform: 'Android (China)',
    prerequisites: [
      'vivo Developer account',
      'Enterprise verification completed',
      'ICP filing for the app',
    ],
    credentials_format: {
      accessKey: 'vivo Open Platform Access Key',
      accessSecret: 'vivo Open Platform Access Secret',
    },
    setup_steps: [
      '1. Register at https://dev.vivo.com.cn/',
      '2. Complete enterprise verification',
      '3. Go to Management → Open Platform Keys',
      '4. Create a credentials JSON file with accessKey and accessSecret',
      '5. Call store.connect with the file path',
    ],
    store_connect_example: {
      store_id: 'vivo',
      auth_type: 'api_key',
      credentials_path: '/path/to/vivo-credentials.json',
    },
    docs_url: 'https://dev.vivo.com.cn/documentCenter/doc/326',
  },

  honor: {
    store_id: 'honor',
    store_name: 'Honor App Market (荣耀应用市场)',
    auth_type: 'oauth (Client Credentials)',
    platform: 'Android (China)',
    prerequisites: [
      'Honor Developer account',
      'Enterprise verification completed',
      'ICP filing for the app',
    ],
    credentials_format: {
      clientId: 'Honor Developer API Client ID',
      clientSecret: 'Honor Developer API Client Secret',
    },
    setup_steps: [
      '1. Register at https://developer.honor.com/',
      '2. Complete enterprise verification',
      '3. Navigate to API Management to create credentials',
      '4. Create a credentials JSON file with clientId and clientSecret',
      '5. Call store.connect with the file path',
    ],
    store_connect_example: {
      store_id: 'honor',
      auth_type: 'oauth',
      credentials_path: '/path/to/honor-credentials.json',
    },
    docs_url: 'https://developer.honor.com/cn/doc/guides/100359',
  },

  pgyer: {
    store_id: 'pgyer',
    store_name: 'Pgyer (蒲公英)',
    auth_type: 'apikey',
    platform: 'Android / iOS (China, testing)',
    prerequisites: [
      'Pgyer account (free tier available)',
      'API Key from account settings',
    ],
    credentials_format: {
      apiKey: 'Pgyer API Key from account settings',
    },
    setup_steps: [
      '1. Register at https://www.pgyer.com/',
      '2. Go to Account Settings → API Information',
      '3. Copy your API Key',
      '4. Create a credentials JSON file with the apiKey field',
      '5. Call store.connect with the file path',
    ],
    store_connect_example: {
      store_id: 'pgyer',
      auth_type: 'api_key',
      credentials_path: '/path/to/pgyer-credentials.json',
    },
    docs_url: 'https://www.pgyer.com/doc/view/api#fastUploadApp',
  },
};

export function registerStoreSetupGuideTool(server: McpServer): void {
  server.registerTool(
    'store.setup-guide',
    {
      title: 'Store Setup Guide',
      description:
        'Get detailed credential requirements, setup steps, and configuration examples ' +
        'for a specific app store. Call this before store.connect to know exactly what credentials ' +
        'you need and how to obtain them.',
      inputSchema: {
        store_id: z
          .enum(['google_play', 'app_store', 'huawei_agc', 'xiaomi', 'oppo', 'vivo', 'honor', 'pgyer'])
          .describe('The store to get setup instructions for'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ store_id }) => {
      const guide = GUIDES[store_id];
      if (!guide) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: `Unknown store: ${store_id}` }),
          }],
        };
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(guide, null, 2),
        }],
      };
    },
  );
}
