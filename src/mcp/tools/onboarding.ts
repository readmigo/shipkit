/**
 * onboarding - First-time user guide and workflow overview
 */

import { z } from 'zod';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const CREDENTIALS_DIR = join(homedir(), '.shipkit', 'credentials');

const STORE_IDS = [
  'google_play', 'app_store', 'huawei_agc',
  'xiaomi', 'oppo', 'vivo', 'honor', 'pgyer',
] as const;

function isStoreConnected(storeId: string): boolean {
  return (
    existsSync(join(CREDENTIALS_DIR, `${storeId}.json`)) &&
    existsSync(join(CREDENTIALS_DIR, `${storeId}.credentials`))
  );
}

export function registerOnboardingTool(server: McpServer): void {
  server.registerTool(
    'onboarding',
    {
      title: 'Getting Started with ShipKit',
      description:
        'Start here. Returns a quick-start guide, the recommended workflow, ' +
        'and the current setup status of all stores. ' +
        'Call this tool first to understand how ShipKit works.',
      inputSchema: {
        locale: z
          .enum(['en', 'zh'])
          .optional()
          .describe('Guide language: "en" for English, "zh" for Chinese. Defaults to "en".'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ locale }) => {
      const lang = locale ?? 'en';

      const connectedStores = STORE_IDS.filter(isStoreConnected);
      const disconnectedStores = STORE_IDS.filter((s) => !isStoreConnected(s));

      const guide = lang === 'zh' ? buildGuideZh(connectedStores, disconnectedStores)
        : buildGuideEn(connectedStores, disconnectedStores);

      return {
        content: [{ type: 'text' as const, text: guide }],
      };
    },
  );
}

function buildGuideEn(connected: string[], disconnected: string[]): string {
  return JSON.stringify({
    welcome: 'Welcome to ShipKit — Unified App Publishing MCP Server',
    status: {
      connected_stores: connected.length > 0 ? connected : 'none',
      disconnected_stores: disconnected,
    },
    workflow: {
      step_1: {
        action: 'store.setup-guide',
        description: 'Get credential requirements for your target store',
        example: { store_id: 'app_store' },
      },
      step_2: {
        action: 'store.connect',
        description: 'Configure store credentials',
        example: { store_id: 'app_store', auth_type: 'api_key', credentials_path: '/path/to/AuthKey.p8' },
      },
      step_3: {
        action: 'publish.preflight',
        description: 'Verify everything is ready before publishing',
        example: { store_id: 'app_store', app_id: '1234567890', file_path: '/path/to/app.ipa' },
      },
      step_4: {
        action: 'app.upload',
        description: 'Upload your build artifact (IPA/APK/AAB)',
      },
      step_5: {
        action: 'app.release',
        description: 'Create a new release version',
      },
      step_6: {
        action: 'app.publish',
        description: 'Submit for review and publish',
      },
    },
    tips: [
      'Call store.list to see all 8 supported stores and their platforms.',
      'Call store.setup-guide with a store_id to get specific credential instructions.',
      'Call publish.preflight before publishing to catch issues early.',
      'iOS upload requires macOS with Xcode Command Line Tools.',
      'Chinese stores require ICP filing — use compliance.check to verify.',
    ],
  }, null, 2);
}

function buildGuideZh(connected: string[], disconnected: string[]): string {
  return JSON.stringify({
    welcome: '欢迎使用 ShipKit — 统一应用发布 MCP 服务',
    status: {
      已连接商店: connected.length > 0 ? connected : '无',
      未连接商店: disconnected,
    },
    workflow: {
      '步骤1_查看凭证要求': {
        tool: 'store.setup-guide',
        说明: '查看目标商店的凭证格式和配置步骤',
        示例: { store_id: 'app_store' },
      },
      '步骤2_配置凭证': {
        tool: 'store.connect',
        说明: '配置商店账号凭证',
        示例: { store_id: 'app_store', auth_type: 'api_key', credentials_path: '/path/to/AuthKey.p8' },
      },
      '步骤3_发布前检查': {
        tool: 'publish.preflight',
        说明: '发布前一次性检查凭证、文件、环境、合规',
        示例: { store_id: 'app_store', app_id: '1234567890', file_path: '/path/to/app.ipa' },
      },
      '步骤4_上传构建': { tool: 'app.upload', 说明: '上传 IPA/APK/AAB 文件' },
      '步骤5_创建版本': { tool: 'app.release', 说明: '创建新版本' },
      '步骤6_提交发布': { tool: 'app.publish', 说明: '提交审核并发布' },
    },
    提示: [
      '调用 store.list 查看全部 8 个支持的商店。',
      '调用 store.setup-guide 获取特定商店的凭证配置指南。',
      '发布前调用 publish.preflight 提前发现问题。',
      'iOS 上传需要 macOS 且安装 Xcode Command Line Tools。',
      '中国商店需要 ICP 备案 — 用 compliance.check 检查。',
    ],
  }, null, 2);
}
