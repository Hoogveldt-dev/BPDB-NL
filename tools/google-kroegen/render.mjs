#!/usr/bin/env node
// HTML van een pagina na het uitvoeren van JavaScript, voor drankkaarten.py (sites op Wix, Squarespace en dergelijke).
// Gebruik: node render.mjs <url>  (HTML naar stdout)
import { chromium } from "playwright";

const browser = await chromium.launch();
try {
  const pagina = await browser.newPage({ userAgent: "Mozilla/5.0 (Bierkoers drankkaart; +https://bierkoers.nl)" });
  await pagina.goto(process.argv[2], { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
  await pagina.waitForTimeout(1500);
  process.stdout.write(await pagina.content());
} finally {
  await browser.close();
}
