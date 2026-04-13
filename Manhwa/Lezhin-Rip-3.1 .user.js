// ==UserScript==
// @name         Lezhin-Rip
// @version      3.1
// @description  Descarga y corte automático de capítulos largos.
// @author       EryxZar
// @match        https://www.lezhin.com/ko/comic/*/*
// @match        https://www.lezhinus.com/en/comic/*/*
// @match        https://www.lezhinus.com/en/library/comic/en-US/*/*
// @require      https://unpkg.com/@zip.js/zip.js@2.7.60/dist/zip-full.min.js
// @grant        GM_xmlhttpRequest
// @connect      lezhin.com
// @connect      lezhin.jp
// @connect      lezhinus.com
// @connect      rcdn.lezhin.com
// ==/UserScript==

(function() {
    'use strict';

    let imageDataList = [];

    // --- ESTILOS ---
    const style = document.createElement('style');
    style.innerHTML = `
        :root { --accent: #e63946; --bg: #1a1a1a; --text: #fff; }
        #ez-trigger { position: fixed; bottom: 20px; right: 20px; z-index: 1000001; width: 55px; height: 55px; background: var(--accent); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; border: 2px solid #fff; cursor:pointer; box-shadow: 0 4px 10px rgba(0,0,0,0.5); font-size: 24px; }
        #ez-panel { position: fixed; bottom: 85px; right: 20px; z-index: 1000000; background: var(--bg); color: var(--text); padding: 15px; border: 2px solid var(--accent); border-radius: 12px; width: 280px; display: none; font-family: sans-serif; box-shadow: 0 4px 20px rgba(0,0,0,0.6); }
        #ez-panel.show { display: block; }
        #ez-panel h3 { margin: 0 0 10px 0; font-size: 16px; text-align: center; color: var(--accent); border-bottom: 1px solid #333; padding-bottom: 8px; }
        #ez-panel table { width: 100%; font-size: 13px; color: #ccc; margin-bottom: 10px; }
        #ez-panel input { width: 100%; background: #333; color: #fff; border: 1px solid #555; border-radius: 6px; padding: 8px; box-sizing: border-box; font-size: 14px; margin-top: 5px; }
        #ez-panel button { width: 100%; padding: 12px; background: var(--accent); color: white; border: none; border-radius: 6px; font-weight: bold; margin-bottom: 5px; cursor:pointer; font-size: 14px; }
        .close-btn { background: #444 !important; }
        .status-log { font-size: 12px; margin-top: 8px; color: var(--accent); text-align: center; font-weight: bold; white-space: pre-wrap; line-height: 1.4; }
    `;
    document.head.appendChild(style);

    // --- MOTOR DE RECONSTRUCCIÓN ---
    const decrypt_image = (shuffleKey, imgData) => {
        const gridSize = 5;
        const seedObj = { value: BigInt(shuffleKey) };
        const total = gridSize * gridSize;
        const arr = Array.from({ length: total }, (_, i) => i);
        const xor_div = (v, d) => [{ value: v.value / BigInt(d) }, { value: v.value % BigInt(d) }];
        const xor = (a, b) => {
            let v1 = { value: a.value }, v2 = { value: b.value }, res = [];
            while (v1.value !== 0n || v2.value !== 0n) {
                let r1 = xor_div(v1, 0x800000), r2 = xor_div(v2, 0x800000);
                v1 = r1[0]; v2 = r2[0]; res.push(Number(r1[1].value) ^ Number(r2[1].value));
            }
            let out = 0n;
            for (let i = res.length - 1; i >= 0; i--) out = out * 8388608n + BigInt(res[i]);
            return { value: out };
        };
        const nextRand = (max, seed) => {
            seed.value = xor(seed, { value: seed.value / 4096n }).value;
            seed.value = xor(seed, { value: (seed.value * 33554432n) & 18446744073709551615n }).value;
            seed.value = xor(seed, { value: seed.value / 134217728n }).value;
            return Number((seed.value / 4294967296n) % BigInt(max));
        };
        for (let i = 0; i < arr.length; i++) {
            const rand = nextRand(total, seedObj);
            [arr[i], arr[rand]] = [arr[rand], arr[i]];
        }
        const getArea = (idx) => {
            const tw = Math.floor(imgData.width / gridSize), th = Math.floor(imgData.height / gridSize);
            if (idx < total) return { left: (idx % gridSize) * tw, top: Math.floor(idx / gridSize) * th, width: tw, height: th };
            if (idx === total) return (imgData.width % gridSize === 0) ? null : { left: imgData.width - (imgData.width % gridSize), top: 0, width: imgData.width % gridSize, height: imgData.height };
            return (imgData.height % gridSize === 0) ? null : { left: 0, top: imgData.height - (imgData.height % gridSize), width: imgData.width - (imgData.width % gridSize), height: imgData.height % gridSize };
        };
        let mapping = arr.map((v, k) => ({ from: getArea(k), to: getArea(v) }));
        mapping.push({ from: getArea(total), to: getArea(total) }, { from: getArea(total+1), to: getArea(total+1) });
        return mapping.filter(m => m.from && m.to);
    };

    async function init() {
        if (!document.getElementById('ez-trigger')) {
            const trigger = document.createElement('div');
            trigger.id = 'ez-trigger'; trigger.innerText = '📦';
            document.body.appendChild(trigger);
            const panel = document.createElement('div');
            panel.id = 'ez-panel';
            panel.innerHTML = `
                <h3>Lezhin-Rip</h3>
                <table>
                    <tr><td>Nombre:</td><td><input type="text" id="ez-filename"></td></tr>
                    <tr><td>Límite px:</td><td><input type="number" id="ez-h-limit" value="10000"></td></tr>
                    <tr><td colspan="2"><label><input type="checkbox" id="ez-do-stitch" checked> Unir imagen</label></td></tr>
                </table>
                <button id="ez-start-btn" disabled>⌛ Cargando...</button>
                <button class="close-btn" id="ez-close-btn">Cerrar</button>
                <div id="ez-status" class="status-log">Buscando datos...</div>
            `;
            document.body.appendChild(panel);
            trigger.onclick = () => panel.classList.toggle('show');
            document.getElementById('ez-close-btn').onclick = () => panel.classList.remove('show');
            document.getElementById('ez-start-btn').onclick = runProcess;
        }

        const status = document.getElementById('ez-status');
        const btn = document.getElementById('ez-start-btn');

        try {
            const html = document.documentElement.innerHTML;

            const policy = html.match(/\\?"Policy\\?":\\?"([^"\\]+)\\?"/)?.[1];
            const signature = html.match(/\\?"Signature\\?":\\?"([^"\\]+)\\?"/)?.[1];
            const keyPairId = html.match(/\\?"Key-Pair-Id\\?":\\?"([^"\\]+)\\?"/)?.[1];
            const isPurchased = html.match(/\\?"purchased\\?":\s*(true|false)/)?.[1] === 'true';

            if (!policy) throw "No se encontraron tokens de seguridad.";

            const query = `?purchased=${isPurchased}&q=40&Policy=${policy}&Signature=${signature}&Key-Pair-Id=${keyPairId}`;
            const pattern = /\\?"path\\?":\\?"([^"]+)\\?",\\?"cutType\\?":\\?"contents\\?",\\?"shuffleKey\\?":(\d+|\\?"\$undefined\\?")/g;

            let match; imageDataList = [];
            while ((match = pattern.exec(html)) !== null) {
                let path = match[1].replace(/\\/g, '');
                let sKey = match[2].replace(/\\|"/g, '');
                imageDataList.push({
                    url: `https://rcdn.lezhin.com/v2${path}${query}`,
                    shuffleKey: sKey === '$undefined' ? null : sKey,
                    index: parseInt(path.split('/').pop())
                });
            }

            if (imageDataList.length === 0) throw "No se encontraron imágenes.";
            imageDataList.sort((a, b) => a.index - b.index);

            let rawTitle = document.title;
            let cleanTitle = rawTitle.replace(/\s*-\s*\d+\s*-\s*(?:웹툰|Webtoon|Webcomics|レジンコミックス).*$/i, "").trim();
            document.getElementById('ez-filename').value = cleanTitle || "Lezhin_Manga";

            btn.innerText = `🚀 Descargar (${imageDataList.length})`;
            btn.disabled = false;
            status.innerText = `✅ Datos listos.\nModo: ${isPurchased ? 'Comprado' : 'Gratuito'}`;
        } catch (e) {
            status.innerText = `⏳ Buscando datos...\n(Asegúrate de que el capítulo cargó)`;
            setTimeout(init, 2000);
        }
    }

    async function runProcess() {
        const status = document.getElementById('ez-status');
        const btn = document.getElementById('ez-start-btn');
        const stitch = document.getElementById('ez-do-stitch').checked;
        const hLimit = parseInt(document.getElementById('ez-h-limit').value);
        const zipWriter = new zip.ZipWriter(new zip.BlobWriter("application/zip"));

        btn.disabled = true;

        const workCanvas = document.createElement('canvas');
        const ctx = workCanvas.getContext('2d', { alpha: false });
        let currentHeight = 0;
        let fileCount = 1;
        let isCanvasInitialized = false;

        const authToken = document.cookie.match(/_LZ_AT=([^;]+)/)?.[1];

        for (let i = 0; i < imageDataList.length; i++) {
            status.innerText = `⏳ Procesando y cortando: ${i+1}/${imageDataList.length}`;
            const item = imageDataList[i];

            try {
                const blob = await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: "GET",
                        url: item.url,
                        responseType: "blob",
                        headers: {
                            "Referer": window.location.href,
                            "Authorization": authToken ? `Bearer ${authToken}` : ""
                        },
                        onload: (r) => r.status === 200 ? resolve(r.response) : reject(),
                        onerror: reject
                    });
                });

                let bitmap = await createImageBitmap(blob);

                if (item.shuffleKey) {
                    const tempCanvas = document.createElement('canvas');
                    const tCtx = tempCanvas.getContext('2d');
                    tempCanvas.width = bitmap.width; tempCanvas.height = bitmap.height;
                    const maps = decrypt_image(item.shuffleKey, bitmap);
                    maps.forEach(m => tCtx.drawImage(bitmap, m.to.left, m.to.top, m.to.width, m.to.height, m.from.left, m.from.top, m.from.width, m.from.height));
                    bitmap.close();
                    bitmap = await createImageBitmap(tempCanvas);
                }

                if (!stitch) {
                    const c = document.createElement('canvas');
                    c.width = bitmap.width; c.height = bitmap.height;
                    c.getContext('2d').drawImage(bitmap, 0, 0);
                    const out = await new Promise(r => c.toBlob(r, "image/jpeg", 0.9));
                    await zipWriter.add(`${String(i+1).padStart(3, '0')}.jpg`, new zip.BlobReader(out));
                    bitmap.close();
                    continue;
                }

                if (!isCanvasInitialized) {
                    workCanvas.width = bitmap.width;
                    workCanvas.height = hLimit;
                    ctx.fillStyle = "#ffffff";
                    ctx.fillRect(0, 0, workCanvas.width, workCanvas.height);
                    isCanvasInitialized = true;
                }

                let sourceY = 0;
                let remainingBitmapHeight = bitmap.height;

                while (remainingBitmapHeight > 0) {
                    let spaceLeft = hLimit - currentHeight;
                    let drawHeight = Math.min(remainingBitmapHeight, spaceLeft);

                    ctx.drawImage(bitmap,
                        0, sourceY, bitmap.width, drawHeight,
                        0, currentHeight, bitmap.width, drawHeight
                    );

                    currentHeight += drawHeight;
                    sourceY += drawHeight;
                    remainingBitmapHeight -= drawHeight;

                    if (currentHeight >= hLimit) {
                        status.innerText = `🧵 Empaquetando bloque ${fileCount}...`;
                        const finalBlob = await new Promise(r => workCanvas.toBlob(r, "image/jpeg", 0.85));
                        await zipWriter.add(`${String(fileCount++).padStart(3, '0')}.jpg`, new zip.BlobReader(finalBlob));

                        currentHeight = 0;
                        ctx.fillStyle = "#ffffff";
                        ctx.fillRect(0, 0, workCanvas.width, workCanvas.height);
                    }
                }
                bitmap.close();

            } catch(e) {
                console.error("Error en imagen:", i, e);
                status.innerText = `❌ Error en imagen ${i+1}. Míralo en consola.`;
            }
        }

        if (stitch && currentHeight > 0) {
            status.innerText = `🧵 Empaquetando bloque final...`;
            const finalCanvas = document.createElement('canvas');
            finalCanvas.width = workCanvas.width;
            finalCanvas.height = currentHeight;
            finalCanvas.getContext('2d').drawImage(workCanvas, 0, 0);

            const finalBlob = await new Promise(r => finalCanvas.toBlob(r, "image/jpeg", 0.85));
            await zipWriter.add(`${String(fileCount).padStart(3, '0')}.jpg`, new zip.BlobReader(finalBlob));
        }

        status.innerText = "⏳ Finalizando ZIP...";
        const finalZip = await zipWriter.close();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(finalZip);
        a.download = `${document.getElementById('ez-filename').value}.zip`;
        a.click();

        status.innerText = "✅ ¡Descarga exitosa!";
        btn.disabled = false;
        setTimeout(() => URL.revokeObjectURL(a.href), 15000);
    }

    window.addEventListener('load', () => setTimeout(init, 1500));
})();