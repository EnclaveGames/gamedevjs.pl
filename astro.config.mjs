import { defineConfig } from 'astro/config';
import path from 'node:path';

export default defineConfig({
  site: 'https://gamedevjs.pl',
  trailingSlash: 'never',
  compressHTML: true,
  build: {
    format: 'file',
    inlineStylesheets: 'never',
  },
  vite: {
    build: {
      minify: 'esbuild',
      cssMinify: 'lightningcss',
    },
    css: {
      transformer: 'lightningcss',
      preprocessorOptions: {
        lightningcss: {
          targets: {
            chrome: 90 << 16,
            firefox: 90 << 16,
            safari: 15 << 16,
            edge: 90 << 16,
          },
        },
        sass: {
          api: 'modern',
          loadPaths: [path.resolve('src/styles').replace(/\\/g, '/')],
        },
      },
    },
  },
});
