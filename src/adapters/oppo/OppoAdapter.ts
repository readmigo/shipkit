/**
 * OppoAdapter — OPPO Open Platform Publishing API
 *
 * Auth: OAuth2 Client Credentials
 * Token URL: https://oop-openapi-cn.heytapmobi.com/developer/v1/token
 * Docs: https://open.oppomobile.com/new/developmentDoc/info?id=11196
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

const BASE_URL = 'https://oop-openapi-cn.heytapmobi.com/developer/v1';

export class OppoAdapter extends AbstractStoreAdapter {
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
      storeId: 'oppo',
      storeName: 'OPPO App Market',
      supportedFileTypes: ['apk'],
      supportsUpload: true,
      supportsListing: false,
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
    await this.authManager.getToken('oppo');
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.authManager.getToken('oppo');
    return { Authorization: `Bearer ${token}` };
  }

  // --- Upload ---

  async uploadBuild(params: UploadParams): Promise<UploadResult> {
    return this.withRetry(async () => {
      const headers = await this.authHeaders();

      // Step 1: Get signed upload URL
      const urlResp = await this.client.get<{
        errno: number;
        data: { sign: string; upload_url: string };
      }>('/upload/upload-url', { headers });

      if (urlResp.data.errno !== 0) {
        throw new ShipKitError(
          'Failed to get OPPO upload URL',
          'oppo',
          'UPLOAD_URL_FAILED',
          undefined,
          true,
        );
      }

      const { upload_url, sign } = urlResp.data.data;

      // Step 2: PUT file to signed URL
      const fileBuffer = fs.readFileSync(params.filePath);
      const fileName = path.basename(params.filePath);
      const formData = new FormData();
      formData.append('file', new Blob([fileBuffer]), fileName);
      formData.append('sign', sign);

      const uploadResp = await axios.put<{
        errno: number;
        data: { url: string };
      }>(upload_url, formData);

      if (uploadResp.data.errno !== 0) {
        throw new ShipKitError(
          'OPPO file upload failed',
          'oppo',
          'FILE_UPLOAD_FAILED',
          undefined,
          true,
        );
      }

      return {
        success: true,
        buildId: sign,
        storeRef: uploadResp.data.data?.url,
        message: 'Build uploaded to OPPO',
      };
    }, 'uploadBuild');
  }

  // --- Release ---

  async createRelease(params: ReleaseParams): Promise<ReleaseResult> {
    return this.withRetry(async () => {
      const headers = await this.authHeaders();

      const resp = await this.client.post<{
        errno: number;
        data: Record<string, unknown>;
      }>('/app/update-app-info', {
        pkg_name: params.appId,
        version_name: params.versionName,
        update_desc: params.releaseNotes?.['zh-CN'] ?? params.releaseNotes?.['en-US'] ?? '',
      }, { headers });

      if (resp.data.errno !== 0) {
        throw new ShipKitError(
          'Failed to update OPPO app info',
          'oppo',
          'RELEASE_INFO_FAILED',
        );
      }

      return {
        success: true,
        releaseId: `oppo-${params.appId}-${params.versionName}`,
        status: 'prepared',
        message: 'Release info updated on OPPO. Call submitForReview to submit.',
      };
    }, 'createRelease');
  }

  // --- Listing (not supported) ---

  async updateListing(_params: ListingParams): Promise<ListingResult> {
    return { success: false, message: 'OPPO listing updates are done via createRelease.' };
  }

  // --- Submit for Review ---

  async submitForReview(params: SubmitParams): Promise<SubmitResult> {
    return this.withRetry(async () => {
      const headers = await this.authHeaders();

      const resp = await this.client.post<{
        errno: number;
        data: Record<string, unknown>;
      }>('/app/submit-audit', {
        pkg_name: params.appId,
      }, { headers });

      if (resp.data.errno !== 0) {
        throw new ShipKitError(
          'Failed to submit OPPO app for review',
          'oppo',
          'SUBMIT_FAILED',
        );
      }

      return {
        success: true,
        submissionId: `oppo-submit-${params.appId}`,
        message: 'Submitted for OPPO review',
      };
    }, 'submitForReview');
  }

  // --- Status ---

  async getStatus(appId: string): Promise<StatusResult> {
    return this.withRetry(async () => {
      const headers = await this.authHeaders();

      const resp = await this.client.get<{
        errno: number;
        data: {
          version_name: string;
          app_status: number;
          update_time: string;
        };
      }>('/app/info', {
        headers,
        params: { pkg_name: appId },
      });

      const statusMap: Record<number, string> = {
        0: 'draft',
        1: 'in_review',
        2: 'approved',
        3: 'rejected',
        4: 'live',
      };

      const info = resp.data.data;
      return {
        appId,
        storeName: 'OPPO App Market',
        currentVersion: info?.version_name,
        reviewStatus: statusMap[info?.app_status] ?? 'unknown',
        liveStatus: info?.app_status === 4 ? 'live' : 'not_live',
        lastUpdated: info?.update_time,
      };
    }, 'getStatus');
  }

  // --- Analytics (not supported) ---

  async getAnalytics(_params: AnalyticsParams): Promise<AnalyticsResult> {
    return { success: false, message: 'OPPO analytics API is not supported.' };
  }

  // --- Reviews (not supported) ---

  async getReviews(_params: ReviewListParams): Promise<ReviewItem[]> {
    return [];
  }

  // --- Rollback (not supported) ---

  async rollback(_params: RollbackParams): Promise<RollbackResult> {
    return { success: false, message: 'OPPO does not support automated rollback via API.' };
  }
}
