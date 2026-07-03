// ==UserScript==
// @name         KakaoBook-Rip
// @version      3.3
// @description  Nueva version.
// @author       EryxZar
// @match        *://page.kakao.com/content/*
// @match        *://page.kakao.com/contents/*
// @grant        none
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// ==/UserScript==

(function() {
    'use strict';

    let seriesMetadata = { title: "Serie", episodes: [], startsAtZero: false };

    function limpiarBasura(lineas) {
        let filtradas = lineas.map(l => l.trim());
        let compactadas = [];
        for (let i = 0; i < filtradas.length; i++) {
            const actual = filtradas[i];
            if (actual === "" && compactadas.length > 0 && compactadas[compactadas.length - 1] === "") continue;
            compactadas.push(actual);
        }
        while (compactadas.length > 0 && compactadas[0] === "") compactadas.shift();
        while (compactadas.length > 0 && compactadas[compactadas.length - 1] === "") compactadas.pop();
        return compactadas;
    }

    async function fetchEpisodeContent(seriesId, productId) {
        const apiUrl = `https://bff-page.kakao.com/api/gateway/api/v1/viewer/data?series_id=${seriesId}&product_id=${productId}`;
        const apiRes = await fetch(apiUrl, { credentials: 'include' });
        const apiData = await apiRes.json();

        const vData = apiData.viewer_data || apiData.result?.viewer_data || apiData.viewerData || apiData.result?.viewerData;
        if (!vData) throw new Error("No disponible (vData no encontrado)");

        const contentsList = vData.contents_list || vData.contentsList;
        if (!contentsList) throw new Error("No disponible (contentsList no encontrado)");

        // CORRECCIÓN CRÍTICA: Forzar HTTPS para evitar bloqueo del navegador (Mixed Content)
        let atsServerUrl = vData.ats_server_url || vData.atsServerUrl || "";
        atsServerUrl = atsServerUrl.replace(/^http:\/\//i, 'https://');

        let sortedContents = contentsList.sort((a, b) => {
            const aChap = a.chapter_id !== undefined ? a.chapter_id : (a.chapterId || 0);
            const bChap = b.chapter_id !== undefined ? b.chapter_id : (b.chapterId || 0);
            if (aChap !== bChap) return aChap - bChap;

            const aCont = a.content_id !== undefined ? a.content_id : (a.contentId || 0);
            const bCont = b.content_id !== undefined ? b.content_id : (b.contentId || 0);
            return aCont - bCont;
        });

        let textoTotal = [];
        for (const frag of sortedContents) {
            const secureUrl = frag.secure_url || frag.secureUrl;
            if (!secureUrl || secureUrl.includes("textviewerContentMeta")) continue;

            const res = await fetch(atsServerUrl + secureUrl, { credentials: 'include' });
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            const jsonObj = await res.json();
            textoTotal = textoTotal.concat(extraerTextoRecursivo(jsonObj));
        }
        return limpiarBasura(textoTotal);
    }

    function extraerTextoRecursivo(objDatos) {
        let encontrados = [];
        const contentInfo = objDatos?.content_info || objDatos?.contentInfo;

        if (contentInfo) {
            const pList = contentInfo.paragraph_list || contentInfo.paragraphList;
            if (pList) {
                pList.forEach(p => {
                    let textoAcumulado = "";
                    const childList = p.child_paragraph_list || p.childParagraphList;
                    if (childList) {
                        childList.forEach(child => {
                            if (child.type === "TEXT" && child.text) {
                                textoAcumulado += child.text.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
                            } else if (child.type === "BR") {
                                textoAcumulado += "\n";
                            }
                        });
                    }
                    encontrados.push(textoAcumulado.trim());
                });
            }
        }
        return encontrados;
    }

    function parseRange(input, max, offset) {
        const result = new Set();
        input.split(',').forEach(p => {
            if (p.includes('-')) {
                const [start, end] = p.split('-').map(n => parseInt(n.trim()));
                if (!isNaN(start) && !isNaN(end)) {
                    for (let i = Math.min(start, end); i <= Math.max(start, end); i++) {
                        let idx = (offset === 0) ? i : i - 1;
                        if (idx >= 0 && idx < max) result.add(idx);
                    }
                }
            } else {
                const val = parseInt(p.trim());
                let idx = (offset === 0) ? val : val - 1;
                if (!isNaN(val) && idx >= 0 && idx < max) result.add(idx);
            }
        });
        return Array.from(result).sort((a, b) => a - b);
    }

    async function getFullEpisodeList(seriesId) {
        let allEpisodes = [];
        let hasNext = true, cursorIndex = 0, seriesTitle = "Serie";
        while (hasNext) {
            const url = `https://bff-page.kakao.com/api/gateway/api/v2/content/product/list?series_id=${seriesId}&cursor_index=${cursorIndex}&cursor_direction=NEXT&window_size=100&sort_type=asc`;
            const res = await fetch(url, { credentials: 'include' });
            const data = await res.json();
            if (data.result) {
                if (cursorIndex === 0) seriesTitle = data.result.series_item?.title || "Serie";
                const list = data.result.list || [];
                list.forEach(entry => allEpisodes.push({ productId: entry.item.product_id, title: entry.item.title }));
                hasNext = data.result.has_next;
                if (hasNext && list.length > 0) cursorIndex = list[list.length - 1].cursor_index;
            } else hasNext = false;
        }
        const startsAtZero = allEpisodes.length > 0 && allEpisodes[0].title.includes("서장");
        return { title: seriesTitle, episodes: allEpisodes, startsAtZero: startsAtZero };
    }

    async function saveAsEpub(textArray, title) {
        const zip = new JSZip();
        zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
        const metaInf = zip.folder("META-INF");
        metaInf.file("container.xml", `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
        const oebps = zip.folder("OEBPS");
        let htmlContent = `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml">\n<head><title>${title}</title><style>body{font-family:sans-serif;line-height:1.6;padding:20px;} p{margin-bottom:1em; white-space: pre-wrap;}</style></head>\n<body>\n`;
        textArray.forEach(t => { htmlContent += `<p>${t || '&nbsp;'}</p>`; });
        htmlContent += `</body></html>`;
        oebps.file("chapter.xhtml", htmlContent);
        oebps.file("content.opf", `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title><dc:creator>EryxZar</dc:creator><dc:language>ko</dc:language></metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="content" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine toc="ncx"><itemref idref="content"/></spine></package>`);
        oebps.file("toc.ncx", `<?xml version="1.0" encoding="utf-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap><navPoint id="navpoint-1" playOrder="1"><navLabel><text>${title}</text></navLabel><content src="chapter.xhtml"/></navPoint></navMap></ncx>`);
        return await zip.generateAsync({ type: "blob" });
    }

    function triggerDownload(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename.replace(/[/\\?%*:|"<>]/g, '-');
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function createUI(seriesId) {
        if (document.getElementById('kakao-rip-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'kakao-rip-panel';
        panel.style.cssText = `position:fixed; bottom:20px; right:20px; z-index:10000; background:#1e1e1e; color:white; padding:15px; border-radius:12px; border:2px solid #f9e000; box-shadow:0 8px 20px rgba(0,0,0,0.5); width:280px; font-family:sans-serif;`;
        panel.innerHTML = `
            <div id="rip-status" style="margin-bottom:10px; font-weight:bold; color:#f9e000; text-align:center;">Detectando capítulos...</div>
            <div id="rip-controls" style="display:none;">
                <div id="rip-series-title" style="margin-bottom:5px; font-size:14px; font-weight:bold;"></div>
                <div id="rip-total-count" style="margin-bottom:10px; font-size:11px; color:#aaa;"></div>
                <div style="margin-bottom:12px;">
                    <label id="rip-range-label" style="font-size:11px; display:block; margin-bottom:4px;">Rango:</label>
                    <input type="text" id="rip-range-input" style="width:100%; padding:8px; border-radius:6px; border:none; background:#fff; color:#000; font-weight:bold; box-sizing: border-box;">
                </div>
                <div style="display:flex; gap:15px; margin-bottom:12px; font-size:12px;">
                    <label style="cursor:pointer;"><input type="checkbox" id="rip-chk-txt" checked> TXT</label>
                    <label style="cursor:pointer;"><input type="checkbox" id="rip-chk-epub" checked> EPUB</label>
                </div>
                <button id="rip-btn-batch" style="width:100%; background:#f9e000; color:#000; font-weight:bold; padding:10px; border:none; border-radius:6px; cursor:pointer;">⬇️ DESCARGAR LOTE (ZIP)</button>
            </div>
            <div id="rip-progress" style="margin-top:10px; font-size:12px; text-align:center; color:#f9e000;"></div>
        `;
        document.body.appendChild(panel);

        getFullEpisodeList(seriesId).then(data => {
            seriesMetadata = data;
            document.getElementById('rip-status').style.display = 'none';
            document.getElementById('rip-controls').style.display = 'block';
            document.getElementById('rip-series-title').innerText = "📖 " + data.title;

            const startNum = data.startsAtZero ? 0 : 1;
            const endNum = data.startsAtZero ? data.episodes.length - 1 : data.episodes.length;

            document.getElementById('rip-total-count').innerText = `✅ Detectados: ${data.episodes.length} capítulos`;
            document.getElementById('rip-range-label').innerText = `Rango sugerido (${startNum}-${endNum}):`;
            document.getElementById('rip-range-input').value = `${startNum}-${endNum}`;
        });

        document.getElementById('rip-btn-batch').onclick = async () => {
            const offset = seriesMetadata.startsAtZero ? 0 : 1;
            const indices = parseRange(document.getElementById('rip-range-input').value, seriesMetadata.episodes.length, offset);

            if (!indices.length) return alert("Rango inválido");
            const btn = document.getElementById('rip-btn-batch');
            const prog = document.getElementById('rip-progress');
            btn.disabled = true;
            const zip = new JSZip();

            let filesAdded = 0;

            for (let i = 0; i < indices.length; i++) {
                const ep = seriesMetadata.episodes[indices[i]];
                prog.innerText = `Bajando: ${i + 1} / ${indices.length}`;
                try {
                    const lines = await fetchEpisodeContent(seriesId, ep.productId);
                    if (lines && lines.length > 0) {
                        const safeTitle = ep.title.replace(/[/\\?%*:|"<>]/g, '-');
                        if (document.getElementById('rip-chk-txt').checked) zip.file(`TXT/${safeTitle}.txt`, lines.join("\n"));
                        if (document.getElementById('rip-chk-epub').checked) zip.file(`EPUB/${safeTitle}.epub`, await saveAsEpub(lines, ep.title));
                        filesAdded++;
                    }
                } catch (e) {
                    console.error(`Error en el capítulo ${ep.title}:`, e);
                }
                await new Promise(r => setTimeout(r, 200));
            }

            if (filesAdded === 0) {
                prog.innerText = "Error: Ningún archivo descargado.";
                btn.disabled = false;
                return;
            }

            prog.innerText = "Generando ZIP...";
            const blob = await zip.generateAsync({ type: "blob" });
            triggerDownload(blob, `${seriesMetadata.title}.zip`);
            prog.innerText = "¡Completado!";
            btn.disabled = false;
        };
    }

    function init() {
        const match = window.location.href.match(/\/content\/(\d+)/);
        if (match) createUI(match[1]);
    }

    window.addEventListener('load', init);
    let lastUrl = location.href;
    new MutationObserver(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            setTimeout(init, 1000);
        }
    }).observe(document, { subtree: true, childList: true });
})();
