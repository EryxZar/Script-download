// ==UserScript==
// @name         KakaoPageManhwa-Rip
// @version      3.1
// @description  Descarga rápida (x10) y unión de capítulos.
// @author       EryxZar
// @match        https://page.kakao.com/content/*/viewer/*
// @icon         https://upload.wikimedia.org/wikipedia/commons/8/8f/Kakao_page_logo.png
// @require      https://unpkg.com/@zip.js/zip.js@2.7.60/dist/zip-full.min.js
// @grant        GM_xmlhttpRequest
// @connect      kakaocdn.net
// @connect      kakao.com
// @connect      page-edge.kakao.com
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    let capturedChapterData = null;
    let isDownloading = false;

    const style = document.createElement('style');
    style.innerHTML = `
        :root { --kakao-yellow: #FFCD00; --bg: #1a1a1a; --text: #efefef; --accent: #ffcd00; --border: #333; }
        #ez-panel { position: fixed; bottom: 20px; right: 20px; z-index: 1000000; background: var(--bg); color: var(--text);
                    padding: 15px; border: 1px solid var(--accent); border-radius: 12px; width: 280px;
                    font-family: 'Segoe UI', sans-serif; box-shadow: 0 8px 24px rgba(0,0,0,0.6); }
        #ez-panel h3 { margin: 0 0 12px 0; font-size: 14px; text-align: center; color: var(--accent); text-transform: uppercase; letter-spacing: 1px; }
        #ez-panel table { width: 100%; font-size: 12px; border-spacing: 0 8px; }
        #ez-panel input { width: 100%; background: #2a2a2a; color: #fff; border: 1px solid var(--border); border-radius: 4px; padding: 6px; box-sizing: border-box; }
        #ez-panel button { width: 100%; margin-top: 10px; padding: 10px; background: var(--accent); color: #000; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; transition: 0.2s; }
        #ez-panel button:hover { opacity: 0.9; transform: translateY(-1px); }
        #ez-panel button:disabled { background: #444; color: #888; cursor: not-allowed; transform: none; }
        .status-log { font-size: 11px; margin-top: 10px; color: var(--accent); text-align: center; min-height: 15px; font-style: italic; }
        .checkbox-container { display: flex; align-items: center; gap: 8px; font-size: 12px; cursor: pointer; }
    `;
    document.head.appendChild(style);

    function findKakaoImages(obj) {
        if (!obj || typeof obj !== 'object') return null;
        let searchObj = obj.data || obj;

        // Soporte para la nueva API (viewer_data) y la antigua (viewerData)
        const viewerNode = searchObj.viewer_data || searchObj.viewerData;

        if (viewerNode?.imageDownloadData?.files) {
            const files = viewerNode.imageDownloadData.files;

            // El título ahora viene en searchObj.item.title en la nueva API
            let rawTitle = searchObj?.item?.title || viewerNode?.title || document.title || 'Kakao_Chapter';
            let title = rawTitle.replace(/\s*-\s*카카오페이지/g, '').trim();

            const images = files.map((f, i) => ({
                url: f.secureUrl || f.url || f.imageUrl,
                ord: f.no || f.order || f.sortOrder || (i + 1)
            })).filter(img => img.url).sort((a, b) => a.ord - b.ord);

            return { images, title };
        }
        return null;
    }

    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
        this.addEventListener('load', function() {
            try {
                if (this.responseText.includes('imageDownloadData')) {
                    const res = JSON.parse(this.responseText);
                    const found = findKakaoImages(res);
                    if (found) { capturedChapterData = found; updateUI(); }
                }
            } catch (e) {}
        });
        originalOpen.apply(this, arguments);
    };

    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
        const response = await originalFetch(...args);
        try {
            const clone = response.clone();
            clone.json().then(data => {
                const found = findKakaoImages(data);
                if (found) { capturedChapterData = found; updateUI(); }
            }).catch(() => {});
        } catch (e) {}
        return response;
    };

    async function fetchImage(url, retries = 3) {
        for (let i = 0; i < retries; i++) {
            try {
                return await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: "GET", url: url, responseType: "blob", timeout: 20000,
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
        for (const i of imgs) { ctx.drawImage(i, 0, y); y += i.height; URL.revokeObjectURL(i.src); }
        const mergedBlob = await new Promise(r => canvas.toBlob(r, "image/jpeg", 0.90));
        await writer.add(`${String(count).padStart(3, '0')}.jpg`, new zip.BlobReader(mergedBlob));
    }

    function createPanel() {
        if (document.getElementById('ez-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'ez-panel';
        panel.innerHTML = `
            <h3>Kakaopage-Rip</h3>
            <table>
                <tr><td><b>Nombre:</b></td><td><input type="text" id="ez-filename"></td></tr>
                <tr><td><b>Límite PX:</b></td><td><input type="number" id="ez-h-limit" value="8000"></td></tr>
            </table>
            <div style="margin: 10px 0;">
                <label class="checkbox-container">
                    <input type="checkbox" id="ez-do-stitch" checked> Unir (Stitch)
                </label>
            </div>
            <button id="ez-start-btn" disabled>Esperando datos...</button>
            <div id="ez-status" class="status-log">Detectando capítulo...</div>
        `;
        document.body.appendChild(panel);
        document.getElementById('ez-start-btn').onclick = startRip;
    }

    function updateUI() {
        if (!document.getElementById('ez-panel')) createPanel();
        if (capturedChapterData && !isDownloading) {
            const btn = document.getElementById('ez-start-btn');
            const input = document.getElementById('ez-filename');
            btn.innerText = `🚀 Descargar (${capturedChapterData.images.length})`;
            btn.disabled = false;
            if (!input.value) input.value = capturedChapterData.title.replace(/[/\\?%*:|"<>]/g, '-');
            document.getElementById('ez-status').innerText = "Capítulo listo para descargar";
        }
    }

    async function startRip() {
        if (!capturedChapterData || isDownloading) return;
        const btn = document.getElementById('ez-start-btn');
        const status = document.getElementById('ez-status');
        const doStitch = document.getElementById('ez-do-stitch').checked;
        const hLimit = parseInt(document.getElementById('ez-h-limit').value);
        const fileName = document.getElementById('ez-filename').value || "Chapter";

        isDownloading = true;
        btn.disabled = true;

        const zipWriter = new zip.ZipWriter(new zip.BlobWriter("application/zip"));
        const { images } = capturedChapterData;
        const BATCH_SIZE = 10;
        const downloadedBlobs = new Array(images.length);

        try {
            for (let i = 0; i < images.length; i += BATCH_SIZE) {
                const batch = [];
                for (let j = i; j < i + BATCH_SIZE && j < images.length; j++) {
                    batch.push(fetchImage(images[j].url).then(blob => ({ index: j, blob })));
                }
                status.innerText = `📥 Descargando grupo ${Math.floor(i/BATCH_SIZE) + 1}...`;
                const results = await Promise.all(batch);
                for (const res of results) downloadedBlobs[res.index] = res.blob;
            }

            let currentGroup = [], currentH = 0, groupCount = 1;
            for (let i = 0; i < downloadedBlobs.length; i++) {
                const blob = downloadedBlobs[i];
                if (doStitch) {
                    const img = await blobToImg(blob);
                    if (currentH + img.height > hLimit && currentGroup.length > 0) {
                        status.innerText = `🧵 Uniendo bloque ${groupCount}...`;
                        await mergeAndAdd(zipWriter, currentGroup, currentH, groupCount++);
                        currentGroup = []; currentH = 0;
                    }
                    currentGroup.push(img); currentH += img.height;
                } else {
                    await zipWriter.add(`${String(i + 1).padStart(3, '0')}.jpg`, new zip.BlobReader(blob));
                }
            }
            if (currentGroup.length > 0) await mergeAndAdd(zipWriter, currentGroup, currentH, groupCount);

            status.innerText = "📦 Generando ZIP...";
            const finalZip = await zipWriter.close();
            const link = document.createElement("a");
            link.href = URL.createObjectURL(finalZip);
            link.download = `${fileName}.zip`;
            link.click();
            status.innerText = "✅ ¡Descarga Completa!";
        } catch (err) {
            console.error(err);
            status.innerText = "❌ Error en el proceso";
        } finally {
            isDownloading = false;
            setTimeout(() => { if(!isDownloading) updateUI(); }, 3000);
        }
    }

    window.addEventListener('load', createPanel);

    let lastUrl = location.href;
    new MutationObserver(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            capturedChapterData = null;
            const btn = document.getElementById('ez-start-btn');
            if(btn) {
                btn.disabled = true;
                btn.innerText = "Esperando datos...";
                document.getElementById('ez-filename').value = "";
                document.getElementById('ez-status').innerText = "Detectando capítulo...";
            }
        }
    }).observe(document, {subtree: true, childList: true});
})();
