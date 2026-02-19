/**
 * ShipKit - Error Catalog
 *
 * Maps error codes to user-friendly messages and actionable suggestions.
 */

export interface ErrorCatalogEntry {
  userMessage: string;
  suggestion: string;
  docsUrl?: string;
}

export const ERROR_CATALOG: Record<string, ErrorCatalogEntry> = {
  STORE_NOT_CONNECTED: {
    userMessage: 'Store is not configured.',
    suggestion: 'Run store.connect to set up credentials for this store.',
  },
  AUTH_EXPIRED: {
    userMessage: 'Store authentication has expired.',
    suggestion: 'Re-run store.connect to refresh your credentials.',
  },
  AUTH_INSUFFICIENT_PERMISSIONS: {
    userMessage: 'Your credentials lack the required permissions.',
    suggestion: 'Check that your API key or service account has the necessary roles for this operation.',
  },
  ARTIFACT_NOT_FOUND: {
    userMessage: 'Build artifact was not found.',
    suggestion: 'Verify the file path exists and the artifact has been uploaded.',
  },
  ARTIFACT_INVALID_FORMAT: {
    userMessage: 'Build artifact format is not supported.',
    suggestion: 'Ensure the file is a valid APK, AAB, IPA, or HAP for the target store.',
  },
  VERSION_CONFLICT: {
    userMessage: 'Version code conflicts with an existing release.',
    suggestion: 'Increment the version code and try again.',
  },
  LISTING_INCOMPLETE: {
    userMessage: 'Store listing is missing required fields.',
    suggestion: 'Fill in all required listing fields (title, description, screenshots) before submitting.',
  },
  LISTING_FIELD_TOO_LONG: {
    userMessage: 'A store listing field exceeds the maximum length.',
    suggestion: 'Shorten the field value to fit within the store character limit.',
  },
  COMPLIANCE_FAILED: {
    userMessage: 'Release does not meet store compliance requirements.',
    suggestion: 'Review the rejection reasons and update your app metadata or binary accordingly.',
  },
  REVIEW_IN_PROGRESS: {
    userMessage: 'A review is already in progress for this release.',
    suggestion: 'Wait for the current review to complete before submitting changes.',
  },
  RATE_LIMIT_EXCEEDED: {
    userMessage: 'Too many requests to the store API.',
    suggestion: 'Wait a few minutes and try again.',
  },
  STORE_API_ERROR: {
    userMessage: 'The store API returned an unexpected error.',
    suggestion: 'Check the error details and the store developer console for more information.',
  },
  UPLOAD_SIZE_EXCEEDED: {
    userMessage: 'Build artifact exceeds the maximum upload size.',
    suggestion: 'Reduce the file size or check the store size limits for your app type.',
  },
  TRACK_NOT_AVAILABLE: {
    userMessage: 'The requested release track is not available.',
    suggestion: 'Verify the track name is valid for this store (e.g., internal, alpha, beta, production).',
  },
  IDEMPOTENCY_CONFLICT: {
    userMessage: 'A duplicate operation was detected.',
    suggestion: 'This operation was already submitted. Check the release status before retrying.',
  },
};

export function getCatalogEntry(code: string): ErrorCatalogEntry | undefined {
  return ERROR_CATALOG[code];
}
