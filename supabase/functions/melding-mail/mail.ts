// De tekst van de mails rond berichten en stadsaanvragen. Alleen platte tekst, geen HTML, zodat wat een speler
// intikt nooit als opmaak wordt gelezen.
// - soort "bug": een nieuw bericht (vraag, suggestie, probleem of opmerking; de naam komt van de oude knop), aan de beheerder
// - soort "stad": een stadsaanvraag, aan de beheerder
// - soort "antwoord": een antwoord in een gesprek; van de beheerder aan de speler, of van de speler aan de beheerder

export type Melding =
  | { soort: "bug"; tekst: string; scherm: string | null; apparaat: string | null; op: string; naam: string | null }
  | { soort: "stad"; stad: string; op: string; naam: string | null; spelers: number }
  | { soort: "antwoord"; tekst: string; op: string; van_beheer: boolean; naam: string | null; bericht: string | null };

const wanneer = (op: string) =>
  new Date(op).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam", dateStyle: "long", timeStyle: "short" });

// Geen twee lege regels achter elkaar
const regels = (r: string[]) => r.filter((x, i) => x !== "" || (i > 0 && r[i - 1] !== "")).join("\n").trim();

// Een eerder bericht als citaat onder de mail
const citaat = (t: string | null) => (t ?? "").split("\n").map((r) => `> ${r}`).join("\n");

// kanAntwoorden: de speler heeft een e-mailadres en dat staat als antwoordadres op de mail (index.ts).
export function maakMail(m: Melding, kanAntwoorden = false): { onderwerp: string; tekst: string } {
  const wie = m.naam?.trim() || "Een speler";
  if (m.soort === "bug") {
    return {
      onderwerp: "Bierkoers: nieuw bericht",
      tekst: regels([
        `${wie} stuurde een bericht op ${wanneer(m.op)}.`,
        "",
        m.tekst,
        "",
        m.scherm ? `Schermgrootte: ${m.scherm}` : "",
        m.apparaat ? `Browser: ${m.apparaat}` : "",
        "",
        "Antwoord in de app: https://bierkoers.nl, Ik, Beheer, Berichten. De speler ziet het onder Ik, Jouw berichten.",
        kanAntwoorden ? "Beantwoord je deze mail, dan gaat je antwoord alleen per mail naar de speler." : "De speler speelt zonder e-mailadres; je antwoord staat dan alleen in de app.",
      ]),
    };
  }
  if (m.soort === "antwoord" && m.van_beheer) {
    return {
      onderwerp: "Bierkoers: antwoord op je bericht",
      tekst: regels([
        "Je kreeg antwoord van Bierkoers.",
        "",
        m.tekst,
        "",
        "Je bericht was:",
        citaat(m.bericht),
        "",
        "Reageren kan in de app: https://bierkoers.nl, Ik, Jouw berichten. Of beantwoord deze mail.",
      ]),
    };
  }
  if (m.soort === "antwoord") {
    return {
      onderwerp: "Bierkoers: nieuw antwoord in een gesprek",
      tekst: regels([
        `${wie} antwoordde op ${wanneer(m.op)}.`,
        "",
        m.tekst,
        "",
        "Het eerste bericht was:",
        citaat(m.bericht),
        "",
        "Antwoord in de app: https://bierkoers.nl, Ik, Beheer, Berichten.",
      ]),
    };
  }
  const spelers = `${m.spelers} ${m.spelers === 1 ? "speler vraagt" : "spelers vragen"}`;
  return {
    onderwerp: `Bierkoers: stad aangevraagd, ${m.stad}`,
    tekst: [
      `${wie} vroeg op ${wanneer(m.op)} om de stad ${m.stad}.`,
      `Nu ${spelers} erom.`,
      "",
      "Goedkeuren of afwijzen: https://bierkoers.nl, Ik, Beheer, Stadsaanvragen.",
    ].join("\n"),
  };
}
