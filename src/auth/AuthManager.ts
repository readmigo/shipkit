/**
 * AuthManager — Unified authentication layer for all store adapters
 *
 * Supports OAuth2, JWT (ES256), RSA signing, and API key strategies.
 * Token caching with automatic expiry detection.
 */

import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import * as crypto from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import axios from 'axios';

// ─── Types ───────────────────────────────────────────────────────────

export type AuthType = 'oauth2' | 'jwt' | 'rsa' | 'apikey' | 'hmac';

export interface AuthCredentials {
  type: AuthType;
  filePath?: string;
  config?: Record<string, string>;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

// ─── Auth Manager ────────────────────────────────────────────────────

export class AuthManager {
  private credentials = new Map<string, AuthCredentials>();
  private tokenCache = new Map<string, CachedToken>();

  private static readonly CREDENTIALS_DIR = join(homedir(), '.shipkit', 'credentials');

  /**
   * Load credentials from a JSON file for the given store
   */
  async loadCredentials(storeId: string, filePath: string): Promise<void> {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as AuthCredentials;
    this.credentials.set(storeId, { ...parsed, filePath });
  }

  /**
   * Register credentials programmatically
   */
  setCredentials(storeId: string, creds: AuthCredentials): void {
    this.credentials.set(storeId, creds);
  }

  /**
   * Get a valid token for the given store, refreshing if needed
   */
  async getToken(storeId: string): Promise<string> {
    if (this.isTokenValid(storeId)) {
      return this.tokenCache.get(storeId)!.token;
    }
    return this.refreshToken(storeId);
  }

  /**
   * Check if the cached token is still valid (with 60s buffer)
   */
  isTokenValid(storeId: string): boolean {
    const cached = this.tokenCache.get(storeId);
    if (!cached) return false;
    return cached.expiresAt > Date.now() + 60_000;
  }

  /**
   * Force-refresh token for the given store
   */
  async refreshToken(storeId: string): Promise<string> {
    const creds = this.credentials.get(storeId);
    if (!creds) {
      throw new Error(`No credentials configured for store: ${storeId}`);
    }

    let token: string;
    let expiresAt: number;

    switch (creds.type) {
      case 'oauth2': {
        const result = await this.oauth2Flow(creds);
        token = result.token;
        expiresAt = result.expiresAt;
        break;
      }
      case 'jwt': {
        const result = await this.jwtFlow(creds);
        token = result.token;
        expiresAt = result.expiresAt;
        break;
      }
      case 'apikey': {
        token = creds.config?.apiKey ?? '';
        expiresAt = Date.now() + 365 * 24 * 60 * 60 * 1000; // effectively permanent
        break;
      }
      case 'rsa': {
        // RSA signing doesn't produce a persistent token; each request is signed individually
        // Return an empty marker; the adapter will call signRequest() directly
        token = 'rsa-sign-per-request';
        expiresAt = Date.now() + 365 * 24 * 60 * 60 * 1000;
        break;
      }
      case 'hmac': {
        // HMAC signing is per-request; no persistent token needed
        token = 'hmac-sign-per-request';
        expiresAt = Date.now() + 365 * 24 * 60 * 60 * 1000;
        break;
      }
    }

    this.tokenCache.set(storeId, { token, expiresAt });
    return token;
  }

  // ─── OAuth2 Client Credentials Flow ──────────────────────────────

  private async oauth2Flow(creds: AuthCredentials): Promise<CachedToken> {
    const config = creds.config ?? {};

    // Google Play: service account JSON → token
    if (config.serviceAccountJson) {
      return this.googleOAuth2(config.serviceAccountJson);
    }

    // Huawei AGC: client_id + client_secret → token
    if (config.clientId && config.clientSecret && config.tokenUrl) {
      return this.genericOAuth2(config.tokenUrl, config.clientId, config.clientSecret);
    }

    throw new Error('OAuth2 credentials missing required fields (serviceAccountJson or clientId+clientSecret+tokenUrl)');
  }

