
const statusDiv = () => document.getElementById("status");

const DOMAIN_BE = "http://localhost:3000";

function parseDocLinks(text) {
  const links = [];
  const lines = text.split("\n");
  lines.forEach((line) => {
    const match = line.match(/\/document\/d\/([a-zA-Z0-9-_]+)/);
    if (match) {
      links.push({ docId: match[1], tabId: "t.0" });
    }
  });
  return links;
}

function getStoredTokens() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["accessToken"], (result) => {
      resolve({ accessToken: result.accessToken || "" });
    });
  });
}

function setStoredToken(accessToken) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ accessToken }, () => resolve());
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
async function processDocs() {
  const links = parseDocLinks(document.getElementById("docLinks").value);
  if (!links.length) {
    alert("Please enter at least one valid Google Doc link.");
    return;
  }

  const { accessToken } = await getStoredTokens();
  if (!accessToken) {
    statusDiv().innerText = "Error: No access token found. Please login first.";
    return;
  }

  for (const student of links) {
    statusDiv().innerText = `Processing Doc: ${student.docId}...`;
    try {
      const doc = await getTabContent(
        student.docId,
        student.tabId,
        accessToken,
      );
      statusDiv().innerText = `Processed ${student.docId}`;
      if (!doc) continue;
      // 2. Parse the table content (Part IV)
      let quesAndAnsArr = getQesAndAnsFromPartIVOfTheTargetTab(doc);
      if (quesAndAnsArr) {
        // 3. Send to your grading backend
        const gradeResponse = await fetch(`${DOMAIN_BE}/grade`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: quesAndAnsArr }),
        });

        const result = await gradeResponse.json();
        if (result) {
          // 4. Parse AI response and write back to the SPECIFIC Doc and TAB
          // ... (Your existing parsing logic for aiResponseArr) ...
          // Pass the specific docId and tabId to your write function
          await writeToGGDocFile(
            result.assistantText,
            student.docId,
            student.tabId,
            accessToken
          );
        }
      }
    } catch (err) {
      console.error(err);
      statusDiv().innerText = `Failed ${student.docId}: ${err.message}`;
    }
  }

  statusDiv().innerText = "Processing complete!";
}

document.getElementById("processAllDocs").onclick = processDocs;

