// ==UserScript==
// @name         Rip-Toptoon
// @namespace    http://tampermonkey.net/
// @version      1.0
// @author       EryxZar
// @match        https://toptoon.com/comic/ep_view/*
// @require      https://unpkg.com/@zip.js/zip.js@2.7.60/dist/zip-full.min.js
// @grant        GM_xmlhttpRequest
// @connect      toptoon.com
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    let capturedUrls = new Set();
    let urlListOrdered = [];

    // --- ESTILOS ---
    const style = document.createElement('style');
    style.innerHTML = `
        :root { --accent: #2e7d32; --bg: #fff; --text: #212121; --border: #898ea4; --accent-bg: #f5f7ff; }
        @media (prefers-color-scheme: dark) { :root { --bg: #212121; --text: #dcdcdc; --accent: #4caf50; --accent-bg: #2b2b2b; } }
        #ez-panel { position: fixed; top: 15px; right: 15px; z-index: 1000000; background: var(--bg); color: var(--text);
                    padding: 15px; border: 2px solid var(--accent); border-radius: 8px; width: 310px;
                    font-family: sans-serif; box-shadow: 0 4px 15px rgba(0,0,0,0.5); }
        #ez-panel h3 { margin: 0 0 10px 0; font-size: 16px; text-align: center; color: var(--accent); border-bottom: 1px solid var(--border); padding-bottom: 5px; }
        #ez-panel table { width: 100%; font-size: 13px; border-spacing: 0 8px; }
        #ez-panel input { width: 100%; background: var(--accent-bg); color: var(--text); border: 1px solid var(--border); border-radius: 4px; padding: 5px; }
        #ez-panel button { width: 100%; margin-top: 10px; padding: 10px; background: var(--accent); color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; }
        #ez-panel button:disabled { background: #666; cursor: not-allowed; }
        .status-log { font-size: 11px; margin-top: 10px; color: var(--accent); text-align: center; font-weight: bold; min-height: 15px; }
    `;
    document.head.appendChild(style);

    function getChapterName() {
        const metaTitle = document.querySelector('meta[property="og:title"]');
        let title = metaTitle ? metaTitle.getAttribute('content').split('|')[0].trim() : "Comic_Pack";
        return title.replace(/[/\\?%*:|"<>]/g, '-');
    }

    function createPanel() {
        if (document.getElementById('ez-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'ez-panel';
        panel.innerHTML = `
            <h3>Toptoon Downloader</h3>
            <table>
                <tr><td style="font-weight:bold;">Nombre:</td><td><input type="text" id="ez-filename"></td></tr>
                <tr><td style="font-weight:bold;">Límite px:</td><td><input type="number" id="ez-h-limit" value="5000"></td></tr>
                <tr><td colspan="2"><label><input type="checkbox" id="ez-do-stitch" checked> Unir imágenes (Stitch)</label></td></tr>
            </table>
            <button id="ez-start-btn">🚀 Descargar (0)</button>
            <div id="ez-status" class="status-log">Desliza para cargar imágenes...</div>
        `;
        document.body.appendChild(panel);
        document.getElementById('ez-filename').value = getChapterName();
        document.getElementById('ez-start-btn').onclick = runProcess;
    }

    // --- ESCÁNER MEJORADO ---
    setInterval(() => {
        createPanel();
        const images = document.querySelectorAll('img, [data-src], canvas');
        images.forEach(el => {
            let url = el.getAttribute('data-src') || el.src;
            if (url && url.startsWith('http') && !url.includes('thumb') && !url.includes('blob:')) {
                if (!capturedUrls.has(url) && (url.includes('toptoon') || url.includes('tappytoon') || url.includes('content'))) {
                    capturedUrls.add(url);
                    urlListOrdered.push(url);
                }
            }
        });
        const btn = document.getElementById('ez-start-btn');
        if (btn && !btn.disabled) btn.innerText = `🚀 Descargar (${urlListOrdered.length})`;
    }, 1000);

    // --- PROCESAMIENTO SIN BLOQUEOS ---
    async function fetchWithRetry(url, retries = 3) {
        for (let i = 0; i < retries; i++) {
            try {
                return await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: "GET", url: url, responseType: "blob", timeout: 15000,
                        onload: (r) => r.status === 200 ? resolve(r.response) : reject(r.status),
                        onerror: reject, ontimeout: reject
                    });
                });
            } catch (e) { if (i === retries - 1) throw e; }
        }
    }

    async function blobToImg(blob) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = URL.createObjectURL(blob);
        });
    }

    async function mergeAndAdd(writer, imgs, totalH, count) {
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
        await writer.add(`${String(count).padStart(2, '0')}.jpg`, new zip.BlobReader(mergedBlob));
    }

    async function runProcess() {
        if (urlListOrdered.length === 0) return alert("¡No hay imágenes capturadas!");

        const btn = document.getElementById('ez-start-btn');
        const status = document.getElementById('ez-status');
        const stitch = document.getElementById('ez-do-stitch').checked;
        const hLimit = parseInt(document.getElementById('ez-h-limit').value);

        btn.disabled = true;
        const zipWriter = new zip.ZipWriter(new zip.BlobWriter("application/zip"));
        let currentGroup = [], currentH = 0, groupCount = 1, validCount = 0;

        try {
            for (let i = 0; i < urlListOrdered.length; i++) {
                status.innerText = `⏳ Cargando imagen ${i + 1}/${urlListOrdered.length}...`;
                try {
                    const blob = await fetchWithRetry(urlListOrdered[i]);
                    const img = await blobToImg(blob);

                    if (img.width > 600) {
                        validCount++;
                        if (stitch) {
                            if (currentH + img.height > hLimit && currentGroup.length > 0) {
                                status.innerText = `🧵 Uniendo bloque ${groupCount}...`;
                                await mergeAndAdd(zipWriter, currentGroup, currentH, groupCount++);
                                currentGroup = []; currentH = 0;
                            }
                            currentGroup.push(img);
                            currentH += img.height;
                        } else {
                            await zipWriter.add(`${String(validCount).padStart(3, '0')}.jpg`, new zip.BlobReader(blob));
                            URL.revokeObjectURL(img.src);
                        }
                    } else {
                        URL.revokeObjectURL(img.src);
                    }
                } catch (e) { console.warn("Error en imagen, saltando...", e); }
            }

            if (currentGroup.length > 0) await mergeAndAdd(zipWriter, currentGroup, currentH, groupCount);

            status.innerText = "📦 Comprimiendo ZIP...";
            const blobZip = await zipWriter.close();
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blobZip);
            link.download = `${document.getElementById('ez-filename').value}.zip`;
            link.click();
            status.innerText = "✅ ¡Listo!";
        } catch (error) {
            status.innerText = "❌ Error en el proceso.";
            console.error(error);
        } finally {
            btn.disabled = false;
        }
    }
})();