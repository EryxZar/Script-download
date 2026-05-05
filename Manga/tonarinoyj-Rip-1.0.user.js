// ==UserScript==
// @name         tonarinoyj-Rip
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Mapeo detallado, soporte avanzado para sub-capítulos (2-1, 2-2), Tooltip y Puzzle.
// @author       EryxZar
// @match        https://tonarinoyj.jp/episode/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=tonarinoyj.jp
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    let mappedEpisodes = [];
    let seriesTitleGlobal = "Manga";

    const container = document.createElement('div');
    container.style.cssText = `
        position: fixed; bottom: 20px; right: 20px; z-index: 9999;
        display: flex; flex-direction: column; gap: 10px; font-family: sans-serif;
        background: rgba(15, 15, 15, 0.95); padding: 15px; border-radius: 10px; box-shadow: 0 4px 10px rgba(0,0,0,0.5);
        border: 1px solid #333; width: 260px;
    `;

    const titleEl = document.createElement('div');
    titleEl.innerText = 'Tonarinoyj-Rip';
    titleEl.style.cssText = 'color: #fff; font-weight: bold; text-align: center; margin-bottom: 2px; font-size: 14px;';

    const infoText = document.createElement('div');
    infoText.innerText = 'Mapeando serie en la API... ⏳';
    infoText.style.cssText = 'color: #00bcd4; font-size: 12px; text-align: center; font-weight: bold; margin-bottom: 5px; line-height: 1.5;';

    const inputCaps = document.createElement('input');
    inputCaps.type = 'text';
    inputCaps.placeholder = 'Ej: 1-5, 12-1, EX1';
    inputCaps.disabled = true;
    inputCaps.style.cssText = 'padding: 8px; border-radius: 5px; border: 1px solid #555; background: #222; color: #fff; font-size: 13px; text-align: center;';

    const btnDownload = document.createElement('button');
    btnDownload.innerText = '⬇️ Descargar ZIP';
    btnDownload.disabled = true;
    btnDownload.style.cssText = 'padding: 10px; background-color: #555; color: #ccc; border: none; border-radius: 5px; font-weight: bold; transition: 0.2s;';

    const statusText = document.createElement('div');
    statusText.style.cssText = 'color: #ffcc00; font-size: 11px; text-align: center; min-height: 15px; word-wrap: break-word;';

    container.appendChild(titleEl);
    container.appendChild(infoText);
    container.appendChild(inputCaps);
    container.appendChild(btnDownload);
    container.appendChild(statusText);
    document.body.appendChild(container);

    const updateStatus = (msg) => { statusText.innerText = msg; console.log(`%c ${msg}`, 'color: #00bcd4'); };
    const getEpisodeId = () => window.location.pathname.split('/').pop();

    function parseInputRules(inputStr) {
        const rules = { exact: new Set(), ranges: [] };
        const parts = inputStr.split(',').map(s => s.trim().toUpperCase());

        for (const part of parts) {
            if (part === '') continue;

            const rangeMatch = part.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
            if (rangeMatch) {
                const start = parseFloat(rangeMatch[1]);
                const end = parseFloat(rangeMatch[2]);
                if (start < end) {
                    rules.ranges.push({ start, end });
                    continue;
                }
            }

            let exactVal = part;
            if (/^\d+-\d+$/.test(part)) {
                exactVal = parseFloat(part.replace('-', '.'));
            } else if (!isNaN(parseFloat(part))) {
                exactVal = parseFloat(part);
            }
            rules.exact.add(exactVal);
        }
        return rules;
    }

    async function autoMapSeries() {
        try {
            const currentEpisodeId = getEpisodeId();
            const epResponse = await fetch(`${window.location.origin}/episode/${currentEpisodeId}.json`);
            const epData = await epResponse.json();

            const seriesId = epData.readableProduct.series.id;

            const titleH1 = document.querySelector('.series-header-title');
            const seriesTitleRaw = titleH1 ? titleH1.innerText.trim() : epData.readableProduct.series.title;
            seriesTitleGlobal = seriesTitleRaw.replace(/[\\/:*?"<>|]/g, '').trim();

            let offset = 0;
            const limit = 50;
            let hasMore = true;
            mappedEpisodes = [];

            while (hasMore) {
                const listRes = await fetch(`${window.location.origin}/api/viewer/pagination_readable_products?type=episode&aggregate_id=${seriesId}&offset=${offset}&limit=${limit}&sort_order=asc`);
                const listData = await listRes.json();

                if (listData.length > 0) {
                    mappedEpisodes = mappedEpisodes.concat(listData);
                    offset += limit;
                } else {
                    hasMore = false;
                }
            }

            let extraCounter = 1;
            const extrasList = [];

            let countChapters = 0;
            let countExtras = 0;
            let countFree = 0;
            let countPaid = 0;

            mappedEpisodes.forEach((ep) => {
                let extractedNum;

                const titleMatch = ep.title.match(/第([\d\.\-]+)話/);

                if (titleMatch) {
                    const numStr = titleMatch[1].replace('-', '.');
                    extractedNum = parseFloat(numStr);
                    countChapters++;
                }
                else if (/prologue|プロローグ/i.test(ep.title)) {
                    extractedNum = 0;
                    countChapters++;
                }
                else {
                    extractedNum = `EX${extraCounter}`;
                    extrasList.push({ id: extractedNum, title: ep.title });
                    extraCounter++;
                    countExtras++;
                }

                ep.extractedNumber = extractedNum;
                ep.isPublic = (ep.purchase_info && ep.purchase_info.unavailable === false);

                if (ep.isPublic) {
                    countFree++;
                } else {
                    countPaid++;
                }
            });

            infoText.innerHTML = `
                <span style="color:#00e676">Caps: ${countChapters}</span> |
                <span style="color:#ff9800">Ex: ${countExtras}
                    <span title="Capítulos especiales (One-shots, ilustraciones). Escribe EX1, EX2... para descargarlos. Mira la consola (F12) para ver la lista." style="cursor: help; background: #444; color: #fff; border-radius: 50%; padding: 0 5px; font-size: 10px; margin-left: 3px; display: inline-block;">?</span>
                </span><br>
                <span style="color:#00bcd4">Gratis: ${countFree}</span> |
                <span style="color:#ff5252">Pagos: ${countPaid}</span>
            `;

            inputCaps.disabled = false;
            btnDownload.disabled = false;

            btnDownload.style.backgroundColor = '#e50012';
            btnDownload.style.color = '#fff';
            btnDownload.style.cursor = 'pointer';
            btnDownload.onmouseover = () => btnDownload.style.backgroundColor = '#cc0010';
            btnDownload.onmouseout = () => btnDownload.style.backgroundColor = '#e50012';

            console.clear();
            console.log(`%c Mapeo completo: ${mappedEpisodes.length} elementos.`, 'color: #00e676; font-weight: bold; font-size: 14px;');

            if (extrasList.length > 0) {
                console.log(`%c--- EXTRAS ENCONTRADOS ---`, 'color: #ff9800; font-weight: bold;');
                extrasList.forEach(ex => {
                    console.log(`%c${ex.id}: %c${ex.title}`, 'color: #ff9800; font-weight: bold;', 'color: white;');
                });
            }

        } catch (error) {
            console.error(error);
            infoText.innerText = '❌ Error al mapear la API';
            infoText.style.color = '#ff5252';
            updateStatus('Recarga la página.');
        }
    }

    async function fetchAndUnscrambleImage(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'Anonymous';
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const width = img.width;
                const height = img.height;
                canvas.width = width;
                canvas.height = height;

                const DIVIDE_NUM = 4;
                const MULTIPLE = 8;
                const cellWidth = Math.floor(width / (DIVIDE_NUM * MULTIPLE)) * MULTIPLE;
                const cellHeight = Math.floor(height / (DIVIDE_NUM * MULTIPLE)) * MULTIPLE;

                for (let y = 0; y < DIVIDE_NUM; y++) {
                    for (let x = 0; x < DIVIDE_NUM; x++) {
                        const srcX = x * cellWidth;
                        const srcY = y * cellHeight;
                        const destX = (x * DIVIDE_NUM + y) % DIVIDE_NUM * cellWidth;
                        const destY = Math.floor((x * DIVIDE_NUM + y) / DIVIDE_NUM) * cellHeight;
                        ctx.drawImage(img, srcX, srcY, cellWidth, cellHeight, destX, destY, cellWidth, cellHeight);
                    }
                }

                const rightWidth = width - cellWidth * DIVIDE_NUM;
                const bottomHeight = height - cellHeight * DIVIDE_NUM;

                if (rightWidth > 0) ctx.drawImage(img, cellWidth * DIVIDE_NUM, 0, rightWidth, cellHeight * DIVIDE_NUM, cellWidth * DIVIDE_NUM, 0, rightWidth, cellHeight * DIVIDE_NUM);
                if (bottomHeight > 0) ctx.drawImage(img, 0, cellHeight * DIVIDE_NUM, width, bottomHeight, 0, cellHeight * DIVIDE_NUM, width, bottomHeight);

                canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.95);
            };
            img.onerror = reject;
            img.src = url;
        });
    }

    btnDownload.addEventListener('click', async () => {
        const inputVal = inputCaps.value;
        if (!inputVal) return alert('Por favor, ingresa los capítulos a descargar.');

        btnDownload.disabled = true;
        inputCaps.disabled = true;

        const rules = parseInputRules(inputVal);

        try {
            const episodesToDownload = mappedEpisodes.filter(ep => {
                const num = ep.extractedNumber;

                if (typeof num === 'string') {
                    return rules.exact.has(num);
                }

                if (typeof num === 'number') {
                    if (rules.exact.has(num)) return true;

                    const isSubChapterRequested = Array.from(rules.exact).some(exact =>
                        Number.isInteger(exact) && Math.floor(num) === exact
                    );
                    if (isSubChapterRequested) return true;

                    for (const r of rules.ranges) {
                        const effectiveEnd = Number.isInteger(r.end) ? r.end + 0.9999 : r.end;
                        if (num >= r.start && num <= effectiveEnd) return true;
                    }
                }
                return false;
            });

            if (episodesToDownload.length === 0) {
                updateStatus('Los capítulos solicitados no coinciden con la lista.');
                btnDownload.disabled = false;
                inputCaps.disabled = false;
                return;
            }

            const publicToDownload = episodesToDownload.filter(ep => ep.isPublic);
            if (publicToDownload.length < episodesToDownload.length) {
                const privados = episodesToDownload.filter(ep => !ep.isPublic)
                    .map(e => typeof e.extractedNumber === 'number' ? String(e.extractedNumber).replace('.', '-') : e.extractedNumber)
                    .join(', ');
                alert(`Ojo: Los elementos [${privados}] están expirados o son de pago.\nSolo se descargarán los públicos.`);
            }

            if (publicToDownload.length === 0) {
                updateStatus('Todos los capítulos solicitados son privados.');
                btnDownload.disabled = false;
                inputCaps.disabled = false;
                return;
            }

            const zip = new JSZip();
            const rootFolder = zip.folder(seriesTitleGlobal);

            for (const ep of publicToDownload) {
                const chapNum = ep.extractedNumber;

                let folderName;
                if (typeof chapNum === 'number') {
                    const displayNum = String(chapNum).replace('.', '-');
                    folderName = `Capítulo ${displayNum}`;
                } else {
                    const cleanTitle = ep.title.replace(/[\\/:*?"<>|]/g, '').trim().substring(0, 50);
                    folderName = `Extra - ${cleanTitle}`;
                }

                const capFolder = rootFolder.folder(folderName);

                const displayLog = typeof chapNum === 'number' ? String(chapNum).replace('.', '-') : chapNum;

                updateStatus(`Extrayendo JSON: ${displayLog}...`);
                const capRes = await fetch(`${window.location.origin}/episode/${ep.readable_product_id}.json`);
                const capData = await capRes.json();

                const pages = capData.readableProduct.pageStructure.pages.filter(p => p.type === 'main' && p.src);

                for (let i = 0; i < pages.length; i++) {
                    updateStatus(`[${displayLog}] Descifrando Pag ${i + 1}/${pages.length}`);
                    try {
                        const blob = await fetchAndUnscrambleImage(pages[i].src);
                        const fileName = `${String(i + 1).padStart(2, '0')}.jpg`;
                        capFolder.file(fileName, blob);
                    } catch (err) {
                        console.error(`Error descifrando pag ${i+1} de ${displayLog}`, err);
                    }
                }
            }

            updateStatus('Empaquetando archivo ZIP... 📦');

            let zipName = `${seriesTitleGlobal} - VariosCapitulos.zip`;
            if (publicToDownload.length === 1) {
                const epUnico = publicToDownload[0].extractedNumber;
                const displayUnico = typeof epUnico === 'number' ? String(epUnico).replace('.', '-') : epUnico;
                zipName = `${seriesTitleGlobal} - Capitulo ${displayUnico}.zip`;
            } else if (publicToDownload.length > 1) {
                const first = publicToDownload[0].extractedNumber;
                const last = publicToDownload[publicToDownload.length-1].extractedNumber;
                const dFirst = typeof first === 'number' ? String(first).replace('.', '-') : first;
                const dLast = typeof last === 'number' ? String(last).replace('.', '-') : last;
                zipName = `${seriesTitleGlobal} - Capítulos ${dFirst} al ${dLast}.zip`;
            }

            const content = await zip.generateAsync({ type: 'blob' });
            saveAs(content, zipName);

            updateStatus('¡Descarga finalizada! ✅');

        } catch (error) {
            console.error(error);
            updateStatus('Ocurrió un error en la descarga.');
        } finally {
            btnDownload.disabled = false;
            inputCaps.disabled = false;
            setTimeout(() => { updateStatus(''); }, 5000);
        }
    });

    setTimeout(autoMapSeries, 500);

})();