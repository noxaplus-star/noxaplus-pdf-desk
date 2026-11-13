import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function inlineBundle(): Plugin {
  return {
    name: 'noxaplus-inline-bundle',
    enforce: 'post',
    transformIndexHtml: {
      order: 'pre',
      handler(html, context) {
        if (!context.server) return html;
        const entry = `${context.server.config.root.replace(/\/app$/, '')}/src/main.tsx`;
        return html.replace('src="../src/main.tsx"', `src="/@fs/${entry}"`);
      },
    },
    generateBundle(_options, bundle) {
      const page = bundle['index.html'];
      if (!page || page.type !== 'asset') return;
      const inlined = new Set<string>();
      const take = (fileName: string) => {
        const output = bundle[fileName];
        if (!output) return null;
        inlined.add(fileName);
        return output.type === 'chunk' ? output.code : String(output.source);
      };
      page.source = String(page.source)
        .replace(/<link rel="modulepreload"[^>]*>\s*/g, '')
        .replace(/<script type="module"[^>]*src="\.\/([^"]+)"[^>]*><\/script>/g, (tag, fileName: string) => {
          const code = take(fileName);
          return code === null ? tag : `<script type="module">${code.replace(/<\/script/gi, '<\\/script')}</script>`;
        })
        .replace(/<link rel="stylesheet"[^>]*href="\.\/([^"]+)"[^>]*>/g, (tag, fileName: string) => {
          const css = take(fileName);
          return css === null ? tag : `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`;
        });
      for (const fileName of inlined) delete bundle[fileName];
    },
  };
}

export default defineConfig({
  root: 'app', base: './', publicDir: '../public', plugins: [react(), inlineBundle()],
  build: { target: 'es2022', outDir: '../dist', emptyOutDir: true, cssCodeSplit: false, assetsInlineLimit: Number.MAX_SAFE_INTEGER, modulePreload: false },
});
