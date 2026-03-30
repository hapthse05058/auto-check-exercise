# AI Exercise Checker

A Chrome Extension that automatically grades student sentence-rewriting exercises from Google Docs using AI, and writes the results back directly into the document.

## Tech Stack

- **React 18 + TypeScript** — Popup UI and logic
- **Vite + crxjs/vite-plugin** — Build system with HMR for Chrome Extensions
- **Chrome Extension Manifest V3**
- **Google Docs API / OAuth2** — Read and write Google Docs content
- **OpenAI (via backend)** — Automated exercise grading

## Project Structure

```
auto-check-exercise/
├── manifest.json            # Chrome Extension MV3 manifest
├── popup.html               # HTML entry for the popup
├── vite.config.ts
├── tsconfig.json
├── package.json
├── src/
│   ├── types/index.ts       # Shared TypeScript types
│   ├── services/
│   │   ├── authService.ts   # OAuth2 flow, token storage & refresh
│   │   ├── docService.ts    # Google Docs API: fetch, parse, write results
│   │   └── gradeService.ts  # Call backend /grade, parse AI response
│   ├── content/index.ts     # Content script running on docs.google.com
│   └── popup/
│       ├── main.tsx         # React entry point
│       ├── App.tsx          # Popup UI (batch + single mode)
│       └── App.css
└── dist/                    # Build output — load into Chrome
```

## Installation

```bash
npm install
```

## Development (hot reload)

```bash
npm run dev
```

Then load the extension from the `dist/` folder into Chrome:

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `dist/` folder

crxjs automatically injects HMR, so the extension reloads on code changes.

## Production Build

```bash
npm run build
```

Output is in `dist/` — load into Chrome using the steps above.

## Features

| Feature | Description |
|---|---|
| **Auto Check Exercise** | OAuth2 authentication, fetches the default Google Doc, grades exercises, and writes results back |
| **Process All Documents** | Batch-process multiple Doc links (paste one per line into the textarea) |
| **Logout** | Clears stored tokens from Chrome storage |

## Requirements

- A backend running at `http://localhost:3000` with the following endpoints:
  - `POST /exchange-token` — exchanges authorization code or refreshes token
  - `POST /grade` — receives a list of questions and answers, returns AI grading results
- Google OAuth2 Client ID configured in `manifest.json`

