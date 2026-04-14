// ==UserScript==
// @name         Novelpia-rip
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  Descarga multihilo rápida con visual compacto y progreso detallado.
// @author       EryxZar
// @match        *://novelpia.com/novel/*
// @require      https://unpkg.com/@zip.js/zip.js@2.7.60/dist/zip-full.min.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const novelId = window.location.pathname.split('/').pop();
    const MAX_CONCURRENT = 3; // Descarga 3 capítulos a la vez para ganar velocidad

    function parseRange(input) {
        if (!input || !input.trim()) return null;
        const result = new Set();
        const parts = input.split(',');
        for (let part of parts) {
            part = part.trim();
            if (part.includes('-')) {
                const [start, end] = part.split('-').map(Number);
                if (!isNaN(start) && !isNaN(end)) {
                    const min = Math.min(start, end);
                    const max = Math.max(start, end);
                    for (let i = min; i <= max; i++) result.add(i);
                }
            } else {
                const num = Number(part);
                if (!isNaN(num)) result.add(num);
            }
        }
        return Array.from(result).sort((a, b) => a - b);
    }

    // Hilo de descarga individual
    function fetchChapter(url, epText, episodeTitle) {
        return new Promise((resolve) => {
            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            iframe.src = url;

            const timeout = setTimeout(() => {
                iframe.src = "about:blank";
                iframe.remove();
                resolve(null);
            }, 12000);

            iframe.onload = () => {
                try {
                    const doc = iframe.contentDocument || iframe.contentWindow.document;
                    let attempts = 0;
                    const checkInterval = setInterval(() => {
                        attempts++;
                        const lines = doc.querySelectorAll('#novel_drawing font.line');

                        if (lines.length > 0) {
                            clearInterval(checkInterval);
                            clearTimeout(timeout);

                            let content = "";
                            lines.forEach(line => {
                                let tempLine = line.cloneNode(true);
                                tempLine.querySelectorAll('.cover-wrapper, .cover-text').forEach(c => c.remove());
                                tempLine.querySelectorAll('p, span, div').forEach(trap => {
                                    const style = trap.getAttribute('style') || "";
                                    if (style.includes('opacity: 0') || style.includes('display: none') || style.includes('height: 0px')) trap.remove();
                                });

                                let text = tempLine.innerText.replace(/\xA0/g, ' ').trim();
                                if (text.length > 0) content += text + "\n";
                                else if (line.nextSibling?.nodeName === "BR") content += "\n";
                            });

                            iframe.src = "about:blank";
                            iframe.remove();
                            resolve({ name: `${epText}.txt`, data: episodeTitle + "\n\n" + content });
                        } else if (attempts > 20) {
                            clearInterval(checkInterval);
                            clearTimeout(timeout);
                            iframe.remove();
                            resolve(null);
                        }
                    }, 350);
                } catch (err) {
                    clearTimeout(timeout);
                    iframe.remove();
                    resolve(null);
                }
            };
            document.body.appendChild(iframe);
        });
    }

    function goToPageAndWait(pageNum) {
        return new Promise((resolve) => {
            localStorage[`novel_page_${novelId}`] = pageNum;
            if (typeof window.episode_list === 'function') {
                window.episode_list();
            } else { resolve(false); return; }

            const observer = new MutationObserver((mutations, obs) => {
                obs.disconnect();
                setTimeout(resolve, 400);
            });
            const target = document.querySelector('#episode_list');
            if (target) observer.observe(target, { childList: true, subtree: true });
            else setTimeout(resolve, 800);
        });
    }

    async function startBulkDownload() {
        const rawRangeInput = document.getElementById('ho-input').value;
        const requestedEpisodes = parseRange(rawRangeInput);
        const statusText = document.getElementById('ho-st');
        const btn = document.getElementById('ho-btn');

        if (!requestedEpisodes) {
            statusText.innerText = "Error: Rango vacío.";
            return;
        }

        btn.disabled = true;
        const zipWriter = new zip.ZipWriter(new zip.BlobWriter("application/zip"));
        const processedSet = new Set();
        let allResults = [];

        try {
            for (let p = 0; p < 60; p++) {
                statusText.innerText = `🔍 Buscando Pág. ${p + 1}...`;
                await goToPageAndWait(p);

                const rows = document.querySelectorAll('#episode_table tr[data-episode-no]');
                if (rows.length === 0) break;

                let pageQueue = [];
                for (const row of rows) {
                    const epTagSpan = row.querySelector('.ep_style2 span');
                    if (!epTagSpan) continue;

                    const epText = epTagSpan.innerText.trim();
                    const epNum = parseInt(epText.replace(/\D/g, ''), 10);

                    if (requestedEpisodes.includes(epNum) && !processedSet.has(epNum)) {
                        const url = `https://novelpia.com/viewer/${row.getAttribute('data-episode-no')}`;
                        let rawTitle = row.querySelector('td b')?.innerText.replace(/[\n\r]/g, '').trim() || "";
                        let episodeTitle = rawTitle.replace(/^.*무료\s*/, '').replace(/^.*PLUS\s*/, '').replace(/^\d+\.\s*/, '').trim();

                        pageQueue.push({ url, epText, episodeTitle, epNum });
                        processedSet.add(epNum);
                    }
                }

                // Procesar la cola de la página en lotes multihilo
                for (let i = 0; i < pageQueue.length; i += MAX_CONCURRENT) {
                    const chunk = pageQueue.slice(i, i + MAX_CONCURRENT);
                    const chunkNames = chunk.map(c => c.epText).join(', ');
                    statusText.innerText = `🚀 Bajando: ${chunkNames}`;

                    const results = await Promise.all(chunk.map(c => fetchChapter(c.url, c.epText, c.episodeTitle)));
                    results.forEach(res => { if (res) allResults.push(res); });
                }

                if (processedSet.size >= requestedEpisodes.length) break;
                const maxRequested = Math.max(...requestedEpisodes);
                const pageMaxEp = parseInt(rows[0]?.querySelector('.ep_style2 span')?.innerText.replace(/\D/g, '') || "0");
                if (pageMaxEp > maxRequested && processedSet.size > 0) break;
            }

            if (allResults.length === 0) {
                statusText.innerText = "❌ No encontrado.";
            } else {
                statusText.innerText = "📦 Empaquetando ZIP...";
                for (const item of allResults) {
                    await zipWriter.add(item.name, new zip.TextReader(item.data));
                }

                const blob = await zipWriter.close();
                const link = document.createElement("a");
                link.href = URL.createObjectURL(blob);

                const novelTitle = document.querySelector('.epnew-novel-title')?.innerText.trim() || "Novelpia";
                const cleanNovelTitle = novelTitle.replace(/[/\\?%*:|"<>]/g, '');

                link.download = `${cleanNovelTitle} - ${rawRangeInput}.zip`;
                link.click();
                statusText.innerText = "✅ ¡Todo listo!";
            }
        } catch (error) {
            statusText.innerText = "❌ Error.";
        } finally {
            btn.disabled = false;
        }
    }

    function initUI() {
        if (document.getElementById('ho-master-panel')) return;
        const ui = document.createElement('div');
        ui.id = 'ho-master-panel';
        ui.style = "position:fixed; top:15px; right:15px; z-index:999999; padding:12px; background:#121212; border:2px solid #00e676; width:220px; font-family:sans-serif; border-radius:10px; color:white; box-shadow:0 8px 20px rgba(0,0,0,0.7);";
        ui.innerHTML = `
            <h3 style="margin:0 0 2px 0; color:#00e676; text-align:center; font-size:16px;">🚀 Novelpia-rip</h3>
            <p style="font-size:9px; color:#888; text-align:center; margin-bottom:10px; letter-spacing:1px;">BY ERYXZAR</p>
            <input type="text" id="ho-input" placeholder="Ej: 1-20" style="width:100%; padding:8px; background:#222; border:1px solid #444; color:white; border-radius:5px; margin-bottom:8px; box-sizing:border-box; font-size:12px;">
            <button id="ho-btn" style="width:100%; padding:10px; background:#00e676; color:black; font-weight:bold; border:none; border-radius:5px; cursor:pointer; font-size:12px;">GENERAR ZIP</button>
            <div id="ho-st" style="margin-top:8px; font-size:11px; color:#00e676; text-align:center; min-height:15px;">Listo.</div>
        `;
        document.body.appendChild(ui);
        document.getElementById('ho-btn').addEventListener('click', startBulkDownload);
    }

    initUI();
})();