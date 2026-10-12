import { chromium } from 'playwright';
const svg = (await import('node:fs')).readFileSync(process.argv[2], 'utf8');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
const p = await b.newPage();
for (const [size, out] of [[192, 'public/icon-192.png'], [512, 'public/icon-512.png'], [1024, 'assets/icon-1024.png']]) {
  await p.setViewportSize({ width: size, height: size });
  await p.setContent(`<html><body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await p.screenshot({ path: out, omitBackground: true });
}
await b.close();
