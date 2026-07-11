# 🎧 Gandhari — Notes to Audio

Turn your UPSC notes into revision audio for hands-free memorisation. Paste or
import notes, and the app reads them aloud sentence-by-sentence with
karaoke-style highlighting, repeat loops, and a sleep timer — all offline, no
accounts, no API keys.

## Features
- **Paste or import** `.txt` / `.md` / **`.docx`** notes; auto-splits into parts
  by paragraph, heading/ALL-CAPS, sentence, or line. Word headings and bullet
  lists are detected automatically.
- **🧠 Memorisation flow** — restructures raw notes into recall-friendly
  narration before reading them aloud:
  - announces each **section** heading, then numbered points (*First… Second…*);
  - **expands abbreviations** for clear audio (Art.→Article, DPSP→Directive
    Principles of State Policy, and more);
  - adds a **key-term recap** after each section (articles, years, proper nouns);
  - optional **active recall** — asks a short question, pauses, then answers,
    so you can test yourself hands-free.
  - Toggle it per-note; tune the sub-options in **Settings**.
- **Clear narration** — 4-digit years are read as years ("1950" → *nineteen
  fifty*) and legal citations are read by structure ("Art 19(1)(a)" → *Article
  nineteen one A*).
- **Library is editable** — each note has ✏️ edit and 🗑 delete; editing a note
  and saving rebuilds its audiobook automatically (and refreshes it live if it's
  playing). The **Add Notes** page clears itself after each save.
- **Player** with play/pause, next/prev, seek, and tap-a-sentence-to-jump.
- **Speed presets** that actually apply live: 0.5, 0.75, 1, 1.1, 1.25, 1.4, 1.5,
  1.75, 2× — step with −/＋speed or the Settings slider.
- **Karaoke highlight** — the current sentence is highlighted as it's read.
- **Memorisation mode** — repeat each part up to 5×, add a pause between parts,
  and loop the whole note for spaced repetition.
- **Voice, speed & pitch** control using your device's built-in voices.
- **Sleep timer** (5–60 min) for revising in bed.
- **Progress saved** per note in your browser; resumes where you left off.
- **Installable PWA** — add to your phone's home screen; works fully offline.

## Run it locally
```bash
cd upsc-audiobook
python3 -m http.server 4180
```
Then open **http://localhost:4180/** in Chrome, Edge, or Safari.

> Opening `index.html` directly (file://) also works, but a local server is
> needed for offline install (service worker).

## Open it on your phone (same Wi-Fi)
The dev server listens on all interfaces, so any device on the same Wi-Fi can
reach it. With the server running on your Mac:

1. On your phone's browser, open **http://192.168.0.115:4180/**
   (this is your Mac's current Wi-Fi address — if it changes, re-run
   `ipconfig getifaddr en0` to find the new one).
2. iOS Safari: **Share → Add to Home Screen**. Android Chrome: **⋮ → Add to
   Home screen**.

Notes and progress are stored per-device (in the browser), so what you add on
your phone stays on your phone.

### For a permanent, installable (offline) link
Same-Wi-Fi works, but full offline install needs HTTPS. Host the folder free on
GitHub Pages / Netlify / Vercel (all static files, no build step) to get a
`https://…` URL that installs as a proper offline app anywhere. I can set that
up for you on request.

## Notes
- Voice quality depends on the voices installed on your device. On iOS/macOS the
  Siri voices sound best; on Android, Google TTS.
- Everything (notes + progress) is stored in your browser's `localStorage` —
  nothing is uploaded anywhere.