document.getElementById("loginBtn").onclick = () => {
  const status = statusDiv();
  status.innerText = "Logging in...";

  const manifest = chrome.runtime.getManifest();
  const clientId = manifest.oauth2.client_id;
  const scopes = manifest.oauth2.scopes;
  const redirectUri = chrome.identity.getRedirectURL();

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&response_type=token&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes.join(" "))}&prompt=consent&include_granted_scopes=true`;

  chrome.identity.launchWebAuthFlow(
    { url: authUrl, interactive: true },
    (redirectUrl) => {
      if (chrome.runtime.lastError || !redirectUrl) {
        const err = chrome.runtime.lastError
          ? chrome.runtime.lastError.message
          : "No redirect URL";
        status.innerText = `Login error: ${err}`;
        console.error("Auth error", chrome.runtime.lastError, redirectUrl);
        return;
      }

      try {
        const returned = new URL(redirectUrl);
        const params = new URLSearchParams(returned.hash.substring(1));
        const accessToken = params.get("access_token");
        const expiresIn = parseInt(params.get("expires_in") || "3600", 10);

        if (!accessToken) {
          status.innerText = "Login error: no access token returned";
          console.error("No access token in redirect URL:", redirectUrl);
          return;
        }

        chrome.storage.local.set(
          { accessToken, tokenExpiry: Date.now() + expiresIn * 1000 },
          () => {
            status.innerText = "Login successful! Token stored.";
          },
        );
      } catch (e) {
        status.innerText = "Login error: invalid auth response";
        console.error("Auth response parsing error", e, redirectUrl);
      }
    },
  );
};

document.getElementById("logout").onclick = () => {
  chrome.identity.getAuthToken({ interactive: false }, (token) => {
    if (token) {
      chrome.identity.removeCachedAuthToken({ token }, () => {
        chrome.storage.local.remove("accessToken", () => {
          statusDiv().innerText = "Logged out";
        });
      });
    } else {
      chrome.storage.local.remove("accessToken", () => {
        statusDiv().innerText = "Logged out";
      });
    }
  });
};

const TAB_NAME_LIST = [
  { tableIndex: [5], tabName: "BUỔI 02" },
  { tableIndex: [5], tabName: "BUỔI 03" },
  { tableIndex: [5], tabName: "BUỔI 04" },
  { tableIndex: [5, 6, 7], tabName: "BUỔI 05" },
  { tableIndex: [7, 8, 9], tabName: "BUỔI 09" },
  { tableIndex: [7], tabName: "BUỔI 10" },
  { tableIndex: [7], tabName: "BUỔI 11" },
  { tableIndex: [7], tabName: "BUỔI 12" },
  { tableIndex: [7], tabName: "BUỔI 13" },
  { tableIndex: [7], tabName: "BUỔI 14" },
  { tableIndex: [7], tabName: "BUỔI 15" },
  { tableIndex: [7], tabName: "BUỔI 16" },
  { tableIndex: [7], tabName: "BUỔI 17" },
  { tableIndex: [7], tabName: "BUỔI 18" },
  { tableIndex: [7], tabName: "BUỔI 21" },
  { tableIndex: [7], tabName: "BUỔI 22" },
  { tableIndex: [7], tabName: "BUỔI 23" },
];

function getTableIndexOfExercise(tabName) {
  const foundTab = TAB_NAME_LIST.find((item) => tabName.includes(item.tabName));
  return foundTab ? foundTab.tableIndex : null;
}

function getQuesAndAnsForLesson23(exercisePart4) {
  let quesAndAnsArrPartIV = [];
  for (let i = 0; i < exercisePart4.length; i++) {
    if (![0, 1].includes(i)) {
      let item = exercisePart4[i];
      let qna = item.tableCells[0].content.map(
        (item) => item.paragraph.elements[0].textRun,
      );

      if (qna.length < 3) {
        let qnaObj = getNormalSentence(qna);
        if (qnaObj) quesAndAnsArrPartIV.push(qnaObj);
      } else if (qna.length === 3) {
        qna = qna.map((item) => item.content);
        let ques = [qna[0], qna[1]].join("");
        let ans = qna[2];
        let qnaObj = { question: ques, answer: ans };
        if (qnaObj) quesAndAnsArrPartIV.push(qnaObj);
      }
    }
  }

  return quesAndAnsArrPartIV;
}

//Hanlde special lesson: Buổi 15, 16, 17. Excercise part III contain complex senctence
function getQuesAndAnsForSpecialLesson(exercisePart4) {
  let quesAndAnsArrPartIV = [];
  for (let i = 0; i < exercisePart4.length; i++) {
    if (![0, 1].includes(i)) {
      let item = exercisePart4[i];
      let qna = item.tableCells[0].content.map(
        (item) => item.paragraph.elements[0].textRun,
      );

      if (qna.length < 4) {
        let qnaObj = getNormalSentence(qna);
        if (qnaObj) quesAndAnsArrPartIV.push(qnaObj);
      } else {
        qna = item.tableCells[0].content.map((item) => {
          if (item.paragraph.elements.length === 1) {
            return item.paragraph.elements[0].textRun.content;
          }
          let content = item.paragraph.elements
            .map((item) => item.textRun?.content)
            .join("");
          return content;
        });
        let qnaObjArr = getComplexSentence(qna);
        if (qnaObjArr.length) quesAndAnsArrPartIV.push(...qnaObjArr);
      }
    }
  }

  return quesAndAnsArrPartIV;
}

function getNormalSentence(qna) {
  let qnaObj = {};
  for (let j = 0; j < qna.length; j++) {
    let qnaChild = qna[j].content;
    let question = startsWithNumberDot(qnaChild) ? qnaChild : null;
    let answer = startsWithArrow(qnaChild) ? qnaChild : null;
    if (question) {
      qnaObj.question = question;
    }
    if (answer) {
      qnaObj.answer = answer;
    }
  }
  if (qnaObj.question) return qnaObj;
}

function getComplexSentence(qna) {
  let qnaObjArr = [];
  let qnaObj = {};
  for (let j = 0; j < qna.length; j++) {
    let qnaChild = qna[j];
    if (startsWithNumberDot(qnaChild) || !startsWithArrow(qnaChild)) {
      qnaObj.question = qnaChild;
    } else if (startsWithArrow(qnaChild)) {
      qnaObj.answer = qnaChild;
    }
    if (qnaObj.question && qnaObj.answer) {
      qnaObjArr.push(qnaObj);
      qnaObj = {};
    }
  }
  return qnaObjArr;
}

function getQuesAndAnsForNormalLession(exercisePart4) {
  let quesAndAnsArrPartIV = [];
  for (let i = 0; i < exercisePart4.length; i++) {
    if (![0, 1].includes(i)) {
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
            quesAndAnsArrPartIV.push(qnaObj);
          }
        }
      }
    }
  }

  return quesAndAnsArrPartIV;
}

function isSpecialLesson(tabTitle) {
  return ["BUỔI 15", "BUỔI 16", "BUỔI 17", "BUỔI 22"].includes(tabTitle);
}

function getQesAndAnsFromPartIVOfTheTargetTab(targetTab) {
  const tableIndex = getTableIndexOfExercise(targetTab.tabProperties.title);
  if (!tableIndex) return;
  let exercisePart4 = [];
  tableIndex.forEach((index) => {
    exercisePart4.push(
      ...(targetTab.documentTab.body?.content || []).flatMap(
        (block) => block.table || [],
      )[index].tableRows,
    );
  });
  let quesAndAnsArrPartIV = [];
  if (targetTab.tabProperties.title === "BUỔI 23") {
    quesAndAnsArrPartIV = getQuesAndAnsForLesson23(exercisePart4);
  } else if (isSpecialLesson(targetTab.tabProperties.title)) {
    quesAndAnsArrPartIV = getQuesAndAnsForSpecialLesson(exercisePart4);
  } else {
    quesAndAnsArrPartIV = getQuesAndAnsForNormalLession(exercisePart4);
  }

  console.log(quesAndAnsArrPartIV);
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
      throw new Error(`Grade API error ${response.status}: ${text}`);
    }
    return text;
  } catch (err) {
    alert("Error fetching document: " + err.message);
  }
}
async function writeToGGDocFile(agentResponse, DOC_ID, TAB_ID, accessToken) {
  try {
    let aiResponseArr = agentResponse.split("\n");
    let quesAndAnsResponse = [];
    for (let i = 2; i < aiResponseArr.length - 2; i++) {
      let row = aiResponseArr[i].substr(1, aiResponseArr[i].length - 2).trim();
      let rowElements = row.split(" | ").map(item => item.trim());
      quesAndAnsResponse.push({
        quesIndex: rowElements[0],
        quesContent: rowElements[1],
        studentAnswer: rowElements[2],
        aiAnswer: rowElements[3],
      });
    }
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
        "Failed to update document: " +
          updateResponse.status +
          " " +
          updateText,
      );
    }

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
