// ==UserScript==
// @name         Bomtoon-Rip
// @version      4.0
// @description  Descargar de imagenes
// @author       EryxZar
// @match        https://www.bomtoon.com/viewer/*/*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @require      https://unpkg.com/@zip.js/zip.js@2.7.60/dist/zip-full.min.js
// ==/UserScript==

(function() {
    'use strict';

    GM_addStyle(`
        #eryx-v4 {
            position: fixed; bottom: 25px; right: 25px; width: 300px;
            background: #151515; border: 2px solid #ff477e; border-radius: 12px;
            color: #fff; font-family: sans-serif;
            z-index: 9999999; box-shadow: 0 10px 40px rgba(255, 71, 126, 0.35); overflow: hidden;
        }
        #eryx-header { background: #ff477e; padding: 12px; font-weight: 900; text-align: center; letter-spacing: 1px; font-size: 14px; }
        #eryx-body { padding: 18px; }
        #eryx-log { font-size: 12px; color: #ffb3c1; text-align: center; margin-bottom: 15px; font-weight: 500; height: 32px; display:flex; align-items:center; justify-content:center; }
        .eryx-bar-bg { background: #2a2a2a; height: 8px; border-radius: 4px; margin-bottom: 15px; }
        #eryx-bar-fill { background: linear-gradient(90deg, #ff477e, #ff8da1); height: 100%; width: 0%; border-radius: 4px; transition: width 0.3s ease; }
        .eryx-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; font-size: 12px; font-weight: bold; }
        .eryx-input { width: 70px; background: #222; border: 1px solid #ff477e; color: #fff; text-align: center; border-radius: 4px; padding: 4px; }
        #eryx-btn {
            width: 100%; padding: 14px; background: #ff477e; border: none;
            color: white; font-weight: bold; font-size: 13px; border-radius: 8px;
            cursor: pointer; text-transform: uppercase; transition: all 0.2s;
        }
        #eryx-btn:hover { background: #ff336f; }
        #eryx-btn:disabled { background: #444; color: #888; cursor: not-allowed; }
    `);

    const ui = document.createElement('div');
    ui.id = 'eryx-v4';
    ui.innerHTML = `
        <div id="eryx-header">BOMTOON-RIP V4.1</div>
        <div id="eryx-body">
            <div id="eryx-log">Sistema listo</div>
            <div class="eryx-row">
                <span>Altura Final (px):</span>
                <input type="number" id="eryx-max-height" class="eryx-input" value="10000">
            </div>
            <div class="eryx-bar-bg"><div id="eryx-bar-fill"></div></div>
            <button id="eryx-btn">DESCARGAR</button>
        </div>
    `;
    document.body.appendChild(ui);

    const btn = document.getElementById('eryx-btn');
    const log = document.getElementById('eryx-log');
    const bar = document.getElementById('eryx-bar-fill');
    const heightInput = document.getElementById('eryx-max-height');

    async function stitchAndZip(blobs, targetHeight, zipWriter) {
        log.innerText = "Preparando unión...";
        let imgs = [];
        for (let b of blobs) {
            let img = new Image();
            img.src = URL.createObjectURL(b);
            await new Promise(r => { img.onload = r; img.onerror = r; });
            imgs.push(img);
        }

        let maxWidth = Math.max(...imgs.map(i => i.width));
        if (maxWidth === 0 || !isFinite(maxWidth)) maxWidth = 800;

        let canvas = document.createElement('canvas');
        let ctx = canvas.getContext('2d');
        let part = 1, startIdx = 0;

        while (startIdx < imgs.length) {
            let chunkHeight = 0, endIdx = startIdx;
            while (endIdx < imgs.length) {
                if (chunkHeight + imgs[endIdx].height > targetHeight && chunkHeight > 0) break;
                chunkHeight += imgs[endIdx].height;
                endIdx++;
            }
            canvas.width = maxWidth;
            canvas.height = chunkHeight;
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            let drawY = 0;
            for (let i = startIdx; i < endIdx; i++) {
                ctx.drawImage(imgs[i], (maxWidth - imgs[i].width) / 2, drawY);
                drawY += imgs[i].height;
            }
            let chunkBlob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.92));
            await zipWriter.add(`${part.toString().padStart(3, '0')}.jpg`, new zip.BlobReader(chunkBlob));
            startIdx = endIdx; part++;
        }
    }

    btn.onclick = async () => {
        btn.disabled = true;
        log.innerText = "Analizando...";
        bar.style.width = "5%";

        const targetHeight = parseInt(heightInput.value, 10) || 10000;
        let capturedBlobs = [];

        try {
            const urlMatch = window.location.pathname.match(/\/viewer\/(\w+)\/(\w+)/);
            if (!urlMatch) return alert("Error de URL.");
            const [_, contentId, episodeId] = urlMatch;

            const viewerResponse = await fetch(`https://www.bomtoon.com/api/balcony-api-v2/contents/viewer/${contentId}/${episodeId}?isNotLoginAdult=false`, {
                headers: { 'x-balcony-id': 'BOMTOON_COM' },
                credentials: 'include'
            });
            const viewerJson = await viewerResponse.json();
            const imagesAPI = viewerJson.data?.images || [];
            const hasPuzzle = imagesAPI.some(img => img.point || img.scrambleData || img.isScramble);

            const zipWriter = new zip.ZipWriter(new zip.BlobWriter("application/zip"));
            let zipName = `${document.title.split('|')[0].trim().replace(/[<>:"/\\|?*]/g, '')}.zip`;

            if (!hasPuzzle && imagesAPI.length > 0) {
                log.innerText = "⚡ Modo API...";
                for (let i = 0; i < imagesAPI.length; i++) {
                    const res = await fetch(imagesAPI[i].imagePath || imagesAPI[i].url);
                    capturedBlobs.push(await res.blob());
                    bar.style.width = `${Math.round(((i + 1) / imagesAPI.length) * 100)}%`;
                }
            } else {
                log.innerHTML = "🧩 Modo Clonador...";
                let lastCaptureTime = Date.now();
                window.scrollTo(0, 0);
                await new Promise(r => setTimeout(r, 1000));
                let currentScroll = 0, step = window.innerHeight * 0.6;

                while (true) {
                    window.scrollTo(0, currentScroll);
                    await new Promise(r => setTimeout(r, 450));
                    let visuals = document.querySelectorAll('canvas, img[src*="balcony.studio"], img[src^="blob:"]');
                    let foundNew = false;

                    for (let el of visuals) {
                        if (el.dataset.eryxCaptured || (el.width || el.clientWidth) < 300) continue;
                        el.dataset.eryxCaptured = "true";
                        foundNew = true;
                        let blob = (el.tagName.toLowerCase() === 'canvas') ? 
                            await new Promise(r => el.toBlob(r, 'image/jpeg', 0.95)) : 
                            await (await fetch(el.src)).blob();
                        if (blob) capturedBlobs.push(blob);
                    }

                    if (foundNew) lastCaptureTime = Date.now();
                    else if (Date.now() - lastCaptureTime > 5000) break; // Auto-stop de 5 segundos

                    currentScroll += step;
                    let scrollHeight = document.documentElement.scrollHeight;
                    bar.style.width = `${Math.min(100, Math.round((currentScroll / scrollHeight) * 100))}%`;
                    if (currentScroll > scrollHeight + 1000 && (Date.now() - lastCaptureTime > 2000)) break;
                }
            }

            if (capturedBlobs.length > 0) {
                await stitchAndZip(capturedBlobs, targetHeight, zipWriter);
                const finalZipBlob = await zipWriter.close();
                const dl = document.createElement('a');
                dl.href = URL.createObjectURL(finalZipBlob);
                dl.download = zipName;
                dl.click();
                log.innerText = "✅ ¡Listo!";
            } else {
                log.innerText = "❌ No se encontró nada.";
            }
            setTimeout(() => { btn.disabled = false; bar.style.width = "0%"; }, 4000);

        } catch (error) {
            log.innerText = "❌ Error en el proceso.";
            btn.disabled = false;
        }
    };
})();
