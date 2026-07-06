// ==UserScript==
// @name         Munpia-Rip V4
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  descargas con soporte TXT/EPUB y unión de capítulos
// @author       EryxZar
// @match        *://novel.munpia.com/*
// @run-at       document-start
// @require      https://unpkg.com/@zip.js/zip.js@2.7.60/dist/zip-full.min.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const esIframe = window.top !== window.self;
    let textoCapturado = false;

    // ======================================================
    // 1. EL INTERCEPTOR AES (HOOK DE MEMORIA EN RAM)
    // ======================================================
    let hookCrypto = setInterval(() => {
        if (window.CryptoJS && window.CryptoJS.AES && window.CryptoJS.AES.decrypt) {
            clearInterval(hookCrypto);
            const originalDecrypt = window.CryptoJS.AES.decrypt;

            window.CryptoJS.AES.decrypt = function() {
                const result = originalDecrypt.apply(this, arguments);
                try {
                    let textoBruto = result.toString(window.CryptoJS.enc.Utf8);

                    if (textoBruto && textoBruto.length > 150 && !textoCapturado) {
                        textoCapturado = true;

                        let textoLimpio = textoBruto
                            .replace(/<\/p>|<br\s*\/?>/gi, '\n')
                            .replace(/<[^>]+>/g, '')
                            .replace(/\n\s*\n/g, '\n\n')
                            .trim();

                        setTimeout(() => enviarDatos(textoLimpio), 100);
                    }
                } catch(e) {}
                return result;
            };
        }
    }, 1);

    setTimeout(() => clearInterval(hookCrypto), 3000);

    window.addEventListener('load', () => {
        const esCapitulo = document.getElementById('viewerType') !== null;

        if (!esCapitulo && !window.location.href.includes('/neSrl/')) {
            iniciarPanelMaestro();
        }
    });

    function enviarDatos(texto) {
        const h4Title = document.querySelector('h4 a');
        let titulo = h4Title ? h4Title.innerText.trim() : "Capitulo";

        console.log(`[EryxZar] Extracción exitosa`);

        if (esIframe) {
            // Enviamos título y texto SEPARADOS (sin combinar) para que el
            // panel maestro decida el formato (txt/epub) más adelante.
            window.parent.postMessage({ tipo: "HO_RIP_DATA", titulo, texto }, "*");
        } else {
            mostrarPanelIndividual(titulo, texto);
        }
    }

    // ======================================================
    // 2. UTILIDADES: XML/EPUB
    // ======================================================
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

    // Genera un EPUB (Blob) a partir de un título de libro y una lista de
    // capítulos [{titulo, texto}]. Sirve tanto para un solo capítulo como
    // para varios capítulos unidos en un mismo libro.
    async function generarEpub(tituloLibro, capitulos) {
        const uuidLibro = generarUUID();
        const zipWriter = new zip.ZipWriter(new zip.BlobWriter("application/epub+zip"));

        // 1. mimetype: debe ir primero y sin comprimir
        await zipWriter.add("mimetype", new zip.TextReader("application/epub+zip"), { level: 0 });

        // 2. META-INF/container.xml
        const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
        await zipWriter.add("META-INF/container.xml", new zip.TextReader(containerXml));

        // 3. Capítulos xhtml
        let manifestItems = "";
        let spineItems = "";
        let navPoints = "";

        capitulos.forEach((cap, i) => {
            const idx = i + 1;
            const chapId = `chap${idx}`;
            const chapFile = `chap${idx}.xhtml`;
            const tituloCap = escaparXml(cap.titulo || `Capítulo ${idx}`);

            manifestItems += `    <item id="${chapId}" href="${chapFile}" media-type="application/xhtml+xml"/>\n`;
            spineItems += `    <itemref idref="${chapId}"/>\n`;
            navPoints += `  <navPoint id="nav-${chapId}" playOrder="${idx}">
    <navLabel><text>${tituloCap}</text></navLabel>
    <content src="${chapFile}"/>
  </navPoint>\n`;
        });

        // 4. Añadir los xhtml al zip (segunda pasada, ya con el contenido armado arriba)
        for (let i = 0; i < capitulos.length; i++) {
            const idx = i + 1;
            const cap = capitulos[i];
            const tituloCap = escaparXml(cap.titulo || `Capítulo ${idx}`);
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

        // 5. content.opf
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

        // 6. toc.ncx
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

    // Crea un zip mixto: entradas = [{name, content}] donde content puede
    // ser un string (texto plano) o un Blob (por ejemplo un epub ya armado).
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

    // ======================================================
    // 3. PANEL INDIVIDUAL (un solo capítulo)
    // ======================================================
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

    // ======================================================
    // 4. PANEL MAESTRO (ANALIZADOR DE ÍNDICE + MULTI-DESCARGA)
    // ======================================================
    function iniciarPanelMaestro() {
        if (document.getElementById('ho-master-panel') || esIframe) return;

        const ui = document.createElement('div');
        ui.id = 'ho-master-panel';
        ui.style = "position:fixed; top:20px; right:20px; z-index:999999; padding:20px; background:#121212; color:white; border-radius:12px; border:2px solid #00e676; width:300px; font-family:sans-serif; box-shadow:0 10px 30px rgba(0,0,0,0.8);";
        ui.innerHTML = `
            <h3 style="margin:0 0 5px 0; color:#00e676; text-align:center;">🚀 Munpia-Rip V4.0</h3>
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
            <div id="ho-st" style="margin-top:10px; font-size:12px; color:#00e676; text-align:center; min-height:20px;">🔍 Analizando índice...</div>
        `;
        document.body.appendChild(ui);

        const status = document.getElementById('ho-st');
        const novelId = window.location.pathname.split('/')[1];
        let todosLosCapitulos = [], capitulosSet = new Set();

        async function analizarIndiceCompleto() {
            let pagina = 1, capituloUnoEncontrado = false;
            while (!capituloUnoEncontrado) {
                try {
                    status.innerText = `🔍 Escaneando página ${pagina}...`;
                    let res = await fetch(`/${novelId}/page/${pagina}`);
                    if (!res.ok) break;
                    let html = await res.text();
                    let doc = new DOMParser().parseFromString(html, 'text/html');
                    let filas = doc.querySelectorAll('table.entries tbody tr:not(.notice)');

                    if (filas.length === 0) break;

                    filas.forEach(f => {
                        let textoNum = f.querySelector('td.index span')?.innerText;
                        if (textoNum) {
                            let n = parseInt(textoNum);
                            let aTag = f.querySelector('td.subject a');
                            if (aTag && aTag.href && !capitulosSet.has(n)) {
                                todosLosCapitulos.push({ n, url: aTag.href });
                                capitulosSet.add(n);
                                if (n === 1) capituloUnoEncontrado = true;
                            }
                        }
                    });
                    if (capituloUnoEncontrado) break;
                    pagina++;
                    if (pagina > 300) break;
                } catch (e) { break; }
            }

            todosLosCapitulos.sort((a, b) => a.n - b.n);
            document.getElementById('ho-contador').innerText = `📚 Encontrados: ${todosLosCapitulos.length} capítulos`;
            document.getElementById('ho-contador').style.display = "block";
            document.getElementById('ho-controles').style.display = "block";
            status.innerText = "✅ Listo.";
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
            if (listaDescarga.length === 0) return status.innerText = "❌ Rango no válido.";

            const btn = document.getElementById('ho-btn');
            btn.disabled = true;

            const CONCURRENCIA = 1; // máximo de capítulos descargándose a la vez
            const MAX_INTENTOS = 1;

            let cola = listaDescarga.slice();       // capítulos pendientes por asignar
            let capturas = [];                       // [{n, titulo, texto}] (orden no garantizado, se ordena al final)
            let fallidos = [];                       // números de capítulo que no se pudieron capturar
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
                    return false; // si no podemos leerlo, no asumimos nada
                }
            }

            function detenerTodoPorCloudflare(numCap) {
                bloqueadoPorCloudflare = true;
                status.innerText = `🛡️ Cloudflare está bloqueando (Cap ${numCap}). Espera unos minutos y reintenta con un rango más chico.`;
                window.removeEventListener("message", onMsg);
                slots.forEach(s => clearTimeout(s.timeoutId));
                btn.disabled = false;
            }

            function cargarEnSlot(slot) {
                const cap = slot.cap;
                actualizarStatus();

                // Pequeño escalonamiento incluso entre los 3 concurrentes,
                // para no disparar las 3 peticiones exactamente al mismo tiempo.
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
                        console.warn(`[EryxZar] Capítulo ${cap.n} falló tras ${MAX_INTENTOS} intentos, saltando.`);
                        fallidos.push(cap.n);
                        asignarSiguiente(slot);
                    } else {
                        cargarEnSlot(slot);
                    }
                }, 7000);
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

                // Reordenamos por número de capítulo: al ser concurrente,
                // pueden haber llegado en cualquier orden.
                capturas.sort((a, b) => a.n - b.n);

                try {
                    if (quiereUnir) {
                        // ---- MODO UNIDO: un solo libro/archivo ----
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
                        // ---- MODO SEPARADO: un archivo por capítulo ----
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
                        : "✅ ¡Éxito Masivo!";
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
