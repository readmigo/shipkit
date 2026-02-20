/**
 * shipkit://guide/{topic} - Documentation resources for AI agents
 *
 * Provides structured guides that AI agents can read to understand
 * ShipKit workflows, credential formats, and troubleshooting steps.
 */

import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const GUIDES: Record<string, { title: string; content: string }> = {
  workflow: {
    title: 'ShipKit Publishing Workflow',
    content: JSON.stringify({
      overview: 'ShipKit follows a 6-step workflow to publish apps to any store.',
      steps: [
        {
          step: 1,
          tool: 'onboarding',
          action: 'Understand ShipKit and check setup status',
          when: 'First time using ShipKit',
        },
        {
          step: 2,
          tool: 'store.setup-guide',
          action: 'Get credential requirements for target store',
          when: 'Before configuring a new store',
        },
        {
          step: 3,
          tool: 'store.connect',
          action: 'Configure store credentials',
          when: 'Once per store (credentials are persisted)',
        },
        {
          step: 4,
          tool: 'publish.preflight',
          action: 'Verify readiness (credentials, file, environment, compliance)',
          when: 'Before every publish attempt',
        },
        {
          step: 5,
          tool: 'app.upload',
          action: 'Upload build artifact (IPA/APK/AAB)',
          when: 'When you have a signed build ready',
        },
        {
          step: 6,
          tool: 'app.publish',
          action: 'Create release, set listing, submit for review',
          when: 'After successful upload',
        },
      ],
      monitoring: [
        { tool: 'app.status', action: 'Check review progress across stores' },
        { tool: 'compliance.check', action: 'Verify China store compliance (ICP, privacy)' },
      ],
    }, null, 2),
  },

  credentials: {
    title: 'Store Credentials Reference',
    content: JSON.stringify({
      overview: 'Each store uses a different authentication method. Credentials are stored locally at ~/.shipkit/credentials/.',
      stores: {
        app_store: {
          auth: 'JWT (ES256)',
          needs: ['Key ID', 'Issuer ID', '.p8 private key file'],
          portal: 'https://appstoreconnect.apple.com/access/integrations/api',
        },
        google_play: {
          auth: 'OAuth2 Service Account',
          needs: ['Service Account JSON key file'],
          portal: 'https://play.google.com/console → Setup → API access',
        },
        huawei_agc: {
          auth: 'OAuth2 Client Credentials',
          needs: ['Client ID', 'Client Secret'],
          portal: 'https://developer.huawei.com/consumer/en/service/josp/agc/index.html',
        },
        xiaomi: { auth: 'RSA Signature', needs: ['RSA private key'], portal: 'https://dev.mi.com/' },
        oppo: { auth: 'OAuth Token', needs: ['Client Key', 'Client Secret'], portal: 'https://open.oppomobile.com/' },
        vivo: { auth: 'HMAC', needs: ['Access Key', 'Access Secret'], portal: 'https://dev.vivo.com.cn/' },
        honor: { auth: 'OAuth2', needs: ['Client ID', 'Client Secret'], portal: 'https://developer.honor.com/' },
        pgyer: { auth: 'API Key', needs: ['API Key'], portal: 'https://www.pgyer.com/' },
      },
    }, null, 2),
  },

  troubleshooting: {
    title: 'Troubleshooting Common Issues',
    content: JSON.stringify({
      issues: [
        {
          problem: 'IPA upload fails with "Failed to spawn xcrun"',
          cause: 'Xcode Command Line Tools not installed or not on macOS',
          fix: 'Run: xcode-select --install',
        },
        {
          problem: 'store.connect succeeds but app.upload returns auth error',
          cause: 'Credentials file format may be incorrect for the store',
          fix: 'Call store.setup-guide to verify the expected credential format',
        },
        {
          problem: 'Chinese store returns "ICP filing required"',
          cause: 'App lacks ICP (Internet Content Provider) filing for China distribution',
          fix: 'Obtain an ICP filing from MIIT, then add the ICP number to your app metadata',
        },
        {
          problem: 'Google Play upload returns 403 Forbidden',
          cause: 'Service Account missing "Release Manager" permission',
          fix: 'In Play Console → Setup → API access, grant the Service Account "Release Manager" role',
        },
        {
          problem: 'Apple JWT token expired',
          cause: 'ASC tokens are valid for max 20 minutes; ShipKit auto-refreshes but clock skew can cause issues',
          fix: 'Ensure system clock is synced (NTP). ShipKit refreshes tokens automatically.',
        },
        {
          problem: 'publish.preflight passes but app.upload fails',
          cause: 'Preflight checks credentials existence, not validity. Token may have been revoked.',
          fix: 'Re-run store.connect with fresh credentials.',
        },
      ],
    }, null, 2),
  },
};

const TOPIC_LIST = Object.entries(GUIDES).map(([topic, guide]) => ({
  uri: `shipkit://guide/${topic}`,
  name: guide.title,
}));

export function registerGuideResource(server: McpServer): void {
  server.registerResource(
    'guide',
    new ResourceTemplate('shipkit://guide/{topic}', {
      list: async () => ({
        resources: TOPIC_LIST.map((item) => ({
          uri: item.uri,
          name: item.name,
        })),
      }),
    }),
    {
      title: 'ShipKit Guide',
      description:
        'Documentation resources covering workflow, credentials, and troubleshooting. ' +
        'Available topics: workflow, credentials, troubleshooting.',
      mimeType: 'application/json',
    },
    async (uri, { topic }) => {
      const guide = GUIDES[topic as string];
      if (!guide) {
        return {
          contents: [{
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ error: `Unknown topic: ${topic}. Available: ${Object.keys(GUIDES).join(', ')}` }),
          }],
        };
      }

      return {
        contents: [{
          uri: uri.href,
          mimeType: 'application/json',
          text: guide.content,
        }],
      };
    },
  );
}
