/**
 * GooglePlayAdapter — Google Play Developer API v3 (Edit Workflow)
 *
 * Flow: edits.insert → upload bundle/apk → tracks.update → edits.commit
 * Auth: OAuth 2.0 Service Account
 * Docs: https://developers.google.com/android-publisher
 */

import fs from 'node:fs';
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
  type GetListingParams,
  type GetListingResult,
  type PromoteReleaseParams,
  type SetRolloutParams,
  type ResumeReleaseParams,
  type ReleaseManagementResult,
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

  private async deleteEdit(packageName: string, editId: string): Promise<void> {
    const headers = await this.authHeaders();
    await this.client.delete(
      `/androidpublisher/v3/applications/${packageName}/edits/${editId}`,
      { headers },
    );
  }

  // ─── Upload ────────────────────────────────────────────────────────

  async uploadBuild(params: UploadParams): Promise<UploadResult> {
    return this.withRetry(async () => {
      if (!fs.existsSync(params.filePath)) {
        throw new ShipKitError(`File not found: ${params.filePath}`, 'google_play', 'UPLOAD_FAILED');
      }

      const editId = await this.insertEdit(params.appId);
      this.currentEditId = editId;

      const endpoint = params.fileType === 'aab' ? 'bundles' : 'apks';
      const headers = await this.authHeaders();
      const fileSize = fs.statSync(params.filePath).size;

      const initResp = await axios.post(
        `https://www.googleapis.com/upload/androidpublisher/v3/applications/${params.appId}/edits/${editId}/${endpoint}`,
        null,
        {
          headers: {
            ...headers,
            'Content-Type': 'application/octet-stream',
            'X-Upload-Content-Type': 'application/octet-stream',
            'X-Upload-Content-Length': String(fileSize),
          },
          params: { uploadType: 'resumable' },
          maxRedirects: 0,
          validateStatus: (status: number) => status === 200,
        },
      );

      const sessionUri = initResp.headers['location'];
      if (!sessionUri) {
        throw new ShipKitError('No upload session URI returned', 'google_play', 'UPLOAD_FAILED');
      }

      const fileStream = fs.createReadStream(params.filePath);
      const resp = await axios.put<{ versionCode: number }>(
        sessionUri,
        fileStream,
        {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(fileSize),
          },
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        },
      );

      return {
        success: true,
        buildId: String(resp.data.versionCode),
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

  // ─── Get Listing ─────────────────────────────────────────────────

  async getListing(params: GetListingParams): Promise<GetListingResult> {
    return this.withRetry(async () => {
      const editId = await this.insertEdit(params.appId);
      const headers = await this.authHeaders();
      const locale = params.locale ?? 'en-US';

      try {
        const resp = await this.client.get<{
          language: string;
          title?: string;
          fullDescription?: string;
          shortDescription?: string;
        }>(
          `/androidpublisher/v3/applications/${params.appId}/edits/${editId}/listings/${locale}`,
          { headers },
        );

        await this.deleteEdit(params.appId, editId);

        return {
          success: true,
          listing: {
            title: resp.data.title,
            description: resp.data.fullDescription,
            shortDescription: resp.data.shortDescription,
            locale: resp.data.language,
          },
        };
      } catch (err) {
        await this.deleteEdit(params.appId, editId).catch(() => {});
        throw err;
      }
    }, 'getListing');
  }

  // ─── Promote Release ──────────────────────────────────────────────

  async promoteRelease(params: PromoteReleaseParams): Promise<ReleaseManagementResult> {
    return this.withRetry(async () => {
      const editId = await this.insertEdit(params.appId);
      const headers = await this.authHeaders();

      // Get releases from source track
      const sourceResp = await this.client.get<{
        track: string;
        releases: Array<{
          name?: string;
          versionCodes?: string[];
          status: string;
          releaseNotes?: Array<{ language: string; text: string }>;
        }>;
      }>(
        `/androidpublisher/v3/applications/${params.appId}/edits/${editId}/tracks/${params.sourceTrack}`,
        { headers },
      );

      const sourceRelease = sourceResp.data.releases?.[0];
      if (!sourceRelease) {
        await this.deleteEdit(params.appId, editId).catch(() => {});
        return { success: false, message: `No release found on track '${params.sourceTrack}'` };
      }

      // Put release onto target track
      await this.client.put(
        `/androidpublisher/v3/applications/${params.appId}/edits/${editId}/tracks/${params.targetTrack}`,
        {
          track: params.targetTrack,
          releases: [{
            name: sourceRelease.name,
            versionCodes: sourceRelease.versionCodes,
            status: 'completed',
            releaseNotes: sourceRelease.releaseNotes,
          }],
        },
        { headers },
      );

      await this.commitEdit(params.appId, editId);

      return {
        success: true,
        message: `Release promoted from '${params.sourceTrack}' to '${params.targetTrack}'`,
      };
    }, 'promoteRelease');
  }

  // ─── Set Rollout ──────────────────────────────────────────────────

  async setRollout(params: SetRolloutParams): Promise<ReleaseManagementResult> {
    return this.withRetry(async () => {
      const editId = await this.insertEdit(params.appId);
      const headers = await this.authHeaders();

      const trackResp = await this.client.get<{
        track: string;
        releases: Array<{
          name?: string;
          versionCodes?: string[];
          status: string;
          userFraction?: number;
          releaseNotes?: Array<{ language: string; text: string }>;
        }>;
      }>(
        `/androidpublisher/v3/applications/${params.appId}/edits/${editId}/tracks/${params.track}`,
        { headers },
      );

      const release = trackResp.data.releases?.find(r => r.status === 'inProgress');
      if (!release) {
        await this.deleteEdit(params.appId, editId).catch(() => {});
        return { success: false, message: `No in-progress release found on track '${params.track}'` };
      }

      release.userFraction = params.rolloutPercentage;

      await this.client.put(
        `/androidpublisher/v3/applications/${params.appId}/edits/${editId}/tracks/${params.track}`,
        {
          track: params.track,
          releases: [release],
        },
        { headers },
      );

      await this.commitEdit(params.appId, editId);

      return {
        success: true,
        message: `Rollout updated to ${(params.rolloutPercentage * 100).toFixed(1)}% on track '${params.track}'`,
      };
    }, 'setRollout');
  }

  // ─── Resume Release ───────────────────────────────────────────────

  async resumeRelease(params: ResumeReleaseParams): Promise<ReleaseManagementResult> {
    return this.withRetry(async () => {
      const editId = await this.insertEdit(params.appId);
      const headers = await this.authHeaders();

      const trackResp = await this.client.get<{
        track: string;
        releases: Array<{
          name?: string;
          versionCodes?: string[];
          status: string;
          releaseNotes?: Array<{ language: string; text: string }>;
        }>;
      }>(
        `/androidpublisher/v3/applications/${params.appId}/edits/${editId}/tracks/${params.track}`,
        { headers },
      );

      const release = trackResp.data.releases?.find(r => r.status === 'halted');
      if (!release) {
        await this.deleteEdit(params.appId, editId).catch(() => {});
        return { success: false, message: `No halted release found on track '${params.track}'` };
      }

      release.status = 'completed';

      await this.client.put(
        `/androidpublisher/v3/applications/${params.appId}/edits/${editId}/tracks/${params.track}`,
        {
          track: params.track,
          releases: [release],
        },
        { headers },
      );

      await this.commitEdit(params.appId, editId);

      return {
        success: true,
        message: `Halted release resumed on track '${params.track}'`,
      };
    }, 'resumeRelease');
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
      await this.deleteEdit(appId, editId);

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
