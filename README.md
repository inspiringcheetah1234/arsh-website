# ARSH BY HZK — website, shop and piece registry

- **Storefront.** A cinematic landing page with a lineup you can buy from: bag, checkout, and order tracking.
- **Admin.** Orders, products and stock, QR batches, scan-to-register, and settings.
- **Piece registry.** Every jean carries a QR code. Scanning it opens `/p/<code>` and shows who it belongs to, the article, its number in the edition (*No. 017 / 250*) and the date of purchase.

The frontend is vanilla HTML/CSS/JS with no build step. The backend is Node (one Vercel function) on Postgres.

The look follows the **ARSH Brand Guidelines, Vol. 01**: Orbit Red, Andromeda Blue and Ticket Cream, the script wordmark and the Andromeda mark, a ticket-stub voice. See [Brand](#brand).

## Run locally

```bash
npm install
(cd scripts && npm install)      # dev tooling: sharp, playwright-core
cp .env.example .env             # then fill ADMIN_EMAIL / ADMIN_PASSWORD / SESSION_SECRET
npm run dev                      # http://localhost:4173   admin: http://localhost:4173/admin
```

You don't need a database server locally. Without `DATABASE_URL`, the app runs an embedded Postgres (PGlite) stored in `.data/`. On first run it loads the 10 placeholder products and creates the owner account from `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env`. To start over, delete `.data/`.

## How the QR registry works

1. **Generate.** In Admin → QR codes, generate a batch (250 by default). Each code is random and can't be guessed (10 characters, about 8×10¹⁴ possibilities). Each also gets a printed serial such as `B003-117`.
2. **Print.** "Print labels" opens an A4 sheet: 40 labels a page, each a QR with its serial, ready for your label or patch printer. "Download CSV" gives `serial, code, url` for a print vendor. The QR contains `https://<your site>/p/<code>`, using **Site URL** from Settings or the `SITE_URL` env var, so set that before printing.
3. **Sew.** The labels go on blank. A code is not tied to an article until it's scanned. You can reserve a batch for one article if you prefer.
4. **Register at packing.** Open the order and press **Scan pieces**, then point a phone at each jean's code. A Bluetooth or USB hand scanner also works, because it types into the same field. Each scan registers that jean to the order:
   - **Owner:** the name the customer chose at checkout. The public page shows "Ayesha K." by default; change this in Settings.
   - **Article** and **purchase date**.
   - **Edition number:** the lowest free number for that article, out of its edition size, e.g. No. 001 / 250. Edition size is set per product.
5. **Guardrails:**
   - An order can't be marked packed, shipped or delivered until every unit is registered. Staff can override this with an explicit confirmation, for example for a piece shipped without a label.
   - A code can't be registered to two orders, and a line can't take more pieces than its quantity.
   - If an order has several different articles, the scanner asks which line a code belongs to.
   - Mistakes can be released with ×, which makes the code blank again.
   - Damaged labels can be voided from Admin → Scan.
   - Cancelling an order restores stock and releases its pieces.
6. **Scan as a customer.** `/p/<code>` shows one of three states: *Registered piece* with number, name, article and date; *Not yet registered* for a blank code; or *Not recognised* for an unknown code.

## Orders

- **Checkout** prices everything on the server and reserves stock in the same transaction. Payment methods are **cash on delivery** and **bank transfer**: bank details are shown and emailed, and staff mark orders paid.
- **Statuses:** pending → confirmed → packed → shipped → delivered, or cancelled. Every change is written to the order's timeline with who made it.
- **Customers** track orders at `/order` with the order number and their email. The confirmation link carries a signed token, so it opens directly.
- **Emails** (confirmation, shipped, new-order alert) go through [Resend](https://resend.com) when `RESEND_API_KEY` is set. Without it they're recorded in Admin → Settings → Email log and nothing is sent.

## Brand

Everything visual comes from the guidelines, through one file: `public/css/brand.css` (tokens, type, logo components, buttons). Change a colour there and it changes everywhere.

| | |
|---|---|
| **Colour** | Orbit Red `#F23B35`, Andromeda Blue `#2B3DB0`, Ticket Cream `#F6ECE1`; Wax Red `#A51D1E` and Deep Space `#0D0D0D` as support. Pages are blocked in colour: cream for reading, blue for the manifesto-style moments, red for the box and the footer, black for night pages (bag, scanner, login, piece page). |
| **Type** | Bootzy Condensed (H1, all caps), Bootzy (H2, sentence case), Mergo (labels), Neue Montreal (body). |
| **Logo** | The script wordmark and the Andromeda mark are the supplied artwork, vectorised from `brand/source/*.png` into `public/assets/brand/*.svg` with `scripts/trace-logos.mjs`. They are recoloured with CSS masks, never typeset, redrawn or rotated. Wordmark ≥ 160 px, mark ≥ 40 px. The wordmark is Latin script only, so there is no Arabic on the site. |
| **Voice** | Short, matter-of-fact, quietly strange; no exclamation marks. Edit the lines in `public/data/copy.json`. |

**The brand fonts are not in the repo yet.** Until you add them, free stand-ins render (Archivo for both Bootzy faces, Space Grotesk for Mergo, Inter for Neue Montreal). Put these files in `public/assets/fonts/` and uncomment the matching blocks in `public/css/fonts.css`:

```
BootzyCondensed.woff2   Bootzy.woff2   Mergo.woff2   NeueMontreal-Medium.woff2
```

The wordmark appears large (preloader, first screen, footer, piece ticket), the mark is the small home link, and the piece page is a one-way boarding pass after the hang tag. Contrast is measured by `scripts/test-brand.mjs`: Ticket Cream on Orbit Red is 3.3:1, so it is used for large display type only; small text on red is Deep Space.

## Waitlist

Until the shop opens (Admin → Settings → "Shop open" off), and for anything sold out, people ask for access instead of buying.

- **`/waitlist` opens like a letter.** A cream envelope sealed with Wax Red wax sits on Andromeda Blue. Breaking the seal (click, tap, or Enter) cracks the wax in two, swings the flap up, lifts the letter out and lets the envelope fall away, leaving the form on cream paper (about 2.5 seconds). Until it's open the form is hidden *and* inert, so keyboards and screen readers can't wander into it; the seal is a labelled button. People who arrive with a piece or an email already chosen (`?interest=`, `?email=`) see it open by itself. With reduced motion, or no JavaScript, there is no envelope and the form is simply there. The seal artwork is hand-made; if you have the ouroboros ring from the guidelines, swap it into the `<symbol id="seal-art">` block in `public/waitlist.html` (the standalone copy is `public/assets/brand/wax-seal.svg`). The sequence timings are in `public/js/envelope.js`.
- **The form** is: name, email, WhatsApp or phone and city (optional), which piece and size they want, how they heard of you, and a consent tick. The confirmation is a boarding pass with their number (*No. 0147*), and a welcome email goes out. Product panels link here with the piece already chosen (`/waitlist?interest=<slug>`).
- **The landing page** keeps the one-field email box. It feeds the same list, shows the number, and links to the full form with the email prefilled. The old `/api/access` address still works.
- **Admin → Waitlist** shows everyone with filters (waiting, invited, removed), search, a note and status per person, and a "customer" badge when the email has placed an order. Tick people and **Invite selected** to email them that the collection is open. Only people who are *waiting* can be invited, and nobody is invited twice. **Export CSV** gives the list for Klaviyo, WhatsApp broadcasts or a spreadsheet; cells that start with `=`, `+`, `-` or `@` are neutralised so a spreadsheet never runs them as formulas. **Delete** removes a person for good, for "please remove me" requests.
- **Safeguards:** the same email can't be on the list twice (any capitalisation), and signing up again never overwrites what someone already gave. A hidden trap field catches bots, and signups are rate-limited per address. Names are always shown as plain text. Emails go through Resend when `RESEND_API_KEY` is set; otherwise they appear in Settings → Email log.

## Team page

`/team` puts every person on one page: a reel you scroll through sideways, one card each (portrait, name, role, "Part of the company since", specialisation, stitch colour), then an "All of us" grid. Clicking someone in the grid jumps to their card, and the arrow keys step through the reel. With reduced motion it becomes a plain swipeable strip.

Edit the people in `public/data/team.json`. Put portraits in `public/assets/team/` and set each `photo` path; leave it empty for the placeholder. Use 4:5 portraits with the same framing, head near the top third. Colour photos are fine: the page shows every portrait in black and white. `stitch` takes a brand colour name (Orbit Red, Andromeda Blue, Ticket Cream, Wax Red, Deep Space) and draws the matching swatch.

## Product images

In Admin → Products → a product, there are two places for images:

- **Lineup cutout.** The full-body figure that stands in the lineup. Upload a photo with the background removed, as a transparent PNG or WebP. With "Fit to the lineup" ticked (the default), the server trims the figure, scales it to the standard height and puts the feet on the shared floor line, so you don't have to align anything by hand. If the image has no transparent background, it's still saved but you'll get a warning. See `scripts/cutout.md` for removing backgrounds.
- **Photos.** Up to 12 detail, on-body and fabric shots, which appear as thumbnails in the product panel after the cutout. Drag files in or press Add photos. You can reorder them with ← →, add a description for screen readers and search engines, or delete them.

Uploads are resized in the browser first, so phone photos work. The server then re-encodes everything to WebP and strips metadata such as GPS location. Locally, files are saved in `public/uploads/`. On Vercel they go to **Vercel Blob**: add a Blob store under Storage, which sets `BLOB_READ_WRITE_TOKEN`.

## Deploy to Vercel

1. Create a Postgres database. Neon or Supabase both have free tiers; Vercel → Storage → Neon is the quickest. Copy its pooled connection string.
2. Import this folder as a Vercel project. `vercel.json` already sets output `public/`, the API function and the rewrites.
3. Set environment variables: `DATABASE_URL`, `SESSION_SECRET` (32+ random characters) and `SITE_URL` (e.g. `https://arsh.pk`). Add a Blob store for image uploads, which sets `BLOB_READ_WRITE_TOKEN`. Optionally set `RESEND_API_KEY` and `EMAIL_FROM`.
4. The tables are created automatically on first request. Create the owner account from your machine against the production database:
   ```bash
   DATABASE_URL="postgres://…" node server/cli.js admin:create you@arsh.pk "Hammad" --owner
   ```
5. In Admin, replace the placeholder products, set prices and stock, set Site URL, then generate and print your first batch.

`.vercelignore` keeps the source footage (`media/`), dev scripts and local data out of the deployment.

## Project layout

```
public/            static site (served as-is)
  index.html       landing page + lineup + bag
  checkout.html    order.html    piece.html (/p/<code>)
  waitlist.html    the waitlist page (css/waitlist.css, js/waitlist.js)
  admin/           admin app (index.html, admin.js, scanner.js, waitlist.js, admin.css)
  css/ js/ data/ assets/ vendor/   (brand.css = the brand system; GSAP, ScrollTrigger, Lenis, jsQR vendored)
brand/source/      the supplied logo artwork (wordmark + Andromeda mark), not deployed
api/index.js       Vercel function → server/api.js
server/            api.js (routes), orders.js, pieces.js (QR), products.js, auth.js, db.js, schema.sql, email.js, settings.js, cli.js
media/hero/        source hero footage (not deployed)
scripts/           serve.mjs (dev server), test*.mjs, trace-logos.mjs, make-frames.sh, cutout.md, higgsfield-prompts.md
```

## Editing content

| What | Where |
|---|---|
| Products, prices, sizes and stock, edition size, images | Admin → Products |
| Shop open/closed, shipping, payment methods, bank details, Site URL, owner name display | Admin → Settings |
| Landing page text | `public/data/copy.json` |
| Hero timing, founder portrait, packaging photos, Instagram | `public/data/config.json` |
| Brand fonts | Drop `BootzyCondensed`, `Bootzy`, `Mergo`, `NeueMontreal-Medium` (woff2) into `public/assets/fonts/` and uncomment `public/css/fonts.css` |
| Logo artwork | Replace the PNGs in `brand/source/`, then `(cd scripts && node trace-logos.mjs)` |

Product images must be transparent full-body cutouts with feet on the same baseline; see `scripts/cutout.md`. Hero footage: replace `media/hero/hero-desktop.mp4`, then run `bash scripts/make-frames.sh` (220 frames per set; about 30 MB desktop and 12 MB phone). The phone version is cropped from the desktop clip along the keyframes in `media/hero/mobile-crop.json` (seconds and horizontal position), or supply your own 9:16 cut as `media/hero/hero-mobile.mp4`. The earlier midnight-box clips are kept in `media/hero/previous/`. If the new footage changes pace, retune `hero.beats` in `public/data/config.json` (they are fractions of the clip).

## Tests

```bash
npm run dev &
node scripts/test.mjs          # landing: hero frame sync, lineup, a11y basics (desktop + mobile)
node scripts/test-shop.mjs     # buy → admin → generate 250 → camera scan → ship → public piece page
node scripts/test-images.mjs   # cutout normalising, photo upload/reorder/delete, storefront thumbnails
node scripts/test-waitlist.mjs # signup, validation, duplicates, bots, the envelope (keyboard, inert form, auto-open), ticket, admin list/invite/export/delete
node scripts/test-team.mjs     # reel follows scroll, arrow keys, grid jump, black-and-white portraits, reduced motion
node scripts/test-brand.mjs    # logo minimum sizes, exact palette, no Arabic, type stack, text contrast
```

`test-shop.mjs` feeds Chrome a fake camera showing a generated QR, so the real camera-decode path is tested, not only typed input. Screenshots go to `scripts/screenshots/`.

## Security notes

- Admin passwords are hashed with scrypt. Sessions use HMAC-signed, HttpOnly, SameSite=Strict cookies lasting 12 hours.
- Every admin write also requires an `X-Arsh-Admin` header, which blocks cross-site requests. Login attempts are throttled.
- Roles: the **owner** can change settings and add staff. **Staff** can run orders, products and scanning.
- Piece pages show only the display name, article, number and date. Order lookups need the order number plus the email or a signed link.
