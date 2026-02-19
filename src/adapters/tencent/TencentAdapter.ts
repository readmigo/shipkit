/**
 * TencentAdapter — Tencent MyApp (应用宝) Open Platform API
 *
 * Auth: AppKey + AppSecret HMAC-MD5 per-request signing
 * Base URL: https://api.open.qq.com
 * Docs: https://wiki.open.qq.com/
 *
 * NOTE: Specific endpoint paths and request schemas are based on public
 * documentation and may require verification against the actual API.
 * TODO: Validate all endpoint paths and response schemas against the
 * official Tencent MyApp Open Platform documentation before production use.
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

// TODO: Confirm base URL path with official Tencent MyApp Open Platform docs
const BASE_URL = 'https://api.open.qq.com';

export class TencentAdapter extends AbstractStoreAdapter {
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
      storeId: 'tencent_myapp',
      storeName: 'Tencent MyApp (应用宝)',
      supportedFileTypes: ['apk'],
      supportsUpload: true,
      supportsListing: false,
      supportsReview: false,
      supportsAnalytics: false,
      supportsRollback: false,
      supportsStagedRollout: false,
      maxFileSizeMB: 500,
      authMethod: 'apikey',
      requiresIcp: true,
    };
  }

  // --- Authentication ---

  async authenticate(): Promise<void> {
    // Per-request signing via AppKey + AppSecret; no persistent token needed
    await this.authManager.getToken('tencent_myapp');
  }

  private getAppKey(): string {
    const config = this.authManager.getConfig('tencent_myapp');
    return config['appKey'] ?? config['app_key'] ?? '';
  }

  private signParams(params: Record<string, string>): Record<string, string> {
    // Tencent Open Platform uses sorted key=value pairs joined with &, then HMAC signed
    const signature = this.authManager.signRequest('tencent_myapp', 'POST', '', params);
    return { ...params, sig: signature };
  }

  // --- Upload ---

  /**
   * Upload APK to Tencent MyApp.
   *
   * IMPORTANT: Tencent MyApp requires apps to be hardened (加固) before upload.
   * Use Tencent Legu (乐固) or a compatible hardening service prior to calling
   * this method. Unhardened APKs will be rejected during review.
   *
   * TODO: Verify the exact multipart field names and endpoint path against
   * the official Tencent MyApp Open Platform upload documentation.
   */
  async uploadBuild(params: UploadParams): Promise<UploadResult> {
    return this.withRetry(async () => {
      const fileBuffer = fs.readFileSync(params.filePath);
      const fileName = path.basename(params.filePath);

      const baseParams: Record<string, string> = {
        app_key: this.getAppKey(),
        timestamp: String(Math.floor(Date.now() / 1000)),
        pkg_name: params.appId,
      };
      const signedParams = this.signParams(baseParams);

      const formData = new FormData();
      for (const [key, value] of Object.entries(signedParams)) {
        formData.append(key, value);
      }
      // TODO: Confirm multipart field name for APK file ('apk_file' or 'file')
      formData.append('apk_file', new Blob([fileBuffer]), fileName);

      // TODO: Confirm endpoint path for APK upload
      const resp = await this.client.post<{
        ret: number;
        msg: string;
        data?: { apk_id: string; version_code: string };
      }>('/app/upload', formData);

      if (resp.data.ret !== 0) {
        throw new ShipKitError(
          `Tencent MyApp upload failed: ${resp.data.msg}`,
          'tencent_myapp',
          'UPLOAD_FAILED',
          undefined,
          true,
        );
      }

      return {
        success: true,
        buildId: resp.data.data?.apk_id,
        storeRef: `tencent-myapp-${params.appId}`,
        message:
          'Build uploaded to Tencent MyApp (应用宝). Note: APK must be hardened (加固) before upload or it will be rejected during review.',
      };
    }, 'uploadBuild');
  }

  // --- Submit for Review ---

  /**
   * Submit the uploaded build for Tencent MyApp review.
   *
   * TODO: Confirm endpoint path and required fields against official docs.
   */
  async submitForReview(params: SubmitParams): Promise<SubmitResult> {
    return this.withRetry(async () => {
      const baseParams: Record<string, string> = {
        app_key: this.getAppKey(),
        timestamp: String(Math.floor(Date.now() / 1000)),
        pkg_name: params.appId,
      };
      const signedParams = this.signParams(baseParams);

      // TODO: Confirm endpoint path for review submission
      const resp = await this.client.post<{
        ret: number;
        msg: string;
      }>('/app/submit', new URLSearchParams(signedParams).toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      if (resp.data.ret !== 0) {
        throw new ShipKitError(
          `Tencent MyApp submit failed: ${resp.data.msg}`,
          'tencent_myapp',
          'SUBMIT_FAILED',
        );
      }

      return {
        success: true,
        submissionId: `tencent-myapp-submit-${params.appId}`,
        message: 'Submitted for Tencent MyApp (应用宝) review',
      };
    }, 'submitForReview');
  }

  // --- Status ---

  /**
   * Query the current review and live status from Tencent MyApp.
   *
   * TODO: Confirm endpoint path, response field names, and status code
   * meanings against official Tencent MyApp Open Platform documentation.
   */
  async getStatus(appId: string): Promise<StatusResult> {
    return this.withRetry(async () => {
      const baseParams: Record<string, string> = {
        app_key: this.getAppKey(),
        timestamp: String(Math.floor(Date.now() / 1000)),
        pkg_name: appId,
      };
      const signedParams = this.signParams(baseParams);

      // TODO: Confirm endpoint path for status query
      const resp = await this.client.post<{
        ret: number;
        msg: string;
        data?: {
          version_name: string;
          audit_status: number;
          update_time: string;
        };
      }>('/app/info', new URLSearchParams(signedParams).toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      const info = resp.data.data;
      // TODO: Verify these status code mappings with official documentation
      const statusMap: Record<number, string> = {
        0: 'draft',
        1: 'in_review',
        2: 'live',
        3: 'rejected',
        4: 'removed',
      };

      const status = info?.audit_status ?? 0;
      return {
        appId,
        storeName: 'Tencent MyApp (应用宝)',
        currentVersion: info?.version_name,
        reviewStatus: statusMap[status] ?? 'unknown',
        liveStatus: status === 2 ? 'live' : 'not_live',
        lastUpdated: info?.update_time,
      };
    }, 'getStatus');
  }

  // --- Release (not supported separately) ---

  async createRelease(_params: ReleaseParams): Promise<ReleaseResult> {
    return {
      success: false,
      message: 'Tencent MyApp does not have a separate release step; uploading the APK via uploadBuild and calling submitForReview triggers the review process.',
    };
  }

  // --- Listing (not supported) ---

  async updateListing(_params: ListingParams): Promise<ListingResult> {
    return {
      success: false,
      message: 'Tencent MyApp does not support programmatic listing updates via API. Please manage store listing through the Tencent Open Platform console.',
    };
  }

  // --- Analytics (not supported) ---

  async getAnalytics(_params: AnalyticsParams): Promise<AnalyticsResult> {
    return { success: false, message: 'Tencent MyApp analytics API is not supported.' };
  }

  // --- Reviews (not supported) ---

  async getReviews(_params: ReviewListParams): Promise<ReviewItem[]> {
    return [];
  }

  // --- Rollback (not supported) ---

  async rollback(_params: RollbackParams): Promise<RollbackResult> {
    return { success: false, message: 'Tencent MyApp does not support automated rollback via API.' };
  }
}
