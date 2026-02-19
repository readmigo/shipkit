/**
 * GooglePlayAdapter — Google Play Developer API v3 (Edit Workflow)
 *
 * Flow: edits.insert → upload bundle/apk → tracks.update → edits.commit
 * Auth: OAuth 2.0 Service Account
 * Docs: https://developers.google.com/android-publisher
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

const BASE_URL = 'https://androidpublisher.googleapis.com';

export class GooglePlayAdapter extends AbstractStoreAdapter {
  private client: AxiosInstance;
  private authManager: AuthManager;
  private currentEditId: string | null = null;

  constructor(authManager: AuthManager) {
    super();
    this.authManager = authManager;
    this.client = axios.create({ baseURL: BASE_URL });
  }

  // ─── Capabilities ──────────────────────────────────────────────────

  getCapabilities(): StoreCapabilities {
    return {
      storeId: 'google_play',
      storeName: 'Google Play',
      supportedFileTypes: ['apk', 'aab'],
      supportsUpload: true,
      supportsListing: true,
      supportsReview: true,
      supportsAnalytics: true,
      supportsRollback: true,
      supportsStagedRollout: true,
      maxFileSizeMB: 150,
      authMethod: 'oauth2',
      requiresIcp: false,
    };
  }

  // ─── Authentication ────────────────────────────────────────────────

  async authenticate(): Promise<void> {
    await this.authManager.getToken('google_play');
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.authManager.getToken('google_play');
    return { Authorization: `Bearer ${token}` };
  }

  // ─── Edit Helpers ──────────────────────────────────────────────────

  private async insertEdit(packageName: string): Promise<string> {
    const headers = await this.authHeaders();
    const resp = await this.client.post<{ id: string }>(
      `/androidpublisher/v3/applications/${packageName}/edits`,
      {},
      { headers },
    );
    return resp.data.id;
  }

  private async commitEdit(packageName: string, editId: string): Promise<void> {
    const headers = await this.authHeaders();
    await this.client.post(
      `/androidpublisher/v3/applications/${packageName}/edits/${editId}:commit`,
      {},
      { headers },
    );
  }

  // ─── Upload ────────────────────────────────────────────────────────

  async uploadBuild(params: UploadParams): Promise<UploadResult> {
    return this.withRetry(async () => {
      const editId = await this.insertEdit(params.appId);
      this.currentEditId = editId;

      const endpoint = params.fileType === 'aab' ? 'bundles' : 'apks';
      const headers = await this.authHeaders();

      // In production, this would upload the actual binary via multipart
      // MVP: we send the upload request metadata; actual file streaming is a TODO
      const resp = await this.client.post<{ versionCode: number }>(
        `/androidpublisher/v3/applications/${params.appId}/edits/${editId}/${endpoint}`,
        {},  // TODO: attach file via multipart/form-data
        {
          headers: {
            ...headers,
            'Content-Type': 'application/octet-stream',
          },
          params: { uploadType: 'media' },
        },
      );

      return {
        success: true,
        buildId: editId,
        storeRef: String(resp.data.versionCode),
      };
    }, 'uploadBuild');
  }

  // ─── Release ───────────────────────────────────────────────────────

  async createRelease(params: ReleaseParams): Promise<ReleaseResult> {
    return this.withRetry(async () => {
      const editId = this.currentEditId ?? await this.insertEdit(params.appId);
      const headers = await this.authHeaders();

      const release: Record<string, unknown> = {
        name: params.versionName,
        status: params.rolloutPercentage != null && params.rolloutPercentage < 1.0
          ? 'inProgress'
          : 'completed',
      };

      if (params.rolloutPercentage != null && params.rolloutPercentage < 1.0) {
        release.userFraction = params.rolloutPercentage;
      }

      if (params.releaseNotes) {
        release.releaseNotes = Object.entries(params.releaseNotes).map(
          ([language, text]) => ({ language, text }),
        );
      }

      await this.client.put(
        `/androidpublisher/v3/applications/${params.appId}/edits/${editId}/tracks/${params.track}`,
        {
          track: params.track,
          releases: [release],
        },
        { headers },
      );

      await this.commitEdit(params.appId, editId);
      this.currentEditId = null;

      return {
        success: true,
        releaseId: params.buildId,
        status: 'committed',
      };
    }, 'createRelease');
  }

  // ─── Listing ───────────────────────────────────────────────────────

  async updateListing(params: ListingParams): Promise<ListingResult> {
    return this.withRetry(async () => {
      const editId = this.currentEditId ?? await this.insertEdit(params.appId);
      const headers = await this.authHeaders();

      const body: Record<string, string> = {};
      if (params.title) body.title = params.title;
      if (params.shortDescription) body.shortDescription = params.shortDescription;
      if (params.fullDescription) body.fullDescription = params.fullDescription;

      await this.client.put(
        `/androidpublisher/v3/applications/${params.appId}/edits/${editId}/listings/${params.locale}`,
        body,
        { headers },
      );

      await this.commitEdit(params.appId, editId);
      this.currentEditId = null;

      return { success: true, message: `Listing updated for locale ${params.locale}` };
    }, 'updateListing');
  }

  // ─── Submit for Review ─────────────────────────────────────────────

  async submitForReview(params: SubmitParams): Promise<SubmitResult> {
    // Google Play auto-reviews on commit; no separate submit step
    return {
      success: true,
      message: 'Google Play auto-reviews upon edit commit. No separate submission needed.',
    };
  }

  // ─── Status ────────────────────────────────────────────────────────

  async getStatus(appId: string): Promise<StatusResult> {
    return this.withRetry(async () => {
      const editId = await this.insertEdit(appId);
      const headers = await this.authHeaders();

      const resp = await this.client.get<{
        track: string;
        releases: Array<{
          name?: string;
          status: string;
          versionCodes?: string[];
        }>;
      }>(
        `/androidpublisher/v3/applications/${appId}/edits/${editId}/tracks/production`,
        { headers },
      );

      // Clean up the edit (we were just reading)
      await this.client.delete(
        `/androidpublisher/v3/applications/${appId}/edits/${editId}`,
        { headers },
      );

      const latestRelease = resp.data.releases?.[0];

      return {
        appId,
        storeName: 'Google Play',
        currentVersion: latestRelease?.name,
        reviewStatus: latestRelease?.status ?? 'unknown',
        liveStatus: latestRelease?.status === 'completed' ? 'live' : 'pending',
      };
    }, 'getStatus');
  }

  // ─── Analytics ─────────────────────────────────────────────────────

  async getAnalytics(params: AnalyticsParams): Promise<AnalyticsResult> {
    // Google Play analytics are accessed via the Google Play Console API / BigQuery export
    // Not directly in the androidpublisher API. Return a stub.
    return {
      success: false,
      message: 'Google Play analytics require Google Play Console API or BigQuery export. Not available via androidpublisher API.',
    };
  }

  // ─── Reviews ───────────────────────────────────────────────────────

  async getReviews(params: ReviewListParams): Promise<ReviewItem[]> {
    return this.withRetry(async () => {
      const headers = await this.authHeaders();

      const resp = await this.client.get<{
        reviews: Array<{
          reviewId: string;
          authorName: string;
          comments: Array<{
            userComment: {
              text: string;
              starRating: number;
              lastModified: { seconds: string };
            };
          }>;
        }>;
      }>(
        `/androidpublisher/v3/applications/${params.appId}/reviews`,
        {
          headers,
          params: {
            maxResults: params.pageSize ?? 20,
            token: params.pageToken,
          },
        },
      );

      return (resp.data.reviews ?? []).map(r => {
        const comment = r.comments[0]?.userComment;
        return {
          reviewId: r.reviewId,
          author: r.authorName,
          rating: comment?.starRating ?? 0,
          body: comment?.text ?? '',
          date: comment?.lastModified?.seconds
            ? new Date(Number(comment.lastModified.seconds) * 1000).toISOString()
            : new Date().toISOString(),
        };
      });
    }, 'getReviews');
  }

  // ─── Rollback ──────────────────────────────────────────────────────

  async rollback(params: RollbackParams): Promise<RollbackResult> {
    return this.withRetry(async () => {
      const editId = await this.insertEdit(params.appId);
      const headers = await this.authHeaders();
      const track = params.track ?? 'production';

      // Halt the current staged rollout (set status to halted)
      await this.client.put(
        `/androidpublisher/v3/applications/${params.appId}/edits/${editId}/tracks/${track}`,
        {
          track,
          releases: [{
            status: 'halted',
            versionCodes: params.targetVersionCode ? [params.targetVersionCode] : [],
          }],
        },
        { headers },
      );

      await this.commitEdit(params.appId, editId);

      return {
        success: true,
        message: `Rollout halted on track ${track}`,
      };
    }, 'rollback');
  }
}
