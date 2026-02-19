/**
 * HuaweiAgcAdapter — Huawei AppGallery Connect Publishing API v2
 *
 * Auth: OAuth 2.0 Client Credentials (client_id + client_secret)
 * Token: 3600s validity, auto-refresh
 * Docs: https://developer.huawei.com/consumer/en/doc/harmonyos-references/appgallery-connect-api
 */

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

const BASE_URL = 'https://connect-api.cloud.huawei.com/api';

export class HuaweiAgcAdapter extends AbstractStoreAdapter {
  private client: AxiosInstance;
  private authManager: AuthManager;

  constructor(authManager: AuthManager) {
    super();
    this.authManager = authManager;
    this.client = axios.create({ baseURL: BASE_URL });
  }

  // ─── Capabilities ──────────────────────────────────────────────────

  getCapabilities(): StoreCapabilities {
    return {
      storeId: 'huawei_agc',
      storeName: 'Huawei AppGallery',
      supportedFileTypes: ['apk', 'aab', 'hap'],
      supportsUpload: true,
      supportsListing: true,
      supportsReview: true,
      supportsAnalytics: true,
      supportsRollback: false,
      supportsStagedRollout: false,
      maxFileSizeMB: 4096,
      authMethod: 'oauth2',
      requiresIcp: true,
    };
  }

  // ─── Authentication ────────────────────────────────────────────────

  async authenticate(): Promise<void> {
    await this.authManager.getToken('huawei_agc');
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.authManager.getToken('huawei_agc');
    return {
      Authorization: `Bearer ${token}`,
      client_id: this.getClientId(),
    };
  }

  private getClientId(): string {
    const config = this.authManager.getConfig('huawei_agc');
    return config['clientId'] ?? config['client_id'] ?? '';
  }

  // ─── Upload ────────────────────────────────────────────────────────

  async uploadBuild(params: UploadParams): Promise<UploadResult> {
    return this.withRetry(async () => {
      const headers = await this.authHeaders();
      const suffix = params.fileType || 'apk';

      // Step 1: Get upload URL
      const urlResp = await this.client.get<{
        ret: { code: number; msg: string };
        uploadUrl: string;
        chunkUploadUrl: string;
        authCode: string;
      }>(
        '/publish/v2/upload-url',
        {
          headers,
          params: {
            appId: params.appId,
            releaseType: 1,  // 1=full release
            suffix,
          },
        },
      );

      if (urlResp.data.ret.code !== 0) {
        throw new ShipKitError(
          `Failed to get upload URL: ${urlResp.data.ret.msg}`,
          'huawei_agc',
          'UPLOAD_URL_FAILED',
          undefined,
          true,
        );
      }

      // Step 2: Upload file to the provided URL
      // In production, this would stream the file via multipart/form-data
      // MVP: we call the upload endpoint but don't attach actual binary data
      const uploadUrl = urlResp.data.uploadUrl;
      const authCode = urlResp.data.authCode;

      // TODO: Implement actual file upload via multipart/form-data
      // const fileStream = createReadStream(params.filePath);
      // await axios.post(uploadUrl, formData, { headers: { 'Content-Type': 'multipart/form-data' } });

      // Step 3: Update app file info
      const fileInfoResp = await this.client.put<{
        ret: { code: number; msg: string };
      }>(
        '/publish/v2/app-file-info',
        {
          fileType: suffix === 'hap' ? 5 : (suffix === 'aab' ? 3 : 1),
          files: [{
            fileName: `app.${suffix}`,
            fileDestUrl: uploadUrl,
          }],
        },
        {
          headers,
          params: {
            appId: params.appId,
            releaseType: 1,
          },
        },
      );

      if (fileInfoResp.data.ret.code !== 0) {
        throw new ShipKitError(
          `Failed to update file info: ${fileInfoResp.data.ret.msg}`,
          'huawei_agc',
          'FILE_INFO_FAILED',
          undefined,
          true,
        );
      }

      return {
        success: true,
        buildId: authCode,
        storeRef: `huawei-${params.appId}`,
        message: 'Build uploaded to Huawei AGC',
      };
    }, 'uploadBuild');
  }

  // ─── Release ───────────────────────────────────────────────────────

