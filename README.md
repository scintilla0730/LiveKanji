# LiveKanji

Learn real, everyday Japanese the way it's actually used in Japan.

## What's in this first version

- **Everyday**: 30 words you see on station signs, shop doors, konbini counters and menus.
- **Business**: 30 words and phrases for working in Japan (email, phone, meetings, office life), with tips on how they're used.
- **Videos** (coming soon): paste a YouTube, TikTok or Instagram link and get readings and grammar explanations.

Each card shows the word, its reading in hiragana, the meaning, where you'll see it, and an example sentence.
"I know it" and "Still learning" are saved in your browser.

One website works on both phones and computers.

## How to open it

Open `index.html` in any browser. No installation needed.

To make a single shareable file: `node scripts/build-preview.mjs` creates `dist/livekanji.html`.

## Project layout

- `index.html`: the page
- `css/styles.css`: the look
- `js/app.js`: how the app behaves
- `data/everyday.js`, `data/business.js`: the word lists (edit these to add words)
