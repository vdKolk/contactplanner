# Contactplanner

Een huisbezoek- en contactplanner voor ouderlingen en bezoekbroeders. Importeer een
Excel-export uit de ledenadministratie (bijvoorbeeld Scipio) en de app houdt per gezin bij
wanneer het volgende bezoek gepland moet worden, wat er bij eerdere bezoeken is besproken en
welke bijzondere momenten eraan komen.

## 🔒 Privacy voorop

**Deze applicatie verstuurt niets naar internet.** Er is geen server en geen database: alle
gegevens staan uitsluitend in de browseropslag (IndexedDB) van het apparaat waarop je de app
gebruikt, en worden daar **versleuteld** bewaard (AES-256-GCM; de sleutel wordt met PBKDF2
afgeleid van de pin, de pin zelf wordt nergens opgeslagen). Sluit je de browser, dan blijven
de gegevens lokaal bewaard; een ander apparaat of een andere browser ziet ze niet.
Uitzondering op de versleuteling: een klein hulplijstje met verjaardagen/jubilea (naam +
datum), zodat "Bijzondere momenten" ook vanaf het slotscherm te bekijken is.

Daar horen twee verantwoordelijkheden bij:

- **Maak regelmatig een back-up.** De gegevens bestaan alleen op jouw apparaat, en een
  vergeten pin betekent dat de versleutelde gegevens definitief onleesbaar zijn. De indicator
  rechtsboven in de app houdt je scherp: groen = alles staat in de laatste back-up, oranje =
  er zijn wijzigingen die nog niet in een back-up staan. Eén klik op de indicator downloadt
  direct een nieuw back-upbestand (.json). De back-up is bewust **onversleuteld** — dat is je
  vangnet bij een vergeten pin — dus bewaar het bestand op een veilige plek.
- **Beveilig het apparaat zelf.** Een korte cijferpin beschermt tegen meekijkers, maar is
  offline te raden door wie het versleutelde bestand kopieert. Gebruik dus een eigen account
  met schermvergrendeling en een versleutelde schijf, of kies een langere pin (alle tekens
  zijn toegestaan).

