// ==UserScript==
// @name         Lezhin-Rip
// @version      4.0
// @description  Descarga masiva.
// @author       EryxZar
// @match        https://www.lezhin.com/*/comic/*
// @match        https://www.lezhinus.com/en/comic/*
// @require      https://unpkg.com/@zip.js/zip.js@2.7.60/dist/zip-full.min.js
// @grant        GM_xmlhttpRequest
// @connect      lezhin.com
// @connect      lezhinus.com
// @connect      rcdn.lezhin.com
// ==/UserScript==

(function() {
    'use strict';

    let episodeMap = new Map();

    const style = document.createElement('style');
    style.innerHTML = `
        :root { --accent: #e63946; --bg: #1a1a1a; --text: #fff; }
        #ez-trigger { position: fixed; bottom: 20px; right: 20px; z-index: 1000001; width: 60px; height: 60px; background: var(--accent); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; border: 2px solid #fff; cursor:pointer; box-shadow: 0 4px 15px rgba(0,0,0,0.5); font-size: 26px; }
        #ez-panel { position: fixed; bottom: 90px; right: 20px; z-index: 1000000; background: var(--bg); color: var(--text); padding: 20px; border: 2px solid var(--accent); border-radius: 15px; width: 320px; display: none; font-family: sans-serif; box-shadow: 0 5px 25px rgba(0,0,0,0.7); }
        #ez-panel.show { display: block; }
        .ez-counter-header { background: #2a2a2a; padding: 10px; border-radius: 8px; margin-bottom: 15px; border-left: 4px solid var(--accent); }
        .ez-counter-header p { margin: 0; font-size: 11px; color: #aaa; }
        .ez-counter-header span { font-size: 18px; font-weight: bold; color: var(--text); }
        .ez-field { margin-bottom: 12px; }
        .ez-field label { display: block; font-size: 11px; color: #aaa; margin-bottom: 4px; }
        .ez-field input[type="text"], .ez-field input[type="number"] { width: 100%; background: #222; color: #fff; border: 1px solid #444; border-radius: 6px; padding: 10px; box-sizing: border-box; font-size: 13px; }
        .ez-check { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #ccc; margin-top: 5px; cursor: pointer; }
        #ez-start-btn { width: 100%; padding: 14px; background: var(--accent); color: white; border: none; border-radius: 8px; font-weight: bold; cursor:pointer; margin-top: 10px; font-size: 14px; }
        #ez-start-btn:disabled { background: #444; color: #888; cursor: not-allowed; }
        .status-log { font-size: 12px; margin-top: 12px; color: var(--accent); text-align: center; font-weight: bold; white-space: pre-wrap; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 6px; border: 1px solid #333; }
    `;
    document.head.appendChild(style);

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
        return arr.map((v, k) => ({ from: getArea(k), to: getArea(v) })).filter(m => m.from && m.to);
    };

    function liveScan() {
        const links = document.querySelectorAll('a[href*="/comic/"]');
        let newFound = false;
        links.forEach(link => {
            const href = link.href;
            const m = href.match(/\/(\d+)(\?|$)/);
            const p = href.match(/\/p(\d+)(\?|$)/);

            let num = null;
            if (m) num = parseInt(m[1]);
            else if (p) num = 0;

            if (num !== null) {
                if (!episodeMap.has(num)) {
                    episodeMap.set(num, href);
                    newFound = true;
                }
            }
        });
        if (newFound || episodeMap.size > 0) {
            const countDisplay = document.getElementById('ez-detected-count');
            const btn = document.getElementById('ez-start-btn');
            if (countDisplay) countDisplay.innerText = episodeMap.size;
            if (btn && episodeMap.size > 0 && btn.innerText.includes('Esperando')) {
                btn.disabled = false;
                btn.innerText = `🚀 Iniciar Descarga`;
            }
        }
        const titleEl = document.querySelector('.episodeListDetail__title__IV6kt') || document.querySelector('h2');
        const nameInput = document.getElementById('ez-name');
        if (titleEl && nameInput && nameInput.value === "") nameInput.value = titleEl.innerText.trim();
    }

    async function downloadChapter(epUrl, epNum, zipWriter, statusEl, hLimit, doStitch) {
        statusEl.innerText = `🔍 Accediendo Cap ${epNum}...`;
        const html = await new Promise(r => GM_xmlhttpRequest({ method: "GET", url: epUrl, onload: (res) => r(res.responseText) }));
        const policy = html.match(/\\?"Policy\\?":\\?"([^"\\]+)\\?"/)?.[1];
        const signature = html.match(/\\?"Signature\\?":\\?"([^"\\]+)\\?"/)?.[1];
        const keyPairId = html.match(/\\?"Key-Pair-Id\\?":\\?"([^"\\]+)\\?"/)?.[1];
        const isP = html.includes('"purchased":true') || html.includes('purchased=true');
        if (!policy) throw "Error Auth";

        const query = `?purchased=${isP}&q=40&Policy=${policy}&Signature=${signature}&Key-Pair-Id=${keyPairId}`;
        const pattern = /\\?"path\\?":\\?"([^"]+)\\?",\\?"cutType\\?":\\?"contents\\?",\\?"shuffleKey\\?":(\d+|\\?"\$undefined\\?")/g;
        let imgs = [], m;
        while ((m = pattern.exec(html)) !== null) {
            imgs.push({ url: `https://rcdn.lezhin.com/v2${m[1].replace(/\\/g, '')}${query}`, sKey: m[2].replace(/\\|"/g, '') === '$undefined' ? null : m[2].replace(/\\|"/g, '') });
        }

        const workCanvas = document.createElement('canvas');
        const ctx = workCanvas.getContext('2d', { alpha: false });
        let currentH = 0, part = 1, isInit = false;
        const auth = document.cookie.match(/_LZ_AT=([^;]+)/)?.[1];

        for (let i = 0; i < imgs.length; i++) {
            statusEl.innerText = `⬇️ Cap ${epNum}: ${i+1}/${imgs.length}`;
            const blob = await new Promise((res, rej) => GM_xmlhttpRequest({
                method: "GET", url: imgs[i].url, responseType: "blob",
                headers: { "Referer": epUrl, "Authorization": auth ? `Bearer ${auth}` : "" },
                onload: (r) => r.status === 200 ? res(r.response) : rej(),
                onerror: rej
            }));

            let bitmap = await createImageBitmap(blob);
            if (imgs[i].sKey) {
                const temp = document.createElement('canvas'); temp.width = bitmap.width; temp.height = bitmap.height;
                decrypt_image(imgs[i].sKey, bitmap).forEach(m => temp.getContext('2d').drawImage(bitmap, m.to.left, m.to.top, m.to.width, m.to.height, m.from.left, m.from.top, m.from.width, m.from.height));
                bitmap.close(); bitmap = await createImageBitmap(temp);
            }

            if (!doStitch) {
                const c = document.createElement('canvas');
                c.width = bitmap.width; c.height = bitmap.height;
                c.getContext('2d').drawImage(bitmap, 0, 0);
                const out = await new Promise(r => c.toBlob(r, "image/jpeg", 0.9));
                await zipWriter.add(`Cap_${epNum}/${String(i+1).padStart(3, '0')}.jpg`, new zip.BlobReader(out));
                bitmap.close();
                continue;
            }

            if (!isInit) { workCanvas.width = bitmap.width; workCanvas.height = hLimit; ctx.fillStyle = "#fff"; ctx.fillRect(0,0,workCanvas.width, hLimit); isInit = true; }
            let srcY = 0, remH = bitmap.height;
            while (remH > 0) {
                let drawH = Math.min(remH, hLimit - currentH);
                ctx.drawImage(bitmap, 0, srcY, bitmap.width, drawH, 0, currentH, bitmap.width, drawH);
                currentH += drawH; srcY += drawH; remH -= drawH;
                if (currentH >= hLimit) {
                    const b = await new Promise(r => workCanvas.toBlob(r, "image/jpeg", 0.85));
                    await zipWriter.add(`Cap_${epNum}/${String(part++).padStart(3, '0')}.jpg`, new zip.BlobReader(b));
                    currentH = 0; ctx.fillRect(0,0,workCanvas.width, hLimit);
                }
            }
            bitmap.close();
        }

        if (doStitch && currentH > 0) {
            const finalC = document.createElement('canvas'); finalC.width = workCanvas.width; finalC.height = currentH;
            finalC.getContext('2d').drawImage(workCanvas, 0, 0);
            const b = await new Promise(r => finalC.toBlob(r, "image/jpeg", 0.85));
            await zipWriter.add(`Cap_${epNum}/${String(part).padStart(3, '0')}.jpg`, new zip.BlobReader(b));
        }
    }

    async function run() {
        const rangeStr = document.getElementById('ez-range').value.trim();
        const hLimit = parseInt(document.getElementById('ez-h-limit').value);
        const doStitch = document.getElementById('ez-do-stitch').checked;
        const targets = rangeStr.split(',').flatMap(p => {
            if (p.includes('-')) {
                const [s, e] = p.split('-').map(Number);
                return Array.from({length: e-s+1}, (_, i) => s + i);
            }
            return Number(p);
        }).filter(n => !isNaN(n));

        if (targets.length === 0) return alert("Rango vacío");
        const btn = document.getElementById('ez-start-btn');
        const status = document.getElementById('ez-status');
        btn.disabled = true;

        const zipW = new zip.ZipWriter(new zip.BlobWriter("application/zip"));
        for (const n of targets) {
            const url = episodeMap.get(n);
            if (url) {
                try {
                    await downloadChapter(url, n, zipW, status, hLimit, doStitch);
                    await new Promise(r => setTimeout(r, 800));
                } catch(e) { status.innerText = `❌ Falló Cap ${n}`; }
            } else { status.innerText = `⚠️ Cap ${n} no detectado.\n¡Haz scroll hasta verlo!`; await new Promise(r => setTimeout(r, 1500)); }
        }
        status.innerText = "📦 Comprimiendo...";
        const blob = await zipW.close();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${document.getElementById('ez-name').value}_Pack.zip`;
        a.click();
        status.innerText = "✅ ¡Listo!";
        btn.disabled = false;
    }

    function init() {
        if (document.getElementById('ez-trigger')) return;
        const trigger = document.createElement('div');
        trigger.id = 'ez-trigger'; trigger.innerText = '📦';
        document.body.appendChild(trigger);
        const panel = document.createElement('div');
        panel.id = 'ez-panel';
        panel.innerHTML = `
            <div class="ez-counter-header">
                <p>Capítulos detectados:</p>
                <span id="ez-detected-count">0</span>
            </div>
            <div class="ez-field"><label>Nombre Serie:</label><input type="text" id="ez-name"></div>
            <div class="ez-field"><label>Rango (ej: 0, 1, 5-10, 61):</label><input type="text" id="ez-range" placeholder="Escribe 0 para el prólogo"></div>
            <div class="ez-field">
                <label>Límite px:</label>
                <input type="number" id="ez-h-limit" value="10000">
            </div>
            <label class="ez-check"><input type="checkbox" id="ez-do-stitch" checked> Unir imágenes (Stitch)</label>
            <button id="ez-start-btn" disabled>⌛ Esperando detección...</button>
            <div id="ez-status" class="status-log">¡Haz scroll para detectar!</div>
        `;
        document.body.appendChild(panel);
        trigger.onclick = () => panel.classList.toggle('show');
        document.getElementById('ez-start-btn').onclick = run;
        setInterval(liveScan, 1000);
    }
    window.addEventListener('load', () => setTimeout(init, 1500));
})();
