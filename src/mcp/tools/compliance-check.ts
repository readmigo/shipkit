/**
 * compliance.check - Pre-submission compliance checks
 *
 * Performs real dynamic validation against store-specific rules:
 * - Metadata checks: title/description length, privacy policy URL, screenshot count
 * - Artifact checks: file existence, size vs store maxFileSizeMB, extension validation
 * - Android artifact analysis via aapt2 (targetSdkVersion, dangerous permissions)
 * - Regulatory checks: ICP filing, PIPL compliance
 * - China market checks: App filing, software copyright, entity, server location,
 *   game license, industry license, security assessment, minor protection, data export
 */

import { existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { extname } from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getRegistry } from '../registry.js';

const STORE_IDS = [
  'google_play', 'app_store', 'huawei_agc',
  'xiaomi', 'oppo', 'vivo', 'honor',
] as const;

const CHECK_CATEGORIES = [
  'privacy_policy', 'data_collection', 'content_rating',
  'icp_filing', 'pipl_compliance', 'export_compliance',
  'age_rating', 'screenshots', 'listing_completeness',
  'artifact_validation',
  // China market specific
  'app_filing', 'software_copyright', 'china_entity', 'server_location',
  'game_license', 'industry_license', 'security_assessment', 'minor_protection',
  'data_export', 'store_specific',
] as const;

interface ComplianceCheckResult {
  store: string;
  category: string;
  status: 'pass' | 'warning' | 'fail';
  severity: 'blocker' | 'required' | 'advisory';
  message: string;
  suggestion?: string;
  reference_url?: string;
  estimated_time?: string;
}

// Stores that require ICP filing (Chinese domestic stores)
const ICP_REQUIRED_STORES = new Set(['huawei_agc', 'xiaomi', 'oppo', 'vivo', 'honor']);

// Store-specific title max lengths
const TITLE_MAX_LENGTH: Record<string, number> = {
  google_play: 50,
  app_store: 30,
  huawei_agc: 64,
  xiaomi: 64,
  oppo: 64,
  vivo: 64,
  honor: 64,
};

// Store-specific description max lengths
const DESCRIPTION_MAX_LENGTH: Record<string, number> = {
  google_play: 4000,
  app_store: 4000,
  huawei_agc: 8000,
  xiaomi: 4000,
  oppo: 4000,
  vivo: 4000,
  honor: 4000,
};

const DESCRIPTION_MIN_LENGTH = 10;
const MIN_SCREENSHOTS = 2;

// Valid file extensions per store family
const ANDROID_EXTENSIONS = new Set(['.apk', '.aab']);
const APPLE_EXTENSIONS = new Set(['.ipa']);
const HUAWEI_EXTENSIONS = new Set(['.apk', '.aab', '.hap']);

// Dangerous Android permissions that stores may flag
const DANGEROUS_PERMISSIONS = new Set([
  'android.permission.SEND_SMS',
  'android.permission.READ_CONTACTS',
  'android.permission.READ_CALL_LOG',
  'android.permission.WRITE_CALL_LOG',
  'android.permission.READ_PHONE_STATE',
  'android.permission.PROCESS_OUTGOING_CALLS',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.CAMERA',
  'android.permission.RECORD_AUDIO',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_BACKGROUND_LOCATION',
]);

const MetadataSchema = z.object({
  title: z.string().optional(),
  short_description: z.string().optional(),
  full_description: z.string().optional(),
  privacy_policy_url: z.string().optional(),
  screenshot_count: z.number().optional(),
}).optional();

