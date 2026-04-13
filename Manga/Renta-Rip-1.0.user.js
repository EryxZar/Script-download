// ==UserScript==
// @name         Renta-Rip
// @version      1.0
// @author       EryxZar
// @match        https://dre-viewer.papy.co.jp/*
// @require      https://unpkg.com/@zip.js/zip.js@2.7.60/dist/zip-full.min.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    if (window.top !== window.self) return;

    // --- CONFIGURACIÓN DEL MOTOR ---
    const imageSplit = 7;
    const totalTiles = 49;

    function createUI() {
        const rawTitle = (document.title || 'HO_Manga').split('|')[0].trim();
        const safeTitle = rawTitle.replace(/[\\/:*?"<>|]/g, '_');

        const style = document.createElement('style');
        style.innerHTML = `
            #ho-panel { position: fixed; top: 20px; right: 20px; width: 280px; background: #1e1e2e; border: 2px solid #89b4fa; border-radius: 12px; z-index: 100000; padding: 15px; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #cdd6f4; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
            #ho-panel h3 { margin: 0 0 10px 0; font-size: 16px; color: #89b4fa; text-align: center; border-bottom: 1px solid #313244; padding-bottom: 8px; }
            .ho-field { margin-bottom: 12px; }
            .ho-label { font-size: 11px; color: #a6adc8; margin-bottom: 4px; display: block; }
            #ho-filename { width: 100%; background: #313244; border: 1px solid #45475a; color: #fff; padding: 6px; border-radius: 4px; font-size: 13px; outline: none; }
            #ho-progress-container { width: 100%; height: 8px; background: #313244; border-radius: 4px; margin: 15px 0; overflow: hidden; display: none; }
            #ho-progress-bar { width: 0%; height: 100%; background: #a6e3a1; transition: width 0.3s; }
            #ho-status { font-size: 12px; text-align: center; margin-bottom: 10px; color: #fab387; }
            #ho-btn-start { width: 100%; padding: 10px; background: #89b4fa; color: #11111b; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; transition: 0.3s; }
            #ho-btn-start:hover { background: #b4befe; }
            #ho-btn-start:disabled { background: #45475a; color: #6c7086; cursor: not-allowed; }
        `;
        document.head.appendChild(style);

        const panel = document.createElement('div');
        panel.id = 'ho-panel';
        panel.innerHTML = `
            <h3>RENTA-RIP</h3>
            <div class="ho-field">
                <span class="ho-label">NOMBRE</span>
                <input type="text" id="ho-filename" value="${safeTitle}">
            </div>
            <div id="ho-status">Listo para procesar</div>
            <div id="ho-progress-container">
                <div id="ho-progress-bar"></div>
            </div>
            <button id="ho-btn-start">INICIAR DESCARGA</button>
            <div style="font-size: 10px; text-align: center; margin-top: 10px; color: #585b70;">Autor EryxZar</div>
        `;
        document.body.appendChild(panel);

        const btn = document.getElementById('ho-btn-start');
        const barContainer = document.getElementById('ho-progress-container');
        const bar = document.getElementById('ho-progress-bar');
        const status = document.getElementById('ho-status');
        const filenameInput = document.getElementById('ho-filename');

        btn.onclick = async () => {
            const prd_ser = window.prd_ser;
            const totalPages = window.max_page;

            if (!prd_ser) {
                status.innerText = "Error: No se detectó ID de producto";
                return;
            }

            btn.disabled = true;
            barContainer.style.display = 'block';
            const zipWriter = new zip.ZipWriter(new zip.BlobWriter("application/zip"));

            try {
                for (let i = 1; i <= totalPages; i++) {
                    status.innerText = `Procesando página ${i}...`;
                    const percent = (i / totalPages) * 100;
                    bar.style.width = `${percent}%`;

                    const tileMap = generateTileMap(i, prd_ser);

                    if (!window.arChara[i] || !window.arChara[i].comp) {
                        window.getImageData(i);
                        await new Promise(r => {
                            const check = setInterval(() => {
                                if (window.arChara[i] && window.arChara[i].comp) {
                                    clearInterval(check);
                                    r();
                                }
                            }, 100);
                        });
                    }

                    const pageCanvas = assemblePage(i, tileMap);

                    if (pageCanvas) {
                        const blob = await new Promise(res => pageCanvas.toBlob(res, 'image/jpeg', 0.9));
                        await zipWriter.add(`${String(i).padStart(3, '0')}.jpg`, new zip.BlobReader(blob));
                    }
                }

                status.innerText = "Empaquetando ZIP...";
                const finalZip = await zipWriter.close();
                const link = document.createElement('a');
                link.href = URL.createObjectURL(finalZip);
                link.download = `${filenameInput.value}.zip`;
                link.click();

                status.innerText = "¡Descarga Exitosa!";
                btn.innerText = "FINALIZADO";
            } catch (err) {
                status.innerText = "Error en el proceso";
                console.error(err);
                btn.disabled = false;
            }
        };
    }

    // --- LÓGICA DE RECONSTRUCCIÓN ---
    function generateTileMap(pageNum, prd_ser) {
        let grid = Array.from({ length: 7 }, (_, i) => Array.from({ length: 7 }, (_, j) => i * 7 + j));

        for (let i = 0; i < 7; i++) {
            let shift = 7 - (i % 7);
            grid[i] = [...grid[i].slice(shift % 7), ...grid[i].slice(0, shift % 7)];
        }
        for (let j = 0; j < 7; j++) {
            let col = grid.map(row => row[j]);
            let shift = 7 - (j % 7);
            let newCol = [...col.slice(shift % 7), ...col.slice(0, shift % 7)];
            for (let i = 0; i < 7; i++) grid[i][j] = newCol[i];
        }

        for (let i = 0; i < 7; i++) {
            let seed = parseInt(pageNum) + parseInt(prd_ser);
            if (seed % 20 === 0) seed = Math.abs(pageNum - prd_ser) + 21;
            let iterations = parseInt(((i + 1) * seed + pageNum / 20) % 20) - 1;
            for (let w = iterations; w >= 0; w--) {
                grid = applyFShuffleR(grid, w, i);
            }
        }

        let map = {};
        grid.forEach((row, y) => row.forEach((val, x) => map[val] = { x, y }));
        return map;
    }

    function applyFShuffleR(grid, t, a) {
        let n = 7, half = 4;
        let even = [], odd = [], res = [];
        if (t % 2 === 0) {
            for (let i = 0; i < n; i++) (i % 2 === 0) ? even.push(grid[i][a]) : odd.push(grid[i][a]);
            for (let i = 0; i < half; i++) {
                if (odd[i] !== undefined) res.push(odd[i]);
                if (even[i] !== undefined) res.push(even[i]);
            }
        } else {
            for (let i = 0; i < n; i++) (i < half) ? even.push(grid[i][a]) : odd.push(grid[i][a]);
            for (let i = 0; i < half; i++) {
                if (even[i] !== undefined) res.push(even[i]);
                if (odd[i] !== undefined) res.push(odd[i]);
            }
        }
        res.forEach((v, i) => grid[i][a] = v);
        return grid;
    }

    function assemblePage(pageNum, tileMap) {
        const data = window.arChara[pageNum];
        const canvas = document.createElement('canvas');
        canvas.width = data.mWidth;
        canvas.height = data.mHeight;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        if (data.diff.wImg.width > 0) ctx.drawImage(data.diff.wImg, 0, 0);
        if (data.diff.hImg.height > 0) ctx.drawImage(data.diff.hImg, 0, 0);

        for (let i = 0; i < 49; i++) {
            const img = data.img[i];
            const pos = tileMap[i];
            ctx.drawImage(img, 0, 0, img.width, img.height,
                          pos.x * img.width + data.diff.wImg.width,
                          pos.y * img.height + data.diff.hImg.height,
                          img.width, img.height);
        }
        return canvas;
    }

    setTimeout(createUI, 1500);
})();