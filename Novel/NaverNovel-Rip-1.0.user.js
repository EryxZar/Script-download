// ==UserScript==
// @name         NaverNovel-Rip
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Extractor de novelas de Naver a EPUB con alineación a la izquierda y mantenimiento de estructura.
// @author       EryxZar
// @match        https://novel.naver.com/best/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Interfaz visual (Modo oscuro)
    const style = document.createElement('style');
    style.innerHTML = `
        #nrip-panel {
            position: fixed; bottom: 20px; right: 20px; z-index: 10000;
            background: #121212; color: #e0e0e0; padding: 18px;
            border-radius: 15px; border: 1px solid #00c73c;
            font-family: 'Segoe UI', sans-serif; width: 300px;
            box-shadow: 0 12px 30px rgba(0,0,0,0.7);
        }
        #nrip-panel h4 { margin: 0 0 12px 0; font-size: 16px; color: #00c73c; display: flex; align-items: center; gap: 8px; }
        #nrip-panel input {
            width: 100%; padding: 10px; margin-bottom: 15px;
            border-radius: 6px; border: 1px solid #333;
            background: #1e1e1e; color: #fff; box-sizing: border-box;
        }
        #nrip-btn {
            width: 100%; padding: 12px; background: #00c73c;
            border: none; border-radius: 6px; color: white;
            font-weight: bold; cursor: pointer; transition: 0.2s;
        }
        #nrip-btn:hover { background: #00e646; }
        .nrip-footer { font-size: 10px; margin-top: 10px; text-align: center; color: #666; }
    `;
    document.head.appendChild(style);

    function createUI() {
        const titleEl = document.querySelector('h2.detail_view_header');
        let defaultName = "Capitulo_Naver";
        if (titleEl) {
            defaultName = titleEl.innerText.split('\n')[0].trim().replace(/[/\\?%*:|"<>]/g, '-');
        }

        const panel = document.createElement('div');
        panel.id = 'nrip-panel';
        panel.innerHTML = `
            <h4>📖 NaverNovel-Rip</h4>
            <label style="font-size:12px; display:block; margin-bottom:5px;">Nombre del archivo:</label>
            <input type="text" id="nrip-filename" value="${defaultName}">
            <button id="nrip-btn">Generar EPUB</button>
            <div class="nrip-footer">AUTHOR: ERYXZAR</div>
        `;
        document.body.appendChild(panel);
        document.getElementById('nrip-btn').onclick = generateEpub;
    }

    // Función para escapar caracteres HTML y evitar que se rompa el XHTML del EPUB
    function escapeHTML(str) {
        return str.replace(/[&<>"']/g, m => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[m]));
    }

    async function generateEpub() {
        const btn = document.getElementById('nrip-btn');
        const customTitle = document.getElementById('nrip-filename').value.trim() || "Novel";
        const container = document.querySelector('.detail_view_content') || document.querySelector('.view_area');

        if (!container) {
            alert('No se encontró el contenido.');
            return;
        }

        btn.innerText = '⚡ Procesando estructura...';
        btn.disabled = true;

        // Recuperar los párrafos (<p>) del HTML original
        const paragraphEls = container.querySelectorAll('p');
        const paragraphs = Array.from(paragraphEls)
            .map(p => `<p class="chapter_paragraph">${escapeHTML(p.innerText)}</p>`)
            .filter(p => p.length > "<p class=\"chapter_paragraph\"></p>".length) // Filtrar párrafos vacíos reales
            .join('\n');

        const finalHTML = paragraphs || `<p class="chapter_paragraph">${escapeHTML(container.innerText)}</p>`;

        try {
            const zip = new JSZip();
            zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
            zip.folder("META-INF").file("container.xml", `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);

            // CSS actualizado:
            // 1. .chapter_paragraph { text-align: left; } -> Fuerza la alineación a la izquierda.
            // 2. .chapter_paragraph { white-space: pre-wrap; } -> Mantiene los espacios internos por párrafo.
            // 3. body { font-family: sans-serif; } -> Fuente más limpia.
            // 4. body { line-height: 1.6; } -> Mejor interlineado para lectura.
            const chapterContent = `<?xml version="1.0" encoding="UTF-8"?>
                <!DOCTYPE html>
                <html xmlns="http://www.w3.org/1999/xhtml">
                <head>
                    <title>${customTitle}</title>
                    <style>
                        body { font-family: sans-serif; padding: 1em; line-height: 1.6; }
                        h1 { text-align: center; white-space: normal; border-bottom: 1px solid #ccc; padding-bottom: 0.5em; margin-bottom: 1em; }
                        .chapter_paragraph { text-align: left; white-space: pre-wrap; margin: 0.8em 0; }
                    </style>
                </head>
                <body>
                    <h1>${customTitle}</h1>
                    ${finalHTML}
                </body>
                </html>`;

            const oebps = zip.folder("OEBPS");
            oebps.file("chapter.xhtml", chapterContent);
            oebps.file("content.opf", `<?xml version="1.0" encoding="UTF-8"?>
                <package xmlns="http://www.idpf.org/2007/opf" unique-identifier="pub-id" version="3.0">
                    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
                        <dc:identifier id="pub-id">naver-${Date.now()}</dc:identifier>
                        <dc:title>${customTitle}</dc:title>
                        <dc:language>ko</dc:language>
                        <dc:creator>EryxZar</dc:creator>
                        <meta property="dcterms:modified">${new Date().toISOString().split('.')[0]}Z</meta>
                    </metadata>
                    <manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>
                    <spine><itemref idref="chapter"/></spine>
                </package>`);

            const blob = await zip.generateAsync({ type: "blob", mimeType: "application/epub+zip" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${customTitle}.epub`;
            a.click();
            btn.innerText = '✅ EPUB Guardado';
        } catch (err) {
            console.error(err);
            btn.innerText = '❌ Error';
        }

        setTimeout(() => { btn.innerText = 'Generar EPUB'; btn.disabled = false; }, 3000);
    }

    if (document.readyState === 'complete') { createUI(); } else { window.addEventListener('load', createUI); }
})();