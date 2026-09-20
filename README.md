# Enkel Utleie — nettside

Offentlig markedsside for **Enkel Utleie**, en native iOS-app for private utleiere og leietakere. Produksjonsdomene: [https://enkelutleie.com](https://enkelutleie.com).

Statisk nettsted bygget med [Vite](https://vitejs.dev/) og vanlig HTML/CSS (minimalt vanilla JS). Ingen React eller Next.

## Utvikling

```bash
pnpm install
pnpm dev
```

`npm install` og `npm run dev` fungerer også.

- Forside: `/`
- Leieavtale (PDF-mal): `/leieavtale.pdf`
- Personvern: `/personvern`

## Bygg

```bash
pnpm build
```

Ferdig statisk output ligger i `dist/`. Forhåndsvis med `pnpm preview`.

## Cloudflare Pages

Koble GitHub-repositoriet `enkelutleie/website` til et Pages-prosjekt.

| Felt | Verdi |
| --- | --- |
| Framework preset | Vite |
| Build command | `pnpm build` (eller `npm run build`) |
| Build output directory | `dist` |
| Root directory | `/` |

`wrangler.toml` peker `pages_build_output_dir` mot `./dist`. Sikkerhetshoder og pretty URL for personvern ligger i `public/_headers` og `public/_redirects` og kopieres inn i `dist` ved bygg. Cloudflare Pages serverer `404.html` automatisk for ukjente stier.

Egendefinert domene i Cloudflare: `enkelutleie.com` (og gjerne `www`). Live DNS settes utenfor dette repositoriet.

Lokal Pages-lignende deploy (valgfritt, krever innlogging):

```bash
pnpm build
npx wrangler pages deploy dist --project-name enkelutleie
```

## App Store-lenke

Knappene «Last ned i App Store» peker midlertidig på `https://apps.apple.com/`. Lim inn ekte App Store-URL i `index.html` når den er klar. **Ikke finn opp App Store-ID.**

## Universal Links

Dette domenet skal **ikke** hoste Apple Universal Links / AASA. Det ligger på `link.enkelutleie.app` og må holdes adskilt. Ikke legg til `/.well-known/apple-app-site-association` her.

## Innhold

- Markedsside i samme visuelle språk som iOS-appen: hus-maskot, `#2F80ED` / `#1B3A6B` / `#E8F3FF`, hvite kort
- Hus-maskot i `public/brand/` (og `brand-assets/`): `house-mascot.png` (åpne øyne) og `house-mascot-happy.png` (smileøyne). Header, footer, hero, favicon, apple-touch og OG bruker dette paret — ikke SVG-tegninger eller gamle kube-hus.
- Ekte Staging-skjermbilde av Oversikt i iPhone-rammen på forsiden
- Feature-kort for økonomi, overtakelse, inn-/utflyttingssjekkliste, leieavtale, chat og boliger
- Kort norsk husleiekontrakt-mal på `/leieavtale.pdf` (genereres med `pnpm leieavtale`)
- Personvernstub under `/personvern` (MK Product Development AS, `hei@enkelutleie.com`)
- `robots.txt`, `sitemap.xml`, Open Graph-meta
