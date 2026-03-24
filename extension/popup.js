document.getElementById("autoCheck").onclick = async () => {
  const manifest = chrome.runtime.getManifest();
  const clientId = manifest.oauth2.client_id;
  const scopes = manifest.oauth2.scopes;
  const redirectUri = chrome.identity.getRedirectURL();
  // const domain = "http://localhost:3000";

  // Helper functions for token management
  const getStoredTokens = async () => {
    return new Promise((resolve) => {
      chrome.storage.local.get(
        ["accessToken", "refreshToken", "tokenExpiry"],
        (result) => {
          resolve(result);
        },
      );
    });
  };

  const setStoredTokens = async (accessToken, refreshToken, expiresIn) => {
    const expiryTime = Date.now() + expiresIn * 1000; // Convert to milliseconds
    return new Promise((resolve) => {
      chrome.storage.local.set(
        {
          accessToken,
          refreshToken,
          tokenExpiry: expiryTime,
        },
        resolve,
      );
    });
  };

  const clearStoredTokens = async () => {
    return new Promise((resolve) => {
      chrome.storage.local.remove(
        ["accessToken", "refreshToken", "tokenExpiry"],
        resolve,
      );
    });
  };

  // Check if we have a valid access token
  const tokens = await getStoredTokens();
  let accessToken = tokens.accessToken;

  if (accessToken && tokens.tokenExpiry && Date.now() < tokens.tokenExpiry) {
    // We have a valid token, use it directly
    console.log("Using stored access token");
  } else if (tokens.refreshToken) {
    // Try to refresh the token
    console.log("Refreshing access token");
    try {
      const refreshResponse = await fetch(
        `http://localhost:3000/exchange-token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            refreshToken: tokens.refreshToken,
            grantType: "refresh_token",
          }),
        },
      );

      const refreshData = await refreshResponse.json();
      if (refreshData.access_token) {
        accessToken = refreshData.access_token;
        await setStoredTokens(
          refreshData.access_token,
          tokens.refreshToken,
          refreshData.expires_in || 3600,
        );
        console.log("Token refreshed successfully");
      } else {
        console.log("Token refresh failed, clearing stored tokens");
        await clearStoredTokens();
      }
    } catch (err) {
      console.error("Token refresh error:", err);
      await clearStoredTokens();
    }
  }

  // If we still don't have a token, do the full OAuth flow
  if (!accessToken) {
    console.log("No valid token found, starting OAuth flow");
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&response_type=code&scope=${encodeURIComponent(scopes.join(" "))}&redirect_uri=${encodeURIComponent(redirectUri)}&access_type=offline&prompt=consent&include_granted_scopes=true`;

    chrome.identity.launchWebAuthFlow(
      {
        url: authUrl,
        interactive: true,
      },
      async (redirectUrl) => {
        if (chrome.runtime.lastError) {
          console.error("Auth error", chrome.runtime.lastError);
          alert("Authentication error: " + chrome.runtime.lastError.message);
          return;
        }

        if (!redirectUrl) {
          alert("Failed to obtain auth token.");
          return;
        }

        const url = new URL(redirectUrl);
        const code = url.searchParams.get("code");
        if (!code) {
          console.error("Auth response URL (no code):", redirectUrl);
          alert(
            "Authorization failed (no code returned). Check console for the full redirect URL.",
          );
          return;
        }

        try {
          const tokenResponse = await fetch(
            `http://localhost:3000/exchange-token`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                code: code,
                redirectUri: redirectUri,
              }),
            },
          );

          const tokenData = await tokenResponse.json();
          if (tokenData.error) {
            console.error("Token exchange error:", tokenData);
            alert(
              "Token exchange failed: " +
                tokenData.error +
                "\n\nMake sure your backend is running and GOOGLE_CLIENT_SECRET is set in .env",
            );
            return;
          }

          accessToken = tokenData.access_token;
          await setStoredTokens(
            tokenData.access_token,
            tokenData.refresh_token,
            tokenData.expires_in || 3600,
          );
          console.log("New tokens stored");

          // Now proceed with the document fetch
          await fetchAndDisplayDocument(accessToken, redirectUri);
        } catch (err) {
          console.error(err);
          alert("Error during token exchange: " + err.message);
        }
      },
    );
    return; // Exit here, the document fetch will happen in the callback
  }

  // If we reach here, we have a valid access token, proceed with document fetch
  await fetchAndDisplayDocument(accessToken, redirectUri);
};