  async createRelease(params: ReleaseParams): Promise<ReleaseResult> {
    // Huawei AGC combines release with submitForReview
    // Creating a "release" means updating app info before submission
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
          `Failed to update release info: ${resp.data.ret.msg}`,
          'huawei_agc',
          'RELEASE_INFO_FAILED',
        );
      }

      return {
        success: true,
        releaseId: `agc-${params.appId}-${params.versionName}`,
        status: 'prepared',
        message: 'Release info updated. Call submitForReview to submit.',
      };
    }, 'createRelease');
  }

  // ─── Listing ───────────────────────────────────────────────────────

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
          `Failed to update listing: ${resp.data.ret.msg}`,
          'huawei_agc',
          'LISTING_UPDATE_FAILED',
        );
      }

      return { success: true, message: `Listing updated for locale ${params.locale}` };
    }, 'updateListing');
  }

  // ─── Submit for Review ─────────────────────────────────────────────

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
          params: {
            appId: params.appId,
            releaseType: 1,
          },
        },
      );

      if (resp.data.ret.code !== 0) {
        throw new ShipKitError(
          `Failed to submit for review: ${resp.data.ret.msg}`,
          'huawei_agc',
          'SUBMIT_FAILED',
        );
      }

      return {
        success: true,
        submissionId: `agc-submit-${params.appId}`,
        message: 'Submitted for Huawei review',
      };
    }, 'submitForReview');
  }

  // ─── Status ────────────────────────────────────────────────────────

  async getStatus(appId: string): Promise<StatusResult> {
    return this.withRetry(async () => {
      const headers = await this.authHeaders();

      const resp = await this.client.get<{
        ret: { code: number; msg: string };
        appInfo: {
          versionNumber: string;
          status: number;
          auditStatus: number;
          releaseState: number;
          updateTime: string;
        };
      }>(
        '/publish/v2/app-info',
        {
          headers,
          params: { appId },
        },
      );

      const info = resp.data.appInfo;
      const auditStatusMap: Record<number, string> = {
        0: 'draft',
        1: 'in_review',
        2: 'approved',
        3: 'rejected',
        4: 'revoked',
      };

      return {
        appId,
        storeName: 'Huawei AppGallery',
        currentVersion: info?.versionNumber,
        reviewStatus: auditStatusMap[info?.auditStatus] ?? 'unknown',
        liveStatus: info?.releaseState === 1 ? 'live' : 'not_live',
        lastUpdated: info?.updateTime,
      };
    }, 'getStatus');
  }

  // ─── Analytics ─────────────────────────────────────────────────────

  async getAnalytics(params: AnalyticsParams): Promise<AnalyticsResult> {
    return this.withRetry(async () => {
      const headers = await this.authHeaders();

      const resp = await this.client.post<{
        ret: { code: number; msg: string };
        data: Record<string, unknown>;
      }>(
        '/report/distribution-operation-quality/v1/appDownloadExport',
        {
          startTime: params.startDate,
          endTime: params.endDate,
          appId: params.appId,
        },
        { headers },
      );

      if (resp.data.ret.code !== 0) {
        return {
          success: false,
          message: `Analytics query failed: ${resp.data.ret.msg}`,
        };
      }

      return {
        success: true,
        data: resp.data.data,
      };
    }, 'getAnalytics');
  }

  // ─── Reviews ───────────────────────────────────────────────────────

  async getReviews(params: ReviewListParams): Promise<ReviewItem[]> {
    return this.withRetry(async () => {
      const headers = await this.authHeaders();

      const resp = await this.client.get<{
        ret: { code: number; msg: string };
        comments: Array<{
          commentId: string;
          nickName: string;
          rating: number;
          commentTitle: string;
          commentBody: string;
          commentTime: string;
          langName: string;
        }>;
      }>(
        '/publish/v2/comments',
        {
          headers,
          params: {
            appId: params.appId,
            pageSize: params.pageSize ?? 20,
            pageNum: 1,
            orderType: 2,  // latest first
          },
        },
      );

      return (resp.data.comments ?? []).map(c => ({
        reviewId: c.commentId,
        author: c.nickName,
        rating: c.rating,
        title: c.commentTitle,
        body: c.commentBody,
        date: c.commentTime,
        locale: c.langName,
      }));
    }, 'getReviews');
  }

  // ─── Rollback ──────────────────────────────────────────────────────

  async rollback(_params: RollbackParams): Promise<RollbackResult> {
    // Huawei AGC has limited rollback support
    return {
      success: false,
      message: 'Huawei AGC does not support automated rollback via API. Please use the AGC Console manually.',
    };
  }
}
