chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "GET_SELECTION") {
    const text = window.getSelection().toString();
    sendResponse({ text });
    return;
  }

  if (request.type === "EXTRACT_EXERCISE") {
    try {
      const heading = "IV. BÀI TẬP VIẾT LẠI CÂU";

      function findElementByText(root, text) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
        let node = walker.nextNode();
        while (node) {
          try {
            if (node.innerText && node.innerText.trim().includes(text)) return node;
          } catch (e) {}
          node = walker.nextNode();
        }
        return null;
      }

      const startEl = findElementByText(document.body, heading);
      if (!startEl) {
        sendResponse({ error: 'heading_not_found' });
        return;
      }

      // Collect subsequent paragraph-like elements until a new roman section (V.) or end.
      const items = [];
      let node = startEl.nextElementSibling || startEl;
      let collect = false;
      // If heading element contains the heading and exercise immediately after, start from next sibling.
      if (startEl.innerText && startEl.innerText.trim().includes(heading)) collect = true;

      // heuristic: move forward collecting lines that look like numbered sentences
      let safety = 0;
      while (node && safety < 500) {
        safety++;
        try {
          const t = (node.innerText || '').trim();
          if (!t) {
            node = node.nextElementSibling;
            continue;
          }

          // stop when we reach next major section header like 'V.'
          if (/^\s*V\./m.test(t) || /^\s*V\s*\./m.test(t)) break;

          if (collect) {
            // split by newlines and extract lines that look like numbered items or full sentences
            const lines = t.split('\n').map(s => s.trim()).filter(Boolean);
            for (const line of lines) {
              // accept lines that start with a number and dot, or that look like a student sentence
              if (/^\d+\s*\.|^\d+\)/.test(line) || /[。.!?]$/.test(line) || line.length > 10) {
                items.push(line);
              }
            }
          }
        } catch (e) {}
        node = node.nextElementSibling;
      }

      sendResponse({ items });
    } catch (e) {
      sendResponse({ error: 'extract_failed', details: e.message });
    }
    return;
  }

  if (request.type === "APPLY_CORRECTIONS") {
    try {
      const corrections = request.corrections || [];
      const heading = "IV. BÀI TẬP VIẾT LẠI CÂU";

      function findElementByText(root, text) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
        let node = walker.nextNode();
        while (node) {
          try {
            if (node.innerText && node.innerText.trim().includes(text)) return node;
          } catch (e) {}
          node = walker.nextNode();
        }
        return null;
      }

      const startEl = findElementByText(document.body, heading);
      if (!startEl) {
        sendResponse({ error: 'heading_not_found' });
        return;
      }

      // Apply corrections by inserting a new paragraph after each matched student answer.
      let node = startEl.nextElementSibling || startEl;
      let collected = [];
      let safety = 0;
      while (node && safety < 500 && collected.length < corrections.length) {
        safety++;
        try {
          const t = (node.innerText || '').trim();
          if (t) {
            const lines = t.split('\n').map(s => s.trim()).filter(Boolean);
            for (const line of lines) {
              if (line && (collected.length < corrections.length)) {
                // append correction paragraph after current node
                const corr = corrections[collected.length] || '';
                if (corr) {
                  const p = document.createElement('div');
                  p.style.color = '#0b6623';
                  p.style.fontWeight = 'bold';
                  p.innerText = 'Chữa bài: ' + corr;
                  if (node.parentNode) node.parentNode.insertBefore(p, node.nextSibling);
                }
                collected.push({original: line, correction: corr});
              }
            }
          }
        } catch (e) {}
        node = node.nextElementSibling;
      }

      // show toast notification
      (function showToast(msg) {
        try {
          const id = 'auto-check-toast';
          let el = document.getElementById(id);
          if (el) el.remove();
          el = document.createElement('div');
          el.id = id;
          el.innerText = msg;
          el.style.position = 'fixed';
          el.style.right = '20px';
          el.style.bottom = '20px';
          el.style.background = 'rgba(0,0,0,0.85)';
          el.style.color = 'white';
          el.style.padding = '12px 16px';
          el.style.borderRadius = '6px';
          el.style.zIndex = 999999;
          document.body.appendChild(el);
          setTimeout(() => el.remove(), 6000);
        } catch (e) {}
      })('The checking exercise process has been completed, please review the result!');

      sendResponse({ ok: true, applied: collected.length });
    } catch (e) {
      sendResponse({ error: 'apply_failed', details: e.message });
    }
    return;
  }
});
