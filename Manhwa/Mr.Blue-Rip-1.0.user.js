// ==UserScript==
// @name         Mr.Blue-Rip
// @version      1.0
// @description  Descargas de multiples capitulos.
// @author       EryxZar
// @match        *://*.mrblue.com/*
// @require      https://unpkg.com/@zip.js/zip.js@2.7.60/dist/zip-full.min.js
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      mrblue.com
// @connect      comicshd-c.mrblue.com
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    const IMG_HOST = 'https://comicshd-c.mrblue.com';
    const isViewer = window.location.hostname.includes('viewer');
    const isDetail = window.location.pathname.includes('/comic/detail/');

    let isDownloading = false;
    const CONCURRENCY = 5; // <--- VELOCIDAD DE DESCARGA: 5 imágenes al mismo tiempo

    // =========================================================
    // 1. MODO VISOR: EL AGENTE INFILTRADO (ROBO DE TOKEN)
    // =========================================================
    if (isViewer) {
        const orgSet = Headers.prototype.set;
        Headers.prototype.set = function(name, value) {
            if (name.toLowerCase() === 'x-auth-token') {
                GM_setValue('eryx_token', value);
                GM_setValue('eryx_token_time', Date.now());
            }
            return orgSet.apply(this, arguments);
        };

        const orgFetch = window.fetch;
        window.fetch = async (...args) => {
            if (args[1] && args[1].headers) {
                let h = args[1].headers;
                let tk = (h instanceof Headers) ? h.get('X-Auth-Token') : (h['X-Auth-Token'] || h['x-auth-token']);
                if (tk) {
                    GM_setValue('eryx_token', tk);
                    GM_setValue('eryx_token_time', Date.now());
                }
            }
            return orgFetch(...args);
        };
    }

    // =========================================================
    // 2. MODO DETALLE: INTERFAZ DE CONTROL
    // =========================================================
    if (isDetail) {
        function drawUI() {
            if (document.getElementById('eryx-v38-ui')) return;

            let defaultTitle = document.title.split('-')[0].split('|')[0].trim();
            if (!defaultTitle || defaultTitle === "") defaultTitle = "MrBlue_Manga";

            const ui = document.createElement('div');
            ui.id = 'eryx-v38-ui';
            ui.setAttribute('style', `
                position: fixed !important; bottom: 20px !important; right: 20px !important;
                z-index: 2147483647 !important; padding: 15px !important;
                background: rgba(10, 15, 20, 0.95) !important; color: #fff !important;
                border: 2px solid #00d2ff !important; border-radius: 8px !important;
                font-family: monospace !important; box-shadow: 0 4px 20px rgba(0,210,255,0.4) !important;
                text-align: center !important; width: 250px !important; backdrop-filter: blur(5px);
            `);

            ui.innerHTML = `
                <div style="font-weight:bold; color:#00d2ff; margin-bottom:10px; font-size:14px; letter-spacing:1px;">Mr.Blue-Rip</div>

                <input id="eryx-title" type="text" value="${defaultTitle}" title="Nombre del Manga (para el ZIP)" style="
                    width: 100%; padding: 6px; background: #111; color: #00d2ff;
                    border: 1px solid #00d2ff; border-radius: 4px; margin-bottom: 8px;
                    text-align: center; font-weight: bold; box-sizing: border-box;
                ">

                <div style="display: flex; gap: 5px; margin-bottom: 10px;">
                    <input id="eryx-start" type="number" placeholder="Cap. Ini" style="width: 50%; padding: 4px; background: #222; color: #fff; border: 1px solid #00d2ff; border-radius: 4px; text-align: center;">
                    <input id="eryx-end" type="number" placeholder="Cap. Fin" style="width: 50%; padding: 4px; background: #222; color: #fff; border: 1px solid #00d2ff; border-radius: 4px; text-align: center;">
                </div>

                <button id="e38-btn" style="
                    width: 100%; padding: 10px; border: none; border-radius: 4px;
                    background: #00d2ff; color: #000; font-weight: bold; cursor: pointer; transition: 0.3s;
                ">INICIAR DESCARGA</button>

                <div id="eryx-monitor" style="
                    margin-top: 10px; padding: 8px; background: #111; border: 1px solid #444;
                    border-radius: 4px; font-size: 10px; text-align: left; display: none;
                ">
                    <div id="eryx-status-text" style="color: #aaa; margin-bottom: 4px;">Motor listo...</div>
                    <div style="width: 100%; height: 6px; background: #333; border-radius: 3px; overflow: hidden;">
                        <div id="eryx-progress-bar" style="width: 0%; height: 100%; background: #00d2ff; transition: width 0.2s;"></div>
                    </div>
                </div>
            `;

            document.documentElement.appendChild(ui);
            document.getElementById('e38-btn').onclick = initPhantomDownload;
        }

        window.addEventListener('DOMContentLoaded', drawUI);
        setInterval(drawUI, 2000);

        function updateMonitor(text, percent) {
            const monitor = document.getElementById('eryx-monitor');
            const statusTxt = document.getElementById('eryx-status-text');
            const bar = document.getElementById('eryx-progress-bar');
            if (monitor && statusTxt && bar) {
                monitor.style.display = 'block';
                statusTxt.innerHTML = text;
                bar.style.width = `${percent}%`;
            }
        }

        const delay = ms => new Promise(res => setTimeout(res, ms));

        // =========================================================
        // 3. INVOCACIÓN DEL IFRAME FANTASMA
        // =========================================================
        async function spawnPhantomToStealToken(mangaId, chapter) {
            updateMonitor("Rompiendo seguridad (Iframe)...", 10);
            return new Promise((resolve) => {
                const iframe = document.createElement('iframe');
                iframe.src = `https://viewer.mrblue.com/comics/${mangaId}/${chapter}`;
                iframe.style = "position:absolute; width:0; height:0; border:0; left:-9999px; top:-9999px;";
                document.body.appendChild(iframe);

                let attempts = 0;
                const checkInterval = setInterval(() => {
                    attempts++;
                    const tk = GM_getValue('eryx_token');
                    const time = GM_getValue('eryx_token_time');

                    if (tk && time && (Date.now() - time < 60000)) {
                        clearInterval(checkInterval);
                        document.body.removeChild(iframe);
                        updateMonitor("¡Acceso concedido!", 100);
                        resolve(tk);
                    } else if (attempts > 15) {
                        clearInterval(checkInterval);
                        if (document.body.contains(iframe)) document.body.removeChild(iframe);
                        resolve(null);
                    }
                }, 1000);
            });
        }

        // =========================================================
        // 4. MOTOR PARALELO Y EMPAQUETADO EXACTO
        // =========================================================
        async function initPhantomDownload() {
            const startChap = parseInt(document.getElementById('eryx-start').value);
            const endChap = parseInt(document.getElementById('eryx-end').value);
            const seriesName = document.getElementById('eryx-title').value.trim() || "Manga";

            if (isNaN(startChap) || isNaN(endChap) || startChap > endChap) {
                return alert("Ingresa un rango de capítulos válido.");
            }

            if (isDownloading) return;
            isDownloading = true;

            const btn = document.getElementById('e38-btn');
            btn.style.background = "#555";
            btn.style.color = "#fff";
            btn.innerHTML = "OPERANDO...";

            const match = window.location.href.match(/\/comic\/detail\/([^\/\?]+)/);
            if (!match) {
                isDownloading = false;
                return alert("ID de manga no detectado.");
            }
            const mangaId = match[1];

            try {
                let activeToken = GM_getValue('eryx_token');
                const tokenTime = GM_getValue('eryx_token_time');
                const isFresh = activeToken && tokenTime && (Date.now() - tokenTime < 5 * 60 * 1000);

                if (!isFresh) {
                    activeToken = await spawnPhantomToStealToken(mangaId, startChap);
                    if (!activeToken) throw new Error("Fallo al interceptar seguridad (Timeout).");
                }

                const zipWriter = new zip.ZipWriter(new zip.BlobWriter("application/zip"));

                for (let chap = startChap; chap <= endChap; chap++) {
                    updateMonitor(`Conectando con Cap ${chap}...`, 0);

                    const apiUrl = `https://viewer.mrblue.com/api/v4/contents/access/${mangaId}/${chap}`;
                    const apiRes = await new Promise((resolve) => {
                        GM_xmlhttpRequest({
                            method: "GET", url: apiUrl,
                            headers: {
                                "accept": "application/json",
                                "x-auth-token": activeToken,
                                "x-client-agent": "daddy-desktop/2.39.3",
                                "x-wasm-support": "Y"
                            },
                            onload: resolve
                        });
                    });

                    if (apiRes.status !== 200) {
                        console.warn(`Cap ${chap} bloqueado.`);
                        continue;
                    }

                    const data = JSON.parse(apiRes.responseText);
                    const images = data.hd || data.sd;

                    if (!images) continue;

                    let downloadedCount = 0;

                    for (let i = 0; i < images.length; i += CONCURRENCY) {
                        const chunk = images.slice(i, i + CONCURRENCY);

                        const blobs = await Promise.all(chunk.map(async (imgInfo, chunkIdx) => {
                            const actualIndex = i + chunkIdx;
                            const url = imgInfo.path.startsWith('http') ? imgInfo.path : IMG_HOST + imgInfo.path;

                            const blob = await new Promise((resolve, reject) => {
                                GM_xmlhttpRequest({
                                    method: "GET", url: url, responseType: "blob",
                                    headers: {
                                        "Referer": "https://viewer.mrblue.com/",
                                        "X-Auth-Token": activeToken,
                                        "x-client-agent": "daddy-desktop/2.39.3",
                                        "x-wasm-support": "Y"
                                    },
                                    onload: (r) => r.status === 200 ? resolve(r.response) : reject(r.status),
                                    onerror: reject
                                });
                            });
                            return { index: actualIndex, blob: blob };
                        }));

                        for (const item of blobs) {
                            let folderName = `Capítulo ${chap}`;
                            let fileName = `${item.index.toString().padStart(3, '0')}.jpg`;
                            await zipWriter.add(`${folderName}/${fileName}`, new zip.BlobReader(item.blob));

                            downloadedCount++;
                        }

                        const percent = Math.round((downloadedCount / images.length) * 100);
                        updateMonitor(`
                            <span style="color:#00d2ff; font-weight:bold;">Capítulo ${chap}</span><br>
                            ⚡ Velocidad Múltiple: ${downloadedCount} / ${images.length}
                        `, percent);
                    }

                    await delay(500);
                }

                updateMonitor(`<span style="color:#f1c40f;">Empaquetando mega-archivo ZIP...</span>`, 100);
                btn.innerHTML = "COMPRIMIENDO...";

                const zipBlob = await zipWriter.close();
                const a = document.createElement('a');
                a.href = URL.createObjectURL(zipBlob);

                if (startChap === endChap) {
                    a.download = `${seriesName} - Capítulo ${startChap}.zip`;
                } else {
                    a.download = `${seriesName} - Capítulos ${startChap} al ${endChap}.zip`;
                }
                a.click();

                btn.innerHTML = "¡DESCARGA EXITOSA!";
                btn.style.background = "#27ae60";
                updateMonitor(`<span style="color:#2ecc71; font-weight:bold;">Misión Cumplida.</span>`, 100);

            } catch (error) {
                console.error(error);
                btn.innerHTML = "ERROR CRÍTICO";
                btn.style.background = "#c0392b";
                updateMonitor(`<span style="color:#e74c3c;">Fallo en la red.</span>`, 0);
            }

            setTimeout(() => {
                isDownloading = false;
                btn.innerHTML = "INICIAR DESCARGA";
                btn.style.background = "#00d2ff";
                btn.style.color = "#000";
                document.getElementById('eryx-monitor').style.display = 'none';
            }, 6000);
        }
    }
})();