const DOC_ID = "1qcO8zJLzD9E3MGN-lYjwegx3L8TZpX2wBClnXUjG8mI"; // paste the ID from the URL
// const TAB_ID = "t.s7ji0uyfq6g";
const TAB_ID = "t.0";
const domain = "http://localhost:3000";

document.getElementById("processAllDocs").onclick = async () => {
  const linkText = document.getElementById("docLinks").value;
  const students = parseDocLinks(linkText);

  if (students.length === 0) {
    alert("Please enter at least one valid Google Doc link.");
    return;
  }

  // Get your accessToken logic here (omitted for brevity, use your existing flow)
  const tokens = await getStoredTokens();
  let accessToken = tokens.accessToken;

  const statusDiv = document.getElementById("status");

  for (const student of students) {
    try {
      statusDiv.innerText = `Processing Doc: ${student.docId}...`;

      // 1. Fetch content from the specific Tab
      const doc = await getTabContent(
        student.docId,
        student.tabId,
        accessToken,
      );

      // 2. Parse the table content (Part IV)
      let quesAndAnsArr = getQesAndAnsFromPartIVOfTheTargetTab(doc);
      console.log(quesAndAnsArr)

      // 3. Send to your grading backend
      const gradeResponse = await fetch(`${domain}/grade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: quesAndAnsArr }),
      });

      const result = await gradeResponse.json();

      // 4. Parse AI response and write back to the SPECIFIC Doc and TAB
      let aiResponseArr = result.raw.split("\n");
      let quesAndAnsResponse = [];
      // ... (Your existing parsing logic for aiResponseArr) ...

      // Pass the specific docId and tabId to your write function
      // await writeToGGDocFile(
      //   quesAndAnsResponse,
      //   student.docId,
      //   accessToken,
      //   student.tabId,
      // );
    } catch (err) {
      console.error(`Failed to process ${student.docId}:`, err);
    }
  }

  statusDiv.innerText = "All documents processed successfully! ✅";
};

document.getElementById("autoCheck").onclick = async () => {
  const manifest = chrome.runtime.getManifest();
  const clientId = manifest.oauth2.client_id;
  const scopes = manifest.oauth2.scopes;
  const redirectUri = chrome.identity.getRedirectURL();

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
      const refreshResponse = await fetch(`${domain}/exchange-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          refreshToken: tokens.refreshToken,
          grantType: "refresh_token",
        }),
      });

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
          const tokenResponse = await fetch(`${domain}/exchange-token`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              code: code,
              redirectUri: redirectUri,
            }),
          });

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

// Helper functions for token management
async function getStoredTokens() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ["accessToken", "refreshToken", "tokenExpiry"],
      (result) => {
        resolve(result);
      },
    );
  });
}
/**
 * Fetches text content from a specific tab in a Google Doc using the REST API.
 * @param {string} docId - The ID of the Google Document.
 * @param {string} tabId - The ID of the specific tab.
 * @param {string} accessToken - Your OAuth2 access token.
 */
async function getTabContent(docId, tabId, accessToken) {
  const url = `https://docs.googleapis.com/v1/documents/${docId}?includeTabsContent=true`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    // 1. Find the tab recursively
    const targetTab = findTabById(data.tabs, tabId);
    if (!targetTab || !targetTab.documentTab) {
      throw new Error(`Tab with ID ${tabId} not found.`);
    }

    // 2. Parse and return the text

    return targetTab;
  } catch (error) {
    console.error("Error fetching document:", error);
  }
}

// Helper functions (same logic as before)
function findTabById(tabs, id) {
  for (const tab of tabs) {
    if (tab.tabProperties.tabId === id) return tab;
    if (tab.childTabs) {
      const found = findTabById(tab.childTabs, id);
      if (found) return found;
    }
  }
  return null;
}

function getQesAndAnsFromPartIVOfTheTargetTab(targetTab) {
  const exercisePart4 = (targetTab.documentTab.body?.content || []).flatMap(
    (block) => block.table || [],
  )[6].tableRows;
  let quesAndAnsArrPartIV = [];
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
        let answer = qnaChild.find((qa) => startsWithArrow(qa.textRun.content));
        if (question) {
          qnaObj.question = question.textRun.content;
        }
        if (answer) {
          qnaObj.answer = answer.textRun.content;
        }
        if (question) {
          quesAndAnsArrPartIV.push(qnaObj);
        }
      }
    }
  }

  return quesAndAnsArrPartIV;
}

