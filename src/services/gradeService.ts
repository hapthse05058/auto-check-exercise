import type { QnaItem, GradeResponseItem } from '../types';

const DOMAIN = 'http://localhost:3000';

export async function gradeExercise(
  items: QnaItem[],
  redirectUri?: string,
): Promise<GradeResponseItem[]> {
  const response = await fetch(`${DOMAIN}/grade`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, redirectUri }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Grade API error ${response.status}: ${text}`);
  }

  const result = await response.json();
  const rows: string[] = (result.raw as string).split('\n');

  // Rows are markdown table format: | index | question | studentAns | aiAnswer |
  // Skip the header row (index 0) and separator row (index 1), and trailing empty row
  return rows.slice(2, rows.length - 2).map((row) => {
    const clean = row.slice(1, -1).trim(); // strip leading/trailing |
    const [quesIndex, quesContent, studentAnswer, aiAnswer] = clean
      .split(' | ')
      .map((s) => s.trim());
    return { quesIndex, quesContent, studentAnswer, aiAnswer };
  });
}
