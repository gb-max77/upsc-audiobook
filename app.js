/* ShrutiUPSC — notes → revision audio (Web Speech API, offline, no keys) */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
  };

  // ---------- State ----------
  let notes = store.get('notes', []);   // [{id,title,text,mode,memoFlow,created,pos}]
  let settings = Object.assign({
    voiceURI: '', rate: 1, pitch: 1, repeat: 1, gap: 0.4, loop: false,
    numberPoints: true, expandAbbr: true, recap: true, recall: false,
  }, store.get('settings', {}));
  let editingId = null;

  const P = { note: null, queue: [], sections: [], idx: 0, repeatsLeft: 1, playing: false, sleepTimer: null };

  // ===================================================================
  //  TEXT PARSING
  // ===================================================================
  function splitSentences(text) {
    const parts = String(text).replace(/\s+/g, ' ')
      .match(/[^.!?]+[.!?]+[\])'"]*|\S[^.!?]*$/g);
    return (parts || [text]).map(s => s.trim()).filter(Boolean);
  }
  function stripBullet(s) { return s.replace(/^\s*(?:[-*•·▪◦‣o]|\d+[.)]|[a-z][.)])\s+/i, '').trim(); }

  // Explicit THEME markers written in the notes, e.g.
  // "THEME 4: Colonial Land Revenue", "Theme 4 - Land Revenue", "T4: …".
  const THEME_RE = /^(?:theme|t)\s*(\d+)\s*[:.)\-–—]\s*(.*)$/i;

  function isHeading(line) {
    const t = line.trim();
    if (!t) return false;
    if (/^#{1,6}\s/.test(t)) return true;
    if (THEME_RE.test(t)) return true;
    if (/^\d+[.)]\s*[A-Z].{0,70}$/.test(t) && !/[.!?]$/.test(t)) return true;
    const letters = t.replace(/[^A-Za-z]/g, '');
    if (letters.length >= 3 && t === t.toUpperCase() && t.length < 80) return true;
    return false;
  }
  const hasExplicitThemes = text => (text || '').split('\n').some(l => THEME_RE.test(l.trim()));

  // chunk = { title?, body: [rawLine, …] }
  function parseChunks(text, mode) {
    const raw = (text || '').replace(/\r\n/g, '\n').trim();
    if (!raw) return [];
    if (mode === 'line') return raw.split('\n').map(l => l.trim()).filter(Boolean).map(l => ({ body: [l] }));
    if (mode === 'sentence') return splitSentences(raw).map(s => ({ body: [s] }));
    if (mode === 'paragraph') return raw.split(/\n\s*\n/).map(p => p.replace(/\n/g, ' ').trim()).filter(Boolean).map(p => ({ body: [p] }));
    // heading
    // When the note names its own THEMEs, break ONLY at those lines so the theme
    // cards match them exactly; any other heading stays inside its theme's content.
    const themed = hasExplicitThemes(raw);
    const chunks = []; let cur = null;
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      const tm = t.match(THEME_RE);
      const boundary = themed ? !!tm : isHeading(line);
      if (boundary) {
        if (cur) chunks.push(cur);
        if (tm) cur = { title: (tm[2] || '').trim() || ('Theme ' + tm[1]), themeNo: +tm[1], body: [] };
        else cur = { title: t.replace(/^#{1,6}\s*/, '').trim(), body: [] };
      } else { if (!cur) cur = { body: [] }; cur.body.push(stripBullet(t)); }
    }
    if (cur) chunks.push(cur);
    return chunks.filter(c => c.title || c.body.length);
  }

  // ===================================================================
  //  MEMORISATION-FLOW TRANSFORM
  // ===================================================================
  const ABBR = [
    [/\bArts?\.?\s*(?=\d)/gi, m => /arts/i.test(m) ? 'Articles ' : 'Article '],
    [/\bDPSP\b/g, 'Directive Principles of State Policy'],
    [/\bFRs\b/g, 'Fundamental Rights'], [/\bFR\b/g, 'Fundamental Right'],
    [/\bFDs?\b/g, 'Fundamental Duties'],
    [/\bCAG\b/g, 'Comptroller and Auditor General'],
    [/\bUPSC\b/g, 'Union Public Service Commission'],
    [/\bRBI\b/g, 'Reserve Bank of India'],
    [/\bGST\b/g, 'Goods and Services Tax'],
    [/\bPM\b/g, 'Prime Minister'], [/\bCM\b/g, 'Chief Minister'],
    [/\bLok Sabha\b/g, 'Lok Sabha'], [/\bRajya Sabha\b/g, 'Rajya Sabha'],
    [/\bMPs\b/g, 'Members of Parliament'], [/\bMLAs\b/g, 'Members of Legislative Assembly'],
    [/\bParl\.?\b/gi, 'Parliament'], [/\bgovt\.?\b/gi, 'government'],
    [/\bw\.r\.t\.?\s*/gi, 'with respect to '],
    [/\bi\.e\.,?\s*/gi, 'that is, '], [/\be\.g\.,?\s*/gi, 'for example, '],
    [/\betc\.?/gi, 'and so on'], [/\bvs\.?\b/gi, 'versus'],
    [/\s&\s/g, ' and '],
  ];
  function expandAbbr(t) {
    let s = t;
    for (const [re, rep] of ABBR) s = s.replace(re, rep);
    return s.replace(/\s{2,}/g, ' ');
  }

  const ORD = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth', 'Eleventh', 'Twelfth'];
  const ordinal = n => ORD[n - 1] || ('Point ' + n);
  const cleanTitle = t => (t || '').replace(/^#{1,6}\s*/, '').replace(/[\s:.\-–—]+$/, '').trim();
  function ensureSentence(s) {
    s = stripBullet(String(s).trim());
    if (!s) return s;
    s = s[0].toUpperCase() + s.slice(1);
    if (!/[.!?]["')\]]?$/.test(s)) s += '.';
    return s;
  }
  const STOP = /^(The|This|That|These|Those|Part|It|In|As|For|And|But|Its|Their|Such|Under|With|First|Second|Third|Also|They|Here|There|When|While|Both|Each|Every|All)$/;
  function keyTerms(text) {
    const set = new Set();
    (text.match(/Articles?\s+\d+[A-Z]?/gi) || [])
      .forEach(t => set.add(t.replace(/\s+/, ' ').replace(/^Articles/i, 'Article')));
    // Strip Article-numbers so the proper-noun pass can't fuse with them.
    const rest = text.replace(/Articles?\s+\d+[A-Z]?/gi, ' ');
    (rest.match(/\b(1[5-9]\d{2}|20\d{2})\b/g) || []).forEach(t => set.add(t));
    (rest.match(/\b[A-Z][a-zA-Z]{2,}(?:\s+[A-Z][a-zA-Z]{2,}){0,2}\b/g) || [])
      .forEach(t => { if (!STOP.test(t.split(' ')[0]) && !/^Articles?$/i.test(t)) set.add(t); });
    return [...set].slice(0, 6);
  }
  // Note: avoid words that double as common nouns in notes (state, hold, form, mark, cover, set).
  const VERB = /\b(is|are|was|were|means?|refers?|denotes?|guarantees?|provides?|contains?|includes?|comprises?|consists?|deals?|defines?|prohibits?|ensures?|establishes?|grants?|empowers?|enables?|requires?|allows?|protects?|applies|gives?|began|occurred|signed|abolishes?|creates?|has|have|had)\b/i;
  function subjectOf(s) {
    const m = s.match(VERB);
    let subj = m ? s.slice(0, m.index) : s.split(/\s+/).slice(0, 4).join(' ');
    subj = subj.replace(/[,;:.\s]+$/, '').trim();
    if (/^(it|they|these|those|this|that|he|she|we|there|such|both|all)$/i.test(subj)) return '';
    const words = subj.split(/\s+/).filter(Boolean).length;
    return (subj.length >= 3 && words >= 1 && words <= 8) ? subj : '';
  }

  // ---- Number / year / legal-clause narration (applied to SPOKEN text only) ----
  const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  function numToWords(n) {
    n = +n;
    if (n < 20) return ONES[n];
    if (n < 100) return TENS[(n / 10) | 0] + (n % 10 ? ' ' + ONES[n % 10] : '');
    return ONES[(n / 100) | 0] + ' hundred' + (n % 100 ? ' ' + numToWords(n % 100) : '');
  }
  function yearToWords(y) {
    y = +y; const hi = (y / 100) | 0, lo = y % 100;
    if (y >= 2000 && y <= 2009) return 'two thousand' + (lo ? ' ' + numToWords(lo) : '');
    if (lo === 0) return numToWords(hi) + ' hundred';
    if (lo < 10) return numToWords(hi) + ' oh ' + numToWords(lo);
    return numToWords(hi) + ' ' + numToWords(lo);
  }
  const ROMAN = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  function romanToNum(s) {
    s = s.toLowerCase(); let t = 0, p = 0;
    for (let i = s.length - 1; i >= 0; i--) { const v = ROMAN[s[i]]; if (!v) return null; t += v < p ? -v : v; p = v; }
    return t;
  }
  function clauseToWords(inner) {
    inner = inner.trim();
    if (/^\d+$/.test(inner)) return numToWords(inner);
    if (/^[a-z]$/i.test(inner)) return inner.toUpperCase();
    if (/^[ivxlcdm]+$/i.test(inner)) { const r = romanToNum(inner); if (r) return numToWords(r); }
    return inner;
  }
  // "Article 19(1)(a)" → "Article nineteen one A"; "1950" → "nineteen fifty"
  function speakify(text) {
    let s = text.replace(/\bArts?\.?\s*(?=\d)/gi, m => /arts/i.test(m) ? 'Articles ' : 'Article ');
    s = s.replace(/\bArticles?\s+(\d+)([A-Za-z])?((?:\s*\([0-9A-Za-z]+\))*)/g, (m, num, letter, clauses) => {
      let out = (/\bArticles\b/i.test(m) ? 'Articles ' : 'Article ') + numToWords(num);
      if (letter) out += ' ' + letter.toUpperCase();
      (clauses.match(/\(([0-9A-Za-z]+)\)/g) || []).forEach(c => { out += ' ' + clauseToWords(c.replace(/[()]/g, '')); });
      return out;
    });
    s = s.replace(/\b(1[5-9]\d{2}|20\d{2})\b/g, m => yearToWords(m));
    return s;
  }

  // Build the flat list of spoken "units" + section structure for a note.
  // Returns { sections:[{title,ci,lines:[{text,kind}]}], units:[{text,sectionIdx,kind}] }
  function buildUnits(note) {
    const chunks = parseChunks(note.text, note.mode);
    const memo = !!note.memoFlow;
    const o = settings;
    const sections = [];
    chunks.forEach((c, ci) => {
      const title = cleanTitle(c.title || '');
      const facts = [];
      (c.body || []).forEach(line => {
        const src = memo && o.expandAbbr ? expandAbbr(line) : line;
        splitSentences(src).forEach(s => { if (s.trim()) facts.push(s.trim()); });
      });
      const lines = [];
      const push = (text, kind, pauseExtra = 0) => lines.push({ text, kind, pauseExtra });
      const headText = c.themeNo != null ? `Theme ${c.themeNo}: ${title}` : title;
      if (!memo) {
        if (title) push(headText, 'head', 0.7);
        facts.forEach(f => push(f, 'plain', isDefinition(f) ? 0.25 : 0));
      } else {
        if (title) push(headText, 'head', 0.7);
        const numbered = o.numberPoints && facts.length > 1 && !o.recall;
        facts.forEach((f, k) => {
          const fact = ensureSentence(f);
          if (o.recall) {
            const cue = subjectOf(fact);
            if (cue) push(cue + '?', 'question', 1.1);   // pause to let the learner recall
            push(fact, 'answer', 0.15);
          } else {
            push((numbered ? ordinal(k + 1) + ', ' : '') + fact, 'point', isDefinition(fact) ? 0.25 : 0);
          }
        });
        if (o.recap) {
          const kt = keyTerms(facts.join(' '));
          if (kt.length) push(`Key terms to remember. ${kt.join(', ')}.`, 'recap', 0.5);
        }
      }
      if (lines.length) sections.push({ title, ci, themeNo: c.themeNo, lines });
    });
    const units = [];
    sections.forEach((s, si) => s.lines.forEach(l => units.push({ text: l.text, sectionIdx: si, kind: l.kind, pauseExtra: l.pauseExtra || 0 })));
    return { sections, units };
  }
  const isDefinition = s => /\b(is|are|means?|refers?\s+to|defined\s+as|denotes?)\b/i.test(s);

  // ===================================================================
  //  DOCX IMPORT (in-browser, no library: native DecompressionStream)
  // ===================================================================
  async function readDocx(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const xml = await extractZipEntry(buf, 'word/document.xml');
    return docXmlToText(xml);
  }
  async function extractZipEntry(buf, wanted) {
    const dv = new DataView(buf.buffer);
    let eocd = -1;
    for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('not a valid .docx (zip end not found)');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const fnLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const localOff = dv.getUint32(p + 42, true);
      const name = dec.decode(buf.subarray(p + 46, p + 46 + fnLen));
      if (name === wanted) {
        const lfn = dv.getUint16(localOff + 26, true);
        const lex = dv.getUint16(localOff + 28, true);
        const start = localOff + 30 + lfn + lex;
        const comp = buf.subarray(start, start + compSize);
        if (method === 0) return dec.decode(comp);
        if (method !== 8) throw new Error('unsupported compression in .docx');
        const stream = new Blob([comp]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return dec.decode(await new Response(stream).arrayBuffer());
      }
      p += 46 + fnLen + extraLen + commentLen;
    }
    throw new Error('word/document.xml not found');
  }
  const decodeXml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  function docXmlToText(xml) {
    const lines = [];
    for (const raw of xml.split(/<w:p[ >]/).slice(1)) {
      const p = raw.split('</w:p>')[0].replace(/<w:tab\/>/g, ' ').replace(/<w:br\/>/g, ' ');
      const heading = /<w:pStyle[^>]*w:val="(?:Heading|Title)/i.test(p);
      const listItem = /<w:numPr[ >]/.test(p);
      let text = '';
      for (const t of p.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || []) {
        text += decodeXml(t.replace(/<w:t[^>]*>/, '').replace(/<\/w:t>/, ''));
      }
      text = text.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      lines.push(heading ? ('# ' + text) : (listItem ? ('- ' + text) : text));
    }
    return lines.join('\n\n');
  }

  // ===================================================================
  //  VIEWS
  // ===================================================================
  function showView(name) {
    $$('.view').forEach(v => v.classList.toggle('is-active', v.id === 'view-' + name));
    $$('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.view === name));
    window.scrollTo(0, 0);
  }
  $$('.tab').forEach(t => t.addEventListener('click', () => {
    if (t.dataset.view === 'add' && editingId) startNew(); // leaving an edit → fresh new note
    showView(t.dataset.view);
  }));
  document.addEventListener('click', e => {
    const g = e.target.closest('[data-goto]');
    if (g) { if (g.dataset.goto === 'add') startNew(); showView(g.dataset.goto); }
  });

  // ---------- Library ----------
  function renderLibrary(filter = '') {
    const list = $('#library-list');
    const q = filter.trim().toLowerCase();
    const items = notes
      .filter(n => !q || n.title.toLowerCase().includes(q) || n.text.toLowerCase().includes(q))
      .sort((a, b) => b.created - a.created);
    list.innerHTML = '';
    $('#library-empty').classList.toggle('show', notes.length === 0);
    items.forEach(n => {
      const { sections, units } = buildUnits(n);
      const total = units.length || 1;
      const pct = Math.min(100, Math.round(((n.pos || 0) / total) * 100));
      const el = document.createElement('div');
      el.className = 'note-card';
      el.innerHTML = `
        <div class="card-actions">
          <button class="edit" title="Edit notes">✏️</button>
          <button class="del" title="Delete">🗑</button>
        </div>
        <h3></h3>
        <div class="snippet"></div>
        <div class="meta">${sections.length} sections · ${units.length} lines${n.memoFlow ? ' · 🧠 flow' : ''} · ${pct}% done</div>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <button class="btn primary play-btn">▶ Play audiobook</button>`;
      el.querySelector('h3').textContent = n.title || 'Untitled';
      el.querySelector('.snippet').textContent = n.text.slice(0, 160);
      el.querySelector('.play-btn').addEventListener('click', ev => { ev.stopPropagation(); openPlayer(n); });
      el.addEventListener('click', () => openPlayer(n));
      el.querySelector('.edit').addEventListener('click', ev => { ev.stopPropagation(); startEdit(n); });
      el.querySelector('.del').addEventListener('click', ev => {
        ev.stopPropagation();
        if (confirm('Delete this note?')) {
          notes = notes.filter(x => x.id !== n.id);
          store.set('notes', notes);
          renderLibrary($('#search').value);
        }
      });
      list.appendChild(el);
    });
  }
  $('#search').addEventListener('input', e => renderLibrary(e.target.value));

  // ---------- Add / edit ----------
  function startNew() {
    editingId = null;
    $('#add-head').textContent = 'Add Notes';
    $('#save-note').textContent = 'Save note';
    $('#note-title').value = '';
    $('#note-text').value = '';
    $('#chunk-mode').value = 'heading';
    $('#memo-flow').checked = true;
    renderPreview();
  }
  function startEdit(n) {
    editingId = n.id;
    $('#add-head').textContent = 'Edit Notes';
    $('#save-note').textContent = 'Save changes';
    $('#note-title').value = n.title;
    $('#note-text').value = n.text;
    $('#chunk-mode').value = n.mode || 'paragraph';
    $('#memo-flow').checked = n.memoFlow !== false;
    renderPreview();
    showView('add');
  }
  const KIND_LABEL = { head: 'THEME', plain: 'point', point: 'point', question: 'recall Q', answer: 'answer', recap: 'recap' };
  function estimateSeconds(units) {
    let sec = 0;
    units.forEach(u => {
      const words = u.text.split(/\s+/).filter(Boolean).length;
      sec += (words / (160 * settings.rate)) * 60 + settings.gap + (u.pauseExtra || 0);
    });
    return sec;
  }
  const fmtTime = s => `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;

  // The "Intelligent UPSC Reader" pre-audio stage — shows how the notes were
  // understood: theme segmentation, per-theme points, pauses, and a read preview.
  function renderPreview() {
    const text = $('#note-text').value;
    // If the notes name their own themes, segment by them automatically.
    if (hasExplicitThemes(text) && $('#chunk-mode').value !== 'heading') $('#chunk-mode').value = 'heading';
    const note = { text, mode: $('#chunk-mode').value, memoFlow: $('#memo-flow').checked };
    const { sections, units } = buildUnits(note);

    const explicit = sections.some(s => s.themeNo != null);
    const themeList = explicit ? sections.filter(s => s.themeNo != null) : sections;
    $('#ir-stats').textContent = units.length
      ? `${themeList.length} theme${themeList.length === 1 ? '' : 's'} · ${units.length} lines · ~${fmtTime(estimateSeconds(units))}`
      : '';
    $('#ir-note').textContent = !units.length
      ? 'Paste or import your notes above to see how they will be read.'
      : explicit
        ? '✓ Matched the THEMEs named in your notes — each becomes an audio chapter. Other headings stay inside their theme.'
        : 'No explicit “THEME N:” labels found — segmented by headings/blank lines. Add “Theme 1:”, “Theme 2:” lines to define the chapters.';

    // Theme chips — only the explicit THEMEs when the note names them
    const themes = $('#ir-themes'); themes.innerHTML = '';
    themeList.forEach((s, i) => {
      const pts = s.lines.filter(l => ['point', 'plain', 'answer'].includes(l.kind)).length;
      const no = s.themeNo != null ? s.themeNo : (i + 1);
      const chip = document.createElement('span');
      chip.className = 'ir-theme' + (s.themeNo != null ? ' matched' : '');
      chip.textContent = `T${no}: ${s.title || 'Untitled'} · ${pts} pt${pts === 1 ? '' : 's'}`;
      themes.appendChild(chip);
    });

    // Read-aloud transcript preview
    const tr = $('#ir-transcript'); tr.innerHTML = '';
    units.slice(0, 14).forEach(u => {
      const row = document.createElement('div');
      row.className = 'ir-line k-' + u.kind;
      const pause = u.pauseExtra >= 0.7 ? '⏸⏸' : u.pauseExtra >= 0.25 ? '⏸' : '';
      row.innerHTML = `<span class="ir-kind">${KIND_LABEL[u.kind] || u.kind}</span>` +
        `<span class="ir-text"></span><span class="ir-pause">${pause}</span>`;
      row.querySelector('.ir-text').textContent = speakify(u.text);
      tr.appendChild(row);
    });
    if (units.length > 14) {
      const more = document.createElement('div');
      more.className = 'ir-line more';
      more.textContent = `+ ${units.length - 14} more lines…`;
      tr.appendChild(more);
    }
  }
  $('#note-text').addEventListener('input', renderPreview);
  $('#chunk-mode').addEventListener('change', renderPreview);
  $('#memo-flow').addEventListener('change', renderPreview);

  $('#file-input').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const text = /\.docx$/i.test(f.name) ? await readDocx(f) : await f.text();
      if (!text.trim()) throw new Error('no readable text found');
      $('#note-text').value = text;
      if (!$('#note-title').value) $('#note-title').value = f.name.replace(/\.[^.]+$/, '');
      if (hasExplicitThemes(text) || /(^|\n)#\s/.test(text)) $('#chunk-mode').value = 'heading';
      else if (/\n\s*\n/.test(text)) $('#chunk-mode').value = 'paragraph';
      renderPreview();
    } catch (err) {
      alert('Could not read “' + f.name + '”: ' + err.message);
    }
    e.target.value = '';
  });

  $('#save-note').addEventListener('click', () => {
    const title = $('#note-title').value.trim();
    const text = $('#note-text').value.trim();
    const mode = $('#chunk-mode').value;
    const memoFlow = $('#memo-flow').checked;
    if (!text) { alert('Please paste or import some notes first.'); return; }
    if (editingId) {
      const n = notes.find(x => x.id === editingId);
      Object.assign(n, { title: title || n.title, text, mode, memoFlow, pos: 0 }); // content changed → restart
      // if the player is open on this note, rebuild it live so the audiobook matches
      if (P.note && P.note.id === n.id && !$('#player').hidden) openPlayer(n);
    } else {
      notes.push({ id: Date.now().toString(36), title: title || 'Untitled', text, mode, memoFlow, created: Date.now(), pos: 0 });
    }
    store.set('notes', notes);
    startNew();          // refresh the Add page after saving
    renderLibrary();
    showView('library');
  });
  $('#cancel-edit').addEventListener('click', () => showView('library'));

  // ===================================================================
  //  PLAYER
  // ===================================================================
  const synth = window.speechSynthesis;
  let voices = [];

  function loadVoices() {
    voices = synth.getVoices();
    const sel = $('#voice-select');
    if (!voices.length) return;
    voices.sort((a, b) => (b.lang.startsWith('en') - a.lang.startsWith('en')) ||
      (b.lang.includes('IN') - a.lang.includes('IN')));
    sel.innerHTML = '';
    voices.forEach(v => {
      const o = document.createElement('option');
      o.value = v.voiceURI;
      o.textContent = `${v.name} (${v.lang})${v.default ? ' — default' : ''}`;
      sel.appendChild(o);
    });
    if (settings.voiceURI && voices.some(v => v.voiceURI === settings.voiceURI)) sel.value = settings.voiceURI;
    else { settings.voiceURI = sel.value; store.set('settings', settings); }
  }
  loadVoices();
  if (synth.onvoiceschanged !== undefined) synth.onvoiceschanged = loadVoices;
  const currentVoice = () => voices.find(v => v.voiceURI === settings.voiceURI) || voices.find(v => v.default) || voices[0];

  function openPlayer(note) {
    stopSpeech();
    const { sections, units } = buildUnits(note);
    P.note = note; P.sections = sections; P.queue = units;
    // first unit index of each section, for theme jumping + current-theme tracking
    P.sectionStarts = []; let acc = 0;
    sections.forEach(s => { P.sectionStarts.push(acc); acc += s.lines.length; });
    P.idx = Math.min(note.pos || 0, Math.max(0, units.length - 1));
    P.repeatsLeft = settings.repeat;
    $('#np-title').textContent = note.title;
    $('#seek').max = Math.max(0, units.length - 1);
    renderReader();
    renderThemes();
    $('#player').hidden = false;
    updateProgress();
    highlight();
  }

  function renderThemes() {
    const sel = $('#theme-jump');
    sel.innerHTML = '';
    P.themeStarts = [];
    const themed = P.sections.some(s => s.themeNo != null);
    P.sections.forEach((sec, si) => {
      if (themed && sec.themeNo == null) return; // only explicit THEMEs are cards
      let name = (sec.title || (sec.lines[0] && sec.lines[0].text) || 'Section')
        .replace(/^#+\s*/, '').replace(/[.:]\s*$/, '').trim();
      if (name.length > 55) name = name.slice(0, 55) + '…';
      const no = sec.themeNo != null ? sec.themeNo : (si + 1);
      const o = document.createElement('option');
      o.value = P.sectionStarts[si];
      o.textContent = `T${no}: ${name}`;
      sel.appendChild(o);
      P.themeStarts.push(P.sectionStarts[si]);
    });
    // Hide the jump control when there's nothing meaningful to jump between.
    sel.style.display = sel.options.length > 1 ? '' : 'none';
  }

  function renderReader() {
    const r = $('#reader');
    r.innerHTML = '';
    let gi = 0;
    P.sections.forEach((sec, si) => {
      const div = document.createElement('div');
      div.className = 'r-chunk';
      div.dataset.chunk = si;
      sec.lines.forEach(l => {
        const span = document.createElement('span');
        span.className = 'r-sentence k-' + l.kind;
        span.dataset.i = gi;
        span.textContent = l.text + ' ';
        span.addEventListener('click', () => { P.idx = +span.dataset.i; P.repeatsLeft = settings.repeat; play(); });
        div.appendChild(span);
        gi++;
      });
      r.appendChild(div);
    });
  }

  function highlight() {
    $$('.r-sentence').forEach(s => s.classList.remove('current'));
    const cur = $(`.r-sentence[data-i="${P.idx}"]`);
    if (cur) {
      cur.classList.add('current');
      if ($('#player').classList.contains('expanded')) cur.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    const secIdx = P.queue[P.idx]?.sectionIdx ?? 0;
    $$('.r-chunk').forEach(c => {
      c.classList.toggle('active', +c.dataset.chunk === secIdx);
      c.classList.toggle('done', +c.dataset.chunk < secIdx);
    });
    const tj = $('#theme-jump');
    if (tj && P.themeStarts && P.themeStarts.length) {
      let v = null;
      for (const s of P.themeStarts) { if (s <= P.idx) v = s; else break; }
      if (v != null) tj.value = String(v);
    }
  }

  function updateProgress() {
    $('#np-progress').textContent = `${Math.min(P.idx + 1, P.queue.length)} / ${P.queue.length}`;
    $('#seek').value = P.idx;
    if (P.note) { P.note.pos = P.idx; store.set('notes', notes); }
  }

  let keepAlive = null, currentUtter = null;
  function play() {
    if (!P.queue.length) return;
    // Detach the outgoing utterance's handlers so the cancel() below can't fire
    // its onend and advance the index (that was the "skips a line" bug).
    if (currentUtter) { currentUtter.onend = null; currentUtter.onerror = null; }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(speakify(P.queue[P.idx].text));
    const v = currentVoice();
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = clampRate(settings.rate); u.pitch = settings.pitch;
    u.onend = onUtterEnd; u.onerror = onUtterEnd;
    currentUtter = u;
    P.playing = true;
    setPlayIcon(); highlight(); updateProgress();
    // Small delay avoids the Chrome cancel()->speak() race that can drop audio;
    // guarded so only the latest requested line actually speaks.
    setTimeout(() => { if (P.playing && currentUtter === u) synth.speak(u); }, 40);
    clearInterval(keepAlive);
    keepAlive = setInterval(() => { if (synth.speaking && !synth.paused) { synth.pause(); synth.resume(); } }, 9000);
  }
  const clampRate = r => Math.min(2, Math.max(0.5, r));
  function onUtterEnd() {
    if (!P.playing) return;
    // Intelligent pause: base gap + a per-line extra decided by the reader stage.
    const ms = Math.round(Math.max(0, settings.gap + (P.queue[P.idx]?.pauseExtra || 0)) * 1000);
    if (P.repeatsLeft > 1) { P.repeatsLeft--; return schedule(ms); }
    P.repeatsLeft = settings.repeat;
    if (P.idx < P.queue.length - 1) { P.idx++; schedule(ms); }
    else if (settings.loop) { P.idx = 0; schedule(ms); }
    else { stopSpeech(); updateProgress(); }
  }
  function schedule(ms) { setTimeout(() => { if (P.playing) play(); }, ms); }

  function togglePlay() { if (!P.queue.length) return; P.playing ? pauseSpeech() : play(); }
  function pauseSpeech() { P.playing = false; if (currentUtter) { currentUtter.onend = null; currentUtter.onerror = null; } synth.cancel(); clearInterval(keepAlive); setPlayIcon(); }
  function stopSpeech() { P.playing = false; if (currentUtter) { currentUtter.onend = null; currentUtter.onerror = null; } synth.cancel(); clearInterval(keepAlive); setPlayIcon(); }
  const setPlayIcon = () => { $('#playpause').textContent = P.playing ? '⏸' : '▶'; };

  function next() { if (P.idx < P.queue.length - 1) { P.idx++; P.repeatsLeft = settings.repeat; P.playing ? play() : (highlight(), updateProgress()); } }
  function prev() { if (P.idx > 0) { P.idx--; P.repeatsLeft = settings.repeat; P.playing ? play() : (highlight(), updateProgress()); } }

  $('#playpause').addEventListener('click', togglePlay);
  $('#next').addEventListener('click', next);
  $('#prev').addEventListener('click', prev);
  $('#seek').addEventListener('input', e => { P.idx = +e.target.value; P.repeatsLeft = settings.repeat; highlight(); updateProgress(); if (P.playing) play(); });
  $('#player-close').addEventListener('click', () => { stopSpeech(); $('#player').hidden = true; renderLibrary($('#search').value); });

  // Theme jump — go to the chosen section and start playing there
  $('#theme-jump').addEventListener('change', e => {
    P.idx = +e.target.value;
    P.repeatsLeft = settings.repeat;
    play();
  });

  // Read-along panel toggle
  function toggleReadAlong() {
    const on = $('#player').classList.toggle('expanded');
    $('#readalong').classList.toggle('active', on);
    $('#readalong2').classList.toggle('active', on);
    highlight();
  }
  $('#readalong').addEventListener('click', toggleReadAlong);
  $('#readalong2').addEventListener('click', toggleReadAlong);

  const SPEEDS = [0.5, 0.75, 1.0, 1.1, 1.25, 1.4, 1.5, 1.75, 2.0];
  const fmtRate = r => (+r).toString().replace(/\.0$/, '') + '×';
  function applyRate(r) {
    settings.rate = Math.min(2, Math.max(0.5, r));
    store.set('settings', settings);
    syncSettingsUI();
    // Don't restart the current line — the new speed applies from the next line,
    // so playback continues from where it is (Web Speech can't retune a live utterance).
  }
  function stepSpeed(dir) {
    if (dir > 0) applyRate(SPEEDS.find(s => s > settings.rate + 1e-9) ?? SPEEDS[SPEEDS.length - 1]);
    else applyRate([...SPEEDS].reverse().find(s => s < settings.rate - 1e-9) ?? SPEEDS[0]);
  }
  $('#rate-up').addEventListener('click', () => stepSpeed(1));
  $('#rate-down').addEventListener('click', () => stepSpeed(-1));
  $('#rate-chip').addEventListener('click', () => stepSpeed(1)); // tap chip to cycle up

  $('#sleep').addEventListener('change', e => {
    clearTimeout(P.sleepTimer);
    const min = +e.target.value;
    if (min > 0) P.sleepTimer = setTimeout(() => { pauseSpeech(); e.target.value = '0'; }, min * 60000);
  });

  // ---------- Settings ----------
  function syncSettingsUI() {
    $('#rate').value = settings.rate; $('#pitch').value = settings.pitch;
    $('#repeat').value = settings.repeat; $('#gap').value = settings.gap; $('#loop').checked = settings.loop;
    $('#opt-number').checked = settings.numberPoints; $('#opt-abbr').checked = settings.expandAbbr;
    $('#opt-recap').checked = settings.recap; $('#opt-recall').checked = settings.recall;
    $('#rate-out').textContent = fmtRate(settings.rate);
    $('#pitch-out').textContent = settings.pitch.toFixed(2);
    $('#repeat-out').textContent = settings.repeat + '×';
    $('#gap-out').textContent = settings.gap.toFixed(1) + 's';
    $('#rate-chip').textContent = fmtRate(settings.rate);
  }
  const saveS = () => store.set('settings', settings);
  $('#voice-select').addEventListener('change', e => { settings.voiceURI = e.target.value; saveS(); });
  $('#rate').addEventListener('input', e => applyRate(+e.target.value));
  $('#pitch').addEventListener('input', e => { settings.pitch = +e.target.value; saveS(); syncSettingsUI(); });
  $('#repeat').addEventListener('input', e => { settings.repeat = +e.target.value; P.repeatsLeft = settings.repeat; saveS(); syncSettingsUI(); });
  $('#gap').addEventListener('input', e => { settings.gap = +e.target.value; saveS(); syncSettingsUI(); });
  $('#loop').addEventListener('change', e => { settings.loop = e.target.checked; saveS(); });
  const flowOpt = (id, key) => $(id).addEventListener('change', e => { settings[key] = e.target.checked; saveS(); renderPreview(); });
  flowOpt('#opt-number', 'numberPoints'); flowOpt('#opt-abbr', 'expandAbbr');
  flowOpt('#opt-recap', 'recap'); flowOpt('#opt-recall', 'recall');
  $('#test-voice').addEventListener('click', () => {
    synth.cancel();
    const u = new SpeechSynthesisUtterance('This is how your UPSC revision audio will sound.');
    const v = currentVoice(); if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = settings.rate; u.pitch = settings.pitch;
    synth.speak(u);
  });

  // ---------- Keyboard ----------
  document.addEventListener('keydown', e => {
    if ($('#player').hidden) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.code === 'ArrowRight') next();
    else if (e.code === 'ArrowLeft') prev();
  });
  window.addEventListener('beforeunload', () => { if (P.note) store.set('notes', notes); });

  // ---------- Init ----------
  syncSettingsUI();
  renderLibrary();
  renderPreview();
  if (notes.length === 0) showView('add');
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
