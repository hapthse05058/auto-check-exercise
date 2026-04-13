const statusDiv = () => document.getElementById("status");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const DOMAIN_BE_DEV = "http://localhost:3000";
const DOMAIN_BE_PROD =
  "https://backend-checker-159733287448.asia-southeast1.run.app";
const ENVIRONMENT = "PROD";
const DOMAIN_BE = ENVIRONMENT === "PROD" ? DOMAIN_BE_PROD : DOMAIN_BE_DEV;
var loginBtn = document.getElementById("loginBtn");
var logoutBtn = document.getElementById("logoutBtn");
var processAllDocs = document.getElementById("processAllDocs");
var container = document.getElementById("container");
const PLEASE_LOGIN_MESSAGE = "Please login to use the extension...";
const READY_TO_PROCESS_MESSAGE = "Ready to process...";
const EXTENSION_SECRET_KEY = "SuperSecretKey_hongHa_321";

function handleAfterLogout() {
  statusDiv().innerText = PLEASE_LOGIN_MESSAGE;
  container.style.display = "none";
  loginBtn.style.display = "block";
  logoutBtn.style.display = "none";
}
function handleAfterLogin() {
  statusDiv().innerText = READY_TO_PROCESS_MESSAGE;
  container.style.display = "block";
  loginBtn.style.display = "none";
  logoutBtn.style.display = "block";
  console.log("Login successful! Token stored.");
}

document.addEventListener("DOMContentLoaded", async () => {
  console.log("Popup has initialized!");
  // 1. Initialize global variables or UI
  const status = document.getElementById("status");
  // 2. Load stored data (like your accessToken)
  const data = await chrome.storage.local.get(["access_token"]);
  if (data.access_token) {
    console.log("Token found on init:", data.access_token);
    handleAfterLogin();
  } else {
    handleAfterLogout();
  }
});

async function ensureValidToken() {
  const result = await new Promise((resolve) => {
    chrome.storage.local.get(["access_token", "expiry_date"], resolve);
  });

  const now = Date.now();
  // Nếu token còn hạn trên 5 phút, dùng tiếp
  if (
    result.access_token &&
    result.expiry_date &&
    result.expiry_date - now > 300000
  ) {
    // handleAfterLogin();
    return result.access_token;
  }

  // Nếu token hết hạn, thử refresh ngầm
  try {
    return await refreshSilentToken();
  } catch (err) {
    console.warn("Silent refresh failed:", err);
    // QUAN TRỌNG: Thông báo cho user biết cần login thủ công
    statusDiv().innerText =
      "Session expired. Please click 'Login' to continue.";
    handleAfterLogout();
    throw new Error("RE-AUTH_NEEDED");
  }
}

