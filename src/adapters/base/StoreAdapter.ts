/**
 * StoreAdapter — Unified interface for all app store adapters
 */

// ─── Capability Types ────────────────────────────────────────────────

export interface StoreCapabilities {
  storeId: string;
  storeName: string;
  supportedFileTypes: string[];
  supportsUpload: boolean;
  supportsListing: boolean;
  supportsReview: boolean;
  supportsAnalytics: boolean;
  supportsRollback: boolean;
  supportsStagedRollout: boolean;
  maxFileSizeMB: number;
  authMethod: 'oauth2' | 'jwt' | 'rsa' | 'apikey' | 'hmac';

  requiresIcp: boolean;
}

// ─── Upload Types ────────────────────────────────────────────────────

export interface UploadParams {
  appId: string;
  filePath: string;
  fileType: string;        // 'apk' | 'aab' | 'ipa' | 'hap'
  releaseType?: string;    // 'draft' | 'production'
}

export interface UploadResult {
  success: boolean;
  buildId?: string;
  storeRef?: string;
  message?: string;
}

// ─── Release Types ───────────────────────────────────────────────────

export interface ReleaseParams {
  appId: string;
  buildId: string;
  track: string;            // 'internal' | 'alpha' | 'beta' | 'production'
  versionName: string;
  releaseNotes?: Record<string, string>;  // locale -> notes
  rolloutPercentage?: number;
}

export interface ReleaseResult {
  success: boolean;
  releaseId?: string;
  status?: string;
  message?: string;
}

// ─── Listing Types ───────────────────────────────────────────────────

export interface ListingParams {
  appId: string;
  locale: string;
  title?: string;
  shortDescription?: string;
  fullDescription?: string;
  screenshots?: string[];
  icon?: string;
}

export interface ListingResult {
  success: boolean;
  message?: string;
}

export interface GetListingParams {
  appId: string;
  locale?: string;
}

export interface GetListingResult {
  success: boolean;
  listing?: {
    title?: string;
    description?: string;
    shortDescription?: string;
    locale?: string;
  };
  message?: string;
}

// ─── Release Management Types ───────────────────────────────────────

export interface PromoteReleaseParams {
  appId: string;
  releaseId: string;
  sourceTrack: string;
  targetTrack: string;
}

export interface SetRolloutParams {
  appId: string;
  track: string;
  rolloutPercentage: number;
}

export interface ResumeReleaseParams {
  appId: string;
  track: string;
}

export interface ReleaseManagementResult {
  success: boolean;
  message?: string;
}

// ─── Submit Types ────────────────────────────────────────────────────

export interface SubmitParams {
  appId: string;
  releaseType?: string;
}

export interface SubmitResult {
  success: boolean;
  submissionId?: string;
  message?: string;
}

// ─── Status Types ────────────────────────────────────────────────────

export interface StatusResult {
  appId: string;
  storeName: string;
  currentVersion?: string;
  reviewStatus: string;
  liveStatus: string;
  lastUpdated?: string;
}

// ─── Analytics Types ─────────────────────────────────────────────────

export interface AnalyticsParams {
  appId: string;
  startDate: string;
  endDate: string;
  metrics?: string[];
}

export interface AnalyticsResult {
  success: boolean;
  data?: Record<string, unknown>;
  message?: string;
}

// ─── Review Types ────────────────────────────────────────────────────

export interface ReviewListParams {
  appId: string;
  pageSize?: number;
  pageToken?: string;
}

export interface ReviewItem {
  reviewId: string;
  author: string;
  rating: number;
  title?: string;
  body: string;
  date: string;
  locale?: string;
}

// ─── Rollback Types ──────────────────────────────────────────────────

export interface RollbackParams {
  appId: string;
  targetVersionCode?: string;
  track?: string;
}

export interface RollbackResult {
  success: boolean;
  message?: string;
}

// ─── Error ───────────────────────────────────────────────────────────

export { ShipKitError } from '../../mcp/errors.js';
import { ShipKitError } from '../../mcp/errors.js';

// ─── StoreAdapter Interface ──────────────────────────────────────────

export interface StoreAdapter {
  getCapabilities(): StoreCapabilities;
  authenticate(): Promise<void>;
  uploadBuild(params: UploadParams): Promise<UploadResult>;
  createRelease(params: ReleaseParams): Promise<ReleaseResult>;
  updateListing(params: ListingParams): Promise<ListingResult>;
  getListing(params: GetListingParams): Promise<GetListingResult>;
  promoteRelease(params: PromoteReleaseParams): Promise<ReleaseManagementResult>;
  setRollout(params: SetRolloutParams): Promise<ReleaseManagementResult>;
  resumeRelease(params: ResumeReleaseParams): Promise<ReleaseManagementResult>;
  submitForReview(params: SubmitParams): Promise<SubmitResult>;
  getStatus(appId: string): Promise<StatusResult>;
  getAnalytics(params: AnalyticsParams): Promise<AnalyticsResult>;
  getReviews(params: ReviewListParams): Promise<ReviewItem[]>;
  rollback(params: RollbackParams): Promise<RollbackResult>;
}

// ─── Abstract Base Class ─────────────────────────────────────────────

export abstract class AbstractStoreAdapter implements StoreAdapter {
  protected maxRetries = 3;
  protected baseDelayMs = 1000;

  abstract getCapabilities(): StoreCapabilities;
  abstract authenticate(): Promise<void>;

  abstract uploadBuild(params: UploadParams): Promise<UploadResult>;
  abstract createRelease(params: ReleaseParams): Promise<ReleaseResult>;
  abstract updateListing(params: ListingParams): Promise<ListingResult>;
  abstract submitForReview(params: SubmitParams): Promise<SubmitResult>;
  abstract getStatus(appId: string): Promise<StatusResult>;
  abstract getAnalytics(params: AnalyticsParams): Promise<AnalyticsResult>;
  abstract getReviews(params: ReviewListParams): Promise<ReviewItem[]>;
  abstract rollback(params: RollbackParams): Promise<RollbackResult>;

  async getListing(_params: GetListingParams): Promise<GetListingResult> {
    return { success: false, message: 'Not implemented' };
  }

  async promoteRelease(_params: PromoteReleaseParams): Promise<ReleaseManagementResult> {
    return { success: false, message: 'Not supported' };
  }

  async setRollout(_params: SetRolloutParams): Promise<ReleaseManagementResult> {
    return { success: false, message: 'Not supported' };
  }

  async resumeRelease(_params: ResumeReleaseParams): Promise<ReleaseManagementResult> {
    return { success: false, message: 'Not supported' };
  }

  /**
   * Retry with exponential backoff
   */
  protected async withRetry<T>(
    operation: () => Promise<T>,
    context: string,
  ): Promise<T> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (err instanceof ShipKitError && !err.retryable) {
          throw err;
        }
        if (attempt < this.maxRetries - 1) {
          const delay = this.baseDelayMs * Math.pow(2, attempt);
          await this.sleep(delay);
        }
      }
    }
    throw this.wrapError(lastError!, context);
  }

  /**
   * Convert platform-specific errors to ShipKitError
   */
  protected wrapError(err: Error, context: string): ShipKitError {
    if (err instanceof ShipKitError) return err;
    const caps = this.getCapabilities();
    return new ShipKitError(
      `[${caps.storeId}] ${context}: ${err.message}`,
      caps.storeId,
      'ADAPTER_ERROR',
      undefined,
      false,
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
