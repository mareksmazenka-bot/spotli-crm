# Spotli CRM

Jednoduché CRM pre freelance prácu: lokálne SEO, Google Business Profil, LinkedIn, správa webov aj tvorba web aplikácií. Beží celé v prehliadači, bez servera, bez databázy a bez inštalácie.

## Čo appka vie

- **Prehľad**: zárobok za mesiac, porovnanie s minulým mesiacom, graf za 12 mesiacov, hodiny, priemerná hodinovka, koľko ešte nie je vyfakturované, rozpis podľa klientov a služieb, najbližšie úlohy.
- **Klienti**: každý klient má kartu so službami a cenami, prácou za mesiac, faktúrou a zárobkom od začiatku spolupráce.
- **Denník**: zápis práce (dátum, služba, čo si robil, hodiny). Pri hodinovke sa suma dopočíta sama. Hodiny sa dajú písať aj ako `1,5` alebo `1:30`.
- **Report pre klienta**: mesačný report s logom Spotli. Dá sa vytlačiť, uložiť ako PDF alebo skopírovať ako text do e-mailu. Hodiny aj sumy sa dajú skryť.
- **Plánovanie**: kanban (Naplánované → Rozbehnuté → Hotové) s termínmi a upozornením na úlohy po termíne.
- **PIN zámok**: appka sa zamkne pri novom otvorení a po 30 minútach nečinnosti.

### Ako sa počíta zárobok

| Služba | Ako sa počíta |
|---|---|
| **Na hodinu** | hodiny × sadzba. Sadzba sa pri zápise uloží, takže neskoršie zvýšenie sadzby nezmení staré mesiace. |
| **Za dielo** | hodiny sa evidujú, cena sa započíta do mesiaca, v ktorom klikneš **Zákazka je hotová**. Na karte klienta uvidíš aj reálnu hodinovku (cena ÷ odpracované hodiny). |

## Nastavenie (raz, cca 10 minút)

Potrebuješ **dva repozitáre**: verejný pre appku a súkromný pre dáta.

> **Prečo dva?** GitHub Pages na bezplatnom účte funguje len z verejného repa a všetko v ňom je dostupné na internete. Keby boli dáta v tom istom repe, ktokoľvek by si prečítal mená klientov a tvoje zárobky. Appka preto **odmietne uložiť dáta do verejného repa**.

### 1. Repo s appkou (verejné)

1. Na GitHube vytvor nové repo, napr. `spotli-crm` (Public).
2. Nahraj doň **celý obsah tohto priečinka** vrátane priečinkov `css`, `js`, `fonts` a súboru `.nojekyll`. Najjednoduchšie cez **Add file → Upload files**, kam môžeš potiahnuť aj celé priečinky.
3. **Settings → Pages**: Source = *Deploy from a branch*, Branch = `main`, priečinok `/ (root)` → Save.
4. O minútu bude appka na adrese `https://<tvoj-nick>.github.io/spotli-crm/`.

### 2. Repo na dáta (súkromné)

1. Vytvor druhé repo, napr. `spotli-crm-data`, a zvoľ **Private**.
2. Zaškrtni **Add a README file**, aby repo malo vetvu `main`.
3. Viac netreba, súbor `data.json` vytvorí appka sama.

### 3. Token

1. GitHub → klik na profilovku → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Názov: `spotli-crm`. Platnosť: napr. 1 rok (po vypršaní ti appka povie, že treba nový).
3. **Repository access → Only select repositories →** vyber **iba** `spotli-crm-data`.
4. **Permissions → Repository permissions → Contents → Read and write**.
5. **Generate token** a skopíruj ho (zobrazí sa len raz).

### 4. Prepojenie

V appke choď do **Nastavenia**, vyplň token, svoj GitHub nick a názov repa (`spotli-crm-data`) a klikni **Uložiť a pripojiť**.

Odteraz sa každá zmena do pár sekúnd uloží do súkromného repa. Stav vidíš vľavo dole:

- zelená bodka: uložené,
- žltá: ukladá sa,
- červená: neuložené, prejdením myšou sa zobrazí dôvod a klikom to skúsiš znova.

Na inom počítači stačí otvoriť adresu appky, zadať PIN a v Nastaveniach vyplniť to isté. Dáta sa načítajú samy.

## Ochrana dát

- **Dáta** sú v súkromnom repe. K nim sa dostane len ten, kto má tvoj GitHub účet alebo token.
- **Token** sa ukladá len v prehliadači, v ktorom ho zadáš, a posiela sa výhradne na `api.github.com`.
- **PIN** chráni appku pred náhodným pohľadom (napr. keď necháš otvorený notebook). V kóde nie je, je tam len jeho odtlačok. Zmeniť ho môžeš v **Nastavenia → PIN** (platí pre daný prehliadač). PIN nie je šifrovanie: kto má prístup k tvojmu počítaču a vývojárskym nástrojom prehliadača, dostane sa k dátam aj bez neho.
- **Neodoslané zmeny sa nestratia.** Keď vypadne internet alebo vyprší token, zmeny ostanú v prehliadači a odošlú sa neskôr. Ak sa dáta na GitHube medzitým zmenili na inom počítači, appka sa opýta, ktorú verziu ponechať, a druhú ti stiahne ako záložný súbor.

## Každodenné používanie

- **Zapísať prácu**: zelené tlačidlo vľavo hore alebo klávesa **N**. Appka si pamätá posledného klienta a službu.
- **Koniec mesiaca**: Prehľad → tabuľka *Klienti v mesiaci* → **Report** → *Vytlačiť / PDF* (v tlači zvoľ *Uložiť ako PDF*) → po odoslaní faktúry klikni **Nevyfakturované**, čím sa označí ako vyfakturované.
- **Zmazal si niečo omylom?** Hneď po zmazaní sa ukáže tlačidlo **Späť**.
- **Klient skončil?** Daj ho do archívu. Zmizne zo zoznamov, ale jeho zárobky ostanú v prehľadoch.

## Záloha

V **Nastavenia → Záloha** si môžeš kedykoľvek stiahnuť všetky dáta ako JSON alebo ich zo zálohy obnoviť. Celá história zmien je navyše v súkromnom repe (každé uloženie = commit).

## Ak si používal prvú verziu

Dáta z prvej verzie sa pri otvorení automaticky prevedú. Ak si v prvej verzii nastavil ukladanie do repa s appkou, **zmaž z neho súbor `data/data.json`**, lebo je verejný, a nastav súkromné repo podľa návodu vyššie.

## Technické poznámky

- Čisté HTML, CSS a JavaScript, bez knižníc a bez build kroku.
- Fonty: nadpisy používajú **Grift**, ak je nainštalovaný v počítači, inak **Sora**. Text je v **Inter**. Sora a Inter sú priložené v priečinku `fonts` (licencia SIL OFL), takže appka nič nesťahuje z Google Fonts.
- Ikony: [Lucide](https://lucide.dev) (licencia ISC).
- Farby podľa brand manuálu: Pale Teal `#35D0A6`, Timber Green `#142826`, Aqua Island `#A9DED0`, River Bed `#45504C`. V manuáli je pri Aqua Island a River Bed omylom uvedený HEX `#142826`. Správne hodnoty podľa RGB sú tieto.

```
index.html        štruktúra appky a PIN zámok
css/style.css     vzhľad (farby a fonty sú na začiatku v :root)
js/app.js         logika: dáta, výpočty, obrazovky, report, sync, PIN
js/icons.js       ikony
fonts/            Inter a Sora (woff2) + licencie
.nojekyll         aby GitHub Pages nič neupravoval
```
