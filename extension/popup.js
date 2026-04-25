// start create fake data
const contentMain = (async () => {
  const src = chrome.runtime.getURL('./assets/mockData.js');
  const fakeData = await import(src);
  return fakeData;
})();
// end create fake data
const project_number = "159733287448";
const statusDiv = () => document.getElementById("status");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const DOMAIN_BE_DEV = "http://localhost:3000";
const DOMAIN_BE_PROD =
  "https://backend-checker-159733287448.asia-southeast1.run.app";
const ENVIRONMENT = "dev";
const DOMAIN_BE = ENVIRONMENT === "PROD" ? DOMAIN_BE_PROD : DOMAIN_BE_DEV;
var loginBtn = document.getElementById("loginBtn");
var logoutBtn = document.getElementById("logoutBtn");
var processAllDocs = document.getElementById("processAllDocs");
var container = document.getElementById("container");
const PLEASE_LOGIN_MESSAGE = "Please login to use the extension...";
const READY_TO_PROCESS_MESSAGE = "Ready to process...";
const EXTENSION_SECRET_KEY = "SuperSecretKey_hongHa_321";
const EMPTY_ANSWER = ["→ \n", "", "→"];

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

//Get content by doc id and tab id
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
      student.exercise = doc;

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
  if (studentsExerciseList.length) {
    statusDiv().innerText = `Finished fetching content from all docs. Starting auto-check...`;
  }

  autoCheckExercises(studentsExerciseList);
}

function getTablesWhichContainStudentExercise(targetTab) {
  const tableIndex = getTableIndexOfExercise(targetTab.tabProperties.title);
  if (!tableIndex) return;
  let exercisePart4 = [];
  tableIndex.forEach((index) => {
    exercisePart4.push(
      ...(targetTab.documentTab.body?.content || []).flatMap(
        (block) => block.table || [],
      )[index].tableRows
    );
  });
  return exercisePart4;
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

          const result = await gradeResponse.json();//todo
          // const result = await contentMain.then((module) => module.fakeApiResponse);//fake data
          if (result.assistantText) {
            await writeToGGDocFile(
              result.assistantText,
              student,
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
  // Play success sound todo
  const soundUrl = chrome.runtime.getURL("assets/successful_sound.mp3");
  const sound = new Audio(soundUrl);
  await sound.play().catch((err) => console.error("Error playing sound:", err));
  // alert(`Đã chấm bài xong, bạn hãy review lại kết quả nhé!`);
  statusDiv().innerText = `Processing complete!\nGrading student's exercises completed! You can review the result!!`;
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
  // { tableIndex: [5, 6, 7, 8, 9], tabName: "BUỔI 04" }, //only 5 6 7 8
  { tableIndex: [5, 6, 7, 8], tabName: "BUỔI 04" }, //only 5 6 7 8
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
          if (question) {
            qnaObj.question = question.textRun.content;
            continue;
          }
          let answer = qnaChild.find((qa) =>
            startsWithArrow(qa.textRun.content),
          );
          if (answer) {
            qnaObj.answer = qnaChild.map(ans => ans.textRun.content).join('');
          }
          if (qnaObj.question) {
            quesAndAnsArrPartIV.push(qnaObj);
          }
        }
      }
    }
  }
  //Check if student did exercisets in part IV or not
  if (quesAndAnsArrPartIV.some(qna => !!qna.answer)) {
    return quesAndAnsArrPartIV;
  }

  return [];
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

  //Filter to get elements which contain answer
  let finalArr = quesAndAnsArrPartIV.filter(item => {
    if (!EMPTY_ANSWER.includes(item.answer.trim())) {
      return item;
    }
  });
  return finalArr;
}

/**
 * Cập nhật feedback vào đúng cột "Chữa bài" trong bảng dựa trên STT.
 */
