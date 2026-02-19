/**
 * AppleAscAdapter — Apple App Store Connect API
 *
 * Auth: JWT (ES256 signed with API Key + .p8 private key)
 * Build upload: requires Transporter CLI (not REST)
 * Docs: https://developer.apple.com/documentation/appstoreconnectapi
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
      supportsUpload: false,  // IPA upload requires Transporter CLI
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

  async uploadBuild(_params: UploadParams): Promise<UploadResult> {
    // IPA upload is not possible via REST API; it requires Transporter CLI or altool
    return {
      success: false,
      message: 'IPA upload requires Transporter CLI. Run: xcrun altool --upload-app -f app.ipa -t ios -u USER -p @keychain:AC_PASSWORD',
    };
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
        if (params.title) patchBody.whatsNew = params.title; // ASC uses whatsNew differently

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
