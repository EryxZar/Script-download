// ==UserScript==
// @name         BookWalker-Rip
// @namespace    HouseOfOtakus
// @version      3.0
// @description  Descargar capitulos.
// @author       EryxZar
// @match        *://viewer-df.bookwalker.jp/*
// @match        *://viewer.bookwalker.jp/*
// @require      https://unpkg.com/@zip.js/zip.js@2.7.60/dist/zip-full.min.js
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    let capturedHashes = new Set();
    let extractedImages = [];
    const canvasTimers = new WeakMap();
    const canvasBounds = new WeakMap();

    let isWorking = false;
    let isDownloading = false;
    let isResetting = false;
    let targetPageIndex = -1;
    let activeWakeLock = null;

    async function requestWakeLock() {
        if ('wakeLock' in navigator) {
            try { if (!activeWakeLock) activeWakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
        }
    }
    function releaseWakeLock() {
        if (activeWakeLock) { try { activeWakeLock.release(); activeWakeLock = null; } catch(e){} }
    }

    // --- INTERFAZ ---
    window.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style');
        style.innerHTML = `
            :root { --accent: #00ffcc; --bg: rgba(15,15,15,0.95); --text: #dcdcdc; --border: #00ffcc; }
            #ez-panel { position: fixed; top: 15px; right: 15px; z-index: 100000; background: var(--bg); color: var(--text);
                       padding: 15px; border: 2px solid var(--accent); border-radius: 8px; width: 300px;
                       font-family: monospace; box-shadow: 0 4px 15px rgba(0,255,204,0.3); backdrop-filter: blur(5px); }
            #ez-panel h3 { margin: 0 0 10px 0; font-size: 16px; text-align: center; color: var(--accent); border-bottom: 1px solid var(--border); padding-bottom: 5px; }
            #ez-panel table { width: 100%; font-size: 12px; border-spacing: 0 8px; font-weight: bold; }
            #ez-panel input, #ez-panel select { width: 100%; background: #222; color: #fff; border: 1px solid var(--border); border-radius: 4px; padding: 5px; box-sizing: border-box; }
            #ez-panel button { width: 100%; margin-top: 8px; padding: 12px; background: var(--accent); color: #000; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; transition: 0.2s; }
            #ez-panel button:hover { background: #00ccaa; }
            #ez-panel button:disabled { background: #666; cursor: not-allowed; }
            .status-log { font-size: 14px; margin-top: 12px; color: var(--accent); text-align: center; font-weight: bold; }
            .range-group { display: flex; gap: 5px; align-items: center; margin-bottom: 5px; margin-top: 10px; font-size: 12px; font-weight: bold;}
            .range-group input { width: 65px !important; }
            .stitch-row { display: flex; align-items: center; justify-content: center; gap: 8px; margin: 10px 0; font-size: 12px; cursor: pointer; }
            .stitch-row input { width: auto !important; margin: 0; }
        `;
        document.head.appendChild(style);

        const panel = document.createElement('div');
        panel.id = 'ez-panel';
        panel.innerHTML = `
            <h3>BookWalker-Rip</h3>
            <table>
                <tr><td>Nombre ZIP:</td><td><input type="text" id="ez-filename" value="BookWalker_Cap"></td></tr>
                <tr><td>Límite px:</td><td><input type="number" id="ez-h-limit" value="8000"></td></tr>
                <tr><td>Formato:</td><td>
                    <select id="ez-format">
                        <option value="image/jpeg" selected>JPEG (Original)</option>
                        <option value="image/webp">WebP (Ligero)</option>
                    </select>
                </td></tr>
            </table>
            <label class="stitch-row"><input type="checkbox" id="ez-do-stitch"><span>Unir imágenes (Stitch)</span></label>
            <div class="range-group">Desde: <input type="number" id="hoo-from" value="1"> Hasta: <input type="number" id="hoo-to" value="1"></div>
            <button id="btn-run" style="background: #00ffcc;">▶️ INICIAR RECORRIDO</button>
            <button id="ez-start-btn">📥 DESCARGAR ZIP</button>
            <div id="ez-status" class="status-log">📚 Capturadas: 0 / ?</div>
        `;
        document.body.appendChild(panel);

        const filenameInput = document.getElementById('ez-filename');
        const inputHasta = document.getElementById('hoo-to');
        const statusLog = document.getElementById('ez-status');

        setInterval(() => {
            const totalElem = document.getElementById('pageSliderCounter');
            if (totalElem && totalElem.innerText.includes('/')) {
                const totalReal = totalElem.innerText.split('/')[1].trim();
                if (parseInt(inputHasta.value) <= 1 || inputHasta.value === "") inputHasta.value = totalReal;
                statusLog.innerText = `📚 Capturadas: ${extractedImages.length} / ${totalReal}`;
            }

            const titleSpan = document.querySelector('.titleText');
            const titleDiv = document.getElementById('pagetitle');
            let rawTitle = (titleSpan && titleSpan.innerText) || (titleDiv && titleDiv.title) || document.title || "BookWalker_Cap";
            let cleanTitle = rawTitle.split('|')[0].trim().replace(/[\\/:*?"<>|]/g, '-').trim().replace(/\s+/g, '_');
            if (cleanTitle !== "BookWalker_Cap" && (filenameInput.value === "BookWalker_Cap" || filenameInput.value === "")) filenameInput.value = cleanTitle;
        }, 800);

        document.getElementById('btn-run').onclick = startNFBRProcess;
        document.getElementById('ez-start-btn').onclick = () => { if(!isDownloading && extractedImages.length > 0) empaquetarYDescargar(); };
    });

    // --- MOTOR NFBR ---
    function getNFBRMenu() {
        try {
            for (let k in NFBR.a6G.Initializer) { if (NFBR.a6G.Initializer[k]['menu'] !== undefined) return NFBR.a6G.Initializer[k].menu; }
        } catch (e) { return null; }
    }

    async function startNFBRProcess() {
        const menu = getNFBRMenu();
        if (!menu) return alert("Error: Motor no listo.");
        if (isWorking) { isWorking = false; releaseWakeLock(); return; }

        isResetting = true;
        extractedImages = [];
        capturedHashes.clear();
        await requestWakeLock();

        isWorking = true;
        const from = parseInt(document.getElementById('hoo-from').value);
        const to = parseInt(document.getElementById('hoo-to').value);
        const metaCaptura = to - from + 1; // Para el auto-stop

        const btn = document.getElementById('btn-run');
        btn.innerText = "🛑 DETENER"; btn.style.background = "#ff4444";

        for (let i = from; i <= to; i++) {
            if (!isWorking) break;

            if (extractedImages.length >= metaCaptura && i > from) break;

            const prevCount = extractedImages.length;
            targetPageIndex = i - 1;
            menu.options.a6l.moveToPage(targetPageIndex);

            if (i === from) {
                await new Promise(r => setTimeout(r, 1000));
                isResetting = false;
            }

            await new Promise(resolve => {
                const check = setInterval(() => {
                    let isL = false;
                    document.querySelectorAll('.loading').forEach(l => { if(l.offsetWidth > 0) isL = true; });
                    if (!isL) { clearInterval(check); resolve(); }
                }, 200);
            });

            let waitTime = 0;
            while (extractedImages.length === prevCount && waitTime < 4000) {
                await new Promise(r => setTimeout(r, 200));
                waitTime += 200;
                if (waitTime === 1500) menu.options.a6l.moveToPage(targetPageIndex);
            }
        }
        btn.innerText = "▶️ INICIAR RECORRIDO"; btn.style.background = "#00ffcc";
        isWorking = false;
        targetPageIndex = -1;
        releaseWakeLock();
    }

    const originalDrawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function() {
        const img = arguments[0];
        const canvas = this.canvas;
        const isVisible = canvas.closest('.currentScreen') || (canvas.parentElement && canvas.parentElement.style.display !== 'none');

        if (isDownloading || isResetting || !isVisible) return originalDrawImage.apply(this, arguments);
        if (img && img.width < 50 && img.height < 50) return originalDrawImage.apply(this, arguments);

        let dx = arguments[1], dy = arguments[2], dW = img.width, dH = img.height;
        if (arguments.length === 5) { dW = arguments[3]; dH = arguments[4]; }
        else if (arguments.length >= 9) { dx = arguments[5]; dy = arguments[6]; dW = arguments[7]; dH = arguments[8]; }

        if (dW > 0 && dH > 0 && canvas.width > 400) {
            let b = canvasBounds.get(canvas) || { minX: Infinity, minY: Infinity, maxX: 0, maxY: 0 };
            b.minX = Math.min(b.minX, dx); b.minY = Math.min(b.minY, dy);
            b.maxX = Math.max(b.maxX, dx + dW); b.maxY = Math.max(b.maxY, dy + dH);
            canvasBounds.set(canvas, b);

            clearTimeout(canvasTimers.get(canvas));
            canvasTimers.set(canvas, setTimeout(() => {
                if (isDownloading || isResetting) return;
                const menu = getNFBRMenu();
                if (isWorking && menu && menu.model.attributes.viewera6e.getPageIndex() !== targetPageIndex) return;

                const bounds = canvasBounds.get(canvas);
                const cW = Math.ceil(bounds.maxX - bounds.minX), cH = Math.ceil(bounds.maxY - bounds.minY);
                if (cW < 150 || cH < 150) return;

                const crop = document.createElement('canvas');
                crop.width = cW; crop.height = cH;
                crop.getContext('2d').drawImage(canvas, Math.floor(bounds.minX), Math.floor(bounds.minY), cW, cH, 0, 0, cW, cH);

                const save = (cv) => {
                    const format = document.getElementById('ez-format').value;
                    const data = cv.toDataURL(format, 0.90);
                    if (data.length > 20000) {
                        const hash = data.slice(-150);
                        if (!capturedHashes.has(hash)) {
                            capturedHashes.add(hash);
                            extractedImages.push(data);
                        }
                    }
                };

                if (cW > (cH * 1.1)) {
                    const hW = cW / 2;
                    const r = document.createElement('canvas'); r.width = hW; r.height = cH;
                    r.getContext('2d').drawImage(crop, hW, 0, hW, cH, 0, 0, hW, cH); save(r);
                    const l = document.createElement('canvas'); l.width = hW; l.height = cH;
                    l.getContext('2d').drawImage(crop, 0, 0, hW, cH, 0, 0, hW, cH); save(l);
                } else { save(crop); }
                canvasBounds.delete(canvas);
            }, 850));
        }
        return originalDrawImage.apply(this, arguments);
    };

    // --- DESCARGA ---
    async function empaquetarYDescargar() {
        isDownloading = true;
        const status = document.getElementById('ez-status'), btn = document.getElementById('ez-start-btn');
        const format = document.getElementById('ez-format').value;
        const ext = format === 'image/webp' ? 'webp' : 'jpg';
        const isStitch = document.getElementById('ez-do-stitch').checked;
        const hLimit = parseInt(document.getElementById('ez-h-limit').value) || 8000;

        btn.disabled = true; status.innerText = '⏳ Procesando ZIP...';
        try {
            const zipWriter = new zip.ZipWriter(new zip.BlobWriter("application/zip"));
            if (isStitch) {
                let curG = [], curH = 0, gC = 1;
                for (let i = 0; i < extractedImages.length; i++) {
                    status.innerText = `🧵 Uniendo ${i + 1}/${extractedImages.length}...`;
                    const bitmap = await createImageBitmap(await (await fetch(extractedImages[i])).blob());
                    if (curH + bitmap.height > hLimit && curG.length > 0) {
                        await finalizeStitch(zipWriter, curG, curH, gC++, format, ext);
                        curG.forEach(b => b.close()); curG = []; curH = 0;
                    }
                    curG.push(bitmap); curH += bitmap.height;
                }
                if (curG.length > 0) await finalizeStitch(zipWriter, curG, curH, gC++, format, ext);
            } else {
                for (let i = 0; i < extractedImages.length; i++) {
                    status.innerText = `📦 Empaquetando ${i + 1}/${extractedImages.length}...`;
                    const blob = await (await fetch(extractedImages[i])).blob();
                    await zipWriter.add(`${String(i + 1).padStart(3, '0')}.${ext}`, new zip.BlobReader(blob));
                }
            }
            const blobZip = await zipWriter.close();
            const a = document.createElement('a'); a.href = URL.createObjectURL(blobZip);
            a.download = `${document.getElementById('ez-filename').value}.zip`; a.click();
            status.innerText = '✅ ¡Listo!';
        } catch (e) { status.innerText = '⚠️ Error'; }
        finally { btn.disabled = false; isDownloading = false; releaseWakeLock(); }
    }

    async function finalizeStitch(writer, bitmaps, h, count, format, ext) {
        const can = document.createElement("canvas");
        can.width = bitmaps[0].width; can.height = h;
        const ctx = can.getContext("2d", { alpha: false });
        ctx.fillStyle = "white"; ctx.fillRect(0,0,can.width, can.height);
        let y = 0;
        for (const b of bitmaps) { ctx.drawImage(b, 0, y); y += b.height; }
        const blob = await new Promise(r => can.toBlob(r, format, 0.90));
        await writer.add(`${String(count).padStart(3, '0')}.${ext}`, new zip.BlobReader(blob));
    }
})();
