import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://steflamb.github.io',
  output: 'static',
  trailingSlash: 'always',
  // The research overview moved to /publications/; its demos now live at /demos/.
  redirects: {
    '/research': '/demos/',
    // The scrolling-route home briefly lived at /classic/ while a fly-through was the home page.
    '/classic': '/',
  },
});
