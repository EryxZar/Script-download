// ==UserScript==
// @name         Bomtoon Downloader
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Descarga API ultra-rápida (sin puzzle) o Clonador Visual (con puzzle).
// @author       EryxZar
// @match        https://www.bomtoon.com/viewer/*
// @grant        GM_addStyle
// @require      https://unpkg.com/@zip.js/zip.js@2.7.60/dist/zip-full.min.js
// ==/UserScript==

(function() {
    'use strict';

    // --- INTERFAZ UI ---
    GM_addStyle(`
        #eryx-v17 {
            position: fixed; bottom: 25px; right: 25px; width: 300px;
            background: #151515; border: 2px solid #ff477e; border-radius: 12px;
            color: #fff; font-family: 'Pretendard Variable', -apple-system, sans-serif;
            z-index: 9999999; box-shadow: 0 10px 40px rgba(255, 71, 126, 0.35); overflow: hidden;
        }
        #eryx-header { background: #ff477e; padding: 12px; font-weight: 900; text-align: center; letter-spacing: 1px; font-size: 14px; }
        #eryx-body { padding: 18px; }
        #eryx-log { font-size: 12px; color: #ffb3c1; text-align: center; margin-bottom: 15px; font-weight: 500; height: 18px; }
        .eryx-bar-bg { background: #2a2a2a; height: 8px; border-radius: 4px; margin-bottom: 20px; }
        #eryx-bar-fill { background: linear-gradient(90deg, #ff477e, #ff8da1); height: 100%; width: 0%; border-radius: 4px; transition: width 0.3s ease; }
        #eryx-btn {
            width: 100%; padding: 14px; background: #ff477e; border: none;
            color: white; font-weight: bold; font-size: 13px; border-radius: 8px;
            cursor: pointer; text-transform: uppercase; transition: all 0.2s; font-family: inherit;
        }
        #eryx-btn:hover { background: #ff336f; transform: translateY(-2px); }
        #eryx-btn:disabled { background: #444; color: #888; cursor: not-allowed; transform: none; }
    `);

    const ui = document.createElement('div');
    ui.id = 'eryx-v17';
    ui.innerHTML = `
        <div id="eryx-header">BOMTOON V2</div>
        <div id="eryx-body">
            <div id="eryx-log">Sistema en espera...</div>
            <div class="eryx-bar-bg"><div id="eryx-bar-fill"></div></div>
            <button id="eryx-btn">DESCARGAR</button>
        </div>
    `;
    document.body.appendChild(ui);

    const btn = document.getElementById('eryx-btn');
    const log = document.getElementById('eryx-log');
    const bar = document.getElementById('eryx-bar-fill');

    btn.onclick = async () => {
        btn.disabled = true;
        log.innerText = "Analizando seguridad...";
        bar.style.width = "5%";

        try {
            const urlMatch = window.location.pathname.match(/\/viewer\/(\w+)\/(\w+)/);
            if (!urlMatch) return alert("Abre un capítulo primero.");
            const [_, contentId, episodeId] = urlMatch;

            // 1. Consultar la API para ver qué tipo de capítulo es
            const viewerResponse = await fetch(`https://www.bomtoon.com/api/balcony-api-v2/contents/viewer/${contentId}/${episodeId}?isNotLoginAdult=false`, {
                headers: { 'x-balcony-id': 'BOMTOON_COM' },
                credentials: 'include'
            });
            const viewerJson = await viewerResponse.json();
            const imagesAPI = viewerJson.data?.images || [];

            // Detectar si alguna imagen tiene la clave del puzzle
            const hasPuzzle = imagesAPI.some(img => img.point || img.scrambleData || img.scrambleIndex || img.isScramble);

            const zipWriter = new zip.ZipWriter(new zip.BlobWriter("application/zip"));

            // Obtener nombre original del capítulo
            let metaTitleTag = document.querySelector('meta[property="og:title"]');
            let finalTitle = metaTitleTag ? metaTitleTag.content : document.title;
            let zipName = `${finalTitle}.zip`.replace(/[<>:"/\\|?*]/g, '');

            if (!hasPuzzle && imagesAPI.length > 0) {
                // ==========================================
                // MODO RÁPIDO: Descarga directa por API (Sin Puzzle)
                // ==========================================
                log.innerText = "⚡ Modo Rápido (Sin Puzzle)";
                for (let i = 0; i < imagesAPI.length; i++) {
                    const imgUrl = imagesAPI[i].imagePath || imagesAPI[i].url || imagesAPI[i].path;
                    if (!imgUrl) continue;

                    let percent = Math.round(((i + 1) / imagesAPI.length) * 100);
                    bar.style.width = `${percent}%`;
                    log.innerText = `Descargando original: ${i + 1}/${imagesAPI.length}`;

                    const res = await fetch(imgUrl);
                    const blob = await res.blob();

                    let ext = 'webp';
                    if (blob.type.includes('png')) ext = 'png';
                    else if (blob.type.includes('jpeg') || blob.type.includes('jpg')) ext = 'jpg';

                    const fileName = `${(i + 1).toString().padStart(3, '0')}.${ext}`;
                    await zipWriter.add(fileName, new zip.BlobReader(blob));
                }

            } else {
                // ==========================================
                // MODO CLONADOR: Auto-scroll visual (Con Puzzle)
                // ==========================================
                log.innerText = "🧩 Modo Clonador (Puzzle detectado)";
                let capturedCount = 0;

                window.scrollTo(0, 0);
                await new Promise(r => setTimeout(r, 1000));

                let scrollHeight = document.documentElement.scrollHeight;
                let currentScroll = 0;
                let step = window.innerHeight * 0.5;

                while (currentScroll < scrollHeight) {
                    window.scrollTo(0, currentScroll);
                    await new Promise(r => setTimeout(r, 400));

                    let visuals = document.querySelectorAll('canvas, img[src*="balcony.studio"]');

                    for (let el of visuals) {
                        if (el.dataset.eryxCaptured) continue;

                        let w = el.width || el.clientWidth;
                        if (w < 1000) continue; // Filtro de tamaño estricto para ignorar basura

                        el.dataset.eryxCaptured = "true";
                        capturedCount++;
                        log.innerText = `Clonando visual: Página ${capturedCount}`;

                        let blob;
                        if (el.tagName.toLowerCase() === 'canvas') {
                            try { blob = await new Promise(r => el.toBlob(r, 'image/jpeg', 0.95)); } catch (e) { continue; }
                        } else {
                            try { let res = await fetch(el.src); blob = await res.blob(); } catch (e) { continue; }
                        }

                        if (blob) {
                            let fileName = `${capturedCount.toString().padStart(3, '0')}.jpg`;
                            await zipWriter.add(fileName, new zip.BlobReader(blob));
                        }
                    }

                    currentScroll += step;
                    scrollHeight = document.documentElement.scrollHeight;
                    let percent = Math.min(100, Math.round((currentScroll / scrollHeight) * 100));
                    bar.style.width = `${percent}%`;
                }
            }

            // ==========================================
            // GUARDAR ARCHIVO
            // ==========================================
            log.innerText = "Empaquetando ZIP...";
            const finalZipBlob = await zipWriter.close();

            const downloadLink = document.createElement('a');
            downloadLink.href = URL.createObjectURL(finalZipBlob);
            downloadLink.download = zipName;
            downloadLink.click();

            log.innerText = "✅ ¡Descarga Completada!";
            setTimeout(() => { btn.disabled = false; bar.style.width = "0%"; }, 3000);

        } catch (error) {
            console.error(error);
            log.innerText = `❌ Error: ${error.message}`;
            btn.disabled = false;
        }
    };
})();