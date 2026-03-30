export interface QnaItem {
  question: string;
  answer: string;
}

export interface GradeResponseItem {
  quesIndex: string;
  quesContent: string;
  studentAnswer: string;
  aiAnswer: string;
}

export interface TokenData {
  accessToken?: string;
  refreshToken?: string;
  tokenExpiry?: number;
}

export interface StudentDoc {
  docId: string;
  tabId: string;
}

// chrome.runtime.getManifest() doesn't type oauth2 natively
export type ExtensionManifest = chrome.runtime.ManifestV3 & {
  oauth2: {
    client_id: string;
    scopes: string[];
  };
};
