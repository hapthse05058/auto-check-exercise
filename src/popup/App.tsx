import { useState } from 'react';
import {
  getValidAccessToken,
  startOAuthFlow,
  exchangeCodeForToken,
  setStoredTokens,
  clearStoredTokens,
} from '../services/authService';
import {
  parseDocLinks,
  getTabContent,
  getQnaFromPartIV,
  writeGradeResultsToDoc,
} from '../services/docService';
import { gradeExercise } from '../services/gradeService';

// Default doc / tab for single-doc "Auto Check" flow
const DEFAULT_DOC_ID = '1qcO8zJLzD9E3MGN-lYjwegx3L8TZpX2wBClnXUjG8mI';
const DEFAULT_TAB_ID = 't.0';

export default function App() {
  const [docLinks, setDocLinks] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  // ── Batch: Process multiple student docs ─────────────────────────────────
  const handleProcessAllDocs = async () => {
    const students = parseDocLinks(docLinks);
    if (students.length === 0) {
      alert('Please enter at least one valid Google Doc link.');
      return;
    }

    setLoading(true);

    const accessToken = await getValidAccessToken();
    if (!accessToken) {
      alert('Please authenticate first using "Auto Check Exercise".');
      setLoading(false);
      return;
    }

    const redirectUri = chrome.identity.getRedirectURL();

    for (const student of students) {
      try {
        setStatus(`Processing: ${student.docId}…`);
        const doc = await getTabContent(student.docId, student.tabId, accessToken);
        const qnaArr = getQnaFromPartIV(doc);
        const gradeResult = await gradeExercise(qnaArr, redirectUri);
        await writeGradeResultsToDoc(student.docId, student.tabId, accessToken, gradeResult);
      } catch (err) {
        console.error(`Failed to process ${student.docId}:`, err);
        setStatus(`Error on ${student.docId}: ${(err as Error).message}`);
      }
    }

    setStatus('All documents processed successfully! ✅');
    setLoading(false);
  };

  // ── Single: Auto-check the default doc with full OAuth flow ───────────────
  const handleAutoCheck = async () => {
    setLoading(true);
    setStatus('Authenticating…');

    try {
      let accessToken = await getValidAccessToken();

      if (!accessToken) {
        const code = await startOAuthFlow();
        const redirectUri = chrome.identity.getRedirectURL();
        const tokenData = await exchangeCodeForToken(code, redirectUri);

        if (tokenData.error || !tokenData.access_token) {
          throw new Error(tokenData.error ?? 'Token exchange failed');
        }

        await setStoredTokens(
          tokenData.access_token,
          tokenData.refresh_token,
          tokenData.expires_in ?? 3600,
        );
        accessToken = tokenData.access_token;
      }

      setStatus('Fetching document…');
      const redirectUri = chrome.identity.getRedirectURL();
      const doc = await getTabContent(DEFAULT_DOC_ID, DEFAULT_TAB_ID, accessToken);
      const qnaArr = getQnaFromPartIV(doc);

      setStatus('Grading exercise…');
      const gradeResult = await gradeExercise(qnaArr, redirectUri);

      setStatus('Writing results back to document…');
      await writeGradeResultsToDoc(DEFAULT_DOC_ID, DEFAULT_TAB_ID, accessToken, gradeResult);

      setStatus('Exercise checked successfully! ✅');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus(`Error: ${msg}`);
      alert(`Error: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await clearStoredTokens();
    alert('Logged out successfully. You will need to re-authenticate next time.');
  };

  return (
    <div className="container">
      <h3>Student Document List</h3>

      <textarea
        value={docLinks}
        onChange={(e) => setDocLinks(e.target.value)}
        placeholder="Paste Google Doc links here (one per line)…"
        rows={10}
        disabled={loading}
      />

      <div className="button-group">
        <button onClick={handleProcessAllDocs} disabled={loading}>
          Process All Documents
        </button>

        <button onClick={handleAutoCheck} disabled={loading}>
          Auto Check Exercise
        </button>

        <button onClick={handleLogout} className="btn-danger" disabled={loading}>
          Logout
        </button>
      </div>

      {status && <div className="status">{status}</div>}
    </div>
  );
}
