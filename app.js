/* ================= Huisbezoek & Contactplanner ================= */
/* Alle gegevens blijven op dit apparaat, in de IndexedDB van de browser waarin je de app
   opent — er wordt niets naar een server gestuurd, ook niet in de gehoste (GitHub Pages)
   versie. Excel wordt gebruikt om basisgegevens aan te leveren/te verversen; alles wat je
   in de app zelf toevoegt (contactmomenten, notities, schema) blijft bewaard.
   De persoonsgegevens staan versleuteld (AES-256-GCM) in de "kluis"-store; de sleutel wordt
   met PBKDF2 afgeleid van de pin. Back-ups (.json) zijn bewust ONversleuteld — dat is het
   vangnet bij een vergeten pin. Uitzondering op de versleuteling: een kleine cache met
   verjaardagen/jubilea, zodat "bijzondere momenten" ook op het slotscherm werkt.
   Let op: IndexedDB is gebonden aan de herkomst (origin) — wissel je van computer, browser
   of van lokaal bestand naar de online versie, neem dan je gegevens mee via een back-up. */

const DB_NAME = "huisbezoekPlannerDB";
const DB_VERSION = 4;
const APP_VERSIE = "1.7.8"; // bestaansjaar.maand.releasenr — staat los van CACHE_VERSIE in sw.js

// Vul per release een entry toe onder het nieuwe APP_VERSIE-nummer om gebruikers na het bijwerken
// eenmalig een "nieuwe versie"-melding te tonen. Ontbreekt een entry voor de nieuwe versie, dan
// wordt de melding stilzwijgend overgeslagen (geen popup, wel de versie als "gezien" opgeslagen).
const VERSIE_NOTITIES = {
  "1.7.6": {
    nieuw: [
      "Je krijgt voortaan na een update eenmalig een melding te zien met wat er nieuw is (en eventuele acties)",
      "Gezinsdossier opgesplitst in tabs: Gezin, Loggen, Plannen",
      "Contactmoment loggen is nu visueel prominent",
      "\"Bijzonder contactmoment inplannen\" hernoemd naar \"Inplannen — Bijzonder contactmoment\"",
      "Belafspraak toegevoegd als soort bij Inplannen — Bijzonder contactmoment",
      "Kruisje om de zoekopdracht te wissen verschijnt nu direct tijdens typen, ook in de Planningweergave",
      "Opmerking-label in de Planningweergave netjes uitgelijnd naast de datum",
      "Importlabel \"Trouwdatum (optioneel)\" hernoemd naar \"Huwelijksdatum\"",
      "Berichtsjablonen voor Afspraak inplannen: meerdere eigen sjablonen maken/beheren via Instellingen, met [naam]/[datum]/[tijd] als plekhouders",
      "E-mail-instelling toegevoegd: \"Mail sturen\" en \"Open in e-mail\" kunnen naar het standaard mailprogramma of direct naar Outlook op het web (Microsoft 365) — instelbaar via Instellingen",
      "Index bovenaan de handleiding om snel naar een sectie te springen",
      "Back-up opslaan kan nu ook via \"Opslaan als\" (zelf een locatie kiezen, bv. een OneDrive-map) in plaats van altijd te downloaden — instelbaar via Instellingen",
    ],
    actie: "Maak een nieuwe import vanuit Scipio en lees die in — dan staan o.a. Mobiel en Huwelijksdatum overal goed gevuld (zie de handleiding voor de importselectie).",
  },
  "1.7.7": {
    nieuw: [
      "AfspraakPlanner-koppeling: in de Planningweergave gezinnen selecteren en in één keer een aanvraag uitzetten, zodat gemeenteleden zelf een tijdslot kunnen kiezen",
      "Nieuwe plekhouder [link] in berichtsjablonen, voor de uitnodigingslink naar AfspraakPlanner",
      "Nieuwe instelling AfspraakPlanner (API-sleutel + basis-URL)",
    ],
    actie: "Vul bij Instellingen → AfspraakPlanner je persoonlijke API-sleutel in (eenmalig door de beheerder aangemaakt) voordat je \"Aanvraag uitzetten\" gebruikt.",
  },
  "1.7.8": {
    nieuw: [
      "Lopende AfspraakPlanner-aanvragen volgen: de knop \"Lopende aanvragen\" in de Planningweergave laat zien wie al een tijdslot gekozen heeft",
      "Een gekozen tijdslot neem je daar met één klik over als gepland bijzonder contactmoment",
      "Een lopende aanvraag kun je uitbreiden met extra tijdslots en extra gezinnen, en vrije tijdslots kun je intrekken",
      "Uitnodigingen opnieuw versturen (mail/WhatsApp) voor gezinnen die nog niet gekozen hebben",
      "Op de gezinskaarten (lijst, 2 kolommen en planbord) zie je nu een label als er een aanvraag uitstaat, en de gekozen datum zodra het gezin gekozen heeft",
      "Tijdslots snel vullen met \"Wekelijks herhalen\": bijv. elke dinsdag 20:00, tien weken vooruit",
      "De eindtijd van een tijdslot is voortaan optioneel — laat hem leeg als alleen de starttijd vaststaat",
      "Tijdslots waarvan de starttijd verstreken is, zijn niet meer kiesbaar en tonen als \"verlopen\"",
      "Het selectievinkje in de Planningweergave staat nu rechts in het midden van de kaart, los van het markeer-sterretje",
      "Instellingen en \"Aanvraag uitzetten\" zijn volledige pagina's geworden in plaats van popup-vensters",
      "Volledige pagina's (Instellingen, Bijzondere momenten, Aanvraag uitzetten) sluit je voortaan met een kruisje rechtsboven",
    ],
  },
};
const STORE_PERSONEN = "personen"; // t/m v3: platte gegevens; blijft bestaan voor migratie en als noodvangnet zonder Web Crypto
const STORE_GEZINSDATA = "gezinsdata"; // idem
const STORE_INSTELLINGEN = "instellingen";
const STORE_KLUIS = "kluis"; // vanaf v4: alle persoonsgegevens als één versleuteld blok

const PBKDF2_ITERATIES = 600000; // OWASP-richtlijn voor PBKDF2-HMAC-SHA256
const SLEUTELCHECK_TEKST = "contactplanner-sleutelcheck-v1";

const BASIS_VELDEN = [
  { key: "status", label: "Status", re: /^status$/i },
  { key: "regnr", label: "Regnr.", re: /(regnr|reg\.?\s*nr|registratienummer)/i },
  { key: "naam", label: "Naam", re: /^naam$/i },
  { key: "roepnaam", label: "Roepnaam", re: /roepnaam/i },
  { key: "geslacht", label: "Geslacht", re: /geslacht/i },
  { key: "wijk", label: "Wijk/sectie", re: /(wijk|sectie)/i },
  { key: "adres", label: "Adres", re: /^adres$/i },
  { key: "postcode", label: "Postcode", re: /postcode/i },
  { key: "plaats", label: "Plaatsnaam", re: /plaats/i },
  { key: "geboortedatum", label: "Geboortedatum", re: /geboorte/i },
  { key: "trouwdatum", label: "Huwelijksdatum", re: /trouw|huwelijksdatum/i },
  { key: "gezinsrelatie", label: "Gezinsrelatie", re: /gezinsrelatie/i },
  { key: "burgerlijkeStaat", label: "Burgerlijke staat", re: /burgerlijke/i },
  { key: "kerkelijkeStaat", label: "Kerkelijke staat", re: /kerkelijke/i },
  { key: "email", label: "E-mail", re: /e-?mail/i },
  { key: "telefoon", label: "Telefoon", re: /telefoon|tel\.?$/i },
  { key: "mobiel", label: "Mobiel", re: /mobiel|gsm/i },
];

const SOORTEN_BEZOEK = ["Huisbezoek", "Doopbezoek", "Huwelijksbezoek", "Ziekenhuisbezoek", "Anders"];
const SOORTEN_GEPLAND = ["Huisbezoek", "Belafspraak", "Doopbezoek", "Huwelijksbezoek", "Ziekenhuisbezoek", "Anders"];

// Standaard berichtsjabloon voor "Afspraak inplannen" (mail/WhatsApp). [naam], [datum] en [tijd]
// zijn plekhouders: [naam] wordt ingevuld zodra je een sjabloon kiest/een gezin opent, [datum] en
// [tijd] pas bij het versturen. Gebruikers beheren hun eigen sjablonen via Instellingen; dit is
// alleen de eenmalige standaardwaarde bij een schone installatie.
const STANDAARD_AFSPRAAK_SJABLOON = {
  id: "standaard",
  naam: "Standaard",
  onderwerp: "Huisbezoek inplannen",
  tekst: "Beste [naam],\n\nGraag zouden we binnenkort een huisbezoek bij u inplannen. Zou [datum] om [tijd] uur schikken?\n\nLaat het gerust weten wat het beste past.\n\nMet vriendelijke groet,",
};

// Standaardsjabloon voor een AfspraakPlanner-uitnodiging (zie afspraakplannerPaginaHTML).
// [link] is een derde plekhouder, naast [naam]; [datum]/[tijd] zijn hier niet van toepassing
// (de ontvanger kiest zelf een moment) en komen dus niet in deze tekst voor.
const STANDAARD_TIJDSLOT_SJABLOON = {
  id: "tijdslot-kiezen",
  naam: "Tijdslot kiezen",
  onderwerp: "Kies een moment voor een bezoek",
  tekst: "Beste [naam],\n\nWilt u een moment kiezen dat u schikt? Klik op de link en kies uw tijdslot:\n[link]\n\nMet vriendelijke groet,",
};

const STATUS_META = {
  nooit: { label: "Nog geen contact", color: "var(--red)", bg: "var(--red-bg)", order: 0, icon: "!", uitleg: "Er is nog geen contactmoment gelogd voor dit gezin." },
  teLaat: { label: "Contact is te laat", color: "var(--red)", bg: "var(--red-bg)", order: 1, icon: "!", uitleg: "De berekende volgende contactdatum is al verstreken." },
  binnenkort: { label: "Binnenkort gepland", color: "var(--amber)", bg: "var(--amber-bg)", order: 2, icon: "\u23F0", uitleg: "Het volgende contact is over 30 dagen of minder." },
  opSchema: { label: "Op schema", color: "var(--green)", bg: "var(--green-bg)", order: 3, icon: "\u2713", uitleg: "Er is nog ruim de tijd tot het volgende geplande contact." },
};

function basisSchemaLabel(schema, gd) {
  if (schema === "2x") return "2x per jaar";
  if (schema === "1x") return "1x per jaar";
  if (schema === "0.5x") return "Om het jaar";
  if (schema === "aangepast") return `Aangepast (elke ${(gd && gd.customMaanden) || "?"} maanden)`;
  return "Onbekend";
}

function schemaLabel(gd, gezin) {
  if (gd.schema === "auto") return `Automatisch: ${basisSchemaLabel(bepaalAutoSchema(gezin))}`;
  return basisSchemaLabel(gd.schema, gd);
}

function heeftPartnerInGezin(gezin) {
  const hoofd = gezin.gezinshoofd;
  return gezin.leden.some((p) => p.regnr !== hoofd.regnr && /partner|echtgeno/i.test(p.gezinsrelatie || ""));
}

// Automatisch terugkeerschema, op basis van leeftijd en gezinssamenstelling:
// - gezinshoofd jonger dan de leeftijdsgrens (of leeftijd onbekend): het "jonger"-interval
// - vanaf de leeftijdsgrens, met partner in het gezin: het "stel"-interval
// - vanaf de leeftijdsgrens, alleenwonend: het "alleen"-interval
// - vanaf de leeftijdsgrens, geen partner maar wel huisgenoten: het "stel"-interval
// De leeftijdsgrens en de drie intervallen zijn instelbaar via het menu > Instellingen.
function bepaalAutoSchema(gezin) {
  if (!gezin) return state.schemaAutoJong;
  const lft = berekenLeeftijd(gezin.gezinshoofd.geboortedatum);
  if (lft === null || lft < state.schemaAutoLeeftijd) return state.schemaAutoJong;
  if (heeftPartnerInGezin(gezin)) return state.schemaAutoStel;
  if (gezin.leden.length === 1) return state.schemaAutoAlleen;
  return state.schemaAutoStel;
}

function effectiefSchema(gd, gezin) {
  return gd.schema === "auto" ? bepaalAutoSchema(gezin) : gd.schema;
}

function volgendeJaarlijkseDatum(datumISO) {
  if (!datumISO) return null;
  const d = new Date(datumISO + "T00:00:00");
  if (isNaN(d)) return null;
  const vandaag = new Date(todayISO() + "T00:00:00");
  let jaar = vandaag.getFullYear();
  let kandidaat = new Date(jaar, d.getMonth(), d.getDate());
  if (kandidaat < vandaag) { jaar += 1; kandidaat = new Date(jaar, d.getMonth(), d.getDate()); }
  return {
    datumISO: toISO(kandidaat.getFullYear(), kandidaat.getMonth() + 1, kandidaat.getDate()),
    aantalJaar: kandidaat.getFullYear() - d.getFullYear(),
  };
}

function magHuwelijksMijlpaalTonen(gezin) {
  const hoofd = gezin.gezinshoofd;
  const staat = normKey(hoofd.burgerlijkeStaat);
  if (staat.includes("weduw") || staat.includes("gescheiden") || staat.includes("ongehuwd")) return false;
  return heeftPartnerInGezin(gezin);
}

function berekenMijlpalen() {
  const resultaten = [];
  computeGezinnen().forEach((gezin) => {
    gezin.leden.forEach((p) => {
      const volgende = volgendeJaarlijkseDatum(p.geboortedatum);
      if (!volgende) return;
      if (volgende.aantalJaar >= state.mijlpalenLeeftijdDrempel) {
        resultaten.push({
          type: "verjaardag",
          gezinsKey: gezin.gezinsKey,
          naam: p.naam,
          roepnaam: p.roepnaam,
          omschrijving: `wordt ${volgende.aantalJaar} jaar`,
          datum: volgende.datumISO,
          sleutel: `verjaardag:${p.regnr}:${volgende.datumISO.slice(0, 4)}`,
        });
      }
    });
    const hoofd = gezin.gezinshoofd;
    if (hoofd.trouwdatum && magHuwelijksMijlpaalTonen(gezin)) {
      const volgende = volgendeJaarlijkseDatum(hoofd.trouwdatum);
      if (volgende && state.mijlpalenHuwelijksJaren.includes(volgende.aantalJaar)) {
        resultaten.push({
          type: "huwelijk",
          gezinsKey: gezin.gezinsKey,
          naam: hoofd.naam,
          roepnaam: hoofd.roepnaam,
          omschrijving: `${volgende.aantalJaar} jaar getrouwd`,
          datum: volgende.datumISO,
          sleutel: `huwelijk:${gezin.gezinsKey}:${volgende.datumISO.slice(0, 4)}`,
        });
      }
    }
    const gd = getGezinsdata(gezin.gezinsKey);
    (gd.gepland || []).forEach((g) => {
      resultaten.push({
        type: "gepland",
        gezinsKey: gezin.gezinsKey,
        geplandId: g.id,
        naam: hoofd.naam,
        roepnaam: hoofd.roepnaam,
        omschrijving: `${g.soort}${g.betreft ? " \u2014 " + g.betreft : ""}${g.notitie ? ": " + g.notitie : ""}`,
        datum: g.datum,
        sleutel: `gepland:${gezin.gezinsKey}:${g.id}`,
      });
    });

  });
  resultaten.sort((a, b) => a.datum.localeCompare(b.datum));
  return resultaten;
}

async function toggleMijlpaalGedaan(sleutel) {
  const nu = !state.mijlpalenGedaan[sleutel];
  state.mijlpalenGedaan[sleutel] = nu;
  await veiligOpslaan(() => dbSetInstelling("mijlpaal-gedaan:" + sleutel, nu), "mijlpaal markeren");
}

// Vergrendeld zonder geladen gegevens (kluis dicht): val terug op de onversleutelde
// mijlpalen-cache. In alle andere gevallen wordt live berekend, zoals voorheen.
function mijlpalenBron() {
  if (state.vergrendeld && !state.personen.length) return state.mijlpalenCache || [];
  return berekenMijlpalen();
}

function heeftDringendeMijlpaal(alleenLezen) {
  const vandaag = todayISO();
  return mijlpalenBron().some((m) => {
    if (alleenLezen && m.type === "gepland") return false;
    if (state.mijlpalenGedaan[m.sleutel]) return false;
    const dagenTot = Math.round((new Date(m.datum + "T00:00:00") - new Date(vandaag + "T00:00:00")) / 86400000);
    return dagenTot <= 14;
  });
}

const MIJLPAAL_HORIZON_DAGEN = 90;

// Sluitkruisje voor volledige pagina's (Instellingen, Bijzondere momenten, Aanvraag uitzetten):
// rechtsboven onder de bovenbalk, zodat het voelt als een venster dat je sluit — sluiten
// brengt je terug naar het hoofdscherm.
function paginaSluitKnopHTML(id) {
  return `<div class="pagina-sluit-rij"><button class="btn-ghost pagina-sluit" id="${id}" title="Sluiten — terug naar het overzicht">✕</button></div>`;
}

function mijlpaalRijHTML(m, alleenLezen) {
  const typeLabels = { verjaardag: "Verjaardag", huwelijk: "Huwelijksjubileum", gepland: "Gepland" };
  const typeKleuren = {
    verjaardag: ["var(--blue)", "var(--blue-bg)"],
    huwelijk: ["var(--amber)", "var(--amber-bg)"],
    gepland: ["var(--red)", "var(--red-bg)"],
  };
  const [kleur, achtergrond] = typeKleuren[m.type];
  const dagenTekst = m.dagenTot === 0 ? "vandaag" : m.dagenTot < 0 ? `${Math.abs(m.dagenTot)}d geleden` : `over ${m.dagenTot}d`;
  const actieHTML = alleenLezen ? "" : (m.type === "gepland"
    ? `<span style="display:flex;gap:4px;">
         <button class="btn-sm btn-primary" data-gepland-gedaan-mp="${esc(m.gezinsKey)}" data-gepland-id-mp="${esc(m.geplandId)}">Gedaan (log contact)</button>
         <button class="btn-sm btn-danger" data-gepland-verwijder-mp="${esc(m.gezinsKey)}" data-gepland-id-mp="${esc(m.geplandId)}">Verwijderen</button>
       </span>`
    : `<button class="btn-sm ${m.gedaan ? "btn-primary" : ""}" data-toggle-mijlpaal="${esc(m.sleutel)}">${m.gedaan ? "\u2713 Kaartje gestuurd" : "Markeer als gedaan"}</button>`);

  return `
    <div class="mijlpaal-rij ${m.gedaan ? "mijlpaal-gedaan" : ""}">
      <div class="mijlpaal-type-tag" style="background:${achtergrond};color:${kleur};">${typeLabels[m.type]}</div>
      <div class="mijlpaal-naam" ${alleenLezen ? "" : `data-open="${esc(m.gezinsKey)}"`}>${esc(m.naam)}${m.roepnaam ? ` (${esc(m.roepnaam)})` : ""}</div>
      <div class="mijlpaal-omschrijving">${esc(m.omschrijving)}</div>
      <div class="mijlpaal-datum mono">${fmtDatum(m.datum)}</div>
      <div class="mijlpaal-dagen">${dagenTekst}</div>
      ${actieHTML}
    </div>`;
}

function mijlpalenHTML(alleenLezen) {
  const alle = mijlpalenBron();
  const vandaag = todayISO();
  const metDagen = alle.map((m) => ({
    ...m,
    dagenTot: Math.round((new Date(m.datum + "T00:00:00") - new Date(vandaag + "T00:00:00")) / 86400000),
    gedaan: !!state.mijlpalenGedaan[m.sleutel],
  }));
  const zonderGepland = alleenLezen ? metDagen.filter((m) => m.type !== "gepland") : metDagen;
  const zichtbaar = state.mijlpalenToonAlles ? zonderGepland : zonderGepland.filter((m) => m.dagenTot <= MIJLPAAL_HORIZON_DAGEN);

  const rijenHTML = zichtbaar.length === 0
    ? `<div class="empty-state">Geen bijzondere momenten gevonden${state.mijlpalenToonAlles ? "" : ` binnen ${MIJLPAAL_HORIZON_DAGEN} dagen`}. Controleer of geboortedata en trouwdata zijn ingevuld.</div>`
    : zichtbaar.map((m) => mijlpaalRijHTML(m, alleenLezen)).join("");

  return `
    ${alleenLezen ? "" : paginaSluitKnopHTML("btnMijlpalenTerug")}
    <h2 style="font-size:22px;margin:0 0 4px;">Bijzondere momenten</h2>
    <p style="color:var(--text-soft);font-size:13px;margin-bottom:16px;">
      Verjaardagen vanaf de ingestelde leeftijd, en huwelijksjubilea in de ingestelde jaren \u2014 zodat je op tijd weet
      wanneer een kaartje of belletje op zijn plaats is.${alleenLezen ? " Namen zijn hier zichtbaar zonder pin; geplande bijzondere contactmomenten en het openen van een gezinsdossier vereisen volledig ontgrendelen." : ""}
    </p>

    <div class="mijlpalen-instellingen">
      <div class="field-row" style="max-width:220px;">
        <label>Verjaardag vanaf leeftijd</label>
        <input type="number" min="1" id="mijlpaalLeeftijd" value="${esc(state.mijlpalenLeeftijdDrempel)}" />
      </div>
      <div class="field-row" style="flex:1;min-width:220px;">
        <label>Huwelijksjubilea (jaren, kommagescheiden)</label>
        <input id="mijlpaalHuwelijksjaren" value="${esc(state.mijlpalenHuwelijksJaren.join(", "))}" />
      </div>
    </div>

    <div class="toolbar" style="margin-top:14px;">
      <div class="view-toggle">
        <button class="btn-sm ${!state.mijlpalenToonAlles ? "active" : ""}" data-mijlpaal-filter="komend">Komende ${MIJLPAAL_HORIZON_DAGEN} dagen</button>
        <button class="btn-sm ${state.mijlpalenToonAlles ? "active" : ""}" data-mijlpaal-filter="alles">Alles (heel jaar)</button>
      </div>
    </div>

    <div class="mijlpalen-lijst">${rijenHTML}</div>`;
}

// ---------------- IndexedDB helpers ----------------

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PERSONEN)) {
        db.createObjectStore(STORE_PERSONEN, { keyPath: "regnr" });
      }
      if (!db.objectStoreNames.contains(STORE_GEZINSDATA)) {
        db.createObjectStore(STORE_GEZINSDATA, { keyPath: "gezinsKey" });
      }
      if (!db.objectStoreNames.contains(STORE_INSTELLINGEN)) {
        db.createObjectStore(STORE_INSTELLINGEN, { keyPath: "sleutel" });
      }
      if (!db.objectStoreNames.contains(STORE_KLUIS)) {
        db.createObjectStore(STORE_KLUIS, { keyPath: "naam" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGet(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, "readonly").objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGetAll(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function dbPutAll(store, records) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const os = tx.objectStore(store);
    records.forEach((r) => os.put(r));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbPut(store, record) {
  return dbPutAll(store, [record]);
}

async function dbDelete(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbClearAll(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbGetInstelling(sleutel) {
  const alle = await dbGetAll(STORE_INSTELLINGEN);
  const rec = alle.find((r) => r.sleutel === sleutel);
  return rec ? rec.waarde : undefined;
}

async function dbSetInstelling(sleutel, waarde) {
  await dbPut(STORE_INSTELLINGEN, { sleutel, waarde });
}

async function dbDeleteInstelling(sleutel) {
  await dbDelete(STORE_INSTELLINGEN, sleutel);
}

// ---------------- versleuteling (Web Crypto) ----------------
// De persoonsgegevens worden als één blok versleuteld opgeslagen in de kluis-store.
// De AES-sleutel wordt met PBKDF2 afgeleid van de pin en bestaat alleen in het geheugen;
// tijdens het ontgrendelde uur staat hij daarnaast als niet-exporteerbare CryptoKey in de
// instellingen-store, zodat een herlaadbeurt binnen dat uur geen pin vraagt.

const cryptoRuntime = { sleutel: null };

function versleutelingBeschikbaar() {
  return !!(window.crypto && window.crypto.subtle && window.crypto.getRandomValues);
}

function bytesNaarB64(bytes) {
  let s = "";
  bytes.forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s);
}

function b64NaarBytes(s) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function afleidenSleutel(pin, zoutBytes, iteraties) {
  const basis = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: zoutBytes, iterations: iteraties || PBKDF2_ITERATIES, hash: "SHA-256" },
    basis,
    { name: "AES-GCM", length: 256 },
    false, // niet exporteerbaar: de ruwe sleutelbytes zijn vanuit JavaScript niet uit te lezen
    ["encrypt", "decrypt"]
  );
}

async function versleutelJSON(sleutel, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, sleutel, new TextEncoder().encode(JSON.stringify(obj)));
  return { iv: bytesNaarB64(iv), data: bytesNaarB64(new Uint8Array(cipher)) };
}

async function ontsleutelJSON(sleutel, pakket) {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64NaarBytes(pakket.iv) }, sleutel, b64NaarBytes(pakket.data));
  return JSON.parse(new TextDecoder().decode(plain));
}

function eenvoudigeHashOud(tekst) {
  let hash = 5381;
  const gezouten = "cpv-pin-v1:" + tekst;
  for (let i = 0; i < gezouten.length; i++) {
    hash = ((hash << 5) + hash + gezouten.charCodeAt(i)) | 0;
  }
  return String(hash);
}

