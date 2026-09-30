# wellmimir.com

The website for Mimir. Plain HTML, CSS and a little JavaScript: no build step.

- `index.html` is the home page, `privacy.html` the privacy page, `404.html` the page for a wrong address.
- `assets/css/site.css` holds the look, in Mimir's own colours (midnight, teal and gold).
- `assets/js/site.js` points every download button at the newest **published** release in
  [ZipEmUp-source/Mimir-releases](https://github.com/ZipEmUp-source/Mimir-releases), with its size and Norse name.
  A draft release never shows here; publishing one updates the site by itself.
- `assets/img/` holds the eye, the icons, the link-preview card (`og-card.jpg`) and real screenshots of Mimir.

To look at it on this computer: `python -m http.server 4620 --directory C:\Dev\wellmimir-site`, then open http://localhost:4620.

## Things to change when a release ships

- The accounts section and two answers under "Questions" say accounts arrive **in the next update**.
  Once the release with accounts is published, remove the `badge` line in `#accounts` and reword those two answers.

## Hosting (GitHub Pages, free)

1. Push this folder to a public repository, for example `ZipEmUp-source/wellmimir.com`.
2. Settings → Pages: deploy from the `main` branch, folder `/`. The `CNAME` file already says `wellmimir.com`.
3. At Squarespace (Domains → wellmimir.com → DNS), delete the Squarespace default records for `@` and `www`, then add:

   | Host | Type | Value |
   |---|---|---|
   | @ | A | 185.199.108.153 |
   | @ | A | 185.199.109.153 |
   | @ | A | 185.199.110.153 |
   | @ | A | 185.199.111.153 |
   | www | CNAME | zipemup-source.github.io |

4. When GitHub says the domain is checked, tick **Enforce HTTPS** (it can take up to a day).

## Email for sign-in codes (Resend)

The records Resend shows for `wellmimir.com` go in the same Squarespace DNS page. Put only the part before
`.wellmimir.com` in Squarespace's Host field:

| Host | Type | Value |
|---|---|---|
| send | MX, priority 10 | the mail server Resend shows |
| send | TXT | the SPF value Resend shows |
| resend._domainkey | TXT | the DKIM value Resend shows |