// Separate function to fetch and display the document
async function fetchAndDisplayDocument(accessToken, redirectUri) {
  const DOC_ID = "1qcO8zJLzD9E3MGN-lYjwegx3L8TZpX2wBClnXUjG8mI"; // paste the ID from the URL

  try {
    const docResponse = await fetch(
      `https://docs.googleapis.com/v1/documents/${DOC_ID}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    if (!docResponse.ok) {
      const txt = await docResponse.text();
      throw new Error("Docs API error: " + docResponse.status + " " + txt);
    }

    const doc = await docResponse.json();

    // Extract plain text from the document
    const exercisePart4 = (doc.body?.content || []).flatMap(
      (block) => block.table || [],
    )[6].tableRows;
    let quesAndAnsArr = [];
    for (let i = 0; i < exercisePart4.length; i++) {
      if (i === 0 || i === 1) continue;
      let item = exercisePart4[i];
      let qna = item.tableCells[0].content.map((i) => i.paragraph?.elements);
      let qnaObj = {};
      for (let j = 0; j < qna.length; j++) {
        let qnaChild = qna[j];
        if (qnaChild.length > 0) {
          let question = qnaChild.find((qa) =>
            startsWithNumberDot(qa.textRun.content),
          );
          let answer = qnaChild.find((qa) =>
            startsWithArrow(qa.textRun.content),
          );
          if (question) {
            qnaObj.question = question.textRun.content;
          }
          if (answer) {
            qnaObj.answer = answer.textRun.content;
          }
          if (question) {
            quesAndAnsArr.push(qnaObj);
          }
        }
      }
    }

    console.log(quesAndAnsArr);

    const response = await fetch(`http://localhost:3000/grade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: quesAndAnsArr,
        redirectUri: redirectUri,
      }),
    });

    const text = await response.text();
    if (!response.ok) {
      console.error("Grade API error", response.status, text);
      throw new Error(`Grade API error ${response.status}: ${text}`);
    }

    try {
      const result = JSON.parse(text);
      // result.raw.split("\n")[2].substr(1, result.raw.split("\n")[2].length - 2).trim().split(" | ")
      let aiResponseArr = result.raw.split("\n");
      let quesAndAnsResponse = [];
      for (let i = 2; i < aiResponseArr.length - 2; i++) {
        let row = aiResponseArr[i].substr(1, aiResponseArr[i].length - 2).trim();
        let rowElements = row.split(' | ');
        quesAndAnsResponse.push({quesIndex: rowElements[0], quesContent: rowElements[1], studentAnswer: rowElements[2], aiAnswer: rowElements[3]});
      }
      console.log(quesAndAnsResponse);
      writeToGGDocFile(quesAndAnsResponse, DOC_ID, accessToken);
    } catch {
      console.log("Grade result (text):", text);
    }

    // test write on ggle doc file
    // let answer = "hong Ha writes: chua bài câu 2";
  } catch (err) {
    console.error(err);
    alert("Error fetching document: " + err.message);
  }
}

async function writeToGGDocFile(quesAndAnsResponse, DOC_ID, accessToken) {
  // Build requests array for batch update
  const requests = [];

  for (const [index, element] of quesAndAnsResponse.entries()) {
    // if (!containsCorrectMark(element.aiAnswer)) {
      let result  = containsCorrectMark(element.aiAnswer) ? '' : element.aiAnswer;
      if (index === quesAndAnsResponse.length - 1) {
        result += "\nCác câu còn lại đúng rồi em nha! Tiếp tục giữ phong độ này nhé!💯🔥"
      }
      requests.push({
        replaceAllText: {
          containsText: {
            text: `Đáp án câu ${element.quesIndex}`,
            matchCase: true,
          },
          replaceText: result,
        },
      });
    // }
  }

  if (requests.length === 0) {
    console.log("No updates needed");
    alert("done");
    return;
  }

  const updateResponse = await fetch(
    `https://docs.googleapis.com/v1/documents/${DOC_ID}:batchUpdate`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requests: requests,
      }),
    },
  );

  if (!updateResponse.ok) {
    const updateText = await updateResponse.text();
    console.error("Update error:", updateResponse.status, updateText);
    throw new Error(
      "Failed to update document: " + updateResponse.status + " " + updateText,
    );
  }

  console.log("Document updated successfully");

  alert("done");
}

function startsWithNumberDot(sentence) {
  return /^\d+\./.test(sentence);
}

function startsWithArrow(sentence) {
  return /^→/.test(sentence);
}

function containsCorrectMark(str) {
  return str.includes("✅ Đúng");
}

// Optional: Add a logout button functionality
document.getElementById("logout")?.addEventListener("click", async () => {
  await chrome.storage.local.remove([
    "accessToken",
    "refreshToken",
    "tokenExpiry",
  ]);
  alert("Logged out successfully. You will need to re-authenticate next time.");
});