export function registerComplianceCheckTool(server: McpServer): void {
  server.registerTool(
    'compliance.check',
    {
      title: 'Compliance Pre-Check',
      description:
        'Run compliance pre-checks before submitting an app for review. ' +
        'Checks privacy policy, ICP filing (Chinese stores), PIPL compliance, ' +
        'screenshot completeness, content rating, listing completeness, ' +
        'artifact validation, and China market regulatory requirements ' +
        '(App filing, software copyright, entity, server location, licenses). ' +
        'Returns pass/warning/fail with severity (blocker/required/advisory) for each check.',
      inputSchema: {
        app_id: z.string().describe('Application unique identifier'),
        stores: z
          .array(z.enum(STORE_IDS))
          .min(1)
          .describe('Target stores to check compliance for'),
        check_categories: z
          .array(z.enum(CHECK_CATEGORIES))
          .optional()
          .describe('Specific categories to check. Leave empty to run all checks.'),
        metadata: MetadataSchema.describe(
          'App metadata to validate (title, short_description, full_description, privacy_policy_url, screenshot_count)',
        ),
        artifact_path: z
          .string()
          .optional()
          .describe('Path to the build artifact (.apk, .aab, .ipa, .hap) to validate'),
        // China market compliance parameters
        app_filing_number: z
          .string()
          .optional()
          .describe('App 备案号（工信部）'),
        icp_number: z
          .string()
          .optional()
          .describe('ICP 备案号'),
        software_copyright_number: z
          .string()
          .optional()
          .describe('软件著作权登记号'),
        has_china_entity: z
          .boolean()
          .optional()
          .describe('是否拥有中国法人实体'),
        server_in_china: z
          .boolean()
          .optional()
          .describe('服务器是否部署在中国境内'),
        app_category: z
          .string()
          .optional()
          .describe('App 类别：game, social, finance, medical, news, education, ecommerce, entertainment, tool, other'),
        targets_minors: z
          .boolean()
          .optional()
          .describe('是否面向未成年人'),
        collects_personal_info: z
          .boolean()
          .optional()
          .describe('是否收集个人信息'),
        has_data_export: z
          .boolean()
          .optional()
          .describe('是否有数据出境需求'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      app_id,
      stores,
      check_categories,
      metadata,
      artifact_path,
      app_filing_number,
      icp_number,
      software_copyright_number,
      has_china_entity,
      server_in_china,
      app_category,
      targets_minors,
      collects_personal_info,
      has_data_export,
    }) => {
      const categories = check_categories ?? [...CHECK_CATEGORIES];
      const checks: ComplianceCheckResult[] = [];

      // Attempt to load registry for capability lookups (non-fatal if unavailable)
      let registry: Awaited<ReturnType<typeof getRegistry>> | null = null;
      try {
        registry = await getRegistry();
      } catch {
        // Registry unavailable — use fallback defaults
      }

      const chinaParams: ChinaComplianceParams = {
        app_filing_number,
        icp_number,
        software_copyright_number,
        has_china_entity,
        server_in_china,
        app_category,
        targets_minors,
        collects_personal_info,
        has_data_export,
      };

      for (const store of stores) {
        const capabilities = registry?.getCapabilities(store) ?? null;

        for (const category of categories) {
          const results = runCheck(store, category, metadata, artifact_path, capabilities, chinaParams);
          checks.push(...results);
        }
      }

      const failCount = checks.filter((c) => c.status === 'fail').length;
      const warnCount = checks.filter((c) => c.status === 'warning').length;
      const overall_status = failCount > 0 ? 'fail' : warnCount > 0 ? 'warning' : 'pass';

      const result = {
        app_id,
        overall_status,
        summary: {
          blockers: checks.filter((c) => c.severity === 'blocker' && c.status === 'fail'),
          required: checks.filter((c) => c.severity === 'required' && (c.status === 'fail' || c.status === 'warning')),
          advisory: checks.filter((c) => c.severity === 'advisory'),
        },
        checks,
        blocking_issues_count: failCount,
      };

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );
}

interface StoreCapabilitiesLike {
  maxFileSizeMB: number;
  supportedFileTypes: string[];
}

interface ChinaComplianceParams {
  app_filing_number?: string;
  icp_number?: string;
  software_copyright_number?: string;
  has_china_entity?: boolean;
  server_in_china?: boolean;
  app_category?: string;
  targets_minors?: boolean;
  collects_personal_info?: boolean;
  has_data_export?: boolean;
}

function runCheck(
  store: string,
  category: string,
  metadata?: { title?: string; short_description?: string; full_description?: string; privacy_policy_url?: string; screenshot_count?: number },
  artifactPath?: string,
  capabilities?: StoreCapabilitiesLike | null,
  chinaParams?: ChinaComplianceParams,
): ComplianceCheckResult[] {
  const results: ComplianceCheckResult[] = [];
  const isChinaStore = ICP_REQUIRED_STORES.has(store);

  // ─── ICP Filing ─────────────────────────────────────────────────────
  if (category === 'icp_filing') {
    if (isChinaStore) {
      if (chinaParams?.icp_number) {
        results.push({
          store,
          category,
          status: 'pass',
          severity: 'blocker',
          message: `ICP 备案号已提供: ${chinaParams.icp_number}`,
        });
      } else {
        results.push({
          store,
          category,
          status: 'fail',
          severity: 'blocker',
          message: 'ICP 备案是在中国提供互联网信息服务的法定要求。非经营性服务需 ICP 备案（免费），经营性服务需 ICP 经营许可证（注册资本 100 万元以上）。',
          suggestion: '访问 beian.miit.gov.cn 提交备案申请。经营性服务需向省级通信管理局申请 ICP 经营许可证。',
          reference_url: 'https://beian.miit.gov.cn/',
          estimated_time: '15-20 working days (备案) / 30-60 working days (许可证)',
        });
      }
    } else {
      results.push({ store, category, status: 'pass', severity: 'advisory', message: 'ICP filing not required for this store.' });
    }
    return results;
  }

  // ─── PIPL Compliance ────────────────────────────────────────────────
  if (category === 'pipl_compliance') {
    if (isChinaStore) {
      const collectsInfo = chinaParams?.collects_personal_info;
      results.push({
        store,
        category,
        status: collectsInfo === false ? 'pass' : 'warning',
        severity: 'advisory',
        message:
          'PIPL（个人信息保护法）合规要求：' +
          '(1) 处理个人信息须取得用户明示同意，实现独立同意弹窗；' +
          '(2) 实施"双清单"制度：已收集个人信息清单 + 第三方 SDK 共享清单；' +
          '(3) 敏感个人信息（生物特征、健康、金融、精准位置等）须单独同意；' +
          '(4) 违规处罚：最高 5000 万元人民币或上一年度营业额的 5%。',
        suggestion:
          '确保隐私政策包含数据收集目的、范围、存储期限、用户权利，并提供便捷的撤回同意渠道。' +
          '在 App 启动时展示隐私政策摘要弹窗，获取用户同意后再收集任何个人信息。',
        reference_url: 'https://www.gov.cn/xinwen/2021-08/20/content_5632486.htm',
      });
    } else {
      results.push({ store, category, status: 'pass', severity: 'advisory', message: 'PIPL compliance check not applicable for this store.' });
    }
    return results;
  }

  // ─── App Filing (备案) ─────────────────────────────────────────────
  if (category === 'app_filing') {
    if (isChinaStore) {
      if (chinaParams?.app_filing_number) {
        results.push({
          store,
          category,
          status: 'pass',
          severity: 'blocker',
          message: `App 备案号已提供: ${chinaParams.app_filing_number}`,
        });
      } else {
        results.push({
          store,
          category,
          status: 'fail',
          severity: 'blocker',
          message: 'App 备案是 2024 年 4 月起的强制要求，未备案应用将被清理下架。',
          suggestion: '通过网络接入服务提供者或应用分发平台提交备案申请，周期约 3-22 个工作日。',
          reference_url: 'https://beian.miit.gov.cn/',
          estimated_time: '3-22 working days',
        });
      }
    } else {
      results.push({ store, category, status: 'pass', severity: 'advisory', message: 'App filing not required for this store.' });
    }
    return results;
  }

  // ─── Software Copyright (软件著作权) ──────────────────────────────
  if (category === 'software_copyright') {
    if (isChinaStore) {
      if (chinaParams?.software_copyright_number) {
        results.push({
          store,
          category,
          status: 'pass',
          severity: 'blocker',
          message: `软件著作权登记号已提供: ${chinaParams.software_copyright_number}`,
        });
      } else {
        results.push({
          store,
          category,
          status: 'fail',
          severity: 'blocker',
          message: '软件著作权登记证书是中国 Android 应用商店的基本上架要求。',
          suggestion: '向中国版权保护中心（CCPA）申请软件著作权登记。网址：www.ccopyright.com.cn',
          reference_url: 'https://www.ccopyright.com.cn/',
          estimated_time: '40-60 working days',
        });
      }
    } else {
      results.push({ store, category, status: 'pass', severity: 'advisory', message: 'Software copyright registration not required for this store.' });
    }
    return results;
  }

  // ─── China Entity (中国法人实体) ──────────────────────────────────
  if (category === 'china_entity') {
    if (isChinaStore) {
      if (chinaParams?.has_china_entity === true) {
        results.push({
          store,
          category,
          status: 'pass',
          severity: 'blocker',
          message: '已确认拥有中国法人实体（营业执照）。',
        });
      } else {
        results.push({
          store,
          category,
          status: 'fail',
          severity: 'blocker',
          message: '中国应用商店要求开发者拥有中国法人实体（营业执照）。',
          suggestion:
            '选项: ' +
            '(A) 设立外商独资企业 WFOE（外商独资有限公司）；' +
            '(B) 与中国合作伙伴签订分发协议，由其代为发布；' +
            '(C) 使用第三方中国 App 发布服务商（如倍增服务）。',
          reference_url: 'https://www.samr.gov.cn/',
          estimated_time: '2-3 months (WFOE setup)',
        });
      }
    } else {
      results.push({ store, category, status: 'pass', severity: 'advisory', message: 'China entity requirement not applicable for this store.' });
    }
    return results;
  }

  // ─── Server Location (服务器位置) ─────────────────────────────────
  if (category === 'server_location') {
    if (isChinaStore) {
      if (chinaParams?.server_in_china === true) {
        results.push({
          store,
          category,
          status: 'pass',
          severity: 'blocker',
          message: '服务器已部署在中国境内。',
        });
      } else {
        results.push({
          store,
          category,
          status: 'fail',
          severity: 'blocker',
          message: '在中国提供服务的 App 必须使用中国境内服务器，域名须完成 ICP 备案。',
          suggestion:
            '使用中国境内云服务商部署服务：阿里云（aliyun.com）、腾讯云（cloud.tencent.com）、华为云（huaweicloud.com）。' +
            '同时确保相关域名已完成 ICP 备案。',
          reference_url: 'https://beian.miit.gov.cn/',
        });
      }
    } else {
      results.push({ store, category, status: 'pass', severity: 'advisory', message: 'Server location requirement not applicable for this store.' });
    }
    return results;
  }

  // ─── Game License (游戏版号) ──────────────────────────────────────
  if (category === 'game_license') {
    if (isChinaStore && chinaParams?.app_category === 'game') {
      results.push({
        store,
        category,
        status: 'fail',
        severity: 'required',
        message: '游戏 App 必须取得国家新闻出版署颁发的游戏版号（网络游戏出版物号）。',
        suggestion:
          '版号审批周期 6-12 个月。外资企业必须与持牌中国出版商合作申请。' +
          '未取得版号的游戏内测用户上限 2 万人，且禁止商业化运营。',
        reference_url: 'https://www.nppa.gov.cn/',
        estimated_time: '6-12 months',
      });
    } else if (isChinaStore) {
      results.push({
        store,
        category,
        status: 'pass',
        severity: 'required',
        message: 'Game license not required (app_category is not "game").',
      });
    } else {
      results.push({ store, category, status: 'pass', severity: 'required', message: 'Game license not applicable for this store.' });
    }
    return results;
  }

  // ─── Industry License (行业许可证) ────────────────────────────────
  if (category === 'industry_license') {
    if (isChinaStore && chinaParams?.app_category) {
      const licenseInfo = getIndustryLicenseInfo(chinaParams.app_category);
      if (licenseInfo) {
        results.push({
          store,
          category,
          status: 'warning',
          severity: 'required',
          message: licenseInfo.message,
          suggestion: licenseInfo.suggestion,
          reference_url: licenseInfo.reference_url,
        });
      } else {
        results.push({
          store,
          category,
          status: 'pass',
          severity: 'required',
          message: `No specific industry license required for app_category "${chinaParams.app_category}".`,
        });
      }
    } else if (isChinaStore) {
      results.push({
        store,
        category,
        status: 'warning',
        severity: 'required',
        message: '未指定 app_category，无法判断行业许可证要求。',
        suggestion: '提供 app_category 参数（如 game, social, finance, medical, news, education, ecommerce, entertainment）以获取精确的许可证要求。',
      });
    } else {
      results.push({ store, category, status: 'pass', severity: 'required', message: 'Industry license check not applicable for this store.' });
    }
    return results;
  }

  // ─── Security Assessment (安全评估) ──────────────────────────────
  if (category === 'security_assessment') {
    if (isChinaStore) {
      const sensitiveCategories = new Set(['finance', 'medical', 'education']);
      if (chinaParams?.app_category && sensitiveCategories.has(chinaParams.app_category)) {
        results.push({
          store,
          category,
          status: 'warning',
          severity: 'required',
          message: `${chinaParams.app_category} 类 App 可能需要通过网络安全等级保护测评（等保二级或三级）。`,
          suggestion: '联系有资质的等保测评机构进行等级保护测评，测评结果需报公安机关备案。',
          reference_url: 'https://www.mps.gov.cn/',
          estimated_time: '1-3 months',
        });
      } else {
        results.push({
          store,
          category,
          status: 'pass',
          severity: 'required',
          message: 'Security assessment not required for this app category.',
        });
      }
    } else {
      results.push({ store, category, status: 'pass', severity: 'required', message: 'Security assessment not applicable for this store.' });
    }
    return results;
  }

  // ─── Minor Protection (未成年人保护) ──────────────────────────────
  if (category === 'minor_protection') {
    if (isChinaStore) {
      results.push({
        store,
        category,
        status: 'warning',
        severity: 'advisory',
        message:
          '所有 App 须实施未成年人保护模式：' +
          '(1) 16 岁以下用户默认每天使用时长不超过 1 小时；' +
          '(2) 16-18 岁用户每天不超过 2 小时；' +
          '(3) 连续使用 30 分钟须提醒休息；' +
          '(4) 22:00 至次日 6:00 禁止未成年人使用。',
        suggestion:
          '在 App 内接入国家网信办"青少年模式"标准，或与应用商店平台的家长管控系统对接。' +
          (chinaParams?.targets_minors ? ' 注意：您的 App 面向未成年人，须严格执行上述限制。' : ''),
        reference_url: 'https://www.cac.gov.cn/',
      });
    } else {
      results.push({ store, category, status: 'pass', severity: 'advisory', message: 'Minor protection check not applicable for this store.' });
    }
    return results;
  }

  // ─── Data Export (数据出境) ───────────────────────────────────────
  if (category === 'data_export') {
    if (isChinaStore) {
      if (chinaParams?.has_data_export === true) {
        results.push({
          store,
          category,
          status: 'warning',
          severity: 'advisory',
          message:
            '数据出境须根据场景进行安全评估或签订标准合同：' +
            '(1) 数据达到重要数据或 100 万人个人信息门槛 → 需向网信办申请安全评估；' +
            '(2) 10 万人以上个人信息 → 需通过专业机构认证或签订标准合同；' +
            '(3) 以下场景可豁免：跨境购物、寄递、汇款、机票酒店预订、签证办理等必要数据传输。',
          suggestion:
            '评估数据出境规模和类型，选择适合的合规路径。建议委托法律顾问完成数据出境安全评估报告。',
          reference_url: 'https://www.cac.gov.cn/2022-07/07/c_1658811536396503.htm',
        });
      } else if (chinaParams?.has_data_export === false) {
        results.push({
          store,
          category,
          status: 'pass',
          severity: 'advisory',
          message: '已确认无数据出境需求，无需进行数据出境安全评估。',
        });
      } else {
        results.push({
          store,
          category,
          status: 'warning',
          severity: 'advisory',
          message: '未指定 has_data_export，无法确认数据出境合规状态。',
          suggestion: '提供 has_data_export 参数以进行数据出境合规检查。',
        });
      }
    } else {
      results.push({ store, category, status: 'pass', severity: 'advisory', message: 'Data export check not applicable for this store.' });
    }
    return results;
  }

  // ─── Store Specific Requirements ──────────────────────────────────
  if (category === 'store_specific') {
    const storeReq = getStoreSpecificRequirement(store);
    if (storeReq) {
      results.push({
        store,
        category,
        status: 'warning',
        severity: 'advisory',
        message: storeReq.message,
        suggestion: storeReq.suggestion,
      });
    } else {
      results.push({ store, category, status: 'pass', severity: 'advisory', message: 'No store-specific requirements for this store.' });
    }
    return results;
  }

  // ─── Privacy Policy ─────────────────────────────────────────────────
  if (category === 'privacy_policy') {
    if (!metadata?.privacy_policy_url) {
      results.push({
        store,
        category,
        status: 'fail',
        severity: 'blocker',
        message: 'Privacy policy URL is missing. All stores require a valid privacy policy.',
        suggestion: 'Provide a privacy_policy_url in metadata that starts with https://.',
      });
    } else if (!metadata.privacy_policy_url.startsWith('https://')) {
      results.push({
        store,
        category,
        status: 'fail',
        severity: 'blocker',
        message: `Privacy policy URL must use HTTPS. Got: ${metadata.privacy_policy_url}`,
        suggestion: 'Update your privacy policy URL to use https:// protocol.',
      });
    } else {
      results.push({ store, category, status: 'pass', severity: 'blocker', message: 'Privacy policy URL is present and uses HTTPS.' });
    }
    return results;
  }

  // ─── Screenshots ────────────────────────────────────────────────────
  if (category === 'screenshots') {
    if (metadata?.screenshot_count === undefined) {
      results.push({
        store,
        category,
        status: 'warning',
        severity: 'required',
        message: 'Screenshot count not provided. Cannot validate screenshot requirements.',
        suggestion: `Provide screenshot_count in metadata. Minimum ${MIN_SCREENSHOTS} screenshots required.`,
      });
    } else if (metadata.screenshot_count < MIN_SCREENSHOTS) {
      results.push({
        store,
        category,
        status: 'fail',
        severity: 'required',
        message: `Only ${metadata.screenshot_count} screenshot(s) provided. Minimum ${MIN_SCREENSHOTS} required for ${store}.`,
        suggestion: `Add at least ${MIN_SCREENSHOTS - metadata.screenshot_count} more screenshot(s).`,
      });
    } else {
      results.push({ store, category, status: 'pass', severity: 'required', message: `${metadata.screenshot_count} screenshots provided (minimum ${MIN_SCREENSHOTS}).` });
    }
    return results;
  }

  // ─── Listing Completeness ──────────────────────────────────────────
  if (category === 'listing_completeness') {
    // Title length check
    if (metadata?.title !== undefined) {
      const maxLen = TITLE_MAX_LENGTH[store] ?? 50;
      if (metadata.title.length === 0) {
        results.push({
          store,
          category,
          status: 'fail',
          severity: 'required',
          message: 'Title is empty.',
          suggestion: 'Provide a non-empty app title.',
        });
      } else if (metadata.title.length > maxLen) {
        results.push({
          store,
          category,
          status: 'fail',
          severity: 'required',
          message: `Title is ${metadata.title.length} chars, exceeds ${store} maximum of ${maxLen}.`,
          suggestion: `Shorten the title to ${maxLen} characters or fewer.`,
        });
      } else {
        results.push({ store, category, status: 'pass', severity: 'required', message: `Title length ${metadata.title.length}/${maxLen} is within limits.` });
      }
    }

    // Description length check
    const description = metadata?.full_description;
    if (description !== undefined) {
      const maxLen = DESCRIPTION_MAX_LENGTH[store] ?? 4000;
      if (description.length < DESCRIPTION_MIN_LENGTH) {
        results.push({
          store,
          category,
          status: 'fail',
          severity: 'required',
          message: `Description is ${description.length} chars, below minimum of ${DESCRIPTION_MIN_LENGTH}.`,
          suggestion: `Add more detail to reach at least ${DESCRIPTION_MIN_LENGTH} characters.`,
        });
      } else if (description.length > maxLen) {
        results.push({
          store,
          category,
          status: 'fail',
          severity: 'required',
          message: `Description is ${description.length} chars, exceeds ${store} maximum of ${maxLen}.`,
          suggestion: `Shorten the description to ${maxLen} characters or fewer.`,
        });
      } else {
        results.push({ store, category, status: 'pass', severity: 'required', message: `Description length ${description.length}/${maxLen} is within limits.` });
      }
    }

    // If no metadata fields to check, issue a general warning
    if (metadata?.title === undefined && metadata?.full_description === undefined) {
      results.push({
        store,
        category,
        status: 'warning',
        severity: 'required',
        message: 'No metadata provided to check listing completeness.',
        suggestion: 'Provide title and full_description in metadata for validation.',
      });
    }
    return results;
  }

  // ─── Artifact Validation ───────────────────────────────────────────
  if (category === 'artifact_validation') {
    if (!artifactPath) {
      results.push({
        store,
        category,
        status: 'warning',
        severity: 'required',
        message: 'No artifact_path provided. Skipping artifact validation.',
        suggestion: 'Provide artifact_path to validate the build file.',
      });
      return results;
    }

    // File existence
    if (!existsSync(artifactPath)) {
      results.push({
        store,
        category,
        status: 'fail',
        severity: 'blocker',
        message: `Artifact not found: ${artifactPath}`,
        suggestion: 'Verify the file path is correct and the build artifact exists.',
      });
      return results;
    }

    const ext = extname(artifactPath).toLowerCase();

    // Extension validation per store
    const validExtensions = getValidExtensions(store);
    if (!validExtensions.has(ext)) {
      results.push({
        store,
        category,
        status: 'fail',
        severity: 'blocker',
        message: `Invalid file extension "${ext}" for ${store}. Expected: ${[...validExtensions].join(', ')}`,
        suggestion: `Build your artifact with one of the supported extensions: ${[...validExtensions].join(', ')}`,
      });
    } else {
      results.push({ store, category, status: 'pass', severity: 'blocker', message: `File extension "${ext}" is valid for ${store}.` });
    }

    // File size check
    try {
      const fileStat = statSync(artifactPath);
      const fileSizeMB = fileStat.size / (1024 * 1024);
      const maxMB = capabilities?.maxFileSizeMB ?? getDefaultMaxFileSizeMB(store);

      if (fileSizeMB > maxMB) {
        results.push({
          store,
          category,
          status: 'fail',
          severity: 'blocker',
          message: `Artifact is ${fileSizeMB.toFixed(1)} MB, exceeds ${store} maximum of ${maxMB} MB.`,
          suggestion: `Reduce the build size below ${maxMB} MB. Consider enabling code shrinking or removing unused resources.`,
        });
      } else {
        results.push({
          store,
          category,
          status: 'pass',
          severity: 'blocker',
          message: `Artifact size ${fileSizeMB.toFixed(1)} MB is within the ${maxMB} MB limit.`,
        });
      }
    } catch {
      results.push({
        store,
        category,
        status: 'warning',
        severity: 'required',
        message: `Unable to read file size for ${artifactPath}.`,
      });
    }

    // aapt2 analysis for Android artifacts (APK/AAB) — uses execFileSync with
    // argument array to prevent shell injection (artifact path is never interpolated
    // into a shell command string)
    if (ANDROID_EXTENSIONS.has(ext)) {
      const aapt2Results = runAapt2Analysis(artifactPath, store);
      results.push(...aapt2Results);
    }

    return results;
  }

  // ─── Default checks (data_collection, content_rating, age_rating, export_compliance) ─
  // These require external data not available in params — return advisory status
  results.push({
    store,
    category,
    status: 'warning',
    severity: 'advisory',
    message: `${category} requires manual verification for ${store}.`,
    suggestion: `Review ${category.replace(/_/g, ' ')} requirements in ${store} developer console documentation.`,
  });
  return results;
}

interface IndustryLicenseInfo {
  message: string;
  suggestion: string;
  reference_url: string;
}

function getIndustryLicenseInfo(appCategory: string): IndustryLicenseInfo | null {
  switch (appCategory) {
    case 'game':
      return {
        message: '网络游戏须取得网络文化经营许可证（文网文）。',
        suggestion: '向省级文化和旅游厅申请网络文化经营许可证，经营网络游戏产品须持证经营。',
        reference_url: 'https://zwfw.mct.gov.cn/',
      };
    case 'social':
      return {
        message: '具有社交功能的 App 须向网信办提交安全评估报告（含用户生成内容、私信等功能）。',
        suggestion: '具备舆论属性或社会动员能力的平台须通过网信办安全评估后方可上线。',
        reference_url: 'https://www.cac.gov.cn/',
      };
    case 'finance':
      return {
        message: '金融类 App 须取得相应金融牌照：证券须中国证监会批准，基金销售须基金销售业务资格，支付须中国人民银行颁发支付业务许可证。',
        suggestion: '根据具体金融业务类型向对应监管机构申请牌照，无牌照不得开展相关金融业务。',
        reference_url: 'https://www.csrc.gov.cn/',
      };
    case 'medical':
      return {
        message: '医疗健康类 App 须取得互联网药品信息服务许可证（如涉及药品信息）或互联网医院牌照（如涉及诊疗服务）。',
        suggestion: '向省级食品药品监督管理局申请互联网药品信息服务许可证；互联网诊疗须向省级卫健委申请。',
        reference_url: 'https://www.nmpa.gov.cn/',
      };
    case 'news':
      return {
        message: '新闻资讯类 App 须取得互联网新闻信息服务许可证。',
        suggestion: '向国家互联网信息办公室或省级网信办申请互联网新闻信息服务许可证，未取得许可证不得从事互联网新闻信息服务。',
        reference_url: 'https://www.cac.gov.cn/',
      };
    case 'entertainment':
      return {
        message: '直播/视频娱乐类 App 须取得：(1) 网络文化经营许可证；(2) 广播电视节目制作经营许可证（如有原创视频内容）。',
        suggestion:
          '(1) 向省级文化和旅游厅申请网络文化经营许可证；' +
          '(2) 如开展网络直播或发布网络视听节目，须向广播电视主管部门申请相应资质。',
        reference_url: 'https://zwfw.mct.gov.cn/',
      };
    case 'ecommerce':
      return {
        message: '电子商务类 App 须取得 ICP 经营许可证（增值电信业务经营许可证 B2C 类）。',
        suggestion: '向省级通信管理局申请增值电信业务经营许可证（互联网信息服务），注册资本须达到 100 万元以上。',
        reference_url: 'https://beian.miit.gov.cn/',
      };
    default:
      return null;
  }
}

interface StoreSpecificRequirement {
  message: string;
  suggestion: string;
}

function getStoreSpecificRequirement(store: string): StoreSpecificRequirement | null {
  switch (store) {
    case 'huawei_agc':
      return {
        message: '华为应用市场特有要求：须提交免责函；可申请绿色应用认证提升推荐权重。',
        suggestion: '准备并上传华为免责函（需法人签字盖章）；如 App 质量达标可申请"绿色应用"认证。',
      };
    case 'xiaomi':
      return {
        message: '小米应用商店特有要求：仅支持企业开发者账号；首发应用须提前 4-5 个工作日申请首发资源。',
        suggestion: '确保已注册企业开发者账号；如需首发资源位，在上线前 4-5 个工作日联系小米运营团队申请。',
      };
    case 'oppo':
      return {
        message: 'OPPO 软件商店特有要求：须完成企业认证后方可提交应用。',
        suggestion: '在 OPPO 开放平台完成企业资质认证（营业执照、法人身份证等），认证通过后方可上传应用包。',
      };
    case 'vivo':
      return {
        message: 'vivo 应用商店特有要求：仅支持企业开发者账号；如需撤销审核或催审，须联系客服处理。',
        suggestion: '使用企业开发者账号提交；上架流程中如遇问题，通过 vivo 开发者平台工单系统联系客服。',
      };
    default:
      return null;
  }
}

function getValidExtensions(store: string): Set<string> {
  if (store === 'app_store') return APPLE_EXTENSIONS;
  if (store === 'huawei_agc') return HUAWEI_EXTENSIONS;
  // All Android stores (google_play, xiaomi, oppo, vivo, honor)
  return ANDROID_EXTENSIONS;
}

function getDefaultMaxFileSizeMB(store: string): number {
  switch (store) {
    case 'google_play': return 150;
    case 'app_store': return 4000;
    case 'huawei_agc': return 4096;
    default: return 500; // Conservative default for Chinese stores
  }
}

function runAapt2Analysis(artifactPath: string, store: string): ComplianceCheckResult[] {
  const results: ComplianceCheckResult[] = [];
  const category = 'artifact_validation';

  try {
    // execFileSync with argument array — no shell interpolation, safe from injection
    const output = execFileSync('aapt2', ['dump', 'badging', artifactPath], {
      encoding: 'utf-8',
      timeout: 15_000,
    });

    // Parse targetSdkVersion
    const targetSdkMatch = output.match(/targetSdkVersion:'(\d+)'/);
    if (targetSdkMatch) {
      const targetSdk = parseInt(targetSdkMatch[1], 10);
      if (targetSdk < 33) {
        results.push({
          store,
          category,
          status: 'warning',
          severity: 'required',
          message: `targetSdkVersion is ${targetSdk}. Google Play requires 33+ for new apps.`,
          suggestion: 'Update targetSdkVersion to 33 or higher in your build configuration.',
          reference_url: 'https://developer.android.com/google/play/requirements/target-sdk',
        });
      } else {
        results.push({
          store,
          category,
          status: 'pass',
          severity: 'required',
          message: `targetSdkVersion ${targetSdk} meets requirements.`,
        });
      }
    }

    // Parse dangerous permissions
    const permissionRegex = /uses-permission: name='([^']+)'/g;
    const dangerousFound: string[] = [];
    let match;
    while ((match = permissionRegex.exec(output)) !== null) {
      if (DANGEROUS_PERMISSIONS.has(match[1])) {
        dangerousFound.push(match[1]);
      }
    }

    if (dangerousFound.length > 0) {
      results.push({
        store,
        category,
        status: 'warning',
        severity: 'required',
        message: `Found ${dangerousFound.length} sensitive permission(s): ${dangerousFound.join(', ')}`,
        suggestion: 'Ensure each sensitive permission has a justified use case. Stores may reject apps with unnecessary sensitive permissions.',
      });
    } else {
      results.push({
        store,
        category,
        status: 'pass',
        severity: 'required',
        message: 'No sensitive permissions detected.',
      });
    }
  } catch {
    results.push({
      store,
      category,
      status: 'warning',
      severity: 'advisory',
      message: 'aapt2 not available or failed. Skipping Android artifact analysis.',
      suggestion: 'Install Android SDK build-tools and ensure aapt2 is on PATH for deeper APK/AAB inspection.',
    });
  }

  return results;
}
