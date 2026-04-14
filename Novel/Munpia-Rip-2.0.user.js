// ==UserScript==
// @name         Munpia-Rip
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Descarga Múltiple.
// @author       EryxZar
// @match        *://novel.munpia.com/*
// @run-at       document-start
// @require      https://unpkg.com/@zip.js/zip.js@2.7.60/dist/zip-full.min.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const esIframe = window.top !== window.self;

    // ======================================================
    // 1. MODO LECTOR (EXTRAE Y ORDENA COORDENADAS)
    // ======================================================
    if (esIframe) {
        let bufferPalabras = [];
        let lineasVistas = new Set();
        let pageId = 0;
        let ultimoY = -1;
        let trampaActiva = true;
        let tituloHTML = "";
        const basura = ["©", "ⓒ", "<", ">", "끝", "전체화면", "목록", "맨위", "이전", "다음"];

        const pintarOriginal = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function(text, x, y, maxWidth) {
            if (trampaActiva) {
                try {
                    let txt = String(text).trim();
                    if (tituloHTML && (txt.includes(tituloHTML) || tituloHTML.includes(txt))) return pintarOriginal.apply(this, arguments);

                    const esBasura = basura.some(m => txt.includes(m)) || (/^\d+$/.test(txt) && txt.length < 5);

                    if (!esBasura && txt.length > 0) {
                        let idUnico = txt + "_" + Math.round(x) + "_" + Math.round(y);
                        if (!lineasVistas.has(idUnico)) {
                            lineasVistas.add(idUnico);
                            if (ultimoY !== -1 && y < ultimoY - 150) pageId++;
                            ultimoY = y;
                            bufferPalabras.push({ p: pageId, t: txt, x: x, y: y });
                        }
                    }
                } catch (e) {}
            }
            return pintarOriginal.apply(this, arguments);
        };

        const procesarBuffer = () => {
            let paginas = {};
            let rawPalabrasGlobal = bufferPalabras.slice();
            rawPalabrasGlobal.sort((a, b) => a.y - b.y);

            // --- CÁLCULOS GLOBALES PARA REGLAS VISUALES ---
            let uniqueYs = [...new Set(rawPalabrasGlobal.map(p => Math.round(p.y)))].sort((a, b) => a - b);
            let gaps = [];
            for (let i = 1; i < uniqueYs.length; i++) {
                let diff = uniqueYs[i] - uniqueYs[i-1];
                if (diff > 5) gaps.push(diff);
            }
            gaps.sort((a, b) => a - b);
            let globalMedianGap = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)] : 30;
            let forceParagraphThreshold = globalMedianGap * 2.0;

            // EL NUEVO CÁLCULO: Encontrar el margen izquierdo absoluto de la página (globalMinX)
            let sortedXs = [...new Set(rawPalabrasGlobal.map(p => Math.round(p.x)))].sort((a, b) => a - b);
            let globalMinX = sortedXs.length > 0 ? sortedXs[0] : 0;
            // Si la línea empieza 10 píxeles más a la derecha que el margen, es SANGRÍA (Nuevo párrafo)
            let indentThreshold = globalMinX + 10;

            // --- ARMADO DE LÍNEAS FÍSICAS ---
            bufferPalabras.forEach(item => {
                if (!paginas[item.p]) paginas[item.p] = [];
                paginas[item.p].push(item);
            });

            let globalPhysicalLineObjects = [];

            Object.keys(paginas).sort((a,b) => a - b).forEach(pKey => {
                let palabrasPagina = paginas[pKey];

                let localUniqueYs = [...new Set(palabrasPagina.map(p => Math.round(p.y)))].sort((a, b) => a - b);
                let localGaps = [];
                for (let i = 1; i < localUniqueYs.length; i++) {
                    let diff = localUniqueYs[i] - localUniqueYs[i-1];
                    if (diff > 5) localGaps.push(diff);
                }
                localGaps.sort((a, b) => a - b);
                let toleranceLineGrouping = localGaps.length > 0 ? Math.min(localGaps[Math.floor(localGaps.length / 2)] * 0.3, 8) : 8;

                palabrasPagina.sort((a, b) => a.y - b.y);
                let lineasFisicasGrouped = [];
                let lineaActualGroup = [];
                let currentYGroup = palabrasPagina[0].y;

                palabrasPagina.forEach(item => {
                    if (Math.abs(item.y - currentYGroup) <= toleranceLineGrouping) {
                        lineaActualGroup.push(item);
                    } else {
                        lineasFisicasGrouped.push(lineaActualGroup);
                        lineaActualGroup = [item];
                        currentYGroup = item.y;
                    }
                });
                if (lineaActualGroup.length > 0) lineasFisicasGrouped.push(lineaActualGroup);

                lineasFisicasGrouped.forEach(linea => {
                    linea.sort((a, b) => a.x - b.x);
                    let textString = "";
                    let averageY = 0;
                    let startX = linea[0].x; // GUARDAMOS EL INICIO EXACTO DE LA LÍNEA (Eje X)

                    for (let i = 0; i < linea.length; i++) {
                        let txt = linea[i].t;
                        averageY += linea[i].y;
                        if (i === 0) {
                            textString += txt;
                        } else {
                            let prevTxt = linea[i-1].t;
                            if (/^[.,!??"'”’\])>』」]/.test(txt) || /[\[\("<『「‘“']$/.test(prevTxt) ||
                               (/^[은는이가을를에의로과와고도만면지며게]/.test(txt) && /[가-힣a-zA-Z0-9]$/.test(prevTxt))) {
                                textString += txt;
                            } else {
                                textString += " " + txt;
                            }
                        }
                    }
                    globalPhysicalLineObjects.push({
                        t: textString.trim(),
                        y: averageY / linea.length,
                        startX: startX // <-- Lo enviamos al motor gramatical
                    });
                });
            });

            // --- MOTOR GRAMATICAL + DETECTOR DE SANGRÍA (INDENTATION) ---
            let parrafos = [];
            let parrafoActual = "";
            let comillasAbiertas = false;
            let lastLineYMerged = -1;

            globalPhysicalLineObjects.forEach(lineObj => {
                let textoLinea = lineObj.t;
                let currentLineY = lineObj.y;
                let currentLineStartX = lineObj.startX; // Analizamos la posición X
                if (!textoLinea) return;

                if (textoLinea.includes("***")) {
                    if (parrafoActual) { parrafos.push(parrafoActual); parrafoActual = ""; }
                    parrafos.push(textoLinea);
                    comillasAbiertas = false;
                    lastLineYMerged = -1;
                    return;
                }

                let countOpen = (textoLinea.match(/[“"‘]/g) || []).length;
                let countClose = (textoLinea.match(/[”"’]/g) || []).length;

                if (parrafoActual === "") {
                    parrafoActual = textoLinea;
                    if (countOpen > countClose) comillasAbiertas = true;
                    else if (countClose > countOpen) comillasAbiertas = false;
                    lastLineYMerged = currentLineY;
                } else {
                    let lastChar = parrafoActual.slice(-1);
                    let estaIncompleto = !/[.!??”'"’…\])>』」]/.test(lastChar);

                    // Failsafe 1: Salto visual gigante
                    let forceParagraphDueToLayoutError = (lastLineYMerged !== -1) && ((currentLineY - lastLineYMerged) > forceParagraphThreshold);

                    // Failsafe 2 (NUEVO): Detectar Sangría. Si está empujado a la derecha, es nuevo párrafo 100%.
                    let forceParagraphDueToIndent = (currentLineStartX > indentThreshold);

                    // Si no hay salto gigante, NO hay sangría, y (faltan comillas o está gramaticalmente incompleto)...
                    if (!forceParagraphDueToLayoutError && !forceParagraphDueToIndent && (comillasAbiertas || estaIncompleto)) {
                        // Es la continuación del párrafo (renglón pegado al margen izquierdo)
                        if (lastChar === ',') parrafoActual += " " + textoLinea;
                        else parrafoActual += " " + textoLinea;

                        lastLineYMerged = currentLineY;
                    } else {
                        // O terminó bien, O hay sangría, O hay salto visual. Cortamos el párrafo.
                        parrafos.push(parrafoActual);
                        parrafoActual = textoLinea;
                        lastLineYMerged = currentLineY;
                    }

                    if (countOpen > countClose) comillasAbiertas = true;
                    else if (countClose > countOpen) comillasAbiertas = false;
                }
            });

            if (parrafoActual) parrafos.push(parrafoActual);

            let textoFinal = parrafos.join("\n\n");
            return (tituloHTML ? tituloHTML + "\n\n" : "") + textoFinal.trim();
        };

        window.addEventListener('load', function() {
            const h4Title = document.querySelector('h4 a');
            if (h4Title) tituloHTML = h4Title.innerText.trim();

            const target = document.querySelector('canvas') || document.querySelector('#board') || window;

            let motor = setInterval(() => {
                target.dispatchEvent(new WheelEvent('wheel', { deltaY: 1200, bubbles: true }));
                document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 39, bubbles: true }));
                document.dispatchEvent(new KeyboardEvent('keyup', { keyCode: 39, bubbles: true }));

                const indicador = document.querySelector('#canvasViewPage');
                if (indicador) {
                    let status = indicador.innerText;
                    if (status.includes('/')) {
                        let partes = status.split('/');
                        if (parseInt(partes[0]) >= parseInt(partes[1])) finalizar();
                    } else if (status.includes("100%")) {
                        finalizar();
                    }
                }
            }, 300);

            function finalizar() {
                clearInterval(motor);
                setTimeout(() => {
                    trampaActiva = false;
                    let textoArmado = procesarBuffer();
                    window.parent.postMessage({ tipo: "HO_RIP_DATA", texto: textoArmado }, "*");
                }, 500);
            }
        });
        return;
    }

    // ======================================================
    // 2. MODO PANEL MAESTRO (ÍNDICE)
    // ======================================================
    if (!window.location.href.includes('/neSrl/')) {
        window.addEventListener('load', () => {
            if (document.getElementById('ho-master-panel')) return;
            const ui = document.createElement('div');
            ui.id = 'ho-master-panel';
            ui.style = "position:fixed; top:20px; right:20px; z-index:999999; padding:20px; background:#121212; color:white; border-radius:12px; border:2px solid #00e676; width:300px; font-family:sans-serif; box-shadow:0 10px 30px rgba(0,0,0,0.8);";
            ui.innerHTML = `
                <h3 style="margin:0 0 5px 0; color:#00e676; text-align:center;">🚀 Munpia-Rip V2</h3>
                <p style="font-size:11px; color:#888; text-align:center; margin-bottom:15px;">BY ERYXZAR</p>
                <input type="text" id="ho-input" placeholder="Ej: 15-18" style="width:100%; padding:10px; background:#222; border:1px solid #444; color:white; border-radius:6px; margin-bottom:10px; box-sizing:border-box;">
                <button id="ho-btn" style="width:100%; padding:12px; background:#00e676; color:black; font-weight:bold; border:none; border-radius:6px; cursor:pointer;">GENERAR ZIP</button>
                <div id="ho-st" style="margin-top:10px; font-size:12px; color:#00e676; text-align:center; min-height:20px;">Listo.</div>
            `;
            document.body.appendChild(ui);

            document.getElementById('ho-btn').onclick = async function() {
                const val = document.getElementById('ho-input').value.trim();
                if (!val) return alert("Ingresa un número o rango.");

                const status = document.getElementById('ho-st');
                const btn = document.getElementById('ho-btn');
                const novelId = window.location.pathname.split('/')[1];

                let targetNums = new Set();
                val.split(',').forEach(p => {
                    if (p.includes('-')) {
                        let [s, e] = p.split('-').map(n => parseInt(n.trim()));
                        for (let i = s; i <= e; i++) targetNums.add(i);
                    } else {
                        let n = parseInt(p.trim());
                        if (!isNaN(n)) targetNums.add(n);
                    }
                });

                if (targetNums.size === 0) return alert("Rango inválido.");
                btn.disabled = true;
                status.innerText = "🔍 Buscando capítulos...";

                let listaDescarga = [];
                let faltantes = new Set(targetNums);

                for (let p = 1; p <= 25; p++) {
                    try {
                        let res = await fetch(`/${novelId}/page/${p}`);
                        let html = await res.text();
                        let doc = new DOMParser().parseFromString(html, 'text/html');
                        doc.querySelectorAll('table.entries tbody tr:not(.notice)').forEach(f => {
                            let n = parseInt(f.querySelector('td.index span')?.innerText);
                            if (faltantes.has(n)) {
                                listaDescarga.push({ n, url: f.querySelector('td.subject a').href });
                                faltantes.delete(n);
                            }
                        });
                        if (faltantes.size === 0) break;
                    } catch (e) { break; }
                }

                if (listaDescarga.length === 0) {
                    btn.disabled = false;
                    return status.innerText = "❌ No encontrados.";
                }

                listaDescarga.sort((a, b) => a.n - b.n);

                let iframe = document.createElement('iframe');
                iframe.style = "position:fixed; top:0; left:0; width:1200px; height:2000px; opacity:0.01; z-index:-1; pointer-events:none;";
                document.body.appendChild(iframe);

                let index = 0;
                let zipResults = [];

                const onMessage = async (e) => {
                    if (e.data.tipo === "HO_RIP_DATA") {
                        zipResults.push({
                            name: `Capítulo ${listaDescarga[index].n}.txt`,
                            content: e.data.texto
                        });

                        index++;
                        if (index < listaDescarga.length) {
                            status.innerText = `📥 Extraído ${index}/${listaDescarga.length}...`;
                            iframe.src = listaDescarga[index].url;
                        } else {
                            status.innerText = "📦 Generando ZIP...";
                            await crearZip(zipResults, `${val}.zip`);
                            status.innerText = "✅ ¡Finalizado!";
                            btn.disabled = false;
                            window.removeEventListener("message", onMessage);
                            iframe.remove();
                        }
                    }
                };

                window.addEventListener("message", onMessage);
                status.innerText = `📥 Cargando capítulo ${listaDescarga[0].n}...`;
                iframe.src = listaDescarga[0].url;
            };

            async function crearZip(files, name) {
                const zipWriter = new zip.ZipWriter(new zip.BlobWriter("application/zip"));
                for (let f of files) {
                    await zipWriter.add(f.name, new zip.TextReader(f.content));
                }
                const blob = await zipWriter.close();
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = name;
                a.click();
            }
        });
    }
})();