async function writeToGGDocFile(agentResponse, student, accessToken) {
  const { docId: DOC_ID, tabId: TAB_ID, exercise } = student;

  try {
    // 1. Parse dữ liệu
    const gradingResults = parseAiResponse(agentResponse);
    if (gradingResults.length === 0) return;

    // 2. Lấy container bảng
    let contentContainer = getTablesWhichContainStudentExercise(exercise);
    // const allRequests = [];
    const groupedRequests = []; // Mảng chứa các nhóm request theo từng câu

    // 3. Duyệt kết quả chấm bài
    let currentRowPointer = 0;
    for (let item of gradingResults) {
      let feedbackText = containsCorrectMark(item.aiFeedback) ? "✅ Đúng" : item.aiFeedback;
      let targetStartIndex = -1;

      for (let j = currentRowPointer; j < contentContainer.length; j++) {
        const row = contentContainer[j];
        const firstCellText = row.tableCells[0].content
          .map(p => p.paragraph.elements.map(e => e.textRun?.content || "").join(""))
          .join("").trim();

        if (firstCellText === item.questionIndex || firstCellText.startsWith(`${item.questionIndex}.`)) {
          const cellIndex = row.tableCells.length - 1;
          const targetCell = row.tableCells[cellIndex];

          // Lấy startIndex an toàn (bên trong đoạn văn đầu tiên của ô)
          targetStartIndex = targetCell.content[0].startIndex;
          currentRowPointer = j + 1;
          break;
        }
      }

      // 4. Tạo Styled Requests (Xử lý in đậm **)
      if (targetStartIndex !== -1) {
        const styledReqs = createStyledTextRequests(feedbackText, targetStartIndex, TAB_ID);
        groupedRequests.push({
          startIndex: targetStartIndex,
          subRequests: styledReqs
        });
      }
    }

    // 2. Sắp xếp các NHÓM theo thứ tự Index giảm dần
    groupedRequests.sort((a, b) => b.startIndex - a.startIndex);

    // 3. Làm phẳng mảng để gửi đi
    const finalRequests = groupedRequests.flatMap(group => group.subRequests);
    // 5. Gửi batchUpdate
    if (finalRequests.length > 0) {

      const updateResponse = await fetch(
        `https://docs.googleapis.com/v1/documents/${DOC_ID}:batchUpdate`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            'x-goog-user-project': project_number // Hãy đảm bảo biến này đã được định nghĩa
          },
          body: JSON.stringify({ requests: finalRequests }),
        }
      );

      if (!updateResponse.ok) {
        const err = await updateResponse.json();
        console.error("Detail:", err);
        throw new Error("Lỗi cập nhật Google Doc");
      }
      console.log("Đã cập nhật bảng thành công với format in đậm!");
    }

  } catch (error) {
    console.error(error);
    alert("Có lỗi xảy ra: " + error.message);
  }
}

function parseAiResponse(agentResponse) {
  const responseLines = agentResponse.split("\n");
  const results = [];
  for (const line of responseLines) {
    if (line.includes("|") && !line.includes("---")) {
      const cleanLine = line.trim().replace(/^\||\|$/g, "");
      const columns = cleanLine.split("|").map((col) => col.trim());
      if (columns.length >= 4 && (columns[0] === "" || /^\d+$/.test(columns[0]))) {
        results.push({
          questionIndex: columns[0],
          aiFeedback: columns[3],
        });
      }
    }
  }
  return results;
}

/**
 * Tách text theo format **bold** và tạo danh sách các request tương ứng.
 * currentOffset giúp theo dõi vị trí chèn liên tiếp trong cùng một ô.
 */
function createStyledTextRequests(text, baseIndex, TAB_ID) {
  const requests = [];
  const boldRegex = /\*\*(.*?)\*\*/g;
  let lastIndex = 0;
  let match;
  let currentOffset = 0;

  while ((match = boldRegex.exec(text)) !== null) {
    const plainTextBefore = text.substring(lastIndex, match.index);
    const boldText = match[1];

    // 1. Chèn đoạn text thường phía trước
    if (plainTextBefore) {
      requests.push({
        insertText: { location: { index: baseIndex + currentOffset }, text: plainTextBefore },
      });
      currentOffset += plainTextBefore.length;
    }

    // 2. Chèn đoạn text cần in đậm
    requests.push({
      insertText: { location: { index: baseIndex + currentOffset }, text: boldText },
    });

    // 3. Lệnh in đậm cho đoạn vừa chèn
    requests.push({
      updateTextStyle: {
        range: {
          startIndex: baseIndex + currentOffset,
          endIndex: baseIndex + currentOffset + boldText.length
        },
        textStyle: { bold: true },
        fields: "bold"
      }
    });

    currentOffset += boldText.length;
    lastIndex = boldRegex.lastIndex;
  }

  // Chèn nốt phần text còn lại sau dấu ** cuối cùng
  const remainingText = text.substring(lastIndex);
  if (remainingText) {
    requests.push({
      insertText: { location: { index: baseIndex + currentOffset }, text: remainingText },
    });
  }

  return requests;
}

/**
 * Tách text theo format **bold** và tạo danh sách các request tương ứng.
 * Đảm bảo chỉ in đậm nội dung bên trong cặp dấu **.
 */
