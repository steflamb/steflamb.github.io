# steflamb.github.io

Personal research website for Stefano Carlo Lambertenghi, built around one idea:

> What happens after an autonomous system leaves simulation and enters the real world?

The first release is a lightweight Astro site with no client framework, analytics, cookies, or
external font dependency. Fortuna—the full-scale autonomous-driving research vehicle—is the main
narrative, with research and publications presented as evidence around it.

## Run locally

Requirements: Node.js 22.19+ (the deployment workflow uses Node 24).

```bash
npm install
npm run dev
```

Build and preview the production output:

```bash
npm run build
npm run preview
```

## Project map

- `src/pages/` — Home, Fortuna, Research, Publications, About, CV, and 404 routes
- `src/data/site.ts` — navigation, profile links, and publication records
- `src/components/` — shared header, footer, research loop, and Fortuna schematic
- `src/styles/global.css` — the complete responsive visual system
- `public/` — favicon, social card, and future photographs/video posters
- `.github/workflows/deploy.yml` — GitHub Pages build and deployment

## Editing content

Publication metadata and external profile links live in `src/data/site.ts`. Page narratives are
plain Astro templates in `src/pages/`; no CMS or database is involved.

The inline Fortuna schematic is intentional: the site has a strong visual identity before private
media is added. Once approved photographs are available, prioritize these replacements/additions:

1. Homepage hero: Stefano with Fortuna, ideally landscape and at least 2400 px wide.
2. Fortuna recovery: old compute, sensor setup, vehicle interior, and first successful run.
3. Research evidence: ROS visualization, CARLA reconstruction, and safe-to-share failure cases.
4. About page: a candid environmental portrait rather than a studio headshot.
5. CV: add the canonical PDF to `public/` and link it from the web CV.

## Content checks before publishing

- Confirm the preferred role wording (for example, “Technical Lead” versus “Researcher”).
- Confirm the 2023 recovery timeline and the exact way personal responsibility should be described.
- Decide whether to state total autonomous-operation hours in addition to the published 2026 study
  metric of more than 48 hours of physical driving.
- Confirm sensor/compute details that can be public.
- Check consent and redact faces, number plates, dashboards, locations, or partner IP in media.
- Confirm the public contact email and add the final CV PDF.

## Deploy

This repository matches GitHub’s special `username.github.io` naming convention, so no `base`
setting is needed. In the repository settings, choose **GitHub Actions** as the Pages source. Every
push to `main` then builds and deploys the site; the workflow can also be run manually.
