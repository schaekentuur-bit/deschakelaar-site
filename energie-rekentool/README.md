# Energie-rekentool (intern)

Interne rekentool om per klant door te rekenen of overstappen naar een dynamisch
energiecontract financieel gunstig is, op basis van kwartierverbruik (HomeWizard
P1-export). Nog niet gepubliceerd, geen toegangsbeveiliging, geen koppeling met
de rest van de site.

## Architectuur

- `src/core/` — pure functies: data in, data uit. Geen `fs`, geen netwerk, geen
  Node-specifieke imports. Draait ongewijzigd in Node of straks in een browser.
- `src/cli/` — dunne schil die bestanden leest/schrijft en de EnergyZero-API
  bevraagt; roept alleen `core/` aan voor de daadwerkelijke logica.

## Bekende beperking: geen kwartierprijzen beschikbaar (niet opgelost)

Sinds 1 oktober 2025 werkt de Nederlandse day-ahead-markt op kwartierbasis (96
prijzen/dag i.p.v. 24). Twee publieke prijsbronnen zijn hierop getest, beide
**mislukt**:

**EnergyZero** (`https://api.energyzero.nl/v1/energyprices`, geen API-key nodig)
- `interval=3` (kwartier) geeft een lege `Prices`-array, getest op 1 oktober
  2025, november 2025, en augustus 2026.
- `interval=4` (uur) werkt betrouwbaar, historie getest terug tot 2019.
- Community-issues rond okt–dec 2025 bevestigen dat dit geen lokaal probleem is:
  [home-assistant/home-assistant.io#41185](https://github.com/home-assistant/home-assistant.io/issues/41185).

**Frank Energie** (`https://frank-graphql-prod.graphcdn.app/`, query
`marketPricesElectricity` uit
[python-frank-energie](https://github.com/DCSBL/python-frank-energie/blob/main/python_frank_energie/frank_energie.py#L1035),
ook de basis van de officiële Home Assistant-integratie)
- Live getest op 2 oktober 2025 én 10 augustus 2026: in beide gevallen 24
  punten per dag, elk `from`→`till` precies 1 uur. Geen kwartierdata.

**Conclusie**: de tool gebruikt EnergyZero-uurprijzen als enige automatische
bron. Elke uurprijs wordt herhaald toegepast op alle kwartieren binnen dat uur
— dit is een benadering, geen echte kwartierprijs. Dit staat expliciet
gelabeld in de code (`src/cli/lib/energyZeroClient.js`,
`src/core/priceCoverage.js`) en in elke CLI-uitvoer (`⚠ BEKENDE BEPERKING`-
regel). Mocht er ooit een betrouwbare kwartierbron verschijnen, dan is dit de
plek om opnieuw te testen — niet opnieuw vanaf nul uitzoeken.

Eigen kwartierprijzen aanleveren kan altijd via `--prices <bestand.csv>` met
kolommen `timestamp,price_eur_kwh` (zie `src/core/priceCsv.js`), als fallback
op EnergyZero of wanneer je een betere bron hebt.

## Openstaande blocker: DST-disambiguatie nog niet gevalideerd tegen echte data

De matching van intervallen aan prijzen is epoch-gebaseerd en de tijdzone-
conversie disambigueert het herhaalde najaarsuur (bv. twee keer "02:15")
correct — geverifieerd met een deterministische unit-test
(`test/priceMatching.test.js`) én live tegen echte EnergyZero-historie voor het
jaar-fixture (`test/fixtureGenerator.test.js`, `fixtures/synthetisch-1-jaar.csv`).

Dit is echter alleen bevestigd tegen de **synthetische** fixture, die zelf al
DST-correct is opgebouwd. Er is nog **geen validatie tegen een echte
HomeWizard-export die een DST-overgang beslaat** (de tot nu toe aangeleverde
klantexport was een week in juli, zonder overgang). Zodra zo'n bestand
beschikbaar is, moet dat alsnog gedraaid worden — dit is een reële blocker,
geen afgehandelde zaak.

## Gebruik

```bash
npm test                                          # 63 tests, node:test
npm run generate-fixture -- --out ... --days 365  # synthetische testfixture
npm run inspect -- <verbruik.csv>                 # datalaag-validatierapport
npm run match-prices -- <verbruik.csv>            # prijskoppeling + dekking
```

Echte klantbestanden horen in `klantdata/` (staat in `.gitignore`) of moeten
"homewizard" in de bestandsnaam bevatten — beide patronen sluiten ze uit van
git.
