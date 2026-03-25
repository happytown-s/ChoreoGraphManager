/** Detect if running inside Tauri (WebView) */
export const isTauri = (): boolean =>
  '__TAURI_INTERNALS__' in window;

interface BrowserInfo {
  isSafari: boolean;
  isChrome: boolean;
  isFirefox: boolean;
  isTauriEnv: boolean;
}

export const getBrowserInfo = (): BrowserInfo => {
  const ua = navigator.userAgent;
  return {
    isSafari: /^((?!chrome|android).)*safari/i.test(ua),
    isChrome: /chrome|chromium|crios/i.test(ua),
    isFirefox: /firefox/i.test(ua),
    isTauriEnv: isTauri(),
  };
};

export const getBestMimeType = (includeAudio: boolean): string => {
  const { isSafari, isChrome, isTauriEnv } = getBrowserInfo();

  if (isSafari || isTauriEnv) {
    const safariTypes = [
      'video/mp4;codecs="avc1,mp4a.40.2"',
      'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
      'video/mp4;codecs=avc1',
      'video/mp4',
    ];
    for (const type of safariTypes) {
      if (MediaRecorder.isTypeSupported(type)) {
        console.log(`[Safari/Tauri] Using MIME: ${type}`);
        return type;
      }
    }
  }

  if (isChrome) {
    const chromeTypes = [
      'video/webm;codecs="vp9,opus"',
      'video/webm;codecs="vp9"',
      'video/webm;codecs="vp8,opus"',
      'video/webm;codecs="vp8"',
      'video/webm',
    ];
    for (const type of chromeTypes) {
      if (MediaRecorder.isTypeSupported(type)) {
        console.log(`[Chrome] Using MIME: ${type}`);
        return type;
      }
    }
  }

  // Fallback
  const fallback = 'video/webm';
  console.log(`[Fallback] Using MIME: ${fallback}`);
  return fallback;
};

export const getExtensionFromMime = (mime: string): string => {
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('webm')) return 'webm';
  return 'webm';
};

export const generateRecordingFilename = (projectName: string): string => {
  const now = new Date();
  const formattedDate =
    `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}` +
    `${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}` +
    `${String(now.getMinutes()).padStart(2, '0')}`;
  const safeProjectName = projectName.replace(
    /[^a-z0-9_\-\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf\u3400-\u4dbf]/gi,
    '_'
  );
  return `${safeProjectName}-${formattedDate}`;
};
