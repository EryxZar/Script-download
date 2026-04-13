// ==UserScript==
// @name         Kuaikan-rip
// @version      1.2
// @author       EryxZar
// @match        https://www.kuaikanmanhua.com/webs/comic-next/*
// @require      https://unpkg.com/@zip.js/zip.js@2.7.60/dist/zip-full.min.js
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      kkmh.com
// @connect      kuaikanmanhua.com
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    let isProcessing = false;
    const CONCURRENCY_LIMIT = 20;

    const style = document.createElement('style');
    style.innerHTML = `
        #ez-panel {
            position: fixed; top: 20px; right: 20px; z-index: 2147483647;
            background: #fff; padding: 15px; border: 3px solid #f5db00;
            border-radius: 12px; width: 280px; font-family: sans-serif;
            box-shadow: 0 5px 20px rgba(0,0,0,0.4);
        }
        #ez-panel h3 { margin: 0 0 10px; font-size: 14px; text-align: center; background: #f5db00; padding: 5px; border-radius: 5px; color: #000; }
        .ez-field { margin-bottom: 10px; font-size: 12px; }
        .ez-field label { display: block; margin-bottom: 3px; font-weight: bold; }
        .ez-field input { width: 100%; padding: 5px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
        .ez-btn {
            width: 100%; padding: 12px; background: #1a1a1a; color: #f5db00;
            border: none; border-radius: 6px; cursor: pointer; font-weight: bold; margin-bottom: 5px;
            font-size: 13px;
        }
        .ez-btn:disabled { background: #ccc; color: #666; cursor: not-allowed; }
        #ez-status { font-size: 11px; margin-top: 10px; text-align: center; color: #333; font-weight: bold; white-space: pre-wrap; }
        .progress-bar { height: 6px; background: #eee; border-radius: 3px; margin-top: 8px; overflow: hidden; display: none; }
        .progress-fill { height: 100%; background: #f5db00; width: 0%; transition: width 0.2s; }
    `;
    document.head.appendChild(style);

    function getChapterName() {
        const titlePart = document.title.split('｜')[0].trim();
        return `${titlePart}`.replace(/[/\\?%*:|"<>]/g, '').trim();
    }

    function createPanel() {
        if (document.getElementById('ez-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'ez-panel';
        panel.innerHTML = `
            <h3>Kuaikan-rip</h3>
            <div class="ez-field">
                <label>Nombre del archivo:</label>
                <input type="text" id="ez-filename">
            </div>
            <div class="ez-field">
                <label>Límite de alto (px):</label>
                <input type="number" id="ez-h-limit" value="5000">
            </div>
            <button id="ez-main-btn" class="ez-btn">🚀 DESCARGAR</button>
            <div class="progress-bar" id="ez-progress-cont"><div class="progress-fill" id="ez-progress"></div></div>
            <div id="ez-status">Listo.</div>
        `;
        document.body.appendChild(panel);
        document.getElementById('ez-filename').value = getChapterName();
        document.getElementById('ez-main-btn').onclick = startUnifiedProcess;
    }

    async function startUnifiedProcess() {
        if (isProcessing) return;

        const status = document.getElementById('ez-status');
        const btn = document.getElementById('ez-main-btn');
        const hLimit = parseInt(document.getElementById('ez-h-limit').value) || 5000;
        const fileName = document.getElementById('ez-filename').value || "Kuaikan-rip";

        status.innerText = "🔍 Buscando imágenes...";
        let urlList = [];

        try {
            // --- FASE 1: ESCANEO ---
            const nuxt = unsafeWindow?.__NUXT__;
            if (nuxt && nuxt.data) {
                for (let entry of nuxt.data) {
                    if (entry?.comic_info?.comic_images) {
                        urlList = entry.comic_info.comic_images.map(img => img.url || img.url_webp);
                        break;
                    }
                }
            }
            if (urlList.length === 0) {
                const lazyImgs = document.querySelectorAll('img[data-src]');
                lazyImgs.forEach(img => {
                    let src = img.getAttribute('data-src');
                    if (src && src.includes('kkmh.com')) urlList.push(src);
                });
            }
            urlList = [...new Set(urlList)];

            if (urlList.length === 0) {
                status.innerText = "❌ No se hallaron imágenes.\nPrueba bajando un poco en la web.";
                return;
            }

            // --- FASE 2: DESCARGA ---
            isProcessing = true;
            btn.disabled = true;
            document.getElementById('ez-progress-cont').style.display = "block";

            const progress = document.getElementById('ez-progress');
            const blobs = new Array(urlList.length);
            let completed = 0;

            const downloadTask = async (index) => {
                try {
                    const blob = await new Promise((res, rej) => {
                        GM_xmlhttpRequest({
                            method: "GET", url: urlList[index], responseType: "blob",
                            headers: { "Referer": "https://www.kuaikanmanhua.com/" },
                            onload: r => res(r.response), onerror: rej
                        });
                    });
                    blobs[index] = blob;
                } catch (e) { console.error(`Error en bloque ${index}`); }
                completed++;
                progress.style.width = `${(completed / urlList.length) * 100}%`;
                status.innerText = `⚡ Descargando: ${completed}/${urlList.length}`;
            };

            const queue = [...Array(urlList.length).keys()];
            const workers = new Array(Math.min(CONCURRENCY_LIMIT, urlList.length))
                .fill(null)
                .map(async () => {
                    while (queue.length > 0) {
                        const index = queue.shift();
                        await downloadTask(index);
                    }
                });

            await Promise.all(workers);

            // --- FASE 3: STITCH & ZIP ---
            status.innerText = "🧵 Uniendo fragmentos...";
            const zipWriter = new zip.ZipWriter(new zip.BlobWriter("application/zip"));
            let currentGroup = [], currentH = 0, groupCount = 1;

            for (let i = 0; i < blobs.length; i++) {
                if (!blobs[i]) continue;
                const img = await new Promise((res) => {
                    const obj = new Image();
                    obj.crossOrigin = "anonymous";
                    obj.onload = () => res(obj);
                    obj.src = URL.createObjectURL(blobs[i]);
                });

                if (currentH + img.height > hLimit && currentGroup.length > 0) {
                    await stitch(zipWriter, currentGroup, currentH, groupCount++);
                    currentGroup = []; currentH = 0;
                }
                currentGroup.push(img);
                currentH += img.height;
            }

            if (currentGroup.length > 0) await stitch(zipWriter, currentGroup, currentH, groupCount);

            status.innerText = "📦 Finalizando ZIP...";
            const finalZip = await zipWriter.close();
            const a = document.createElement("a");
            a.href = URL.createObjectURL(finalZip);
            a.download = `${fileName}.zip`;
            a.click();
            status.innerText = "✅ ¡Todo listo, EryxZar!";

        } catch (e) {
            status.innerText = "❌ Error en el proceso.";
            console.error(e);
        } finally {
            btn.disabled = false;
            isProcessing = false;
        }
    }

    async function stitch(writer, imgs, totalH, idx) {
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
        const b = await new Promise(r => canvas.toBlob(r, "image/jpeg", 0.9));
        await writer.add(`${String(idx).padStart(3, '0')}.jpg`, new zip.BlobReader(b));
    }

    setTimeout(createPanel, 1500);
})();