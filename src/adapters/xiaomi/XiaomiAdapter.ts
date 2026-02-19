/**
 * XiaomiAdapter — Xiaomi Developer Upload API
 *
 * Auth: RSA-SHA256 per-request signing
 * Base URL: https://api.developer.xiaomi.com/devupload
 * Docs: https://dev.mi.com/distribute/doc/details?pId=1134
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

const BASE_URL = 'https://api.developer.xiaomi.com/devupload';

export class XiaomiAdapter extends AbstractStoreAdapter {
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
      storeId: 'xiaomi',
      storeName: 'Xiaomi App Store',
      supportedFileTypes: ['apk'],
      supportsUpload: true,
      supportsListing: false,
      supportsReview: false,
      supportsAnalytics: false,
      supportsRollback: false,
      supportsStagedRollout: false,
      maxFileSizeMB: 4096,
      authMethod: 'rsa',
      requiresIcp: true,
    };
  }

  // --- Authentication ---

  async authenticate(): Promise<void> {
    // RSA signing is per-request; no persistent token needed
    await this.authManager.getToken('xiaomi');
  }

  private signParams(method: string, uri: string, params: Record<string, string>): Record<string, string> {
    const signature = this.authManager.signRequest('xiaomi', method, uri, params);
    return { ...params, sig: signature };
  }

  // --- Upload ---

  async uploadBuild(params: UploadParams): Promise<UploadResult> {
    return this.withRetry(async () => {
      const fileBuffer = fs.readFileSync(params.filePath);
      const fileName = path.basename(params.filePath);

      const baseParams: Record<string, string> = {
        appId: params.appId,
        fileName,
      };
      const signedParams = this.signParams('POST', '/dev/push', baseParams);

      const formData = new FormData();
      for (const [key, value] of Object.entries(signedParams)) {
        formData.append(key, value);
      }
      formData.append('apk', new Blob([fileBuffer]), fileName);

      const resp = await this.client.post<{
        result: number;
        message: string;
        data?: { packageName: string };
      }>('/dev/push', formData);

      if (resp.data.result !== 0) {
        throw new ShipKitError(
          `Xiaomi upload failed: ${resp.data.message}`,
          'xiaomi',
          'UPLOAD_FAILED',
          undefined,
          true,
        );
      }

      return {
        success: true,
        buildId: params.appId,
        storeRef: `xiaomi-${params.appId}`,
        message: 'Build uploaded to Xiaomi App Store',
      };
    }, 'uploadBuild');
  }

  // --- Release (not supported) ---

  async createRelease(_params: ReleaseParams): Promise<ReleaseResult> {
    return { success: false, message: 'Xiaomi does not have a separate release step. Upload triggers the process.' };
  }

  // --- Listing (not supported) ---

  async updateListing(_params: ListingParams): Promise<ListingResult> {
    return { success: false, message: 'Xiaomi listing is managed via the developer console.' };
  }

  // --- Submit for Review (not supported separately) ---

  async submitForReview(_params: SubmitParams): Promise<SubmitResult> {
    return { success: false, message: 'Xiaomi submission is triggered automatically on upload.' };
  }

  // --- Status ---

  async getStatus(appId: string): Promise<StatusResult> {
    return this.withRetry(async () => {
      const baseParams: Record<string, string> = { appId };
      const signedParams = this.signParams('GET', '/dev/query', baseParams);

      const resp = await this.client.get<{
        result: number;
        message: string;
        data?: {
          versionName: string;
          auditStatus: number;
          onlineStatus: number;
          updateTime: string;
        };
      }>('/dev/query', { params: signedParams });

      const info = resp.data.data;
      const auditStatusMap: Record<number, string> = {
        0: 'draft',
        1: 'in_review',
        2: 'approved',
        3: 'rejected',
      };

      return {
        appId,
        storeName: 'Xiaomi App Store',
        currentVersion: info?.versionName,
        reviewStatus: auditStatusMap[info?.auditStatus ?? 0] ?? 'unknown',
        liveStatus: info?.onlineStatus === 1 ? 'live' : 'not_live',
        lastUpdated: info?.updateTime,
      };
    }, 'getStatus');
  }

  // --- Analytics (not supported) ---

  async getAnalytics(_params: AnalyticsParams): Promise<AnalyticsResult> {
    return { success: false, message: 'Xiaomi analytics API is not supported.' };
  }

  // --- Reviews (not supported) ---

  async getReviews(_params: ReviewListParams): Promise<ReviewItem[]> {
    return [];
  }

  // --- Rollback (not supported) ---

  async rollback(_params: RollbackParams): Promise<RollbackResult> {
    return { success: false, message: 'Xiaomi does not support automated rollback via API.' };
  }
}
