// ==UserScript==
// @name         Munpia-Rip V5
// @namespace    http://tampermonkey.net/
// @version      5.1
// @description  Nueva version.
// @author       EryxZar
// @match        https://www.munpia.com/novel/*/*
// @run-at       document-start
// @require      https://unpkg.com/@zip.js/zip.js@2.7.60/dist/zip-full.min.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const esIframe = window.top !== window.self;

    window.wasmDecryptedLines = [];
    (function hookCanvas() {
        const originalFillText = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function(text, x, y, maxWidth) {
            if (text && typeof text === 'string') {
                const trimmed = text.trim();
                if (trimmed.length > 0 && !trimmed.startsWith('〈')) {
                    window.wasmDecryptedLines.push({
                        text: trimmed,
                        x: x,
                        y: y,
                        font: this.font || ''
                    });
                }
            }
            return originalFillText.apply(this, arguments);
        };
    })();

    window.addEventListener('load', () => {
        const esCapitulo = window.location.pathname.includes('/novel/viewer/');

        if (esCapitulo) {
            iniciarExtraccionCapitulo();
        } else if (!esIframe && !window.location.href.includes('/neSrl/')) {
            iniciarPanelMaestro();
        }
    });

    let yaProcesado = false;

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ====================================================
    // FIX V5.1 (Author: EryxZar): misma logica que se aplico en la
    // version Python. Antes se esperaba un fijo de 4000ms a ciegas
    // asumiendo que el capitulo entero ya habia renderizado sin
    // necesidad de avanzar de pagina/scroll. Eso dejaba capitulos
    // largos (paginados con _pageOverlayBtn_ o de scroll continuo con
    // _scrollContainer_) incompletos siempre que superaran esos 4s.
    // Ahora se hace scroll/click activo, cada 50ms, y se corta con un
    // "periodo de gracia" de 800ms: apenas se detecta que ya no hay
    // mas para avanzar (boton deshabilitado, scroll al fondo, o
    // aparicion del nav de fin de capitulo _episodeNav_) se espera un
    // poco mas por si el canvas todavia esta terminando de pintar; si
    // en ese lapso sigue entrando texto nuevo, se reinicia la espera.
    // ====================================================
    function avanzarPagina() {
        const btns = document.querySelectorAll('[class*="_pageOverlayBtn_"]');
        let clicked = false;
        let atLastPage = false;
        const episodeNav = document.querySelector('[class*="_episodeNav_"]');

        if (btns.length >= 2) {
            const btnDerecho = btns[btns.length - 1];
            if (btnDerecho) {
                if (btnDerecho.disabled) {
                    atLastPage = true;
                } else {
                    btnDerecho.click();
                    clicked = true;
                }
            }
        } else {
            const scrollDiv = document.querySelector('[class*="_scrollContainer_"]');
            if (scrollDiv) {
                const atBottom = (scrollDiv.scrollTop + scrollDiv.clientHeight) >= (scrollDiv.scrollHeight - 2);
                if (atBottom) {
                    atLastPage = true;
                } else {
                    scrollDiv.scrollBy(0, 1200);
                    clicked = true;
                }
            }
        }

        return { clicked, atLastPage, episodeNavPresent: !!episodeNav };
    }

    async function iniciarExtraccionCapitulo() {
        // Espera inicial para que el primer render del canvas ya haya
        // arrancado antes de empezar a scrollear/clickear.
        await sleep(1200);

        const POLL_INTERVAL = 50;   // 50ms entre chequeos
        const GRACE_PERIOD = 800;   // colchon tras "parece que ya termino"
        const MAX_TOTAL = 18000;    // tope duro, con margen bajo el timeout
                                     // de 23s del panel maestro (ver abajo)
        let lastLen = -1;
        let elapsed = 0;
        let graceDeadline = null;

        while (elapsed < MAX_TOTAL) {
            if (yaProcesado) return; // por si ya nos mato el timeout del panel maestro

            let navResult;
            try {
                navResult = avanzarPagina();
            } catch (e) {
                break;
            }

            await sleep(POLL_INTERVAL);
            elapsed += POLL_INTERVAL;

            const currentLen = (window.wasmDecryptedLines || []).length;
            const grew = currentLen !== lastLen;
            lastLen = currentLen;

            const noMoreToAdvance = navResult.atLastPage || navResult.episodeNavPresent || !navResult.clicked;

            if (noMoreToAdvance) {
                if (graceDeadline === null || grew) {
                    // Recien se detecto el posible final, o siguio
                    // entrando texto nuevo durante el periodo de gracia:
                    // todavia esta renderizando, se reinicia el colchon.
                    graceDeadline = elapsed + GRACE_PERIOD;
                } else if (elapsed >= graceDeadline) {
                    // Se cumplio el periodo de gracia sin que entrara
                    // nada nuevo: ahi si se termino de verdad.
                    break;
                }
            } else {
                graceDeadline = null;
            }
        }

        finalizarExtraccion();
    }

    function finalizarExtraccion() {
        if (yaProcesado) return;
        yaProcesado = true;
        try {
            const resultado = procesarLineasCanvas(window.wasmDecryptedLines || []);
            if (!resultado || !resultado.texto) {
                console.warn('[EryxZar] Capitulo vacio o fallo en extraccion.');
                return;
            }
            enviarDatos(resultado.titulo, resultado.texto);
        } catch (e) {
            console.error('[EryxZar] Error procesando capitulo:', e);
        }
    }

    function procesarLineasCanvas(rawItems) {
        if (!rawItems || rawItems.length === 0) return null;

        const cssRegex = /^(2d|top|left|right|bottom|middle|center|#(?:[0-9a-fA-F]{3}){1,2}|rgba?\(.*?\)|none|\d+(?:\.\d+)?px\s+.*?)$/i;
        const encuestasRegex = /^(\d+대(\s*이상)?|\d{1,3})$/;

        const filtered = rawItems.filter(it => {
            const t = (it.text || '').trim();
            if (!t) return false;
            if (t.startsWith('http')) return false;
            if (cssRegex.test(t)) return false;
            if (encuestasRegex.test(t)) return false;
            return true;
        });

        if (filtered.length === 0) return null;

        const blocks = [];
        let currentBlock = [];
        let lastY = null;
        for (const item of filtered) {
            if (lastY !== null && item.y < lastY - 1.0) {
                blocks.push(currentBlock);
                currentBlock = [];
            }
            currentBlock.push(item);
            lastY = item.y;
        }
        if (currentBlock.length) blocks.push(currentBlock);

        const keptBlocks = [];
        for (const b of blocks) {
            const texts = b.map(it => it.text);
            if (keptBlocks.length) {
                const prevTexts = keptBlocks[keptBlocks.length - 1].map(it => it.text);
                if (JSON.stringify(texts) === JSON.stringify(prevTexts)) continue;
            }
            keptBlocks.push(b);
        }

        const flatItems = [];
        const blockStartIdx = new Set();
        for (const b of keptBlocks) {
            blockStartIdx.add(flatItems.length);
            flatItems.push(...b);
        }
        if (flatItems.length === 0) return null;

        const visualLines = [];
        let curLine = [flatItems[0]];
        let curIsBlockStart = blockStartIdx.has(0);
        for (let i = 1; i < flatItems.length; i++) {
            const it = flatItems[i];
            const startsBlock = blockStartIdx.has(i);
            if (!startsBlock && Math.abs(it.y - curLine[curLine.length - 1].y) < 2.0) {
                curLine.push(it);
            } else {
                visualLines.push({ items: curLine, blockStart: curIsBlockStart });
                curLine = [it];
                curIsBlockStart = startsBlock;
            }
        }
        visualLines.push({ items: curLine, blockStart: curIsBlockStart });

        const lines = visualLines.map(vl => ({
            x: vl.items[0].x,
            y: vl.items[0].y,
            text: vl.items.map(f => f.text).join(' '),
            blockStart: vl.blockStart
        }));

        const CONTINUATION_X_THRESHOLD = 60.0;
        const TIGHT_Y_THRESHOLD = 45.0;

        const finalParagraphs = [lines[0].text];
        let prevY = lines[0].y;
        for (let i = 1; i < lines.length; i++) {
            const ln = lines[i];
            if (ln.x < CONTINUATION_X_THRESHOLD) {
                finalParagraphs[finalParagraphs.length - 1] += ln.text;
            } else if (ln.blockStart) {
                finalParagraphs.push(ln.text);
            } else {
                const delta = ln.y - prevY;
                if (delta > 0 && delta <= TIGHT_Y_THRESHOLD) {
                    finalParagraphs[finalParagraphs.length - 1] += '\n' + ln.text;
                } else {
                    finalParagraphs.push(ln.text);
                }
            }
            prevY = ln.y;
        }

        const textoFinal = finalParagraphs.join('\n\n');

        const rawTitleEl = document.querySelector('[class*="_episodeTitle_"]');
        const rawTitle = rawTitleEl ? rawTitleEl.innerText.trim() : '';
        let chapterTitle = rawTitle ? rawTitle.replace(/^\d+\.\s*/, '').trim() : '';

        if (!chapterTitle) {
            const h4Title = document.querySelector('h4 a');
            chapterTitle = h4Title ? h4Title.innerText.trim() : 'Capitulo';
        }

        return { titulo: chapterTitle, texto: textoFinal };
    }

    function enviarDatos(titulo, texto) {
        console.log(`[EryxZar] Extraccion exitosa: ${titulo}`);

        if (esIframe) {
            window.parent.postMessage({ tipo: "HO_RIP_DATA", titulo, texto }, "*");
        } else {
            mostrarPanelIndividual(titulo, texto);
        }
    }

    function escaparXml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    function generarUUID() {
        if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    function textoAParrafosXhtml(texto) {
        return texto.split(/\n{2,}/)
            .map(p => p.trim())
            .filter(p => p.length > 0)
            .map(p => `<p>${escaparXml(p).replace(/\n/g, '<br/>')}</p>`)
            .join('\n');
    }

    async function generarEpub(tituloLibro, capitulos) {
        const uuidLibro = generarUUID();
        const zipWriter = new zip.ZipWriter(new zip.BlobWriter("application/epub+zip"));

        await zipWriter.add("mimetype", new zip.TextReader("application/epub+zip"), { level: 0 });

        const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
        await zipWriter.add("META-INF/container.xml", new zip.TextReader(containerXml));

        let manifestItems = "";
        let spineItems = "";
        let navPoints = "";

        capitulos.forEach((cap, i) => {
            const idx = i + 1;
            const chapId = `chap${idx}`;
            const chapFile = `chap${idx}.xhtml`;
            const tituloCap = escaparXml(cap.titulo || `Capitulo ${idx}`);

            manifestItems += `    <item id="${chapId}" href="${chapFile}" media-type="application/xhtml+xml"/>\n`;
            spineItems += `    <itemref idref="${chapId}"/>\n`;
            navPoints += `  <navPoint id="nav-${chapId}" playOrder="${idx}">
    <navLabel><text>${tituloCap}</text></navLabel>
    <content src="${chapFile}"/>
  </navPoint>\n`;
        });

        for (let i = 0; i < capitulos.length; i++) {
            const idx = i + 1;
            const cap = capitulos[i];
            const tituloCap = escaparXml(cap.titulo || `Capitulo ${idx}`);
            const xhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${tituloCap}</title><meta charset="utf-8"/></head>
<body>
<h1>${tituloCap}</h1>
${textoAParrafosXhtml(cap.texto)}
</body>
</html>`;
            await zipWriter.add(`OEBPS/chap${idx}.xhtml`, new zip.TextReader(xhtml));
        }

        const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${escaparXml(tituloLibro)}</dc:title>
    <dc:language>es</dc:language>
    <dc:identifier id="BookId">urn:uuid:${uuidLibro}</dc:identifier>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
${manifestItems}  </manifest>
  <spine toc="ncx">
${spineItems}  </spine>
</package>`;
        await zipWriter.add("OEBPS/content.opf", new zip.TextReader(contentOpf));

        const tocNcx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:uuid:${uuidLibro}"/></head>
  <docTitle><text>${escaparXml(tituloLibro)}</text></docTitle>
  <navMap>
${navPoints}  </navMap>
</ncx>`;
        await zipWriter.add("OEBPS/toc.ncx", new zip.TextReader(tocNcx));

        return await zipWriter.close();
    }

    async function crearZipMixto(entradas, nombreZip) {
        const zipWriter = new zip.ZipWriter(new zip.BlobWriter("application/zip"));
        for (const e of entradas) {
            const reader = (e.content instanceof Blob) ? new zip.BlobReader(e.content) : new zip.TextReader(e.content);
            await zipWriter.add(e.name, reader);
        }
        const blob = await zipWriter.close();
        descargarBlob(blob, nombreZip);
    }

    function descargarBlob(blob, nombre) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = nombre;
        a.click();
    }

    function nombreSeguro(str) {
        return String(str).replace(/[\\/:*?"<>|]/g, '');
    }

    function mostrarPanelIndividual(titulo, texto) {
        if (document.getElementById('ho-single-panel')) return;
        const ui = document.createElement('div');
        ui.id = 'ho-single-panel';
        ui.style = "position:fixed; top:20px; left:20px; z-index:999999; padding:15px; background:#121212; color:white; border-radius:8px; border:2px solid #ff3d00; text-align:center; font-family:sans-serif; box-shadow:0 10px 30px rgba(0,0,0,0.8); width:220px;";
        ui.innerHTML = `
            <div style="color:#00e676; font-weight:bold; margin-bottom:10px;">✅ Captura Lista</div>
            <div style="text-align:left; font-size:13px; margin-bottom:10px;">
                <label style="display:block; margin-bottom:5px;"><input type="checkbox" id="ho-ind-txt" checked> TXT</label>
                <label style="display:block;"><input type="checkbox" id="ho-ind-epub"> EPUB</label>
            </div>
            <button id="ho-dl-single" style="width:100%; padding:10px; background:#ff3d00; color:white; font-weight:bold; border:none; border-radius:4px; cursor:pointer;">💾 Descargar</button>
        `;
        document.body.appendChild(ui);

        document.getElementById('ho-dl-single').onclick = async () => {
            const quiereTxt = document.getElementById('ho-ind-txt').checked;
            const quiereEpub = document.getElementById('ho-ind-epub').checked;
            if (!quiereTxt && !quiereEpub) return alert("Selecciona al menos un formato.");

            const nombre = nombreSeguro(titulo || "Capitulo");
            const contenidoTxt = (titulo ? titulo + "\n\n" : "") + texto;

            if (quiereTxt && quiereEpub) {
                const epubBlob = await generarEpub(titulo, [{ titulo, texto }]);
                await crearZipMixto([
                    { name: `TXT/${nombre}.txt`, content: contenidoTxt },
                    { name: `EPUB/${nombre}.epub`, content: epubBlob }
                ], `${nombre}.zip`);
            } else if (quiereTxt) {
                const blob = new Blob([contenidoTxt], { type: 'text/plain;charset=utf-8' });
                descargarBlob(blob, `${nombre}.txt`);
            } else if (quiereEpub) {
                const epubBlob = await generarEpub(titulo, [{ titulo, texto }]);
                descargarBlob(epubBlob, `${nombre}.epub`);
            }
        };
    }

    function iniciarPanelMaestro() {
        if (document.getElementById('ho-master-panel') || esIframe) return;

        const ui = document.createElement('div');
        ui.id = 'ho-master-panel';
        ui.style = "position:fixed; top:20px; right:20px; z-index:999999; padding:20px; background:#121212; color:white; border-radius:12px; border:2px solid #00e676; width:300px; font-family:sans-serif; box-shadow:0 10px 30px rgba(0,0,0,0.8);";
        ui.innerHTML = `
            <h3 style="margin:0 0 5px 0; color:#00e676; text-align:center;">🚀 Munpia-Rip V5.0</h3>
            <p style="font-size:11px; color:#888; text-align:center; margin-bottom:10px;">AUTHOR: ERYXZAR</p>
            <p id="ho-contador" style="font-size:14px; color:#ffeb3b; text-align:center; margin-bottom:15px; font-weight:bold; display:none;"></p>
            <div id="ho-controles" style="display:none;">
                <input type="text" id="ho-input" placeholder="Ej: 1-10 o 5,10,15" style="width:100%; padding:10px; background:#222; border:1px solid #444; color:white; border-radius:6px; margin-bottom:10px; box-sizing:border-box;">
                <div style="text-align:left; font-size:13px; margin-bottom:10px; padding-left:2px;">
                    <label style="display:block; margin-bottom:5px;"><input type="checkbox" id="ho-chk-txt" checked> TXT</label>
                    <label style="display:block; margin-bottom:5px;"><input type="checkbox" id="ho-chk-epub"> EPUB</label>
                    <label style="display:block;"><input type="checkbox" id="ho-chk-unir"> Unir en un solo archivo</label>
                </div>
                <button id="ho-btn" style="width:100%; padding:12px; background:#00e676; color:black; font-weight:bold; border:none; border-radius:6px; cursor:pointer;">GENERAR</button>
            </div>
            <div id="ho-st" style="margin-top:10px; font-size:12px; color:#00e676; text-align:center; min-height:20px;">🔍 Analizando indice...</div>
        `;
        document.body.appendChild(ui);

        const status = document.getElementById('ho-st');

        const novelIdMatch = window.location.pathname.match(/(?:novel\/detail\/|\/)(\d+)/);
        const novelId = novelIdMatch ? novelIdMatch[1] : null;

        let todosLosCapitulos = [], capitulosSet = new Set();

        async function analizarIndiceCompleto() {
            if (!novelId) {
                status.innerText = "❌ No se pudo detectar el ID de la novela.";
                return;
            }

            let pagina = 1;
            while (true) {
                try {
                    status.innerText = `🔍 Escaneando pagina ${pagina}...`;
                    let res = await fetch(`https://www.munpia.com/api/v1/pc/novel-detail/${novelId}/chapters?order=ENTRY_OLD&page=${pagina}&size=100`);
                    if (!res.ok) break;
                    let json = await res.json();
                    const lista = json && json.result && json.result.list;
                    if (!lista || lista.length === 0) break;

                    lista.forEach(c => {
                        if (!capitulosSet.has(c.num)) {
                            todosLosCapitulos.push({
                                n: c.num,
                                url: `https://www.munpia.com/novel/viewer/${novelId}/${c.id}`,
                                titulo: c.title
                            });
                            capitulosSet.add(c.num);
                        }
                    });

                    pagina++;
                    if (pagina > 500) break;
                } catch (e) {
                    break;
                }
            }

            todosLosCapitulos.sort((a, b) => a.n - b.n);
            document.getElementById('ho-contador').innerText = `📚 Encontrados: ${todosLosCapitulos.length} capitulos`;
            document.getElementById('ho-contador').style.display = "block";
            document.getElementById('ho-controles').style.display = "block";
            status.innerText = todosLosCapitulos.length ? "✅ Listo." : "❌ No se encontraron capitulos.";
        }

        analizarIndiceCompleto();

        document.getElementById('ho-btn').onclick = async function() {
            const val = document.getElementById('ho-input').value.trim();
            if (!val) return alert("Ingresa un rango.");

            const quiereTxt = document.getElementById('ho-chk-txt').checked;
            const quiereEpub = document.getElementById('ho-chk-epub').checked;
            const quiereUnir = document.getElementById('ho-chk-unir').checked;

            if (!quiereTxt && !quiereEpub) return alert("Selecciona al menos un formato (TXT o EPUB).");

            let targetNums = new Set();
            val.split(',').forEach(p => {
                if (p.includes('-')) {
                    let [s, e] = p.split('-').map(n => parseInt(n.trim()));
                    for (let i = s; i <= e; i++) targetNums.add(i);
                } else {
                    let n = parseInt(p.trim());
                    if (!isNaN(n)) targetNums.add(n);
                }
            });

            let listaDescarga = todosLosCapitulos.filter(cap => targetNums.has(cap.n));
            if (listaDescarga.length === 0) return status.innerText = "❌ Rango no valido.";

            const btn = document.getElementById('ho-btn');
            btn.disabled = true;

            const CONCURRENCIA = 3;
            const MAX_INTENTOS = 3;
            // FIX: subido de 11000 a 23000. La extraccion por capitulo ahora
            // hace scroll/click activo con un tope duro de 18000ms mas
            // 1200ms de espera inicial (ver iniciarExtraccionCapitulo). Con
            // los 11000ms viejos, el panel maestro mataba el iframe antes de
            // que terminara de scrollear un capitulo largo y lo reintentaba
            // sin necesidad (o lo daba por fallido).
            const TIMEOUT_POR_INTENTO = 23000;

            let cola = listaDescarga.slice();
            let capturas = [];
            let fallidos = [];
            let bloqueadoPorCloudflare = false;

            const slots = [];
            for (let s = 0; s < CONCURRENCIA; s++) {
                const iframe = document.createElement('iframe');
                iframe.style = "position:fixed; width:1px; height:1px; opacity:0; pointer-events:none; border:0; left:-9999px; top:-9999px;";
                document.body.appendChild(iframe);
                slots.push({ iframe, timeoutId: null, intentos: 0, cap: null });
            }

            function actualizarStatus() {
                const enCurso = slots.filter(s => s.cap).map(s => s.cap.n);
                status.innerText = `📥 ${capturas.length + fallidos.length}/${listaDescarga.length} completados (en curso: ${enCurso.join(', ') || '-'})`;
            }

            function pareceCloudflare(iframe) {
                try {
                    const doc = iframe.contentDocument;
                    if (!doc) return false;
                    const titulo = (doc.title || "").toLowerCase();
                    const cuerpo = (doc.body ? doc.body.innerText : "").toLowerCase().slice(0, 500);
                    return titulo.includes("just a moment") ||
                           titulo.includes("attention required") ||
                           titulo.includes("un momento") ||
                           cuerpo.includes("cloudflare") ||
                           cuerpo.includes("verifying you are human") ||
                           !!doc.querySelector('#cf-wrapper, .cf-turnstile, #challenge-form');
                } catch (e) {
                    return false;
                }
            }

            function detenerTodoPorCloudflare(numCap) {
                bloqueadoPorCloudflare = true;
                status.innerText = `🛡️ Cloudflare esta bloqueando (Cap ${numCap}). Espera unos minutos y reintenta con un rango mas chico.`;
                window.removeEventListener("message", onMsg);
                slots.forEach(s => clearTimeout(s.timeoutId));
                btn.disabled = false;
            }

            function cargarEnSlot(slot) {
                const cap = slot.cap;
                actualizarStatus();

                const espera = 300 + Math.random() * 600;

                slot.iframe.src = "about:blank";
                setTimeout(() => {
                    if (bloqueadoPorCloudflare) return;
                    slot.iframe.src = cap.url;
                }, espera);

                clearTimeout(slot.timeoutId);
                slot.timeoutId = setTimeout(() => {
                    if (bloqueadoPorCloudflare) return;

                    if (pareceCloudflare(slot.iframe)) {
                        detenerTodoPorCloudflare(cap.n);
                        return;
                    }

                    slot.intentos++;
                    if (slot.intentos >= MAX_INTENTOS) {
                        console.warn(`[EryxZar] Capitulo ${cap.n} fallo tras ${MAX_INTENTOS} intentos, saltando.`);
                        fallidos.push(cap.n);
                        asignarSiguiente(slot);
                    } else {
                        cargarEnSlot(slot);
                    }
                }, TIMEOUT_POR_INTENTO);
            }

            function asignarSiguiente(slot) {
                if (bloqueadoPorCloudflare) return;
                if (cola.length === 0) {
                    slot.cap = null;
                    verificarFin();
                    return;
                }
                slot.cap = cola.shift();
                slot.intentos = 0;
                cargarEnSlot(slot);
            }

            function verificarFin() {
                if (bloqueadoPorCloudflare) return;
                if (cola.length === 0 && slots.every(s => s.cap === null)) {
                    slots.forEach(s => s.iframe.remove());
                    finalizarDescarga();
                }
            }

            const onMsg = (e) => {
                if (e.data.tipo !== "HO_RIP_DATA") return;
                const slot = slots.find(s => s.iframe.contentWindow === e.source);
                if (!slot || !slot.cap) return;

                clearTimeout(slot.timeoutId);
                capturas.push({ n: slot.cap.n, titulo: e.data.titulo, texto: e.data.texto });
                asignarSiguiente(slot);
            };

            async function finalizarDescarga() {
                window.removeEventListener("message", onMsg);
                status.innerText = "📦 Generando archivos...";

                capturas.sort((a, b) => a.n - b.n);

                try {
                    if (quiereUnir) {
                        if (quiereTxt && quiereEpub) {
                            const txtCombinado = capturas.map(c => `${c.titulo}\n\n${c.texto}`).join('\n\n\n');
                            const epubBlob = await generarEpub(val, capturas);
                            await crearZipMixto([
                                { name: `${val}.txt`, content: txtCombinado },
                                { name: `${val}.epub`, content: epubBlob }
                            ], `${val}.zip`);
                        } else if (quiereTxt) {
                            const txtCombinado = capturas.map(c => `${c.titulo}\n\n${c.texto}`).join('\n\n\n');
                            const blob = new Blob([txtCombinado], { type: 'text/plain;charset=utf-8' });
                            descargarBlob(blob, `${val}.txt`);
                        } else if (quiereEpub) {
                            const epubBlob = await generarEpub(val, capturas);
                            descargarBlob(epubBlob, `${val}.epub`);
                        }
                    } else {
                        if (quiereTxt && quiereEpub) {
                            let entradas = [];
                            for (const c of capturas) {
                                entradas.push({ name: `TXT/Capitulo ${c.n}.txt`, content: `${c.titulo}\n\n${c.texto}` });
                                const epubBlob = await generarEpub(c.titulo, [c]);
                                entradas.push({ name: `EPUB/Capitulo ${c.n}.epub`, content: epubBlob });
                            }
                            await crearZipMixto(entradas, `${val}.zip`);
                        } else if (quiereTxt) {
                            let entradas = capturas.map(c => ({ name: `Capitulo ${c.n}.txt`, content: `${c.titulo}\n\n${c.texto}` }));
                            await crearZipMixto(entradas, `${val}.zip`);
                        } else if (quiereEpub) {
                            let entradas = [];
                            for (const c of capturas) {
                                const epubBlob = await generarEpub(c.titulo, [c]);
                                entradas.push({ name: `Capitulo ${c.n}.epub`, content: epubBlob });
                            }
                            await crearZipMixto(entradas, `${val}.zip`);
                        }
                    }
                    status.innerText = fallidos.length
                        ? `⚠️ Listo, pero fallaron: ${fallidos.join(', ')}`
                        : "✅ ¡Exito Masivo!";
                } catch (err) {
                    console.error(err);
                    status.innerText = "❌ Error generando archivos.";
                } finally {
                    btn.disabled = false;
                }
            }

            window.addEventListener("message", onMsg);
            slots.forEach(slot => asignarSiguiente(slot));
        };
    }
})();
