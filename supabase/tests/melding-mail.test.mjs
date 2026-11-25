// De tekst van de meldingsmail (supabase/functions/melding-mail/mail.ts). Node leest het .ts-bestand zelf.
import { maakMail } from '../functions/melding-mail/mail.ts';

let ok = 0, fout = 0;
const check = (naam, voorwaarde, extra = '') => {
  if (voorwaarde) { ok++; console.log('  ok  ', naam); } else { fout++; console.log('  FOUT', naam, extra); }
};

const bug = maakMail({ soort: 'bug', tekst: 'De kaart blijft wit <b>na</b> inchecken', scherm: '390x844', apparaat: 'Testbrowser', op: '2026-11-21T09:50:00Z', naam: 'dorstige-zebra' }, true);
check('bericht: vast onderwerp', bug.onderwerp === 'Bierkoers: nieuw bericht', bug.onderwerp);
check('bericht: naam, tekst, schermgrootte en browser staan erin', ['dorstige-zebra stuurde een bericht', 'De kaart blijft wit <b>na</b> inchecken', 'Schermgrootte: 390x844', 'Browser: Testbrowser'].every((s) => bug.tekst.includes(s)), bug.tekst);
check('bug: tijd in Nederlandse tijd', bug.tekst.includes('10:50'), bug.tekst);
check('bericht: wijst naar Beheer, Berichten', bug.tekst.includes('Ik, Beheer, Berichten'), bug.tekst);
check('bericht: antwoorden kan in de app', bug.tekst.includes('Antwoord in de app'), bug.tekst);
check('bericht met e-mailadres: antwoorden kan ook via de mail', bug.tekst.includes('Beantwoord je deze mail'), bug.tekst);

const kaal = maakMail({ soort: 'bug', tekst: 'Alleen een tekst', scherm: null, apparaat: null, op: '2026-11-21T09:50:00Z', naam: null });
check('bug zonder gegevens: noemt "Een speler" en geen lege regels achter elkaar', kaal.tekst.startsWith('Een speler stuurde') && !kaal.tekst.includes('\n\n\n') && !kaal.tekst.includes('Browser:'), kaal.tekst);
check('bericht zonder e-mailadres: het antwoord staat alleen in de app', kaal.tekst.includes('alleen in de app') && !kaal.tekst.includes('Beantwoord je deze mail'), kaal.tekst);

const aanSpeler = maakMail({ soort: 'antwoord', tekst: 'Goed idee, we kijken ernaar.', op: '2026-11-22T09:50:00Z', van_beheer: true, naam: 'Eva', bericht: 'Kunnen jullie\nIJwit toevoegen?' });
check('antwoord aan de speler: eigen onderwerp', aanSpeler.onderwerp === 'Bierkoers: antwoord op je bericht', aanSpeler.onderwerp);
check('antwoord aan de speler: antwoord, geciteerd bericht en de weg in de app', aanSpeler.tekst.includes('Goed idee, we kijken ernaar.') && aanSpeler.tekst.includes('> Kunnen jullie\n> IJwit toevoegen?') && aanSpeler.tekst.includes('Ik, Jouw berichten'), aanSpeler.tekst);
check('antwoord aan de speler: noemt de naam van de beheerder niet', !aanSpeler.tekst.includes('Eva'), aanSpeler.tekst);
const aanBeheer = maakMail({ soort: 'antwoord', tekst: 'Dank! En Hertog Jan?', op: '2026-11-22T09:50:00Z', van_beheer: false, naam: 'dorstige-zebra', bericht: 'Kunnen jullie IJwit toevoegen?' });
check('reactie van de speler: naar de beheerder met naam en de weg in de app', aanBeheer.onderwerp === 'Bierkoers: nieuw antwoord in een gesprek' && aanBeheer.tekst.startsWith('dorstige-zebra antwoordde') && aanBeheer.tekst.includes('Ik, Beheer, Berichten'), aanBeheer.tekst);

const een = maakMail({ soort: 'stad', stad: 'Arnhem', op: '2026-11-21T09:50:00Z', naam: 'Rik', spelers: 1 });
check('stad: onderwerp met de stad', een.onderwerp === 'Bierkoers: stad aangevraagd, Arnhem', een.onderwerp);
check('stad: een speler', een.tekst.includes('Nu 1 speler vraagt erom.'), een.tekst);
const meer = maakMail({ soort: 'stad', stad: 'Arnhem', op: '2026-11-21T09:50:00Z', naam: 'Rik', spelers: 3 });
check('stad: meer spelers', meer.tekst.includes('Nu 3 spelers vragen erom.'), meer.tekst);
check('stad: wijst naar Beheer, Stadsaanvragen', meer.tekst.includes('Ik, Beheer, Stadsaanvragen'), meer.tekst);
const kroeg = maakMail({ soort: 'kroeg', kroeg: 'Café Nieuw', gemeente: 'Nijmegen', toelichting: 'Ingang in de steeg', lat: 51.846, lon: 5.86, op: '2026-11-25T09:50:00Z', naam: 'dorstige-zebra' });
check('kroeg: onderwerp met de kroeg en de stad', kroeg.onderwerp === 'Bierkoers: kroeg voorgesteld, Café Nieuw in Nijmegen', kroeg.onderwerp);
check('kroeg: naam, toelichting, kaartlink en de weg in de app', ['dorstige-zebra stelde op', 'Toelichting: Ingang in de steeg', 'openstreetmap.org/?mlat=51.846&mlon=5.86', 'Ik, Beheer, Ontbrekende kroegen'].every((s) => kroeg.tekst.includes(s)), kroeg.tekst);
const kroegKaal = maakMail({ soort: 'kroeg', kroeg: 'Café Nieuw', gemeente: 'Nijmegen', toelichting: null, lat: 51.846, lon: 5.86, op: '2026-11-25T09:50:00Z', naam: null });
check('kroeg zonder toelichting: geen lege toelichting en geen lege regels achter elkaar', !kroegKaal.tekst.includes('Toelichting') && !kroegKaal.tekst.includes('\n\n\n') && kroegKaal.tekst.startsWith('Een speler stelde'), kroegKaal.tekst);
check('geen gedachtestreepjes', !(bug.tekst + kaal.tekst + een.tekst + meer.tekst + aanSpeler.tekst + aanBeheer.tekst + kroeg.tekst).includes('—'));

console.log(`\n${ok} goed, ${fout} fout`);
process.exit(fout ? 1 : 0);
