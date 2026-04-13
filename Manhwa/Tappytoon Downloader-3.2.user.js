// ==UserScript==
// @name         Tappytoon Downloader
// @namespace    http://tampermonkey.net/
// @version      3.2
// @author       EryxZar
// @match        https://www.tappytoon.com/en/chapters/*
// @require      https://unpkg.com/@zip.js/zip.js@2.7.60/dist/zip-full.min.js
// @grant        GM_xmlhttpRequest
// @connect      content-repository-cdn.tappytoon.com
// @connect      tappytoon.com
// ==/UserScript==

(function() {
    'use strict';

    const style = document.createElement('style');
    style.innerHTML = `
        :root { --accent: #2e7d32; --bg: #fff; --text: #212121; --border: #898ea4; --accent-bg: #f5f7ff; }
        @media (prefers-color-scheme: dark) { :root { --bg: #212121; --text: #dcdcdc; --accent: #4caf50; --accent-bg: #2b2b2b; } }
        #ez-panel { position: fixed; top: 15px; right: 15px; z-index: 100000; background: var(--bg); color: var(--text);
                   padding: 15px; border: 2px solid var(--accent); border-radius: 8px; width: 310px;
                   font-family: sans-serif; box-shadow: 0 4px 15px rgba(0,0,0,0.5); }
        #ez-panel h3 { margin: 0 0 10px 0; font-size: 16px; text-align: center; color: var(--accent); border-bottom: 1px solid var(--border); padding-bottom: 5px; }
        #ez-panel table { width: 100%; font-size: 13px; border-spacing: 0 8px; }
        #ez-panel input { width: 100%; background: var(--accent-bg); color: var(--text); border: 1px solid var(--border); border-radius: 4px; padding: 5px; }
        #ez-panel button { width: 100%; margin-top: 10px; padding: 10px; background: var(--accent); color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; }
        #ez-panel button:disabled { background: #666; cursor: not-allowed; }
        .status-log { font-size: 11px; margin-top: 10px; color: var(--accent); text-align: center; font-weight: bold; min-height: 15px; }
        .tab-left { font-weight: bold; width: 90px; }
    `;
    document.head.appendChild(style);

    function getChapterInfo() {
        const metaTitle = document.querySelector('meta[property="og:title"]');
        let title = metaTitle ? metaTitle.getAttribute('content').replace(' | Tappytoon', '').trim() : "Tappytoon_Cap";
        return title.replace(/[/\\?%*:|"<>]/g, '-');
    }

    // --- INTERFAZ ---
    const panel = document.createElement('div');
    panel.id = 'ez-panel';
    panel.innerHTML = `
        <h3>Tappytoon Downloader</h3>
        <table>
            <tr><td class="tab-left">Nombre ZIP:</td><td><input type="text" id="ez-filename"></td></tr>
            <tr><td class="tab-left">Límite (px):</td><td><input type="number" id="ez-h-limit" value="5000"></td></tr>
            <tr><td colspan="2"><label><input type="checkbox" id="ez-do-stitch" checked> Unir imágenes (Stitch)</label></td></tr>
        </table>
        <button id="ez-start-btn">🚀 Iniciar Descarga</button>
        <div id="ez-status" class="status-log">Esperando orden...</div>
    `;
    document.body.appendChild(panel);

    document.getElementById('ez-filename').value = getChapterInfo();

    // --- FUNCIONES DE DESCARGA ---
    function getBaseUrl() {
        const img = document.querySelector('img[src*="content-repository-cdn.tappytoon.com"]');
        return img ? img.src.substring(0, img.src.lastIndexOf('/') + 1) : null;
    }

    async function fetchImage(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: "GET", url: url, responseType: "blob",
                onload: (r) => r.status === 200 ? resolve(r.response) : reject(),
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

    async function mergeAndAdd(writer, imgs, totalH, count) {
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
        const fileName = `${String(count).padStart(2, '0')}.jpg`;
        await writer.add(fileName, new zip.BlobReader(mergedBlob));
    }

    async function run() {
        const urlBase = getBaseUrl();
        if (!urlBase) return alert("❌ No se detectó el contenido. Baja un poco en la página.");

        const btn = document.getElementById('ez-start-btn');
        const status = document.getElementById('ez-status');
        const stitch = document.getElementById('ez-do-stitch').checked;
        const hLimit = parseInt(document.getElementById('ez-h-limit').value);
        const finalZipName = document.getElementById('ez-filename').value;

        btn.disabled = true;
        const zipWriter = new zip.ZipWriter(new zip.BlobWriter("application/zip"));

        let i = 1, errs = 0, currentGroup = [], currentH = 0, groupCount = 1;

        try {
            while (i <= 500) {
                status.innerText = `Obteniendo página ${i}...`;
                try {
                    const blob = await fetchImage(`${urlBase}${i}.jpeg`);
                    if (stitch) {
                        const img = await blobToImg(blob);
                        if (currentH + img.height > hLimit && currentGroup.length > 0) {
                            status.innerText = `Uniendo bloque ${groupCount}...`;
                            await mergeAndAdd(zipWriter, currentGroup, currentH, groupCount++);
                            currentGroup = []; currentH = 0;
                        }
                        currentGroup.push(img);
                        currentH += img.height;
                    } else {
                        await zipWriter.add(`${String(i).padStart(2, '0')}.jpg`, new zip.BlobReader(blob));
                    }
                    errs = 0;
                } catch (e) {
                    errs++;
                    if (errs >= 2) break;
                }
                i++;
            }

            if (currentGroup.length > 0) await mergeAndAdd(zipWriter, currentGroup, currentH, groupCount);

            status.innerText = "📦 Generando archivo ZIP...";
            const blobZip = await zipWriter.close();
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blobZip);
            link.download = `${finalZipName}.zip`;
            link.click();
            status.innerText = "✅ ¡Descarga Exitosa!";
        } catch (error) {
            status.innerText = "⚠️ Error en la descarga.";
        } finally {
            btn.disabled = false;
        }
    }

    document.getElementById('ez-start-btn').onclick = run;

})();