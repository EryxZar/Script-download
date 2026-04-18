// ==UserScript==
// @name         KakaoBook-Rip
// @version      1.0
// @description  Descargar novela web
// @author       EryxZar
// @match        https://page.kakao.com/content/*/viewer/*
// @grant        none
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// ==/UserScript==

(function() {
    'use strict';

    function limpiarBasura(lineas) {
        const filtros = [
            "KWBOOKS",
            "저작권",
            "전자책으로 발",
            "무단복제",
            "저작권법",
            "금지되어 있습니다",
            "장편소설",
            "무료 제공",
            "에이스아티스포럼",
            "지은이",
            "발행인",
            "발행일",
            "정가",
            "제공",
            "주소",
            "UCI",
            "멸망한 세계의 플레이어"
        ];

        let filtradas = lineas.filter(linea => {
            const t = linea.trim();
            if (!t) return true;

            if (filtros.some(f => t.includes(f))) return false;
            if (t.startsWith(':') || t.includes(' : ')) return false;
            if (/^[A-Z0-9]{3,}:[A-Z0-9\+]{3,}/.test(t) || t.includes('G720')) return false;

            return true;
        });

        let compactadas = [];
        for (let i = 0; i < filtradas.length; i++) {
            const actual = filtradas[i].trim();
            if (actual === "" && compactadas.length > 0 && compactadas[compactadas.length - 1] === "") {
                continue;
            }
            compactadas.push(actual);
        }

        while (compactadas.length > 0 && compactadas[0] === "") compactadas.shift();
        while (compactadas.length > 0 && compactadas[compactadas.length - 1] === "") compactadas.pop();

        return compactadas;
    }

    function extraerTextoRecursivo(objDatos) {
        const esCopyright = JSON.stringify(objDatos).includes('"저작권"');
        if (esCopyright) return [];

        let encontrados = [];
        if (objDatos?.contentInfo?.paragraphList) {
            objDatos.contentInfo.paragraphList.forEach(p => {
                let textoAcumulado = "";
                if (p.childParagraphList) {
                    p.childParagraphList.forEach(child => {
                        if (child.type === "TEXT" && child.text) {
                            textoAcumulado += child.text
                                .replace(/&nbsp;/g, ' ')
                                .replace(/&lt;/g, '<')
                                .replace(/&gt;/g, '>')
                                .replace(/&amp;/g, '&');
                        } else if (child.type === "BR") {
                            textoAcumulado += "\n";
                        }
                    });
                }
                encontrados.push(textoAcumulado.trim());
            });
            return encontrados;
        }

        function fallback(data) {
            if (!data) return;
            if (typeof data === 'object') {
                if (data.text) encontrados.push(data.text.replace(/&nbsp;/g, ' ').trim());
                Object.values(data).forEach(fallback);
            }
        }
        fallback(objDatos);
        return encontrados;
    }

    async function startProcess(mode) {
        const inputTitle = document.getElementById('eryx-title-input');
        const mainBtn = document.getElementById(`btn-eryx-${mode}`);
        let seriesId, productId;

        const pathParts = window.location.pathname.split('/');
        if (pathParts.includes('viewer')) {
            const idx = pathParts.indexOf('viewer');
            productId = pathParts[idx + 1];
            const cIdx = pathParts.indexOf('content');
            if (cIdx !== -1) seriesId = pathParts[cIdx + 1];
        }

        if (!seriesId || !productId) {
            const urlParams = new URLSearchParams(window.location.search);
            seriesId = urlParams.get('seriesId') || urlParams.get('series_id');
            productId = urlParams.get('productId') || urlParams.get('product_id');
        }

        if (!seriesId || !productId) return alert("No se detectó el ID del contenido.");

        updateButtonsState(true);
        const originalText = mainBtn.innerText;
        mainBtn.innerText = "⏳";

        try {
            const apiUrl = `https://bff-page.kakao.com/api/gateway/api/v1/viewer/data?series_id=${seriesId}&product_id=${productId}`;
            const apiRes = await fetch(apiUrl, { credentials: 'include' });
            const apiData = await apiRes.json();
            const vData = apiData.result?.viewerData || apiData.viewerData;
            const finalTitle = inputTitle.value.trim() || "Novela_EryxZar";

            if (mode === 'img') {
                let rawThumb = apiData.item?.thumbnail || apiData.seriesItem?.thumbnail || "";
                let thumbUrl = rawThumb ? (rawThumb.startsWith('//') ? 'https:' + rawThumb : rawThumb) : "";
                let hdUrl = thumbUrl.replace(/[&?]filename=th[0-9]/g, "");
                window.open(hdUrl, '_blank');
                return;
            }

            if (!vData?.contentsList) throw new Error("Contenido no accesible.");
            const baseUrl = vData.atsServerUrl;
            let contents = vData.contentsList.sort((a, b) => (a.contentId || 0) - (b.contentId || 0));
            let textoTotal = [];

            for (let i = 0; i < contents.length; i++) {
                const frag = contents[i];
                if (!frag.secureUrl || frag.secureUrl.includes("textviewerContentMeta")) continue;

                const res = await fetch(baseUrl + frag.secureUrl, { credentials: 'include' });
                const jsonObj = await res.json();
                let textoFragmento = extraerTextoRecursivo(jsonObj);
                textoTotal = textoTotal.concat(textoFragmento);

                if (i % 5 === 0) await new Promise(r => setTimeout(r, 10));
            }

            textoTotal = limpiarBasura(textoTotal);

            if (mode === 'txt') {
                triggerDownload(new Blob([textoTotal.join("\n")], { type: 'text/plain;charset=utf-8' }), `${finalTitle}.txt`);
            } else if (mode === 'epub') {
                await saveAsEpub(textoTotal, finalTitle);
            }

        } catch (err) {
            console.error(err);
            alert("Error: " + err);
        } finally {
            updateButtonsState(false);
            mainBtn.innerText = originalText;
        }
    }

    async function saveAsEpub(arrayTexto, title) {
        const zip = new JSZip();
        zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
        const metaInf = zip.folder("META-INF");
        metaInf.file("container.xml", `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);

        const oebps = zip.folder("OEBPS");
        let htmlContent = `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml">\n<head><title>${title}</title><style>body{font-family:sans-serif;line-height:1.6;padding:20px;} p{margin-bottom:1em; white-space: pre-wrap;}</style></head>\n<body>\n`;
        arrayTexto.forEach(t => {
            htmlContent += `<p>${t || '&nbsp;'}</p>`;
        });
        htmlContent += `</body></html>`;

        oebps.file("chapter.xhtml", htmlContent);
        oebps.file("content.opf", `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title><dc:creator>EryxZar</dc:creator><dc:language>ko</dc:language></metadata><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="content" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine toc="ncx"><itemref idref="content"/></spine></package>`);
        oebps.file("toc.ncx", `<?xml version="1.0" encoding="utf-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap><navPoint id="navpoint-1" playOrder="1"><navLabel><text>${title}</text></navLabel><content src="chapter.xhtml"/></navPoint></navMap></ncx>`);

        const content = await zip.generateAsync({ type: "blob" });
        triggerDownload(content, `${title}.epub`);
    }

    function triggerDownload(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename.replace(/[/\\?%*:|"<>]/g, '-');
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function cleanTitle(str) { return str.replace(/[\s\-\|]+카카오페이지/gi, "").trim(); }

    function updateButtonsState(disabled) {
        ['btn-eryx-txt', 'btn-eryx-epub', 'btn-eryx-img'].forEach(id => {
            const b = document.getElementById(id);
            if (b) { b.disabled = disabled; b.style.opacity = disabled ? "0.5" : "1"; }
        });
    }

    function init() {
        if (!window.location.href.includes('viewer') || document.getElementById('eryx-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'eryx-panel';
        panel.style = "position:fixed; bottom:20px; right:20px; z-index:10000; background:#1e1e1e; color:white; padding:15px; border-radius:12px; border:2px solid #f9e000; box-shadow:0 8px 20px rgba(0,0,0,0.5); display:flex; flex-direction:column; gap:10px; width:260px; font-family: sans-serif;";
        const input = document.createElement('input');
        input.id = 'eryx-title-input';
        input.type = 'text';
        input.value = cleanTitle(document.title);
        input.style = "padding:8px; border-radius:4px; border:1px solid #444; background:#fff; color:#000; font-size:13px;";
        const mainBtns = document.createElement('div');
        mainBtns.style = "display:flex; gap:8px;";
        const btnStyle = "flex:1; padding:10px 5px; border:none; border-radius:6px; font-weight:bold; cursor:pointer; font-size:12px;";
        const btnTxt = document.createElement('button');
        btnTxt.id = 'btn-eryx-txt'; btnTxt.innerText = '💾 TXT';
        btnTxt.style = btnStyle + "background:#f9e000; color:#3c1e1e;";
        btnTxt.onclick = () => startProcess('txt');
        const btnEpub = document.createElement('button');
        btnEpub.id = 'btn-eryx-epub'; btnEpub.innerText = '📚 EPUB';
        btnEpub.style = btnStyle + "background:#007bff; color:white;";
        btnEpub.onclick = () => startProcess('epub');
        const btnImg = document.createElement('button');
        btnImg.id = 'btn-eryx-img'; btnImg.innerText = '🖼️ Portada HD Original';
        btnImg.style = "width:100%; padding:10px; border:none; border-radius:6px; background:#28a745; color:white; font-weight:bold; cursor:pointer; font-size:12px;";
        btnImg.onclick = () => startProcess('img');
        mainBtns.appendChild(btnTxt); mainBtns.appendChild(btnEpub);
        panel.appendChild(input); panel.appendChild(mainBtns); panel.appendChild(btnImg);
        document.body.appendChild(panel);
    }

    window.addEventListener('load', init);
    setInterval(init, 2000);
})();
