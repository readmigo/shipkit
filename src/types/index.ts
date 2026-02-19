/**
 * ShipKit - Unified Data Models and Types
 */

// ─── Enums ───────────────────────────────────────────────────────────────────

export const Platform = {
  ios: 'ios',
  android: 'android',
  harmonyos: 'harmonyos',
} as const;
export type Platform = (typeof Platform)[keyof typeof Platform];

export const FileType = {
  apk: 'apk',
  aab: 'aab',
  ipa: 'ipa',
  hap: 'hap',
} as const;
export type FileType = (typeof FileType)[keyof typeof FileType];

export const TrackName = {
  internal: 'internal',
  alpha: 'alpha',
  beta: 'beta',
  production: 'production',
} as const;
export type TrackName = (typeof TrackName)[keyof typeof TrackName];

export const ReleaseStatus = {
  draft: 'draft',
  uploading: 'uploading',
  uploaded: 'uploaded',
  in_review: 'in_review',
  approved: 'approved',
  rejected: 'rejected',
  released: 'released',
  halted: 'halted',
} as const;
export type ReleaseStatus = (typeof ReleaseStatus)[keyof typeof ReleaseStatus];

export const StoreId = {
  google_play: 'google_play',
  app_store: 'app_store',
  huawei_agc: 'huawei_agc',
  xiaomi: 'xiaomi',
  oppo: 'oppo',
  vivo: 'vivo',
  honor: 'honor',
  tencent: 'tencent',
  samsung: 'samsung',
  pgyer: 'pgyer',
} as const;
export type StoreId = (typeof StoreId)[keyof typeof StoreId];

export const AuthStatus = {
  connected: 'connected',
  expired: 'expired',
  error: 'error',
  not_configured: 'not_configured',
} as const;
export type AuthStatus = (typeof AuthStatus)[keyof typeof AuthStatus];

export const UploadStatus = {
  pending: 'pending',
  uploading: 'uploading',
  processing: 'processing',
  completed: 'completed',
  failed: 'failed',
  duplicate: 'duplicate',
} as const;
export type UploadStatus = (typeof UploadStatus)[keyof typeof UploadStatus];

export const ReviewStatusValue = {
  pending: 'pending',
  in_review: 'in_review',
  approved: 'approved',
  rejected: 'rejected',
} as const;
export type ReviewStatusValue = (typeof ReviewStatusValue)[keyof typeof ReviewStatusValue];

export const ShipKitErrorCode = {
  STORE_NOT_CONNECTED: 'STORE_NOT_CONNECTED',
  AUTH_EXPIRED: 'AUTH_EXPIRED',
  AUTH_INSUFFICIENT_PERMISSIONS: 'AUTH_INSUFFICIENT_PERMISSIONS',
  ARTIFACT_NOT_FOUND: 'ARTIFACT_NOT_FOUND',
  ARTIFACT_INVALID_FORMAT: 'ARTIFACT_INVALID_FORMAT',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  LISTING_INCOMPLETE: 'LISTING_INCOMPLETE',
  LISTING_FIELD_TOO_LONG: 'LISTING_FIELD_TOO_LONG',
  COMPLIANCE_FAILED: 'COMPLIANCE_FAILED',
  REVIEW_IN_PROGRESS: 'REVIEW_IN_PROGRESS',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  STORE_API_ERROR: 'STORE_API_ERROR',
  UPLOAD_SIZE_EXCEEDED: 'UPLOAD_SIZE_EXCEEDED',
  TRACK_NOT_AVAILABLE: 'TRACK_NOT_AVAILABLE',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
} as const;
export type ShipKitErrorCode = (typeof ShipKitErrorCode)[keyof typeof ShipKitErrorCode];

// ─── Core Interfaces ─────────────────────────────────────────────────────────

export interface App {
  app_id: string;
  name: string;
  bundle_id: string;
  platform: Platform;
  connected_stores: StoreId[];
}

export interface Store {
  store_id: StoreId;
  name: string;
  platform: Platform;
  region: 'global' | 'china' | 'all';
  status: AuthStatus;
  supported_file_types: FileType[];
  features: string[];
}

export interface Release {
  release_id: string;
  app_id: string;
  version_name: string;
  version_code: number;
  track: TrackName;
  status: ReleaseStatus;
  created_at: string;
}

export interface BuildArtifact {
  artifact_id: string;
  release_id: string;
  file_type: FileType;
  file_size: number;
  sha256: string;
  upload_status: UploadStatus;
}

export interface ReviewStatus {
  release_id: string;
  store_id: StoreId;
  status: ReviewStatusValue;
  submitted_at?: string;
  reviewed_at?: string;
  rejection_reasons?: string[];
}

export interface StoreListing {
  listing_id: string;
  app_id: string;
  store_id: StoreId;
  locale: string;
  title: string;
  short_description?: string;
  full_description?: string;
  keywords?: string;
  whats_new?: string;
  screenshots: string[];
  has_icon: boolean;
}

export interface StoreConnection {
  connection_id: string;
  app_id: string;
  store_id: StoreId;
  auth_status: AuthStatus;
  last_synced: string;
}

export interface ShipKitErrorInfo {
  code: ShipKitErrorCode;
  message: string;
  suggestion: string;
  severity: 'blocking' | 'warning' | 'info';
  details?: Record<string, unknown>;
}
