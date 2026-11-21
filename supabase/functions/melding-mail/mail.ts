// De tekst van de mail aan de beheerder bij een nieuwe bug of stadsaanvraag. Alleen platte tekst, geen HTML,
// zodat wat een speler intikt nooit als opmaak wordt gelezen.

export type Melding =
  | { soort: "bug"; tekst: string; scherm: string | null; apparaat: string | null; op: string; naam: string | null }
  | { soort: "stad"; stad: string; op: string; naam: string | null; spelers: number };

const wanneer = (op: string) =>
  new Date(op).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam", dateStyle: "long", timeStyle: "short" });

export function maakMail(m: Melding): { onderwerp: string; tekst: string } {
  const wie = m.naam?.trim() || "Een speler";
  if (m.soort === "bug") {
    const regels = [
      `${wie} meldde een bug op ${wanneer(m.op)}.`,
      "",
      m.tekst,
      "",
      m.scherm ? `Schermgrootte: ${m.scherm}` : "",
      m.apparaat ? `Browser: ${m.apparaat}` : "",
      "",
      "Alle bugs: https://bierkoers.nl, Ik, Beheer, Bugs.",
    ];
    return { onderwerp: "Bierkoers: nieuwe bug gemeld", tekst: regels.filter((r, i) => r !== "" || regels[i - 1] !== "").join("\n") };
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
