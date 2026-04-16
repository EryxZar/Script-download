// ==UserScript==
// @name         Tappytoon-Rip
// @namespace    http://tampermonkey.net/
// @version      4.5
// @author       EryxZar
// @match        https://*.tappytoon.com/*
// @require      https://unpkg.com/@zip.js/zip.js@2.7.60/dist/zip-full.min.js
// @grant        GM_xmlhttpRequest
// @connect      content-repository-cdn.tappytoon.com
// @connect      api-global.tappytoon.com
// @connect      tappytoon.com
// ==/UserScript==

(function() {
    'use strict';

    // --- ESTILOS ---
    const style = document.createElement('style');
    style.innerHTML = `
        :root { --accent: #2e7d32; --bg: #fff; --text: #212121; --border: #898ea4; --accent-bg: #f5f7ff; }
        @media (prefers-color-scheme: dark) { :root { --bg: #212121; --text: #dcdcdc; --accent: #4caf50; --accent-bg: #2b2b2b; } }
        #ez-panel { position: fixed; top: 15px; right: 15px; z-index: 100000; background: var(--bg); color: var(--text);
                   padding: 15px; border: 2px solid var(--accent); border-radius: 8px; width: 310px;
                   font-family: sans-serif; box-shadow: 0 4px 15px rgba(0,0,0,0.5); }
        #ez-panel h3 { margin: 0 0 10px 0; font-size: 16px; text-align: center; color: var(--accent); border-bottom: 1px solid var(--border); padding-bottom: 5px; }
        #ez-panel table { width: 100%; font-size: 13px; border-spacing: 0 8px; }
        #ez-panel input[type="text"], #ez-panel input[type="number"] { width: 100%; box-sizing: border-box; background: var(--accent-bg); color: var(--text); border: 1px solid var(--border); border-radius: 4px; padding: 5px; }
        #ez-panel button { width: 100%; margin-top: 10px; padding: 10px; background: var(--accent); color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; }
        #ez-panel button:disabled { background: #666; cursor: not-allowed; }
        .status-log { font-size: 11px; margin-top: 10px; color: var(--accent); text-align: center; font-weight: bold; min-height: 15px; word-wrap: break-word; white-space: pre-line; }
        .tab-left { font-weight: bold; width: 95px; }
    `;
    document.head.appendChild(style);

    // --- FUNCIONES CORE ---
    async function fetchImage(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET", url: url, responseType: "blob",
                onload: (r) => r.status === 200 ? resolve(r.response) : reject(r.status),
                onerror: reject
            });
        });
    }

    async function blobToImg(blob) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.src = URL.createObjectURL(blob);
        });
    }

    async function mergeAndAdd(writer, imgs, totalH, count, folderPrefix = "") {
        if (imgs.length === 0) return;
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        canvas.width = imgs[0].width;
        canvas.height = totalH;
        let y = 0;
        for (const i of imgs) {
            ctx.drawImage(i, 0, y);
            y += i.height;
            URL.revokeObjectURL(i.src);
        }
        const mergedBlob = await new Promise(r => canvas.toBlob(r, "image/jpeg", 0.85));
        const fileName = `${folderPrefix}${String(count).padStart(3, '0')}.jpg`;
        await writer.add(fileName, new zip.BlobReader(mergedBlob));
    }

    async function fetchAndZipImages(baseUrl, hLimit, stitch, folderPrefix, zipWriter, statusEl, logPrefix) {
        let i = 1, errs = 0, currentGroup = [], currentH = 0, groupCount = 1;

        while (i <= 500) {
            if (statusEl) statusEl.innerText = `${logPrefix}\nObteniendo pág ${i}...`;
            try {
                const blob = await fetchImage(`${baseUrl}${i}.jpeg`);
                if (stitch) {
                    const img = await blobToImg(blob);
                    if (currentH + img.height > hLimit && currentGroup.length > 0) {
                        if (statusEl) statusEl.innerText = `${logPrefix}\nUniendo bloque ${groupCount}...`;
                        await mergeAndAdd(zipWriter, currentGroup, currentH, groupCount++, folderPrefix);
                        currentGroup = []; currentH = 0;
                    }
                    currentGroup.push(img);
                    currentH += img.height;
                } else {
                    const fileName = `${folderPrefix}${String(i).padStart(3, '0')}.jpg`;
                    await zipWriter.add(fileName, new zip.BlobReader(blob));
                }
                errs = 0;
            } catch (e) {
                errs++;
                if (errs >= 2) break;
            }
            i++;
        }

        if (currentGroup.length > 0) await mergeAndAdd(zipWriter, currentGroup, currentH, groupCount, folderPrefix);
    }

    function getComicId() {
        let comicId = null;
        const nextDataStr = document.getElementById('__NEXT_DATA__')?.textContent;
        if (nextDataStr) {
            try {
                const data = JSON.parse(nextDataStr);
                if (data.props?.pageProps?.comic?.id) comicId = data.props.pageProps.comic.id;
                else {
                    const strMatch = nextDataStr.match(/"comicId":(\d+)/);
                    if (strMatch) comicId = strMatch[1];
                }
            } catch(e){}
        }
        if (!comicId) {
            const htmlMatch = document.documentElement.innerHTML.match(/"comicId":(\d+)/);
            if (htmlMatch) comicId = htmlMatch[1];
        }
        if (!comicId) {
            const userPrompt = prompt("No pude detectar el ID del cómic automáticamente.\nIngresa el ID numérico:", "");
            if (userPrompt && !isNaN(parseInt(userPrompt))) comicId = parseInt(userPrompt);
        }
        return comicId;
    }

    async function getBaseUrlForChapter(chapterId) {
        return new Promise((resolve) => {
            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            const locale = window.location.pathname.split('/')[1] || 'en';
            iframe.src = `/${locale}/chapters/${chapterId}`;
            document.body.appendChild(iframe);

            let attempts = 0;
            const interval = setInterval(() => {
                try {
                    const img = iframe.contentDocument.querySelector('img[src*="content-repository-cdn.tappytoon.com"]');
                    if (img) {
                        clearInterval(interval);
                        document.body.removeChild(iframe);
                        const src = img.src;
                        resolve(src.substring(0, src.lastIndexOf('/') + 1));
                        return;
                    }
                } catch(e) {}

                attempts++;
                if (attempts > 40) {
                    clearInterval(interval);
                    document.body.removeChild(iframe);
                    resolve(null);
                }
            }, 500);
        });
    }

    // --- FUNCIONES DE OBTENCIÓN DE CAPÍTULOS ---

    // Método 1: API Directa
    async function fetchChaptersApi(comicId, locale) {
        const url = `https://api-global.tappytoon.com/comics/${comicId}/chapters?excludes=wait_until_free&filter=visits&includes=pagination,restricted&skipAgeRatingRestriction=true&limit=1000&locale=${locale}`;
        let token = "";
        for (let i = 0; i < localStorage.length; i++) {
            let key = localStorage.key(i);
            if (key.toLowerCase().includes("token") || key.toLowerCase().includes("auth")) {
                let val = localStorage.getItem(key);
                if (val && val.includes("Bearer ")) { token = val; break; }
                if (val && val.startsWith("ey")) { token = `Bearer ${val}`; break; }
                try { let parsed = JSON.parse(val); if (parsed.accessToken) { token = `Bearer ${parsed.accessToken}`; break; } } catch(e){}
            }
        }
        const headers = { "Accept": "application/json", "x-client-platform": "web" };
        if (token) headers["Authorization"] = token;
        const res = await fetch(url, { headers, credentials: "include" });
        if (!res.ok) throw new Error(`API respondió con código ${res.status}`);
        const data = await res.json();
        if (Array.isArray(data)) return data;
        if (data && data.items && Array.isArray(data.items)) return data.items;
        if (data && data.chapters && Array.isArray(data.chapters)) return data.chapters;
        throw new Error("Formato JSON de la API no reconocido.");
    }

    // Método 2: Memoria Next.js
    function getChaptersFromNextData() {
        const nextDataStr = document.getElementById('__NEXT_DATA__')?.textContent;
        if (!nextDataStr) return null;
        try {
            const data = JSON.parse(nextDataStr);
            let foundChapters = [];
            function search(obj) {
                if (Array.isArray(obj) && obj.length > 0 && obj[0].id && obj[0].title && obj[0].hasOwnProperty('isAccessible')) {
                    foundChapters = obj;
                    return true;
                }
                if (obj !== null && typeof obj === 'object') {
                    for (let key in obj) { if (search(obj[key])) return true; }
                }
                return false;
            }
            search(data);
            if (foundChapters.length > 0) {
                foundChapters.sort((a, b) => a.order - b.order);
                return foundChapters;
            }
        } catch(e) {}
        return null;
    }

    // Método 3: ESCANEO DOM (Basado en el HTML que proporcionaste)
    function getChaptersFromDOM() {
        const chapters = [];
        // Busca todas las imágenes que pertenecen a los "episodios" en la lista HTML
        const imgs = document.querySelectorAll('img[src*="/episode/"]');

        imgs.forEach((img, index) => {
            // Extrae el ID numérico de la URL (ej: /episode/705275058/ -> 705275058)
            const match = img.src.match(/\/episode\/(\d+)\//);
            if (match) {
                const id = parseInt(match[1]);
                let title = `Episode ${index + 1}`; // Título por defecto

                // Intenta buscar el texto real del episodio ("Episode 1", "Episode 2", etc.)
                let parent = img.parentElement;
                let attempts = 0;
                while (parent && attempts < 6) {
                    if (parent.getAttribute('tabindex') === '0' || parent.innerText.toLowerCase().includes('episode') || parent.innerText.toLowerCase().includes('cap')) {
                        const texts = parent.innerText.split('\n');
                        const foundTitle = texts.find(t => t.toLowerCase().includes('episode') || t.toLowerCase().includes('capítulo'));
                        if (foundTitle) title = foundTitle.trim();
                        break;
                    }
                    parent = parent.parentElement;
                    attempts++;
                }

                chapters.push({ id: id, title: title, isAccessible: true, order: index });
            }
        });

        // Limpiar duplicados si la página renderiza imágenes dobles
        const uniqueChapters = [];
        const seen = new Set();
        chapters.forEach(c => {
            if (!seen.has(c.id)) {
                seen.add(c.id);
                uniqueChapters.push(c);
            }
        });

        return uniqueChapters;
    }

    // --- MODO SINGLE ---
    async function runSingle() {
        const img = document.querySelector('img[src*="content-repository-cdn.tappytoon.com"]');
        const baseUrl = img ? img.src.substring(0, img.src.lastIndexOf('/') + 1) : null;
        if (!baseUrl) return alert("❌ No se detectó el contenido. Baja un poco en la página.");

        const btn = document.getElementById('ez-start-btn');
        const status = document.getElementById('ez-status');
        const stitch = document.getElementById('ez-do-stitch').checked;
        const hLimit = parseInt(document.getElementById('ez-h-limit').value);
        const finalZipName = document.getElementById('ez-filename').value;

        btn.disabled = true;
        const zipWriter = new zip.ZipWriter(new zip.BlobWriter("application/zip"));

        try {
            await fetchAndZipImages(baseUrl, hLimit, stitch, "", zipWriter, status, `[${finalZipName}]`);
            status.innerText = "📦 Generando archivo ZIP...";
            const blobZip = await zipWriter.close();
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blobZip);
            link.download = `${finalZipName}.zip`;
            link.click();
            status.innerText = "✅ ¡Descarga Exitosa!";
        } catch (error) {
            status.innerText = `⚠️ Error: ${error.message || "Desconocido"}`;
            await zipWriter.close();
        } finally {
            btn.disabled = false;
        }
    }

    // --- MODO BATCH ---
    async function runBatch() {
        const btn = document.getElementById('ez-start-btn');
        const status = document.getElementById('ez-status');
        const stitch = document.getElementById('ez-do-stitch').checked;
        const hLimit = parseInt(document.getElementById('ez-h-limit').value);
        const startEp = parseInt(document.getElementById('ez-start').value);
        const endEp = parseInt(document.getElementById('ez-end').value);
        const seriesName = document.getElementById('ez-series').value.replace(/[/\\?%*:|"<>]/g, '-');

        if (startEp > endEp) return alert("El capítulo inicial no puede ser mayor al final.");

        btn.disabled = true;
        const zipWriter = new zip.ZipWriter(new zip.BlobWriter("application/zip"));

        try {
            status.innerText = "Obteniendo ID de la serie...";
            const comicId = getComicId();

            status.innerText = "Buscando lista de capítulos...";
            let chapters = null;
            const locale = window.location.pathname.split('/')[1] || 'en';

            // Flujo de Supervivencia: Intentar 3 métodos distintos
            try {
                if (!comicId) throw new Error("Sin Comic ID");
                chapters = await fetchChaptersApi(comicId, locale);
            } catch (apiError) {
                console.warn("[Tappytoon DL] Error en API. Usando método NextData...", apiError);
                status.innerText = "API Bloqueada. Usando rescate NextData...";
                chapters = getChaptersFromNextData();
            }

            if (!chapters || chapters.length === 0) {
                console.warn("[Tappytoon DL] NextData falló. Usando Escaneo Visual HTML...");
                status.innerText = "Escaneando capítulos en pantalla...";
                chapters = getChaptersFromDOM();
            }

            if (!chapters || chapters.length === 0) {
                throw new Error("No se pudo obtener la lista de capítulos con ningún método.");
            }

            // Ordenamos la lista obtenida
            chapters.sort((a, b) => a.order - b.order);

            const targets = chapters.filter((c, i) => {
                const epNum = i + 1;
                return epNum >= startEp && epNum <= endEp;
            });

            if (targets.length === 0) throw new Error("No hay capítulos en ese rango numérico.");

            let successCount = 0;
            for (let i = 0; i < targets.length; i++) {
                const cap = targets[i];
                if (cap.hasOwnProperty('isAccessible') && !cap.isAccessible) {
                    console.warn(`[Tappytoon DL] Capítulo detectado como bloqueado: ${cap.title}`);
                    continue;
                }

                status.innerText = `Preparando ${cap.title}...\n(Abriendo en segundo plano)`;
                const baseUrl = await getBaseUrlForChapter(cap.id);

                if (!baseUrl) {
                    console.warn(`[Tappytoon DL] Timeout en ${cap.title}. Probablemente no tienes acceso a él.`);
                    continue; // En lugar de detener todo, saltamos los capítulos a los que no tengas acceso real
                }

                const safeCapTitle = cap.title.replace(/[/\\?%*:|"<>]/g, '-');
                const folderPrefix = `${safeCapTitle}/`;

                await fetchAndZipImages(baseUrl, hLimit, stitch, folderPrefix, zipWriter, status, `[Cap ${i+1}/${targets.length}] ${cap.title}`);
                successCount++;

                if (i < targets.length - 1) {
                    status.innerText = `[${cap.title}] Completado.\nEsperando para el siguiente...`;
                    await new Promise(r => setTimeout(r, 2000));
                }
            }

            if (successCount > 0) {
                status.innerText = "📦 Empaquetando ZIP maestro...\n(Esto puede tardar)";
                const blobZip = await zipWriter.close();
                const link = document.createElement("a");
                link.href = URL.createObjectURL(blobZip);
                link.download = `${seriesName}_Caps_${startEp}_al_${endEp}.zip`;
                link.click();
                status.innerText = `✅ ¡Lote Exitoso! (${successCount} caps en 1 ZIP)`;
            } else {
                throw new Error("Ningún capítulo descargado. Verifica que tienes comprados los capítulos seleccionados.");
            }
        } catch (error) {
            console.error("Detalles del Error:", error);
            status.innerText = `⚠️ Error:\n${error.message}`;
            try { await zipWriter.close(); } catch(e){}
        } finally {
            btn.disabled = false;
        }
    }

    // --- INICIALIZADOR ---
    function init() {
        if (document.getElementById('ez-panel')) return;

        const path = window.location.pathname;
        const isBook = path.includes('/book/');
        const isChapter = path.includes('/chapters/');

        if (!isBook && !isChapter) return;

        const panel = document.createElement('div');
        panel.id = 'ez-panel';

        if (isBook) {
            let seriesTitle = "Tappytoon_Series";
            try {
                const meta = document.querySelector('meta[property="og:title"]');
                if(meta) seriesTitle = meta.content.replace(' | Tappytoon', '').trim();
            } catch(e){}

            panel.innerHTML = `
                <h3>Tappytoon-Rip</h3>
                <table>
                    <tr><td class="tab-left">Serie:</td><td><input type="text" id="ez-series" value="${seriesTitle}"></td></tr>
                    <tr><td class="tab-left" title="Posición en la lista (1 = primer cap)">Cap. Inicial:</td><td><input type="number" id="ez-start" value="1" min="1"></td></tr>
                    <tr><td class="tab-left" title="Posición en la lista">Cap. Final:</td><td><input type="number" id="ez-end" value="5" min="1"></td></tr>
                    <tr><td class="tab-left">Límite (px):</td><td><input type="number" id="ez-h-limit" value="5000"></td></tr>
                    <tr><td colspan="2"><label><input type="checkbox" id="ez-do-stitch" checked> Unir imágenes</label></td></tr>
                </table>
                <button id="ez-start-btn">🚀 Descargar</button>
                <div id="ez-status" class="status-log">Esperando orden...</div>
            `;
            document.body.appendChild(panel);
            document.getElementById('ez-start-btn').onclick = runBatch;
        } else {
            let capTitle = "Tappytoon_Cap";
            try {
                const meta = document.querySelector('meta[property="og:title"]');
                if(meta) capTitle = meta.content.replace(' | Tappytoon', '').trim().replace(/[/\\?%*:|"<>]/g, '-');
            } catch(e){}

            panel.innerHTML = `
                <h3>Tappytoon-Rip</h3>
                <table>
                    <tr><td class="tab-left">Nombre ZIP:</td><td><input type="text" id="ez-filename" value="${capTitle}"></td></tr>
                    <tr><td class="tab-left">Límite (px):</td><td><input type="number" id="ez-h-limit" value="5000"></td></tr>
                    <tr><td colspan="2"><label><input type="checkbox" id="ez-do-stitch" checked> Unir imágenes</label></td></tr>
                </table>
                <button id="ez-start-btn">🚀 Descargar</button>
                <div id="ez-status" class="status-log">Esperando orden...</div>
            `;
            document.body.appendChild(panel);
            document.getElementById('ez-start-btn').onclick = runSingle;
        }
    }

    init();
    let lastUrl = location.href;
    new MutationObserver(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            const oldPanel = document.getElementById('ez-panel');
            if (oldPanel) oldPanel.remove();
            setTimeout(init, 1000);
        }
    }).observe(document, {subtree: true, childList: true});

})();
