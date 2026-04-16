// ==UserScript==
// @name         Novelpia-rip
// @namespace    http://tampermonkey.net/
// @version      3.2
// @description  Descarga multihilo optimizada para móvil.
// @author       EryxZar
// @match        *://novelpia.com/novel/*
// @require      https://unpkg.com/@zip.js/zip.js@2.7.60/dist/zip-full.min.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const novelId = window.location.pathname.split('/').pop();
    const MAX_CONCURRENT = 2;

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

    function fetchChapter(url, epText, episodeTitle) {
        return new Promise((resolve) => {
            const iframe = document.createElement('iframe');
            iframe.style = "display:none !important; width:0; height:0; visibility:hidden;";
            iframe.src = url;

            const timeout = setTimeout(() => {
                iframe.src = "about:blank";
                if(iframe.parentNode) iframe.parentNode.removeChild(iframe);
                resolve(null);
            }, 15000);

            iframe.onload = () => {
                try {
                    const doc = iframe.contentDocument || iframe.contentWindow.document;
                    let attempts = 0;
                    const checkInterval = setInterval(() => {
                        attempts++;
                        const container = doc.querySelector('#novel_drawing');
                        const lines = doc.querySelectorAll('#novel_drawing font.line');

                        if (container && lines.length > 0) {
                            clearInterval(checkInterval);
                            clearTimeout(timeout);

                            let content = "";
                            lines.forEach(line => {
                                let tempLine = line.cloneNode(true);

                                tempLine.querySelectorAll('img, .img_view, .image_box').forEach(img => img.remove());

                                tempLine.querySelectorAll('.cover-wrapper, .cover-text').forEach(c => c.remove());
                                tempLine.querySelectorAll('p, span, div').forEach(trap => {
                                    const style = trap.getAttribute('style') || "";
                                    if (style.includes('opacity: 0') || style.includes('display: none') || style.includes('height: 0px')) trap.remove();
                                });

                                let text = tempLine.innerText.replace(/\xA0/g, ' ').trim();
                                if (text.length > 0) {
                                    content += text + "\n";
                                } else if (line.nextSibling?.nodeName === "BR") {
                                    content += "\n";
                                }
                            });

                            iframe.src = "about:blank";
                            if(iframe.parentNode) iframe.parentNode.removeChild(iframe);
                            resolve({ name: `${epText}.txt`, data: episodeTitle + "\n\n" + content });
                        } else if (attempts > 20) {
                            clearInterval(checkInterval);
                            clearTimeout(timeout);
                            if(iframe.parentNode) iframe.parentNode.removeChild(iframe);
                            resolve(null);
                        }
                    }, 400);
                } catch (err) {
                    clearTimeout(timeout);
                    if(iframe.parentNode) iframe.parentNode.removeChild(iframe);
                    resolve(null);
                }
            };
            document.body.appendChild(iframe);
        });
    }

    function goToPageAndWait(pageNum) {
        return new Promise((resolve) => {
            localStorage[`novel_page_${novelId}`] = pageNum;
            const epListFunc = window.episode_list || (typeof episode_list === 'function' ? episode_list : null);
            if (epListFunc) {
                epListFunc();
            } else { resolve(false); return; }

            const observer = new MutationObserver((mutations, obs) => {
                obs.disconnect();
                setTimeout(resolve, 600);
            });
            const target = document.querySelector('#episode_list');
            if (target) observer.observe(target, { childList: true, subtree: true });
            else setTimeout(resolve, 1200);
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
            for (let p = 0; p < 80; p++) {
                statusText.innerText = `🔍 Pág. ${p + 1}...`;
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

                for (let i = 0; i < pageQueue.length; i += MAX_CONCURRENT) {
                    const chunk = pageQueue.slice(i, i + MAX_CONCURRENT);
                    const chunkNames = chunk.map(c => c.epText).join(',');
                    statusText.innerText = `🚀 ${chunkNames}`;

                    const results = await Promise.all(chunk.map(c => fetchChapter(c.url, c.epText, c.episodeTitle)));
                    results.forEach(res => { if (res) allResults.push(res); });
                }

                if (processedSet.size >= requestedEpisodes.length) break;
            }

            if (allResults.length === 0) {
                statusText.innerText = "❌ No encontrado.";
            } else {
                statusText.innerText = "📦 ZIP...";
                for (const item of allResults) {
                    await zipWriter.add(item.name, new zip.TextReader(item.data));
                }

                const blob = await zipWriter.close();
                const link = document.createElement("a");
                link.href = URL.createObjectURL(blob);

                const novelTitle = document.querySelector('.epnew-novel-title')?.innerText.trim() || "Novelpia";
                link.download = `${novelTitle.replace(/[/\\?%*:|"<>]/g, '')} - ${rawRangeInput}.zip`;
                link.click();
                statusText.innerText = "✅ ¡Listo!";
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
        ui.style = "position:fixed; top:60px; right:10px; z-index:999999; padding:12px; background:#121212; border:2px solid #00e676; width:180px; font-family:sans-serif; border-radius:10px; color:white; box-shadow:0 8px 20px rgba(0,0,0,0.7);";
        ui.innerHTML = `
            <h3 style="margin:0 0 2px 0; color:#00e676; text-align:center; font-size:14px;">🚀 Novelpia-rip</h3>
            <p style="font-size:8px; color:#888; text-align:center; margin-bottom:8px;">BY ERYXZAR</p>
            <input type="text" id="ho-input" placeholder="Ej: 1-20" style="width:100%; padding:8px; background:#222; border:1px solid #444; color:white; border-radius:5px; margin-bottom:8px; box-sizing:border-box; font-size:12px;">
            <button id="ho-btn" style="width:100%; padding:10px; background:#00e676; color:black; font-weight:bold; border:none; border-radius:5px; cursor:pointer; font-size:12px;">GENERAR ZIP</button>
            <div id="ho-st" style="margin-top:8px; font-size:10px; color:#00e676; text-align:center; min-height:14px;">Listo.</div>
        `;
        document.body.appendChild(ui);
        document.getElementById('ho-btn').addEventListener('click', startBulkDownload);
    }

    if (document.readyState === 'complete') {
        initUI();
    } else {
        window.addEventListener('load', initUI);
    }
})();
