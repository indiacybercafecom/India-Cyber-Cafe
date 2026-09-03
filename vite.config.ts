import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

const localDotLottieWasmPlugin = () => ({
  name: 'local-dotlottie-wasm',
  enforce: 'post' as const,
  transform(code: string, id: string) {
    if (!id.includes('@lottiefiles/dotlottie-web')) {
      return null;
    }

    const localWasmUrl = '/lottie/dotlottie-player.wasm';
    const updatedCode = code.replace(
      /https:\/\/[^"'` ]+\/@lottiefiles\/dotlottie-web@0\.80\.0\/dist\/dotlottie-player\.wasm/g,
      localWasmUrl,
    );

    return updatedCode === code ? null : {code: updatedCode, map: null};
  },
});

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss(), localDotLottieWasmPlugin()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