⚠️ Ledengegevens (Excel-bestanden, back-up-json's) horen **nooit** in deze repository. De
`.gitignore` weert ze, maar blijf er zelf ook op letten.

## Functies

- **Excel-import met kolomkoppeling** — kies zelf het tabblad, de kop-rij en welke kolom bij
  welk veld hoort. Bij een nieuwe import blijven alle eigen gegevens (contactmomenten,
  notities, schema's) bewaard; een importrapport toont wie nieuw is en wie wegviel.
- **Gezinnen** — personen worden op adres + postcode gegroepeerd; het gezinshoofd bepaalt de
  weergegeven naam en contactgegevens.
- **Contactmomenten** — log bezoeken met datum, tijd, soort (huisbezoek, doopbezoek,
  huwelijksbezoek, ziekenhuisbezoek, anders), notitie en gelezen gedeelte.
- **Automatisch terugkeerschema** — het bezoekinterval wordt berekend uit de leeftijd van het
  gezinshoofd en de gezinssamenstelling (standaard: tot 70 jaar om het jaar, vanaf 70 als
  stel 1× per jaar, alleenwonend 2× per jaar). Leeftijdsgrens en intervallen zijn instelbaar
  via menu → Instellingen; per gezin kun je ook een handmatig schema kiezen.
- **Weergaven** — lijst, twee kolommen, sorteerbare tabel en een planbord (achterstallig /
  komende maand / dit kwartaal / komend halfjaar / verder vooruit).
- **Bijzondere momenten** — verjaardagen vanaf een instelbare leeftijd, huwelijksjubilea in
  instelbare jaren en zelf ingeplande bijzondere bezoeken, met een attentiestip zodra er
  binnen 14 dagen iets aankomt.
- **Afspraak inplannen** — e-mail- of WhatsApp-bericht met invulbaar sjabloon, en een
  Scipio-link per persoon.
- **Pin-beveiliging met versleuteling** — de gegevens worden met een van de pin afgeleide
  sleutel versleuteld opgeslagen; na ontgrendelen een uur toegang. Bijzondere momenten zijn
  ook zonder pin in te zien (zonder gezinsdossiers).
- **Offline en installeerbaar (PWA)** — eenmaal geopend werkt de app zonder internet en kun
  je hem via "Installeren" / "Zet op beginscherm" als losse app gebruiken.

De volledige uitleg staat in de app zelf: menu → **Handleiding**.

## Aan de slag

1. Open de app (zie *Hosten* hieronder, of open `index.html` lokaal in een browser).
2. Stel bij het eerste gebruik een pin in (minimaal 4 tekens). **Onthoud deze goed** — de
   gegevens worden met deze pin versleuteld; bij een vergeten pin is de enige weg terug alle
   lokale gegevens wissen en een back-up terugzetten.
3. Kies een Excel-bestand met de ledengegevens, of zet een eerder gemaakte back-up (.json)
   terug. Regnr. en Naam zijn verplichte kolommen; Regnr. is het kenmerk waarmee personen
   bij een volgende import worden herkend.

## Back-ups en verhuizen naar een ander apparaat

De browseropslag is gebonden aan de herkomst (origin): wissel je van computer, van browser,
of van een lokaal geopend bestand naar de online versie, dan begint de app daar leeg. Zo
neem je alles mee:

1. **Oude omgeving:** klik op de back-upindicator rechtsboven (of menu → *Back-up maken*)
   en bewaar het `.json`-bestand.
2. **Nieuwe omgeving:** stel een pin in en kies op het startscherm
   *"of zet een eerdere back-up terug (.json)"*.

In de back-up zitten alle personen, gezinsgegevens, contactmomenten, notities én (sinds
back-upversie 3) de instellingen. Alleen de pin gaat bewust niet mee; die stel je op het
nieuwe apparaat opnieuw in. Het bestand is bewust onversleuteld (vangnet bij een vergeten
pin) — bewaar het veilig. Oudere back-upformaten blijven gewoon inleesbaar.

## Hosten op GitHub Pages

1. Zet deze repository op GitHub.
2. Ga naar **Settings → Pages**, kies **Deploy from a branch**, branch `main`, map `/ (root)`.
3. De app staat daarna op `https://<gebruikersnaam>.github.io/<repo>/`.

De repository bevat geen gegevens — publiek hosten is dus veilig: iedere bezoeker krijgt een
lege app die alleen met de eigen, lokale gegevens werkt.

## Voor wie aan de code werkt

Statische site zonder build-stap — bewerk de bestanden en ververs de browser.

| Bestand | Inhoud |
|---|---|
| `index.html` | Pagina-skelet, laadt de overige bestanden |
| `app.js` | Alle applicatielogica en UI (templates + events) |
| `styles.css` | Vormgeving |
| `sw.js` | Service worker: offline-cache |
| `manifest.webmanifest` | PWA-manifest (naam, iconen, kleuren) |
| `icons/` | App-iconen (192 en 512 px) |
| `vendor/xlsx.full.min.js` | [SheetJS Community Edition](https://sheetjs.com) **0.20.3**, vastgepind (van cdn.sheetjs.com — npm stopt bij 0.18.5 met bekende CVE's) |

Gegevensopslag: IndexedDB met als kern de store `kluis` — daarin staan alle personen en
gezinsgegevens als één AES-256-GCM-versleuteld blok. Daarnaast `instellingen` (onversleuteld:
schema-instellingen, pin-zout, sleutelcontrole, mijlpalen-cache) en de legacy-stores
`personen`/`gezinsdata` die alleen nog dienen voor de eenmalige migratie van oudere
installaties en als vangnet in browsers zonder Web Crypto.

**Belangrijk bij elke wijziging die je publiceert:** verhoog `CACHE_VERSIE` in `sw.js`
(bijv. `contactplanner-v2`), anders blijven bestaande bezoekers op de oude offline-versie
hangen tot hun service worker ververst.

De oorspronkelijke alles-in-één-versie (`contactplanner.html`, gebouwd in Claude) is bij de
opsplitsing naar deze structuur verwijderd.