async function sendStudentExerciseToAIAgentoGetAnswer(
  quesAndAnsArrPartIV,
  redirectUri,
) {
  try {
    const response = await fetch(`${domain}/grade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: quesAndAnsArrPartIV,
        redirectUri: redirectUri,
      }),
    });
    const text = response.text();
    if (!response.ok) {
      console.error("Grade API error", response.status, text);
      throw new Error(`Grade API error ${response.status}: ${text}`);
    }
    return text;
  } catch (err) {
    console.error(err);
    alert("Error fetching document: " + err.message);
  }
}
// Separate function to fetch and display the document
async function fetchAndDisplayDocument(accessToken, redirectUri) {
  try {
    const doc = await getTabContent(DOC_ID, TAB_ID, accessToken);
    let quesAndAnsArrPartIV = getQesAndAnsFromPartIVOfTheTargetTab(doc);
    const agentResponse = await sendStudentExerciseToAIAgentoGetAnswer(
      quesAndAnsArrPartIV,
      redirectUri,
    );

    try {
      // const result = JSON.parse(agentResponse);
      // let aiResponseArr = result.raw.split("\n");
      // let quesAndAnsResponse = [];
      // for (let i = 2; i < aiResponseArr.length - 2; i++) {
      //   let row = aiResponseArr[i]
      //     .substr(1, aiResponseArr[i].length - 2)
      //     .trim();
      //   let rowElements = row.split(" | ");
      //   quesAndAnsResponse.push({
      //     quesIndex: rowElements[0],
      //     quesContent: rowElements[1],
      //     studentAnswer: rowElements[2],
      //     aiAnswer: rowElements[3],
      //   });
      // }
      // console.log(quesAndAnsResponse);
      writeToGGDocFile(agentResponse, DOC_ID, accessToken);
    } catch {
      console.log("Grade result (text):", text);
    }
  } catch (err) {
    console.error(err);
    alert("Error fetching document: " + err.message);
  }
}

async function writeToGGDocFile(agentResponse, DOC_ID, accessToken) {
  try {
    const result = JSON.parse(agentResponse);
    let aiResponseArr = result.raw.split("\n");
    let quesAndAnsResponse = [];
    for (let i = 2; i < aiResponseArr.length - 2; i++) {
      let row = aiResponseArr[i].substr(1, aiResponseArr[i].length - 2).trim();
      let rowElements = row.split(" | ");
      quesAndAnsResponse.push({
        quesIndex: rowElements[0],
        quesContent: rowElements[1],
        studentAnswer: rowElements[2],
        aiAnswer: rowElements[3],
      });
    }
    console.log(quesAndAnsResponse);
    // Build requests array for batch update
    const requests = [];

    for (const [index, element] of quesAndAnsResponse.entries()) {
      let result = containsCorrectMark(element.aiAnswer)
        ? ""
        : element.aiAnswer;

      if (index === quesAndAnsResponse.length - 1) {
        result +=
          "\nCác câu còn lại đúng rồi em nha! Tiếp tục giữ phong độ này nhé! 💯🔥";
      }

      requests.push({
        replaceAllText: {
          containsText: {
            text: `Chữa bài câu ${element.quesIndex}.`,
            matchCase: false,
          },
          replaceText: result,
          // Add this criteria to target the specific tab
          tabsCriteria: {
            tabIds: [TAB_ID],
          },
        },
      });
    }

    if (requests.length === 0) {
      console.log("No updates needed");
      alert("done");
      return;
    }

    console.log(requests);

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
        "Failed to update document: " +
          updateResponse.status +
          " " +
          updateText,
      );
    }

    console.log("Document updated successfully");

    alert("done");
  } catch (err) {}
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

function parseDocLinks(text) {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const docObjects = [];

  lines.forEach((link) => {
    // Regex to find the ID between /d/ and /edit
    const docIdMatch = link.match(/\/d\/(.+?)\//);
    // Regex to find the tab ID after tab=
    const tabIdMatch = link.match(/tab=(.+?)(&|$)/);

    if (docIdMatch) {
      docObjects.push({
        docId: docIdMatch[1],
        tabId: tabIdMatch[1] || "t.0", // Default to first tab if not found
      });
    }
  });

  return docObjects;
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
