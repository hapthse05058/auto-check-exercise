import type { QnaItem, GradeResponseItem, StudentDoc } from '../types';

// ---------- helpers ----------

function findTabById(tabs: unknown[], id: string): Record<string, unknown> | null {
  for (const tab of tabs as Record<string, unknown>[]) {
    if ((tab.tabProperties as Record<string, unknown>)?.tabId === id) return tab;
    const children = (tab.childTabs as unknown[]) ?? [];
    const found = findTabById(children, id);
    if (found) return found;
  }
  return null;
}

function startsWithNumberDot(text: string): boolean {
  return /^\d+\./.test(text);
}

function startsWithArrow(text: string): boolean {
  return /^→/.test(text);
}

// ---------- public API ----------

export async function getTabContent(
  docId: string,
  tabId: string,
  accessToken: string,
): Promise<Record<string, unknown>> {
  const url = `https://docs.googleapis.com/v1/documents/${docId}?includeTabsContent=true`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });
  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

  const data = await response.json();
  const targetTab = findTabById(data.tabs as unknown[], tabId);
  if (!targetTab?.documentTab) throw new Error(`Tab ${tabId} not found.`);
  return targetTab;
}

export function getQnaFromPartIV(targetTab: Record<string, unknown>): QnaItem[] {
  const docTab = targetTab.documentTab as Record<string, unknown>;
  const body = docTab.body as Record<string, unknown>;
  const content = (body?.content as unknown[]) ?? [];

  const exercisePart4 = content
    .flatMap((block) => (block as Record<string, unknown>).table ?? []) as Record<string, unknown>[];

  // Table index 6 = Part IV (0-based)
  const tableRows = (exercisePart4[6]?.tableRows as Record<string, unknown>[]) ?? [];
  const result: QnaItem[] = [];

  for (let i = 2; i < tableRows.length; i++) {
    const cells = (tableRows[i].tableCells as Record<string, unknown>[])[0];
    const cellContent = (cells.content as Record<string, unknown>[]).map(
      (c) => (c.paragraph as Record<string, unknown>)?.elements,
    );

    let qnaObj: Partial<QnaItem> = {};

    for (const elements of cellContent) {
      if (!Array.isArray(elements) || elements.length === 0) continue;

      const question = elements.find((e) =>
        startsWithNumberDot((e as Record<string, unknown>).textRun
          ? ((e as Record<string, unknown>).textRun as Record<string, unknown>).content as string
          : ''),
      );
      const answer = elements.find((e) =>
        startsWithArrow((e as Record<string, unknown>).textRun
          ? ((e as Record<string, unknown>).textRun as Record<string, unknown>).content as string
          : ''),
      );

      if (question) {
        qnaObj.question = ((question as Record<string, unknown>).textRun as Record<string, unknown>).content as string;
      }
      if (answer) {
        qnaObj.answer = ((answer as Record<string, unknown>).textRun as Record<string, unknown>).content as string;
      }
      if (question) {
        result.push({ ...qnaObj } as QnaItem);
        qnaObj = {};
      }
    }
  }

  return result;
}

export function parseDocLinks(text: string): StudentDoc[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .reduce<StudentDoc[]>((acc, link) => {
      const docIdMatch = link.match(/\/d\/(.+?)\//);
      const tabIdMatch = link.match(/tab=(.+?)(&|$)/);
      if (docIdMatch) {
        acc.push({ docId: docIdMatch[1], tabId: tabIdMatch?.[1] ?? 't.0' });
      }
      return acc;
    }, []);
}

export async function writeGradeResultsToDoc(
  docId: string,
  tabId: string,
  accessToken: string,
  gradeItems: GradeResponseItem[],
): Promise<void> {
  const requests = gradeItems
    .filter((item) => !item.aiAnswer?.includes('✅ Đúng'))
    .map((item, index, arr) => {
      let replaceText = item.aiAnswer;
      if (index === arr.length - 1) {
        replaceText += '\nCác câu còn lại đúng rồi em nha! Tiếp tục giữ phong độ này nhé! 💯🔥';
      }
      return {
        replaceAllText: {
          containsText: {
            text: `Chữa bài câu ${item.quesIndex}.`,
            matchCase: false,
          },
          replaceText,
          tabsCriteria: { tabIds: [tabId] },
        },
      };
    });

  if (requests.length === 0) return;

  const response = await fetch(
    `https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requests }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to update document: ${response.status} ${text}`);
  }
}
