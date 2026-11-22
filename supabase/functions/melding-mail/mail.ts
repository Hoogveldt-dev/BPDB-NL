// De tekst van de mail aan de beheerder bij een nieuw bericht (vraag, suggestie, probleem of opmerking; soort
// "bug", naar de oude knop) of een stadsaanvraag. Alleen platte tekst, geen HTML,
// zodat wat een speler intikt nooit als opmaak wordt gelezen.

export type Melding =
  | { soort: "bug"; tekst: string; scherm: string | null; apparaat: string | null; op: string; naam: string | null }
  | { soort: "stad"; stad: string; op: string; naam: string | null; spelers: number };

const wanneer = (op: string) =>
  new Date(op).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam", dateStyle: "long", timeStyle: "short" });

// kanAntwoorden: de speler heeft een e-mailadres en dat staat als antwoordadres op de mail (index.ts).
export function maakMail(m: Melding, kanAntwoorden = false): { onderwerp: string; tekst: string } {
  const wie = m.naam?.trim() || "Een speler";
  if (m.soort === "bug") {
    const regels = [
      `${wie} stuurde een bericht op ${wanneer(m.op)}.`,
      "",
      m.tekst,
      "",
      m.scherm ? `Schermgrootte: ${m.scherm}` : "",
      m.apparaat ? `Browser: ${m.apparaat}` : "",
      "",
      kanAntwoorden ? "Beantwoord deze mail en je antwoord gaat naar de speler." : "De speler speelt zonder e-mailadres; antwoorden kan niet.",
      "Alle berichten: https://bierkoers.nl, Ik, Beheer, Berichten.",
    ];
    return { onderwerp: "Bierkoers: nieuw bericht", tekst: regels.filter((r, i) => r !== "" || regels[i - 1] !== "").join("\n") };
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
