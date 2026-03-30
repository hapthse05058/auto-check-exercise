const HEADING = 'IV. BÀI TẬP VIẾT LẠI CÂU';

function findElementByText(root: Element, text: string): Element | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
  let node = walker.nextNode() as Element | null;
  while (node) {
    try {
      if ((node as HTMLElement).innerText?.trim().includes(text)) return node;
    } catch {
      // skip inaccessible nodes
    }
    node = walker.nextNode() as Element | null;
  }
  return null;
}

function showToast(msg: string): void {
  const id = 'auto-check-toast';
  document.getElementById(id)?.remove();

  const el = document.createElement('div');
  el.id = id;
  el.innerText = msg;
  Object.assign(el.style, {
    position: 'fixed',
    right: '20px',
    bottom: '20px',
    background: 'rgba(0,0,0,0.85)',
    color: 'white',
    padding: '12px 16px',
    borderRadius: '6px',
    zIndex: '999999',
  });
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 6000);
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type === 'GET_SELECTION') {
    const text = window.getSelection()?.toString() ?? '';
    sendResponse({ text });
    return;
  }

  if (request.type === 'EXTRACT_EXERCISE') {
    try {
      const startEl = findElementByText(document.body, HEADING);
      if (!startEl) {
        sendResponse({ error: 'heading_not_found' });
        return;
      }

      const items: string[] = [];
      let node = startEl.nextElementSibling ?? startEl;
      let safety = 0;

      while (node && safety < 500) {
        safety++;
        const t = (node as HTMLElement).innerText?.trim() ?? '';

        if (!t) {
          node = node.nextElementSibling as Element;
          continue;
        }
        if (/^\s*V\s*\./m.test(t)) break;

        for (const line of t.split('\n').map((s) => s.trim()).filter(Boolean)) {
          if (/^\d+\s*\.|^\d+\)/.test(line) || /[。.!?]$/.test(line) || line.length > 10) {
            items.push(line);
          }
        }

        node = node.nextElementSibling as Element;
      }

      sendResponse({ items });
    } catch (e) {
      sendResponse({ error: 'extract_failed', details: (e as Error).message });
    }
    return;
  }

  if (request.type === 'APPLY_CORRECTIONS') {
    try {
      const corrections: string[] = request.corrections ?? [];
      const startEl = findElementByText(document.body, HEADING);

      if (!startEl) {
        sendResponse({ error: 'heading_not_found' });
        return;
      }

      let node = startEl.nextElementSibling ?? startEl;
      const collected: Array<{ original: string; correction: string }> = [];
      let safety = 0;

      while (node && safety < 500 && collected.length < corrections.length) {
        safety++;
        const t = (node as HTMLElement).innerText?.trim() ?? '';

        if (t) {
          for (const line of t.split('\n').map((s) => s.trim()).filter(Boolean)) {
            if (collected.length >= corrections.length) break;

            const corr = corrections[collected.length] ?? '';
            if (corr) {
              const p = document.createElement('div');
              p.style.color = '#0b6623';
              p.style.fontWeight = 'bold';
              p.innerText = 'Chữa bài: ' + corr;
              node.parentNode?.insertBefore(p, node.nextSibling);
            }
            collected.push({ original: line, correction: corr });
          }
        }

        node = node.nextElementSibling as Element;
      }

      showToast('The checking exercise process has been completed, please review the result!');
      sendResponse({ ok: true, applied: collected.length });
    } catch (e) {
      sendResponse({ error: 'apply_failed', details: (e as Error).message });
    }
    return;
  }
});
