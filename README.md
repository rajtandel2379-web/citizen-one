# Citizen One

Citizen One is a minimal, searchable civic knowledge base. It helps people find the right official authority, reporting channel, evidence checklist and escalation path for common civic issues in Maharashtra.

The browser loads structured articles from the local knowledge base API.

## Run locally

```text
npm start
```

Open <http://localhost:3000>.

The project has no runtime dependencies and requires Node 20+.

Optional deployment settings are `SITE_URL` for canonical URLs and the sitemap, `CONTACT_EMAIL` for the floating contact button, `GA_MEASUREMENT_ID` for consent-gated Google Analytics, and `GOOGLE_SITE_VERIFICATION` for Search Console verification. Leave analytics and verification blank until real deployment values are available.

## Admin publishing

Set a strong `ADMIN_PASSWORD` on the server, then open `/admin`. The admin page lets you create, edit, publish, draft or delete articles, assign locations and category tags, add sections, format text, create links, upload images, add official channels and maintain steps/checklists. Changes are written server-side and are immediately visible on the public guides after the next request; no source-file editing is required.

Admin sessions are HttpOnly, SameSite cookies with a 12-hour lifetime. Rich text is sanitized on the server. Image uploads are limited to PNG, JPG, WebP or GIF files smaller than 5 MB. On writable hosts they are stored under `public/uploads`; on read-only serverless hosts they are embedded as validated image data URLs. Image URLs can also be added directly.

For production, host this app on a service with persistent storage or move article/image persistence to a database/object store. Ephemeral filesystem deployments can lose admin changes during a redeploy or restart.

`vercel.json` and `api/index.js` are included for Vercel-compatible serverless routing. Vercel can serve the public site and admin UI, but its function filesystem is not durable; use a persistent database or object store before relying on admin publishing there. A VPS, Render persistent disk, Railway volume or similar is suitable for the current file-backed admin store.

## Add or update articles

Edit `data/articles.json`. Each article follows this shape:

```json
{
  "id": "unique-article-id",
  "category": "category-id",
  "categoryLabel": "Visible category name",
  "title": "Article title",
  "summary": "One-sentence explanation shown on the card.",
  "locations": ["mumbai", "thane", "pune-beta"],
  "categories": ["traffic", "road-transportation"],
  "tags": ["search term", "authority", "place"],
  "status": "published",
  "sections": [
    {
      "heading": "Report to",
      "body": "Explain the correct authority in plain language.",
      "channels": [{ "name": "Official channel", "contact": "Phone, website, email or app" }]
    },
    {
      "heading": "How to report",
      "body": "Explain the process.",
      "steps": ["First step", "Second step"]
    },
    {
      "heading": "Evidence to keep",
      "body": "Explain what should be saved.",
      "checklist": ["Photo", "Date and time", "Complaint number"]
    }
  ]
}
```

Use `locations` for location filters, `categories` for the controlled category filters, and `tags` for free-form keywords. The available location and category tag names are defined in `data/tags.json`; add a new tag there, then assign its `id` to any article. This keeps assigning tags to one short array per article.

Current location tags include `mumbai`, `thane` and `pune-beta` (shown as “Location: Pune (BETA)”). Current category tags include Food / Drug, Traffic, Road / Transportation, Medical / Medicines, Hospitals, Income Tax, Railways, Municipal Corporation, Street hawkers, Illegal Street establishment, excess-space and unauthorised-vendor topics, Consumer Regulatory and Railways Grievances.

Use `status: "draft"` for an unfinished article. Drafts remain visible in the “Sample blank articles” category so they are easy to find and fill in later. Search returns an article when any word from the query matches its title, summary, location, category, free-form tags or section text, then ranks stronger matches first.

The older `data/kb.json` entries are still shown as additional guides. They are converted into the same article format by `server.js`, so you can gradually migrate or replace them with cleaner entries in `data/articles.json`.

## Publish updates

Commit the JSON and UI changes and redeploy the service. The server reads the knowledge base when it starts, so a normal restart/redeploy publishes content updates. Render, Railway, Fly.io, a VPS or Docker can host the app. The included `Dockerfile` runs `npm start`.

Useful checks:

```text
npm test
GET /api/health
GET /api/search?q=illegal%20hawkers
GET /api/search?location=mumbai&topic=street-hawkers
```

The server also provides `/robots.txt`, `/sitemap.xml`, `/privacy`, SEO-friendly `/guides/:id` pages, legacy 301 redirects from `/guide/:id` and `/article/:id`, and a custom HTML 404 page.

## Content maintenance

Official numbers, portals and emails can change. Verify them against the responsible authority before publishing an update. Keep evidence and escalation guidance practical, and do not ask citizens for Aadhaar, PAN, OTP or bank details.
