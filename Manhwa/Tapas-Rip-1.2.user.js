// ==UserScript==
// @name         Tapas-Rip
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Descarga masiva de Tapas con Stitching.
// @author       EryxZar
// @match        *://tapas.io/series/*
// @match        *://tapas.io/episode/*
// @match        *://m.tapas.io/series/*
// @require      https://unpkg.com/@zip.js/zip.js@2.7.60/dist/zip-full.min.js
// @grant        GM_xmlhttpRequest
// @connect      tapas.io
// @connect      *
// ==/UserScript==

(function() {
    'use strict';

    // Función para obtener el nombre de la serie desde distintos lugares
    function getSeriesName() {
        // 1. Intentar desde la lista lateral del visor
        const sideEp = document.querySelector('li[data-tiara-event-meta-series]');
        if (sideEp) return sideEp.getAttribute('data-tiara-event-meta-series');

        // 2. Intentar desde el enlace js-series-btn
        const seriesBtn = document.querySelector('a.title.js-series-btn');
        if (seriesBtn) return seriesBtn.innerText.trim();

        // 3. Intentar desde el enlace simple de título (Página de info)
        const simpleTitle = document.querySelector('a.title[href*="/series/"]');
        if (simpleTitle) return simpleTitle.innerText.trim();

        return "Serie_Tapas";
    }

    function createUI() {
        if (document.getElementById('ez-bulk-panel')) return;

        const seriesName = getSeriesName();

        const panel = document.createElement('div');
        panel.id = 'ez-bulk-panel';
        panel.style = `
            position: fixed; top: 15px; right: 15px; z-index: 100000;
            background: #1a1a1a; color: #f5db00; padding: 20px;
            border-radius: 12px; width: 300px; border: 3px solid #f5db00;
            font-family: sans-serif; box-shadow: 0 8px 25px rgba(0,0,0,0.7);
        `;

        panel.innerHTML = `
            <h3 style="margin: 0 0 15px; text-align: center; font-size: 14px; background: #f5db00; color: #000; padding: 5px; border-radius: 5px;">Tapas-Rip</h3>

            <label style="font-size: 11px; color: #888;">NOMBRE DE LA SERIE:</label>
            <input type="text" id="ez-name" value="${seriesName}" style="width: 100%; background: #252525; color: #fff; border: 1px solid #444; margin: 5px 0 10px 0; padding: 8px; border-radius: 4px;">

            <label style="font-size: 11px; color: #888;">RANGO (Ej: 1-5, 8):</label>
            <input type="text" id="ez-range" placeholder="Ej: 1-10" style="width: 100%; background: #252525; color: #fff; border: 1px solid #444; margin: 5px 0 10px 0; padding: 8px; border-radius: 4px;">

            <label style="font-size: 11px; color: #888;">LÍMITE DE ALTO (px):</label>
            <input type="number" id="ez-h-limit" value="5000" style="width: 100%; background: #252525; color: #fff; border: 1px solid #444; margin: 5px 0 20px 0; padding: 8px; border-radius: 4px;">

            <button id="ez-start" style="width: 100%; padding: 12px; background: #f5db00; color: #000; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 13px;">🚀 INICIAR DESCARGA</button>
            <div id="ez-status" style="margin-top: 15px; font-size: 11px; color: #aaa; text-align: center; line-height: 1.4;">Listo.</div>
        `;

        document.body.appendChild(panel);
        document.getElementById('ez-start').onclick = startProcess;
    }

    async function startProcess() {
        const status = document.getElementById('ez-status');
        const btn = document.getElementById('ez-start');
        const rangeInput = document.getElementById('ez-range').value;
        const hLimit = parseInt(document.getElementById('ez-h-limit').value) || 5000;
        const seriesBaseName = document.getElementById('ez-name').value;

        if (!rangeInput) return alert("Ingresa un rango.");

        const episodeMap = {};
        // Escaneo de episodios tanto en info como en visor
        const items = document.querySelectorAll('ul.js-episodes li, .episode-list li, .content-list li');
        items.forEach(li => {
            const titleEl = li.querySelector('.info__title, .title');
            const link = li.querySelector('a[href*="/episode/"]') || li.closest('a[href*="/episode/"]');
            if (titleEl && link) {
                const epTitle = titleEl.innerText.trim();
                const epNumMatch = epTitle.match(/\d+/);
                const epNum = epNumMatch ? parseInt(epNumMatch[0]) : null;
                const epUrl = link.href.startsWith('http') ? link.href : "https://tapas.io" + link.getAttribute('href');

                if (epNum && epUrl) episodeMap[epNum] = { url: epUrl, title: epTitle };
            }
        });

        const targets = parseRange(rangeInput);
        btn.disabled = true;
        btn.style.opacity = '0.5';

        try {
            const zipWriter = new zip.ZipWriter(new zip.BlobWriter("application/zip"));

            for (const num of targets) {
                const ep = episodeMap[num];
                if (!ep) continue;

                status.innerHTML = `🔍 Analizando: ${ep.title}...`;
                const html = await fetchRes(ep.url, "text");
                const doc = new DOMParser().parseFromString(html, "text/html");
                const imgs = doc.querySelectorAll('.viewer-section img.art-image, .content__img, img[data-src]');

                const folderName = ep.title.replace(/[\\/:*?"<>|]/g, '_');
                let currentGroup = [], currentH = 0, groupCount = 1;

                for (let i = 0; i < imgs.length; i++) {
                    const src = imgs[i].getAttribute('data-src') || imgs[i].src;
                    if (!src || src.includes('placeholder')) continue;

                    status.innerHTML = `📥 Descargando ${ep.title}<br>Parte ${i+1}`;
                    const blob = await fetchRes(src, "blob");

                    const img = await new Promise((res) => {
                        const obj = new Image();
                        obj.onload = () => res(obj);
                        obj.src = URL.createObjectURL(blob);
                    });

                    if (currentH + img.height > hLimit && currentGroup.length > 0) {
                        await stitchAndAdd(zipWriter, currentGroup, currentH, groupCount++, folderName);
                        currentGroup = []; currentH = 0;
                    }
                    currentGroup.push(img);
                    currentH += img.height;
                }

                if (currentGroup.length > 0) {
                    await stitchAndAdd(zipWriter, currentGroup, currentH, groupCount, folderName);
                }
            }

            status.innerHTML = `📦 Generando ZIP...`;
            const blob = await zipWriter.close();

            // Nombre: Serie + Rango
            const cleanRange = rangeInput.replace(/\s+/g, '');
            const finalFileName = `${seriesBaseName} ${cleanRange}.zip`.replace(/[\\/:*?"<>|]/g, '_');

            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = finalFileName;
            a.click();
            status.innerHTML = `✅ ¡Hecho! ${finalFileName}`;

        } catch (err) {
            console.error(err);
            status.innerHTML = `❌ Error en el proceso.`;
        } finally {
            btn.disabled = false;
            btn.style.opacity = '1';
        }
    }

    async function stitchAndAdd(writer, imgs, totalH, idx, folder) {
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
        const fileName = `${folder}/${String(idx).padStart(3, '0')}.jpg`;
        await writer.add(fileName, new zip.BlobReader(b));
    }

    function parseRange(input) {
        const nums = new Set();
        input.split(',').forEach(part => {
            const p = part.trim();
            if (p.includes('-')) {
                const [start, end] = p.split('-').map(n => parseInt(n.trim()));
                for (let i = start; i <= end; i++) nums.add(i);
            } else {
                const n = parseInt(p);
                if (!isNaN(n)) nums.add(n);
            }
        });
        return Array.from(nums).sort((a, b) => a - b);
    }

    function fetchRes(url, type) {
        return new Promise((res, rej) => {
            GM_xmlhttpRequest({
                method: "GET", url,
                responseType: type === "blob" ? "blob" : "text",
                onload: (r) => res(r.response),
                onerror: (e) => rej(e)
            });
        });
    }

    setTimeout(createUI, 2000);
})();
