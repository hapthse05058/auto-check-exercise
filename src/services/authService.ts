import type { TokenData, ExtensionManifest } from '../types';

const DOMAIN = 'http://localhost:3000';

export async function getStoredTokens(): Promise<TokenData> {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ['accessToken', 'refreshToken', 'tokenExpiry'],
      (result) => resolve(result as TokenData),
    );
  });
}

export async function setStoredTokens(
  accessToken: string,
  refreshToken: string | undefined,
  expiresIn: number,
): Promise<void> {
  const expiryTime = Date.now() + expiresIn * 1000;
  return new Promise((resolve) => {
    chrome.storage.local.set(
      { accessToken, refreshToken, tokenExpiry: expiryTime },
      resolve,
    );
  });
}

export async function clearStoredTokens(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove(
      ['accessToken', 'refreshToken', 'tokenExpiry'],
      resolve,
    );
  });
}

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  const response = await fetch(`${DOMAIN}/exchange-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken, grantType: 'refresh_token' }),
  });
  const data = await response.json();
  return data.access_token ?? null;
}

export async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
): Promise<{ access_token: string; refresh_token?: string; expires_in?: number; error?: string }> {
  const response = await fetch(`${DOMAIN}/exchange-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, redirectUri }),
  });
  return response.json();
}

/** Returns a valid access token from storage, refreshing if expired. Returns null if no token exists. */
export async function getValidAccessToken(): Promise<string | null> {
  const tokens = await getStoredTokens();

  if (tokens.accessToken && tokens.tokenExpiry && Date.now() < tokens.tokenExpiry) {
    return tokens.accessToken;
  }

  if (tokens.refreshToken) {
    const newToken = await refreshAccessToken(tokens.refreshToken);
    if (newToken) {
      await setStoredTokens(newToken, tokens.refreshToken, 3600);
      return newToken;
    }
    await clearStoredTokens();
  }

  return null;
}

/** Launches the OAuth2 flow and returns the authorization code. */
export function startOAuthFlow(): Promise<string> {
  return new Promise((resolve, reject) => {
    const manifest = chrome.runtime.getManifest() as ExtensionManifest;
    const { client_id: clientId, scopes } = manifest.oauth2;
    const redirectUri = chrome.identity.getRedirectURL();

    const authUrl =
      `https://accounts.google.com/o/oauth2/v2/auth` +
      `?client_id=${clientId}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent(scopes.join(' '))}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&access_type=offline&prompt=consent&include_granted_scopes=true`;

    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (redirectUrl) => {
      if (chrome.runtime.lastError || !redirectUrl) {
        reject(new Error(chrome.runtime.lastError?.message ?? 'No redirect URL'));
        return;
      }
      const code = new URL(redirectUrl).searchParams.get('code');
      if (!code) {
        reject(new Error('No authorization code in redirect URL'));
        return;
      }
      resolve(code);
    });
  });
}
