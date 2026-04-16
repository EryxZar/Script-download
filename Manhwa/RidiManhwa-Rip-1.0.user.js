// ==UserScript==
// @name         RidiManhwa-Rip
// @version      1.0
// @description  Descarga y unir imagenes
// @author       EryxZar
// @match        https://ridibooks.com/books/*
// @match        https://library.ridibooks.com/*
// @match        https://ridibooks.com/v2/viewer/*
// @require      https://unpkg.com/@zip.js/zip.js@2.7.60/dist/zip-full.min.js
// @grant        GM_xmlhttpRequest
// @connect      ridibooks.com
// @connect      book-api.ridibooks.com
// ==/UserScript==

(function() {
    'use strict';

    const CONCURRENCY_LIMIT = 10;
    const nombreSeguro = (name) => name.replace(/[<>:"/\\|?*]/g, '').trim();

    // --- ESCANEO DINÁMICO ---
    function escanearCapitulos() {
        let chapters = [];
        const isLibrary = window.location.hostname.includes('library.ridibooks.com');

        const links = document.querySelectorAll('a[href*="/view"]');

        links.forEach(link => {
            const match = link.href.match(/books\/(\d+)\/view/);
            if (match) {
                const capId = match[1];
                let tituloRaw = `Cap_${capId}`;

                const box = link.closest('.Book') || link.closest('.js_series_book_list');
                if (box) {
                    const titleEl = box.querySelector('p.css-1s2rrir') || box.querySelector('.LandscapeBook_Metadata p') || box.querySelector('.js_book_title');
                    if (titleEl && titleEl.innerText) tituloRaw = titleEl.innerText.trim();
                }

                if (!chapters.find(c => c.capId === capId)) {
                    chapters.push({ capId: capId, tituloRaw: tituloRaw });
                }
            }
        });

        if (isLibrary) chapters.reverse();
        return { chapters, isLibrary };
    }

    // --- INYECCIÓN DE INTERFAZ ---
    setTimeout(() => {
        if (document.getElementById('ho-mobile-wrapper')) return;

        const isLibraryStart = window.location.hostname.includes('library.ridibooks.com');
        let nombreSerieOriginal = "Manhwa_Ridibooks";

        if (isLibraryStart) {
            const tituloLibreria = document.querySelector('h2.css-1p3q5vf') || document.querySelector('h2');
            if (tituloLibreria && tituloLibreria.innerText) nombreSerieOriginal = tituloLibreria.innerText.trim();
        } else {
            nombreSerieOriginal = document.title.split(' - ')[0].trim() || "Manhwa_Ridibooks";
        }

        const style = document.createElement('style');
        style.innerHTML = `
            #ho-mobile-wrapper { position: fixed; bottom: 20px; right: 20px; z-index: 999999; display: flex; flex-direction: column; align-items: flex-end; font-family: sans-serif; }
            #ho-toggle-btn { width: 55px; height: 55px; border-radius: 50%; background: #00e676; color: #000; border: none; box-shadow: 0 4px 15px rgba(0,0,0,0.5); font-size: 24px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; margin-top: 15px; transition: 0.3s; }
            #ho-master-panel { width: 90vw; max-width: 340px; background: linear-gradient(145deg, #1a1a1a, #0d0d0d); color: #fff; border-radius: 16px; padding: 20px; border: 1px solid #2a2a2a; box-shadow: 0 15px 35px rgba(0,0,0,0.8); display: none; text-align: center; }
            #ho-master-panel h3 { margin: 0 0 5px; color: #00e676; font-size: 20px; font-weight: 800; }
            .author { font-size: 10px; color: #888; margin-bottom: 15px; letter-spacing: 2px; font-weight: bold; }
            .ho-field { margin-bottom: 12px; font-size: 13px; text-align: left; }
            .ho-field label { display: block; margin-bottom: 4px; color: #aaa; font-weight: bold; }
            .ho-field input { width: 100%; padding: 10px; font-size: 14px; background: #111; border: 1px solid #333; color: #fff; border-radius: 6px; box-sizing: border-box; }
            .ho-input-row { display: flex; justify-content: space-between; gap: 10px; margin-bottom: 15px; }
            .ho-input-row .ho-field { flex: 1; margin-bottom: 0; }
            .ho-alert { font-size: 11px; color: #00e676; margin-bottom: 10px; border: 1px solid #00e676; padding: 6px; border-radius: 6px; background: rgba(0,230,118,0.1); }
            .ho-warning { font-size: 11px; color: #ffeb3b; margin-bottom: 10px; border: 1px solid #ffeb3b; padding: 6px; border-radius: 6px; background: rgba(255,235,59,0.1); display: none;}
            #ho-btn { width: 100%; padding: 14px; font-size: 15px; background: #00e676; color: #000; font-weight: 900; border: none; border-radius: 8px; cursor: pointer; margin-top: 5px; }
            #ho-btn:disabled { background: #555; cursor: not-allowed; }
            #ho-status { margin-top: 15px; font-size: 12px; color: #00e676; font-weight: 600; min-height: 15px;}
            .ho-prog-bg { width: 100%; height: 8px; background: #222; border-radius: 4px; margin-top: 15px; overflow: hidden; display: none; }
            .ho-prog-fill { height: 100%; background: #00e676; width: 0%; transition: 0.3s; }
        `;
        document.head.appendChild(style);

        const wrapper = document.createElement('div');
        wrapper.id = 'ho-mobile-wrapper';
        wrapper.innerHTML = `
            <div id="ho-master-panel">
                <h3>RidiManhwa-Rip</h3>
                <div class="author">BY ERYXZAR</div>
                <div id="ho-mode-alert" class="ho-alert">Cargando modo...</div>
                <div id="ho-warning" class="ho-warning">⚠️ No detecto capítulos. Baja un poco la página y vuelve a abrir el panel.</div>
                <div style="font-size:12px; color:#aaa; margin-bottom:12px;" id="ho-cap-count">Capítulos detectados: 0</div>
                <div class="ho-field"><label>Nombre del Archivo ZIP:</label><input type="text" id="ho_filename" value="${nombreSerieOriginal}"></div>
                <div class="ho-input-row">
                    <div class="ho-field"><label>Desde Cap:</label><input type="number" id="ho_start" value="1" min="1"></div>
                    <div class="ho-field"><label>Hasta Cap:</label><input type="number" id="ho_end" value="1"></div>
                </div>
                <div class="ho-field"><label>Límite de Alto Exacto (px):</label><input type="number" id="ho_h_limit" value="5000"></div>
                <button id="ho-btn">DESCARGAR</button>
                <div class="ho-prog-bg" id="ho-prog-bg"><div class="ho-prog-fill" id="ho-prog-fill"></div></div>
                <div id="ho-status">Listo.</div>
            </div>
            <button id="ho-toggle-btn">⬇</button>
        `;
        document.body.appendChild(wrapper);

        const panel = document.getElementById('ho-master-panel');
        const toggleBtn = document.getElementById('ho-toggle-btn');
        const btn = document.getElementById('ho-btn');
        const status = document.getElementById('ho-status');
        const progFill = document.querySelector('.ho-prog-fill');
        const capCountDisplay = document.getElementById('ho-cap-count');
        const inputEnd = document.getElementById('ho_end');
        const modeAlert = document.getElementById('ho-mode-alert');
        const warningAlert = document.getElementById('ho-warning');

        let capitulosDetectados = [];

        toggleBtn.onclick = () => {
            if (panel.style.display === 'block') {
                panel.style.display = 'none';
                toggleBtn.innerHTML = '⬇';
                toggleBtn.style.background = '#00e676';
            } else {
                panel.style.display = 'block';
                toggleBtn.innerHTML = '✖';
                toggleBtn.style.background = '#ff4444';

                const scan = escanearCapitulos();
                capitulosDetectados = scan.chapters;

                modeAlert.innerHTML = scan.isLibrary ? '✅ Modo Biblioteca Activo' : '✅ Modo Tienda Activo';
                capCountDisplay.innerHTML = `Capítulos detectados: <b>${capitulosDetectados.length}</b>`;
                inputEnd.value = capitulosDetectados.length > 0 ? capitulosDetectados.length : 1;

                if (window.location.hostname.includes('library.ridibooks.com')) {
                    const tituloLibreria = document.querySelector('h2.css-1p3q5vf') || document.querySelector('h2');
                    if (tituloLibreria && tituloLibreria.innerText) document.getElementById('ho_filename').value = tituloLibreria.innerText.trim();
                }

                if (capitulosDetectados.length === 0) {
                    warningAlert.style.display = "block";
                    btn.disabled = true;
                } else {
                    warningAlert.style.display = "none";
                    btn.disabled = false;
                }
            }
        };

        btn.onclick = async () => {
            const start = parseInt(document.getElementById('ho_start').value) - 1;
            const end = parseInt(document.getElementById('ho_end').value);
            const hLimit = parseInt(document.getElementById('ho_h_limit').value) || 5000;
            const customFileName = document.getElementById('ho_filename').value.trim() || nombreSerieOriginal;

            if (start < 0 || end > capitulosDetectados.length || start >= end) return alert("Rango inválido.");

            btn.disabled = true;
            document.getElementById('ho-prog-bg').style.display = "block";

            const selectedChapters = capitulosDetectados.slice(start, end);
            const zipWriter = new zip.ZipWriter(new zip.BlobWriter("application/zip"));

            try {
                for (let i = 0; i < selectedChapters.length; i++) {
                    const cap = selectedChapters[i];
                    let tituloRaw = cap.tituloRaw;

                    btn.innerText = `PROCESANDO ${i+1}/${selectedChapters.length}...`;

                    try {
                        const infoJson = await new Promise((resolve, reject) => {
                            GM_xmlhttpRequest({
                                method: "GET",
                                url: `https://book-api.ridibooks.com/books/${cap.capId}`,
                                onload: (res) => resolve(JSON.parse(res.responseText)),
                                onerror: reject
                            });
                        });
                        if (infoJson.title && infoJson.title.main) tituloRaw = infoJson.title.main;
                    } catch(e) { }

                    const carpetaCapitulo = nombreSeguro(tituloRaw);

                    const genData = await new Promise((resolve, reject) => {
                        GM_xmlhttpRequest({
                            method: "POST",
                            url: "https://ridibooks.com/api/web-viewer/generate",
                            headers: { "Content-Type": "application/json" },
                            data: JSON.stringify({ book_id: cap.capId }),
                            onload: (res) => resolve(JSON.parse(res.responseText)),
                            onerror: reject
                        });
                    });

                    if (genData.success && genData.data.type === "comic" && genData.data.pages) {
                        const pages = genData.data.pages;

                        status.innerText = `[${carpetaCapitulo}] Obteniendo enlaces...`;
                        const blobUrls = new Array(pages.length);
                        let completedDl = 0;

                        const downloadTask = async (index) => {
                            try {
                                const imgResp = await fetch(pages[index].src);
                                const imgBlob = await imgResp.blob();
                                blobUrls[index] = URL.createObjectURL(imgBlob);
                            } catch (err) { console.error(`Error en pág ${index}`); }
                            completedDl++;
                            status.innerText = `[${carpetaCapitulo}] Descargando: ${completedDl}/${pages.length} ⚡`;
                        };

                        const queue = [...Array(pages.length).keys()];
                        const workers = new Array(Math.min(CONCURRENCY_LIMIT, pages.length))
                            .fill(null)
                            .map(async () => {
                                while (queue.length > 0) {
                                    const idx = queue.shift();
                                    await downloadTask(idx);
                                }
                            });

                        await Promise.all(workers);

                        status.innerText = `[${carpetaCapitulo}] Renderizando cortes exactos...`;

                        const firstImgObj = await new Promise((res) => {
                            const obj = new Image();
                            obj.onload = () => res(obj);
                            obj.src = blobUrls[0];
                        });
                        const canvasWidth = firstImgObj.width;

                        let canvas = document.createElement("canvas");
                        canvas.width = canvasWidth;
                        canvas.height = hLimit;
                        let ctx = canvas.getContext("2d");

                        let currentY = 0;
                        let groupCount = 1;

                        for (let p = 0; p < blobUrls.length; p++) {
                            if (!blobUrls[p]) continue;

                            const imgObj = (p === 0) ? firstImgObj : await new Promise((res) => {
                                const obj = new Image();
                                obj.onload = () => res(obj);
                                obj.src = blobUrls[p];
                            });

                            let sourceY = 0;
                            let remainingHeight = imgObj.height;

                            while (remainingHeight > 0) {
                                let spaceLeft = hLimit - currentY;
                                let drawHeight = Math.min(remainingHeight, spaceLeft);
                                let drawX = (canvasWidth - imgObj.width) / 2;

                                ctx.drawImage(
                                    imgObj,
                                    0, sourceY, imgObj.width, drawHeight,
                                    drawX, currentY, imgObj.width, drawHeight
                                );

                                currentY += drawHeight;
                                sourceY += drawHeight;
                                remainingHeight -= drawHeight;

                                if (currentY >= hLimit) {
                                    status.innerText = `[${carpetaCapitulo}] Empaquetando fragmento ${groupCount}...`;
                                    const blob = await new Promise(r => canvas.toBlob(r, "image/jpeg", 0.9));
                                    await zipWriter.add(`${carpetaCapitulo}/${String(groupCount).padStart(3, '0')}.jpg`, new zip.BlobReader(blob));
                                    groupCount++;

                                    ctx.clearRect(0, 0, canvasWidth, hLimit);
                                    currentY = 0;
                                }
                            }
                            URL.revokeObjectURL(blobUrls[p]);
                        }

                        if (currentY > 0) {
                            status.innerText = `[${carpetaCapitulo}] Empaquetando fragmento final...`;
                            let finalCanvas = document.createElement("canvas");
                            finalCanvas.width = canvasWidth;
                            finalCanvas.height = currentY;
                            finalCanvas.getContext("2d").drawImage(canvas, 0, 0);

                            const blob = await new Promise(r => finalCanvas.toBlob(r, "image/jpeg", 0.9));
                            await zipWriter.add(`${carpetaCapitulo}/${String(groupCount).padStart(3, '0')}.jpg`, new zip.BlobReader(blob));
                        }

                    } else {
                        status.innerText = `[${carpetaCapitulo}] Ignorado (No es Manhwa o sin acceso)`;
                        await new Promise(r => setTimeout(r, 1000));
                    }

                    progFill.style.width = `${((i + 1) / selectedChapters.length) * 100}%`;
                    await new Promise(r => setTimeout(r, 400));
                }

                status.innerText = "Finalizando archivo ZIP...";
                const finalZip = await zipWriter.close();

                const a = document.createElement('a');
                a.href = URL.createObjectURL(finalZip);
                a.download = `${nombreSeguro(customFileName)}.zip`;
                a.click();

                status.innerText = "✅ ¡Descarga completada!";
                btn.disabled = false;
                btn.innerText = "DESCARGAR MANHWA";
                setTimeout(() => toggleBtn.click(), 4000);

            } catch (e) {
                console.error("Error crítico:", e);
                status.innerText = "❌ Ocurrió un error de red.";
                btn.disabled = false;
                btn.innerText = "REINTENTAR";
            }
        };
    }, 1500);
})();