async function veiligeHash(tekst) {
  const gezouten = "cpv-pin-v2:" + tekst;
  if (window.crypto && window.crypto.subtle) {
    try {
      const data = new TextEncoder().encode(gezouten);
      const buffer = await window.crypto.subtle.digest("SHA-256", data);
      return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch (e) {
      logDebug("fout", "SHA-256 hashing mislukt, gebruik fallback: " + e.message);
    }
  }
  // Fallback voor de zeldzame situatie dat Web Crypto niet beschikbaar is.
  let h1 = 5381, h2 = 52711;
  for (let i = 0; i < gezouten.length; i++) {
    const c = gezouten.charCodeAt(i);
    h1 = (h1 * 33 + c) | 0;
    h2 = (h2 * 31 + c) | 0;
  }
  return "fb-" + (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
}

// ---------------- date & misc helpers ----------------

function todayISO() {
  // Bewust lokale tijd, niet toISOString() (UTC) — anders is het 's nachts nog "gisteren".
  const d = new Date();
  return toISO(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function pad2(n) { return String(n).padStart(2, "0"); }

function toISO(y, m, d) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function parseDatumFlexibel(value) {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date && !isNaN(value)) {
    return toISO(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === "number") {
    // Excel serial date fallback
    const d = XLSX.SSF.parse_date_code(value);
    if (d) return toISO(d.y, d.m, d.d);
    return "";
  }
  const s = String(value).trim();
  if (!s) return "";
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return toISO(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = (+y > 30 ? "19" : "20") + y;
    return toISO(+y, +mo, +d);
  }
  return s;
}

function fmtDatum(iso) {
  if (!iso) return "\u2014";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("nl-NL", { day: "2-digit", month: "short", year: "numeric" });
}

function berekenLeeftijd(geboortedatumISO) {
  if (!geboortedatumISO) return null;
  const geb = new Date(geboortedatumISO + "T00:00:00");
  if (isNaN(geb)) return null;
  const nu = new Date();
  let leeftijd = nu.getFullYear() - geb.getFullYear();
  const nogNietJarigDitJaar = (nu.getMonth() < geb.getMonth()) ||
    (nu.getMonth() === geb.getMonth() && nu.getDate() < geb.getDate());
  if (nogNietJarigDitJaar) leeftijd--;
  return leeftijd;
}

function addMonths(dateISO, months) {
  const d = new Date(dateISO + "T00:00:00");
  d.setMonth(d.getMonth() + months);
  return toISO(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function addDays(dateISO, days) {
  const d = new Date(dateISO + "T00:00:00");
  d.setDate(d.getDate() + days);
  return toISO(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function intervalMaanden(gd, gezin) {
  const schema = effectiefSchema(gd, gezin);
  if (schema === "2x") return 6;
  if (schema === "1x") return 12;
  if (schema === "0.5x") return 24;
  if (schema === "aangepast") return Math.max(1, parseInt(gd.customMaanden || "12", 10));
  return 12;
}

function berekenVolgendContact(gd, gezin) {
  if (gd.volgendContactOverride) return gd.volgendContactOverride;
  const regulier = gd.laatsteContact ? addMonths(gd.laatsteContact, intervalMaanden(gd, gezin)) : "";

  // Een huwelijks- of doopbezoek na het laatste huisbezoek schuift het volgende huisbezoek
  // een jaar op \u2014 maar nooit eerder dan wat het reguliere schema al aangaf.
  const specialeSoorten = ["Huwelijksbezoek", "Doopbezoek"];
  const specialeBezoeken = (gd.historie || []).filter((h) => specialeSoorten.includes(h.soort));
  let speciaalVervolg = "";
  if (specialeBezoeken.length) {
    const laatsteSpeciaal = specialeBezoeken.reduce((m, h) => (h.datum > m.datum ? h : m), specialeBezoeken[0]);
    if (!gd.laatsteContact || laatsteSpeciaal.datum > gd.laatsteContact) {
      speciaalVervolg = addMonths(laatsteSpeciaal.datum, 12);
    }
  }

  if (regulier && speciaalVervolg) return regulier > speciaalVervolg ? regulier : speciaalVervolg;
  return regulier || speciaalVervolg || "";
}

function berekenStatus(gd, gezin) {
  const next = berekenVolgendContact(gd, gezin);
  if (!next) return "nooit";
  const diffDagen = Math.round((new Date(next + "T00:00:00") - new Date(todayISO() + "T00:00:00")) / 86400000);
  if (diffDagen < 0) return "teLaat";
  if (diffDagen <= 30) return "binnenkort";
  return "opSchema";
}

function normKey(s) { return (s || "").toString().trim().toLowerCase(); }

function uid() { return "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function esc(s) {
  return String(s === undefined || s === null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ---------------- gezinnen (huishoudens) ----------------
// Een gezin wordt herkend aan adres + postcode (samen uniek per huishouden).
// Het gezinshoofd (Gezinsrelatie = "gezinshoofd") levert naam/contactgegevens voor het gezin.

function scipioUrl(regnr) {
  const tekst = String(regnr || "").trim();
  if (!/^\d+$/.test(tekst)) return null;
  return `https://scipio-online.nl/ledenadministratie/search.aspx?regnr=${tekst.padStart(8, "0")}&target=persoonskaart`;
}

async function toggleFavoriet(gezinsKey) {
  const gd = getGezinsdata(gezinsKey);
  await updateGezinsdata(gezinsKey, { favoriet: !gd.favoriet });
}

function famKeyOf(p) {
  const basis = normKey(p.adres) + "|" + normKey(p.postcode).replace(/\s+/g, "");
  if (!normKey(p.adres)) return "los:" + p.regnr; // geen adres bekend: eigen "gezin" van 1, om verkeerd samenvoegen te voorkomen
  return basis;
}

function computeGezinnen() {
  const groepen = {};
  state.personen.forEach((p) => {
    const key = famKeyOf(p);
    if (!groepen[key]) groepen[key] = [];
    groepen[key].push(p);
  });
  return Object.keys(groepen).map((key) => {
    const leden = groepen[key].slice().sort((a, b) => {
      const ah = /gezinshoofd/i.test(a.gezinsrelatie) ? 0 : 1;
      const bh = /gezinshoofd/i.test(b.gezinsrelatie) ? 0 : 1;
      if (ah !== bh) return ah - bh;
      return (a.geboortedatum || "9999") .localeCompare(b.geboortedatum || "9999");
    });
    const gezinshoofd = leden.find((p) => /gezinshoofd/i.test(p.gezinsrelatie)) || leden[0];
    return {
      gezinsKey: key,
      adres: gezinshoofd.adres,
      postcode: gezinshoofd.postcode,
      plaats: gezinshoofd.plaats,
      wijk: gezinshoofd.wijk,
      leden,
      gezinshoofd,
    };
  });
}

function defaultGezinsdata() {
  return { schema: "auto", customMaanden: "", laatsteContact: "", volgendContactOverride: "", gelezenGedeelte: "", notitie: "", historie: [], algemeneNotitie: "", gepland: [], favoriet: false };
}

function getGezinsdata(gezinsKey) {
  return state.gezinsdata[gezinsKey] || defaultGezinsdata();
}

// ---------------- app state ----------------

const runtime = { wb: null };

// ---------------- diagnostics / debug logging ----------------

const debugLog = [];

function logDebug(level, msg, data) {
  debugLog.push({ time: new Date().toLocaleTimeString("nl-NL"), level, msg, data: data !== undefined ? safeStringify(data) : "" });
  if (debugLog.length > 200) debugLog.shift();
}

function safeStringify(v) {
  try { return JSON.stringify(v, (k, val) => (val instanceof Date ? val.toISOString() : val), 2); }
  catch (e) { return String(v); }
}

window.addEventListener("error", (e) => {
  logDebug("fout", e.message, { bestand: e.filename, regel: e.lineno });
  toonFoutBanner("Er ging iets mis: " + e.message + ". Klik op 'Debug' rechtsboven voor details.");
});
window.addEventListener("unhandledrejection", (e) => {
  logDebug("fout", "Onverwerkte fout: " + (e.reason && e.reason.message ? e.reason.message : e.reason));
  toonFoutBanner("Er ging iets mis tijdens een bewerking. Klik op 'Debug' rechtsboven voor details.");
});

let foutBannerTekst = "";
function toonFoutBanner(tekst) {
  foutBannerTekst = tekst;
  const el = document.getElementById("foutBanner");
  if (el) { el.textContent = tekst; el.style.display = "flex"; }
}

let opslagBezigTeller = 0;

async function veiligOpslaan(schrijfFn, context) {
  opslagBezigTeller++;
  state.saveState = "saving";
  render();
  try {
    await schrijfFn();
    state.saveState = "saved";
    // Elke geslaagde wijziging telt als "nog niet in de back-up" — behalve het
    // bijwerken van de back-upadministratie zelf.
    if (context !== "backup-administratie") {
      state.laatsteWijzigingOp = Date.now();
      dbSetInstelling("laatsteWijzigingOp", state.laatsteWijzigingOp)
        .catch((e) => logDebug("fout", "Kon wijzigingstijdstip niet opslaan: " + e.message));
    }
    render();
    setTimeout(() => { if (state.saveState === "saved") { state.saveState = "idle"; render(); } }, 1500);
    return true;
  } catch (err) {
    state.saveState = "fout";
    logDebug("fout", `Opslaan mislukt (${context}): ${err.message}`, { stack: err.stack });
    toonFoutBanner(`Let op: deze wijziging (${context}) is NIET opgeslagen. Probeer het opnieuw, of klik op 'Debug' voor details.`);
    render();
    return false;
  } finally {
    opslagBezigTeller--;
  }
}

window.addEventListener("beforeunload", (e) => {
  if (opslagBezigTeller > 0 || state.saveState === "fout") {
    e.preventDefault();
    e.returnValue = "";
  }
});

const state = {
  stage: "loading", // loading | upload | sheetPrep | mapping | importReport | dashboard
  personen: [],
  gezinsdata: {}, // gezinsKey -> { schema, customMaanden, laatsteContact, volgendContactOverride, gelezenGedeelte, notitie, historie }
  sheetNames: [],
  selectedSheetName: "",
  aoa: [],
  headerRowIndex: 0,
  headerRowDiagnostiek: [],
  rawHeaders: [],
  rawRows: [],
  mapping: {},
  importDiff: null, // { nieuw: [...regnr], vertrokken: [...regnr] }
  selectedGezinsKey: null,
  search: "",
  filterStatus: "alle",
  sortBy: "status", // status | naam | adres | plaats | laatsteContact | volgendContact
  sortDir: "asc",
  weergave: "planning", // lijst | kolommen2 | tabel | planning
  tabelKolomBreedtes: { naam: 170, overigeLeden: 170, adres: 170, plaats: 110, laatsteContact: 120, volgendContact: 120, status: 150 },
  noteDraft: { datum: todayISO(), tijd: "19:30", soort: "Huisbezoek", notitie: "", gelezen: "" },
  bewerkNotitieId: null,
  geplandDraft: { datum: "", soort: "Ziekenhuisbezoek", betreft: "", notitie: "" },
  afspraakDraft: { onderwerp: "Huisbezoek inplannen", tekst: "", datum: "", tijd: "19:30" },
  afspraakSjablonen: [{ ...STANDAARD_AFSPRAAK_SJABLOON }, { ...STANDAARD_TIJDSLOT_SJABLOON }],
  afspraakSjabloonId: STANDAARD_AFSPRAAK_SJABLOON.id,
  mailMethode: "mailto", // mailto | outlook
  backupOpslagMethode: "download", // download | opslaanAls
  afspraakplannerApiSleutel: "",
  afspraakplannerBasisUrl: "https://afspraak.hhgputten.nl",
  selectieModusPlanning: false,
  geselecteerdeGezinnen: [], // gezinsKeys, alleen in-memory
  afspraakplannerStap: "samenstellen", // samenstellen | resultaat (op de pagina "Aanvraag uitzetten")
  afspraakplannerOmschrijving: "",
  afspraakplannerTijdslots: [],
  afspraakplannerResultaat: null, // { tijdslots, deelnemers } na een succesvolle aanvraag
  afspraakplannerFout: "",
  afspraakplannerBezig: false,
  afspraakplannerSjabloonId: STANDAARD_TIJDSLOT_SJABLOON.id,
  afspraakAanvragen: [], // uitgezette aanvragen: { id, omschrijving, aangemaaktOp, deelnemers, status, laatstVernieuwdOp, overgenomen } — versleuteld mee in de kluis
  aanvragenOverzichtOpen: false,
  aanvraagStatusBezigId: null, // id van de aanvraag waarvan de status nu wordt opgehaald
  aanvraagFouten: {}, // id -> foutmelding van de laatste statusaanvraag, alleen in-memory
  aanvraagSlotDraft: {}, // id -> { datum, start, eind } voor "tijdslot toevoegen", alleen in-memory
  aanvraagGezinDraft: {}, // id -> gezinsKey voor "gezin toevoegen", alleen in-memory
  afspraakplannerHerhaalWeken: 4, // aantal weken voor "wekelijks herhalen" in het aanvraagformulier
  editingContact: false,
  detailTab: "gezin", // gezin | loggen | plannen
  saveState: "idle", // idle | saving | saved | fout
  laatsteWijzigingOp: null, // epoch ms van de laatste geslaagde gegevenswijziging
  laatsteBackupOp: null, // epoch ms van de laatst gemaakte of teruggezette back-up
  debugOpen: false,
  menuOpen: false,
  handleidingOpen: false,
  nieuweVersieTonen: false,
  // pin-beveiliging & versleuteling
  vergrendeld: true,
  lockMode: "invoeren", // instellen | invoeren
  pinHash: null, // alleen nog in de onversleutelde (oude of Web Crypto-loze) situatie
  pinZout: null, // base64-zout voor de sleutelafleiding
  pinIteraties: null,
  sleutelCheck: null, // versleutelde controlewaarde: klopt de pin?
  pinFout: "",
  mijlpalenZonderPin: false,
  mijlpalenCache: [], // onversleutelde kopie van verjaardagen/jubilea voor het slotscherm
  // mijlpalen
  mijlpalenLeeftijdDrempel: 70,
  mijlpalenHuwelijksJaren: [25, 30, 40, 45, 50, 55, 60],
  mijlpalenToonAlles: false,
  mijlpalenGedaan: {},
  // automatisch terugkeerschema (instelbaar via menu > Instellingen)
  instellingenTerug: null, // stage om naar terug te keren vanaf de instellingenpagina
  schemaAutoLeeftijd: 70,
  schemaAutoJong: "0.5x",
  schemaAutoStel: "1x",
  schemaAutoAlleen: "2x",
};

function findPersoon(regnr) { return state.personen.find((p) => p.regnr === regnr); }
function findGezin(gezinsKey) { return computeGezinnen().find((g) => g.gezinsKey === gezinsKey); }

// Schrijft de volledige gegevensset weg. Met sleutel: als één versleuteld blok in de kluis.
// Zonder Web Crypto (zeldzaam): plat, zoals in eerdere versies, zodat de app blijft werken.
async function bewaarGegevens() {
  if (cryptoRuntime.sleutel) {
    const pakket = await versleutelJSON(cryptoRuntime.sleutel, { personen: state.personen, gezinsdata: state.gezinsdata, afspraakAanvragen: state.afspraakAanvragen });
    await dbPut(STORE_KLUIS, { naam: "gegevens", iv: pakket.iv, data: pakket.data });
  } else {
    await dbClearAll(STORE_PERSONEN);
    await dbClearAll(STORE_GEZINSDATA);
    await dbPutAll(STORE_PERSONEN, state.personen);
    await dbPutAll(STORE_GEZINSDATA, Object.values(state.gezinsdata));
    // Zonder kluis (geen Web Crypto): aanvragen dan maar plat bij de instellingen.
    await dbSetInstelling("afspraakAanvragen", state.afspraakAanvragen);
  }
  await werkMijlpalenCacheBij();
}

// Compacte, bewust ONversleutelde kopie van verjaardagen en jubilea (geen adressen, geen
// geplande momenten), zodat het slotscherm "bijzondere momenten" kan tonen zonder pin.
async function werkMijlpalenCacheBij() {
  const cache = berekenMijlpalen()
    .filter((m) => m.type !== "gepland")
    .map(({ type, naam, roepnaam, omschrijving, datum, sleutel }) => ({ type, naam, roepnaam, omschrijving, datum, sleutel }));
  state.mijlpalenCache = cache;
  await dbSetInstelling("mijlpalenCache", cache);
}

async function laadUitKluis() {
  const rec = await dbGet(STORE_KLUIS, "gegevens");
  state.personen = [];
  state.gezinsdata = {};
  if (rec) {
    const inhoud = await ontsleutelJSON(cryptoRuntime.sleutel, rec);
    state.personen = inhoud.personen || [];
    state.gezinsdata = inhoud.gezinsdata || {};
    state.afspraakAanvragen = inhoud.afspraakAanvragen || [];
  }
  migreerOudeContactgegevens();
  herstelLaatsteContactAlleGezinnen();
  werkMijlpalenCacheBij().catch((e) => logDebug("fout", "Kon mijlpalen-cache niet bijwerken: " + e.message));
  state.stage = state.personen.length ? "dashboard" : "upload";
  if (state.stage === "dashboard") {
    controleerNieuweVersie().catch((e) => logDebug("fout", "Kon versie niet controleren: " + e.message));
  }
}

// Toont eenmalig een "nieuwe versie"-melding zodra de opgeslagen "laatst geziene versie"
// afwijkt van APP_VERSIE én er een entry in VERSIE_NOTITIES bestaat. Deze functie draait alleen
// als state.stage al "dashboard" is (dus met bestaande gegevens) — een nog nooit opgeslagen
// versie betekent hier dus een bestaande gebruiker die deze functionaliteit voor het eerst
// tegenkomt, niet een gloednieuwe installatie, en telt daarom ook mee voor de melding.
async function controleerNieuweVersie() {
  const gezien = await dbGetInstelling("laatstGezieneVersie");
  if (gezien === APP_VERSIE) return;
  if (VERSIE_NOTITIES[APP_VERSIE]) {
    state.nieuweVersieTonen = true;
  } else {
    await dbSetInstelling("laatstGezieneVersie", APP_VERSIE);
  }
}

// Zet de versleuteling op met een (nieuwe) pin: nieuw zout, nieuwe sleutel, controlewaarde,
// en herversleutelt de huidige gegevens. Wist daarna de oude platte opslag (eenmalige migratie).
async function activeerVersleuteling(pin) {
  const zout = crypto.getRandomValues(new Uint8Array(16));
  const sleutel = await afleidenSleutel(pin, zout, PBKDF2_ITERATIES);
  cryptoRuntime.sleutel = sleutel;
  // Volgorde is bewust: eerst de kluis vullen, dan pas de controlewaarde vastleggen en de
  // platte opslag wissen. Breekt de migratie halverwege af, dan is er nooit gegevensverlies.
  await bewaarGegevens();
  state.pinZout = bytesNaarB64(zout);
  state.pinIteraties = PBKDF2_ITERATIES;
  state.sleutelCheck = await versleutelJSON(sleutel, SLEUTELCHECK_TEKST);
  await dbSetInstelling("pinZout", state.pinZout);
  await dbSetInstelling("pinIteraties", state.pinIteraties);
  await dbSetInstelling("sleutelCheck", state.sleutelCheck);
  await dbClearAll(STORE_PERSONEN);
  await dbClearAll(STORE_GEZINSDATA);
  await dbDeleteInstelling("pinHash");
  state.pinHash = null;
  try { await dbSetInstelling("sessieSleutel", sleutel); }
  catch (e) { logDebug("fout", "Kon sessiesleutel niet bewaren (na herladen is de pin opnieuw nodig): " + e.message); }
}

// Controleert de pin en zet bij succes de sleutel klaar. Bestond er alleen nog een oude
// pin-hash (onversleutelde situatie), dan wordt de versleuteling nu eenmalig geactiveerd.
async function ontgrendelMetPin(pin) {
  if (versleutelingBeschikbaar() && state.sleutelCheck) {
    try {
      const sleutel = await afleidenSleutel(pin, b64NaarBytes(state.pinZout), state.pinIteraties);
      await ontsleutelJSON(sleutel, state.sleutelCheck);
      cryptoRuntime.sleutel = sleutel;
      return true;
    } catch (e) {
      return false;
    }
  }
  const juist = (await veiligeHash(pin)) === state.pinHash || eenvoudigeHashOud(pin) === state.pinHash;
  if (!juist) return false;
  if (versleutelingBeschikbaar()) {
    logDebug("info", "Pin klopt — bestaande onversleutelde gegevens worden nu eenmalig versleuteld");
    await activeerVersleuteling(pin);
  }
  return true;
}

async function naOntgrendeling() {
  const ontgrendeldTot = Date.now() + 3600000;
  await dbSetInstelling("ontgrendeldTot", ontgrendeldTot);
  if (cryptoRuntime.sleutel) {
    try { await dbSetInstelling("sessieSleutel", cryptoRuntime.sleutel); }
    catch (e) { logDebug("fout", "Kon sessiesleutel niet bewaren (na herladen is de pin opnieuw nodig): " + e.message); }
    if (!state.personen.length) await laadUitKluis();
  }
  state.vergrendeld = false;
  state.pinFout = "";
  plantAutoVergrendel(3600000);
}

async function persist(next) {
  state.personen = next;
  await veiligOpslaan(bewaarGegevens, "gegevens bijwerken");
}

async function updatePersoon(regnr, patch) {
  const idx = state.personen.findIndex((p) => p.regnr === regnr);
  if (idx === -1) return;
  state.personen[idx] = { ...state.personen[idx], ...patch };
  await veiligOpslaan(bewaarGegevens, "persoonsgegevens bijwerken");
}

async function updateGezinsdata(gezinsKey, patch) {
  const updated = { ...getGezinsdata(gezinsKey), ...patch, gezinsKey };
  state.gezinsdata[gezinsKey] = updated;
  await veiligOpslaan(bewaarGegevens, "contactgegevens bijwerken");
}

async function verwijderPersoon(regnr) {
  if (!confirm("Dit gezinslid verwijderen uit de lokale lijst?")) return;
  state.personen = state.personen.filter((p) => p.regnr !== regnr);
  await veiligOpslaan(bewaarGegevens, "gezinslid verwijderen");
}

async function verwijderGezin(gezinsKey) {
  const gezin = findGezin(gezinsKey);
  if (!gezin) return;
  if (!confirm(`Dit hele gezin (${gezin.leden.length} perso${gezin.leden.length === 1 ? "on" : "nen"}) en de bijbehorende contactgeschiedenis verwijderen?`)) return;
  const regnrs = new Set(gezin.leden.map((p) => p.regnr));
  state.personen = state.personen.filter((p) => !regnrs.has(p.regnr));
  delete state.gezinsdata[gezinsKey];
  state.selectedGezinsKey = null;
  await veiligOpslaan(bewaarGegevens, "gezin verwijderen");
}

function herstelLaatsteContactAlleGezinnen() {
  let aangepast = 0;
  Object.keys(state.gezinsdata).forEach((key) => {
    const gd = state.gezinsdata[key];
    const correct = berekenLaatsteRegulierContact(gd.historie);
    if (correct !== (gd.laatsteContact || "")) {
      state.gezinsdata[key] = { ...gd, laatsteContact: correct };
      aangepast++;
    }
  });
  if (aangepast > 0) {
    logDebug("info", `Schema-herstel: laatste contact herberekend voor ${aangepast} gezin(nen) \u2014 alleen "Huisbezoek" telt nog mee voor het reguliere schema`);
    bewaarGegevens().catch((e) => logDebug("fout", "Kon herstelde gezinsdata niet opslaan: " + e.message));
  }
}

function migreerOudeContactgegevens() {
  if (Object.keys(state.gezinsdata).length > 0) return;
  const heeftLegacyData = state.personen.some((p) => p.laatsteContact || (p.historie && p.historie.length) || p.notitie || p.gelezenGedeelte);
  if (!heeftLegacyData) return;
  logDebug("info", "Oude contactgegevens per persoon gevonden \u2014 migreren naar gezinsniveau");
  const gezinnen = computeGezinnen();
  const migrated = {};
  gezinnen.forEach((g) => {
    const kandidaten = g.leden.filter((p) => p.laatsteContact || (p.historie && p.historie.length));
    const bron = kandidaten.find((p) => p.regnr === g.gezinshoofd.regnr) ||
      kandidaten.sort((a, b) => (b.laatsteContact || "").localeCompare(a.laatsteContact || ""))[0];
    if (bron) {
      migrated[g.gezinsKey] = {
        gezinsKey: g.gezinsKey,
        schema: bron.schema || "1x",
        customMaanden: bron.customMaanden || "",
        laatsteContact: bron.laatsteContact || "",
        volgendContactOverride: bron.volgendContactOverride || "",
        gelezenGedeelte: bron.gelezenGedeelte || "",
        notitie: bron.notitie || "",
        historie: bron.historie || [],
      };
    }
  });
  state.gezinsdata = migrated;
  bewaarGegevens().catch((e) => logDebug("fout", "Kon gemigreerde gezinsdata niet opslaan: " + e.message));
  logDebug("info", `Migratie voltooid: ${Object.keys(migrated).length} gezin(nen) overgezet`);
}

// ---------------- Excel import ----------------

function guessMapping(headers) {
  const mapping = {};
  BASIS_VELDEN.forEach((f) => { mapping[f.key] = ""; });
  headers.forEach((h) => {
    BASIS_VELDEN.forEach((f) => {
      if (!mapping[f.key] && f.re.test(h)) mapping[f.key] = h;
    });
  });
  return mapping;
}

function cellToDisplay(v) {
  if (v instanceof Date) return parseDatumFlexibel(v);
  return v === undefined || v === null ? "" : v;
}

function berekenWerkelijkBereik(sheet) {
  let minR = 0, minC = 0, maxR = 0, maxC = 0, gevonden = false;
  Object.keys(sheet).forEach((addr) => {
    if (addr[0] === "!") return;
    const cell = XLSX.utils.decode_cell(addr);
    if (!gevonden) { minR = cell.r; minC = cell.c; maxR = cell.r; maxC = cell.c; gevonden = true; return; }
    if (cell.r > maxR) maxR = cell.r;
    if (cell.c > maxC) maxC = cell.c;
    if (cell.r < minR) minR = cell.r;
    if (cell.c < minC) minC = cell.c;
  });
  if (!gevonden) return sheet["!ref"];
  return XLSX.utils.encode_range({ s: { r: minR, c: minC }, e: { r: maxR, c: maxC } });
}

function loadSheetAOA(sheetName) {
  const sheet = runtime.wb.Sheets[sheetName];
  const opgegevenBereik = sheet["!ref"] || "(geen)";
  const werkelijkBereik = berekenWerkelijkBereik(sheet);
  if (werkelijkBereik !== opgegevenBereik) {
    logDebug("info", `Tabblad "${sheetName}": opgegeven bereik (${opgegevenBereik}) week af van werkelijke celdata \u2014 gecorrigeerd naar ${werkelijkBereik}`);
  }
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", range: werkelijkBereik });
  return aoa.map((row) => row.map(cellToDisplay));
}

function guessHeaderRowIndex(aoa) {
  let best = 0, bestScore = -1;
  const scan = Math.min(aoa.length, 60);
  const diagnostiek = [];
  for (let i = 0; i < scan; i++) {
    const row = aoa[i];
    const filled = row.filter((c) => String(c).trim() !== "").length;
    const matchedVelden = BASIS_VELDEN.filter((f) => row.some((c) => f.re.test(String(c).trim())));
    const score = filled + matchedVelden.length * 8;
    diagnostiek.push({ rij: i + 1, gevuld: filled, herkend: matchedVelden.map((f) => f.label), score });
    if (score > bestScore) { bestScore = score; best = i; }
  }
  state.headerRowDiagnostiek = diagnostiek.sort((a, b) => b.score - a.score).slice(0, 10);
  logDebug("info", `Kop-rij gok: rij ${best + 1} met score ${bestScore}`, state.headerRowDiagnostiek);
  return best;
}

function handleFileSelect(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  logDebug("info", `Bestand geselecteerd: ${file.name}`, { grootte: file.size, type: file.type });
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = new Uint8Array(ev.target.result);
      const wb = XLSX.read(data, { type: "array", cellDates: true });
      runtime.wb = wb;
      logDebug("info", "Werkboek gelezen", {
        tabbladen: wb.SheetNames.map((n) => ({
          naam: n,
          opgegevenBereik: wb.Sheets[n]["!ref"] || "(leeg)",
          werkelijkBereik: berekenWerkelijkBereik(wb.Sheets[n]),
        })),
      });
      state.sheetNames = wb.SheetNames;
      state.selectedSheetName = wb.SheetNames[0];
      state.aoa = loadSheetAOA(state.selectedSheetName);
      state.headerRowIndex = guessHeaderRowIndex(state.aoa);
      state.stage = "sheetPrep";
      foutBannerTekst = "";
      render();
    } catch (err) {
      logDebug("fout", "Kon Excel-bestand niet parsen: " + err.message, { stack: err.stack });
      alert("Kon dit bestand niet lezen. Is het een geldig Excel-bestand (.xlsx of .xls)? Klik op 'Debug' rechtsboven voor technische details.");
    }
  };
  reader.onerror = () => logDebug("fout", "FileReader kon het bestand niet inlezen");
  reader.readAsArrayBuffer(file);
  e.target.value = "";
}

function wisselSheet(sheetName) {
  state.selectedSheetName = sheetName;
  state.aoa = loadSheetAOA(sheetName);
  state.headerRowIndex = guessHeaderRowIndex(state.aoa);
  render();
}

function bevestigHeaderRij() {
  try {
    const aoa = state.aoa;
    const headerRow = aoa[state.headerRowIndex] || [];
    const headers = headerRow.map((h, i) => {
      const s = String(h).trim();
      return s !== "" ? s : `Kolom ${i + 1}`;
    });
    const seen = {};
    const uniqueHeaders = headers.map((h) => {
      seen[h] = (seen[h] || 0) + 1;
      return seen[h] > 1 ? `${h} (${seen[h]})` : h;
    });

    const rows = [];
    for (let r = state.headerRowIndex + 1; r < aoa.length; r++) {
      const line = aoa[r];
      const isLeeg = !line || line.every((c) => String(c).trim() === "");
      if (isLeeg) continue;
      const obj = {};
      uniqueHeaders.forEach((h, i) => { obj[h] = line[i] !== undefined ? line[i] : ""; });
      rows.push(obj);
    }

    logDebug("info", `Kop-rij bevestigd: rij ${state.headerRowIndex + 1}`, { headers: uniqueHeaders, aantalDatarijen: rows.length });

    if (!rows.length) { alert("Met deze kop-rij zijn geen gegevensrijen gevonden. Kies een andere rij."); return; }

    state.rawHeaders = uniqueHeaders;
    state.rawRows = rows;
    state.mapping = guessMapping(uniqueHeaders);
    logDebug("info", "Automatische kolomkoppeling", state.mapping);
    state.stage = "mapping";
    render();
  } catch (err) {
    logDebug("fout", "Fout bij bevestigen kop-rij: " + err.message, { stack: err.stack });
    toonFoutBanner("Er ging iets mis bij het verwerken van de kop-rij: " + err.message);
    render();
  }
}

async function bevestigMapping() {
  try {
    if (!state.mapping.regnr) { alert("Wijs een kolom toe aan 'Regnr.' \u2014 dit is het unieke kenmerk waarmee personen worden herkend."); return; }
    if (!state.mapping.naam) { alert("Wijs in elk geval ook een kolom toe aan 'Naam'."); return; }

    const bestaandeByRegnr = {};
    state.personen.forEach((p) => { bestaandeByRegnr[p.regnr] = p; });

    const geziene = new Set();
    const nieuweRegnrs = [];

    const merged = state.rawRows.map((row) => {
      const regnr = String(row[state.mapping.regnr]).trim();
      geziene.add(regnr);
      const extra = {};
      state.rawHeaders.forEach((h) => {
        const mappedHeaders = Object.values(state.mapping).filter(Boolean);
        if (!mappedHeaders.includes(h)) extra[h] = row[h];
      });
      const bestaand = bestaandeByRegnr[regnr];
      if (!bestaand) nieuweRegnrs.push(regnr);

      const basis = {};
      BASIS_VELDEN.forEach((f) => {
        if (f.key === "regnr") { basis.regnr = regnr; return; }
        const col = state.mapping[f.key];
        let val = col ? row[col] : "";
        if (f.key === "geboortedatum" || f.key === "trouwdatum") val = parseDatumFlexibel(val);
        else if (val instanceof Date) val = parseDatumFlexibel(val);
        basis[f.key] = val;
      });

      return {
        ...basis,
        extra,
        _nietInLaatsteImport: false,
      };
    });

    const vertrokkenRegnrs = state.personen
      .filter((p) => !geziene.has(p.regnr))
      .map((p) => p.regnr);

    const gemarkeerdVertrokken = state.personen
      .filter((p) => !geziene.has(p.regnr))
      .map((p) => ({ ...p, _nietInLaatsteImport: true }));

    const alles = [...merged, ...gemarkeerdVertrokken];
    logDebug("info", "Import verwerkt", { aantalRijen: state.rawRows.length, nieuw: nieuweRegnrs.length, vertrokken: vertrokkenRegnrs.length, totaalNaMerge: alles.length });
    await persist(alles);

    state.importDiff = { nieuw: nieuweRegnrs, vertrokken: vertrokkenRegnrs };
    state.stage = state.importDiff.nieuw.length || state.importDiff.vertrokken.length ? "importReport" : "dashboard";
    render();
  } catch (err) {
    logDebug("fout", "Fout bij bevestigen kolomkoppeling: " + err.message, { stack: err.stack });
    toonFoutBanner("Er ging iets mis bij het overnemen van de gegevens: " + err.message);
    render();
  }
}

async function verwijderVertrokkenPersoon(regnr) {
  await verwijderPersoon(regnr);
  render();
}

async function behoudVertrokkenPersoon(regnr) {
  // simply leave as-is (already flagged); nothing more to do, just acknowledge
  render();
}

// ---------------- Excel export ----------------

function exporteerExcel() {
  const gezinnenByKey = {};
  computeGezinnen().forEach((g) => { gezinnenByKey[g.gezinsKey] = g; });
  const rows = state.personen.map((p) => {
    const gezinsKey = famKeyOf(p);
    const gezin = gezinnenByKey[gezinsKey];
    const gd = getGezinsdata(gezinsKey);
    const laatste = laatsteHistorieItem(gd);
    const status = STATUS_META[berekenStatus(gd, gezin)].label;
    const next = berekenVolgendContact(gd, gezin);
    return {
      Status: p.status,
      "Regnr.": p.regnr,
      Naam: p.naam,
      Roepnaam: p.roepnaam,
      Geslacht: p.geslacht,
      "Wijk/sectie": p.wijk,
      Adres: p.adres,
      Postcode: p.postcode,
      Plaatsnaam: p.plaats,
      Geboortedatum: p.geboortedatum,
      Huwelijksdatum: p.trouwdatum || "",
      "Lft.": berekenLeeftijd(p.geboortedatum) ?? "",
      Gezinsrelatie: p.gezinsrelatie,
      "Burgerlijke staat": p.burgerlijkeStaat,
      "Kerkelijke staat": p.kerkelijkeStaat,
      "e-mail": p.email,
      Telefoon: p.telefoon,
      Mobiel: p.mobiel,
      ...p.extra,
      "Laatste contact (gezin)": gd.laatsteContact ? fmtDatum(gd.laatsteContact) : "",
      "Tijd laatste bezoek": laatste ? laatste.tijd || "" : "",
      "Soort laatste bezoek": laatste ? laatste.soort || "" : "",
      "Volgend contact (gezin)": next ? fmtDatum(next) : "",
      "Terugkeerschema (gezin)": schemaLabel(gd, gezin),
      "Gelezen gedeelte (gezin)": gd.gelezenGedeelte,
      "Notitie (gezin)": gd.notitie,
      "Algemene notitie (gezin)": gd.algemeneNotitie,
      "Gepland bijzonder moment": gd.gepland && gd.gepland[0] ? `${fmtDatum(gd.gepland[0].datum)} \u2014 ${gd.gepland[0].soort}${gd.gepland[0].betreft ? " (" + gd.gepland[0].betreft + ")" : ""}` : "",
      "Contactstatus (gezin)": status,
      "Niet in laatste import": p._nietInLaatsteImport ? "Ja" : "",
    };
  });
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Personen");
  XLSX.writeFile(wb, `contactplanner-export-${todayISO()}.xlsx`);
}

function downloadBackupBestand(inhoud, bestandsnaam) {
  const blob = new Blob([inhoud], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = bestandsnaam;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

async function exporteerBackup() {
  // Versie 3: ook de instellingen gaan mee (behalve de pin — die stel je op een
  // nieuw apparaat opnieuw in). Versie 2 en ouder blijven inleesbaar.
  // De back-up is bewust ONversleuteld: het is het vangnet bij een vergeten pin.
  // Bewaar het bestand dus op een veilige plek.
  const payload = {
    versie: 3,
    personen: state.personen,
    gezinsdata: state.gezinsdata,
    afspraakAanvragen: state.afspraakAanvragen,
    instellingen: {
      mijlpalenLeeftijdDrempel: state.mijlpalenLeeftijdDrempel,
      mijlpalenHuwelijksJaren: state.mijlpalenHuwelijksJaren,
      mijlpalenGedaan: state.mijlpalenGedaan,
      schemaAutoLeeftijd: state.schemaAutoLeeftijd,
      schemaAutoJong: state.schemaAutoJong,
      schemaAutoStel: state.schemaAutoStel,
      schemaAutoAlleen: state.schemaAutoAlleen,
      afspraakSjablonen: state.afspraakSjablonen,
      afspraakSjabloonId: state.afspraakSjabloonId,
      mailMethode: state.mailMethode,
      backupOpslagMethode: state.backupOpslagMethode,
    },
  };
  const inhoud = JSON.stringify(payload, null, 2);
  const bestandsnaam = `contactplanner-backup-${todayISO()}.json`;

  if (state.backupOpslagMethode === "opslaanAls" && window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: bestandsnaam,
        types: [{ description: "JSON-bestand", accept: { "application/json": [".json"] } }],
      });
      const schrijfbaar = await handle.createWritable();
      await schrijfbaar.write(inhoud);
      await schrijfbaar.close();
    } catch (e) {
      if (e.name === "AbortError") return; // gebruiker heeft de dialoog geannuleerd, geen back-up gemaakt
      logDebug("fout", "Opslaan als is niet gelukt, back-up alsnog gedownload: " + e.message);
      downloadBackupBestand(inhoud, bestandsnaam);
    }
  } else {
    // Ook de fallback als "Opslaan als" is gekozen maar de browser (bv. Firefox/Safari)
    // de File System Access API niet ondersteunt.
    downloadBackupBestand(inhoud, bestandsnaam);
  }

  state.laatsteBackupOp = Date.now();
  veiligOpslaan(() => dbSetInstelling("laatsteBackupOp", state.laatsteBackupOp), "backup-administratie");
}

function handleBackupImport(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      let personen, gezinsdata;
      if (Array.isArray(data)) {
        // oud back-up formaat: alleen personen, mogelijk met contactvelden per persoon
        personen = data;
        gezinsdata = {};
      } else if (data && Array.isArray(data.personen)) {
        personen = data.personen;
        gezinsdata = data.gezinsdata || {};
      } else {
        throw new Error("onbekend formaat");
      }
      if (!confirm(`Dit vervangt de huidige lijst (${state.personen.length} personen) door de back-up (${personen.length} personen). Doorgaan?`)) return;
      state.personen = personen;
      state.gezinsdata = gezinsdata;
      if (Array.isArray(data.afspraakAanvragen)) state.afspraakAanvragen = data.afspraakAanvragen;
      migreerOudeContactgegevens();
      herstelLaatsteContactAlleGezinnen();
      // Instellingen uit de back-up overnemen (versie 3+); de pin blijft buiten de back-up.
      const inst = data.instellingen || null;
      if (inst) {
        if (typeof inst.mijlpalenLeeftijdDrempel === "number") state.mijlpalenLeeftijdDrempel = inst.mijlpalenLeeftijdDrempel;
        if (Array.isArray(inst.mijlpalenHuwelijksJaren)) state.mijlpalenHuwelijksJaren = inst.mijlpalenHuwelijksJaren;
        if (inst.mijlpalenGedaan && typeof inst.mijlpalenGedaan === "object") state.mijlpalenGedaan = inst.mijlpalenGedaan;
        if (typeof inst.schemaAutoLeeftijd === "number") state.schemaAutoLeeftijd = inst.schemaAutoLeeftijd;
        ["schemaAutoJong", "schemaAutoStel", "schemaAutoAlleen"].forEach((sleutel) => {
          if (typeof inst[sleutel] === "string" && inst[sleutel]) state[sleutel] = inst[sleutel];
        });
        if (Array.isArray(inst.afspraakSjablonen) && inst.afspraakSjablonen.length) state.afspraakSjablonen = inst.afspraakSjablonen;
        if (typeof inst.afspraakSjabloonId === "string") state.afspraakSjabloonId = inst.afspraakSjabloonId;
        if (inst.mailMethode === "mailto" || inst.mailMethode === "outlook") state.mailMethode = inst.mailMethode;
        if (inst.backupOpslagMethode === "download" || inst.backupOpslagMethode === "opslaanAls") state.backupOpslagMethode = inst.backupOpslagMethode;
      }
      const gelukt = await veiligOpslaan(async () => {
        await bewaarGegevens();
        if (inst) {
          await dbSetInstelling("mijlpalenLeeftijdDrempel", state.mijlpalenLeeftijdDrempel);
          await dbSetInstelling("mijlpalenHuwelijksJaren", state.mijlpalenHuwelijksJaren);
          await dbSetInstelling("schemaAutoLeeftijd", state.schemaAutoLeeftijd);
          await dbSetInstelling("schemaAutoJong", state.schemaAutoJong);
          await dbSetInstelling("schemaAutoStel", state.schemaAutoStel);
          await dbSetInstelling("schemaAutoAlleen", state.schemaAutoAlleen);
          await dbSetInstelling("afspraakSjablonen", state.afspraakSjablonen);
          await dbSetInstelling("afspraakSjabloonId", state.afspraakSjabloonId);
          await dbSetInstelling("mailMethode", state.mailMethode);
          await dbSetInstelling("backupOpslagMethode", state.backupOpslagMethode);
          await Promise.all(Object.keys(state.mijlpalenGedaan).map((sleutel) =>
            dbSetInstelling("mijlpaal-gedaan:" + sleutel, state.mijlpalenGedaan[sleutel])));
        }
      }, "back-up terugzetten");
      if (gelukt) {
        state.stage = "dashboard";
        // De teruggezette gegevens zijn per definitie gelijk aan een bestaand back-upbestand.
        state.laatsteBackupOp = Date.now();
        await dbSetInstelling("laatsteBackupOp", state.laatsteBackupOp)
          .catch((e) => logDebug("fout", "Kon back-uptijdstip niet opslaan: " + e.message));
      }
      render();
    } catch (err) {
      logDebug("fout", "Kon back-up niet lezen: " + err.message);
      alert("Kon deze back-up niet lezen. Is het een eerder geëxporteerd back-upbestand (.json)?");
    }
  };
  reader.readAsText(file);
  e.target.value = "";
}

// ---------------- contactmoment loggen ----------------

async function plandGepland(gezinsKey) {
  if (!state.geplandDraft.datum) { alert("Kies eerst een datum."); return; }
  const gd = getGezinsdata(gezinsKey);
  const entry = {
    id: uid(),
    datum: state.geplandDraft.datum,
    soort: state.geplandDraft.soort,
    betreft: state.geplandDraft.betreft,
    notitie: state.geplandDraft.notitie,
  };
  const gepland = [...(gd.gepland || []), entry].sort((a, b) => a.datum.localeCompare(b.datum));
  await updateGezinsdata(gezinsKey, { gepland });
  state.geplandDraft = { datum: "", soort: "Ziekenhuisbezoek", betreft: "", notitie: "" };
  render();
}

async function verwijderGeplandMoment(gezinsKey, id) {
  const gd = getGezinsdata(gezinsKey);
  const gepland = (gd.gepland || []).filter((g) => g.id !== id);
  await updateGezinsdata(gezinsKey, { gepland });
}

async function markeerGeplandGedaan(gezinsKey, id) {
  const gd = getGezinsdata(gezinsKey);
  const item = (gd.gepland || []).find((g) => g.id === id);
  if (!item) return;
  const notitieMetBetreft = item.notitie + (item.betreft ? `${item.notitie ? " \u2014 " : ""}Betreft: ${item.betreft}` : "");
  const nieuweHistorieEntry = { id: uid(), datum: item.datum, tijd: "", soort: item.soort, notitie: notitieMetBetreft, gelezen: "" };
  const historie = [nieuweHistorieEntry, ...(gd.historie || [])];
  const gepland = (gd.gepland || []).filter((g) => g.id !== id);
  await updateGezinsdata(gezinsKey, {
    gepland, historie,
    laatsteContact: berekenLaatsteRegulierContact(historie),
    volgendContactOverride: item.soort === "Huisbezoek" ? "" : gd.volgendContactOverride,
  });
}

function laatsteHistorieItem(gd) {
  // Meest recente contactmoment op datum — historie staat op invoervolgorde, en die
  // wijkt af zodra iemand met terugwerkende kracht een ouder bezoek logt.
  const historie = gd.historie || [];
  if (!historie.length) return null;
  return historie.reduce((m, h) => ((h.datum || "") > (m.datum || "") ? h : m), historie[0]);
}

function berekenLaatsteRegulierContact(historie) {
  // Alleen "Huisbezoek" telt mee voor het reguliere schema. Oudere contactmomenten van v\u00f3\u00f3r
  // de "soort bezoek"-functie (dus zonder soort-veld) worden als regulier huisbezoek behandeld.
  const regulier = (historie || []).filter((h) => !h.soort || h.soort === "Huisbezoek");
  if (!regulier.length) return "";
  return regulier.reduce((m, h) => (h.datum > m ? h.datum : m), regulier[0].datum);
}

async function logGezinContact(gezinsKey) {
  const gd = getGezinsdata(gezinsKey);
  if (!state.noteDraft.datum) return;
  let historie;
  if (state.bewerkNotitieId) {
    historie = (gd.historie || []).map((n) => n.id === state.bewerkNotitieId
      ? { ...n, datum: state.noteDraft.datum, tijd: state.noteDraft.tijd, soort: state.noteDraft.soort, notitie: state.noteDraft.notitie, gelezen: state.noteDraft.gelezen }
      : n);
  } else {
    const entry = { id: uid(), datum: state.noteDraft.datum, tijd: state.noteDraft.tijd, soort: state.noteDraft.soort, notitie: state.noteDraft.notitie, gelezen: state.noteDraft.gelezen };
    historie = [entry, ...(gd.historie || [])];
  }
  const gesorteerd = historie.slice().sort((a, b) => (b.datum || "").localeCompare(a.datum || ""));
  const meestRecent = gesorteerd[0];
  const isNieuwRegulierBezoek = !state.bewerkNotitieId && state.noteDraft.soort === "Huisbezoek";
  await updateGezinsdata(gezinsKey, {
    historie,
    laatsteContact: berekenLaatsteRegulierContact(historie),
    notitie: meestRecent ? meestRecent.notitie : gd.notitie,
    gelezenGedeelte: meestRecent ? meestRecent.gelezen : gd.gelezenGedeelte,
    volgendContactOverride: isNieuwRegulierBezoek ? "" : gd.volgendContactOverride,
  });
  state.noteDraft = { datum: todayISO(), tijd: "19:30", soort: "Huisbezoek", notitie: "", gelezen: "" };
  state.bewerkNotitieId = null;
  render();
}

function bewerkHistorieItem(gezinsKey, itemId) {
  const gd = getGezinsdata(gezinsKey);
  const item = (gd.historie || []).find((n) => n.id === itemId);
  if (!item) return;
  state.noteDraft = {
    datum: item.datum || todayISO(),
    tijd: item.tijd || "19:30",
    soort: item.soort || "Huisbezoek",
    notitie: item.notitie || "",
    gelezen: item.gelezen || "",
  };
  state.bewerkNotitieId = itemId;
  render();
}

function annuleerBewerkNotitie() {
  state.noteDraft = { datum: todayISO(), tijd: "19:30", soort: "Huisbezoek", notitie: "", gelezen: "" };
  state.bewerkNotitieId = null;
  render();
}

async function verwijderHistorieItem(gezinsKey, itemId) {
  const gd = getGezinsdata(gezinsKey);
  const historie = (gd.historie || []).filter((n) => n.id !== itemId);
  const laatsteContact = berekenLaatsteRegulierContact(historie);
  if (state.bewerkNotitieId === itemId) { state.bewerkNotitieId = null; state.noteDraft = { datum: todayISO(), tijd: "19:30", soort: "Huisbezoek", notitie: "", gelezen: "" }; }
  await updateGezinsdata(gezinsKey, { historie, laatsteContact });
}



// ---------------- rendering ----------------

function gefilterdeGezinnen() {
  let list = computeGezinnen();
  if (state.search.trim()) {
    const q = normKey(state.search);
    list = list.filter((g) =>
      g.leden.some((p) => normKey(p.naam).includes(q) || normKey(p.roepnaam).includes(q) || normKey(p.regnr).includes(q)) ||
      normKey(g.adres).includes(q) || normKey(g.plaats).includes(q)
    );
  }
  if (state.filterStatus === "nietInLaatsteImport") {
    list = list.filter((g) => g.leden.some((p) => p._nietInLaatsteImport));
  } else if (state.filterStatus === "favoriet") {
    list = list.filter((g) => getGezinsdata(g.gezinsKey).favoriet);
  } else if (state.filterStatus === "opmerking") {
    list = list.filter((g) => getGezinsdata(g.gezinsKey).algemeneNotitie);
  } else if (state.filterStatus !== "alle") {
    list = list.filter((g) => berekenStatus(getGezinsdata(g.gezinsKey), g) === state.filterStatus);
  }
  return list.sort((a, b) => {
    const gdA = getGezinsdata(a.gezinsKey), gdB = getGezinsdata(b.gezinsKey);
    const richting = state.sortDir === "desc" ? -1 : 1;
    if (state.sortBy === "naam") {
      return richting * (a.gezinshoofd.naam || "").localeCompare(b.gezinshoofd.naam || "");
    }
    if (state.sortBy === "adres") {
      return richting * ((a.adres || "").localeCompare(b.adres || "") || (a.gezinshoofd.naam || "").localeCompare(b.gezinshoofd.naam || ""));
    }
    if (state.sortBy === "plaats") {
      return richting * ((a.plaats || "").localeCompare(b.plaats || "") || (a.gezinshoofd.naam || "").localeCompare(b.gezinshoofd.naam || ""));
    }
    if (state.sortBy === "laatsteContact") {
      // nog nooit bezocht (leeg) staat vooraan \u2014 dat heeft de meeste aandacht nodig
      return richting * ((gdA.laatsteContact || "").localeCompare(gdB.laatsteContact || "") || (a.gezinshoofd.naam || "").localeCompare(b.gezinshoofd.naam || ""));
    }
    if (state.sortBy === "volgendContact") {
      const na = berekenVolgendContact(gdA, a) || "", nb = berekenVolgendContact(gdB, b) || "";
      return richting * (na.localeCompare(nb) || (a.gezinshoofd.naam || "").localeCompare(b.gezinshoofd.naam || ""));
    }
    // status (ook de standaard "urgentie" uit de keuzelijst): op status, dan volgend contact, dan naam
    const sa = STATUS_META[berekenStatus(gdA, a)].order, sb = STATUS_META[berekenStatus(gdB, b)].order;
    if (sa !== sb) return richting * (sa - sb);
    const na = berekenVolgendContact(gdA, a), nb = berekenVolgendContact(gdB, b);
    if (na && nb) return richting * na.localeCompare(nb);
    if (na) return -1 * richting;
    if (nb) return 1 * richting;
    return richting * (a.gezinshoofd.naam || "").localeCompare(b.gezinshoofd.naam || "");
  });
}

function telStatussen() {
  const c = { nooit: 0, teLaat: 0, binnenkort: 0, opSchema: 0, nietInLaatsteImport: 0, opmerking: 0 };
  computeGezinnen().forEach((g) => {
    const gd = getGezinsdata(g.gezinsKey);
    c[berekenStatus(gd, g)]++;
    if (g.leden.some((p) => p._nietInLaatsteImport)) c.nietInLaatsteImport++;
    if (gd.algemeneNotitie) c.opmerking++;
  });
  return c;
}

function render() {
  const root = document.getElementById("app");
  if (state.vergrendeld) {
    if (state.mijlpalenZonderPin) {
      root.innerHTML = beperkteTopbarHTML() + '<div class="main">' + mijlpalenHTML(true) + "</div>";
      attachBeperkteMijlpalenEvents();
      return;
    }
    root.innerHTML = lockScreenHTML();
    attachLockEvents();
    return;
  }
  const breed = state.stage === "dashboard" && (state.weergave === "tabel" || state.weergave === "planning");
  root.innerHTML = topbarHTML() + `<div class="main${breed ? " main-breed" : ""}">` + mainHTML() + "</div>" + detailHTML() + debugModalHTML() + handleidingModalHTML() + aanvragenOverzichtModalHTML() + sidebarMenuHTML() + versieMeldingModalHTML();
  attachEvents();
  if (state.menuOpen) {
    requestAnimationFrame(() => {
      const ov = document.getElementById("sidebarOverlay");
      if (ov) ov.classList.add("sidebar-open");
    });
  }
}

function opslagIndicatorHTML() {
  if (state.saveState === "saving") return `<span class="save-indicator">Opslaan\u2026</span>`;
  if (state.saveState === "fout") return `<span class="save-indicator save-indicator-fout">\u26A0 Niet opgeslagen \u2014 zie Debug</span>`;
  if (state.saveState === "saved") return `<span class="save-indicator save-indicator-ok">\u2713 Opgeslagen</span>`;
  return "";
}

function fmtRelatiefMoment(ms) {
  const d = new Date(ms);
  const dagIso = toISO(d.getFullYear(), d.getMonth() + 1, d.getDate());
  const dagen = Math.round((new Date(todayISO() + "T00:00:00") - new Date(dagIso + "T00:00:00")) / 86400000);
  if (dagen <= 0) return "vandaag om " + d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
  if (dagen === 1) return "gisteren";
  if (dagen < 31) return `${dagen} dagen geleden`;
  return "op " + fmtDatum(dagIso);
}

function backupIndicatorHTML() {
  // Herinnert eraan regelmatig een back-up te maken: klikken maakt er direct een.
  if (!state.personen.length) return "";
  if (!state.laatsteBackupOp) {
    return `<button class="backup-indicator backup-indicator-nodig" id="btnBackupNu" title="Er is nog nooit een back-up gemaakt. Klik om nu een back-up (.json) te downloaden.">\u26A0 Nog geen back-up gemaakt</button>`;
  }
  const wanneer = fmtRelatiefMoment(state.laatsteBackupOp);
  if (state.laatsteWijzigingOp && state.laatsteWijzigingOp > state.laatsteBackupOp) {
    return `<button class="backup-indicator backup-indicator-nodig" id="btnBackupNu" title="Er zijn wijzigingen die nog niet in een back-up staan. Klik om nu een back-up (.json) te downloaden.">\u26A0 Wijzigingen sinds laatste back-up (${esc(wanneer)})</button>`;
  }
  return `<button class="backup-indicator backup-indicator-ok" id="btnBackupNu" title="Alle wijzigingen staan in de back-up van ${esc(wanneer)}. Klik om toch een nieuwe te maken.">\u2713 Back-up actueel (${esc(wanneer)})</button>`;
}

function menuItemHTML(id, icoon, kleur, achtergrond, label) {
  return `
    <button class="sidebar-item" id="${id}">
      <span class="sidebar-icon" style="background:${achtergrond};color:${kleur};">${icoon}</span>
      <span>${label}</span>
    </button>`;
}

function handleidingModalHTML() {
  if (!state.handleidingOpen) return "";
  return `
  <div class="modal-overlay" id="handleidingOverlay">
    <div class="modal-box handleiding-box">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <h3 style="margin:0;font-size:18px;">Handleiding</h3>
        <button class="btn-ghost btn-sm" id="btnSluitHandleiding">\u2715</button>
      </div>
      <div class="handleiding-inhoud">

        <ul class="handleiding-index">
          <li><a href="#hl-import">Excel importeren</a></li>
          <li><a href="#hl-gezinshoofd">Gezinnen en gezinshoofd</a></li>
          <li><a href="#hl-loggen">Contactmoment loggen, bewerken en verwijderen</a></li>
          <li><a href="#hl-schema">Terugkeerschema en de kleurbalk/het bolletje</a></li>
          <li><a href="#hl-bijzonder">Inplannen — Bijzonder contactmoment</a></li>
          <li><a href="#hl-afspraak">Afspraak inplannen en berichtsjablonen</a></li>
          <li><a href="#hl-afspraakplanner">AfspraakPlanner: zelf een tijdslot laten kiezen</a></li>
          <li><a href="#hl-momenten">Bijzondere momenten</a></li>
          <li><a href="#hl-weergaves">Sorteren en weergaves</a></li>
          <li><a href="#hl-markeren">Markeren</a></li>
          <li><a href="#hl-notitie">Algemene notitie</a></li>
          <li><a href="#hl-scipio">Scipio-koppeling</a></li>
          <li><a href="#hl-beveiliging">Pin-beveiliging en versleuteling</a></li>
          <li><a href="#hl-systeem">Gegevens en systeem (dit menu)</a></li>
        </ul>

        <h4 id="hl-import">Excel importeren</h4>
        <p><strong>De export maken in Scipio:</strong></p>
        ${SCIPIO_UITLEG_HTML}
        <p>Je uploadt een Excel-export (bijv. uit Scipio). De app laat je zelf het tabblad en de rij met
        kolomnamen aanwijzen \u2014 handig als er een titel- of filterregel boven de echte koppen staat. Daarna
        koppel je kolommen aan velden (Regnr. en Naam zijn verplicht). <strong>Regnr.</strong> is het kenmerk
        waarmee personen bij een volgende import worden herkend. Na de import zie je een rapport met wie
        nieuw is en wie niet meer voorkwam \u2014 die laatste groep verdwijnt niet automatisch, je kiest zelf
        per persoon of je 'm laat staan of verwijdert.</p>

        <h4 id="hl-gezinshoofd">Gezinnen en gezinshoofd</h4>
        <p>Personen worden gegroepeerd tot gezinnen op basis van <strong>adres + postcode</strong>. Degene met
        Gezinsrelatie "gezinshoofd" bepaalt de naam en contactgegevens die je overal ziet. Alle contactmomenten,
        schema's en notities gelden voor het hele gezin, niet per los persoon.</p>

        <h4 id="hl-loggen">Contactmoment loggen, bewerken en verwijderen</h4>
        <p>In een gezinsdossier log je een contactmoment met datum, tijd (standaard 19:30), soort bezoek
        (Huisbezoek, Doopbezoek, Huwelijksbezoek, Ziekenhuisbezoek, Anders), een notitie en het gelezen
        gedeelte. Eerdere momenten kun je aanpassen via "Bewerken" (bijv. bij een typefout) of verwijderen.</p>

        <h4 id="hl-schema">Terugkeerschema en de kleurbalk/het bolletje</h4>
        <p>Nieuwe gezinnen staan standaard op <strong>"Automatisch"</strong>: het bezoekinterval wordt dan
        berekend uit de leeftijd van het gezinshoofd en de gezinssamenstelling. Standaard: tot 70 jaar om
        het jaar, vanaf 70 als stel 1x per jaar, en vanaf 70 alleenwonend 2x per jaar. De leeftijdsgrens
        en de drie intervallen stel je zelf in via menu → Instellingen; daar kun je ook in één keer
        alle gezinnen op Automatisch zetten. Wil je voor een gezin afwijken, dan kies je in het
        gezinsdossier een handmatig schema: 2x per jaar, 1x per jaar, om het jaar, of een aangepast aantal
        maanden. <strong>Belangrijk:</strong> alleen een contactmoment van het soort "Huisbezoek" telt mee als
        basis voor dit schema \u2014 een doop-, huwelijks- of ziekenhuisbezoek verschuift het reguliere
        bezoekmoment dus niet naar voren. Wel geldt: een huwelijks- of doopbezoek na het laatste huisbezoek
        schuift het volgende huisbezoek een jaar op, tenzij het reguliere schema toch al een latere datum
        aangaf (dan geldt die latere datum). Op elke kaart zie je een gekleurde balk (status: rood/oranje/groen,
        hover voor uitleg) en een gekleurd bolletje (interval: rood = 2x/jaar, oranje = 1x/jaar, groen = om het
        jaar, blauw = aangepast).</p>

        <h4 id="hl-bijzonder">Inplannen — Bijzonder contactmoment</h4>
        <p>Voor iets buiten het gewone ritme, zoals een ziekenhuisopname: plan een datum, soort en notitie in
        bij het gezin. Dit staat los van het reguliere schema. Zodra je het afhandelt met "Gedaan (log contact)"
        komt het als een gewoon contactmoment in de geschiedenis; "Verwijderen" gebruik je als het niet doorgaat.</p>

        <h4 id="hl-afspraak">Afspraak inplannen en berichtsjablonen</h4>
        <p>Bij "Afspraak inplannen" open je met één klik een mail of WhatsApp-bericht om iemand te
        polsen voor een datum. De tekst komt uit een sjabloon met de plekhouders
        <span class="mono">[naam]</span>, <span class="mono">[datum]</span> en <span class="mono">[tijd]</span>:
        <span class="mono">[naam]</span> wordt ingevuld zodra je een sjabloon kiest of een gezin opent,
        <span class="mono">[datum]</span> en <span class="mono">[tijd]</span> pas bij het versturen. Je beheert
        je eigen sjablonen via menu → Instellingen — handig als je verschillende contacten anders aanspreekt,
        want je kunt er zoveel maken als je wilt en per afspraak kiezen welke je gebruikt. Ook "Mail sturen"
        bovenin het gezinsdossier gebruikt dezelfde instelling voor waar de mail naartoe gaat: het
        standaard mailprogramma van je apparaat (mailto), of direct een nieuw bericht in Outlook op het
        web (Microsoft 365) — instelbaar via menu → Instellingen → E-mail.</p>

        <h4 id="hl-afspraakplanner">AfspraakPlanner: zelf een tijdslot laten kiezen</h4>
        <p>Wil je niet zelf een datum voorstellen, maar een aantal gezinnen laten kiezen uit
        dezelfde tijdslots? Ga naar de <strong>Planningweergave</strong> en klik op
        <strong>"Selecteren"</strong>. Klik daarna de gezinnen aan die je een uitnodiging wilt
        sturen — onderin verschijnt een balkje met het aantal geselecteerde gezinnen en de knop
        <strong>"Aanvraag uitzetten"</strong>. Vul de tijdslots in die je aanbiedt (de eindtijd is
        optioneel — laat die leeg als alleen de starttijd vaststaat) en verstuur de
        aanvraag; per gezin krijg je daarna een link terug die je met één klik als mail of
        WhatsApp-bericht kunt versturen (met een eigen sjabloon, plekhouder
        <span class="mono">[link]</span> — zie hierboven). Het gemeentelid kiest zelf een moment
        via die link; kiest iemand een tijdslot, dan is dat voor de anderen niet meer beschikbaar.</p>
        <p>Vul je veel tijdslots in hetzelfde ritme in? Gebruik <strong>"Wekelijks herhalen"</strong>:
        vul één tijdslot in (bijv. dinsdag 20:00), kies het aantal weken en de app vult de rest
        automatisch aan — dezelfde dag en tijd, week na week.</p>
        <p>Via <strong>"Lopende aanvragen"</strong> (naast de knop "Selecteren" in de Planningweergave)
        volg je de uitgezette aanvragen: klik op <strong>"Status vernieuwen"</strong> om te zien wie al
        een tijdslot gekozen heeft. Een gekozen afspraak zet je daar met de knop
        <strong>"Zet in planning"</strong> direct als gepland bijzonder contactmoment in het
        gezinsdossier, zodat hij ook in Bijzondere momenten verschijnt. Op de gezinskaarten in de
        lijst-, kolommen- en planbordweergave zie je bovendien een label zodra er een aanvraag
        uitstaat (⏳) en de gekozen datum zodra het gezin een tijdslot heeft gekozen (✓).</p>
        <p>Een lopende aanvraag kun je daar ook <strong>uitbreiden</strong>: voeg extra tijdslots toe
        (direct kiesbaar via de al verstuurde links) of extra gezinnen (die krijgen een eigen link).
        Nog vrije tijdslots kun je <strong>intrekken</strong> als je toch niet meer kunt; een al
        gekozen tijdslot intrekken kan bewust niet — dat regel je persoonlijk met het gezin. Tijdslots
        waarvan de starttijd verstreken is, zijn automatisch niet meer kiesbaar en tonen als
        <em>verlopen</em>. Voor gezinnen die nog niet gekozen hebben kun je de uitnodiging vanuit
        ditzelfde overzicht opnieuw versturen.
        <strong>Belangrijk om te weten:</strong> de AfspraakPlanner-koppeling is de enige plek in de
        app die iets naar het internet stuurt — en dan alleen het regnr en het gekozen tijdslot, nooit
        namen of adressen, en alleen op het moment dat je zelf op "Aanvraag uitzetten" of "Status
        vernieuwen" klikt. Werkt dit niet, controleer dan eerst de API-sleutel bij
        Instellingen → AfspraakPlanner.</p>

        <h4 id="hl-momenten">Bijzondere momenten</h4>
        <p>Een apart overzicht met alles wat een kaartje of belletje waard is:</p>
        <ul>
          <li><strong>Verjaardagen</strong> \u2014 vanaf een instelbare leeftijd (standaard 70), elk jaar opnieuw.</li>
          <li><strong>Huwelijksjubilea</strong> \u2014 in instelbare jaren (standaard 25, 30, 40, 45, 50, 55, 60). Verschijnt
          alleen als er een partner in het gezin zit en de burgerlijke staat niet op weduwschap/scheiding wijst.</li>
          <li><strong>Gepland</strong> \u2014 de bijzondere contactmomenten die je zelf hebt ingepland.</li>
        </ul>
        <p>Je filtert op "komende 90 dagen" of "alles", en er verschijnt een rood bolletje bij de knop zodra
        er binnen 14 dagen iets aankomt.</p>

        <h4 id="hl-weergaves">Sorteren en weergaves</h4>
        <p>Boven het overzicht kies je een sortering (urgentie, naam, adres, plaats, laatste/volgend contact)
        en een weergave: Lijst, 2 kolommen, Tabel (met sorteerbare, sleepbare kolommen) of Planning (een
        kanban-bord met kolommen Achterstallig / Komende maand / Dit kwartaal / Komend halfjaar / Verder vooruit).</p>

        <h4 id="hl-markeren">Markeren</h4>
        <p>Met het sterretje rechtsboven op een kaart (of naast de naam in het gezinsdetail) markeer je een
        gezin waar je extra alert op wilt zijn. Via de filterknop "\u2605 Gemarkeerd" boven het overzicht zie je
        in \u00e9\u00e9n klik alle gemarkeerde gezinnen bij elkaar, in elke weergave.</p>

        <h4 id="hl-notitie">Algemene notitie</h4>
        <p>Een vrij tekstveld per gezin, niet gekoppeld aan een datum \u2014 bijvoorbeeld "wil geen contact". Staat
        een gezin hiermee gemarkeerd, dan zie je een geel "opmerking"-label op de kaart.</p>

        <h4 id="hl-scipio">Scipio-koppeling</h4>
        <p>Bij elk gezinslid staat een "Scipio"-link die rechtstreeks naar de persoonskaart in Scipio gaat
        (op basis van het Regnr.).</p>

        <h4 id="hl-beveiliging">Pin-beveiliging en versleuteling</h4>
        <p>De hele app is met een pin beveiligd; na het invoeren heb je een uur toegang, daarna moet je 'm
        opnieuw invoeren. De gegevens staan bovendien <strong>versleuteld</strong> in de browseropslag
        (AES-256; de sleutel wordt van de pin afgeleid en de pin zelf wordt nergens bewaard). Vanaf het
        slotscherm kun je zonder pin wel de verjaardagen en huwelijksjubilea uit "Bijzondere momenten"
        bekijken \u2014 die namen en datums staan daarvoor bewust onversleuteld in een klein hulplijstje;
        geplande momenten en gezinsdossiers blijven verborgen tot je volledig ontgrendelt. Vergeet je de
        pin, dan zijn de versleutelde gegevens definitief onleesbaar; de enige weg terug is alles wissen en
        je back-up (.json) terugzetten \u2014 zorg dus voor een actuele back-up.
        <strong>Goed om te weten:</strong> een korte cijferpin houdt een nieuwsgierige meekijker buiten,
        maar is voor een vastberaden aanvaller te raden. Gebruik de app daarom nog steeds op een apparaat
        dat zelf goed beveiligd is (eigen account, schermvergrendeling, versleutelde schijf), of kies een
        langere pin \u2014 alle tekens zijn toegestaan.</p>

        <h4 id="hl-systeem">Gegevens en systeem (dit menu)</h4>
        <p><strong>Nieuwe Excel-import</strong> ververst de basisgegevens. <strong>Exporteer naar Excel</strong> maakt
        een volledig exportbestand inclusief contactstatus. <strong>Back-up maken/terugzetten</strong> (.json) is je
        vangnet, want alle gegevens staan alleen lokaal in deze browser op deze computer; sinds versie 3
        gaan ook de instellingen (mijlpalen en automatisch schema) mee in de back-up — alleen de pin niet,
        die stel je op een nieuw apparaat opnieuw in. De back-up is bewust <strong>niet</strong> versleuteld:
        zo kun je er ook bij een vergeten pin altijd mee verder. Bewaar het bestand dus op een veilige plek
        (bijvoorbeeld een versleutelde schijf of wachtwoordkluis). De back-up is ook de manier om je
        gegevens mee te nemen naar een andere computer, browser of naar de online versie. Rechtsboven in de balk zie je
        de back-upstatus: groen betekent dat alles in de laatste back-up staat, oranje dat er wijzigingen
        zijn van na de laatste back-up (of dat er nog nooit een is gemaakt) — klik erop om direct een
        back-up te maken. Standaard wordt die gedownload; via Instellingen → Back-up opslaan kun je
        in plaats daarvan zelf een locatie kiezen (Chrome/Edge). Bewaar je back-up bij voorkeur niet
        alléén op dit apparaat: gaat je laptop stuk, kwijt of gestolen, dan is een back-up op diezelfde
        schijf net zo kwetsbaar — kies daarom bijvoorbeeld een map die met OneDrive synchroniseert, een
        externe schijf of USB-stick. <strong>Instellingen</strong> bevat verder de
        regels voor het automatische terugkeerschema. <strong>Debug</strong> toont technische logs als er iets
        misgaat. <strong>PIN wijzigen</strong> past je toegangscode aan.</p>

      </div>
    </div>
  </div>`;
}

const SCHEMA_INTERVAL_OPTIES = [["2x", "2x per jaar"], ["1x", "1x per jaar"], ["0.5x", "Om het jaar"]];

function intervalSelectHTML(id, huidige) {
  return `<select id="${id}">
    ${SCHEMA_INTERVAL_OPTIES.map(([val, label]) => `<option value="${val}" ${huidige === val ? "selected" : ""}>${label}</option>`).join("")}
  </select>`;
}

function instellingenPaginaHTML() {
  const aantalAuto = Object.values(state.gezinsdata).filter((gd) => gd.schema === "auto").length;
  const aantalHandmatig = Object.values(state.gezinsdata).filter((gd) => gd.schema && gd.schema !== "auto").length;
  return `
    ${paginaSluitKnopHTML("btnInstellingenTerug")}
    <h2 style="font-size:22px;margin:0 0 4px;">Instellingen</h2>
    <p style="color:var(--text-soft);font-size:13px;margin-bottom:4px;">
      Wijzigingen worden direct opgeslagen — er is geen aparte opslaan-knop.
    </p>

    <div class="instellingen-grid">
      <section class="instellingen-kaart">
        <h4>Automatisch terugkeerschema</h4>
        <p class="instellingen-uitleg">
          Gezinnen met schema "Automatisch" krijgen hun bezoekinterval op basis van de leeftijd van het
          gezinshoofd en de gezinssamenstelling. Elke ouderling werkt anders — stel hieronder je eigen
          regels in. Boven de leeftijdsgrens zonder partner maar met huisgenoten geldt het stel-interval;
          is de geboortedatum onbekend, dan geldt het interval van onder de grens.
        </p>
        <div class="field-row" style="max-width:220px;">
          <label>Leeftijdsgrens (leeftijd gezinshoofd)</label>
          <input type="number" min="1" id="instSchemaLeeftijd" value="${esc(state.schemaAutoLeeftijd)}" />
        </div>
        <div class="field-row">
          <label>Tot de leeftijdsgrens</label>
          ${intervalSelectHTML("instSchemaJong", state.schemaAutoJong)}
        </div>
        <div class="field-row">
          <label>Vanaf de leeftijdsgrens, met partner (stel)</label>
          ${intervalSelectHTML("instSchemaStel", state.schemaAutoStel)}
        </div>
        <div class="field-row">
          <label>Vanaf de leeftijdsgrens, alleenwonend</label>
          ${intervalSelectHTML("instSchemaAlleen", state.schemaAutoAlleen)}
        </div>
        <hr class="divider" />
        <p class="instellingen-uitleg">
          ${aantalAuto} gezin(nen) staan op Automatisch, ${aantalHandmatig} op een handmatig schema.
          Nieuwe gezinnen krijgen standaard Automatisch; per gezin pas je dit aan in het gezinsdossier.
        </p>
        <button class="btn-sm" id="btnAllesOpAuto" ${aantalHandmatig === 0 ? "disabled" : ""}>Zet alle gezinnen op Automatisch</button>
      </section>

      <div class="instellingen-kolom">
        <section class="instellingen-kaart">
          <h4>E-mail</h4>
          <p class="instellingen-uitleg">
            Waar de knoppen "Mail sturen" en "Open in e-mail" naartoe moeten linken.
          </p>
          <div class="schema-grid">
            <div class="schema-opt ${state.mailMethode === "mailto" ? "active" : ""}" data-mailmethode="mailto">Standaard mailprogramma (mailto)</div>
            <div class="schema-opt ${state.mailMethode === "outlook" ? "active" : ""}" data-mailmethode="outlook">Outlook op het web (Microsoft 365)</div>
          </div>
        </section>

        <section class="instellingen-kaart">
          <h4>Back-up opslaan</h4>
          <p class="instellingen-uitleg">
            Wat er gebeurt als je op "Back-up maken" klikt. Bewaar je back-up bij voorkeur niet alleen
            op dit apparaat: gaat je laptop stuk, kwijt of gestolen, dan is een back-up op diezelfde
            schijf net zo kwetsbaar. "Zelf een locatie kiezen" werkt alleen in Chrome en Edge — in
            andere browsers wordt de back-up dan alsnog gewoon gedownload.
          </p>
          <div class="schema-grid">
            <div class="schema-opt ${state.backupOpslagMethode === "download" ? "active" : ""}" data-backupopslag="download">Direct downloaden (huidig)</div>
            <div class="schema-opt ${state.backupOpslagMethode === "opslaanAls" ? "active" : ""}" data-backupopslag="opslaanAls">Zelf een locatie kiezen (Opslaan als)</div>
          </div>
        </section>

        <section class="instellingen-kaart">
          <h4>AfspraakPlanner</h4>
          <p class="instellingen-uitleg">
            Voor "Aanvraag uitzetten" in de Planningweergave: gemeenteleden kiezen daar zelf een
            tijdslot. Alleen regnr en tijdslot gaan naar deze server, nooit namen of adressen.
            Je persoonlijke API-sleutel vraag je op bij Ruben van der Kolk —
            <a href="mailto:ruben@vdkolk.nu">ruben@vdkolk.nu</a>. Vul hem hier in en deel hem
            verder met niemand (net zoals je pin).
          </p>
          <div class="field-row">
            <label>API-sleutel</label>
            <input type="password" id="instAfspraakplannerSleutel" autocomplete="off" value="${esc(state.afspraakplannerApiSleutel)}" />
          </div>
          <div class="field-row">
            <label>Basis-URL</label>
            <input type="url" id="instAfspraakplannerUrl" placeholder="https://afspraak.hhgputten.nl" value="${esc(state.afspraakplannerBasisUrl)}" />
          </div>
        </section>
      </div>

      <section class="instellingen-kaart instellingen-kaart-breed">
        <h4>Berichtsjablonen (afspraak inplannen)</h4>
        <p class="instellingen-uitleg">
          Voor de mail/WhatsApp-tekst bij "Afspraak inplannen" en bij een AfspraakPlanner-uitnodiging.
          Gebruik <span class="mono">[naam]</span>, <span class="mono">[datum]</span> en
          <span class="mono">[tijd]</span> als plekhouders — die vult de app automatisch in. Voor een
          AfspraakPlanner-uitnodiging (waarbij de ontvanger zelf een moment kiest) gebruik je in plaats
          van datum/tijd de plekhouder <span class="mono">[link]</span>. Schrijf je verschillende
          contacten anders aan? Maak dan gerust meerdere sjablonen; je kiest per keer welke je gebruikt.
        </p>
        ${state.afspraakSjablonen.map((s) => `
          <div class="sjabloon-editor">
            <div class="field-row"><label>Naam sjabloon</label><input data-sjabloon-id="${esc(s.id)}" data-sjabloon-veld="naam" value="${esc(s.naam)}" /></div>
            <div class="field-row"><label>Onderwerp</label><input data-sjabloon-id="${esc(s.id)}" data-sjabloon-veld="onderwerp" value="${esc(s.onderwerp)}" /></div>
            <div class="field-row"><label>Bericht</label><textarea data-sjabloon-id="${esc(s.id)}" data-sjabloon-veld="tekst" style="min-height:100px;">${esc(s.tekst)}</textarea></div>
            <button class="btn-ghost btn-sm btn-danger" data-sjabloon-verwijder="${esc(s.id)}" ${state.afspraakSjablonen.length <= 1 ? `disabled title="Je hebt minimaal één sjabloon nodig"` : ""}>Sjabloon verwijderen</button>
          </div>
        `).join("")}
        <button class="btn-sm" id="btnSjabloonToevoegen">+ Nieuw sjabloon</button>
      </section>
    </div>`;
}

async function zetAlleGezinnenOpAuto() {
  const teWijzigen = Object.keys(state.gezinsdata).filter((k) => state.gezinsdata[k].schema !== "auto");
  if (!teWijzigen.length) return;
  if (!confirm(`Dit zet het terugkeerschema van ${teWijzigen.length} gezin(nen) om naar "Automatisch". Handmatig gekozen schema's worden daarbij overschreven. Doorgaan?`)) return;
  teWijzigen.forEach((k) => { state.gezinsdata[k] = { ...state.gezinsdata[k], schema: "auto" }; });
  await veiligOpslaan(bewaarGegevens, "alle gezinnen op automatisch zetten");
  render();
}

function sidebarMenuHTML() {
  if (!state.menuOpen) return "";
  return `
  <div class="sidebar-overlay" id="sidebarOverlay">
    <div class="sidebar-panel" id="sidebarPanel">
      <div class="sidebar-header">
        <div style="display:flex;align-items:center;gap:9px;">
          <img class="brand-logo" style="width:28px;height:28px;border-radius:8px;" src="icons/icon-192.png" alt="" />
          <span class="brand-title" style="font-size:15px;">Menu</span>
        </div>
        <button class="btn-ghost btn-sm" id="btnSluitMenu">\u2715</button>
      </div>
      ${state.stage === "dashboard" ? `
        <div class="sidebar-groep-label">Gegevens</div>
        <input id="fileImportExcel" type="file" accept=".xlsx,.xls" style="display:none" />
        ${menuItemHTML("btnImportExcel", "\u2191", "var(--green)", "var(--green-bg)", "Nieuwe Excel-import")}
        ${menuItemHTML("btnExportExcel", "\u2193", "var(--blue)", "var(--blue-bg)", "Exporteer naar Excel")}
        <input id="fileImportBackup" type="file" accept=".json" style="display:none" />
        ${menuItemHTML("btnImportBackup", "\u21ba", "var(--amber)", "var(--amber-bg)", "Back-up terugzetten")}
        ${menuItemHTML("btnExportBackup", "\u2913", "var(--accent)", "var(--accent-soft)", "Back-up maken")}
        <div class="sidebar-divider"></div>
      ` : ""}
      <div class="sidebar-groep-label">Systeem</div>
      ${menuItemHTML("btnInstellingen", "\u2699", "var(--text-soft)", "var(--grey-bg)", "Instellingen")}
      ${menuItemHTML("btnToonDebug", "\u25c6", "var(--text-soft)", "var(--grey-bg)", "Debug")}
      ${menuItemHTML("btnPinWijzigen", "\u2022\u2022\u2022", "var(--text-soft)", "var(--grey-bg)", "PIN wijzigen")}
      ${menuItemHTML("btnHandleiding", "?", "var(--accent)", "var(--accent-soft)", "Handleiding")}
      <div class="sidebar-footer">
        <div class="sidebar-divider"></div>
        <div class="sidebar-versie">ContactPlanner v${esc(APP_VERSIE)} \u00b7 \u00a9 R.J.J. van der Kolk</div>
      </div>
    </div>
  </div>`;
}

function topbarHTML() {
  const aantalGezinnen = computeGezinnen().length;
  const aantalPersonen = state.personen.length;
  return `
  <div class="topbar">
    <div class="topbar-links">
      <button class="hamburger-tile" id="btnHamburger" title="Menu">\u2630</button>
      <div class="brand">
        <img class="brand-logo" src="icons/icon-192.png" alt="ContactPlanner" />
        <div>
          <div class="brand-title">ContactPlanner</div>
          <div class="brand-sub">${aantalGezinnen} gezin${aantalGezinnen === 1 ? "" : "nen"} \u00b7 ${aantalPersonen} perso${aantalPersonen === 1 ? "on" : "nen"} \u00b7 ${cryptoRuntime.sleutel ? "lokaal versleuteld opgeslagen" : "lokaal opgeslagen"}</div>
        </div>
      </div>
    </div>
    <div class="topbar-actions">
      ${opslagIndicatorHTML()}
      ${backupIndicatorHTML()}
      ${state.stage === "dashboard" ? `<button id="btnMijlpalenOpen">Bijzondere momenten${heeftDringendeMijlpaal() ? ` <span class="dringend-dot" title="Er is binnen 14 dagen een bijzonder moment"></span>` : ""}</button>` : ""}
      <button class="btn-ghost btn-sm" id="btnVergrendelNu" title="Nu vergrendelen">Vergrendelen</button>
    </div>
  </div>
  <div id="foutBanner" class="fout-banner" style="display:${foutBannerTekst ? "flex" : "none"};">
    <span>${esc(foutBannerTekst)}</span>
    <button class="btn-sm" id="btnSluitFoutBanner">\u2715</button>
  </div>`;
}

function versieMeldingModalHTML() {
  const notitie = VERSIE_NOTITIES[APP_VERSIE];
  if (!state.nieuweVersieTonen || !notitie) return "";
  return `
  <div class="modal-overlay" id="versieMeldingOverlay">
    <div class="modal-box" style="max-width:440px;">
      <h3 style="margin:0 0 4px;font-size:18px;">Nieuwe versie: ${esc(APP_VERSIE)}</h3>
      <p style="font-size:12.5px;color:var(--text-soft);margin:0 0 12px;">Sinds je laatste gebruik is de app bijgewerkt. Dit is er veranderd:</p>
      <ul style="margin:0 0 14px;padding-left:20px;font-size:13.5px;line-height:1.6;">
        ${notitie.nieuw.map((r) => `<li>${esc(r)}</li>`).join("")}
      </ul>
      ${notitie.actie ? `
        <div style="background:var(--amber-bg);color:var(--amber);border-radius:8px;padding:10px 12px;font-size:12.5px;margin-bottom:14px;">
          <strong>Actie nodig:</strong> ${esc(notitie.actie)}
        </div>` : ""}
      <button class="btn-primary" id="btnVersieMeldingSluiten">Begrepen, sluiten</button>
    </div>
  </div>`;
}

function afspraakplannerPaginaHTML() {
  if (state.afspraakplannerStap === "resultaat" && state.afspraakplannerResultaat) {
    return afspraakplannerResultaatHTML();
  }
  const gezinnen = state.geselecteerdeGezinnen.map((key) => findGezin(key)).filter(Boolean);
  return `
  ${paginaSluitKnopHTML("btnSluitAfspraakplanner")}
  <div class="pagina-smal">
      <h2 style="font-size:22px;margin:0 0 4px;">Aanvraag uitzetten</h2>
      <p style="font-size:12.5px;color:var(--text-soft);margin:0 0 10px;">
        Elk gezinshoofd krijgt een link waarmee ze zelf één van de onderstaande tijdslots kunnen
        kiezen. Alleen regnr en tijdslot gaan naar de AfspraakPlanner-server, geen namen of adressen.
      </p>

      <label style="font-size:11.5px;font-weight:600;color:var(--text-soft);">Geselecteerde gezinnen (${gezinnen.length})</label>
      <div style="margin:4px 0 12px;">
        ${gezinnen.length === 0 ? `<p style="font-size:12.5px;color:var(--text-soft);">Geen gezinnen meer geselecteerd.</p>` : gezinnen.map((g) => `
          <span class="tag-grey" style="margin:0 4px 4px 0;display:inline-flex;align-items:center;gap:5px;">
            ${esc(g.gezinshoofd.naam || "Naamloos")}
            <button data-verwijder-selectie="${esc(g.gezinsKey)}" style="border:none;background:transparent;padding:0;cursor:pointer;color:var(--text-soft);font-size:12px;">✕</button>
          </span>
        `).join("")}
      </div>

      <div class="field-row">
        <label>Omschrijving (optioneel, zichtbaar voor het gezin)</label>
        <input id="afspraakplannerOmschrijving" placeholder="Bijv. Huisbezoek najaar 2026" value="${esc(state.afspraakplannerOmschrijving)}" />
      </div>

      <label style="font-size:11.5px;font-weight:600;color:var(--text-soft);">Aangeboden tijdslots</label>
      <div style="margin:6px 0 8px;">
        <div class="tijdslot-rij tijdslot-koppen">
          <span>Datum</span><span>Van</span><span>Tot (optioneel)</span><span></span>
        </div>
        ${state.afspraakplannerTijdslots.map((t, i) => `
          <div class="tijdslot-rij">
            <input type="date" data-tijdslot-index="${i}" data-tijdslot-veld="datum" value="${esc(t.datum)}" />
            <input type="time" data-tijdslot-index="${i}" data-tijdslot-veld="start" value="${esc(t.start)}" />
            <input type="time" data-tijdslot-index="${i}" data-tijdslot-veld="eind" value="${esc(t.eind)}" title="Eindtijd (optioneel) — laat leeg als alleen de starttijd vaststaat" />
            <button class="btn-ghost btn-sm btn-danger" data-tijdslot-verwijder="${i}" ${state.afspraakplannerTijdslots.length <= 1 ? `disabled title="Minimaal één tijdslot nodig"` : ""}>✕</button>
          </div>
        `).join("")}
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
        <button class="btn-sm" id="btnTijdslotToevoegen">+ Tijdslot toevoegen</button>
        <span style="display:inline-flex;gap:5px;align-items:center;font-size:12px;color:var(--text-soft);">
          <button class="btn-sm" id="btnTijdslotHerhalen" title="Herhaalt het laatst ingevulde tijdslot wekelijks op dezelfde dag en tijd">↻ Wekelijks herhalen,</button>
          <input type="number" min="2" max="52" id="tijdslotHerhaalWeken" value="${esc(state.afspraakplannerHerhaalWeken)}" style="width:52px;padding:6px 7px;border-radius:8px;border:1px solid var(--border);font-size:13px;" />
          weken totaal
        </span>
      </div>
      <p style="font-size:11.5px;color:var(--text-soft);margin:6px 0 0;">
        Tip: vul één tijdslot in (bijv. dinsdag 20:00) en klik op "Wekelijks herhalen" — de app vult
        dan dezelfde dag en tijd voor de opgegeven weken in.
      </p>

      ${state.afspraakplannerFout ? `<p style="color:var(--red);font-size:12.5px;margin-top:12px;">${esc(state.afspraakplannerFout)}</p>` : ""}

      <div class="quick-actions" style="margin-top:16px;">
        <button class="btn-primary" id="btnAfspraakplannerVersturen" ${state.afspraakplannerBezig ? "disabled" : ""}>${state.afspraakplannerBezig ? "Versturen…" : "Aanvraag uitzetten"}</button>
      </div>
  </div>`;
}

function afspraakplannerResultaatHTML() {
  const res = state.afspraakplannerResultaat;
  const sjabloon = haalAfspraakSjabloon(state.afspraakplannerSjabloonId);
  const gezinnenGeselecteerd = state.geselecteerdeGezinnen.map((key) => findGezin(key)).filter(Boolean);
  const rijen = (res.deelnemers || []).map((d) => {
    const gezin = gezinnenGeselecteerd.find((g) => g.gezinshoofd.regnr === d.regnr);
    const hoofd = gezin ? gezin.gezinshoofd : null;
    const naam = hoofd ? (hoofd.naam || "Naamloos") : `Regnr. ${esc(d.regnr)}`;
    const aanhef = hoofd ? (hoofd.roepnaam || hoofd.naam || "") : "";
    const ingevuld = pasAfspraakSjabloonToe(sjabloon, aanhef);
    const tekst = vulSjabloonIn(ingevuld.tekst, "", "", d.link);
    const mobielClean = hoofd && hoofd.mobiel ? String(hoofd.mobiel).replace(/[^0-9+]/g, "").replace(/^0/, "31") : "";
    return `
      <div class="note-card" style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
        <strong>${esc(naam)}</strong>
        <span style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
          ${hoofd && hoofd.email ? `<a class="btn btn-sm" href="${mailUrl(hoofd.email, ingevuld.onderwerp, tekst)}" target="_blank" rel="noopener">Mail</a>` : ""}
          ${mobielClean ? `<a class="btn btn-sm" href="https://wa.me/${mobielClean}?text=${encodeURIComponent(tekst)}" target="_blank" rel="noopener">WhatsApp</a>` : ""}
          ${!hoofd || (!hoofd.email && !mobielClean) ? `<span style="font-size:11.5px;color:var(--text-soft);">Geen e-mail/mobiel — link: <span class="mono">${esc(d.link)}</span></span>` : ""}
        </span>
      </div>`;
  }).join("");
  return `
  ${paginaSluitKnopHTML("btnSluitAfspraakplanner")}
  <div class="pagina-smal">
      <h2 style="font-size:22px;margin:0 0 4px;">Aanvraag aangemaakt</h2>
      <p style="font-size:12.5px;color:var(--text-soft);margin:0 0 10px;">
        ${(res.deelnemers || []).length} uitnodiging(en) klaar. Verstuur ze hieronder per gezin.
      </p>
      <div class="field-row">
        <label>Sjabloon</label>
        <select id="afspraakplannerSjabloonSelect">
          ${state.afspraakSjablonen.map((s) => `<option value="${esc(s.id)}" ${state.afspraakplannerSjabloonId === s.id ? "selected" : ""}>${esc(s.naam)}</option>`).join("")}
        </select>
      </div>
      ${rijen}
      <p style="font-size:12.5px;color:var(--text-soft);margin:12px 0 0;">
        Je vindt deze aanvraag later terug via <strong>"Lopende aanvragen"</strong> in de
        Planningweergave — daar zie je ook wie al een tijdslot gekozen heeft.
      </p>
      <button class="btn-primary" id="btnAfspraakplannerKlaar" style="margin-top:12px;">Klaar</button>
  </div>`;
}

function debugModalHTML() {
  if (!state.debugOpen) return "";
  const wbInfo = runtime.wb ? runtime.wb.SheetNames.map((n) => `${n}: ${berekenWerkelijkBereik(runtime.wb.Sheets[n])}`).join(" \u00b7 ") : "(nog geen bestand ingelezen)";
  return `
  <div class="modal-overlay" id="debugOverlay">
    <div class="modal-box" style="max-width:640px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <h3 style="margin:0;font-size:17px;">Technische logs</h3>
        <button class="btn-ghost btn-sm" id="btnSluitDebug">\u2715</button>
      </div>
      <div style="font-size:12.5px;color:var(--text-soft);margin-bottom:10px;">Tabbladen: ${esc(wbInfo)}</div>
      <div class="debug-log-list">
        ${debugLog.length === 0 ? `<div style="color:var(--text-soft);font-size:13px;">Nog geen logregels.</div>` : ""}
        ${debugLog.slice().reverse().map((d) => `
          <div class="debug-log-row ${d.level === "fout" ? "debug-log-fout" : ""}">
            <div><span class="mono" style="color:var(--text-soft);">${d.time}</span> <strong>${esc(d.msg)}</strong></div>
            ${d.data ? `<pre>${esc(d.data)}</pre>` : ""}
          </div>`).join("")}
      </div>
      <div style="margin-top:12px;display:flex;gap:8px;">
        <button class="btn-sm" id="btnKopieerDebug">Kopieer alles naar klembord</button>
      </div>
    </div>
  </div>`;
}

function mainHTML() {
  if (state.stage === "loading") return `<div class="empty-state">Bezig met laden\u2026</div>`;
  if (state.stage === "upload") return uploadHTML();
  if (state.stage === "sheetPrep") return sheetPrepHTML();
  if (state.stage === "mapping") return mappingHTML();
  if (state.stage === "importReport") return importReportHTML();
  if (state.stage === "dashboard") return dashboardHTML();
  if (state.stage === "mijlpalen") return mijlpalenHTML();
  if (state.stage === "instellingen") return instellingenPaginaHTML();
  if (state.stage === "aanvraagUitzetten") return afspraakplannerPaginaHTML();
  return "";
}

const SCIPIO_UITLEG_HTML = `
  <ol class="uitleg-stappen">
    <li>Ga naar <a href="https://www.scipio-online.nl/query/open.aspx" target="_blank" rel="noopener">scipio-online.nl/query/open.aspx</a>.</li>
    <li>Klik op <strong>"Importselectie - ContactPlanner"</strong>.</li>
    <li>Klik op het Excel-icoon onderin om de importselectie te downloaden, en lees dat bestand hier in.</li>
  </ol>
  <p style="font-size:12.5px;color:var(--text-soft);margin:8px 0 0;">
    De importselectie staat al voor je klaar in Scipio \u2014 je hoeft zelf niets meer samen te stellen.
  </p>
  <img class="uitleg-afbeelding" src="img/scipio-importselectie.png" alt="Scipio: scherm Zoekopdracht openen, met de zoekopdracht &quot;Importselectie - ContactPlanner&quot; in de lijst" loading="lazy" />`;

function uploadHTML() {
  return `
  <div class="upload-wrap">
    <div class="upload-card">
      <div class="upload-mark">XLS</div>
      <div class="upload-title">Begin met je Excel-export</div>
      <p class="upload-desc">
        Upload de Excel-export met regnr, naam en de overige basisgegevens. Je koppelt zelf welke
        kolom bij welk gegeven hoort. Alles wat je hierna in de app invoert \u2014 contactmomenten,
        schema's, notities \u2014 blijft bewaard op deze computer, ook bij een volgende import.
        Regnr. is het kenmerk waarmee personen worden herkend.
      </p>
      <details class="uitleg-details">
        <summary>Hoe maak ik deze Excel-export in Scipio?</summary>
        ${SCIPIO_UITLEG_HTML}
      </details>
      <input id="fileFirstUpload" type="file" accept=".xlsx,.xls" style="display:none" />
      <button class="btn-primary" id="btnFirstUpload">Kies Excel-bestand</button>
      <div style="margin-top:14px;">
        <input id="fileFirstBackup" type="file" accept=".json" style="display:none" />
        <button class="btn-ghost" id="btnFirstBackup" style="font-size:12.5px;">of zet een eerdere back-up terug (.json)</button>
      </div>
    </div>
  </div>`;
}

function sheetPrepHTML() {
  const aoa = state.aoa;
  const previewRijen = Math.min(aoa.length, 60);
  const kolomAantal = aoa.reduce((m, r) => Math.max(m, r.length), 0);

  const sheetKiezer = state.sheetNames.length > 1 ? `
    <div class="field-row" style="max-width:340px;">
      <label>Tabblad</label>
      <select id="sheetSelect">
        ${state.sheetNames.map((n) => `<option value="${esc(n)}" ${n === state.selectedSheetName ? "selected" : ""}>${esc(n)}</option>`).join("")}
      </select>
    </div>` : "";

  let rowsHTML = "";
  for (let i = 0; i < previewRijen; i++) {
    const line = aoa[i] || [];
    const isHeader = i === state.headerRowIndex;
    rowsHTML += `<tr class="${isHeader ? "gekozen-header-rij" : ""}" data-pick-row="${i}" id="prevrow-${i}">
      <td class="rownum-cell">${isHeader ? "\u2713" : ""} ${i + 1}</td>
      ${Array.from({ length: kolomAantal }).map((_, c) => `<td>${esc(line[c] !== undefined ? line[c] : "")}</td>`).join("")}
    </tr>`;
  }

  return `
    <button class="btn-ghost" id="btnSheetPrepTerug">\u2190 Terug</button>
    <h2 style="font-size:23px;margin:12px 0 4px;">Welke rij bevat de kolomnamen?</h2>
    <p style="color:var(--text-soft);font-size:13px;margin-bottom:10px;">
      Soms staat er een titel-, filter- of lege regel boven de echte kolomkoppen, of staan de gegevens
      op een ander tabblad. Kies hieronder het juiste tabblad (indien van toepassing) en klik op de rij
      met de kolomnamen \u2014 bijvoorbeeld de rij met "Naam", "Regnr.", "Adres" enzovoort. We hebben er
      zelf alvast \u00e9\u00e9n gemarkeerd als beste gok; controleer of die groene rij ook echt \u00e1l je
      velden bevat, en klik anders op de juiste rij.
    </p>
    ${sheetKiezer}
    <div class="field-row" style="max-width:220px;">
      <label>Spring naar rij</label>
      <input type="number" id="springNaarRij" min="1" max="${aoa.length}" placeholder="rijnummer" />
    </div>
    <div class="preview-wrap preview-wrap-scroll">
      <table class="preview-table">
        <tbody>${rowsHTML}</tbody>
      </table>
    </div>
    <details class="debug-details">
      <summary>Waarom deze rij? (technische details)</summary>
      <table class="preview-table" style="margin-top:8px;">
        <thead><tr><th>Rij</th><th>Gevulde cellen</th><th>Herkende velden</th><th>Score</th></tr></thead>
        <tbody>
          ${(state.headerRowDiagnostiek || []).map((d) => `<tr class="${d.rij - 1 === state.headerRowIndex ? "gekozen-header-rij" : ""}">
            <td>${d.rij}</td><td>${d.gevuld}</td><td>${esc(d.herkend.join(", ") || "\u2014")}</td><td>${d.score}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </details>
    <div style="margin-top:16px;">
      <button class="btn-primary" id="btnBevestigHeaderRij">\u2713 Dit is de juiste rij \u2014 doorgaan</button>
    </div>`;
}

function mappingHTML() {
  const fieldRows = BASIS_VELDEN.map((f) => `
    <div class="map-row">
      <label>${esc(f.label)}${f.key === "regnr" || f.key === "naam" ? " *" : ""}</label>
      <select data-map-field="${f.key}">
        <option value="">\u2014 geen \u2014</option>
        ${state.rawHeaders.map((h) => `<option value="${esc(h)}" ${state.mapping[f.key] === h ? "selected" : ""}>${esc(h)}</option>`).join("")}
      </select>
    </div>`).join("");

  const previewRows = state.rawRows.slice(0, 5).map((row) =>
    `<tr>${state.rawHeaders.map((h) => `<td>${esc(row[h])}</td>`).join("")}</tr>`
  ).join("");

  return `
    <button class="btn-ghost" id="btnMappingTerug">\u2190 Terug</button>
    <h2 style="font-size:23px;margin:12px 0 4px;">Koppel de kolommen</h2>
    <p style="color:var(--text-soft);font-size:13px;margin-bottom:8px;">
      We hebben ${state.rawRows.length} rijen gevonden. Regnr. en Naam zijn verplicht \u2014 Regnr. is
      het kenmerk waarmee we personen herkennen bij een volgende import. Niet-gekoppelde kolommen
      blijven bewaard als overige gegevens en komen terug bij export.
    </p>
    <div class="map-grid">${fieldRows}</div>
    <div class="preview-wrap">
      <table class="preview-table">
        <thead><tr>${state.rawHeaders.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
        <tbody>${previewRows}</tbody>
      </table>
    </div>
    <div style="margin-top:18px;">
      <button class="btn-primary" id="btnBevestigMapping">\u2713 Gegevens overnemen</button>
    </div>`;
}

function importReportHTML() {
  const d = state.importDiff || { nieuw: [], vertrokken: [] };
  const nieuwList = d.nieuw.map((regnr) => {
    const p = findPersoon(regnr);
    return `<div class="report-row"><span>${esc(p ? p.naam : regnr)} <span class="mono" style="color:var(--text-soft);">(${esc(regnr)})</span></span><span class="tag-grey">nieuw</span></div>`;
  }).join("") || `<div class="report-row" style="color:var(--text-soft);">Geen nieuwe personen.</div>`;

  const vertrokkenList = d.vertrokken.map((regnr) => {
    const p = findPersoon(regnr);
    if (!p) return "";
    return `<div class="report-row">
      <span>${esc(p.naam)} <span class="mono" style="color:var(--text-soft);">(${esc(regnr)})</span></span>
      <span style="display:flex;gap:6px;">
        <button class="btn-sm" data-behoud-vertrokken="${esc(regnr)}">Laten staan</button>
        <button class="btn-sm btn-danger" data-verwijder-vertrokken="${esc(regnr)}">Verwijderen</button>
      </span>
    </div>`;
  }).join("") || `<div class="report-row" style="color:var(--text-soft);">Niemand is weggevallen.</div>`;

  return `
    <h2 style="font-size:23px;margin:4px 0 14px;">Importrapport</h2>
    <div class="report-section">
      <div class="report-title">Nieuw t.o.v. de vorige lijst (${d.nieuw.length})</div>
      <div class="report-list">${nieuwList}</div>
    </div>
    <div class="report-section">
      <div class="report-title">Niet meer in deze import (${d.vertrokken.length})</div>
      <p style="font-size:12.5px;color:var(--text-soft);margin:-4px 0 8px;">
        Ze blijven zichtbaar met een grijs label totdat je kiest, zodat je niemand kwijtraakt.
      </p>
      <div class="report-list">${vertrokkenList}</div>
    </div>
    <button class="btn-primary" id="btnImportReportKlaar">Naar het overzicht</button>`;
}

function statsRowHTML() {
  const counts = telStatussen();
  const aantalFavorieten = computeGezinnen().filter((g) => getGezinsdata(g.gezinsKey).favoriet).length;
  const pillen = [
    ["alle", computeGezinnen().length, "Alle gezinnen", "var(--text)"],
    ["favoriet", aantalFavorieten, "\u2605 Gemarkeerd", "var(--amber)"],
    ["teLaat", counts.teLaat, "Te laat", "var(--red)"],
    ["nooit", counts.nooit, "Nog geen contact", "var(--red)"],
    ["binnenkort", counts.binnenkort, "Binnenkort", "var(--amber)"],
    ["opSchema", counts.opSchema, "Op schema", "var(--green)"],
    ["opmerking", counts.opmerking, "Opmerkingen", "var(--amber)"],
    ["nietInLaatsteImport", counts.nietInLaatsteImport, "Wijziging in gezin", "var(--text-soft)"],
  ];
  return pillen.map(([key, num, label, color]) => `
    <div class="stat-pill ${state.filterStatus === key ? "active" : ""}" data-filter="${key}" style="color:${color};">
      <div class="stat-num">${num}</div><div class="stat-label">${esc(label)}</div>
    </div>`).join("");
}

const PLANNING_KOLOMMEN = [
  { key: "achterstallig", label: "Achterstallig", kleur: "var(--red)" },
  { key: "maand", label: "Komende maand", kleur: "var(--amber)" },
  { key: "kwartaal", label: "Dit kwartaal", kleur: "var(--accent)" },
  { key: "halfjaar", label: "Komend halfjaar", kleur: "var(--green)" },
  { key: "later", label: "Verder vooruit", kleur: "var(--text-soft)" },
];

function planningBucket(gd, gezin) {
  const status = berekenStatus(gd, gezin);
  if (status === "nooit" || status === "teLaat") return "achterstallig";
  const next = berekenVolgendContact(gd, gezin);
  if (!next) return "achterstallig";
  const diffDagen = Math.round((new Date(next + "T00:00:00") - new Date(todayISO() + "T00:00:00")) / 86400000);
  if (diffDagen <= 30) return "maand";
  if (diffDagen <= 90) return "kwartaal";
  if (diffDagen <= 182) return "halfjaar";
  return "later";
}

function kanbanKaartHTML(gezin) {
  const gd = getGezinsdata(gezin.gezinsKey);
  const status = berekenStatus(gd, gezin);
  const meta = STATUS_META[status];
  const next = berekenVolgendContact(gd, gezin);
  const overigeNamen = gezin.leden.filter((p) => p.regnr !== gezin.gezinshoofd.regnr).map((p) => p.roepnaam || p.naam).filter(Boolean);
  const selectieModus = state.selectieModusPlanning;
  const geselecteerd = selectieModus && state.geselecteerdeGezinnen.includes(gezin.gezinsKey);
  return `
    <div class="kanban-kaart ${selectieModus ? "kanban-kaart-selectiemodus" : ""} ${geselecteerd ? "kanban-kaart-geselecteerd" : ""}" ${selectieModus ? `data-select-gezin="${esc(gezin.gezinsKey)}"` : `data-open="${esc(gezin.gezinsKey)}"`}>
      ${selectieModus ? `<div class="kanban-select-vinkje">${geselecteerd ? "\u2713" : ""}</div>` : ""}
      <div class="status-bar" style="background:${meta.color};" title="${esc(meta.label)}: ${esc(meta.uitleg)}"></div>
      <button class="favoriet-ster ${gd.favoriet ? "actief" : ""}" style="top:4px;right:4px;font-size:16px;" data-toggle-favoriet="${esc(gezin.gezinsKey)}" title="${gd.favoriet ? "Gemarkeerd \u2014 klik om te verwijderen" : "Markeer"}">${gd.favoriet ? "\u2605" : "\u2606"}</button>
      <div style="display:flex;align-items:center;gap:7px;">
        <div class="status-dot" style="color:${schemaKleur(effectiefSchema(gd, gezin))};" title="Interval: ${esc(schemaLabel(gd, gezin))}"></div>
        <div class="kanban-naam" style="padding-right:16px;">${esc(gezin.gezinshoofd.naam || "Naamloos")}</div>
      </div>
      <div class="kanban-meta">${gezin.leden.length} perso${gezin.leden.length === 1 ? "on" : "nen"}${overigeNamen.length ? ` \u00b7 ${esc(overigeNamen.slice(0, 2).join(", "))}${overigeNamen.length > 2 ? " e.a." : ""}` : ""}</div>
      <div class="kanban-onder">
        <div class="kanban-datum mono">${next ? fmtDatum(next) : "n.v.t."}</div>
        ${gd.algemeneNotitie ? `<span class="tag-opmerking">opmerking</span>` : ""}
      </div>
      ${afspraakBadgeHTML(gezin)}
    </div>`;
}

function planningHTML(lijst) {
  const buckets = {};
  PLANNING_KOLOMMEN.forEach((k) => { buckets[k.key] = []; });
  lijst.forEach((g) => { buckets[planningBucket(getGezinsdata(g.gezinsKey), g)].push(g); });
  Object.keys(buckets).forEach((k) => {
    buckets[k].sort((a, b) => {
      const na = berekenVolgendContact(getGezinsdata(a.gezinsKey), a) || "";
      const nb = berekenVolgendContact(getGezinsdata(b.gezinsKey), b) || "";
      return na.localeCompare(nb);
    });
  });
  return `
    <div class="kanban-board">
      ${PLANNING_KOLOMMEN.map((k) => `
        <div class="kanban-col">
          <div class="kanban-col-header" style="color:${k.kleur};">${esc(k.label)} <span class="kanban-col-count">${buckets[k.key].length}</span></div>
          <div class="kanban-col-body">
            ${buckets[k.key].length === 0 ? `<div class="kanban-leeg">Geen gezinnen</div>` : buckets[k.key].map((g) => kanbanKaartHTML(g)).join("")}
          </div>
        </div>`).join("")}
    </div>`;
}

function resultsAreaHTML() {
  const lijst = gefilterdeGezinnen();
  if (lijst.length === 0) return `<div class="empty-state">Geen gezinnen gevonden. Pas je zoekopdracht of filter aan.</div>`;
  if (state.weergave === "tabel") return gezinTabelHTML(lijst);
  if (state.weergave === "kolommen2") return `<div class="fam-grid-2">${lijst.map((g) => famCardHTML(g)).join("")}</div>`;
  if (state.weergave === "planning") return planningHTML(lijst);
  return `<div class="fam-list">${lijst.map((g) => famCardHTML(g)).join("")}</div>`;
}

const TABEL_KOLOMMEN = [
  { key: "naam", label: "Gezinshoofd", sortKey: "naam" },
  { key: "overigeLeden", label: "Overige leden", sortKey: null },
  { key: "adres", label: "Adres", sortKey: "adres" },
  { key: "plaats", label: "Plaats", sortKey: "plaats" },
  { key: "laatsteContact", label: "Laatste contact", sortKey: "laatsteContact" },
  { key: "volgendContact", label: "Volgend contact", sortKey: "volgendContact" },
  { key: "status", label: "Status", sortKey: "status" },
];

function gezinTabelHTML(lijst) {
  const b = state.tabelKolomBreedtes;
  const rijen = lijst.map((g) => {
    const gd = getGezinsdata(g.gezinsKey);
    const status = berekenStatus(gd, g);
    const meta = STATUS_META[status];
    const next = berekenVolgendContact(gd, g);
    const overigeNamen = g.leden.filter((p) => p.regnr !== g.gezinshoofd.regnr).map((p) => p.roepnaam || p.naam).filter(Boolean);
    return `<tr data-open="${esc(g.gezinsKey)}">
      <td style="background:${meta.color};width:4px;padding:0;" title="${esc(meta.label)}: ${esc(meta.uitleg)}"></td>
      <td><div class="status-dot" style="color:${schemaKleur(effectiefSchema(gd, g))};" title="Interval: ${esc(schemaLabel(gd, g))}"></div></td>
      <td class="td-clip">${esc(g.gezinshoofd.naam || "Naamloos")}</td>
      <td class="td-clip" title="${esc(overigeNamen.join(", "))}">${esc(overigeNamen.join(", "))}</td>
      <td class="td-clip" title="${esc(g.adres)}">${esc(g.adres)}</td>
      <td class="td-clip" title="${esc(g.plaats)}">${esc(g.plaats)}</td>
      <td class="mono">${gd.laatsteContact ? fmtDatum(gd.laatsteContact) : "\u2014"}</td>
      <td class="mono">${next ? fmtDatum(next) : "\u2014"}</td>
      <td><span class="status-badge" style="color:${meta.color};background:${meta.bg};">${esc(meta.label)}</span></td>
    </tr>`;
  }).join("");

  const koppen = TABEL_KOLOMMEN.map((k) => {
    const isActief = k.sortKey && state.sortBy === k.sortKey;
    const pijl = isActief ? (state.sortDir === "desc" ? " \u2193" : " \u2191") : "";
    return `<th>
      <span class="th-inner" ${k.sortKey ? `data-sort-key="${k.key}" style="cursor:pointer;"` : ""}>${esc(k.label)}${pijl}</span>
      <span class="col-resizer" data-col-key="${k.key}"></span>
    </th>`;
  }).join("");

  return `
    <div class="preview-wrap" style="max-height:none;">
      <table class="gezin-table">
        <colgroup>
          <col style="width:4px" /><col style="width:24px" />
          ${TABEL_KOLOMMEN.map((k) => `<col data-col-key="${k.key}" style="width:${b[k.key]}px" />`).join("")}
        </colgroup>
        <thead><tr><th></th><th></th>${koppen}</tr></thead>
        <tbody>${rijen}</tbody>
      </table>
    </div>`;
}

function dashboardHTML() {
  return `
    <div class="stats-row" id="statsRow">${statsRowHTML()}</div>
    <div class="toolbar">
      <div class="search-box">
        <input id="zoekInput" placeholder="Zoek op naam, regnr, adres of plaats\u2026" value="${esc(state.search)}" />
        <button class="search-clear ${state.search ? "" : "verborgen"}" id="btnZoekWissen" title="Zoekopdracht wissen">\u2715</button>
      </div>
      <div class="sort-select-wrap">
        <select class="filter-select" id="sortSelect">
          <option value="status" ${state.sortBy === "status" ? "selected" : ""}>Sorteer: urgentie</option>
          <option value="naam" ${state.sortBy === "naam" ? "selected" : ""}>Sorteer: naam</option>
          <option value="adres" ${state.sortBy === "adres" ? "selected" : ""}>Sorteer: adres</option>
          <option value="plaats" ${state.sortBy === "plaats" ? "selected" : ""}>Sorteer: plaats</option>
          <option value="laatsteContact" ${state.sortBy === "laatsteContact" ? "selected" : ""}>Sorteer: laatste contact</option>
          <option value="volgendContact" ${state.sortBy === "volgendContact" ? "selected" : ""}>Sorteer: volgend contact</option>
        </select>
      </div>
      <div class="view-toggle">
        <button class="btn-sm ${state.weergave === "lijst" ? "active" : ""}" data-weergave="lijst">Lijst</button>
        <button class="btn-sm ${state.weergave === "kolommen2" ? "active" : ""}" data-weergave="kolommen2">2 kolommen</button>
        <button class="btn-sm ${state.weergave === "tabel" ? "active" : ""}" data-weergave="tabel">Tabel</button>
        <button class="btn-sm ${state.weergave === "planning" ? "active" : ""}" data-weergave="planning">Planning</button>
      </div>
      ${state.weergave === "planning" ? `
      <div class="view-toggle">
        <button class="btn-sm ${state.selectieModusPlanning ? "active" : ""}" id="btnToggleSelectie">Selecteren</button>
        <button class="btn-sm" id="btnLopendeAanvragen">Lopende aanvragen${state.afspraakAanvragen.length ? ` (${state.afspraakAanvragen.length})` : ""}</button>
      </div>` : ""}
    </div>
    <div id="resultsArea">${resultsAreaHTML()}</div>
    ${state.weergave === "planning" && state.geselecteerdeGezinnen.length > 0 ? `
    <div class="actiebalk-selectie">
      <span>${state.geselecteerdeGezinnen.length} geselecteerd</span>
      <button class="btn-sm" id="btnAfspraakplannerUitzetten">Aanvraag uitzetten</button>
      <button class="actiebalk-selectie-sluit" id="btnSelectieLeegmaken" title="Selectie wissen">✕</button>
    </div>` : ""}`;
}

function attachDashboardResultEvents() {
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  $$("[data-filter]").forEach((el) => el.addEventListener("click", (e) => {
    state.filterStatus = e.currentTarget.dataset.filter; render();
  }));
  $$("[data-open]").forEach((el) => el.addEventListener("click", (e) => openGezinDetail(e.currentTarget.dataset.open)));
  $$("[data-select-gezin]").forEach((el) => el.addEventListener("click", (e) => {
    const key = e.currentTarget.dataset.selectGezin;
    const idx = state.geselecteerdeGezinnen.indexOf(key);
    if (idx === -1) state.geselecteerdeGezinnen.push(key);
    else state.geselecteerdeGezinnen.splice(idx, 1);
    render();
  }));
  $$("[data-toggle-favoriet]").forEach((el) => el.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFavoriet(e.currentTarget.dataset.toggleFavoriet);
  }));
  $$("[data-sort-key]").forEach((el) => el.addEventListener("click", (e) => {
    const key = e.currentTarget.dataset.sortKey;
    const veld = TABEL_KOLOMMEN.find((k) => k.key === key);
    const sortKey = veld ? veld.sortKey : key;
    if (!sortKey) return;
    if (state.sortBy === sortKey) {
      state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
    } else {
      state.sortBy = sortKey;
      state.sortDir = "asc";
    }
    render();
  }));
  $$("[data-col-key]").forEach((el) => {
    if (!el.classList.contains("col-resizer")) return;
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const key = el.dataset.colKey;
      const col = document.querySelector(`col[data-col-key="${key}"]`);
      if (!col) return;
      const startX = e.clientX;
      const startWidth = parseInt(col.style.width, 10) || 120;
      function onMove(ev) {
        const nieuw = Math.max(60, startWidth + (ev.clientX - startX));
        col.style.width = nieuw + "px";
      }
      function onUp() {
        state.tabelKolomBreedtes[key] = parseInt(col.style.width, 10);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  });
}

function attachSortenWeergaveEvents() {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const sortSel = document.getElementById("sortSelect");
  if (sortSel) sortSel.addEventListener("change", (e) => { state.sortBy = e.target.value; state.sortDir = "asc"; render(); });
  $$("[data-weergave]").forEach((el) => el.addEventListener("click", (e) => { state.weergave = e.currentTarget.dataset.weergave; render(); }));
  if ($("#btnToggleSelectie")) $("#btnToggleSelectie").addEventListener("click", () => {
    state.selectieModusPlanning = !state.selectieModusPlanning;
    if (!state.selectieModusPlanning) state.geselecteerdeGezinnen = [];
    render();
  });
  if ($("#btnSelectieLeegmaken")) $("#btnSelectieLeegmaken").addEventListener("click", () => {
    state.geselecteerdeGezinnen = [];
    render();
  });
  if ($("#btnAfspraakplannerUitzetten")) $("#btnAfspraakplannerUitzetten").addEventListener("click", () => {
    state.stage = "aanvraagUitzetten";
    state.afspraakplannerStap = "samenstellen";
    state.afspraakplannerOmschrijving = "";
    state.afspraakplannerTijdslots = [{ datum: "", start: "19:00", eind: "" }];
    state.afspraakplannerResultaat = null;
    state.afspraakplannerFout = "";
    render();
  });
}

function openGezinDetail(gezinsKey) {
  state.selectedGezinsKey = gezinsKey;
  state.editingContact = false;
  state.detailTab = "gezin";
  state.noteDraft = { datum: todayISO(), tijd: "19:30", soort: "Huisbezoek", notitie: "", gelezen: "" };
  state.bewerkNotitieId = null;
  state.geplandDraft = { datum: "", soort: "Ziekenhuisbezoek", betreft: "", notitie: "" };
  const aanhef = aanhefVoorGezin(gezinsKey);
  const ingevuld = pasAfspraakSjabloonToe(haalAfspraakSjabloon(state.afspraakSjabloonId), aanhef);
  state.afspraakDraft = {
    onderwerp: ingevuld.onderwerp,
    tekst: ingevuld.tekst,
    datum: "",
    tijd: "19:30",
  };
  render();
}

function schemaKleur(schema) {
  if (schema === "2x") return "var(--red)";
  if (schema === "1x") return "var(--amber)";
  if (schema === "0.5x") return "var(--green)";
  return "var(--blue)"; // aangepast
}

function famCardHTML(gezin) {
  const gd = getGezinsdata(gezin.gezinsKey);
  const status = berekenStatus(gd, gezin);
  const meta = STATUS_META[status];
  const next = berekenVolgendContact(gd, gezin);
  const laatste = laatsteHistorieItem(gd);
  const gezinshoofdLft = berekenLeeftijd(gezin.gezinshoofd.geboortedatum);
  const overigeNamen = gezin.leden.filter((p) => p.regnr !== gezin.gezinshoofd.regnr).map((p) => p.roepnaam || p.naam).filter(Boolean);
  const alleWeg = gezin.leden.every((p) => p._nietInLaatsteImport);
  const deelsGewijzigd = !alleWeg && gezin.leden.some((p) => p._nietInLaatsteImport);
  return `
    <div class="fam-card" data-open="${esc(gezin.gezinsKey)}">
      <div class="status-bar" style="background:${meta.color};" title="${esc(meta.label)}: ${esc(meta.uitleg)}"></div>
      <div class="status-dot" style="color:${schemaKleur(effectiefSchema(gd, gezin))};" title="Interval: ${esc(schemaLabel(gd, gezin))}"></div>
      <button class="favoriet-ster ${gd.favoriet ? "actief" : ""}" data-toggle-favoriet="${esc(gezin.gezinsKey)}" title="${gd.favoriet ? "Gemarkeerd \u2014 klik om te verwijderen" : "Markeer"}">${gd.favoriet ? "\u2605" : "\u2606"}</button>
      <div style="flex:1;min-width:0;">
        <div class="fam-name">${esc(gezin.gezinshoofd.naam || "Naamloos gezin")}${gezinshoofdLft !== null ? ` <span style="font-weight:400;color:var(--text-soft);">(${gezinshoofdLft} jr)</span>` : ""}</div>
        <div class="fam-meta">
          ${gezin.leden.length} perso${gezin.leden.length === 1 ? "on" : "nen"}${overigeNamen.length ? ` \u00b7 met ${esc(overigeNamen.join(", "))}` : ""}
          ${gezin.adres ? ` \u00b7 ${esc(gezin.adres)}` : ""}${gezin.plaats ? `, ${esc(gezin.plaats)}` : ""}
        </div>
        <span class="status-badge" style="color:${meta.color};background:${meta.bg};">${esc(meta.label)}</span>
        ${laatste && laatste.soort ? `<span class="tag-grey">laatst: ${esc(laatste.soort)}</span>` : ""}
        ${gd.algemeneNotitie ? `<span class="tag-opmerking">opmerking</span>` : ""}
        ${gd.gepland && gd.gepland.length ? `<span class="tag-opmerking" style="background:var(--red-bg);color:var(--red);">gepland: ${esc(gd.gepland[0].soort)} (${fmtDatum(gd.gepland[0].datum)})</span>` : ""}
        ${afspraakBadgeHTML(gezin)}
        ${alleWeg ? `<span class="tag-grey">gezin niet meer in laatste import</span>` : ""}
        ${deelsGewijzigd ? `<span class="tag-grey">samenstelling gewijzigd</span>` : ""}
      </div>
      <div class="fam-next">
        <div class="fam-next-label">Volgend contact</div>
        <div class="fam-next-date">${next ? fmtDatum(next) : "n.v.t."}</div>
      </div>
      <div class="chev">\u203A</div>
    </div>`;
}

function ledenlijstHTML(gezin) {
  return gezin.leden.map((p) => {
    const lft = berekenLeeftijd(p.geboortedatum);
    const isHoofd = p.regnr === gezin.gezinshoofd.regnr;
    return `
    <div class="note-card" style="${isHoofd ? "border-color:var(--accent);" : ""}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <strong>${esc(p.naam)}</strong>${p.roepnaam ? ` <span style="color:var(--text-soft);">(${esc(p.roepnaam)})</span>` : ""}
          ${isHoofd ? `<span class="tag-grey" style="margin-left:4px;">gezinshoofd</span>` : ""}
          ${p._nietInLaatsteImport ? `<span class="tag-grey">niet in laatste import</span>` : ""}
        </div>
        ${scipioUrl(p.regnr) ? `<a class="btn btn-sm" href="${scipioUrl(p.regnr)}" target="_blank" rel="noopener">Scipio</a>` : ""}
      </div>
      <div style="font-size:12.5px;color:var(--text-soft);margin-top:4px;">
        ${esc(p.gezinsrelatie || "\u2014")}${lft !== null ? ` \u00b7 ${lft} jr` : ""}${p.burgerlijkeStaat ? ` \u00b7 ${esc(p.burgerlijkeStaat)}` : ""}${p.kerkelijkeStaat ? ` \u00b7 ${esc(p.kerkelijkeStaat)}` : ""}
      </div>
      ${p.email || p.mobiel ? `<div style="font-size:12.5px;color:var(--text-soft);margin-top:2px;">${esc(p.email)}${p.email && p.mobiel ? " \u00b7 " : ""}${esc(p.mobiel)}</div>` : ""}
    </div>`;
  }).join("");
}

function detailHTML() {
  const gezin = state.selectedGezinsKey ? findGezin(state.selectedGezinsKey) : null;
  if (!gezin) return "";
  const hoofd = gezin.gezinshoofd;
  const gd = getGezinsdata(gezin.gezinsKey);
  const lft = berekenLeeftijd(hoofd.geboortedatum);
  const next = berekenVolgendContact(gd, gezin);

  const contactVelden = state.editingContact ? `
    <div class="field-grid2">
      <div class="field-row"><label>Naam gezinshoofd</label><input data-field="naam" value="${esc(hoofd.naam)}" /></div>
      <div class="field-row"><label>Roepnaam</label><input data-field="roepnaam" value="${esc(hoofd.roepnaam)}" /></div>
    </div>
    <div class="field-row"><label>Adres</label><input data-field="adres" value="${esc(hoofd.adres)}" /></div>
    <div class="field-grid2">
      <div class="field-row"><label>Postcode</label><input data-field="postcode" value="${esc(hoofd.postcode)}" /></div>
      <div class="field-row"><label>Plaatsnaam</label><input data-field="plaats" value="${esc(hoofd.plaats)}" /></div>
    </div>
    <div class="field-grid2">
      <div class="field-row"><label>E-mail</label><input data-field="email" value="${esc(hoofd.email)}" /></div>
      <div class="field-row"><label>Telefoon</label><input data-field="telefoon" value="${esc(hoofd.telefoon)}" /></div>
    </div>
    <div class="field-row"><label>Mobiel</label><input data-field="mobiel" value="${esc(hoofd.mobiel)}" /></div>
    <div class="field-grid2">
      <div class="field-row"><label>Geboortedatum (gezinshoofd)</label><input type="date" data-field="geboortedatum" value="${esc(hoofd.geboortedatum)}" /></div>
      <div class="field-row"><label>Huwelijksdatum</label><input type="date" data-field="trouwdatum" value="${esc(hoofd.trouwdatum)}" /></div>
    </div>
  ` : "";

  return `
  <div class="detail-overlay" id="detailOverlay">
    <div class="detail-panel" id="detailPanel">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <h2 style="font-size:22px;margin:0;">${esc(hoofd.naam)} <button class="favoriet-ster-detail ${gd.favoriet ? "actief" : ""}" id="btnToggleFavorietDetail" title="${gd.favoriet ? "Gemarkeerd \u2014 klik om te verwijderen" : "Markeer"}">${gd.favoriet ? "\u2605" : "\u2606"}</button></h2>
          <div style="color:var(--text-soft);font-size:12.5px;margin-top:3px;">
            ${gezin.leden.length} perso${gezin.leden.length === 1 ? "on" : "nen"} op dit adres${lft !== null ? ` \u00b7 gezinshoofd ${lft} jr` : ""}
          </div>
          <div style="color:var(--text-soft);font-size:12.5px;margin-top:1px;">${esc(gezin.adres)}${gezin.postcode ? `, ${esc(gezin.postcode)}` : ""}${gezin.plaats ? ` ${esc(gezin.plaats)}` : ""}</div>
          ${hoofd.telefoon ? `<div style="color:var(--text-soft);font-size:12.5px;margin-top:1px;">${esc(hoofd.telefoon)}</div>` : ""}
        </div>
        <div style="display:flex;gap:6px;">
          <button class="btn-ghost btn-sm" id="btnToggleEdit" title="Gegevens gezinshoofd bewerken">Bewerken</button>
          <button class="btn-ghost btn-sm" id="btnSluitDetail">\u2715</button>
        </div>
      </div>

      <div class="quick-actions">
        ${hoofd.email ? `<a class="btn" href="${mailUrl(hoofd.email, "Contact")}" target="_blank" rel="noopener">Mail sturen</a>` : ""}
        ${hoofd.mobiel ? `<a class="btn" href="https://wa.me/${String(hoofd.mobiel).replace(/[^0-9+]/g, "").replace(/^0/, "31")}" target="_blank">WhatsApp</a>` : ""}
        ${scipioUrl(hoofd.regnr) ? `<a class="btn" href="${scipioUrl(hoofd.regnr)}" target="_blank" rel="noopener">Scipio</a>` : ""}
      </div>

      ${contactVelden}

      <div class="detail-tabs">
        <button type="button" class="detail-tab ${state.detailTab === "gezin" ? "actief" : ""}" data-detail-tab="gezin">Gezin</button>
        <button type="button" class="detail-tab ${state.detailTab === "loggen" ? "actief" : ""}" data-detail-tab="loggen">Loggen</button>
        <button type="button" class="detail-tab ${state.detailTab === "plannen" ? "actief" : ""}" data-detail-tab="plannen">Plannen</button>
      </div>

      ${state.detailTab === "gezin" ? `
      <h3 style="font-size:16px;margin-bottom:8px;">Gezinsleden (${gezin.leden.length})</h3>
      ${ledenlijstHTML(gezin)}

      <hr class="divider" />
      <label style="font-size:11.5px;font-weight:600;color:var(--text-soft);">Algemene notitie</label>
      <p style="font-size:12px;color:var(--text-soft);margin-top:2px;margin-bottom:6px;">
        Niet gekoppeld aan een datum \u2014 bijvoorbeeld "wil geen contact" of andere blijvende aandachtspunten.
      </p>
      <div class="field-row">
        <textarea data-gezinsfield="algemeneNotitie" placeholder="Bijv. wil geen contact\u2026" style="min-height:70px;">${esc(gd.algemeneNotitie)}</textarea>
      </div>

      <hr class="divider" />
      <label style="font-size:11.5px;font-weight:600;color:var(--text-soft);">Terugkeerschema (voor het hele gezin)</label>
      <div class="schema-grid" style="margin-top:6px;">
        <div class="schema-opt schema-opt-breed ${gd.schema === "auto" ? "active" : ""}" data-schema="auto">Automatisch — op basis van leeftijd en gezinssamenstelling</div>
        ${[["2x", "2x per jaar"], ["1x", "1x per jaar"], ["0.5x", "Om het jaar"], ["aangepast", "Aangepast"]].map(([val, label]) => `
          <div class="schema-opt ${gd.schema === val ? "active" : ""}" data-schema="${val}">${label}</div>
        `).join("")}
      </div>
      ${gd.schema === "auto" ? `
        <div style="font-size:12px;color:var(--text-soft);margin-top:6px;">
          Voor dit gezin betekent dat nu: <strong>${esc(basisSchemaLabel(bepaalAutoSchema(gezin)))}</strong>
          (leeftijdsgrens en intervallen aanpassen kan via menu → Instellingen).
        </div>` : ""}
      ${gd.schema === "aangepast" ? `
        <div class="field-row" style="margin-top:8px;">
          <label>Aantal maanden tussen contactmomenten</label>
          <input type="number" min="1" data-gezinsfield="customMaanden" value="${esc(gd.customMaanden)}" />
        </div>` : ""}

      <div class="field-row" style="margin-top:10px;">
        <label>Volgend contact handmatig plannen (optioneel)</label>
        <input type="date" data-gezinsfield="volgendContactOverride" value="${esc(gd.volgendContactOverride)}" />
      </div>

      <div style="font-size:12.5px;color:var(--text-soft);margin-top:4px;">
        Laatste contact: <strong class="mono">${gd.laatsteContact ? fmtDatum(gd.laatsteContact) : "nog geen"}</strong>
        \u00b7 Berekend volgend contact: <strong class="mono">${next ? fmtDatum(next) : "\u2014"}</strong>
      </div>
      ` : ""}

      ${state.detailTab === "loggen" ? `
      <div class="sectie-prominent">
        <h3 style="font-size:16px;margin-bottom:8px;">${state.bewerkNotitieId ? "Contactmoment bewerken" : "Contactmoment loggen"}</h3>
        <p style="font-size:12px;color:var(--text-soft);margin-top:-4px;margin-bottom:10px;">Geldt voor het hele gezin \u2014 je spreekt immers in \u00e9\u00e9n keer iedereen.</p>
        <div class="field-grid2">
          <div class="field-row"><label>Datum</label><input type="date" id="noteDatum" value="${esc(state.noteDraft.datum)}" /></div>
          <div class="field-row"><label>Tijd</label><input type="time" id="noteTijd" value="${esc(state.noteDraft.tijd)}" /></div>
        </div>
        <div class="field-row"><label>Soort bezoek</label>
          <select id="noteSoort">
            ${SOORTEN_BEZOEK.map((s) => `<option value="${esc(s)}" ${state.noteDraft.soort === s ? "selected" : ""}>${esc(s)}</option>`).join("")}
          </select>
        </div>
        <div class="field-row"><label>Notitie</label><textarea id="noteNotitie" placeholder="Korte notitie over het gesprek\u2026">${esc(state.noteDraft.notitie)}</textarea></div>
        <div class="field-row"><label>Gelezen gedeelte</label><input id="noteGelezen" placeholder="Bijv. Psalm 23" value="${esc(state.noteDraft.gelezen)}" /></div>
        <div class="quick-actions">
          <button class="btn-primary" id="btnLogContact">${state.bewerkNotitieId ? "Wijziging opslaan" : "Contactmoment opslaan"}</button>
          ${state.bewerkNotitieId ? `<button class="btn-ghost" id="btnAnnuleerBewerkNotitie">Annuleren</button>` : ""}
        </div>
      </div>

      <hr class="divider" />
      <h3 style="font-size:16px;margin-bottom:8px;">Eerdere contactmomenten</h3>
      ${(gd.historie || []).length === 0 ? `<p style="color:var(--text-soft);font-size:13px;">Nog niets gelogd.</p>` : ""}
      ${(gd.historie || []).map((n) => `
        <div class="note-card ${state.bewerkNotitieId === n.id ? "note-card-actief" : ""}">
          <div style="display:flex;justify-content:space-between;">
            <span class="note-date">${fmtDatum(n.datum)}${n.tijd ? ` ${esc(n.tijd)}` : ""}${n.soort ? ` <span class="tag-grey">${esc(n.soort)}</span>` : ""}</span>
            <span style="display:flex;gap:4px;">
              <button class="btn-ghost btn-sm" data-bewerk-note="${esc(n.id)}">Bewerken</button>
              <button class="btn-ghost btn-sm btn-danger" data-verwijder-note="${esc(n.id)}">Verwijderen</button>
            </span>
          </div>
          ${n.notitie ? `<div style="font-size:13px;margin-top:6px;">${esc(n.notitie)}</div>` : ""}
          ${n.gelezen ? `<div style="font-size:12px;color:var(--text-soft);margin-top:4px;">Gelezen: ${esc(n.gelezen)}</div>` : ""}
        </div>`).join("")}
      ` : ""}

      ${state.detailTab === "plannen" ? `
      <h3 style="font-size:16px;margin-bottom:4px;">Inplannen \u2014 Bijzonder contactmoment</h3>
      <p style="font-size:12px;color:var(--text-soft);margin-top:0;margin-bottom:10px;">
        Voor iets buiten het gewone ritme \u2014 bijvoorbeeld een ziekenhuisopname. Staat los van het reguliere schema hierboven.
      </p>
      <div class="field-grid2">
        <div class="field-row"><label>Datum</label><input type="date" id="geplandDatum" value="${esc(state.geplandDraft.datum)}" /></div>
        <div class="field-row"><label>Soort</label>
          <select id="geplandSoort">
            ${SOORTEN_GEPLAND.map((s) => `<option value="${esc(s)}" ${state.geplandDraft.soort === s ? "selected" : ""}>${esc(s)}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="field-row"><label>Betreft (optioneel)</label><input id="geplandBetreft" placeholder="Bijv. Piet" value="${esc(state.geplandDraft.betreft)}" /></div>
      <div class="field-row"><label>Notitie</label><textarea id="geplandNotitie" placeholder="Bijv. wordt geopereerd, graag even langsgaan\u2026">${esc(state.geplandDraft.notitie)}</textarea></div>
      <button class="btn-primary" id="btnPlanGepland">Inplannen</button>

      ${(gd.gepland || []).length ? `
        <div style="margin-top:12px;">
          ${gd.gepland.map((g) => `
            <div class="note-card">
              <div style="display:flex;justify-content:space-between;">
                <span class="note-date">${fmtDatum(g.datum)} <span class="tag-grey">${esc(g.soort)}</span></span>
                <span style="display:flex;gap:4px;">
                  <button class="btn-sm btn-primary" data-gepland-gedaan="${esc(g.id)}">Gedaan (log contact)</button>
                  <button class="btn-ghost btn-sm btn-danger" data-gepland-verwijder="${esc(g.id)}">Verwijderen</button>
                </span>
              </div>
              ${g.betreft ? `<div style="font-size:12.5px;margin-top:5px;"><strong>Betreft:</strong> ${esc(g.betreft)}</div>` : ""}
              ${g.notitie ? `<div style="font-size:13px;margin-top:4px;">${esc(g.notitie)}</div>` : ""}
            </div>`).join("")}
        </div>` : ""}

      <hr class="divider" />
      <h3 style="font-size:16px;margin-bottom:4px;">Afspraak inplannen</h3>
      <p style="font-size:12px;color:var(--text-soft);margin-top:0;margin-bottom:10px;">
        Vul een datum/tijd in en pas de tekst zo nodig aan. <span class="mono">[datum]</span> en <span class="mono">[tijd]</span>
        worden bij het openen automatisch vervangen. Sjablonen beheer je via menu → Instellingen.
      </p>
      <div class="field-row">
        <label>Sjabloon</label>
        <select id="afspraakSjabloonSelect">
          ${state.afspraakSjablonen.map((s) => `<option value="${esc(s.id)}" ${state.afspraakSjabloonId === s.id ? "selected" : ""}>${esc(s.naam)}</option>`).join("")}
        </select>
      </div>
      <div class="field-grid2">
        <div class="field-row"><label>Datum</label><input type="date" id="afspraakDatum" value="${esc(state.afspraakDraft.datum)}" /></div>
        <div class="field-row"><label>Tijd</label><input type="time" id="afspraakTijd" value="${esc(state.afspraakDraft.tijd)}" /></div>
      </div>
      <div class="field-row"><label>Onderwerp (voor e-mail)</label><input id="afspraakOnderwerp" value="${esc(state.afspraakDraft.onderwerp)}" /></div>
      <div class="field-row"><label>Bericht</label><textarea id="afspraakTekst" style="min-height:130px;">${esc(state.afspraakDraft.tekst)}</textarea></div>
      <div class="quick-actions">
        <button class="btn-primary" id="btnAfspraakMail" ${hoofd.email ? "" : "disabled title=\"Geen e-mailadres bekend\""}>Open in e-mail</button>
        <button class="btn-primary" id="btnAfspraakWhatsapp" ${hoofd.mobiel ? "" : "disabled title=\"Geen mobiel nummer bekend\""}>Open in WhatsApp</button>
      </div>
      ` : ""}

      <hr class="divider" />
      <button class="btn-ghost btn-danger" id="btnVerwijderGezin">Dit hele gezin verwijderen</button>
    </div>
  </div>`;
}

// ---------------- events ----------------

function beperkteTopbarHTML() {
  return `
  <div class="topbar topbar-beperkt">
    <div class="brand">
      <img class="brand-logo" src="icons/icon-192.png" alt="ContactPlanner" />
      <div>
        <div class="brand-title">ContactPlanner</div>
        <div class="brand-sub">Vergrendeld \u2014 alleen bijzondere momenten zichtbaar</div>
      </div>
    </div>
    <div class="topbar-actions">
      <button class="btn-primary btn-sm" id="btnNaarPinScherm">Volledig ontgrendelen</button>
    </div>
  </div>`;
}

function attachMijlpalenEvents() {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  if ($("#mijlpaalLeeftijd")) $("#mijlpaalLeeftijd").addEventListener("change", async (e) => {
    const n = parseInt(e.target.value, 10);
    if (n > 0) {
      state.mijlpalenLeeftijdDrempel = n;
      await veiligOpslaan(() => dbSetInstelling("mijlpalenLeeftijdDrempel", n), "instelling opslaan");
      if (state.personen.length) werkMijlpalenCacheBij().catch((err) => logDebug("fout", "Kon mijlpalen-cache niet bijwerken: " + err.message));
    }
  });
  if ($("#mijlpaalHuwelijksjaren")) $("#mijlpaalHuwelijksjaren").addEventListener("change", async (e) => {
    const jaren = e.target.value.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n) && n > 0);
    state.mijlpalenHuwelijksJaren = jaren;
    await veiligOpslaan(() => dbSetInstelling("mijlpalenHuwelijksJaren", jaren), "instelling opslaan");
    if (state.personen.length) werkMijlpalenCacheBij().catch((err) => logDebug("fout", "Kon mijlpalen-cache niet bijwerken: " + err.message));
    render();
  });
  $$("[data-mijlpaal-filter]").forEach((el) => el.addEventListener("click", (e) => {
    state.mijlpalenToonAlles = e.currentTarget.dataset.mijlpaalFilter === "alles"; render();
  }));
  $$("[data-toggle-mijlpaal]").forEach((el) => el.addEventListener("click", (e) => toggleMijlpaalGedaan(e.currentTarget.dataset.toggleMijlpaal)));
  $$("[data-gepland-gedaan-mp]").forEach((el) => el.addEventListener("click", (e) => markeerGeplandGedaan(e.currentTarget.dataset.geplandGedaanMp, e.currentTarget.dataset.geplandIdMp)));
  $$("[data-gepland-verwijder-mp]").forEach((el) => el.addEventListener("click", (e) => verwijderGeplandMoment(e.currentTarget.dataset.geplandVerwijderMp, e.currentTarget.dataset.geplandIdMp)));
  $$(".mijlpaal-naam[data-open]").forEach((el) => el.addEventListener("click", (e) => openGezinDetail(e.currentTarget.dataset.open)));
}

function attachBeperkteMijlpalenEvents() {
  const $ = (sel) => document.querySelector(sel);
  if ($("#btnNaarPinScherm")) $("#btnNaarPinScherm").addEventListener("click", () => {
    state.mijlpalenZonderPin = false;
    render();
  });
  attachMijlpalenEvents();
}

function attachEvents() {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  if ($("#btnPinWijzigen")) $("#btnPinWijzigen").addEventListener("click", pinWijzigen);
  if ($("#btnVergrendelNu")) $("#btnVergrendelNu").addEventListener("click", vergrendelNu);
  if ($("#btnBackupNu")) $("#btnBackupNu").addEventListener("click", exporteerBackup);

  if ($("#btnHamburger")) $("#btnHamburger").addEventListener("click", () => { state.menuOpen = !state.menuOpen; render(); });
  if ($("#btnSluitMenu")) $("#btnSluitMenu").addEventListener("click", () => { state.menuOpen = false; render(); });
  if ($("#sidebarOverlay")) $("#sidebarOverlay").addEventListener("mousedown", (e) => { if (e.target.id === "sidebarOverlay") { state.menuOpen = false; render(); } });
  $$(".sidebar-item").forEach((el) => el.addEventListener("click", () => { state.menuOpen = false; }, { capture: false }));

  if ($("#btnMijlpalenOpen")) $("#btnMijlpalenOpen").addEventListener("click", () => { state.stage = "mijlpalen"; render(); });
  if ($("#btnMijlpalenTerug")) $("#btnMijlpalenTerug").addEventListener("click", () => { state.stage = "dashboard"; render(); });
  attachMijlpalenEvents();

  if ($("#btnInstellingen")) $("#btnInstellingen").addEventListener("click", () => {
    if (state.stage !== "instellingen") state.instellingenTerug = state.stage;
    state.stage = "instellingen";
    state.menuOpen = false;
    render();
  });
  if ($("#btnInstellingenTerug")) $("#btnInstellingenTerug").addEventListener("click", () => {
    state.stage = state.instellingenTerug || (state.personen.length ? "dashboard" : "upload");
    render();
  });
  if ($("#instSchemaLeeftijd")) $("#instSchemaLeeftijd").addEventListener("change", async (e) => {
    const n = parseInt(e.target.value, 10);
    if (n > 0) { state.schemaAutoLeeftijd = n; await veiligOpslaan(() => dbSetInstelling("schemaAutoLeeftijd", n), "instelling opslaan"); }
  });
  [["instSchemaJong", "schemaAutoJong"], ["instSchemaStel", "schemaAutoStel"], ["instSchemaAlleen", "schemaAutoAlleen"]].forEach(([id, sleutel]) => {
    const el = $("#" + id);
    if (el) el.addEventListener("change", async (e) => {
      state[sleutel] = e.target.value;
      await veiligOpslaan(() => dbSetInstelling(sleutel, e.target.value), "instelling opslaan");
    });
  });
  if ($("#btnAllesOpAuto")) $("#btnAllesOpAuto").addEventListener("click", zetAlleGezinnenOpAuto);
  $$("[data-mailmethode]").forEach((el) => el.addEventListener("click", async (e) => {
    state.mailMethode = e.currentTarget.dataset.mailmethode;
    await veiligOpslaan(() => dbSetInstelling("mailMethode", state.mailMethode), "instelling opslaan");
    render();
  }));
  $$("[data-backupopslag]").forEach((el) => el.addEventListener("click", async (e) => {
    state.backupOpslagMethode = e.currentTarget.dataset.backupopslag;
    await veiligOpslaan(() => dbSetInstelling("backupOpslagMethode", state.backupOpslagMethode), "instelling opslaan");
    render();
  }));
  if ($("#instAfspraakplannerSleutel")) $("#instAfspraakplannerSleutel").addEventListener("change", async (e) => {
    state.afspraakplannerApiSleutel = e.target.value.trim();
    await veiligOpslaan(() => dbSetInstelling("afspraakplannerApiSleutel", state.afspraakplannerApiSleutel), "instelling opslaan");
  });
  if ($("#instAfspraakplannerUrl")) $("#instAfspraakplannerUrl").addEventListener("change", async (e) => {
    state.afspraakplannerBasisUrl = e.target.value.trim() || "https://afspraak.hhgputten.nl";
    await veiligOpslaan(() => dbSetInstelling("afspraakplannerBasisUrl", state.afspraakplannerBasisUrl), "instelling opslaan");
  });
  $$("[data-sjabloon-veld]").forEach((el) => el.addEventListener("change", async (e) => {
    const sjabloon = state.afspraakSjablonen.find((s) => s.id === e.target.dataset.sjabloonId);
    if (!sjabloon) return;
    sjabloon[e.target.dataset.sjabloonVeld] = e.target.value;
    await veiligOpslaan(() => dbSetInstelling("afspraakSjablonen", state.afspraakSjablonen), "sjabloon opslaan");
  }));
  $$("[data-sjabloon-verwijder]").forEach((el) => el.addEventListener("click", async (e) => {
    if (state.afspraakSjablonen.length <= 1) return;
    const id = e.currentTarget.dataset.sjabloonVerwijder;
    const sjabloon = state.afspraakSjablonen.find((s) => s.id === id);
    if (!sjabloon || !confirm(`Sjabloon "${sjabloon.naam}" verwijderen?`)) return;
    state.afspraakSjablonen = state.afspraakSjablonen.filter((s) => s.id !== id);
    if (state.afspraakSjabloonId === id) state.afspraakSjabloonId = state.afspraakSjablonen[0].id;
    await veiligOpslaan(async () => {
      await dbSetInstelling("afspraakSjablonen", state.afspraakSjablonen);
      await dbSetInstelling("afspraakSjabloonId", state.afspraakSjabloonId);
    }, "sjabloon verwijderen");
    render();
  }));
  if ($("#btnSjabloonToevoegen")) $("#btnSjabloonToevoegen").addEventListener("click", async () => {
    state.afspraakSjablonen.push({ id: uid(), naam: "Nieuw sjabloon", onderwerp: "Huisbezoek inplannen", tekst: "Beste [naam],\n\n" });
    await veiligOpslaan(() => dbSetInstelling("afspraakSjablonen", state.afspraakSjablonen), "sjabloon toevoegen");
    render();
  });

  const sluitAfspraakplannerPagina = () => {
    state.stage = "dashboard";
    state.geselecteerdeGezinnen = [];
    state.selectieModusPlanning = false;
    render();
  };
  if ($("#btnSluitAfspraakplanner")) $("#btnSluitAfspraakplanner").addEventListener("click", sluitAfspraakplannerPagina);
  if ($("#btnAfspraakplannerKlaar")) $("#btnAfspraakplannerKlaar").addEventListener("click", sluitAfspraakplannerPagina);
  $$("[data-verwijder-selectie]").forEach((el) => el.addEventListener("click", (e) => {
    const key = e.currentTarget.dataset.verwijderSelectie;
    state.geselecteerdeGezinnen = state.geselecteerdeGezinnen.filter((k) => k !== key);
    render();
  }));
  if ($("#afspraakplannerOmschrijving")) $("#afspraakplannerOmschrijving").addEventListener("input", (e) => { state.afspraakplannerOmschrijving = e.target.value; });
  $$("[data-tijdslot-veld]").forEach((el) => el.addEventListener("change", (e) => {
    const i = parseInt(e.currentTarget.dataset.tijdslotIndex, 10);
    const veld = e.currentTarget.dataset.tijdslotVeld;
    if (state.afspraakplannerTijdslots[i]) state.afspraakplannerTijdslots[i][veld] = e.target.value;
  }));
  $$("[data-tijdslot-verwijder]").forEach((el) => el.addEventListener("click", (e) => {
    if (state.afspraakplannerTijdslots.length <= 1) return;
    const i = parseInt(e.currentTarget.dataset.tijdslotVerwijder, 10);
    state.afspraakplannerTijdslots.splice(i, 1);
    render();
  }));
  if ($("#btnTijdslotToevoegen")) $("#btnTijdslotToevoegen").addEventListener("click", () => {
    const laatste = state.afspraakplannerTijdslots[state.afspraakplannerTijdslots.length - 1];
    state.afspraakplannerTijdslots.push({ datum: laatste ? laatste.datum : "", start: "19:00", eind: "" });
    render();
  });
  if ($("#tijdslotHerhaalWeken")) $("#tijdslotHerhaalWeken").addEventListener("change", (e) => {
    const n = parseInt(e.target.value, 10);
    if (n >= 2 && n <= 52) state.afspraakplannerHerhaalWeken = n;
  });
  if ($("#btnTijdslotHerhalen")) $("#btnTijdslotHerhalen").addEventListener("click", () => {
    const basis = [...state.afspraakplannerTijdslots].reverse().find((t) => t.datum && t.start);
    if (!basis) {
      state.afspraakplannerFout = "Vul eerst een tijdslot met datum en starttijd in; dat wordt wekelijks herhaald.";
      render();
      return;
    }
    state.afspraakplannerFout = "";
    const bestaand = new Set(state.afspraakplannerTijdslots.map((t) => `${t.datum} ${t.start}`));
    for (let week = 1; week < state.afspraakplannerHerhaalWeken; week++) {
      const datum = addDays(basis.datum, week * 7);
      if (bestaand.has(`${datum} ${basis.start}`)) continue;
      state.afspraakplannerTijdslots.push({ datum, start: basis.start, eind: basis.eind });
    }
    render();
  });
  if ($("#btnAfspraakplannerVersturen")) $("#btnAfspraakplannerVersturen").addEventListener("click", verstuurAfspraakplannerAanvraag);
  if ($("#afspraakplannerSjabloonSelect")) $("#afspraakplannerSjabloonSelect").addEventListener("change", (e) => {
    state.afspraakplannerSjabloonId = e.target.value;
    render();
  });

  if ($("#btnLopendeAanvragen")) $("#btnLopendeAanvragen").addEventListener("click", () => { state.aanvragenOverzichtOpen = true; render(); });
  if ($("#btnSluitAanvragen")) $("#btnSluitAanvragen").addEventListener("click", () => { state.aanvragenOverzichtOpen = false; render(); });
  if ($("#aanvragenOverlay")) $("#aanvragenOverlay").addEventListener("mousedown", (e) => { if (e.target.id === "aanvragenOverlay") { state.aanvragenOverzichtOpen = false; render(); } });
  $$("[data-aanvraag-vernieuw]").forEach((el) => el.addEventListener("click", (e) => {
    vernieuwAanvraagStatus(parseInt(e.currentTarget.dataset.aanvraagVernieuw, 10));
  }));
  $$("[data-aanvraag-verwijder]").forEach((el) => el.addEventListener("click", (e) => {
    verwijderAanvraagLokaal(parseInt(e.currentTarget.dataset.aanvraagVerwijder, 10));
  }));
  $$("[data-overneem-aanvraag]").forEach((el) => el.addEventListener("click", (e) => {
    zetGekozenSlotInPlanning(parseInt(e.currentTarget.dataset.overneemAanvraag, 10), e.currentTarget.dataset.overneemRegnr);
  }));
  $$("[data-open-regnr]").forEach((el) => el.addEventListener("click", (e) => {
    const gezin = computeGezinnen().find((g) => g.gezinshoofd.regnr === e.currentTarget.dataset.openRegnr);
    if (!gezin) return;
    state.aanvragenOverzichtOpen = false;
    openGezinDetail(gezin.gezinsKey);
  }));
  $$("[data-slot-intrek-aanvraag]").forEach((el) => el.addEventListener("click", (e) => {
    trekTijdslotIn(parseInt(e.currentTarget.dataset.slotIntrekAanvraag, 10), parseInt(e.currentTarget.dataset.slotIntrekId, 10));
  }));
  $$("[data-aanvraag-slotdraft]").forEach((el) => el.addEventListener("change", (e) => {
    const id = parseInt(e.currentTarget.dataset.aanvraagSlotdraft, 10);
    const draft = state.aanvraagSlotDraft[id] || { datum: "", start: "19:00", eind: "" };
    draft[e.currentTarget.dataset.slotdraftVeld] = e.target.value;
    state.aanvraagSlotDraft[id] = draft;
  }));
  $$("[data-slot-toevoegen]").forEach((el) => el.addEventListener("click", (e) => {
    voegTijdslotToeAanAanvraag(parseInt(e.currentTarget.dataset.slotToevoegen, 10));
  }));
  $$("[data-aanvraag-gezindraft]").forEach((el) => el.addEventListener("change", (e) => {
    state.aanvraagGezinDraft[parseInt(e.currentTarget.dataset.aanvraagGezindraft, 10)] = e.target.value;
  }));
  $$("[data-gezin-toevoegen]").forEach((el) => el.addEventListener("click", (e) => {
    voegGezinToeAanAanvraag(parseInt(e.currentTarget.dataset.gezinToevoegen, 10));
  }));

  if ($("#btnToonDebug")) $("#btnToonDebug").addEventListener("click", () => { state.debugOpen = true; render(); });
  if ($("#btnHandleiding")) $("#btnHandleiding").addEventListener("click", () => { state.handleidingOpen = true; state.menuOpen = false; render(); });
  if ($("#btnSluitHandleiding")) $("#btnSluitHandleiding").addEventListener("click", () => { state.handleidingOpen = false; render(); });
  if ($("#handleidingOverlay")) $("#handleidingOverlay").addEventListener("mousedown", (e) => { if (e.target.id === "handleidingOverlay") { state.handleidingOpen = false; render(); } });
  if ($("#btnSluitDebug")) $("#btnSluitDebug").addEventListener("click", () => { state.debugOpen = false; render(); });
  if ($("#debugOverlay")) $("#debugOverlay").addEventListener("mousedown", (e) => { if (e.target.id === "debugOverlay") { state.debugOpen = false; render(); } });
  const sluitVersieMelding = async () => {
    state.nieuweVersieTonen = false;
    await veiligOpslaan(() => dbSetInstelling("laatstGezieneVersie", APP_VERSIE), "versie-melding bijwerken");
    render();
  };
  if ($("#btnVersieMeldingSluiten")) $("#btnVersieMeldingSluiten").addEventListener("click", sluitVersieMelding);
  if ($("#versieMeldingOverlay")) $("#versieMeldingOverlay").addEventListener("mousedown", (e) => { if (e.target.id === "versieMeldingOverlay") sluitVersieMelding(); });
  if ($("#btnKopieerDebug")) $("#btnKopieerDebug").addEventListener("click", () => {
    const tekst = debugLog.map((d) => `[${d.time}] ${d.level.toUpperCase()} ${d.msg}${d.data ? "\n" + d.data : ""}`).join("\n\n");
    navigator.clipboard.writeText(tekst || "(geen logregels)").then(() => alert("Gekopieerd naar klembord.")).catch(() => alert("Kopi\u00ebren is niet gelukt, selecteer de tekst handmatig."));
  });
  if ($("#btnSluitFoutBanner")) $("#btnSluitFoutBanner").addEventListener("click", () => { foutBannerTekst = ""; render(); });

  if ($("#fileFirstUpload")) $("#fileFirstUpload").addEventListener("change", handleFileSelect);
  if ($("#btnFirstUpload")) $("#btnFirstUpload").addEventListener("click", () => $("#fileFirstUpload").click());
  if ($("#fileFirstBackup")) $("#fileFirstBackup").addEventListener("change", handleBackupImport);
  if ($("#btnFirstBackup")) $("#btnFirstBackup").addEventListener("click", () => $("#fileFirstBackup").click());

  if ($("#fileImportExcel")) $("#fileImportExcel").addEventListener("change", handleFileSelect);
  if ($("#btnImportExcel")) $("#btnImportExcel").addEventListener("click", () => $("#fileImportExcel").click());
  if ($("#btnExportExcel")) $("#btnExportExcel").addEventListener("click", exporteerExcel);
  if ($("#fileImportBackup")) $("#fileImportBackup").addEventListener("change", handleBackupImport);
  if ($("#btnImportBackup")) $("#btnImportBackup").addEventListener("click", () => $("#fileImportBackup").click());
  if ($("#btnExportBackup")) $("#btnExportBackup").addEventListener("click", exporteerBackup);
  if ($("#btnSheetPrepTerug")) $("#btnSheetPrepTerug").addEventListener("click", () => { state.stage = state.personen.length ? "dashboard" : "upload"; render(); });
  if ($("#sheetSelect")) $("#sheetSelect").addEventListener("change", (e) => wisselSheet(e.target.value));
  $$("[data-pick-row]").forEach((el) => el.addEventListener("click", (e) => {
    state.headerRowIndex = parseInt(e.currentTarget.dataset.pickRow, 10); render();
  }));
  if ($("#btnBevestigHeaderRij")) $("#btnBevestigHeaderRij").addEventListener("click", bevestigHeaderRij);
  if ($("#springNaarRij")) $("#springNaarRij").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const n = parseInt(e.target.value, 10);
      if (n >= 1 && n <= state.aoa.length) {
        state.headerRowIndex = n - 1;
        render();
        setTimeout(() => {
          const el = document.getElementById(`prevrow-${n - 1}`);
          if (el) el.scrollIntoView({ block: "center" });
        }, 0);
      }
    }
  });

  if ($("#btnMappingTerug")) $("#btnMappingTerug").addEventListener("click", () => { state.stage = "sheetPrep"; render(); });
  $$("[data-map-field]").forEach((el) => el.addEventListener("change", (e) => {
    state.mapping[e.target.dataset.mapField] = e.target.value;
  }));
  if ($("#btnBevestigMapping")) $("#btnBevestigMapping").addEventListener("click", bevestigMapping);

  if ($("#btnImportReportKlaar")) $("#btnImportReportKlaar").addEventListener("click", () => { state.stage = "dashboard"; render(); });
  $$("[data-verwijder-vertrokken]").forEach((el) => el.addEventListener("click", (e) => verwijderVertrokkenPersoon(e.target.dataset.verwijderVertrokken)));
  $$("[data-behoud-vertrokken]").forEach((el) => el.addEventListener("click", (e) => behoudVertrokkenPersoon(e.target.dataset.behoudVertrokken)));

  if (state.stage === "dashboard") {
    attachDashboardResultEvents();
    attachSortenWeergaveEvents();
    if ($("#zoekInput")) {
      $("#zoekInput").addEventListener("input", (e) => {
        state.search = e.target.value;
        if ($("#btnZoekWissen")) $("#btnZoekWissen").classList.toggle("verborgen", !state.search);
        document.getElementById("statsRow").innerHTML = statsRowHTML();
        document.getElementById("resultsArea").innerHTML = resultsAreaHTML();
        attachDashboardResultEvents();
      });
    }
    if ($("#btnZoekWissen")) $("#btnZoekWissen").addEventListener("click", () => { state.search = ""; render(); });
  }

  if ($("#btnSluitDetail")) $("#btnSluitDetail").addEventListener("click", () => { state.selectedGezinsKey = null; render(); });
  if ($("#detailOverlay")) $("#detailOverlay").addEventListener("mousedown", (e) => { if (e.target.id === "detailOverlay") { state.selectedGezinsKey = null; render(); } });
  if ($("#btnToggleEdit")) $("#btnToggleEdit").addEventListener("click", () => { state.editingContact = !state.editingContact; render(); });
  if ($("#btnToggleFavorietDetail")) $("#btnToggleFavorietDetail").addEventListener("click", () => toggleFavoriet(state.selectedGezinsKey));
  if ($("#btnVerwijderGezin")) $("#btnVerwijderGezin").addEventListener("click", () => verwijderGezin(state.selectedGezinsKey));
  $$("[data-detail-tab]").forEach((el) => el.addEventListener("click", () => { state.detailTab = el.dataset.detailTab; render(); }));

  // velden van het gezinshoofd (naam, adres, contactgegevens)
  $$("[data-field]").forEach((el) => el.addEventListener("change", (e) => {
    const gezin = findGezin(state.selectedGezinsKey);
    if (!gezin) return;
    updatePersoon(gezin.gezinshoofd.regnr, { [e.target.dataset.field]: e.target.value });
  }));
  // velden van het gezin als geheel (schema, override)
  $$("[data-gezinsfield]").forEach((el) => el.addEventListener("change", (e) => {
    updateGezinsdata(state.selectedGezinsKey, { [e.target.dataset.gezinsfield]: e.target.value });
  }));
  $$("[data-schema]").forEach((el) => el.addEventListener("click", (e) => {
    updateGezinsdata(state.selectedGezinsKey, { schema: e.currentTarget.dataset.schema });
  }));

  if ($("#noteDatum")) $("#noteDatum").addEventListener("change", (e) => { state.noteDraft.datum = e.target.value; });
  if ($("#noteTijd")) $("#noteTijd").addEventListener("change", (e) => { state.noteDraft.tijd = e.target.value; });
  if ($("#noteSoort")) $("#noteSoort").addEventListener("change", (e) => { state.noteDraft.soort = e.target.value; });
  if ($("#noteNotitie")) $("#noteNotitie").addEventListener("input", (e) => { state.noteDraft.notitie = e.target.value; });
  if ($("#noteGelezen")) $("#noteGelezen").addEventListener("input", (e) => { state.noteDraft.gelezen = e.target.value; });
  if ($("#geplandDatum")) $("#geplandDatum").addEventListener("change", (e) => { state.geplandDraft.datum = e.target.value; });
  if ($("#geplandSoort")) $("#geplandSoort").addEventListener("change", (e) => { state.geplandDraft.soort = e.target.value; });
  if ($("#geplandBetreft")) $("#geplandBetreft").addEventListener("input", (e) => { state.geplandDraft.betreft = e.target.value; });
  if ($("#geplandNotitie")) $("#geplandNotitie").addEventListener("input", (e) => { state.geplandDraft.notitie = e.target.value; });
  if ($("#btnPlanGepland")) $("#btnPlanGepland").addEventListener("click", () => plandGepland(state.selectedGezinsKey));
  $$("[data-gepland-gedaan]").forEach((el) => el.addEventListener("click", (e) => markeerGeplandGedaan(state.selectedGezinsKey, e.currentTarget.dataset.geplandGedaan)));
  $$("[data-gepland-verwijder]").forEach((el) => el.addEventListener("click", (e) => verwijderGeplandMoment(state.selectedGezinsKey, e.currentTarget.dataset.geplandVerwijder)));

  if ($("#btnLogContact")) $("#btnLogContact").addEventListener("click", () => logGezinContact(state.selectedGezinsKey));
  if ($("#btnAnnuleerBewerkNotitie")) $("#btnAnnuleerBewerkNotitie").addEventListener("click", annuleerBewerkNotitie);
  $$("[data-bewerk-note]").forEach((el) => el.addEventListener("click", (e) => bewerkHistorieItem(state.selectedGezinsKey, e.target.dataset.bewerkNote)));
  $$("[data-verwijder-note]").forEach((el) => el.addEventListener("click", (e) => verwijderHistorieItem(state.selectedGezinsKey, e.target.dataset.verwijderNote)));

  // afspraak-sjabloon: waarden bijhouden zonder de hele detail opnieuw te tekenen
  if ($("#afspraakDatum")) $("#afspraakDatum").addEventListener("change", (e) => { state.afspraakDraft.datum = e.target.value; });
  if ($("#afspraakTijd")) $("#afspraakTijd").addEventListener("change", (e) => { state.afspraakDraft.tijd = e.target.value; });
  if ($("#afspraakOnderwerp")) $("#afspraakOnderwerp").addEventListener("input", (e) => { state.afspraakDraft.onderwerp = e.target.value; });
  if ($("#afspraakTekst")) $("#afspraakTekst").addEventListener("input", (e) => { state.afspraakDraft.tekst = e.target.value; });
  if ($("#afspraakSjabloonSelect")) $("#afspraakSjabloonSelect").addEventListener("change", async (e) => {
    state.afspraakSjabloonId = e.target.value;
    const ingevuld = pasAfspraakSjabloonToe(haalAfspraakSjabloon(state.afspraakSjabloonId), aanhefVoorGezin(state.selectedGezinsKey));
    state.afspraakDraft.onderwerp = ingevuld.onderwerp;
    state.afspraakDraft.tekst = ingevuld.tekst;
    await veiligOpslaan(() => dbSetInstelling("afspraakSjabloonId", state.afspraakSjabloonId), "sjabloonkeuze opslaan");
    render();
  });
  if ($("#btnAfspraakMail")) $("#btnAfspraakMail").addEventListener("click", () => openAfspraakMail(state.selectedGezinsKey));
  if ($("#btnAfspraakWhatsapp")) $("#btnAfspraakWhatsapp").addEventListener("click", () => openAfspraakWhatsapp(state.selectedGezinsKey));
}

function vulSjabloonIn(tekst, datumISO, tijd, link) {
  const datumTekst = datumISO ? fmtDatum(datumISO) : "[datum]";
  const tijdTekst = tijd || "[tijd]";
  let resultaat = tekst.replace(/\[datum\]/gi, datumTekst).replace(/\[tijd\]/gi, tijdTekst);
  if (link) resultaat = resultaat.replace(/\[link\]/gi, link);
  return resultaat;
}

function haalAfspraakSjabloon(id) {
  return state.afspraakSjablonen.find((s) => s.id === id) || state.afspraakSjablonen[0] || STANDAARD_AFSPRAAK_SJABLOON;
}

// Vult [naam] direct in (de aanhef is al bekend zodra je een gezin opent of een sjabloon kiest);
// [datum] en [tijd] blijven staan als plekhouder tot vulSjabloonIn() ze bij het versturen invult.
function pasAfspraakSjabloonToe(sjabloon, aanhef) {
  const vulNaamIn = (s) => s.replace(/\[naam\]/gi, aanhef || "");
  return { onderwerp: vulNaamIn(sjabloon.onderwerp), tekst: vulNaamIn(sjabloon.tekst) };
}

// Enige plek in de hele app die het internet op gaat — en alleen na een bewuste klik
// ("Aanvraag uitzetten", "Status vernieuwen", "Intrekken", "+ Tijdslot"/"+ Gezin"). Er gaan nooit
// namen of adressen over de lijn, alleen regnr en tijdslot (zie afspraakplanner/docs/API.md).
async function afspraakplannerFetch(pad, opties) {
  if (!state.afspraakplannerApiSleutel) {
    throw new Error("Vul eerst een API-sleutel in bij Instellingen → AfspraakPlanner.");
  }
  const basis = state.afspraakplannerBasisUrl.replace(/\/+$/, "");
  const resp = await fetch(basis + "/api" + pad, {
    ...opties,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${state.afspraakplannerApiSleutel}`,
      ...(opties && opties.headers),
    },
  });
  let data = null;
  try { data = await resp.json(); } catch (e) { /* geen of ongeldige JSON-body */ }
  if (!resp.ok) throw new Error((data && data.error) || `AfspraakPlanner-fout (HTTP ${resp.status})`);
  return data;
}

async function verstuurAfspraakplannerAanvraag() {
  const gezinnen = state.geselecteerdeGezinnen.map((key) => findGezin(key)).filter(Boolean);
  if (!gezinnen.length) { state.afspraakplannerFout = "Selecteer minstens één gezin."; render(); return; }
  // De eindtijd is optioneel (sinds AfspraakPlanner die ook niet meer vereist).
  const tijdslots = state.afspraakplannerTijdslots
    .filter((t) => t.datum && t.start)
    .map((t) => ({ start: `${t.datum} ${t.start}:00`, eind: t.eind ? `${t.datum} ${t.eind}:00` : null }));
  if (!tijdslots.length) {
    state.afspraakplannerFout = "Vul minstens één tijdslot met datum en starttijd in.";
    render();
    return;
  }
  state.afspraakplannerBezig = true;
  state.afspraakplannerFout = "";
  render();
  try {
    const data = await afspraakplannerFetch("/aanvragen.php", {
      method: "POST",
      body: JSON.stringify({
        omschrijving: state.afspraakplannerOmschrijving || undefined,
        tijdslots,
        regnrs: gezinnen.map((g) => g.gezinshoofd.regnr),
      }),
    });
    state.afspraakplannerResultaat = data;
    state.afspraakplannerStap = "resultaat";
    // De aanvraag lokaal bewaren (in de kluis), zodat je later de status kunt volgen
    // via "Lopende aanvragen" en de links per gezin opnieuw kunt versturen.
    state.afspraakAanvragen.push({
      id: data.aanvraag_id,
      omschrijving: state.afspraakplannerOmschrijving,
      aangemaaktOp: todayISO(),
      deelnemers: (data.deelnemers || []).map((d) => ({ regnr: d.regnr, link: d.link })),
      status: null, // laatste GET-resultaat van /aanvragen.php?id=…
      laatstVernieuwdOp: null,
      overgenomen: {}, // regnr -> true zodra de gekozen afspraak in de planning is gezet
    });
    await veiligOpslaan(bewaarGegevens, "aanvraag bewaren");
  } catch (e) {
    state.afspraakplannerFout = e.message;
  }
  state.afspraakplannerBezig = false;
  render();
}

async function vernieuwAanvraagStatus(id) {
  const aanvraag = state.afspraakAanvragen.find((a) => a.id === id);
  if (!aanvraag) return;
  state.aanvraagStatusBezigId = id;
  delete state.aanvraagFouten[id];
  render();
  try {
    const data = await afspraakplannerFetch(`/aanvragen.php?id=${encodeURIComponent(id)}`, { method: "GET" });
    aanvraag.status = data;
    aanvraag.laatstVernieuwdOp = Date.now();
    await veiligOpslaan(bewaarGegevens, "aanvraagstatus bijwerken");
  } catch (e) {
    state.aanvraagFouten[id] = e.message;
  }
  state.aanvraagStatusBezigId = null;
  render();
}

async function verwijderAanvraagLokaal(id) {
  const aanvraag = state.afspraakAanvragen.find((a) => a.id === id);
  if (!aanvraag) return;
  if (!confirm("Deze aanvraag uit het overzicht verwijderen? De aanvraag zelf (en al gemaakte keuzes) blijft op de AfspraakPlanner-server bestaan; je kunt de status daarna alleen niet meer volgen vanuit ContactPlanner.")) return;
  state.afspraakAanvragen = state.afspraakAanvragen.filter((a) => a.id !== id);
  await veiligOpslaan(bewaarGegevens, "aanvraag verwijderen");
  render();
}

// Zet het door een gemeentelid gekozen tijdslot als gepland bijzonder contactmoment in het
// gezinsdossier, zodat het meedraait in de Planningweergave en Bijzondere momenten.
async function zetGekozenSlotInPlanning(aanvraagId, regnr) {
  const aanvraag = state.afspraakAanvragen.find((a) => a.id === aanvraagId);
  if (!aanvraag || !aanvraag.status) return;
  const deelnemer = (aanvraag.status.deelnemers || []).find((d) => d.regnr === regnr);
  const slot = deelnemer && (aanvraag.status.tijdslots || []).find((t) => t.id === deelnemer.gekozen_slot_id);
  if (!slot) return;
  const gezin = computeGezinnen().find((g) => g.gezinshoofd.regnr === regnr);
  if (!gezin) { alert("Dit regnr is niet (meer) terug te vinden in de huidige lijst."); return; }
  const [datumISO, startTijd] = slot.start_tijd.split(" ");
  const eindTijd = slot.eind_tijd ? slot.eind_tijd.split(" ")[1] : "";
  const gd = getGezinsdata(gezin.gezinsKey);
  const entry = {
    id: uid(),
    datum: datumISO,
    soort: "Huisbezoek",
    betreft: "",
    notitie: `${startTijd.slice(0, 5)}${eindTijd ? "–" + eindTijd.slice(0, 5) : ""} uur — via AfspraakPlanner${aanvraag.omschrijving ? ` (${aanvraag.omschrijving})` : ""}`,
  };
  const gepland = [...(gd.gepland || []), entry].sort((a, b) => a.datum.localeCompare(b.datum));
  state.gezinsdata[gezin.gezinsKey] = { ...gd, gepland, gezinsKey: gezin.gezinsKey };
  aanvraag.overgenomen = { ...(aanvraag.overgenomen || {}), [regnr]: true };
  await veiligOpslaan(bewaarGegevens, "afspraak in planning zetten");
  render();
}

// "2026-09-10 19:00:00" (+ optionele eindtijd) -> "10 sep 2026, 19:00–19:30 uur"
function fmtSlotTijd(startStr, eindStr) {
  const [datum, start] = String(startStr || "").split(" ");
  const eind = eindStr ? String(eindStr).split(" ")[1] : "";
  return `${fmtDatum(datum)}, ${(start || "").slice(0, 5)}${eind ? "–" + eind.slice(0, 5) : ""} uur`;
}

function naamVoorRegnr(regnr) {
  const p = findPersoon(regnr);
  return p ? (p.naam || "Naamloos") : `Regnr. ${regnr}`;
}

// Trekt een nog vrij tijdslot in via de API. Een al gekozen slot weigert de server
// bewust (dat raakt een gemeentelid en gaat telefonisch/persoonlijk).
async function trekTijdslotIn(aanvraagId, slotId) {
  const aanvraag = state.afspraakAanvragen.find((a) => a.id === aanvraagId);
  if (!aanvraag) return;
  if (!confirm("Dit tijdslot intrekken? Het is dan voor niemand meer te kiezen.")) return;
  state.aanvraagStatusBezigId = aanvraagId;
  delete state.aanvraagFouten[aanvraagId];
  render();
  try {
    await afspraakplannerFetch(`/aanvragen.php?id=${encodeURIComponent(aanvraagId)}&slot_id=${encodeURIComponent(slotId)}`, { method: "DELETE" });
  } catch (e) {
    state.aanvraagFouten[aanvraagId] = e.message;
    state.aanvraagStatusBezigId = null;
    render();
    return;
  }
  state.aanvraagStatusBezigId = null;
  await vernieuwAanvraagStatus(aanvraagId);
}

// Breidt een bestaande aanvraag uit met extra tijdslots en/of gezinnen (PATCH).
// Nieuwe deelnemers (met hun link) worden aan de lokale aanvraag toegevoegd.
async function breidAanvraagUit(aanvraagId, { tijdslots, regnrs }) {
  const aanvraag = state.afspraakAanvragen.find((a) => a.id === aanvraagId);
  if (!aanvraag) return false;
  state.aanvraagStatusBezigId = aanvraagId;
  delete state.aanvraagFouten[aanvraagId];
  render();
  try {
    const data = await afspraakplannerFetch(`/aanvragen.php?id=${encodeURIComponent(aanvraagId)}`, {
      method: "PATCH",
      body: JSON.stringify({ tijdslots: tijdslots || [], regnrs: regnrs || [] }),
    });
    (data.deelnemers || []).forEach((d) => {
      aanvraag.deelnemers = [...(aanvraag.deelnemers || []), { regnr: d.regnr, link: d.link }];
    });
    await veiligOpslaan(bewaarGegevens, "aanvraag uitbreiden");
  } catch (e) {
    state.aanvraagFouten[aanvraagId] = e.message;
    state.aanvraagStatusBezigId = null;
    render();
    return false;
  }
  state.aanvraagStatusBezigId = null;
  await vernieuwAanvraagStatus(aanvraagId);
  return true;
}

async function voegTijdslotToeAanAanvraag(aanvraagId) {
  const draft = state.aanvraagSlotDraft[aanvraagId] || {};
  if (!draft.datum || !draft.start) {
    state.aanvraagFouten[aanvraagId] = "Vul een datum en starttijd in voor het nieuwe tijdslot.";
    render();
    return;
  }
  const gelukt = await breidAanvraagUit(aanvraagId, {
    tijdslots: [{ start: `${draft.datum} ${draft.start}:00`, eind: draft.eind ? `${draft.datum} ${draft.eind}:00` : null }],
  });
  if (gelukt) { delete state.aanvraagSlotDraft[aanvraagId]; render(); }
}

async function voegGezinToeAanAanvraag(aanvraagId) {
  const gezinsKey = state.aanvraagGezinDraft[aanvraagId];
  const gezin = gezinsKey ? findGezin(gezinsKey) : null;
  if (!gezin) {
    state.aanvraagFouten[aanvraagId] = "Kies eerst een gezin om toe te voegen.";
    render();
    return;
  }
  const gelukt = await breidAanvraagUit(aanvraagId, { regnrs: [gezin.gezinshoofd.regnr] });
  if (gelukt) { delete state.aanvraagGezinDraft[aanvraagId]; render(); }
}

// Mail/WhatsApp-knoppen om een uitnodigingslink (opnieuw) te versturen, met het
// tijdslot-sjabloon — zowel in het resultaatscherm als bij Lopende aanvragen.
function uitnodigingsKnoppenHTML(regnr, link) {
  const p = findPersoon(regnr);
  const sjabloon = haalAfspraakSjabloon(state.afspraakplannerSjabloonId);
  const aanhef = p ? (p.roepnaam || p.naam || "") : "";
  const ingevuld = pasAfspraakSjabloonToe(sjabloon, aanhef);
  const tekst = vulSjabloonIn(ingevuld.tekst, "", "", link);
  const mobielClean = p && p.mobiel ? String(p.mobiel).replace(/[^0-9+]/g, "").replace(/^0/, "31") : "";
  const knoppen = [
    p && p.email ? `<a class="btn btn-sm" href="${mailUrl(p.email, ingevuld.onderwerp, tekst)}" target="_blank" rel="noopener">Mail</a>` : "",
    mobielClean ? `<a class="btn btn-sm" href="https://wa.me/${mobielClean}?text=${encodeURIComponent(tekst)}" target="_blank" rel="noopener">WhatsApp</a>` : "",
  ].filter(Boolean).join("");
  return knoppen || `<span style="font-size:11.5px;color:var(--text-soft);">geen e-mail/mobiel bekend</span>`;
}

// Voor de badge op de gezinskaarten: doet dit gezin mee in een bewaarde aanvraag, en
// heeft het al gekozen? De nieuwste aanvraag met dit gezin telt.
function afspraakplannerInfoVoorGezin(gezin) {
  const regnr = gezin.gezinshoofd.regnr;
  const aanvragen = state.afspraakAanvragen.slice().sort((a, b) => (b.id || 0) - (a.id || 0));
  for (const a of aanvragen) {
    if (!(a.deelnemers || []).some((d) => d.regnr === regnr)) continue;
    const sd = a.status && (a.status.deelnemers || []).find((s) => s.regnr === regnr);
    if (sd && sd.gekozen_slot_id) {
      const slot = (a.status.tijdslots || []).find((t) => t.id === sd.gekozen_slot_id);
      return { gekozen: true, tekst: slot ? fmtSlotTijd(slot.start_tijd, slot.eind_tijd) : "tijdslot gekozen" };
    }
    return { gekozen: false };
  }
  return null;
}

function afspraakBadgeHTML(gezin) {
  const info = afspraakplannerInfoVoorGezin(gezin);
  if (!info) return "";
  if (info.gekozen) {
    return `<span class="tag-afspraak tag-afspraak-gekozen" title="Dit gezin heeft via AfspraakPlanner een tijdslot gekozen">✓ gekozen: ${esc(info.tekst)}</span>`;
  }
  return `<span class="tag-afspraak" title="Er staat een AfspraakPlanner-aanvraag uit voor dit gezin; vernieuw de status via Lopende aanvragen">⏳ aanvraag uitgezet</span>`;
}

const SLOT_STATUS_META = {
  vrij: { label: "vrij", kleur: "var(--green)", bg: "var(--green-bg)" },
  bezet: { label: "bezet", kleur: "var(--blue)", bg: "var(--blue-bg)" },
  ingetrokken: { label: "ingetrokken", kleur: "var(--text-soft)", bg: "var(--grey-bg)" },
  verlopen: { label: "verlopen", kleur: "var(--amber)", bg: "var(--amber-bg)" },
};

function aanvraagKaartHTML(a) {
  const bezig = state.aanvraagStatusBezigId === a.id;
  const fout = state.aanvraagFouten[a.id];
  let statusHTML = "";
  if (a.status) {
    const statusDeelnemers = a.status.deelnemers || [];
    const gekozenAantal = statusDeelnemers.filter((d) => d.gekozen_slot_id).length;
    const deelnemerRijen = (a.deelnemers || []).map((d) => {
      const sd = statusDeelnemers.find((s) => s.regnr === d.regnr);
      const slot = sd && sd.gekozen_slot_id ? (a.status.tijdslots || []).find((t) => t.id === sd.gekozen_slot_id) : null;
      const overgenomen = (a.overgenomen || {})[d.regnr];
      return `
        <div class="aanvraag-deelnemer">
          <span class="aanvraag-deelnemer-naam" data-open-regnr="${esc(d.regnr)}">${esc(naamVoorRegnr(d.regnr))}</span>
          ${slot ? `
            <span class="aanvraag-slot mono">✓ ${esc(fmtSlotTijd(slot.start_tijd, slot.eind_tijd))}</span>
            ${overgenomen
              ? `<span class="tag-grey" title="Deze afspraak staat als gepland bijzonder contactmoment in het gezinsdossier">✓ in planning</span>`
              : `<button class="btn-sm btn-primary" data-overneem-aanvraag="${esc(a.id)}" data-overneem-regnr="${esc(d.regnr)}">Zet in planning</button>`}
          ` : `
            <span class="aanvraag-nog-niet">nog niet gekozen</span>
            <span style="display:flex;gap:4px;">${uitnodigingsKnoppenHTML(d.regnr, d.link)}</span>
          `}
        </div>`;
    }).join("");
    const slotRijen = (a.status.tijdslots || []).map((t) => {
      const meta = SLOT_STATUS_META[t.status] || SLOT_STATUS_META.vrij;
      return `
        <div class="aanvraag-tijdslot">
          <span class="mono" style="flex:1;">${esc(fmtSlotTijd(t.start_tijd, t.eind_tijd))}</span>
          <span class="tag-opmerking" style="background:${meta.bg};color:${meta.kleur};margin:0;">${meta.label}${t.status === "bezet" && t.regnr ? `: ${esc(naamVoorRegnr(t.regnr))}` : ""}</span>
          ${t.status === "vrij" ? `<button class="btn-ghost btn-sm btn-danger" data-slot-intrek-aanvraag="${esc(a.id)}" data-slot-intrek-id="${esc(t.id)}" title="Tijdslot intrekken" ${bezig ? "disabled" : ""}>Intrekken</button>` : ""}
        </div>`;
    }).join("");
    statusHTML = `
      <p style="font-size:12.5px;color:var(--text-soft);margin:8px 0 6px;">
        ${gekozenAantal} van ${(a.deelnemers || []).length} gezinnen ${gekozenAantal === 1 ? "heeft" : "hebben"} gekozen
        · status van ${esc(fmtRelatiefMoment(a.laatstVernieuwdOp))}
      </p>
      ${deelnemerRijen}
      <div class="aanvraag-subkop">Tijdslots</div>
      ${slotRijen || `<p style="font-size:12.5px;color:var(--text-soft);">Geen tijdslots.</p>`}`;
  } else {
    statusHTML = `<p style="font-size:12.5px;color:var(--text-soft);margin:8px 0 0;">
      ${(a.deelnemers || []).length} uitnodiging(en) verstuurd. Klik op "Status vernieuwen" om te zien wie al een tijdslot gekozen heeft.
    </p>`;
  }

  const slotDraft = state.aanvraagSlotDraft[a.id] || { datum: "", start: "19:00", eind: "" };
  const gezinnenInAanvraag = new Set((a.deelnemers || []).map((d) => d.regnr));
  const kandidaten = computeGezinnen()
    .filter((g) => !gezinnenInAanvraag.has(g.gezinshoofd.regnr))
    .sort((x, y) => (x.gezinshoofd.naam || "").localeCompare(y.gezinshoofd.naam || ""));
  const uitbreidenHTML = `
    <div class="aanvraag-subkop">Uitbreiden</div>
    <div class="aanvraag-uitbreiden-rij">
      <input type="date" data-aanvraag-slotdraft="${esc(a.id)}" data-slotdraft-veld="datum" value="${esc(slotDraft.datum)}" />
      <input type="time" data-aanvraag-slotdraft="${esc(a.id)}" data-slotdraft-veld="start" value="${esc(slotDraft.start)}" />
      <input type="time" data-aanvraag-slotdraft="${esc(a.id)}" data-slotdraft-veld="eind" value="${esc(slotDraft.eind)}" title="Eindtijd (optioneel)" />
      <button class="btn-sm" data-slot-toevoegen="${esc(a.id)}" ${bezig ? "disabled" : ""}>+ Tijdslot</button>
    </div>
    <div class="aanvraag-uitbreiden-rij">
      <select data-aanvraag-gezindraft="${esc(a.id)}" style="flex:1;min-width:0;">
        <option value="">— kies een gezin —</option>
        ${kandidaten.map((g) => `<option value="${esc(g.gezinsKey)}" ${state.aanvraagGezinDraft[a.id] === g.gezinsKey ? "selected" : ""}>${esc(g.gezinshoofd.naam || "Naamloos")}${g.adres ? ` (${esc(g.adres)})` : ""}</option>`).join("")}
      </select>
      <button class="btn-sm" data-gezin-toevoegen="${esc(a.id)}" ${bezig ? "disabled" : ""}>+ Gezin</button>
    </div>`;

  return `
    <div class="aanvraag-kaart">
      <div class="aanvraag-kaart-kop">
        <div>
          <strong>${esc(a.omschrijving || `Aanvraag #${a.id}`)}</strong>
          <div style="font-size:11.5px;color:var(--text-soft);">Uitgezet op ${esc(fmtDatum(a.aangemaaktOp))}</div>
        </div>
        <span style="display:flex;gap:6px;">
          <button class="btn-sm" data-aanvraag-vernieuw="${esc(a.id)}" ${bezig ? "disabled" : ""}>${bezig ? "Bezig…" : "Status vernieuwen"}</button>
          <button class="btn-ghost btn-sm btn-danger" data-aanvraag-verwijder="${esc(a.id)}" title="Verwijder uit dit overzicht">✕</button>
        </span>
      </div>
      ${fout ? `<p style="color:var(--red);font-size:12.5px;margin:8px 0 0;">${esc(fout)}</p>` : ""}
      ${statusHTML}
      ${uitbreidenHTML}
    </div>`;
}

function aanvragenOverzichtModalHTML() {
  if (!state.aanvragenOverzichtOpen) return "";
  const aanvragen = state.afspraakAanvragen.slice().sort((a, b) => (b.id || 0) - (a.id || 0));
  return `
  <div class="modal-overlay" id="aanvragenOverlay">
    <div class="modal-box" style="max-width:620px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <h3 style="margin:0;font-size:18px;">Lopende aanvragen</h3>
        <button class="btn-ghost btn-sm" id="btnSluitAanvragen">✕</button>
      </div>
      <p style="font-size:12.5px;color:var(--text-soft);margin:0 0 12px;">
        Alle aanvragen die je via AfspraakPlanner hebt uitgezet. Vernieuw de status om te zien wie al
        een tijdslot gekozen heeft, en zet een gekozen afspraak met één klik in de planning van het gezin.
      </p>
      ${aanvragen.length === 0
        ? `<div class="empty-state">Nog geen lopende aanvragen. Klik in de Planningweergave op "Selecteren", kies gezinnen en klik op "Aanvraag uitzetten".</div>`
        : aanvragen.map(aanvraagKaartHTML).join("")}
    </div>
  </div>`;
}

// Bouwt de mail-URL volgens de gekozen methode (Instellingen → E-mail): het standaard
// mailprogramma via mailto:, of een kant-en-klaar compose-venster in Outlook op het web.
function mailUrl(email, onderwerp, tekst) {
  if (state.mailMethode === "outlook") {
    const params = new URLSearchParams({ to: email, subject: onderwerp || "" });
    if (tekst) params.set("body", tekst);
    return `https://outlook.office.com/mail/deeplink/compose?${params.toString()}`;
  }
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(onderwerp || "")}${tekst ? `&body=${encodeURIComponent(tekst)}` : ""}`;
}

function aanhefVoorGezin(gezinsKey) {
  const gezin = findGezin(gezinsKey);
  return (gezin && (gezin.gezinshoofd.roepnaam || gezin.gezinshoofd.naam)) || "";
}

function openAfspraakMail(gezinsKey) {
  const gezin = findGezin(gezinsKey);
  if (!gezin || !gezin.gezinshoofd.email) { alert("Voor dit gezinshoofd is geen e-mailadres bekend."); return; }
  const datum = document.getElementById("afspraakDatum").value;
  const tijd = document.getElementById("afspraakTijd").value;
  const onderwerp = document.getElementById("afspraakOnderwerp").value || "Huisbezoek inplannen";
  const tekst = vulSjabloonIn(document.getElementById("afspraakTekst").value, datum, tijd);
  const url = mailUrl(gezin.gezinshoofd.email, onderwerp, tekst);
  // Outlook op het web is een gewone pagina — in hetzelfde tabblad zou de app zelf verdwijnen.
  if (state.mailMethode === "outlook") window.open(url, "_blank");
  else window.location.href = url;
}

function openAfspraakWhatsapp(gezinsKey) {
  const gezin = findGezin(gezinsKey);
  if (!gezin || !gezin.gezinshoofd.mobiel) { alert("Voor dit gezinshoofd is geen mobiel nummer bekend."); return; }
  const datum = document.getElementById("afspraakDatum").value;
  const tijd = document.getElementById("afspraakTijd").value;
  const tekst = vulSjabloonIn(document.getElementById("afspraakTekst").value, datum, tijd);
  const mobiel = String(gezin.gezinshoofd.mobiel).replace(/[^0-9+]/g, "").replace(/^0/, "31");
  window.open(`https://wa.me/${mobiel}?text=${encodeURIComponent(tekst)}`, "_blank");
}

let autoVergrendelTimer = null;

function plantAutoVergrendel(overMs) {
  if (autoVergrendelTimer) clearTimeout(autoVergrendelTimer);
  autoVergrendelTimer = setTimeout(() => {
    cryptoRuntime.sleutel = null;
    dbDeleteInstelling("sessieSleutel").catch((e) => logDebug("fout", "Kon sessiesleutel niet verwijderen: " + e.message));
    state.vergrendeld = true;
    state.lockMode = "invoeren";
    state.pinFout = "";
    render();
  }, Math.max(0, overMs));
}

const PRIVACY_MELDING_HTML = `
  <div class="privacy-notice">
    <span class="privacy-icoon">\u{1F512}</span>
    <span><strong>Privacy is belangrijk.</strong> Deze applicatie verwerkt uw gegevens niet online en
    verstuurt niets naar internet. Alle gegevens blijven lokaal op uw computer en worden daar
    versleuteld opgeslagen (AES-256, sleutel afgeleid van uw pin).</span>
  </div>`;

function lockScreenHTML() {
  if (state.lockMode === "instellen") {
    return `
    <div class="upload-wrap">
      <div class="upload-card">
        <img class="upload-logo" src="icons/icon-192.png" alt="ContactPlanner" />
        <div class="upload-title">Stel een pin in</div>
        <p class="upload-desc">
          Deze contactplanner bevat gevoelige pastorale gegevens. Stel een pin in (minimaal 4 tekens) om
          toegang te beveiligen; de gegevens worden bovendien met deze pin versleuteld opgeslagen.
          Na het invoeren heb je \u00e9\u00e9n uur toegang; daarna is de pin opnieuw nodig.
          Vergeet je de pin, dan is de enige weg terug alle lokale gegevens wissen en je back-up (.json)
          terugzetten \u2014 zorg dus dat je die hebt.
        </p>
        ${PRIVACY_MELDING_HTML}
        <div class="field-row"><label>Nieuwe pin</label><input type="password" id="pinNieuw1" autocomplete="off" /></div>
        <div class="field-row"><label>Herhaal pin</label><input type="password" id="pinNieuw2" autocomplete="off" /></div>
        ${state.pinFout ? `<p style="color:var(--red);font-size:13px;">${esc(state.pinFout)}</p>` : ""}
        <button class="btn-primary" id="btnPinInstellen">Pin instellen en beginnen</button>
      </div>
    </div>`;
  }
  return `
    <div class="upload-wrap">
      <div class="upload-card">
        <img class="upload-logo" src="icons/icon-192.png" alt="ContactPlanner" />
        <div class="upload-title">Vergrendeld</div>
        <p class="upload-desc">Voer je pin in om verder te gaan. Na het invoeren heb je weer \u00e9\u00e9n uur toegang.</p>
        ${PRIVACY_MELDING_HTML}
        <div class="field-row"><label>Pin</label><input type="password" id="pinInvoer" autocomplete="off" /></div>
        ${state.pinFout ? `<p style="color:var(--red);font-size:13px;">${esc(state.pinFout)}</p>` : ""}
        <button class="btn-primary" id="btnPinInvoeren">Ontgrendelen</button>
        <div style="margin-top:14px;display:flex;flex-direction:column;gap:6px;">
          <button class="btn-ghost" id="btnMijlpalenZonderPin" style="font-size:12.5px;">Bekijk bijzondere momenten zonder te ontgrendelen${heeftDringendeMijlpaal(true) ? ` <span class="dringend-dot" title="Er is binnen 14 dagen een bijzonder moment"></span>` : ""}</button>
          <button class="btn-ghost" id="btnPinVergeten" style="font-size:12.5px;">Pin vergeten? Alle lokale gegevens wissen</button>
        </div>
      </div>
    </div>`;
}

function attachLockEvents() {
  const $ = (sel) => document.querySelector(sel);
  if ($("#btnPinInstellen")) $("#btnPinInstellen").addEventListener("click", async () => {
    const p1 = $("#pinNieuw1").value, p2 = $("#pinNieuw2").value;
    if (p1.length < 4) { state.pinFout = "De pin moet minimaal 4 tekens lang zijn."; render(); return; }
    if (p1 !== p2) { state.pinFout = "De twee pins komen niet overeen."; render(); return; }
    try {
      if (versleutelingBeschikbaar()) {
        await activeerVersleuteling(p1);
      } else {
        const hash = await veiligeHash(p1);
        await dbSetInstelling("pinHash", hash);
        state.pinHash = hash;
      }
      await naOntgrendeling();
    } catch (e) {
      logDebug("fout", "Pin instellen mislukt: " + e.message, { stack: e.stack });
      state.pinFout = "Pin instellen is niet gelukt. Probeer het opnieuw of kijk bij Debug.";
    }
    render();
  });

  if ($("#btnPinInvoeren")) $("#btnPinInvoeren").addEventListener("click", async () => {
    const p = $("#pinInvoer").value;
    try {
      if (await ontgrendelMetPin(p)) {
        await naOntgrendeling();
      } else {
        state.pinFout = "Onjuiste pin. Probeer het opnieuw.";
      }
    } catch (e) {
      logDebug("fout", "Ontgrendelen mislukt: " + e.message, { stack: e.stack });
      state.pinFout = "Ontgrendelen is niet gelukt. Probeer het opnieuw of kijk bij Debug.";
    }
    render();
  });
  if ($("#pinInvoer")) $("#pinInvoer").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#btnPinInvoeren").click(); });
  if ($("#pinNieuw2")) $("#pinNieuw2").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#btnPinInstellen").click(); });
  if ($("#btnMijlpalenZonderPin")) $("#btnMijlpalenZonderPin").addEventListener("click", () => {
    state.mijlpalenZonderPin = true;
    render();
  });

  if ($("#btnPinVergeten")) $("#btnPinVergeten").addEventListener("click", async () => {
    if (!confirm("Dit wist ALLE lokale gegevens (gezinnen, contactmomenten, notities, instellingen) definitief van deze computer. Dit kan niet ongedaan worden gemaakt. Weet je dit zeker?")) return;
    if (!confirm("Heel zeker? Alleen doorgaan als je geen bruikbare back-up hebt, of bewust opnieuw wilt beginnen.")) return;
    await dbClearAll(STORE_PERSONEN);
    await dbClearAll(STORE_GEZINSDATA);
    await dbClearAll(STORE_INSTELLINGEN);
    await dbClearAll(STORE_KLUIS);
    cryptoRuntime.sleutel = null;
    state.personen = [];
    state.gezinsdata = {};
    state.mijlpalenGedaan = {};
    state.mijlpalenCache = [];
    state.pinHash = null;
    state.pinZout = null;
    state.pinIteraties = null;
    state.sleutelCheck = null;
    state.pinFout = "";
    state.lockMode = "instellen";
    state.stage = "upload";
    render();
  });
}

async function pinWijzigen() {
  const huidige = prompt("Voer je huidige pin in:");
  if (huidige === null) return;
  let klopt = false;
  if (versleutelingBeschikbaar() && state.sleutelCheck) {
    try {
      await ontsleutelJSON(await afleidenSleutel(huidige, b64NaarBytes(state.pinZout), state.pinIteraties), state.sleutelCheck);
      klopt = true;
    } catch (e) { /* onjuiste pin */ }
  } else {
    klopt = (await veiligeHash(huidige)) === state.pinHash || eenvoudigeHashOud(huidige) === state.pinHash;
  }
  if (!klopt) { alert("Onjuiste huidige pin."); return; }
  const nieuw1 = prompt("Nieuwe pin (minimaal 4 tekens):");
  if (nieuw1 === null) return;
  if (nieuw1.length < 4) { alert("De pin moet minimaal 4 tekens lang zijn."); return; }
  const nieuw2 = prompt("Herhaal de nieuwe pin:");
  if (nieuw2 === null) return;
  if (nieuw1 !== nieuw2) { alert("De twee pins komen niet overeen."); return; }
  if (versleutelingBeschikbaar()) {
    // Nieuw zout + nieuwe sleutel; de gegevens worden direct herversleuteld.
    if (!await veiligOpslaan(() => activeerVersleuteling(nieuw1), "pin wijzigen")) return;
  } else {
    const hash = await veiligeHash(nieuw1);
    state.pinHash = hash;
    if (!await veiligOpslaan(() => dbSetInstelling("pinHash", hash), "pin wijzigen")) return;
  }
  alert("Pin gewijzigd.");
}

function vergrendelNu() {
  if (autoVergrendelTimer) clearTimeout(autoVergrendelTimer);
  cryptoRuntime.sleutel = null;
  dbSetInstelling("ontgrendeldTot", 0).catch((e) => logDebug("fout", "Kon vergrendel-tijdstip niet opslaan: " + e.message));
  dbDeleteInstelling("sessieSleutel").catch((e) => logDebug("fout", "Kon sessiesleutel niet verwijderen: " + e.message));
  state.vergrendeld = true;
  state.lockMode = "invoeren";
  state.pinFout = "";
  render();
}

// ---------------- init ----------------

(async function init() {
  if (!window.indexedDB) {
    logDebug("fout", "IndexedDB is niet beschikbaar in deze browser/omgeving.");
    toonFoutBanner("Deze browser staat geen lokale opslag toe. Wijzigingen kunnen NIET bewaard worden \u2014 probeer een andere browser (Edge of Chrome) of browserinstelling.");
    state.stage = "upload";
    state.vergrendeld = false;
    render();
    return;
  }
  try {
    const instellingenLijst = await dbGetAll(STORE_INSTELLINGEN);
    const instellingenMap = {};
    instellingenLijst.forEach((r) => { instellingenMap[r.sleutel] = r.waarde; });

    state.pinHash = instellingenMap.pinHash || null;
    state.pinZout = instellingenMap.pinZout || null;
    state.pinIteraties = instellingenMap.pinIteraties || PBKDF2_ITERATIES;
    state.sleutelCheck = instellingenMap.sleutelCheck || null;
    if (Array.isArray(instellingenMap.mijlpalenCache)) state.mijlpalenCache = instellingenMap.mijlpalenCache;
    if (typeof instellingenMap.mijlpalenLeeftijdDrempel === "number") state.mijlpalenLeeftijdDrempel = instellingenMap.mijlpalenLeeftijdDrempel;
    if (Array.isArray(instellingenMap.mijlpalenHuwelijksJaren)) state.mijlpalenHuwelijksJaren = instellingenMap.mijlpalenHuwelijksJaren;
    if (typeof instellingenMap.laatsteWijzigingOp === "number") state.laatsteWijzigingOp = instellingenMap.laatsteWijzigingOp;
    if (typeof instellingenMap.laatsteBackupOp === "number") state.laatsteBackupOp = instellingenMap.laatsteBackupOp;
    if (typeof instellingenMap.schemaAutoLeeftijd === "number") state.schemaAutoLeeftijd = instellingenMap.schemaAutoLeeftijd;
    ["schemaAutoJong", "schemaAutoStel", "schemaAutoAlleen"].forEach((sleutel) => {
      if (typeof instellingenMap[sleutel] === "string" && instellingenMap[sleutel]) state[sleutel] = instellingenMap[sleutel];
    });
    if (Array.isArray(instellingenMap.afspraakSjablonen) && instellingenMap.afspraakSjablonen.length) state.afspraakSjablonen = instellingenMap.afspraakSjablonen;
    if (typeof instellingenMap.afspraakSjabloonId === "string") state.afspraakSjabloonId = instellingenMap.afspraakSjabloonId;
    if (instellingenMap.mailMethode === "mailto" || instellingenMap.mailMethode === "outlook") state.mailMethode = instellingenMap.mailMethode;
    if (instellingenMap.backupOpslagMethode === "download" || instellingenMap.backupOpslagMethode === "opslaanAls") state.backupOpslagMethode = instellingenMap.backupOpslagMethode;
    if (typeof instellingenMap.afspraakplannerApiSleutel === "string") state.afspraakplannerApiSleutel = instellingenMap.afspraakplannerApiSleutel;
    if (typeof instellingenMap.afspraakplannerBasisUrl === "string" && instellingenMap.afspraakplannerBasisUrl) state.afspraakplannerBasisUrl = instellingenMap.afspraakplannerBasisUrl;
    // Alleen relevant in de kluis-loze (Web Crypto-loze) situatie; met kluis overschrijft laadUitKluis dit.
    if (Array.isArray(instellingenMap.afspraakAanvragen)) state.afspraakAanvragen = instellingenMap.afspraakAanvragen;
    if (!state.afspraakSjablonen.some((s) => s.id === STANDAARD_TIJDSLOT_SJABLOON.id)) {
      state.afspraakSjablonen.push({ ...STANDAARD_TIJDSLOT_SJABLOON });
    }
    Object.keys(instellingenMap).forEach((sleutel) => {
      if (sleutel.startsWith("mijlpaal-gedaan:")) state.mijlpalenGedaan[sleutel.slice("mijlpaal-gedaan:".length)] = instellingenMap[sleutel];
    });

    const nu = Date.now();
    const ontgrendeldTot = instellingenMap.ontgrendeldTot || 0;

    if (versleutelingBeschikbaar() && state.sleutelCheck) {
      // Versleutelde modus: de gegevens worden pas geladen na ontgrendeling.
      state.vergrendeld = true;
      state.lockMode = "invoeren";
      if (ontgrendeldTot > nu && instellingenMap.sessieSleutel) {
        // Binnen het ontgrendelde uur herladen: sessiesleutel gebruiken, geen pin nodig.
        try {
          await ontsleutelJSON(instellingenMap.sessieSleutel, state.sleutelCheck);
          cryptoRuntime.sleutel = instellingenMap.sessieSleutel;
          await laadUitKluis();
          state.vergrendeld = false;
          plantAutoVergrendel(ontgrendeldTot - nu);
        } catch (e) {
          cryptoRuntime.sleutel = null;
          logDebug("fout", "Bewaarde sessiesleutel is onbruikbaar; de pin is opnieuw nodig: " + e.message);
        }
      } else if (instellingenMap.sessieSleutel) {
        dbDeleteInstelling("sessieSleutel").catch(() => {});
      }
    } else {
      // Onversleutelde situatie: oude gegevens (nog te migreren bij de eerstvolgende
      // pin-invoer) of een browser zonder Web Crypto.
      if (state.sleutelCheck && !versleutelingBeschikbaar()) {
        toonFoutBanner("De gegevens zijn versleuteld opgeslagen, maar deze browser ondersteunt de benodigde versleuteling niet. Open de app in een actuele browser (Chrome, Edge, Firefox of Safari).");
      }
      const personen = await dbGetAll(STORE_PERSONEN);
      const gezinsdataLijst = await dbGetAll(STORE_GEZINSDATA);
      state.personen = personen;
      gezinsdataLijst.forEach((g) => { state.gezinsdata[g.gezinsKey] = g; });
      migreerOudeContactgegevens();
      herstelLaatsteContactAlleGezinnen();
      state.stage = personen.length ? "dashboard" : "upload";
      if (state.stage === "dashboard") {
        controleerNieuweVersie().catch((e) => logDebug("fout", "Kon versie niet controleren: " + e.message));
      }

      if (!state.pinHash && !state.sleutelCheck) {
        state.vergrendeld = true;
        state.lockMode = "instellen";
      } else if (ontgrendeldTot > nu) {
        state.vergrendeld = false;
        plantAutoVergrendel(ontgrendeldTot - nu);
      } else {
        state.vergrendeld = true;
        state.lockMode = "invoeren";
      }
    }
  } catch (e) {
    logDebug("fout", "Kon lokale gegevens niet laden: " + e.message);
    toonFoutBanner("Kon lokale opslag niet openen. Wijzigingen kunnen mogelijk niet bewaard worden \u2014 klik op 'Debug' voor details.");
    state.stage = "upload";
    state.vergrendeld = false;
  }
  render();
})();

// ---------------- service worker (offline gebruik) ----------------

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js")
      .then(() => logDebug("info", "Service worker geregistreerd — de app werkt ook offline"))
      .catch((e) => logDebug("fout", "Service worker registreren mislukt: " + e.message));
  });
}

