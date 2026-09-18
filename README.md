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

En verifisert App Store-URL finnes foreløpig ikke i kilderepoene. «Appen» / «Se appen» går derfor til `#last-ned`, med tilgjengelighetsinformasjon og kontaktlenke. Når URL-en er klar, oppdater knappene i `index.html` og `personvern/index.html` samt teksten i sluttseksjonen. **Ikke finn opp App Store-ID.**

## Universal Links

Dette domenet skal **ikke** hoste Apple Universal Links / AASA. Det ligger på `link.enkelutleie.app` og må holdes adskilt. Ikke legg til `/.well-known/apple-app-site-association` her.

## Innhold

- Markedsside med appens blå standardtema, systemtypografi, luftig hero, avrundede kort og responsiv navigasjon
- Ekte, transparente hus-maskoter fra iOS-appen i `public/brand/` (header, footer, CTA, favicon og OG)
- Ekte Staging-skjermbilde av Oversikt i iPhone-rammen på forsiden
- Personvernstub under `/personvern` (MK Product Development AS, `hei@enkelutleie.com`)
- `robots.txt`, `sitemap.xml`, Open Graph-meta


## Designkilder og assets

Designreferanse: `enkelutleie/enkelutleie-ios` ved commit
`408f21b79f1293a57f1560b4dcdb69eeef47af80`.

- `Enkel Utleie App/Core/DesignSystem/AppTheme.swift`: merkevareblå `#2F80ED`, marineblå tekst `#1B3A6B`, bakgrunn `#E8F3FF`, hvite flater, 24 px kortradius og kapselknapper. Nettsiden følger standard lyst tema, ikke appens valgfrie rosa tema.
- Systemfont følger appens systemtypografi: San Francisco på Apple-enheter og lokal systemfont på øvrige plattformer. Ingen webfont lastes inn.
- `Assets.xcassets/HouseMascot.imageset/HouseMascot.png` → `public/brand/house-mascot.png`, `favicon.png` og `apple-touch-icon.png` (uendrede 276 × 276 PNG-er).
- `Assets.xcassets/HouseMascotHappy.imageset/HouseMascotHappy.png` → `public/brand/house-mascot-happy.png` (uendret PNG).
- `public/brand/oversikt-staging.png` er det eksisterende, uendrede skjermbildet. Bildeteksten identifiserer det som testversjon. Ingen produkt-UI er konstruert.
- Sekundærtekst bruker `#536887` for lesbarhet; små primærknapper bruker marineblått. Store blå knapper har stor, fet hvit tekst.
- Delingsbildet komponeres av de samme ekte assetene med `npm run og` (Python 3 og Pillow kreves). Generatoren støtter lokale Helvetica- eller DejaVu-fonter. Ubrukte SVG-varianter med gammel identitet er fjernet.

## Verifisering av designoppdateringen

- `npm run build`: bestått, alle tre HTML-innganger bygget med Vite.
- `node --check src/main.js` og `git diff --check`: bestått.
- Lokal produksjonsforhåndsvisning i Chrome: 320, 390, 768, 900 og 1440 px; ingen horisontal overflyt, bildene laster og ingen JavaScript-/konsollfeil.
- Mobilmeny: åpning, lenkevalg, Escape med fokus tilbake til knappen og lukking ved overgang til desktop.
- Forside, `/personvern`, `/404.html`, ukjent sti, interne ankerlenker og redusert bevegelse kontrollert. Mobil og desktop er visuelt gjennomgått.
- Repoet har ingen egne test- eller lint-scripts. Nettleserkontrollen ble kjørt eksternt uten å legge til testavhengigheter.
- Den lokale pnpm 11-installasjonen varslet om blokkert esbuild-installasjonsscript. Installerte pakker fungerte med `npm run build`; ingen installasjonspolicy ble endret.

Før publisering: sett inn bekreftet App Store-URL når den finnes, ferdigstill den eksisterende midlertidige personvernerklæringen og vurder et oppdatert offentlig appskjermbilde. DNS, produksjon, appkode og Universal Links er ikke endret.