function createStyledTextRequests(text, baseIndex) {
  const requests = [];
  const boldRegex = /\*\*(.*?)\*\*/g;
  let lastIndex = 0;
  let match;
  let currentOffset = 0;

  while ((match = boldRegex.exec(text)) !== null) {
    const plainTextBefore = text.substring(lastIndex, match.index);
    const boldText = match[1];

    // 1. Chèn đoạn text thường phía trước và đảm bảo KHÔNG in đậm
    if (plainTextBefore) {
      const start = baseIndex + currentOffset;
      requests.push({
        insertText: { location: { index: start }, text: plainTextBefore }
      });
      requests.push({
        updateTextStyle: {
          range: { startIndex: start, endIndex: start + plainTextBefore.length },
          textStyle: { bold: false },
          fields: "bold"
        },
      });
      currentOffset += plainTextBefore.length;
    }

    // 2. Chèn đoạn text cần in đậm
    const boldStart = baseIndex + currentOffset;
    requests.push({
      insertText: { location: { index: boldStart }, text: boldText },
    });

    // 3. Lệnh in đậm CHỈ cho đoạn boldText
    requests.push({
      updateTextStyle: {
        range: { startIndex: boldStart, endIndex: boldStart + boldText.length },
        textStyle: { bold: true },
        fields: "bold"
      },
    });

    currentOffset += boldText.length;
    lastIndex = boldRegex.lastIndex;
  }

  // 4. Chèn nốt phần text còn lại và RESET in đậm về false
  const remainingText = text.substring(lastIndex);
  if (remainingText) {
    const finalStart = baseIndex + currentOffset;
    requests.push({
      insertText: { location: { index: finalStart }, text: remainingText },
    });
    requests.push({
      updateTextStyle: {
        range: { startIndex: finalStart, endIndex: finalStart + remainingText.length },
        textStyle: { bold: false },
        fields: "bold"
      },
    });
  }

  return requests;
}


function addTeacherFeedback(requests, TAB_ID) {
  const teacherFeedback = "Nhận xét chung của Giáo viên: Các câu còn lại đúng rồi em nha! Tiếp tục cố gắng và cẩn thận thế này nhé em! 💯🔥";
  const feedBackRequest = {
    replaceAllText: {
      containsText: {
        text: `Nhận xét chung của Giáo viên: `,
        matchCase: false,
      },
      replaceText: teacherFeedback,
    },
    // Only include tabsCriteria if a valid TAB_ID exists to prevent 500 errors
    ...(TAB_ID ? { tabsCriteria: { tabIds: [TAB_ID] } } : {}),
  };
  return feedBackRequest;
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


// Cách dùng:
// writeToSpecificCell(DOC_ID, "2", "Câu 2 chưa đúng", accessToken);
// writeToSpecificCell(DOC_ID, "18", "Câu 18 đúng rồi", accessToken);
async function writeToSpecificCell(DOC_ID, questionNumber, feedbackText, accessToken) {
  try {
    // Bước 1: Lấy cấu trúc document
    const docResponse = await fetch(`https://docs.googleapis.com/v1/documents/${DOC_ID}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const doc = await docResponse.json();

    let writeIndex = -1;

    // Bước 2: Tìm bảng và hàng tương ứng
    for (const content of doc.body.content) {
      if (content.table) {
        for (const row of content.table.tableRows) {
          // Ô đầu tiên (index 0) thường chứa số thứ tự "1.", "2."...
          const firstCellText = row.tableCells[0].content
            .map(c => c.paragraph.elements.map(e => e.textRun.content).join(''))
            .join('').trim();

          // Kiểm tra xem hàng này có phải là câu mình cần không (ví dụ: "2.")
          if (firstCellText.startsWith(`${questionNumber}.`)) {
            // Lấy ô cuối cùng (Cột "Chữa bài" - index 2)
            const targetCell = row.tableCells[2];
            // Vị trí bắt đầu để ghi vào ô này (trừ đi 1 để nằm trong ô)
            writeIndex = targetCell.startIndex + 1;
            break;
          }
        }
      }
    }

    if (writeIndex === -1) {
      console.warn(`Không tìm thấy hàng cho câu số ${questionNumber}`);
      return;
    }

    // Bước 3: Gửi yêu cầu chèn text
    const requests = [{
      insertText: {
        location: { index: writeIndex },
        text: feedbackText
      }
    }];

    await fetch(`https://docs.googleapis.com/v1/documents/${DOC_ID}:batchUpdate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ requests }),
    });

    console.log(`Đã ghi nội dung vào câu ${questionNumber}`);
  } catch (error) {
    console.error("Lỗi:", error);
  }
}
