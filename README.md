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
- Om oss: `/om-oss`
- Spørsmål og svar: `/sporsmal-svar`
- Personvern: `/personvern`

## Bygg

```bash
pnpm build
```

Ferdig statisk output ligger i `dist/`. Forhåndsvis med `pnpm preview`.

## Midlertidig «Kommer snart»-forside

Forsiden (`index.html`) er midlertidig byttet ut med en enkel «Kommer snart»-side (`src/coming-soon.css`). Den fulle landingssiden ligger i `landing-full.html` og kan åpnes på `/forhåndsvisning` (og `/forhandsvisning`). Den bygges av Vite, men er merket `noindex, nofollow`. `/om-oss` og `/sporsmal-svar` sendes midlertidig til `/` med 302 i `public/_redirects`, og er fjernet fra `public/sitemap.xml`. `/personvern`, `/logg-inn` og `/portal/` fungerer som før.

Slik gjenoppretter du den fulle siden:

1. `git mv -f landing-full.html index.html` og slett `src/coming-soon.css`.
2. I `public/_redirects`: fjern 302-blokken og legg tilbake `/om-oss /om-oss/index.html 200` og `/sporsmal-svar /sporsmal-svar/index.html 200`.
3. Legg `/om-oss` og `/sporsmal-svar` tilbake i `public/sitemap.xml`.

Eller enklere: `git revert -m 1 <merge-commit>` for denne endringen.

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

Firestegsseksjonen på forhåndsvisningen lenker direkte til registrert Production-app: App Store `https://apps.apple.com/no/app/id6797224548` (ID fra iOS-repoets `docs/STOREKIT_ASC_SETUP_CHECKLIST.md`) og Google Play `https://play.google.com/store/apps/details?id=no.enkelutleie.app` (Android applicationId). Appene er ikke lansert; seksjonen opplyser derfor «kommer snart». Nedlasting kan ikke verifiseres før publisering. Knappen «Kom i gang nå» åpner `/logg-inn`. Norske butikkmerker er hentet fra Apples og Googles offisielle badge-tjenester.

Fire kort erstatter den gamle trestegsseksjonen, med nummer, blå ikoner og buede stiplede forbindelser. Oppsettet er fire kolonner på PC, to på mobil og én på de smaleste skjermene. Bakgrunnen er uendret. Mobilens hero-overskrift er større og sort/blå; resten av heroen er beholdt.

## Universal Links

Dette domenet skal **ikke** hoste Apple Universal Links / AASA. Det ligger på `link.enkelutleie.app` og må holdes adskilt. Ikke legg til `/.well-known/apple-app-site-association` her.

## Innhold

- Markedsside i samme visuelle språk som iOS-appen: hus-maskot, `#2F80ED` / `#1B3A6B` / `#E8F3FF`, hvite kort
- Logo i headeren/toppbaren (alle sider, også portalen) og på «Kommer snart»-forsiden: det nye app-ikonet (blått hus med pipe og hvit buet dør), eksportert med avrundede hjørner som `public/brand/app-logo-{48,96,144}.png` (header, 1x/2x/3x) og `app-logo-{160,320,480}.png` (Kommer snart). Kilde: `artwork/app-icon-house-1024.png` i iOS-repoet (samme fil som `BrandLogo` i appen). Ikke bruk den gamle logoen (hvitt hus med hake).
- Hus-maskot i `public/brand/` (og `brand-assets/`): `house-mascot.png` (åpne øyne) og `house-mascot-happy.png` (smileøyne). Brukes fortsatt i innholdet (hero, footer, portal-banner, 404) og OG-bildet — ikke i headeren.
- Ekte Staging-skjermbilde av Oversikt i iPhone-rammen på forsiden
- Feature-kort for økonomi, overtakelse, inn-/utflyttingssjekkliste, chat og boliger
- Personvernstub under `/personvern` (MK Product Development AS, `hei@enkelutleie.com`)
- `robots.txt`, `sitemap.xml`, Open Graph-meta

## Innloggingsdesign

`logg-inn/index.html` og sidens egne regler i `src/login.css` følger mobilreferansen: sentrert hvitt kort, mørk Apple-knapp, hvit Google-knapp, «eller» med skillelinjer og romslige felter med blå Logg inn-knapp. Kortene vises under hverandre på mobil og ved siden av hverandre på større skjermer. Kun presentasjon og introduksjonstekst er endret; innloggingslogikk, skjemaets feltnavn og data-attributter er beholdt.
