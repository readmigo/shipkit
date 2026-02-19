/**
 * VivoAdapter — vivo Developer Platform API
 *
 * Auth: HMAC-SHA256 per-request signing
 * Base URL: https://developer-api.vivo.com.cn/router/rest
 * Docs: https://dev.vivo.com.cn/documentCenter/doc/326
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

const BASE_URL = 'https://developer-api.vivo.com.cn/router/rest';

export class VivoAdapter extends AbstractStoreAdapter {
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
      storeId: 'vivo',
      storeName: 'vivo App Store',
      supportedFileTypes: ['apk'],
      supportsUpload: true,
      supportsListing: false,
      supportsReview: false,
      supportsAnalytics: false,
      supportsRollback: false,
      supportsStagedRollout: false,
      maxFileSizeMB: 4096,
      authMethod: 'hmac',
      requiresIcp: true,
    };
  }

  // --- Authentication ---

  async authenticate(): Promise<void> {
    // HMAC signing is per-request; no persistent token needed
    await this.authManager.getToken('vivo');
  }

  private getAccessKey(): string {
    const config = this.authManager.getConfig('vivo');
    return config['accessKey'] ?? config['access_key'] ?? '';
  }

  private signParams(params: Record<string, string>): Record<string, string> {
    const sortedEntries = Object.entries(params).sort(([a], [b]) => a.localeCompare(b));
    const message = sortedEntries.map(([k, v]) => `${k}=${v}`).join('&');
    const signature = this.authManager.generateHmacSignature('vivo', message);
    return { ...params, sign: signature };
  }

  // --- Upload ---

  async uploadBuild(params: UploadParams): Promise<UploadResult> {
    return this.withRetry(async () => {
      const fileBuffer = fs.readFileSync(params.filePath);
      const fileName = path.basename(params.filePath);

      const baseParams: Record<string, string> = {
        method: 'app.upload.apk.app',
        access_key: this.getAccessKey(),
        timestamp: String(Date.now()),
        packageName: params.appId,
      };
      const signedParams = this.signParams(baseParams);

      const formData = new FormData();
      for (const [key, value] of Object.entries(signedParams)) {
        formData.append(key, value);
      }
      formData.append('file', new Blob([fileBuffer]), fileName);

      const resp = await this.client.post<{
        code: number;
        msg: string;
        data?: { serialnumber: string };
      }>('', formData);

      if (resp.data.code !== 0) {
        throw new ShipKitError(
          `vivo upload failed: ${resp.data.msg}`,
          'vivo',
          'UPLOAD_FAILED',
          undefined,
          true,
        );
      }

      return {
        success: true,
        buildId: resp.data.data?.serialnumber,
        storeRef: `vivo-${params.appId}`,
        message: 'Build uploaded to vivo App Store',
      };
    }, 'uploadBuild');
  }

  // --- Release (not supported separately) ---

  async createRelease(_params: ReleaseParams): Promise<ReleaseResult> {
    return {
      success: false,
      message: 'vivo does not have a separate release step; uploading the APK via uploadBuild triggers the review process automatically.',
    };
  }

  // --- Listing (not supported) ---

  async updateListing(_params: ListingParams): Promise<ListingResult> {
    return {
      success: false,
      message: 'vivo does not support programmatic listing updates via API. Please manage store listing through the vivo Developer Console at https://dev.vivo.com.cn.',
    };
  }

  // --- Submit for Review ---

  async submitForReview(params: SubmitParams): Promise<SubmitResult> {
    return this.withRetry(async () => {
      const baseParams: Record<string, string> = {
        method: 'app.sync.update.app',
        access_key: this.getAccessKey(),
        timestamp: String(Date.now()),
        packageName: params.appId,
      };
      const signedParams = this.signParams(baseParams);

      const resp = await this.client.post<{
        code: number;
        msg: string;
      }>('', new URLSearchParams(signedParams).toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      if (resp.data.code !== 0) {
        throw new ShipKitError(
          `vivo submit for review failed: ${resp.data.msg}`,
          'vivo',
          'SUBMIT_FAILED',
        );
      }

      return {
        success: true,
        submissionId: `vivo-submit-${params.appId}`,
        message: 'Submitted for vivo review',
      };
    }, 'submitForReview');
  }

  // --- Status ---

  async getStatus(appId: string): Promise<StatusResult> {
    return this.withRetry(async () => {
      const baseParams: Record<string, string> = {
        method: 'app.query.task.status',
        access_key: this.getAccessKey(),
        timestamp: String(Date.now()),
        packageName: appId,
      };
      const signedParams = this.signParams(baseParams);

      const resp = await this.client.post<{
        code: number;
        msg: string;
        data?: {
          versionName: string;
          status: number;
          updateTime: string;
        };
      }>('', new URLSearchParams(signedParams).toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      const info = resp.data.data;
      // vivo status codes per developer documentation:
      // 0 = draft, 1 = in_review, 2 = approved/live, 3 = rejected, 4 = removed
      const statusMap: Record<number, string> = {
        0: 'draft',
        1: 'in_review',
        2: 'live',
        3: 'rejected',
        4: 'removed',
      };

      const status = info?.status ?? 0;
      return {
        appId,
        storeName: 'vivo App Store',
        currentVersion: info?.versionName,
        reviewStatus: statusMap[status] ?? 'unknown',
        liveStatus: status === 2 ? 'live' : 'not_live',
        lastUpdated: info?.updateTime,
      };
    }, 'getStatus');
  }

  // --- Analytics (not supported) ---

  async getAnalytics(_params: AnalyticsParams): Promise<AnalyticsResult> {
    return { success: false, message: 'vivo analytics API is not supported.' };
  }

  // --- Reviews (not supported) ---

  async getReviews(_params: ReviewListParams): Promise<ReviewItem[]> {
    return [];
  }

  // --- Rollback (not supported) ---

  async rollback(_params: RollbackParams): Promise<RollbackResult> {
    return { success: false, message: 'vivo does not support automated rollback via API.' };
  }
}
