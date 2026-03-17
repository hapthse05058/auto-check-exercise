document.getElementById("autoCheck").onclick = async () => {
  const manifest = chrome.runtime.getManifest();
  const clientId = manifest.oauth2.client_id;
  const scopes = manifest.oauth2.scopes;
  const redirectUri = chrome.identity.getRedirectURL();
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&response_type=code&scope=${encodeURIComponent(scopes.join(' '))}&redirect_uri=${encodeURIComponent(redirectUri)}`;

  // Debug: log key values so you can verify the OAuth request matches what’s configured in Google Cloud Console
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
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            code: code,
            client_id: clientId,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code'
          })
        });

        const tokenData = await tokenResponse.json();
        if (tokenData.error) {
          alert('Token exchange failed: ' + tokenData.error);
          return;
        }

        const accessToken = tokenData.access_token;
        const DOC_ID = "1KTJkaBxZQrxs0ivcuwZZuHfrLWPPnRTPcvgTv_DA3CQ"; // paste the ID from the URL

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
        const text = (doc.body?.content || [])
          .flatMap((block) => block.paragraph?.elements || [])
          .map((element) => element.textRun?.content || "")
          .join("");

        alert(text);
        console.log(text);
      } catch (err) {
        console.error(err);
        alert('Error fetching document: ' + err.message);
      }
    },
  );
};
//   const doc = await response.json();

//   // Extract plain text from the document
//   const text = doc.body.content
//     .flatMap(block => block.paragraph?.elements || [])
//     .map(element => element.textRun?.content || "")
//     .join("");

//   console.log(text);

// // Auto check exercise flow
// document.getElementById('autoCheck').onclick = async () => {
//   chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
//     const tab = tabs && tabs[0];
//     if (!tab) return;

//     function sendMessage(tabId, msg) {
//       return new Promise((resolve) => {
//         chrome.tabs.sendMessage(tabId, msg, (resp) => resolve(resp));
//       });
//     }

//     const extractResp = await sendMessage(tab.id, { type: 'EXTRACT_EXERCISE' });
//     if (!extractResp || extractResp.error) {
//       document.getElementById('result').innerText = 'Could not extract exercise: ' + (extractResp && extractResp.error || 'unknown');
//       return;
//     }

//     const items = extractResp.items || [];
//     if (!items.length) {
//       document.getElementById('result').innerText = 'No items found in exercise.';
//       return;
//     }

//     // Call local backend which wraps the Mama agent
//     const backendUrl = 'http://localhost:3000/grade';
//     try {
//       const resp = await fetch(backendUrl, {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
//         // body: JSON.stringify({ items })
//         body: "test hong ha"
//       });

//       if (!resp.ok) {
//         const txt = await resp.text();
//         document.getElementById('result').innerText = 'Backend error: ' + txt;
//         return;
//       }

//       const body = await resp.json();
//       const parsed = body.parsed || [];

//       const corrections = [];
//       for (let i = 0; i < items.length; i++) {
//         const found = parsed.find(p => p.index === i+1 || p.index === (i+1).toString());
//         if (found) corrections.push(found.correct ? '' : (found.correctSentence || ''));
//         else corrections.push('');
//       }

//       const applyResp = await sendMessage(tab.id, { type: 'APPLY_CORRECTIONS', corrections });
//       if (applyResp && applyResp.ok) {
//         document.getElementById('result').innerText = `Applied ${applyResp.applied} corrections.`;
//       } else {
//         document.getElementById('result').innerText = 'Failed to apply corrections.';
//       }
//     } catch (e) {
//       document.getElementById('result').innerText = 'Error calling backend: ' + e.message;
//     }
//   });
// };