async function refreshSilentToken() {
  const result = await new Promise((resolve) => {
    chrome.storage.local.get(
      ["refresh_token", "refresh_token_expires_date"],
      resolve,
    );
  });
  if (
    !result.refresh_token ||
    result.refresh_token_expires_date - Date.now() <= 0
  ) {
    handleAfterLogout();
    statusDiv().innerText = "No refresh token available. Please login again.";
    throw new Error("No refresh token available. Please login again.");
  }
  try {
    const response = await fetch(`${DOMAIN_BE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: result.refresh_token }),
    });

    if (!response.ok) {
      handleAfterLogout();
      statusDiv().innerText = "Failed to refresh token. Please login again.";
      throw new Error("Failed to refresh token");
    }

    const data = await response.json();

    // Cập nhật Access Token mới vào storage
    await chrome.storage.local.set({
      access_token: data.access_token,
      expiry_date: data.expiry_date,
      refresh_token: data.refresh_token,
      refresh_token_expires_date: data.refresh_token_expires_date,
    });

    handleAfterLogin();
    return data.access_token;
  } catch (error) {
    console.error("Refresh error:", error);
    handleAfterLogout();
    statusDiv().innerText = "Error refreshing token. Please login again.";
    throw error;
  }
}

// --- CẬP NHẬT: HÀM PROCESS ĐỂ TỰ REFRESH ---
async function processDocs() {
  const links = parseDocLinks(document.getElementById("docLinks").value);
  if (!links.length) {
    alert("Please enter at least one valid Google Doc link.");
    return;
  }

  let accessToken;

  let studentsExerciseList = [];
  for (const student of links) {
    statusDiv().innerText = `Processing Doc: ${student.docId}...`;
    try {
      // Trước mỗi lần gọi API lớn, nên check lại token nếu list docs quá dài
      accessToken = await ensureValidToken();

      const doc = await getTabContent(
        student.docId,
        student.tabId,
        accessToken,
      );
      if (!doc) continue;

      let quesAndAnsArr = getQesAndAnsFromPartIVOfTheTargetTab(doc);
      if (quesAndAnsArr && quesAndAnsArr.length > 0) {
        studentsExerciseList.push({
          quesAndAnsArr: quesAndAnsArr,
          student: student,
        });
      }
    } catch (err) {
      console.error(err);
      statusDiv().innerText = `Failed ${student.docId}: ${err.message}`;
    }
  }
  statusDiv().innerText = `Finished fetching content from all docs. Starting auto-check...`;

  autoCheckExercises(studentsExerciseList);
}

async function autoCheckExercises(studentsExerciseList) {
  if (!studentsExerciseList.length) return;

  const CONCURRENCY_LIMIT = 5;
  const chunks = chunkArray(studentsExerciseList, CONCURRENCY_LIMIT);

  for (const chunk of chunks) {
    await Promise.all(
      chunk.map(async (stuExercise, index) => {
        await sleep(index * 25000);

        // Refresh token trước khi viết file vì quá trình chờ AI có thể rất lâu (25s * index)
        const currentToken = await ensureValidToken();

        const { quesAndAnsArr, student } = stuExercise;
        try {
          const gradeResponse = await fetch(`${DOMAIN_BE}/grade`, {
            method: "POST",
            headers: { 
              "Authorization": `Bearer ${currentToken}`,
              "Content-Type": "application/json",
              "x-api-key": EXTENSION_SECRET_KEY,
            },
            body: JSON.stringify({ items: quesAndAnsArr }),
          });

          const result = await gradeResponse.json();
          if (result.assistantText) {
            await writeToGGDocFile(
              result.assistantText,
              student.docId,
              student.tabId,
              currentToken,
            );
          }
        } catch (err) {
          console.error("AutoCheck Error:", err);
        }
      }),
    );
    statusDiv().innerText += `\n Complete handling ${chunk.length} doc, continue...`;
  }
  alert(`Đã chấm bài xong, bạn hãy review lại kết quả nhé!`);
  statusDiv().innerText = "Processing complete!";
}

document.getElementById("loginBtn").onclick = () => {
  const status = statusDiv();
  status.innerText = "Logging in...";

  const manifest = chrome.runtime.getManifest();
  const clientId = manifest.oauth2.client_id;
  const scopes = manifest.oauth2.scopes;
  const redirectUri = chrome.identity.getRedirectURL();

  // Trong popup.js - Hàm Login
  const authUrl =
    `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${encodeURIComponent(clientId)}&` +
    `response_type=code&` + // Chuyển thành 'code' thay vì 'token'
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `scope=${encodeURIComponent(scopes.join(" "))}&` +
    `prompt=consent&` +
    `access_type=offline&` + // BẮT BUỘC để lấy Refresh Token
    `include_granted_scopes=true`;

  chrome.identity.launchWebAuthFlow(
    { url: authUrl, interactive: true },
    async (redirectUrl) => {
      const url = new URL(redirectUrl);
      const code = url.searchParams.get("code"); // Lấy 'code' từ query string

      if (code) {
        // Gửi code này lên Backend của bạn để xử lý đổi Token
        const response = await fetch(`${DOMAIN_BE}/auth/google`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
        const tokens = await response.json();

        // Lưu Access Token và Refresh Token vào storage
        chrome.storage.local.set({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token, // Lưu Refresh Token ở đây
          refresh_token_expires_date: tokens.refresh_token_expires_date, // Lưu thời gian hết hạn của Refresh Token
          expiry_date: tokens.expiry_date,
        });
        handleAfterLogin();
        status.innerText = READY_TO_PROCESS_MESSAGE;
      }
    },
  );
};

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
    chrome.storage.local.get(["access_token"], (result) => {
      resolve({ accessToken: result.accessToken || "" });
    });
  });
}

// function setStoredToken(accessToken) {
//   return new Promise((resolve) => {
//     chrome.storage.local.set({ accessToken }, () => resolve());
//   });
// }

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
const chunkArray = (array, size) => {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
};

document.getElementById("processAllDocs").onclick = processDocs;

document.getElementById("logoutBtn").onclick = () => {
  chrome.identity.getAuthToken({ interactive: false }, (token) => {
    if (token) {
      chrome.identity.removeCachedAuthToken({ token }, () => {
        chrome.storage.local.remove("access_token", () => {
          statusDiv().innerText = PLEASE_LOGIN_MESSAGE;
        });
      });
    } else {
      chrome.storage.local.remove("access_token", () => {
        statusDiv().innerText = PLEASE_LOGIN_MESSAGE;
      });
    }
    handleAfterLogout();
  });
};

const TAB_NAME_LIST = [
  { tableIndex: [5], tabName: "BUỔI 02" },
  { tableIndex: [5], tabName: "BUỔI 03" },
  { tableIndex: [5, 6, 7, 8, 9], tabName: "BUỔI 04" },
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
        let qnaObj = getComplexSentence(qna);
        if (qnaObj.question) quesAndAnsArrPartIV.push(qnaObj);
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
  let qnaObj = { question: "", answer: "" };
  for (let j = 0; j < qna.length; j++) {
    let qnaChild = qna[j];
    if (startsWithNumberDot(qnaChild)) {
      qnaObj.question = qnaChild;
    } else if (startsWithArrow(qnaChild)) {
      if (!qnaObj.answer) {
        qnaObj.answer = qnaChild;
      } else {
        qnaObj.answer += "\n" + qnaChild;
      }
    } else {
      if (qnaObj.question) {
        qnaObj.question += "\n" + qnaChild;
      }
    }
  }
  return qnaObj;
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
  return ["BUỔI 15", "BUỔI 16", "BUỔI 17", "BUỔI 22"].find((tabName) =>
    tabTitle.includes(tabName),
  );
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

  return quesAndAnsArrPartIV;
}

// async function sendStudentExerciseToAIAgentoGetAnswer(
//   quesAndAnsArrPartIV,
//   redirectUri,
// ) {
//   try {
//     const response = await fetch(`${domain}/grade`, {
//       method: "POST",
//       headers: {
//         "Authorization": `Bearer ${auth}`,
//         "Content-Type": "application/json",
//         "x-api-key": "MA_BI_MAT_CUA_BAN", // Vẫn giữ lớp bảo vệ này
//       },
//       body: JSON.stringify({
//         items: quesAndAnsArrPartIV,
//         redirectUri: redirectUri,
//       }),
//     });
//     const text = response.text();
//     if (!response.ok) {
//       throw new Error(`Grade API error ${response.status}: ${text}`);
//     }
//     return text;
//   } catch (err) {
//     alert("Error fetching document: " + err.message);
//   }
// }

/**
 * Processes the AI response and updates the specific Google Doc and Tab.
 * @param {string} agentResponse - The raw text response from the OpenAI Assistant.
 * @param {string} DOC_ID - The unique ID of the Google Document.
 * @param {string} TAB_ID - The specific Tab ID (if applicable).
 * @param {string} accessToken - The Google OAuth2 access token.
 */
async function writeToGGDocFile(agentResponse, DOC_ID, TAB_ID, accessToken) {
  try {
    // 1. Clean the response by removing AI source citations (e.g., 【4:0†source】)
    // const cleanResponse = agentResponse.replace(/【.*?】/g, "");
    const responseLines = agentResponse.split("\n");
    const gradingResults = [];

    // 2. Parse the Markdown table rows dynamically
    for (const line of responseLines) {
      // Look for lines containing the pipe character (|) excluding table separators (---)
      if (line.includes("|") && !line.includes("---")) {
        // Remove leading and trailing pipes, then split into cells
        const cleanLine = line.trim().replace(/^\||\|$/g, "");
        const columns = cleanLine.split("|").map((col) => col.trim());
        // Ensure the row has enough columns (Index, Content, Student Answer, AI Feedback) and
        // Check if questionIndex property is either empty (for sub-questions) or a number (for main questions)
        if (
          columns.length >= 4 &&
          (columns[0] === "" || /^\d+$/.test(columns[0]))
        ) {
          //column[0] is either question index (1, 3, 4, 5,...) or empty (for sub-questions)
          gradingResults.push({
            questionIndex: columns[0],
            aiFeedback: columns[3],
          });
        }
      }
    }

    const requests = [];

    // 3. Build the batchUpdate request array
    for (let [index, item] of gradingResults.entries()) {
      // If the AI marks it correct (e.g., with a checkmark), we leave the text empty or skip
      let feedbackText = containsCorrectMark(item.aiFeedback)
        ? ""
        : item.aiFeedback;

      // Append a congratulatory message only to the very last processed item
      if (index === gradingResults.length - 1) {
        feedbackText = feedbackText ? (feedbackText += "\n") : "";
        feedbackText +=
          "Các câu còn lại đúng rồi em nha! Tiếp tục cố gắng và cẩn thận thế này nhé em! 💯🔥";
      }

      if (item.questionIndex) {
        requests.push({
          replaceAllText: {
            containsText: {
              // Matches the placeholder in the Doc.
              // Removed the trailing dot for better matching flexibility.
              text: `Chữa bài câu ${item.questionIndex}.`,
              matchCase: false,
            },
            replaceText: feedbackText,
            // Only include tabsCriteria if a valid TAB_ID exists to prevent 500 errors
            ...(TAB_ID ? { tabsCriteria: { tabIds: [TAB_ID] } } : {}),
          },
        });
      }
      //Handle sub-question cases: If questionIndex is empty, it means it's a sub-question of the previous question. We will append the feedback to the previous question's feedback.
      else if (item.questionIndex === "" && feedbackText) {
        const lastIndex = requests.length - 1;
        const previousQuestion = gradingResults[index - 1];
        feedbackText = requests[lastIndex].replaceAllText.replaceText
          ? requests[lastIndex].replaceAllText.replaceText +
            "\n\n" +
            feedbackText
          : feedbackText;
        // Update the previous request to include this feedback as well
        requests[lastIndex] = {
          replaceAllText: {
            containsText: {
              // Matches the placeholder in the Doc.
              // Removed the trailing dot for better matching flexibility.
              text: `Chữa bài câu ${previousQuestion.questionIndex}.`,
              matchCase: false,
            },
            replaceText: feedbackText,
            // Only include tabsCriteria if a valid TAB_ID exists to prevent 500 errors
            ...(TAB_ID ? { tabsCriteria: { tabIds: [TAB_ID] } } : {}),
          },
        };
      }
    }

    // 4. Handle empty request cases
    if (requests.length === 0) {
      console.warn(
        "No valid grading data could be parsed from the AI response.",
      );
      return;
    }

    // 5. Execute the batchUpdate call to Google Docs API
    const updateResponse = await fetch(
      `https://docs.googleapis.com/v1/documents/${DOC_ID}:batchUpdate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ requests }),
      },
    );

    // 6. Error handling for the API response
    if (!updateResponse.ok) {
      const errorDetail = await updateResponse.json();
      console.error("Google Docs API Request Failed:", errorDetail);
      throw new Error(
        `Google API Error: ${updateResponse.status} - ${JSON.stringify(errorDetail)}`,
      );
    }

    console.log(`Document [${DOC_ID}] updated successfully.`);
  } catch (error) {
    // Log the full error for debugging; do not leave the catch block empty
    console.error(error);
    alert(error.message);
  }
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
