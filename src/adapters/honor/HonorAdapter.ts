/**
 * HonorAdapter — Honor Developer Connect API
 *
 * Auth: OAuth2 Client Credentials
 * Token URL: https://iam.developer.honor.com/auth/token
 * Mirrors Huawei AGC endpoint patterns
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import axios, { type AxiosInstance } from 'axios';
import {
  AbstractStoreAdapter,
  ShipKitError,
  type StoreCapabilities,
  type UploadParams,
  type UploadResult,
  type ReleaseParams,
  type ReleaseResult,
  type ListingParams,
  type ListingResult,
  type SubmitParams,
  type SubmitResult,
  type StatusResult,
  type AnalyticsParams,
  type AnalyticsResult,
  type ReviewListParams,
  type ReviewItem,
  type RollbackParams,
  type RollbackResult,
} from '../base/StoreAdapter.js';
import { AuthManager } from '../../auth/AuthManager.js';

const BASE_URL = 'https://connect-api.cloud.honor.com/api';

export class HonorAdapter extends AbstractStoreAdapter {
  private client: AxiosInstance;
  private authManager: AuthManager;

  constructor(authManager: AuthManager) {
    super();
    this.authManager = authManager;
    this.client = axios.create({ baseURL: BASE_URL });
  }

  // --- Capabilities ---

  getCapabilities(): StoreCapabilities {
    return {
      storeId: 'honor',
      storeName: 'Honor App Market',
      supportedFileTypes: ['apk', 'aab'],
      supportsUpload: true,
      supportsListing: true,
      supportsReview: false,
      supportsAnalytics: false,
      supportsRollback: false,
      supportsStagedRollout: false,
      maxFileSizeMB: 4096,
      authMethod: 'oauth2',
      requiresIcp: true,
    };
  }

  // --- Authentication ---

  async authenticate(): Promise<void> {
    await this.authManager.getToken('honor');
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.authManager.getToken('honor');
    return { Authorization: `Bearer ${token}` };
  }

  private getClientId(): string {
    const config = this.authManager.getConfig('honor');
    return config['clientId'] ?? config['client_id'] ?? '';
  }

  // --- Upload ---

  async uploadBuild(params: UploadParams): Promise<UploadResult> {
    return this.withRetry(async () => {
      const headers = await this.authHeaders();
      const suffix = params.fileType || 'apk';

      // Step 1: Get upload URL
      const urlResp = await this.client.get<{
        ret: { code: number; msg: string };
        uploadUrl: string;
        authCode: string;
      }>('/publish/v2/upload-url', {
        headers,
        params: {
          appId: params.appId,
          releaseType: 1,
          suffix,
        },
      });

      if (urlResp.data.ret.code !== 0) {
        throw new ShipKitError(
          `Failed to get Honor upload URL: ${urlResp.data.ret.msg}`,
          'honor',
          'UPLOAD_URL_FAILED',
          undefined,
          true,
        );
      }

      const uploadUrl = urlResp.data.uploadUrl;
      const authCode = urlResp.data.authCode;

      // Step 2: Upload file
      const fileBuffer = fs.readFileSync(params.filePath);
      const fileName = path.basename(params.filePath);
      const formData = new FormData();
      formData.append('file', new Blob([fileBuffer]), fileName);
      formData.append('authCode', authCode);
      formData.append('fileCount', '1');

      const uploadResp = await axios.post<{
        result: {
          UploadFileRsp: {
            ifSuccess: number;
            fileInfoList: Array<{ fileDestURI: string }>;
          };
        };
      }>(uploadUrl, formData);

      const uploadResult = uploadResp.data?.result?.UploadFileRsp;
      if (!uploadResult || uploadResult.ifSuccess !== 0 || !uploadResult.fileInfoList?.[0]?.fileDestURI) {
        throw new ShipKitError(
          'File upload to Honor storage failed',
          'honor',
          'FILE_UPLOAD_FAILED',
          undefined,
          true,
        );
      }

      const fileDestURI = uploadResult.fileInfoList[0].fileDestURI;

      // Step 3: Update app file info
      const fileInfoResp = await this.client.put<{
        ret: { code: number; msg: string };
      }>(
        '/publish/v2/app-file-info',
        {
          fileType: suffix === 'aab' ? 3 : 1,
          files: [{ fileName, fileDestUrl: fileDestURI }],
        },
        {
          headers,
          params: { appId: params.appId, releaseType: 1 },
        },
      );

      if (fileInfoResp.data.ret.code !== 0) {
        throw new ShipKitError(
          `Failed to update Honor file info: ${fileInfoResp.data.ret.msg}`,
          'honor',
          'FILE_INFO_FAILED',
          undefined,
          true,
        );
      }

      return {
        success: true,
        buildId: authCode,
        storeRef: `honor-${params.appId}`,
        message: 'Build uploaded to Honor',
      };
    }, 'uploadBuild');
  }

  // --- Release ---

  async createRelease(params: ReleaseParams): Promise<ReleaseResult> {
    return this.withRetry(async () => {
      const headers = await this.authHeaders();

      const resp = await this.client.put<{
        ret: { code: number; msg: string };
      }>(
        '/publish/v2/app-language-info',
        {
          lang: 'zh-CN',
          appName: params.versionName,
          newFeatures: params.releaseNotes?.['zh-CN'] ?? params.releaseNotes?.['en-US'] ?? '',
        },
        {
          headers,
          params: { appId: params.appId, releaseType: 1 },
        },
      );

      if (resp.data.ret.code !== 0) {
        throw new ShipKitError(
          `Failed to update Honor release info: ${resp.data.ret.msg}`,
          'honor',
          'RELEASE_INFO_FAILED',
        );
      }

      return {
        success: true,
        releaseId: `honor-${params.appId}-${params.versionName}`,
        status: 'prepared',
        message: 'Release info updated on Honor. Call submitForReview to submit.',
      };
    }, 'createRelease');
  }

  // --- Listing ---

  async updateListing(params: ListingParams): Promise<ListingResult> {
    return this.withRetry(async () => {
      const headers = await this.authHeaders();

      const body: Record<string, string> = { lang: params.locale };
      if (params.title) body.appName = params.title;
      if (params.shortDescription) body.briefInfo = params.shortDescription;
      if (params.fullDescription) body.appDesc = params.fullDescription;

      const resp = await this.client.put<{
        ret: { code: number; msg: string };
      }>(
        '/publish/v2/app-language-info',
        body,
        {
          headers,
          params: { appId: params.appId, releaseType: 1 },
        },
      );

      if (resp.data.ret.code !== 0) {
        throw new ShipKitError(
          `Failed to update Honor listing: ${resp.data.ret.msg}`,
          'honor',
          'LISTING_UPDATE_FAILED',
        );
      }

      return { success: true, message: `Listing updated for locale ${params.locale}` };
    }, 'updateListing');
  }

  // --- Submit for Review ---

  async submitForReview(params: SubmitParams): Promise<SubmitResult> {
    return this.withRetry(async () => {
      const headers = await this.authHeaders();

      const resp = await this.client.post<{
        ret: { code: number; msg: string };
      }>(
        '/publish/v2/app-submit',
        {},
        {
          headers,
          params: { appId: params.appId, releaseType: 1 },
        },
      );

      if (resp.data.ret.code !== 0) {
        throw new ShipKitError(
          `Failed to submit Honor app for review: ${resp.data.ret.msg}`,
          'honor',
          'SUBMIT_FAILED',
        );
      }

      return {
        success: true,
        submissionId: `honor-submit-${params.appId}`,
        message: 'Submitted for Honor review',
      };
    }, 'submitForReview');
  }

  // --- Status ---

  async getStatus(appId: string): Promise<StatusResult> {
    return this.withRetry(async () => {
      const headers = await this.authHeaders();

      const resp = await this.client.get<{
        ret: { code: number; msg: string };
        appInfo: {
          versionNumber: string;
          auditStatus: number;
          releaseState: number;
          updateTime: string;
        };
      }>('/publish/v2/app-info', {
        headers,
        params: { appId },
      });

      const info = resp.data.appInfo;
      const auditStatusMap: Record<number, string> = {
        0: 'draft',
        1: 'in_review',
        2: 'approved',
        3: 'rejected',
      };

      return {
        appId,
        storeName: 'Honor App Market',
        currentVersion: info?.versionNumber,
        reviewStatus: auditStatusMap[info?.auditStatus] ?? 'unknown',
        liveStatus: info?.releaseState === 1 ? 'live' : 'not_live',
        lastUpdated: info?.updateTime,
      };
    }, 'getStatus');
  }

  // --- Analytics (not supported) ---

  async getAnalytics(_params: AnalyticsParams): Promise<AnalyticsResult> {
    return { success: false, message: 'Honor analytics API is not supported.' };
  }

  // --- Reviews (not supported) ---

  async getReviews(_params: ReviewListParams): Promise<ReviewItem[]> {
    return [];
  }

  // --- Rollback (not supported) ---

  async rollback(_params: RollbackParams): Promise<RollbackResult> {
    return { success: false, message: 'Honor does not support automated rollback via API.' };
  }
}
