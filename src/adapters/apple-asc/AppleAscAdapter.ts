/**
 * AppleAscAdapter — Apple App Store Connect API
 *
 * Auth: JWT (ES256 signed with API Key + .p8 private key)
 * Build upload: requires Transporter CLI (not REST)
 * Docs: https://developer.apple.com/documentation/appstoreconnectapi
 */

import { spawn } from 'node:child_process';
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

const BASE_URL = 'https://api.appstoreconnect.apple.com/v1';

export class AppleAscAdapter extends AbstractStoreAdapter {
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
      storeId: 'app_store',
      storeName: 'Apple App Store',
      supportedFileTypes: ['ipa'],
      supportsUpload: true,
      supportsListing: true,
      supportsReview: true,
      supportsAnalytics: true,
      supportsRollback: true,
      supportsStagedRollout: true,
      maxFileSizeMB: 4000,
      authMethod: 'jwt',
      requiresIcp: false,
    };
  }

  // ─── Authentication ────────────────────────────────────────────────

  async authenticate(): Promise<void> {
    await this.authManager.getToken('app_store');
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.authManager.getToken('app_store');
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  // ─── Upload ────────────────────────────────────────────────────────

  async uploadBuild(params: UploadParams): Promise<UploadResult> {
    if (process.platform !== 'darwin') {
      return {
        success: false,
        message: 'IPA upload requires macOS with Xcode command line tools installed.',
      };
    }

    const config = this.authManager.getConfig('app_store');
    if (!config.keyId || !config.issuerId) {
      return {
        success: false,
        message: 'IPA upload requires keyId and issuerId in Apple credentials config.',
      };
    }

    return new Promise<UploadResult>((resolve) => {
      const args = [
        'altool',
        '--upload-app',
        '-f', params.filePath,
        '-t', 'ios',
        '--apiKey', config.keyId,
        '--apiIssuer', config.issuerId,
      ];

      const child = spawn('xcrun', args, { stdio: ['ignore', 'pipe', 'pipe'] });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        resolve({
          success: false,
          message: 'IPA upload timed out after 10 minutes.',
        });
      }, 10 * 60 * 1000);

      child.on('close', (code) => {
        clearTimeout(timeout);

        if (code === 0 || stdout.includes('No errors uploading')) {
          resolve({
            success: true,
            buildId: params.appId,
            message: 'IPA uploaded successfully. Build processing on Apple servers may take additional time.',
          });
        } else {
          const errorMsg = stderr.trim() || stdout.trim() || `altool exited with code ${code}`;
          resolve({
            success: false,
            message: `IPA upload failed: ${errorMsg}`,
          });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        resolve({
          success: false,
          message: `Failed to spawn xcrun: ${err.message}. Ensure Xcode command line tools are installed.`,
        });
      });
    });
  }

  // ─── Release ───────────────────────────────────────────────────────

  async createRelease(params: ReleaseParams): Promise<ReleaseResult> {
    return this.withRetry(async () => {
      const headers = await this.authHeaders();

      const resp = await this.client.post<{
        data: { id: string; attributes: { versionString: string; appStoreState: string } };
      }>(
        '/appStoreVersions',
        {
          data: {
            type: 'appStoreVersions',
            attributes: {
              platform: 'IOS',
              versionString: params.versionName,
              releaseType: params.rolloutPercentage != null && params.rolloutPercentage < 100
                ? 'SCHEDULED'
                : 'AFTER_APPROVAL',
            },
            relationships: {
              app: {
                data: {
                  type: 'apps',
                  id: params.appId,
                },
              },
            },
          },
        },
        { headers },
      );

      return {
        success: true,
        releaseId: resp.data.data.id,
        status: resp.data.data.attributes.appStoreState,
      };
    }, 'createRelease');
  }

  // ─── Listing ───────────────────────────────────────────────────────

  async updateListing(params: ListingParams): Promise<ListingResult> {
    return this.withRetry(async () => {
      const headers = await this.authHeaders();

      // Step 1: Get the latest appStoreVersion for the app
      const versionsResp = await this.client.get<{
        data: Array<{
          id: string;
          relationships: {
            appStoreVersionLocalizations: { links: { related: string } };
          };
        }>;
      }>(
        `/apps/${params.appId}/appStoreVersions`,
        {
          headers,
          params: { 'filter[appStoreState]': 'PREPARE_FOR_SUBMISSION,DEVELOPER_ACTION_NEEDED' },
        },
      );

      const version = versionsResp.data.data[0];
      if (!version) {
        return { success: false, message: 'No editable app store version found' };
      }

      // Step 2: Get localizations for this version
      const locResp = await this.client.get<{
        data: Array<{ id: string; attributes: { locale: string } }>;
      }>(
        `/appStoreVersions/${version.id}/appStoreVersionLocalizations`,
        { headers },
      );

      const localization = locResp.data.data.find(l => l.attributes.locale === params.locale);

      if (localization) {
        // Patch existing localization
        const patchBody: Record<string, string> = {};
        if (params.fullDescription) patchBody.description = params.fullDescription;
        if (params.title) patchBody.name = params.title;
        if (params.shortDescription) patchBody.promotionalText = params.shortDescription;

        await this.client.patch(
          `/appStoreVersionLocalizations/${localization.id}`,
          {
            data: {
              type: 'appStoreVersionLocalizations',
              id: localization.id,
              attributes: patchBody,
            },
          },
          { headers },
        );
      } else {
        // Create new localization
        await this.client.post(
          '/appStoreVersionLocalizations',
          {
            data: {
              type: 'appStoreVersionLocalizations',
              attributes: {
                locale: params.locale,
                description: params.fullDescription ?? '',
                whatsNew: params.shortDescription ?? '',
              },
              relationships: {
                appStoreVersion: {
                  data: { type: 'appStoreVersions', id: version.id },
                },
              },
            },
          },
          { headers },
        );
      }

      return { success: true, message: `Listing updated for locale ${params.locale}` };
    }, 'updateListing');
  }

  // ─── Get Listing ──────────────────────────────────────────────────

  async getListing(params: GetListingParams): Promise<GetListingResult> {
    return this.withRetry(async () => {
      const headers = await this.authHeaders();

      // Get the latest app store version (any active state)
      const versionsResp = await this.client.get<{
        data: Array<{ id: string; attributes: { appStoreState: string } }>;
      }>(
        `/apps/${params.appId}/appStoreVersions`,
        {
          headers,
          params: { limit: 1 },
        },
      );

      const version = versionsResp.data.data[0];
      if (!version) {
        return { success: false, message: 'No app store version found' };
      }

      // Get localizations for this version
      const locResp = await this.client.get<{
        data: Array<{
          id: string;
          attributes: {
            locale: string;
            description?: string;
            keywords?: string;
            promotionalText?: string;
          };
        }>;
      }>(
        `/appStoreVersions/${version.id}/appStoreVersionLocalizations`,
        { headers },
      );

      const targetLocale = params.locale ?? 'en-US';
      const localization = locResp.data.data.find(l => l.attributes.locale === targetLocale)
        ?? locResp.data.data[0];

      if (!localization) {
        return { success: false, message: `No localization found for locale '${targetLocale}'` };
      }

      // Get app info for the title (name is on appInfoLocalizations, not version localizations)
      let title: string | undefined;
      try {
        const appInfoResp = await this.client.get<{
          data: Array<{ id: string }>;
        }>(
          `/apps/${params.appId}/appInfos`,
          { headers, params: { limit: 1 } },
        );
        const appInfo = appInfoResp.data.data[0];
        if (appInfo) {
          const infoLocResp = await this.client.get<{
            data: Array<{
              attributes: { locale: string; name?: string };
            }>;
          }>(
            `/appInfos/${appInfo.id}/appInfoLocalizations`,
            { headers },
          );
          const infoLoc = infoLocResp.data.data.find(l => l.attributes.locale === targetLocale)
            ?? infoLocResp.data.data[0];
          title = infoLoc?.attributes.name;
        }
      } catch {
        // title lookup is best-effort
      }

      return {
        success: true,
        listing: {
          title,
          description: localization.attributes.description,
          shortDescription: localization.attributes.promotionalText,
          locale: localization.attributes.locale,
        },
      };
    }, 'getListing');
  }

  // ─── Promote Release ──────────────────────────────────────────────

  async promoteRelease(params: PromoteReleaseParams): Promise<ReleaseManagementResult> {
    // Apple doesn't have track-based promotion; submitting for review is the equivalent
    const result = await this.submitForReview({ appId: params.appId });
    return {
      success: result.success,
      message: result.message ?? (result.success
        ? 'Submitted for App Review (Apple equivalent of promotion)'
        : 'Failed to submit for App Review'),
    };
  }

  // ─── Set Rollout ──────────────────────────────────────────────────

  async setRollout(params: SetRolloutParams): Promise<ReleaseManagementResult> {
    return this.withRetry(async () => {
      const headers = await this.authHeaders();

      // Get the version with a phased release
      const versionsResp = await this.client.get<{
        data: Array<{
          id: string;
          relationships: {
            appStoreVersionPhasedRelease?: { data: { id: string } | null };
          };
        }>;
      }>(
        `/apps/${params.appId}/appStoreVersions`,
        {
          headers,
          params: { 'filter[appStoreState]': 'PENDING_DEVELOPER_RELEASE,READY_FOR_DISTRIBUTION' },
        },
      );

      const version = versionsResp.data.data[0];
      if (!version) {
        return { success: false, message: 'No active release found' };
      }

      const phasedReleaseData = version.relationships.appStoreVersionPhasedRelease?.data;
      if (!phasedReleaseData) {
        return { success: false, message: 'No phased release in progress for this version' };
      }

      // Apple phased release uses currentDayNumber (1-7) to control rollout
      // Map percentage to approximate day number
      const dayNumber = Math.max(1, Math.min(7, Math.ceil(params.rolloutPercentage * 7)));

      await this.client.patch(
        `/appStoreVersionPhasedReleases/${phasedReleaseData.id}`,
        {
          data: {
            type: 'appStoreVersionPhasedReleases',
            id: phasedReleaseData.id,
            attributes: { currentDayNumber: dayNumber },
          },
        },
        { headers },
      );

      return {
        success: true,
        message: `Phased release updated to day ${dayNumber} of 7`,
      };
    }, 'setRollout');
  }

  // ─── Resume Release ───────────────────────────────────────────────

  async resumeRelease(params: ResumeReleaseParams): Promise<ReleaseManagementResult> {
    return this.withRetry(async () => {
      const headers = await this.authHeaders();

      const versionsResp = await this.client.get<{
        data: Array<{
          id: string;
          relationships: {
            appStoreVersionPhasedRelease?: { data: { id: string } | null };
          };
        }>;
      }>(
        `/apps/${params.appId}/appStoreVersions`,
        {
          headers,
          params: { 'filter[appStoreState]': 'PENDING_DEVELOPER_RELEASE,READY_FOR_DISTRIBUTION' },
        },
      );

      const version = versionsResp.data.data[0];
      if (!version) {
        return { success: false, message: 'No active release found' };
      }

      const phasedReleaseData = version.relationships.appStoreVersionPhasedRelease?.data;
      if (!phasedReleaseData) {
        return { success: false, message: 'No phased release found to resume' };
      }

      await this.client.patch(
        `/appStoreVersionPhasedReleases/${phasedReleaseData.id}`,
        {
          data: {
            type: 'appStoreVersionPhasedReleases',
            id: phasedReleaseData.id,
            attributes: { phasedReleaseState: 'ACTIVE' },
          },
        },
        { headers },
      );

      return {
        success: true,
        message: 'Phased release resumed',
      };
    }, 'resumeRelease');
  }

  // ─── Submit for Review ─────────────────────────────────────────────

  async submitForReview(params: SubmitParams): Promise<SubmitResult> {
    return this.withRetry(async () => {
      const headers = await this.authHeaders();

      // Get the latest editable version
      const versionsResp = await this.client.get<{
        data: Array<{ id: string }>;
      }>(
        `/apps/${params.appId}/appStoreVersions`,
        {
          headers,
          params: { 'filter[appStoreState]': 'PREPARE_FOR_SUBMISSION' },
        },
      );

      const version = versionsResp.data.data[0];
      if (!version) {
        return {
          success: false,
          message: 'No version in PREPARE_FOR_SUBMISSION state found',
        };
      }

      const resp = await this.client.post<{ data: { id: string } }>(
        '/appStoreVersionSubmissions',
        {
          data: {
            type: 'appStoreVersionSubmissions',
            relationships: {
              appStoreVersion: {
                data: { type: 'appStoreVersions', id: version.id },
              },
            },
          },
        },
        { headers },
      );

      return {
        success: true,
        submissionId: resp.data.data.id,
        message: 'Submitted for App Review',
      };
    }, 'submitForReview');
  }

  // ─── Status ────────────────────────────────────────────────────────

  async getStatus(appId: string): Promise<StatusResult> {
    return this.withRetry(async () => {
      const headers = await this.authHeaders();

      const resp = await this.client.get<{
        data: Array<{
          id: string;
          attributes: {
            versionString: string;
            appStoreState: string;
            createdDate: string;
          };
        }>;
      }>(
        `/apps/${appId}/appStoreVersions`,
        {
          headers,
          params: {
            'filter[appStoreState]': 'WAITING_FOR_REVIEW,IN_REVIEW,PENDING_DEVELOPER_RELEASE,READY_FOR_DISTRIBUTION',
            limit: 1,
          },
        },
      );

      const latest = resp.data.data[0];

      return {
        appId,
        storeName: 'Apple App Store',
        currentVersion: latest?.attributes.versionString,
        reviewStatus: latest?.attributes.appStoreState ?? 'no_active_version',
        liveStatus: latest?.attributes.appStoreState === 'READY_FOR_DISTRIBUTION' ? 'live' : 'pending',
        lastUpdated: latest?.attributes.createdDate,
      };
    }, 'getStatus');
  }

  // ─── Analytics ─────────────────────────────────────────────────────

  async getAnalytics(params: AnalyticsParams): Promise<AnalyticsResult> {
    // ASC analytics are available via the Analytics Reports API (v1)
    // which uses a different endpoint pattern. Return a stub for MVP.
    return {
      success: false,
      message: 'Apple analytics require the App Store Connect Analytics Reports API. Not yet implemented.',
    };
  }

  // ─── Reviews ───────────────────────────────────────────────────────

  async getReviews(params: ReviewListParams): Promise<ReviewItem[]> {
    return this.withRetry(async () => {
      const headers = await this.authHeaders();

      const resp = await this.client.get<{
        data: Array<{
          id: string;
          attributes: {
            rating: number;
            title: string;
            body: string;
            reviewerNickname: string;
            createdDate: string;
            territory: string;
          };
        }>;
      }>(
        `/apps/${params.appId}/customerReviews`,
        {
          headers,
          params: {
            limit: params.pageSize ?? 20,
            sort: '-createdDate',
          },
        },
      );

      return resp.data.data.map(r => ({
        reviewId: r.id,
        author: r.attributes.reviewerNickname,
        rating: r.attributes.rating,
        title: r.attributes.title,
        body: r.attributes.body,
        date: r.attributes.createdDate,
        locale: r.attributes.territory,
      }));
    }, 'getReviews');
  }

  // ─── Rollback ──────────────────────────────────────────────────────

  async rollback(params: RollbackParams): Promise<RollbackResult> {
    return this.withRetry(async () => {
      const headers = await this.authHeaders();

      // Apple supports "Pause Phased Release" or "Remove from Sale"
      // For phased release pause:
      const versionsResp = await this.client.get<{
        data: Array<{
          id: string;
          attributes: { appStoreState: string };
          relationships: {
            appStoreVersionPhasedRelease?: { data: { id: string } | null };
          };
        }>;
      }>(
        `/apps/${params.appId}/appStoreVersions`,
        {
          headers,
          params: { 'filter[appStoreState]': 'PENDING_DEVELOPER_RELEASE,READY_FOR_DISTRIBUTION' },
        },
      );

      const version = versionsResp.data.data[0];
      if (!version) {
        return { success: false, message: 'No active release found to rollback' };
      }

      // Attempt to pause phased release
      const phasedReleaseData = version.relationships.appStoreVersionPhasedRelease?.data;
      if (phasedReleaseData) {
        await this.client.patch(
          `/appStoreVersionPhasedReleases/${phasedReleaseData.id}`,
          {
            data: {
              type: 'appStoreVersionPhasedReleases',
              id: phasedReleaseData.id,
              attributes: { phasedReleaseState: 'PAUSED' },
            },
          },
          { headers },
        );
        return { success: true, message: 'Phased release paused' };
      }

      return {
        success: false,
        message: 'No phased release in progress. Full rollback requires removing from sale.',
      };
    }, 'rollback');
  }
}
