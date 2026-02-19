/**
 * PgyerAdapter — Pgyer (蒲公英) Test Distribution API v2
 *
 * Auth: API Key (_api_key param)
 * Docs: https://www.pgyer.com/doc/view/api
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

const BASE_URL = 'https://www.pgyer.com/apiv2';

export class PgyerAdapter extends AbstractStoreAdapter {
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
      storeId: 'pgyer',
      storeName: 'Pgyer',
      supportedFileTypes: ['apk', 'ipa'],
      supportsUpload: true,
      supportsListing: false,
      supportsReview: false,
      supportsAnalytics: false,
      supportsRollback: false,
      supportsStagedRollout: false,
      maxFileSizeMB: 4096,
      authMethod: 'apikey',
      requiresIcp: false,
    };
  }

  // --- Authentication ---

  async authenticate(): Promise<void> {
    await this.authManager.getToken('pgyer');
  }

  private getApiKey(): string {
    const config = this.authManager.getConfig('pgyer');
    return config['apiKey'] ?? config['_api_key'] ?? '';
  }

  // --- Upload ---

  async uploadBuild(params: UploadParams): Promise<UploadResult> {
    return this.withRetry(async () => {
      const apiKey = this.getApiKey();
      const fileBuffer = fs.readFileSync(params.filePath);
      const fileName = path.basename(params.filePath);

      const formData = new FormData();
      formData.append('_api_key', apiKey);
      formData.append('file', new Blob([fileBuffer]), fileName);
      if (params.releaseType) {
        formData.append('buildUpdateDescription', params.releaseType);
      }

      const resp = await this.client.post<{
        code: number;
        message: string;
        data?: {
          buildKey: string;
          buildVersion: string;
          buildBuildVersion: string;
          buildShortcutUrl: string;
        };
      }>('/app/upload', formData);

      if (resp.data.code !== 0) {
        throw new ShipKitError(
          `Pgyer upload failed: ${resp.data.message}`,
          'pgyer',
          'UPLOAD_FAILED',
          undefined,
          true,
        );
      }

      return {
        success: true,
        buildId: resp.data.data?.buildKey,
        storeRef: resp.data.data?.buildShortcutUrl,
        message: `Build uploaded to Pgyer (v${resp.data.data?.buildVersion})`,
      };
    }, 'uploadBuild');
  }

  // --- Release (not supported) ---

  async createRelease(_params: ReleaseParams): Promise<ReleaseResult> {
    return { success: false, message: 'Pgyer is a test distribution platform and does not support formal releases.' };
  }

  // --- Listing (not supported) ---

  async updateListing(_params: ListingParams): Promise<ListingResult> {
    return { success: false, message: 'Pgyer does not support listing management.' };
  }

  // --- Submit for Review (not supported) ---

  async submitForReview(_params: SubmitParams): Promise<SubmitResult> {
    return { success: false, message: 'Pgyer does not require review submission.' };
  }

  // --- Status ---

  async getStatus(appId: string): Promise<StatusResult> {
    return this.withRetry(async () => {
      const apiKey = this.getApiKey();

      const resp = await this.client.post<{
        code: number;
        message: string;
        data?: {
          buildVersion: string;
          buildBuildVersion: string;
          buildUpdated: string;
        };
      }>('/app/view', new URLSearchParams({
        _api_key: apiKey,
        appKey: appId,
      }).toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      if (resp.data.code !== 0) {
        throw new ShipKitError(
          `Pgyer status query failed: ${resp.data.message}`,
          'pgyer',
          'STATUS_FAILED',
        );
      }

      return {
        appId,
        storeName: 'Pgyer',
        currentVersion: resp.data.data?.buildVersion,
        reviewStatus: 'not_applicable',
        liveStatus: 'distributed',
        lastUpdated: resp.data.data?.buildUpdated,
      };
    }, 'getStatus');
  }

  // --- Analytics (not supported) ---

  async getAnalytics(_params: AnalyticsParams): Promise<AnalyticsResult> {
    return { success: false, message: 'Pgyer does not provide analytics API.' };
  }

  // --- Reviews (not supported) ---

  async getReviews(_params: ReviewListParams): Promise<ReviewItem[]> {
    return [];
  }

  // --- Rollback (not supported) ---

  async rollback(_params: RollbackParams): Promise<RollbackResult> {
    return { success: false, message: 'Pgyer does not support rollback.' };
  }
}
