import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      clearScreen: false, // Tauriのコンソール出力を消さないようにする
      server: {
        port: 3000,
        strictPort: true, // ポート3000が塞がっていたらエラーにする（Tauriが迷子にならないように）
        host: '0.0.0.0',
      },
      envPrefix: ['VITE_', 'TAURI_'], // TAURI_ 系の環境変数も読み込めるようにする
      build: {
        target: ['es2021', 'chrome105', 'safari13'], // デスクトップアプリ向けにターゲットを最適化
        minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
        sourcemap: !!process.env.TAURI_DEBUG,
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
