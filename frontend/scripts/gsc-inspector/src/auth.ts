// ============================================================
// Google Service Account JWT authentication
// Zero external dependencies — uses Node.js built-in crypto only.
// ============================================================

import * as crypto from 'node:crypto';
import type { ServiceAccountKey, OAuthTokenResponse } from './types.js';

// In-memory token cache (global across CLI run)
let cachedToken: { accessToken: string; expiresAt: number } | null = null;

/**
 * Build a RS256-signed JWT assertion for Google OAuth2 Service Account flow.
 * Uses Node.js crypto (no jose dependency needed).
 */
function createJwtAssertion(key: ServiceAccountKey, scope: string): string {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: key.client_email,
    scope,
    aud: key.token_uri,
    exp: now + 3600,
    iat: now,
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signingInput);
  sign.end();
  const signature = sign.sign(key.private_key);

  const encodedSignature = base64url(signature);
  return `${signingInput}.${encodedSignature}`;
}

function base64url(input: string | Buffer): string {
  if (Buffer.isBuffer(input)) {
    return input
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  }
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * Get an OAuth2 access token for the Google Search Console scope.
 * Uses cached token until 5 minutes before expiry.
 */
export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 300_000) {
    return cachedToken.accessToken;
  }

  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!rawKey) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_KEY not set. Export it in your shell:\n' +
        '  export GOOGLE_SERVICE_ACCOUNT_KEY=\'{"type":"service_account",...}\'\n' +
        'Or add it to ~/.bashrc / ~/.zshrc.'
    );
  }

  let key: ServiceAccountKey;
  try {
    key = JSON.parse(rawKey);
  } catch {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_KEY is not valid JSON. ' +
        'Make sure you copied the entire JSON key file content.'
    );
  }

  if (!key.private_key || !key.client_email || !key.token_uri) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_KEY is missing required fields ' +
        '(private_key, client_email, token_uri).'
    );
  }

  const scope = 'https://www.googleapis.com/auth/webmasters.readonly';
  const jwt = createJwtAssertion(key, scope);

  const resp = await fetch(key.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(
      `Failed to get access token (HTTP ${resp.status}): ${body}\n` +
        'Common causes:\n' +
        '  1. Service Account key is expired or revoked\n' +
        '  2. Service Account does not have GSC site permissions\n' +
        '  3. Google Search Console API is not enabled in GCP'
    );
  }

  const data: OAuthTokenResponse = await resp.json();
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  return cachedToken.accessToken;
}

/** Clear cached token (useful for testing) */
export function clearTokenCache(): void {
  cachedToken = null;
}
