import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://steflamb.github.io',
  output: 'static',
  trailingSlash: 'always',
  // The research overview moved to /publications/; its demos now live at /demos/.
  redirects: {
    '/research': '/demos/',
  },
});
