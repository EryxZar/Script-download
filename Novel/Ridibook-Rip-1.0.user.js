// ==UserScript==
// @name         RidiNovel-Rip
// @version      5.0
// @description  actualizacion.
// @author       EryxZar
// @match        https://ridibooks.com/books/*
// @require      https://unpkg.com/@zip.js/zip.js@2.7.60/dist/zip-full.min.js
// @grant        GM_xmlhttpRequest
// @connect      webview-cache.ridibooks.com
// @connect      webview-cache-epub.ridibooks.com
// @connect      ridibooks.com
// ==/UserScript==

(function() {
    'use strict';

    const limpiarTextoPro = (xhtml) => {
        if (!xhtml) return "";
        let texto = xhtml
            .replace(/\r?\n|\r/g, " ")
            .replace(/<img[^>]*>/gi, "||BR||[Imagen]||BR||")
            .replace(/<\/p>/gi, "||BR||")
            .replace(/<\/h[1-6]>/gi, "||BR||")
            .replace(/<br\s*\/?>/gi, "||BR||")
            .replace(/<\/div>/gi, "||BR||")
            .replace(/<[^>]+>/g, "")
            .replace(/&nbsp;/g, " ")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&amp;/g, "&")
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/[\u200B-\u200D\uFEFF\u200E\u200F\u2060-\u206F\u202A-\u202E\uAD\u0000-\u001F\u007F-\u009F]/g, "")
            .split("||BR||")
            .map(linea => linea.trim())
            .filter(linea => linea.length > 0)
            .join("\n\n");
        return texto.trim();
    };

    const nombreSeguro = (name) => name.replace(/[<>:"/\\|?*]/g, '').trim();

    async function generarEpubIndividual(tituloCap, xhtmlCuerpo, imagenes) {
        const epubWriter = new zip.ZipWriter(new zip.BlobWriter("application/epub+zip"));
        await epubWriter.add("mimetype", new zip.TextReader("application/epub+zip"));
        await epubWriter.add("META-INF/container.xml", new zip.TextReader(`<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`));

        const xhtmlCompleto = `<?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE html>
        <html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
        <head><title>${tituloCap}</title></head>
        <body>
        ${xhtmlCuerpo}
        </body>
        </html>`;

        await epubWriter.add(`OEBPS/content.xhtml`, new zip.TextReader(xhtmlCompleto));

        let manifestItems = `<item id="main" href="content.xhtml" media-type="application/xhtml+xml"/>
                             <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`;

        for (let img of imagenes) {
            await epubWriter.add(`OEBPS/${img.href}`, new zip.BlobReader(img.blob));
            manifestItems += `\n<item id="${img.id}" href="${img.href}" media-type="image/jpeg"/>`;
        }

        const opf = `<?xml version="1.0" encoding="utf-8"?>
        <package xmlns="http://www.idpf.org/2007/opf" unique-identifier="id" version="3.0">
            <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
                <dc:title>${tituloCap}</dc:title>
                <dc:creator>EryxZar</dc:creator>
                <dc:language>ko</dc:language>
            </metadata>
            <manifest>
                ${manifestItems}
            </manifest>
            <spine toc="ncx">
                <itemref idref="main"/>
            </spine>
        </package>`;

        const ncx = `<?xml version="1.0" encoding="UTF-8"?>
        <ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
            <navMap>
                <navPoint id="navPoint-1" playOrder="1">
                    <navLabel><text>${tituloCap}</text></navLabel>
                    <content src="content.xhtml"/>
                </navPoint>
            </navMap>
        </ncx>`;

        await epubWriter.add("OEBPS/content.opf", new zip.TextReader(opf));
        await epubWriter.add("OEBPS/toc.ncx", new zip.TextReader(ncx));
        return await epubWriter.close();
    }

    // --- UI Y LÓGICA ---
    if (window.location.href.includes('/books/')) {
        setTimeout(() => {
            let items = document.querySelectorAll('li.js_series_book_list');
            const totalCaps = items.length;
            if (document.getElementById('ho-master-panel') || totalCaps === 0) return;

            const style = document.createElement('style');
            style.innerHTML = `
                #ho-master-panel { position: fixed; top: 20px; right: 20px; z-index: 999999; width: 320px; padding: 25px; background: linear-gradient(145deg, #1a1a1a, #0d0d0d); color: #fff; font-family: 'Segoe UI', sans-serif; border-radius: 16px; border: 1px solid #2a2a2a; box-shadow: 0 15px 35px rgba(0,0,0,0.6); text-align: center; }
                #ho-master-panel h3 { margin: 0 0 5px; color: #00e676; font-size: 22px; font-weight: 800; }
                .author { font-size: 10px; color: #888; margin-bottom: 20px; letter-spacing: 3px; font-weight: bold; text-transform: uppercase; }
                .ho-input-group { display: flex; justify-content: space-between; margin-bottom: 15px; }
                .ho-input-group input { width: 45%; padding: 10px; background: #111; border: 1px solid #333; color: #fff; border-radius: 8px; text-align: center; }
                .ho-checkboxes { display: flex; justify-content: space-around; margin-bottom: 15px; font-size: 13px; font-weight: bold; background: #111; padding: 8px; border-radius: 8px; }
                #ho-btn { width: 100%; padding: 14px; background: #00e676; color: #000; font-weight: 900; border: none; border-radius: 8px; cursor: pointer; }
                #ho-status { margin-top: 15px; font-size: 12px; color: #00e676; }
                .ho-prog-bg { width: 100%; height: 6px; background: #222; border-radius: 3px; margin-top: 15px; overflow: hidden; display: none; }
                .ho-prog-fill { height: 100%; background: #00e676; width: 0%; transition: 0.4s; }
            `;
            document.head.appendChild(style);

            const ui = document.createElement('div');
            ui.id = 'ho-master-panel';
            ui.innerHTML = `
                <h3>RIDINOVEL-RIP</h3>
                <div class="author">BY ERYXZAR</div>
                <div class="ho-input-group">
                    <input type="number" id="ho_start" value="1" min="1">
                    <input type="number" id="ho_end" value="${totalCaps}">
                </div>
                <div class="ho-checkboxes">
                    <label><input type="checkbox" id="ho_cb_txt" checked> .TXT</label>
                    <label><input type="checkbox" id="ho_cb_epub" checked> .EPUB</label>
                </div>
                <button id="ho-btn">DESCARGAR</button>
                <div class="ho-prog-bg" id="ho-prog-bg"><div class="ho-prog-fill" id="ho-prog-fill"></div></div>
                <div id="ho-status">Listo.</div>
            `;
            document.body.appendChild(ui);

            const btn = document.getElementById('ho-btn');
            const status = document.getElementById('ho-status');
            const progFill = document.querySelector('.ho-prog-fill');

            btn.onclick = async () => {
                const start = parseInt(document.getElementById('ho_start').value) - 1;
                const end = parseInt(document.getElementById('ho_end').value);
                const isTxt = document.getElementById('ho_cb_txt').checked;
                const isEpub = document.getElementById('ho_cb_epub').checked;

                if (start < 0 || end > totalCaps || start >= end) return alert("Rango inválido.");

                btn.disabled = true; btn.innerText = "PROCESANDO...";
                document.getElementById('ho-prog-bg').style.display = "block";

                const selectedItems = Array.from(document.querySelectorAll('li.js_series_book_list')).slice(start, end);
                const totalData = [];
                const nombreSerie = document.title.split(' - ')[0].trim();

                try {
                    for (let i = 0; i < selectedItems.length; i++) {
                        const item = selectedItems[i];
                        let capId = item.getAttribute('data-id') || item.querySelector('[data-book-id]')?.getAttribute('data-book-id');
                        const tituloRaw = item.querySelector('.js_book_title')?.innerText.trim() || `Cap_${i+1}`;

                        status.innerText = `Obteniendo: ${tituloRaw}`;

                        if (capId) {
                            const genResp = await fetch('https://ridibooks.com/api/web-viewer/generate', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ book_id: capId })
                            });
                            const genData = await genResp.json();

                            if (genData.success && genData.data.spines && genData.data.spines.length > 0) {

                                let xhtmlOriginalCombinado = "";
                                let xhtmlEpubCombinado = "";
                                let imagenesDelCapitulo = [];
                                let imgIndex = 0;

                                // Iterar sobre cada spine individual del capítulo
                                for (let s = 0; s < genData.data.spines.length; s++) {
                                    const contentResp = await fetch(genData.data.spines[s]);
                                    const contentJson = await contentResp.json();

                                    if (contentJson.value) {
                                        xhtmlOriginalCombinado += contentJson.value + "\n";

                                        const parser = new DOMParser();
                                        const doc = parser.parseFromString(contentJson.value, "text/html");
                                        const images = doc.querySelectorAll('img');

                                        for (let j = 0; j < images.length; j++) {
                                            let img = images[j];
                                            let rawSrc = img.src || img.getAttribute('src');
                                            if (rawSrc) {
                                                status.innerText = `[${tituloRaw}] Descargando imagen ${imgIndex+1}...`;
                                                try {
                                                    const imgBlob = await new Promise((resolve, reject) => {
                                                        GM_xmlhttpRequest({
                                                            method: "GET",
                                                            url: rawSrc,
                                                            responseType: "blob",
                                                            onload: (res) => resolve(res.response),
                                                            onerror: reject
                                                        });
                                                    });
                                                    let imgName = `image_${imgIndex}.jpg`;
                                                    imagenesDelCapitulo.push({ id: `img_${imgIndex}`, href: `images/${imgName}`, blob: imgBlob });

                                                    img.setAttribute('src', `images/${imgName}`);
                                                    imgIndex++;
                                                } catch (e) {
                                                    console.error("Error al descargar imagen:", rawSrc);
                                                }
                                            }
                                        }

                                        const serializer = new XMLSerializer();
                                        for (const child of doc.body.childNodes) {
                                            xhtmlEpubCombinado += serializer.serializeToString(child) + "\n";
                                        }
                                    }
                                }

                                totalData.push({
                                    titulo: nombreSeguro(tituloRaw),
                                    xhtml: xhtmlOriginalCombinado,
                                    xhtmlEpub: xhtmlEpubCombinado,
                                    imagenes: imagenesDelCapitulo
                                });
                            }
                        }
                        progFill.style.width = `${((i + 1) / selectedItems.length) * 100}%`;
                        await new Promise(r => setTimeout(r, 600));
                    }

                    status.innerText = "Generando archivos...";
                    const zipWriter = new zip.ZipWriter(new zip.BlobWriter("application/zip"));

                    for (const cap of totalData) {
                        if (isTxt) {
                            const txtLimpio = limpiarTextoPro(cap.xhtml);
                            await zipWriter.add(`TXT/${cap.titulo}.txt`, new zip.TextReader(txtLimpio));

                            for (let k = 0; k < cap.imagenes.length; k++) {
                                const sufijoImg = cap.imagenes.length > 1 ? `_${k + 1}` : "";
                                await zipWriter.add(`TXT/${cap.titulo}${sufijoImg}.jpg`, new zip.BlobReader(cap.imagenes[k].blob));
                            }
                        }

                        if (isEpub) {
                            const epubBlob = await generarEpubIndividual(cap.titulo, cap.xhtmlEpub, cap.imagenes);
                            await zipWriter.add(`EPUB/${cap.titulo}.epub`, new zip.BlobReader(epubBlob));
                        }
                    }

                    const finalZip = await zipWriter.close();
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(finalZip);
                    a.download = `${nombreSerie}.zip`;
                    a.click();

                    status.innerText = "¡Descarga lista!";
                    btn.disabled = false; btn.innerText = "DESCARGAR";
                } catch (e) {
                    console.error(e);
                    status.innerText = "Error detectado.";
                    btn.disabled = false;
                }
            };
        }, 2000);
    }
})();
