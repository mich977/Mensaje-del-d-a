/**
 * web-pulse.js
 * Módulo de conexión en vivo con la web para "Oráculo Ciber-Filosófico".
 * Usa JSONP (<script>) para Wikipedia/Wikiquote (sin bloqueo CORS incluso en file://),
 * Google Search Grounding en Gemini 2.5 Flash y endpoint /api/web-pulse en Vercel.
 */
(function (global) {
  'use strict';

  const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

  const MONTHS_ES = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
  ];

  async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Petición JSONP mediante etiqueta <script>: funciona incluso en file:// (Origin: null) sin CORS.
   */
  function jsonpRequest(url, timeoutMs = 5500) {
    return new Promise((resolve, reject) => {
      const cbName = `__oraculoJsonp_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      const script = document.createElement('script');
      let finished = false;

      const cleanup = () => {
        if (script.parentNode) script.parentNode.removeChild(script);
        try {
          delete global[cbName];
        } catch {
          global[cbName] = undefined;
        }
      };

      const timer = setTimeout(() => {
        if (finished) return;
        finished = true;
        cleanup();
        reject(new Error('Timeout en conexión JSONP'));
      }, timeoutMs);

      global[cbName] = (data) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        cleanup();
        resolve(data);
      };

      const sep = url.includes('?') ? '&' : '?';
      script.src = `${url}${sep}callback=${cbName}`;
      script.async = true;
      script.onerror = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        cleanup();
        reject(new Error('Error de red cargando recurso web'));
      };

      document.head.appendChild(script);
    });
  }

  /**
   * Consulta Wikipedia y Wikiquote en español vía JSONP (sin CORS, compatible con file:// y HTTP).
   */
  async function fetchWikimediaJsonpPulse(fecha = new Date()) {
    const dateTitle = `${fecha.getDate()}_de_${MONTHS_ES[fecha.getMonth()]}`;

    const wpRandomUrl =
      'https://es.wikipedia.org/w/api.php?action=query&generator=random&grnnamespace=0&prop=extracts|info&inprop=url&exintro=1&explaintext=1&exchars=260&format=json';
    const wpDateUrl =
      `https://es.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(dateTitle)}&prop=extracts|info&inprop=url&explaintext=1&exchars=900&format=json`;
    const wqRandomUrl =
      'https://es.wikiquote.org/w/api.php?action=query&generator=random&grnnamespace=0&prop=extracts|info&inprop=url&explaintext=1&exchars=320&format=json';

    const [rndWp, dateWp, rndWq] = await Promise.allSettled([
      jsonpRequest(wpRandomUrl, 5500),
      jsonpRequest(wpDateUrl, 5500),
      jsonpRequest(wqRandomUrl, 5500)
    ]);

    const insights = [];
    const sources = [];

    if (dateWp.status === 'fulfilled') {
      const pages = Object.values(dateWp.value?.query?.pages || {});
      const p = pages[0];
      if (p?.extract) {
        const lines = p.extract
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => /^\d{3,4}\s*[:\-–]/.test(l) || (l.length > 45 && !l.startsWith('==')));
        const pickedLine = lines.length
          ? lines[Math.floor(Math.random() * Math.min(lines.length, 8))]
          : p.extract.slice(0, 220);
        if (pickedLine) {
          insights.push(`Efeméride real de hoy (${p.title}): ${pickedLine.slice(0, 240)}`);
          sources.push({
            origin: 'Wikipedia Hoy',
            title: p.title,
            url: p.fullurl || `https://es.wikipedia.org/wiki/${encodeURIComponent(dateTitle)}`
          });
        }
      }
    }

    if (rndWp.status === 'fulfilled') {
      const pages = Object.values(rndWp.value?.query?.pages || {});
      const p = pages[0];
      if (p?.title && p?.extract) {
        const cleanExtract = p.extract.replace(/\s+/g, ' ').trim();
        if (cleanExtract.length > 35) {
          insights.push(`Descubrimiento web ("${p.title}"): ${cleanExtract}`);
          sources.push({
            origin: 'Wikipedia',
            title: p.title,
            url: p.fullurl || ''
          });
        }
      }
    }

    if (rndWq.status === 'fulfilled') {
      const pages = Object.values(rndWq.value?.query?.pages || {});
      const p = pages[0];
      if (p?.title && p?.extract) {
        const cleanQuote = p.extract
          .split('\n')
          .map((l) => l.replace(/^[*•\s]+/, '').trim())
          .find((l) => l.length > 30 && !l.startsWith('==') && !/^«?wikiquote/i.test(l));
        if (cleanQuote) {
          insights.push(`Cita/Tema en Wikiquote (${p.title}): ${cleanQuote.slice(0, 240)}`);
          sources.push({
            origin: 'Wikiquote',
            title: p.title,
            url: p.fullurl || ''
          });
        }
      }
    }

    return { insights, sources };
  }

  /**
   * Si corre sobre Vercel (HTTP/HTTPS), consulta titulares RSS reales sin CORS.
   */
  async function fetchVercelRssPulse() {
    if (!global.location.protocol.startsWith('http')) {
      return { insights: [], sources: [] };
    }

    try {
      const res = await fetchWithTimeout('./api/web-pulse', {}, 4500);
      if (!res.ok) return { insights: [], sources: [] };
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) return { insights: [], sources: [] };

      const data = await res.json();
      const items = Array.isArray(data.items) ? data.items : [];
      if (!items.length) return { insights: [], sources: [] };

      const picked = items[Math.floor(Math.random() * items.length)];
      return {
        insights: [
          `Titular actual (${picked.source}): "${picked.title}"${picked.summary ? ` — ${picked.summary}` : ''}`
        ],
        sources: [
          {
            origin: picked.source || 'RSS',
            title: picked.title,
            url: picked.url || ''
          }
        ]
      };
    } catch {
      return { insights: [], sources: [] };
    }
  }

  /**
   * Usa Google Search Grounding nativo de Gemini para buscar información fresca de la web hoy.
   */
  async function fetchGeminiGoogleSearchPulse(apiKey, contexto) {
    if (!apiKey || apiKey.length < 20) {
      return { insights: [], sources: [] };
    }

    const activeModel = global.OraculoGemini?.getActiveTextModel?.() || 'gemini-3.8-flash';
    const searchUrl = `${GEMINI_API_BASE}/${activeModel}:generateContent`;

    const searchThemes = [
      'noticia positiva inspiradora o avance humano científico reciente de esta semana',
      'descubrimiento astronómico o fenómeno del cielo visible hoy o esta semana',
      'historia real reciente de resiliencia, solidaridad o superación en el mundo',
      'efeméride cultural, filosófica o científica destacada de hoy en la historia'
    ];
    const angle = searchThemes[Math.floor(Math.random() * searchThemes.length)];

    const prompt = `Busca en Google en tiempo real información verídica relacionada con la fecha de hoy (${contexto.fechaTexto}) enfocada en: ${angle}.
Resume en máximo 3 líneas en español un hecho concreto, real y edificante que sirva como metáfora de esperanza para reflexionar hoy.`;

    try {
      const res = await fetchWithTimeout(
        `${searchUrl}?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            tools: [{ google_search: {} }],
            generationConfig: { temperature: 0.5 }
          })
        },
        7500
      );

      if (!res.ok) return { insights: [], sources: [] };

      const data = await res.json();
      const candidate = data?.candidates?.[0];
      const text = candidate?.content?.parts?.map((p) => p.text || '').join(' ').trim();
      const chunks = candidate?.groundingMetadata?.groundingChunks || [];

      const sources = chunks
        .map((c) => c.web)
        .filter((w) => w && w.uri)
        .slice(0, 3)
        .map((w) => ({
          origin: 'Google Search',
          title: w.title || w.uri,
          url: w.uri
        }));

      if (!text) return { insights: [], sources };
      return {
        insights: [`Pulso Google Search en vivo: ${text}`],
        sources
      };
    } catch (err) {
      console.warn('[WebPulse] Google Search Grounding omitido:', err);
      return { insights: [], sources: [] };
    }
  }

  /**
   * Recopila contexto web en vivo rápidamente (Wikipedia/Wikiquote JSONP y /api/web-pulse).
   * Presupuesto máximo de 1.5 s para no frenar la generación ni gastar cuota extra de Gemini.
   */
  async function gatherLiveWebContext({ apiKey = '', contexto } = {}) {
    const fecha = contexto?.fecha || new Date();
    const allInsights = [];
    const allSources = [];

    const collect = (promise) =>
      promise
        .then((res) => {
          if (res) {
            if (Array.isArray(res.insights)) allInsights.push(...res.insights);
            if (Array.isArray(res.sources)) allSources.push(...res.sources);
          }
        })
        .catch(() => {});

    const fastTasks = [
      collect(fetchWikimediaJsonpPulse(fecha)),
      collect(fetchVercelRssPulse())
    ];

    // Esperar como máximo 1.5 segundos las fuentes web abiertas (Wikipedia/Wikiquote/RSS)
    await Promise.race([
      Promise.allSettled(fastTasks),
      new Promise((resolve) => setTimeout(resolve, 1500))
    ]);

    // Solo si fallaron las fuentes abiertas y hay API Key, usar Google Search como último recurso (máx 2.2s)
    if (!allInsights.length && apiKey && apiKey.length >= 20) {
      await Promise.race([
        collect(fetchGeminiGoogleSearchPulse(apiKey, contexto)),
        new Promise((resolve) => setTimeout(resolve, 2200))
      ]);
    }

    const seen = new Set();
    const uniqueSources = [];
    for (const src of allSources) {
      const key = src.url || src.title;
      if (key && !seen.has(key)) {
        seen.add(key);
        uniqueSources.push(src);
      }
    }

    if (!allInsights.length) {
      return {
        connected: false,
        summaryText: '',
        sources: [],
        headline: 'Sin conexión a fuentes web en este momento'
      };
    }

    return {
      connected: true,
      summaryText: allInsights.join('\n'),
      sources: uniqueSources.slice(0, 4),
      headline: uniqueSources[0]?.title || 'Pulso Web en Vivo'
    };
  }

  const ephemerisDayCache = new Map();

  function isUsableWikiPhotoUrl(url) {
    if (!url || !/^https?:\/\//i.test(url)) return false;
    if (/\.(svg|gif|pdf|djvu|ogv|webm)(\?|$)/i.test(url)) return false;
    if (/flag_of_|commons-logo|ambox|wikidata-logo|pictogram|crystal_clear|nuvola_|red_pog|blue_pog/i.test(url)) {
      return false;
    }
    return true;
  }

  function safeWikimedia960Thumb(thumbUrl, origWidth = 0) {
    if (!thumbUrl || !/upload\.wikimedia\.org\/.*\/thumb\//i.test(thumbUrl)) return '';
    if (origWidth && origWidth < 800) return '';
    // Wikimedia acepta ancho estándar 960px cuando la imagen original lo soporta
    return String(thumbUrl).replace(/\/(\d+)px-([^/]+)$/, '/960px-$2');
  }

  function collectRestPageImages(item) {
    const pages = Array.isArray(item?.pages) ? item.pages : [];
    const urls = [];
    const pushIfValid = (u) => {
      if (u && isUsableWikiPhotoUrl(u) && !urls.includes(u)) {
        urls.push(u);
      }
    };

    for (const page of pages.slice(0, 4)) {
      const thumb = page?.thumbnail?.source || '';
      const orig = page?.originalimage?.source || '';
      const origW = Number(page?.originalimage?.width || 0);

      if (thumb) {
        const hiThumb = safeWikimedia960Thumb(thumb, origW);
        if (hiThumb) pushIfValid(hiThumb);
        pushIfValid(thumb);
      }
      if (orig && (!origW || origW <= 2600)) {
        pushIfValid(orig);
      }
    }
    return urls;
  }

  function extractWikiTitlesFromLine(line) {
    const titles = [];
    const rx = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
    let m;
    while ((m = rx.exec(String(line || ''))) !== null) {
      const t = m[1].trim();
      if (t && !/^(archivo|file|imagen|image|categor[ií]a|category|anexo|ayuda|wikipedia):/i.test(t) && !/^\d{1,4}$/.test(t)) {
        if (!titles.includes(t)) titles.push(t);
      }
    }
    return titles.slice(0, 4);
  }

  function cleanWikitextLine(raw) {
    let s = String(raw || '');
    s = s.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '');
    s = s.replace(/<ref[^/]*\/>/gi, '');
    s = s.replace(/<!--[\s\S]*?-->/g, '');
    s = s.replace(/\[\[(?:Archivo|File|Imagen|Image):[^\]]+\]\]/gi, '');
    s = s.replace(/\{\{(?:bandera2?|flag)\|([^|}]+)(?:\|[^}]*)?\}\}/gi, '$1 ');
    s = s.replace(/\{\{CHI\}\}/g, 'Chile');
    s = s.replace(/\{\{ARG\}\}/g, 'Argentina');
    s = s.replace(/\{\{PER\}\}/g, 'Perú');
    s = s.replace(/\{\{MEX\}\}/g, 'México');
    s = s.replace(/\{\{ESP\}\}/g, 'España');
    s = s.replace(/\{\{COL\}\}/g, 'Colombia');
    s = s.replace(/\{\{BOL\}\}/g, 'Bolivia');
    s = s.replace(/\{\{(?:siglo|a\.?\s*C\.?|d\.?\s*C\.?)\|([^|}]+)(?:\|[^}]*)?\}\}/gi, '$1');
    s = s.replace(/\{\{[^{}]*\}\}/g, '');
    s = s.replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, '$1');
    s = s.replace(/\[\[([^\]]+)\]\]/g, '$1');
    s = s.replace(/'''?/g, '');
    s = s.replace(/<[^>]+>/g, '');
    s = s.replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
    return s;
  }

  const CHILE_STRICT_REGEX =
    /\b(chile|chilen[oa]s?|santiago de chile|valpara[ií]so|concepci[oó]n|antofagasta|iquique|temuco|valdivia|punta arenas|pe[ñn]alol[eé]n|rapa nui|isla de pascua|chilo[eé]|atacama|mapuche|bernardo o'higgins|gabriela mistral|pablo neruda|violeta parra|arturo prat|manuel rodr[ií]guez|jos[eé] miguel carrera|salvador allende|patricio aylwin|v[ií]ctor jara|tricel)\b/i;

  const FOREIGN_LEAD_REGEX =
    /^\s*(?:\d{3,4}\s*[:\-–.]\s*)?(?:en\s+)?(?:argentina|per[uú]|bolivia|m[eé]xico|espa[nñ]a|colombia|venezuela|ecuador|uruguay|paraguay|brasil|cuba|panam[aá]|costa rica|guatemala|honduras|el salvador|nicaragua|rep[uú]blica dominicana|puerto rico|estados unidos|canad[aá]|francia|italia|alemania|reino unido|inglaterra|rusia|china|jap[oó]n|india)\b/i;

  function isStrictChileEvent(text) {
    const clean = String(text || '').trim();
    if (!clean) return false;
    if (!CHILE_STRICT_REGEX.test(clean)) return false;
    if (FOREIGN_LEAD_REGEX.test(clean) && !/\ben chile\b/i.test(clean)) return false;
    return true;
  }

  function parseWikipediaDateWikitext(wikitext, pageUrl) {
    const holidays = [];
    const events = [];
    const chileItems = [];
    const lines = String(wikitext || '').split('\n');
    let section = '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      const secMatch = line.match(/^==\s*([^=]+?)\s*==$/);
      if (secMatch) {
        const name = secMatch[1].toLowerCase();
        if (/celebraci|conmemoraci|efem[eé]rid|d[ií]as?\s+internacional/.test(name)) {
          section = 'holidays';
        } else if (/acontecimiento/.test(name)) {
          section = 'events';
        } else {
          section = 'other';
        }
        continue;
      }

      if (/^===/.test(line)) continue;
      if (!/^[*•]/.test(line)) continue;

      const wikiTitles = extractWikiTitlesFromLine(line);
      const clean = cleanWikitextLine(line.replace(/^[*•\s]+/, ''));
      if (!clean || clean.length < 16) continue;

      if (section === 'holidays') {
        if (isStrictChileEvent(clean)) {
          chileItems.push({
            kind: 'chile',
            year: null,
            text: clean.slice(0, 260),
            extract: '',
            wikiTitles,
            imageUrl: '',
            imageCandidates: [],
            sourceOrigin: 'Wikipedia Chile',
            sourceUrl: pageUrl
          });
        }
        if (!/^\s*en\s+[a-z]/i.test(clean) || /internacional|mundial|onu|unesco|oms|global/i.test(clean)) {
          holidays.push({
            kind: 'mundial',
            year: null,
            text: clean.slice(0, 260),
            extract: '',
            wikiTitles,
            imageUrl: '',
            imageCandidates: [],
            sourceOrigin: 'Wikipedia Conmemoraciones',
            sourceUrl: pageUrl
          });
        }
      } else if (section === 'events') {
        const m = clean.match(/^(\d{3,4})\s*[:\-–.]\s*(.+)$/);
        if (m && m[2].length > 22) {
          const itemObj = {
            kind: 'historia',
            year: Number(m[1]),
            text: m[2].trim().slice(0, 280),
            extract: '',
            wikiTitles,
            imageUrl: '',
            imageCandidates: [],
            sourceOrigin: 'Wikipedia Efemérides',
            sourceUrl: pageUrl
          };
          events.push(itemObj);
          if (isStrictChileEvent(m[2])) {
            chileItems.push({
              ...itemObj,
              kind: 'chile',
              sourceOrigin: 'Wikipedia Chile'
            });
          }
        }
      }
    }

    holidays.sort((a, b) => {
      const aIntl = /internacional|mundial|onu|unesco|oms|global/i.test(a.text) ? 0 : 1;
      const bIntl = /internacional|mundial|onu|unesco|oms|global/i.test(b.text) ? 0 : 1;
      return aIntl - bIntl;
    });

    return { holidays, events, chileItems };
  }

  function extractTopicKeywords(text) {
    const stop = new Set([
      'para', 'como', 'sobre', 'entre', 'desde', 'hasta', 'hacia', 'contra', 'segun', 'durante',
      'celebracion', 'conmemoracion', 'internacional', 'mundial', 'nacional', 'general', 'naciones',
      'unidas', 'todos', 'todas', 'parte', 'estado', 'primer', 'primera', 'ultimo', 'ultima',
      'despues', 'antes', 'mediante', 'siendo', 'fueron', 'habia', 'tiene', 'tienen', 'sobre'
    ]);
    return String(text || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !/^\d+$/.test(w) && !stop.has(w.toLowerCase()))
      .slice(0, 4);
  }

  /**
   * Busca fotografías reales en Wikipedia / Wikimedia Commons relacionadas con la efeméride
   * mediante JSONP (funciona tanto en HTTPS como en file://).
   */
  async function searchEphemerisTopicImages(item) {
    const urls = [];
    const pushUrl = (u) => {
      if (u && isUsableWikiPhotoUrl(u) && !urls.includes(u)) {
        urls.push(u);
      }
    };

    const titles = Array.isArray(item?.wikiTitles) ? item.wikiTitles.filter(Boolean).slice(0, 3) : [];
    const keywords = extractTopicKeywords(item?.text || item?.extract || '');
    const baseQuery = keywords.join(' ') || (titles[0] || '');
    const searchQuery =
      item?.kind === 'chile' && baseQuery && !/\bchile\b/i.test(baseQuery)
        ? `${baseQuery} Chile`
        : baseQuery;

    const tasks = [];

    if (titles.length) {
      const titlesUrl =
        `https://es.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(titles.join('|'))}` +
        `&prop=pageimages&piprop=thumbnail|original&pithumbsize=960&redirects=1&format=json`;
      tasks.push(
        jsonpRequest(titlesUrl, 2800).then((data) => {
          Object.values(data?.query?.pages || {}).forEach((p) => {
            pushUrl(p?.thumbnail?.source);
            const origW = Number(p?.original?.width || 0);
            if (!origW || origW <= 2600) pushUrl(p?.original?.source);
          });
        })
      );
    }

    if (searchQuery) {
      const wpSearchUrl =
        `https://es.wikipedia.org/w/api.php?action=query&generator=search` +
        `&gsrsearch=${encodeURIComponent(searchQuery)}&gsrlimit=6` +
        `&prop=pageimages&piprop=thumbnail|original&pithumbsize=960&format=json`;
      tasks.push(
        jsonpRequest(wpSearchUrl, 2800).then((data) => {
          Object.values(data?.query?.pages || {}).forEach((p) => {
            pushUrl(p?.thumbnail?.source);
          });
        })
      );

      const commonsSearchUrl =
        `https://commons.wikimedia.org/w/api.php?action=query&generator=search` +
        `&gsrnamespace=6&gsrsearch=${encodeURIComponent(searchQuery)}&gsrlimit=8` +
        `&prop=imageinfo&iiprop=url|mime|size&iiurlwidth=960&format=json`;
      tasks.push(
        jsonpRequest(commonsSearchUrl, 3000).then((data) => {
          Object.values(data?.query?.pages || {}).forEach((p) => {
            const info = p?.imageinfo?.[0];
            const mime = (info?.mime || '').toLowerCase();
            if ((mime === 'image/jpeg' || mime === 'image/png') && Number(info?.width || 0) >= 480) {
              pushUrl(info.thumburl || info.url);
            }
          });
        })
      );
    }

    await Promise.race([
      Promise.allSettled(tasks),
      new Promise((resolve) => setTimeout(resolve, 3100))
    ]);

    return urls.slice(0, 8);
  }

  async function loadDayEphemerisPool(fecha = new Date()) {
    const mm = String(fecha.getMonth() + 1).padStart(2, '0');
    const dd = String(fecha.getDate()).padStart(2, '0');
    const cacheKey = `${mm}-${dd}`;
    if (ephemerisDayCache.has(cacheKey)) {
      return ephemerisDayCache.get(cacheKey);
    }

    const dateTitle = `${fecha.getDate()}_de_${MONTHS_ES[fecha.getMonth()]}`;
    const defaultUrl = `https://es.wikipedia.org/wiki/${encodeURIComponent(dateTitle)}`;
    const restUrl = `https://es.wikipedia.org/api/rest_v1/feed/onthisday/all/${mm}/${dd}`;
    const jsonpUrl =
      `https://es.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(dateTitle)}` +
      `&prop=revisions|info&rvprop=content&rvslots=main&inprop=url&redirects=1&format=json`;

    const [restRes, jsonpRes] = await Promise.allSettled([
      fetchWithTimeout(restUrl, { headers: { Accept: 'application/json' } }, 2800).then((r) => (r.ok ? r.json() : null)),
      jsonpRequest(jsonpUrl, 3400)
    ]);

    const holidays = [];
    const events = [];
    const chile = [];

    if (restRes.status === 'fulfilled' && restRes.value) {
      const feed = restRes.value;
      const mapRestItem = (item, kind) => {
        const page = Array.isArray(item.pages) ? item.pages[0] : null;
        const imageCandidates = collectRestPageImages(item);
        const wikiTitles = (Array.isArray(item.pages) ? item.pages : [])
          .map((pg) => pg?.titles?.normalized || pg?.title)
          .filter(Boolean)
          .slice(0, 3);
        const text = String(item.text || page?.description || '').trim();
        if (!text) return null;
        return {
          kind,
          year: item.year || null,
          text: text.slice(0, 280),
          extract: String(page?.extract || '').slice(0, 320),
          wikiTitles,
          imageUrl: imageCandidates[0] || '',
          imageCandidates,
          sourceOrigin: kind === 'mundial' ? 'Wikipedia Día Mundial' : 'Wikipedia On This Day',
          sourceUrl: page?.content_urls?.desktop?.page || defaultUrl
        };
      };

      (Array.isArray(feed.holidays) ? feed.holidays : []).forEach((it) => {
        const mapped = mapRestItem(it, 'mundial');
        if (mapped) {
          holidays.push(mapped);
          if (isStrictChileEvent(mapped.text)) {
            chile.push({ ...mapped, kind: 'chile', sourceOrigin: 'Wikipedia Chile' });
          }
        }
      });

      const histList = [
        ...(Array.isArray(feed.selected) ? feed.selected : []),
        ...(Array.isArray(feed.events) ? feed.events : [])
      ];
      histList.forEach((it) => {
        const mapped = mapRestItem(it, 'historia');
        if (mapped) {
          events.push(mapped);
          if (isStrictChileEvent(mapped.text)) {
            chile.push({ ...mapped, kind: 'chile', sourceOrigin: 'Wikipedia Chile' });
          }
        }
      });
    }

    if (jsonpRes.status === 'fulfilled' && jsonpRes.value) {
      const pages = Object.values(jsonpRes.value?.query?.pages || {});
      const p = pages[0];
      const wikitext = p?.revisions?.[0]?.slots?.main?.['*'] || p?.revisions?.[0]?.['*'] || '';
      if (wikitext) {
        const parsed = parseWikipediaDateWikitext(wikitext, p.fullurl || defaultUrl);
        if (!holidays.length) {
          holidays.push(...parsed.holidays);
        } else {
          // Añadir celebraciones internacionales adicionales detectadas en la página en español
          const existing = new Set(holidays.map((h) => h.text.slice(0, 40).toLowerCase()));
          parsed.holidays.forEach((h) => {
            if (!existing.has(h.text.slice(0, 40).toLowerCase())) holidays.push(h);
          });
        }
        if (!events.length) events.push(...parsed.events);
        if (Array.isArray(parsed.chileItems)) {
          const existingCl = new Set(chile.map((c) => c.text.slice(0, 40).toLowerCase()));
          parsed.chileItems.forEach((c) => {
            if (!existingCl.has(c.text.slice(0, 40).toLowerCase())) chile.push(c);
          });
        }
      }
    }

    holidays.sort((a, b) => {
      const aScore = (/internacional|mundial|onu|unesco|oms/i.test(a.text) ? 2 : 0) + (a.imageCandidates?.length ? 2 : 0);
      const bScore = (/internacional|mundial|onu|unesco|oms/i.test(b.text) ? 2 : 0) + (b.imageCandidates?.length ? 2 : 0);
      return bScore - aScore;
    });

    const pool = { holidays, events, chile, dateUrl: defaultUrl };
    if (holidays.length || events.length || chile.length) {
      ephemerisDayCache.set(cacheKey, pool);
    }
    return pool;
  }

  const CHILE_CURATED_BY_DATE = {
    '11-15': [
      {
        kind: 'chile',
        year: 1945,
        text: 'El 15 de noviembre de 1945 la Academia Sueca anunció en Estocolmo el Premio Nobel de Literatura para la poeta y educadora chilena Gabriela Mistral, primera autora latinoamericana en recibirlo.',
        extract: 'Lucila Godoy Alcayaga (Gabriela Mistral) llevó la voz de Chile, la infancia y América Latina al reconocimiento universal.',
        wikiTitles: ['Gabriela Mistral'],
        imageUrl: '',
        imageCandidates: [],
        sourceOrigin: 'Efeméride de Chile',
        sourceUrl: 'https://es.wikipedia.org/wiki/Gabriela_Mistral'
      },
      {
        kind: 'chile',
        year: 2019,
        text: 'El 15 de noviembre de 2019 se firmó en el ex Congreso Nacional en Santiago el Acuerdo por la Paz Social y la Nueva Constitución, abriendo una salida institucional mediante plebiscito ciudadano.',
        extract: 'Hito político contemporáneo de Chile acordado en madrugada tras masivas movilizaciones sociales.',
        wikiTitles: ['Palacio del ex Congreso Nacional de Chile', 'Santiago de Chile'],
        imageUrl: '',
        imageCandidates: [],
        sourceOrigin: 'Efeméride de Chile',
        sourceUrl: 'https://es.wikipedia.org/wiki/Acuerdo_por_la_Paz_Social_y_la_Nueva_Constituci%C3%B3n'
      },
      {
        kind: 'chile',
        year: 1962,
        text: 'El 15 de noviembre de 1962 se promulgó en Chile la Ley N° 15.020, primera Ley de Reforma Agraria que impulsó la creación de instituciones como INDAP y CORA para el mundo rural chileno.',
        extract: 'Promulgada durante el gobierno de Jorge Alessandri para modernizar la agricultura y el acceso a la tierra en Chile.',
        wikiTitles: ['Reforma agraria chilena', 'Instituto de Desarrollo Agropecuario'],
        imageUrl: '',
        imageCandidates: [],
        sourceOrigin: 'Efeméride de Chile',
        sourceUrl: 'https://es.wikipedia.org/wiki/Reforma_agraria_chilena'
      },
      {
        kind: 'chile',
        year: 1811,
        text: 'El 15 de noviembre de 1811, durante la Patria Vieja chilena, José Miguel Carrera encabezó el movimiento que instauró un nuevo triunvirato ejecutivo junto a Bernardo O’Higgins y Gaspar Marín.',
        extract: 'Episodio decisivo de los primeros años de independencia y organización republicana de Chile.',
        wikiTitles: ['José Miguel Carrera', 'Patria Vieja'],
        imageUrl: '',
        imageCandidates: [],
        sourceOrigin: 'Efeméride de Chile',
        sourceUrl: 'https://es.wikipedia.org/wiki/Jos%C3%A9_Miguel_Carrera'
      },
      {
        kind: 'chile',
        year: 1984,
        text: 'El 15 de noviembre de 1984 se fundó oficialmente en Santiago de Chile la comuna de Peñalolén, al pie de la precordillera andina.',
        extract: 'Comuna del sector oriente de la Región Metropolitana de Santiago cuyo nombre proviene del mapudungun.',
        wikiTitles: ['Peñalolén'],
        imageUrl: '',
        imageCandidates: [],
        sourceOrigin: 'Efeméride de Chile',
        sourceUrl: 'https://es.wikipedia.org/wiki/Pe%C3%B1alol%C3%A9n'
      }
    ]
  };

  const chileSearchCache = new Map();

  async function searchChileDateEphemeris(fecha = new Date()) {
    const mm = String(fecha.getMonth() + 1).padStart(2, '0');
    const dd = String(fecha.getDate()).padStart(2, '0');
    const cacheKey = `${mm}-${dd}`;
    if (chileSearchCache.has(cacheKey)) {
      return chileSearchCache.get(cacheKey);
    }

    const curatedToday = Array.isArray(CHILE_CURATED_BY_DATE[cacheKey])
      ? CHILE_CURATED_BY_DATE[cacheKey].map((c) => ({ ...c }))
      : [];

    const dayMonth = `${fecha.getDate()} de ${MONTHS_ES[fecha.getMonth()]}`;
    const listUrl =
      `https://es.wikipedia.org/w/api.php?action=query&list=search` +
      `&srsearch=${encodeURIComponent(`"${dayMonth}" ("en Chile" OR "de Chile" OR "Santiago de Chile")`)}` +
      `&srlimit=10&srprop=snippet&format=json`;

    try {
      const searchRes = await jsonpRequest(listUrl, 3000);
      const hits = Array.isArray(searchRes?.query?.search) ? searchRes.query.search : [];
      const dayRx = new RegExp(`\\b${fecha.getDate()}\\s+de\\s+${MONTHS_ES[fecha.getMonth()]}\\b`, 'i');

      const verifiedHits = hits.filter((h) => {
        const title = String(h?.title || '').trim();
        if (!title || /^\d{1,2} de |^\d{3,4}$|^Anexo:/i.test(title)) return false;
        const snippet = String(h?.snippet || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        return dayRx.test(snippet) && isStrictChileEvent(`${title}: ${snippet}`);
      });

      let wikiItems = [];
      if (verifiedHits.length > 0) {
        const pageIds = verifiedHits.slice(0, 6).map((h) => h.pageid).join('|');
        const detailUrl =
          `https://es.wikipedia.org/w/api.php?action=query&pageids=${pageIds}` +
          `&prop=extracts|pageimages|info&exintro=1&explaintext=1&exchars=340` +
          `&piprop=thumbnail|original&pithumbsize=960&inprop=url&format=json`;
        const detailRes = await jsonpRequest(detailUrl, 3000);
        const pages = Object.values(detailRes?.query?.pages || {});

        for (const p of pages) {
          const title = String(p?.title || '').trim();
          const extract = String(p?.extract || '').replace(/\s+/g, ' ').trim();
          if (!title || !extract) continue;
          const firstSentence = extract.split(/(?<=[.!?])\s+/)[0] || extract;
          if (!isStrictChileEvent(`${title}: ${firstSentence}`)) continue;

          const matchedHit = verifiedHits.find((vh) => vh.pageid === p.pageid);
          const snippetClean = String(matchedHit?.snippet || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
          const yearMatch = `${snippetClean} ${extract}`.match(/\b(1[5-9]\d{2}|20[0-2]\d)\b/);
          const candidates = [];
          if (isUsableWikiPhotoUrl(p?.thumbnail?.source)) candidates.push(p.thumbnail.source);
          const origW = Number(p?.original?.width || 0);
          if (isUsableWikiPhotoUrl(p?.original?.source) && (!origW || origW <= 2600)) {
            candidates.push(p.original.source);
          }

          wikiItems.push({
            kind: 'chile',
            year: yearMatch ? Number(yearMatch[1]) : null,
            text: `${title}: ${snippetClean.length > 40 ? snippetClean : firstSentence}`.slice(0, 270),
            extract: extract.slice(0, 320),
            wikiTitles: [title],
            imageUrl: candidates[0] || '',
            imageCandidates: candidates,
            sourceOrigin: 'Wikipedia Chile',
            sourceUrl: p.fullurl || `https://es.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, '_'))}`
          });
        }
      }

      const merged = [...curatedToday, ...wikiItems];
      if (merged.length) {
        chileSearchCache.set(cacheKey, merged);
      }
      return merged;
    } catch {
      return curatedToday;
    }
  }

  /**
   * Obtiene una efeméride real (Día Internacional / Mundial, Hito Histórico o Chile) para la fecha de hoy.
   */
  async function gatherTodayEphemeris({ fecha = new Date(), focus = 'mixto', recentTexts = [] } = {}) {
    const [pool, extraChile] = await Promise.all([
      loadDayEphemerisPool(fecha).catch(() => ({ holidays: [], events: [], chile: [], dateUrl: '' })),
      focus === 'chile' ? searchChileDateEphemeris(fecha) : Promise.resolve([])
    ]);
    const seen = new Set(recentTexts.map((t) => String(t || '').slice(0, 60).toLowerCase()));

    let candidates = [];
    if (focus === 'chile') {
      const mergedChile = [...(pool.chile || [])];
      const existingKeys = new Set(mergedChile.map((c) => c.text.slice(0, 40).toLowerCase()));
      (extraChile || []).forEach((c) => {
        if (!existingKeys.has(c.text.slice(0, 40).toLowerCase())) mergedChile.push(c);
      });
      candidates = mergedChile;
    } else if (focus === 'mundiales') {
      candidates = pool.holidays.length ? pool.holidays : pool.events;
    } else if (focus === 'historia') {
      candidates = pool.events.length ? pool.events : pool.holidays;
    } else {
      const topHolidays = pool.holidays.slice(0, 8);
      const topEvents = pool.events.slice(0, 14);
      candidates = [...topHolidays, ...topEvents];
    }

    const unseen = candidates.filter((c) => !seen.has(c.text.slice(0, 60).toLowerCase()));
    const finalPool = unseen.length ? unseen : candidates;

    if (finalPool.length > 0) {
      const pickRange = focus === 'mundiales' ? Math.min(finalPool.length, 5) : finalPool.length;
      const picked = finalPool[Math.floor(Math.random() * pickRange)];
      return {
        connected: true,
        item: picked,
        sources: [
          {
            origin: picked.sourceOrigin,
            title: picked.year ? `${picked.year}: ${picked.text.slice(0, 65)}` : picked.text.slice(0, 75),
            url: picked.sourceUrl || pool.dateUrl
          }
        ]
      };
    }

    const chileFallbackItems = [
      {
        kind: 'chile',
        year: 1945,
        text: 'Legado de Gabriela Mistral en Chile: primera persona latinoamericana en recibir el Premio Nobel de Literatura en 1945, voz universal desde el Valle de Elqui.',
        extract: '',
        wikiTitles: ['Gabriela Mistral', 'Valle de Elqui'],
        imageUrl: '',
        imageCandidates: [],
        sourceOrigin: 'Efeméride Cultural de Chile',
        sourceUrl: ''
      },
      {
        kind: 'chile',
        year: 1810,
        text: 'Memoria Republicana y Patrimonio de Chile: desde la Cordillera de los Andes hasta el Pacífico, la historia chilena se construye con resiliencia comunitaria y dignidad.',
        extract: '',
        wikiTitles: ['Cordillera de los Andes', 'Santiago de Chile'],
        imageUrl: '',
        imageCandidates: [],
        sourceOrigin: 'Efeméride de Chile',
        sourceUrl: ''
      },
      {
        kind: 'chile',
        year: null,
        text: 'Arte y Conciencia en Chile (Violeta Parra y el folclore vivo): agradecer a la vida y cuidar la memoria popular sigue uniendo generaciones de norte a sur.',
        extract: '',
        wikiTitles: ['Violeta Parra', 'Chiloé'],
        imageUrl: '',
        imageCandidates: [],
        sourceOrigin: 'Efeméride Cultural de Chile',
        sourceUrl: ''
      }
    ];

    const fallbackItems =
      focus === 'chile'
        ? chileFallbackItems
        : [
            {
              kind: 'mundial',
              year: null,
              text: 'Día Mundial en Recuerdo de las Víctimas y Conciencia Vial: proteger la vida cotidiana empieza con empatía, calma y responsabilidad compartida.',
              extract: '',
              wikiTitles: ['Seguridad vial'],
              imageUrl: '',
              imageCandidates: [],
              sourceOrigin: 'Efeméride de Conciencia',
              sourceUrl: ''
            },
            {
              kind: 'mundial',
              year: null,
              text: 'Conciencia Global y Cuidado del Planeta: cada acción cotidiana responsable construye un mundo más justo, verde y habitable.',
              extract: '',
              wikiTitles: ['Planeta Tierra', 'Ecología'],
              imageUrl: '',
              imageCandidates: [],
              sourceOrigin: 'Efeméride de Conciencia',
              sourceUrl: ''
            },
            {
              kind: 'historia',
              year: 1971,
              text: 'Hito de la Ciencia y la Tecnología Moderna: en noviembre de 1971 el lanzamiento comercial del primer microprocesador (Intel 4004) transformó para siempre la comunicación humana.',
              extract: '',
              wikiTitles: ['Intel 4004', 'Microprocesador'],
              imageUrl: '',
              imageCandidates: [],
              sourceOrigin: 'Efeméride Histórica',
              sourceUrl: ''
            },
            {
              kind: 'mundial',
              year: null,
              text: 'Mes de la Tolerancia, la Filosofía y el Diálogo Humano (ONU/UNESCO): pensar con lucidez y escuchar al distinto es la base de toda paz duradera.',
              extract: '',
              wikiTitles: ['Tolerancia social', 'Filosofía'],
              imageUrl: '',
              imageCandidates: [],
              sourceOrigin: 'Efeméride Cultural ONU',
              sourceUrl: ''
            }
          ];
    const freshFallback = fallbackItems.filter((f) => !seen.has(f.text.slice(0, 60).toLowerCase()));
    const fallbackPool = freshFallback.length ? freshFallback : fallbackItems;
    return {
      connected: false,
      item: fallbackPool[Math.floor(Math.random() * fallbackPool.length)],
      sources: []
    };
  }

  global.OraculoWebPulse = {
    gatherLiveWebContext,
    gatherTodayEphemeris,
    searchEphemerisTopicImages
  };
})(window);
