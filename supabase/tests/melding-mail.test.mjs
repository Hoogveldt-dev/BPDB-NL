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
check('bericht met e-mailadres: antwoorden gaat via de mail', bug.tekst.includes('Beantwoord deze mail'), bug.tekst);

const kaal = maakMail({ soort: 'bug', tekst: 'Alleen een tekst', scherm: null, apparaat: null, op: '2026-11-21T09:50:00Z', naam: null });
check('bug zonder gegevens: noemt "Een speler" en geen lege regels achter elkaar', kaal.tekst.startsWith('Een speler stuurde') && !kaal.tekst.includes('\n\n\n') && !kaal.tekst.includes('Browser:'), kaal.tekst);
check('bericht zonder e-mailadres: zegt dat antwoorden niet kan', kaal.tekst.includes('antwoorden kan niet') && !kaal.tekst.includes('Beantwoord deze mail'), kaal.tekst);

const een = maakMail({ soort: 'stad', stad: 'Arnhem', op: '2026-11-21T09:50:00Z', naam: 'Rik', spelers: 1 });
check('stad: onderwerp met de stad', een.onderwerp === 'Bierkoers: stad aangevraagd, Arnhem', een.onderwerp);
check('stad: een speler', een.tekst.includes('Nu 1 speler vraagt erom.'), een.tekst);
const meer = maakMail({ soort: 'stad', stad: 'Arnhem', op: '2026-11-21T09:50:00Z', naam: 'Rik', spelers: 3 });
check('stad: meer spelers', meer.tekst.includes('Nu 3 spelers vragen erom.'), meer.tekst);
check('stad: wijst naar Beheer, Stadsaanvragen', meer.tekst.includes('Ik, Beheer, Stadsaanvragen'), meer.tekst);
check('geen gedachtestreepjes', !(bug.tekst + kaal.tekst + een.tekst + meer.tekst).includes('—'));

console.log(`\n${ok} goed, ${fout} fout`);
process.exit(fout ? 1 : 0);