  private async googleOAuth2(serviceAccountPath: string): Promise<CachedToken> {
    const raw = await readFile(serviceAccountPath, 'utf-8');
    const sa = JSON.parse(raw) as {
      client_email: string;
      private_key: string;
      token_uri: string;
    };

    const now = Math.floor(Date.now() / 1000);
    const jwtPayload = {
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/androidpublisher',
      aud: sa.token_uri,
      iat: now,
      exp: now + 3600,
    };

    const signed = jwt.sign(jwtPayload, sa.private_key, { algorithm: 'RS256' });

    const resp = await axios.post<{ access_token: string; expires_in: number }>(
      sa.token_uri,
      new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: signed,
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );

    return {
      token: resp.data.access_token,
      expiresAt: Date.now() + resp.data.expires_in * 1000,
    };
  }

  private async genericOAuth2(
    tokenUrl: string,
    clientId: string,
    clientSecret: string,
  ): Promise<CachedToken> {
    const resp = await axios.post<{ access_token: string; expires_in: number }>(
      tokenUrl,
      JSON.stringify({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );

    return {
      token: resp.data.access_token,
      expiresAt: Date.now() + resp.data.expires_in * 1000,
    };
  }

  // ─── JWT (ES256) Flow — Apple App Store Connect ──────────────────

  private async jwtFlow(creds: AuthCredentials): Promise<CachedToken> {
    const config = creds.config ?? {};
    const keyId = config.keyId;
    const issuerId = config.issuerId;
    const privateKeyPath = config.privateKeyPath;

    if (!keyId || !issuerId || !privateKeyPath) {
      throw new Error('JWT credentials require keyId, issuerId, and privateKeyPath');
    }

    const privateKey = await readFile(privateKeyPath, 'utf-8');
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = 1200; // 20 minutes max for ASC

    const token = jwt.sign(
      {
        iss: issuerId,
        iat: now,
        exp: now + expiresIn,
        aud: 'appstoreconnect-v1',
      },
      privateKey,
      {
        algorithm: 'ES256',
        header: {
          alg: 'ES256',
          kid: keyId,
          typ: 'JWT',
        },
      },
    );

    return {
      token,
      expiresAt: Date.now() + expiresIn * 1000,
    };
  }

  // ─── RSA Signing (Xiaomi) ───────────────────────────────────────

  signRequest(storeId: string, _method: string, _uri: string, params: Record<string, string>): string {
    const config = this.credentials.get(storeId)?.config ?? {};
    const privateKey = config['privateKey'] ?? '';
    if (!privateKey) {
      throw new Error(`RSA private key not configured for store: ${storeId}`);
    }

    const sortedEntries = Object.entries(params).sort(([a], [b]) => a.localeCompare(b));
    const signatureString = sortedEntries.map(([k, v]) => `${k}=${v}`).join('&');

    const sign = crypto.createSign('SHA256');
    sign.update(signatureString);
    sign.end();
    return sign.sign(privateKey, 'base64');
  }

  // ─── HMAC Signing (vivo) ──────────────────────────────────────

  generateHmacSignature(storeId: string, message: string): string {
    const config = this.credentials.get(storeId)?.config ?? {};
    const accessSecret = config['accessSecret'] ?? config['access_secret'] ?? '';
    if (!accessSecret) {
      throw new Error(`HMAC access secret not configured for store: ${storeId}`);
    }

    return crypto.createHmac('sha256', accessSecret).update(message).digest('hex');
  }

  // ─── Helpers ─────────────────────────────────────────────────────

  /**
   * Get config values for a store (safe read-only access for adapters)
   */
  getConfig(storeId: string): Record<string, string> {
    return this.credentials.get(storeId)?.config ?? {};
  }

  /**
   * Ensure the credentials directory exists
   */
  async ensureCredentialsDir(): Promise<string> {
    await mkdir(AuthManager.CREDENTIALS_DIR, { recursive: true });
    return AuthManager.CREDENTIALS_DIR;
  }
}
