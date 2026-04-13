// ==UserScript==
// @name         Young animal-rip
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Descarga y descifra capítulos de Young Animal.
// @author       EryxZar
// @match        https://younganimal.com/*
// @require      https://unpkg.com/@zip.js/zip.js@2.7.60/dist/zip-full.min.js
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    let isDownloading = false;
    let apiInfo = null;
    let mangaMetadata = {
        chapterTitle: 'Capitulo_Manga',
        coverUrl: null
    };
    let btnDescarga;

    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const urlStr = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
        const response = await originalFetch.apply(this, args);

        try {
            if (urlStr.includes('/api/users/storeItemForEpisodeDetailAPI')) {
                const cloneMeta = response.clone();
                cloneMeta.json().then(data => {
                    if (data.thumbnail) mangaMetadata.coverUrl = data.thumbnail.startsWith('//') ? 'https:' + data.thumbnail : data.thumbnail;
                }).catch(e => { });
            }

            if (urlStr.includes('/book/contentsInfo') && !apiInfo) {
                const clonePages = response.clone();
                clonePages.json().then(data => {
                    if (data.totalPages) {
                        const urlObj = new URL(urlStr, window.location.origin);
                        urlObj.searchParams.delete('page-from');
                        urlObj.searchParams.delete('page-to');
                        apiInfo = {
                            baseUrl: urlObj.origin + urlObj.pathname + urlObj.search,
                            totalPages: data.totalPages
                        };
                        actualizarBoton();
                    }
                }).catch(e => { });
            }
        } catch (e) { }
        return response;
    };

    // 2. Lógica de descifrado (Puzzle por columnas)
    function descifrarImagen(blob, pageData) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = pageData.width;
                canvas.height = pageData.height;
                const ctx = canvas.getContext('2d');
                const scrambleArr = JSON.parse(pageData.scramble);
                const gridSize = Math.sqrt(scrambleArr.length);
                const tileW = Math.floor(pageData.width / gridSize);
                const tileH = Math.floor(pageData.height / gridSize);

                ctx.drawImage(img, 0, 0);
                for (let i = 0; i < scrambleArr.length; i++) {
                    const destIndex = i;
                    const srcIndex = scrambleArr[i];
                    const sx = Math.floor(srcIndex / gridSize) * tileW;
                    const sy = (srcIndex % gridSize) * tileH;
                    const dx = Math.floor(destIndex / gridSize) * tileW;
                    const dy = (destIndex % gridSize) * tileH;
                    ctx.drawImage(img, sx, sy, tileW, tileH, dx, dy, tileW, tileH);
                }
                canvas.toBlob(b => resolve(b), 'image/jpeg', 0.95);
            };
            img.onerror = () => reject(new Error("Error en imagen"));
            img.src = URL.createObjectURL(blob);
        });
    }

    function obtenerNombreArchivo() {
        const domTitle = document.querySelector('.article-title');
        let name = domTitle ? domTitle.textContent.trim() : mangaMetadata.chapterTitle;
        return name.replace(/[\\/:*?"<>|]/g, '').trim() + ".zip";
    }

    // 4. Proceso de descarga
    async function descargarManga() {
        if (!apiInfo) return;
        isDownloading = true;
        actualizarBoton();

        const zipWriter = new zip.ZipWriter(new zip.BlobWriter("application/zip"));
        const separator = apiInfo.baseUrl.includes('?') ? '&' : '?';

        if (mangaMetadata.coverUrl) {
            try {
                const coverRes = await originalFetch(mangaMetadata.coverUrl);
                const coverBlob = await coverRes.blob();
                await zipWriter.add('000_cover.jpg', new zip.BlobReader(coverBlob));
            } catch (e) { }
        }

        // Descargar y descifrar páginas
        for (let i = 0; i < apiInfo.totalPages; i++) {
            try {
                btnDescarga.textContent = `⏳ ${i + 1}/${apiInfo.totalPages}`;
                const pageUrl = `${apiInfo.baseUrl}${separator}page-from=${i}&page-to=${i}`;
                const metaRes = await originalFetch(pageUrl);
                const metaData = await metaRes.json();
                const pageInfo = metaData.result[0];

                const imgRes = await originalFetch(pageInfo.imageUrl);
                const blobOriginal = await imgRes.blob();

                let blobFinal = pageInfo.scramble ? await descifrarImagen(blobOriginal, pageInfo) : blobOriginal;
                const nombrePag = `pagina_${(i + 1).toString().padStart(3, '0')}.jpg`;
                await zipWriter.add(nombrePag, new zip.BlobReader(blobFinal));
            } catch (error) { console.error(error); }
        }

        const zipBlob = await zipWriter.close();
        const urlDescarga = URL.createObjectURL(zipBlob);
        const enlace = document.createElement('a');
        enlace.href = urlDescarga;
        enlace.download = obtenerNombreArchivo();
        enlace.click();

        isDownloading = false;
        actualizarBoton();
    }

    // 5. Interfaz
    function inyectarBoton() {
        if (document.getElementById('ya-rip-btn')) return;
        btnDescarga = document.createElement('button');
        btnDescarga.id = 'ya-rip-btn';
        Object.assign(btnDescarga.style, {
            position: 'fixed', bottom: '20px', right: '20px', zIndex: '999999',
            padding: '12px 20px', backgroundColor: '#1a1a1a', color: '#ffffff',
            border: '2px solid #ff4500', borderRadius: '8px', cursor: 'pointer',
            fontWeight: 'bold', boxShadow: '0 4px 6px rgba(0,0,0,0.3)'
        });
        btnDescarga.addEventListener('click', () => { if (!isDownloading) descargarManga(); });
        document.body.appendChild(btnDescarga);
        actualizarBoton();
    }

    function actualizarBoton() {
        if (!btnDescarga) return;
        const domTitle = document.querySelector('.article-title');
        const capLabel = domTitle ? domTitle.textContent.trim() : 'Capítulo';

        if (isDownloading) {
            btnDescarga.style.backgroundColor = '#ff4500';
        } else if (apiInfo) {
            btnDescarga.textContent = `📦 Descargar ${capLabel}`;
            btnDescarga.style.opacity = '1';
        } else {
            btnDescarga.textContent = '⏳ Cargando páginas...';
            btnDescarga.style.opacity = '0.7';
        }
    }

    window.addEventListener('load', inyectarBoton);
    setInterval(() => { if(!isDownloading) actualizarBoton(); }, 1000);

})();