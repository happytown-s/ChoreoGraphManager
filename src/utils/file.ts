import { isTauri } from './platform';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile, writeTextFile } from '@tauri-apps/plugin-fs';

/**
 * Download a Blob as a file, using Tauri native save dialog if available,
 * otherwise falling back to browser download via anchor element.
 */
export const downloadBlob = async (blob: Blob, filename: string, ext: string): Promise<void> => {
  if (isTauri()) {
    const filePath = await save({
      defaultPath: filename,
      filters: [{ name: 'Video', extensions: [ext] }],
    });

    if (filePath) {
      const arrayBuffer = await blob.arrayBuffer();
      await writeFile(filePath, new Uint8Array(arrayBuffer));
    }
  } else {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.${ext}`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();

    // Cleanup after download starts
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  }
};

/**
 * Download text content as a file.
 */
export const downloadText = async (content: string, filename: string): Promise<void> => {
  if (isTauri()) {
    const filePath = await save({
      defaultPath: filename,
      filters: [{ name: 'ChoreoGraph Project', extensions: ['json'] }],
    });

    if (filePath) {
      await writeTextFile(filePath, content);
    }
  } else {
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
};
