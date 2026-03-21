document.getElementById("autoCheck").onclick = async () => {
  const manifest = chrome.runtime.getManifest();
  const clientId = manifest.oauth2.client_id;
  const scopes = manifest.oauth2.scopes;
  const redirectUri = chrome.identity.getRedirectURL();

  // Helper functions for token management
  const getStoredTokens = async () => {
    return new Promise((resolve) => {
      chrome.storage.local.get(['accessToken', 'refreshToken', 'tokenExpiry'], (result) => {
        resolve(result);
      });
    });
  };

  const setStoredTokens = async (accessToken, refreshToken, expiresIn) => {
    const expiryTime = Date.now() + (expiresIn * 1000); // Convert to milliseconds
    return new Promise((resolve) => {
      chrome.storage.local.set({
        accessToken,
        refreshToken,
        tokenExpiry: expiryTime
      }, resolve);
    });
  };

  const clearStoredTokens = async () => {
    return new Promise((resolve) => {
      chrome.storage.local.remove(['accessToken', 'refreshToken', 'tokenExpiry'], resolve);
    });
  };

  // Check if we have a valid access token
  const tokens = await getStoredTokens();
  let accessToken = tokens.accessToken;

  if (accessToken && tokens.tokenExpiry && Date.now() < tokens.tokenExpiry) {
    // We have a valid token, use it directly
    console.log('Using stored access token');
  } else if (tokens.refreshToken) {
    // Try to refresh the token
    console.log('Refreshing access token');
    try {
      const refreshResponse = await fetch('http://localhost:3000/exchange-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          refreshToken: tokens.refreshToken,
          grantType: 'refresh_token'
        })
      });

      const refreshData = await refreshResponse.json();
      if (refreshData.access_token) {
        accessToken = refreshData.access_token;
        await setStoredTokens(refreshData.access_token, tokens.refreshToken, refreshData.expires_in || 3600);
        console.log('Token refreshed successfully');
      } else {
        console.log('Token refresh failed, clearing stored tokens');
        await clearStoredTokens();
      }
    } catch (err) {
      console.error('Token refresh error:', err);
      await clearStoredTokens();
    }
  }

  // If we still don't have a token, do the full OAuth flow
  if (!accessToken) {
    console.log('No valid token found, starting OAuth flow');
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&response_type=code&scope=${encodeURIComponent(scopes.join(' '))}&redirect_uri=${encodeURIComponent(redirectUri)}&access_type=offline&prompt=consent&include_granted_scopes=true`;

    console.log('OAuth clientId:', clientId);
    console.log('OAuth redirectUri:', redirectUri);
    console.log('OAuth authUrl:', authUrl);

    chrome.identity.launchWebAuthFlow(
      {
        url: authUrl,
        interactive: true,
      },
      async (redirectUrl) => {
        if (chrome.runtime.lastError) {
          console.error('Auth error', chrome.runtime.lastError);
          alert('Authentication error: ' + chrome.runtime.lastError.message);
          return;
        }

        if (!redirectUrl) {
          alert('Failed to obtain auth token.');
          return;
        }

        const url = new URL(redirectUrl);
        const code = url.searchParams.get('code');
        if (!code) {
          console.error('Auth response URL (no code):', redirectUrl);
          alert('Authorization failed (no code returned). Check console for the full redirect URL.');
          return;
        }

        try {
          const tokenResponse = await fetch('http://localhost:3000/exchange-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              code: code,
              redirectUri: redirectUri
            })
          });

          const tokenData = await tokenResponse.json();
          if (tokenData.error) {
            console.error('Token exchange error:', tokenData);
            alert('Token exchange failed: ' + tokenData.error + '\n\nMake sure your backend is running and GOOGLE_CLIENT_SECRET is set in .env');
            return;
          }

          accessToken = tokenData.access_token;
          await setStoredTokens(tokenData.access_token, tokenData.refresh_token, tokenData.expires_in || 3600);
          console.log('New tokens stored');

          // Now proceed with the document fetch
          await fetchAndDisplayDocument(accessToken);
        } catch (err) {
          console.error(err);
          alert('Error during token exchange: ' + err.message);
        }
      }
    );
    return; // Exit here, the document fetch will happen in the callback
  }

  // If we reach here, we have a valid access token, proceed with document fetch
  await fetchAndDisplayDocument(accessToken);
};

// Separate function to fetch and display the document
async function fetchAndDisplayDocument(accessToken) {
  const DOC_ID = "1J6T9yiKbSULXMPkTOnZBFnRwt_4xgwTDUGX9McQfCp0"; // paste the ID from the URL

  try {
    const response = await fetch(
      `https://docs.googleapis.com/v1/documents/${DOC_ID}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    if (!response.ok) {
      const txt = await response.text();
      throw new Error('Docs API error: ' + response.status + ' ' + txt);
    }

    const doc = await response.json();

    // Extract plain text from the document
    const exercisePart4 = (doc.body?.content || [])
      .flatMap((block) => block.table || [])[6].tableRows

    alert(text);
    console.log(text);
  } catch (err) {
    console.error(err);
    alert('Error fetching document: ' + err.message);
  }
}

// Optional: Add a logout button functionality
document.getElementById("logout")?.addEventListener("click", async () => {
  await chrome.storage.local.remove(['accessToken', 'refreshToken', 'tokenExpiry']);
  alert('Logged out successfully. You will need to re-authenticate next time.');
});