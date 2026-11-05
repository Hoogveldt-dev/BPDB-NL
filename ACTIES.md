# Wat Kjell zelf nog moet doen

Stappen die alleen in een dashboard kunnen. Precieze uitleg: `supabase/README.md`, stap 3.

## Inloggen met een code (nodig voor de nieuwe app)

1. **Mailtemplates.** Supabase, Authentication, Emails, Templates. Zet bij **Confirm signup** en bij **Magic Link** het onderwerp `Je inlogcode voor de Kroegkaart` en de tekst uit `supabase/templates/inlogcode.html` (met `{{ .Token }}`). Zonder deze stap krijgt een speler nog een link in plaats van een code en kan hij in de app niets invullen.
2. **Eigen SMTP.** Authentication, Emails, SMTP Settings. Koppel Resend, Postmark of een andere mailprovider met een eigen afzender. Zonder deze stap krijgen alleen leden van je Supabase-team een mail, en maar een paar per uur.
3. **Rate limit.** Authentication, Rate Limits: zet het aantal mails per uur hoger zodra SMTP gekoppeld is.
4. **Adressen.** Authentication, URL Configuration: Site URL `https://bpdb-nl.pages.dev`, Redirect URLs `https://bpdb-nl.pages.dev/**` en `http://localhost:8765/**`.
