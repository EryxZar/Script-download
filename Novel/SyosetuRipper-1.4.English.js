// ==UserScript==
// @name         SyosetuRipper
// @namespace    http://tampermonkey.net/
// @version      1.4
// @description  Per-chapter download buttons and a floating "Download all" (multi-page) button. Generates one EPUB per chapter (including IMAGES and afterword) and packs them all into a ZIP, with a text progress overlay. Includes fallback + logs for cases like n8829lf.
// @author       EryxZar
// @match        https://ncode.syosetu.com/*/*
// @grant        GM_addStyle
// ==/UserScript==

(function () {
  'use strict';

  console.log('[SyosetuRipper] Script loaded.');

  // ====== STYLES ======
  GM_addStyle(`
    .tm-mini-btn {
      background-color: #e53935;
      color: white;
      border: none;
      border-radius: 4px;
      margin-left: 6px;
      padding: 2px 6px;
      font-size: 10px;
      cursor: pointer;
      opacity: 0.9;
    }
    .tm-mini-btn:hover {
      opacity: 1;
    }

    #tm-floating-box {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 999999;
      display: flex;
      flex-direction: column;
      gap: 8px;
      font-family: sans-serif;
    }
    .tm-float-btn {
      padding: 8px 12px;
      border-radius: 6px;
      border: none;
      cursor: pointer;
      font-size: 12px;
      color: #fff;
      background: #1f2933;
      box-shadow: 0 3px 8px rgba(0,0,0,0.3);
      opacity: 0.9;
      text-align: left;
      white-space: nowrap;
    }
    .tm-float-btn:hover {
      opacity: 1;
      transform: translateY(-1px);
    }

    #tm-bulk-progress {
      position: fixed;
      bottom: 20px;
      left: 20px;
      z-index: 999999;
      background: rgba(0,0,0,0.85);
      color: #fff;
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 11px;
      font-family: sans-serif;
      max-width: 340px;
      white-space: pre-line;
      display: none;
    }
  `);

  // ====== PROGRESS BOX ======
  function ensureProgressBox() {
    let box = document.getElementById('tm-bulk-progress');
    if (!box) {
      box = document.createElement('div');
      box.id = 'tm-bulk-progress';
      document.body.appendChild(box);
    }
    return box;
  }

  function showProgress(msg) {
    const box = ensureProgressBox();
    box.textContent = msg;
    box.style.display = 'block';
  }

  function hideProgress(delayMs = 2000) {
    const box = ensureProgressBox();
    setTimeout(() => {
      box.style.display = 'none';
    }, delayMs);
  }

  // ====== UTILITIES ======
  function sanitizeFilename(name) {
    return (name || '')
      .replace(/[\\\/:*?"<>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'chapter';
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }

  // Extract chapter number from URL: /n3709ho/123/ → "123"
  function getChapterNumberFromUrl(url) {
    const m = String(url).match(/\/(\d+)\/?$/);
    return m ? m[1] : '';
  }

  function encodeUtf8(str) {
    if (window.TextEncoder) {
      return new TextEncoder().encode(str);
    }
    const utf8 = [];
    for (let i = 0; i < str.length; i++) {
      let charCode = str.charCodeAt(i);
      if (charCode < 0x80) utf8.push(charCode);
      else if (charCode < 0x800) {
        utf8.push(0xc0 | (charCode >> 6));
        utf8.push(0x80 | (charCode & 0x3f));
      } else if (charCode < 0xd800 || charCode >= 0xe000) {
        utf8.push(0xe0 | (charCode >> 12));
        utf8.push(0x80 | ((charCode >> 6) & 0x3f));
        utf8.push(0x80 | (charCode & 0x3f));
      } else {
        i++;
        const next = str.charCodeAt(i);
        const codePoint = 0x10000 + (((charCode & 0x3ff) << 10) | (next & 0x3ff));
        utf8.push(0xf0 | (codePoint >> 18));
        utf8.push(0x80 | ((codePoint >> 12) & 0x3f));
        utf8.push(0x80 | ((charCode >> 6) & 0x3f));
        utf8.push(0x80 | (codePoint & 0x3f));
      }
    }
    return new Uint8Array(utf8);
  }

  function absoluteImageUrl(src, pageUrl) {
    if (!src) return null;
    src = src.trim();
    if (src.startsWith('//')) {
      return 'https:' + src;
    }
    if (src.startsWith('http://') || src.startsWith('https://')) {
      return src;
    }
    try {
      const base = new URL(pageUrl);
      if (src.startsWith('/')) {
        return base.origin + src;
      }
      return base.origin + src;
    } catch (e) {
      return src;
    }
  }

  // ====== CRC32 ======
  const CRC_TABLE = (() => {
    let c;
    const table = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : (c >>> 1);
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32Uint8(arr) {
    let crc = 0 ^ -1;
    for (let i = 0; i < arr.length; i++) {
      crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ arr[i]) & 0xff];
    }
    return (crc ^ -1) >>> 0;
  }

  // ====== ZIP BUILDER (for internal EPUB + outer ZIP) ======
  function buildZipUint8(files) {
    const parts = [];
    let offset = 0;
    const centralParts = [];

    files.forEach(file => {
      const nameBytes = encodeUtf8(file.name);
      const data = file.data;
      const size = data.length;
      const crc = crc32Uint8(data);

      const localHeader = new Uint8Array(30 + nameBytes.length);
      const dv = new DataView(localHeader.buffer);

      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 0x0800, true); // UTF-8
      dv.setUint16(8, 0, true);      // STORE
      dv.setUint16(10, 0, true);
      dv.setUint16(12, 0, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, size, true);
      dv.setUint32(22, size, true);
      dv.setUint16(26, nameBytes.length, true);
      dv.setUint16(28, 0, true);

      localHeader.set(nameBytes, 30);

      const localOffset = offset;
      offset += localHeader.length + size;
      parts.push(localHeader, data);

      const central = new Uint8Array(46 + nameBytes.length);
      const dv2 = new DataView(central.buffer);

      dv2.setUint32(0, 0x02014b50, true);
      dv2.setUint16(4, 20, true);
      dv2.setUint16(6, 20, true);
      dv2.setUint16(8, 0x0800, true);
      dv2.setUint16(10, 0, true);
      dv2.setUint16(12, 0, true);
      dv2.setUint16(14, 0, true);
      dv2.setUint32(16, crc, true);
      dv2.setUint32(20, size, true);
      dv2.setUint32(24, size, true);
      dv2.setUint16(28, nameBytes.length, true);
      dv2.setUint16(30, 0, true);
      dv2.setUint16(32, 0, true);
      dv2.setUint16(34, 0, true);
      dv2.setUint32(38, 0, true);
      dv2.setUint32(42, localOffset, true);

      central.set(nameBytes, 46);
      centralParts.push(central);
    });

    const centralDirOffset = offset;
    centralParts.forEach(c => {
      parts.push(c);
      offset += c.length;
    });

    const centralDirSize = offset - centralDirOffset;

    const eocd = new Uint8Array(22);
    const dv3 = new DataView(eocd.buffer);

    dv3.setUint32(0, 0x06054b50, true);
    dv3.setUint16(4, 0, true);
    dv3.setUint16(6, 0, true);
    dv3.setUint16(8, files.length, true);
    dv3.setUint16(10, files.length, true);
    dv3.setUint32(12, centralDirSize, true);
    dv3.setUint32(16, centralDirOffset, true);
    dv3.setUint16(20, 0, true);

    parts.push(eocd);
    offset += eocd.length;

    let totalSize = 0;
    parts.forEach(p => totalSize += p.length);
    const out = new Uint8Array(totalSize);
    let cursor = 0;
    parts.forEach(p => {
      out.set(p, cursor);
      cursor += p.length;
    });

    return out;
  }

  // ====== EPUB BUILDER ======
  function buildEPUBBytes(meta) {
    const files = [];

    // 1) mimetype
    files.push({
      name: 'mimetype',
      data: encodeUtf8('application/epub+zip')
    });

    // 2) container.xml
    const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
    files.push({
      name: 'META-INF/container.xml',
      data: encodeUtf8(containerXml)
    });

    // 3) main XHTML
    const xhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN"
  "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${meta.language || 'ja'}">
<head>
  <title>${escapeHtml(meta.title)}</title>
  <meta http-equiv="Content-Type" content="application/xhtml+xml; charset=utf-8" />
</head>
<body>
${meta.bodyXhtml}
</body>
</html>`;
    files.push({
      name: 'OEBPS/content.xhtml',
      data: encodeUtf8(xhtml)
    });

    // 4) resources (images) + manifest
    let manifestItems = `    <item id="content" href="content.xhtml" media-type="application/xhtml+xml"/>`;
    (meta.resources || []).forEach((res, idx) => {
      const fullPath = 'OEBPS/' + res.path;
      files.push({
        name: fullPath,
        data: res.data
      });
      manifestItems += `\n    <item id="res${idx}" href="${res.path}" media-type="${res.mimeType}"/>`;
    });

    const uuid = 'id-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
    const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="BookId">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${escapeHtml(meta.title)}</dc:title>
    <dc:creator>${escapeHtml(meta.author || 'Unknown')}</dc:creator>
    <dc:language>${meta.language || 'ja'}</dc:language>
    <dc:identifier id="BookId">${uuid}</dc:identifier>
  </metadata>
  <manifest>
${manifestItems}
  </manifest>
  <spine>
    <itemref idref="content"/>
  </spine>
</package>`;
    files.push({
      name: 'OEBPS/content.opf',
      data: encodeUtf8(contentOpf)
    });

    return buildZipUint8(files);
  }

  // ====== DOWNLOAD BLOB ======
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // ====== FETCH & EXTRACT CHAPTER ======
  async function fetchAndExtractChapter(url) {
    console.log('[SyosetuRipper] fetchAndExtractChapter:', url);
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) {
      throw new Error('HTTP ' + res.status + ' while downloading ' + url);
    }
    const html = await res.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const titleElem = doc.querySelector('.p-novel__title.p-novel__title--rensai');
    const title = titleElem ? titleElem.innerText.trim() : 'Chapter';

    // Include ALL text blocks, including afterword
    const blocks = doc.querySelectorAll(
      '.p-novel__body .js-novel-text.p-novel__text'
    );

    const resources = [];
    let htmlParts = [];
    let imgCounter = 0;

    for (const block of blocks) {
      const clone = block.cloneNode(true);

      // Process images inside this block
      const imgs = clone.querySelectorAll('img');
      for (const img of imgs) {
        const origSrc = img.getAttribute('src');
        if (!origSrc) continue;

        const absUrl = absoluteImageUrl(origSrc, url);
        if (!absUrl) {
          img.remove();
          continue;
        }

        const extMatch = absUrl.match(/\.(jpe?g|png|gif|webp|bmp|svg)(?:\?|#|$)/i);
        let ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';
        if (ext === 'jpeg') ext = 'jpg';

        const filename = `img${String(imgCounter++).padStart(3, '0')}.${ext}`;
        const path = `images/${filename}`;

        let mime = 'image/jpeg';
        if (ext === 'png') mime = 'image/png';
        else if (ext === 'gif') mime = 'image/gif';
        else if (ext === 'webp') mime = 'image/webp';
        else if (ext === 'svg') mime = 'image/svg+xml';
        else if (ext === 'bmp') mime = 'image/bmp';

        try {
          const imgRes = await fetch(absUrl);
          if (!imgRes.ok) {
            console.warn('Error downloading image', absUrl, imgRes.status);
            img.remove();
            continue;
          }
          const buf = await imgRes.arrayBuffer();
          resources.push({
            path,
            mimeType: mime,
            data: new Uint8Array(buf)
          });
          img.setAttribute('src', path);
        } catch (e) {
          console.warn('Failed to fetch image', absUrl, e);
          img.remove();
        }
      }

      const inner = clone.innerHTML.trim();
      if (inner) htmlParts.push(inner);
    }

    const bodyXhtml =
      `<h1>${escapeHtml(title)}</h1>\n` +
      htmlParts.join('\n<hr />\n');

    return { title, bodyXhtml, resources };
  }

  // ====== INDEX BASE PATH ======
  function getIndexBasePath() {
    let path = location.pathname.replace(/\/+$/, '/');
    path = path.replace(/\/\d+\/$/, '/');
    const url = location.origin + path;
    console.log('[SyosetuRipper] Index base path:', url);
    return url;
  }

  const pathParts = location.pathname.split('/').filter(Boolean);
  const ncode = pathParts[0] || '';
  const isChapterPage = pathParts.length === 2 && /^\d+$/.test(pathParts[1]);
  console.log('[SyosetuRipper] ncode:', ncode, 'isChapterPage:', isChapterPage);

  // ====== COLLECT ALL CHAPTERS (ALL INDEX PAGES) ======
  async function collectAllChapterLinks() {
    const result = [];
    const seen = new Set(); // avoid duplicates (reused index pages)
    const basePath = getIndexBasePath();
    const maxPages = 500;

    let page = 1;
    while (page <= maxPages) {
      const url = page === 1 ? basePath : `${basePath}?p=${page}`;
      console.log('[SyosetuRipper] Loading index page', page, ':', url);
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) {
        console.warn('[SyosetuRipper] HTTP error on index page', page, res.status);
        break;
      }

      const html = await res.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      const links = doc.querySelectorAll(
        `.p-eplist a[href^="/${ncode}/"]`
      );
      console.log('[SyosetuRipper] Page', page, '- links found:', links.length);

      if (!links.length) {
        console.log('[SyosetuRipper] No chapter list on this page. Stopping index scan.');
        break;
      }

      let newCount = 0;

      links.forEach(a => {
        const hrefAttr = a.getAttribute('href') || '';
        if (!/\/\d+\/?$/.test(hrefAttr)) return; // only /ncode/number/

        const href = a.href.startsWith('http')
          ? a.href
          : location.origin + hrefAttr;
        if (seen.has(href)) {
          return;
        }
        seen.add(href);

        const text = (a.innerText || '').trim();
        const num = getChapterNumberFromUrl(href);
        result.push({ href, text, num });
        newCount++;
      });

      // If this page added no new chapters, we assume it's a repeated index
      if (newCount === 0) {
        console.log('[SyosetuRipper] Page', page, 'added no new chapters. Assuming repeated index and stopping.');
        break;
      }

      page++;
    }

    console.log('[SyosetuRipper] Total chapters collected (fetch):', result.length);
    return result;
  }

  // ====== FALLBACK: CHAPTERS FROM CURRENT PAGE ONLY ======
  function collectChaptersFromCurrentPage() {
    const result = [];
    const links = document.querySelectorAll('.p-eplist__sublist a.p-eplist__subtitle');
    links.forEach(a => {
      const hrefAttr = a.getAttribute('href') || '';
      if (!/\/\d+\/?$/.test(hrefAttr)) return;
      const href = a.href.startsWith('http')
        ? a.href
        : location.origin + hrefAttr;
      const text = (a.innerText || '').trim();
      const num = getChapterNumberFromUrl(href);
      result.push({ href, text, num });
    });
    console.log('[SyosetuRipper] Fallback DOM - chapters found on this page:', result.length);
    return result;
  }

  // ====== NOVEL TITLE ======
  let novelTitle = '';
  const novelLink = document.querySelector('.c-announce a[href^="/"]');
  if (novelLink) {
    novelTitle = novelLink.innerText.trim();
  }
  if (!novelTitle) {
    novelTitle = document.title.replace(/[\s　]*-.*$/, '').trim();
  }
  console.log('[SyosetuRipper] Novel title:', novelTitle);

  // ====== INDEX: SMALL "download" BUTTON NEXT TO EACH CHAPTER ======
  const chapterLinks = document.querySelectorAll('.p-eplist__sublist a.p-eplist__subtitle');
  console.log('[SyosetuRipper] Chapters visible in DOM:', chapterLinks.length);
  if (chapterLinks.length) {
    chapterLinks.forEach(a => {
      const hrefAttr = a.getAttribute('href') || '';
      if (!/\/\d+\/?$/.test(hrefAttr)) return;

      const btn = document.createElement('button');
      btn.textContent = 'download';
      btn.className = 'tm-mini-btn';
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        btn.disabled = true;
        btn.textContent = '...';

        const chapterUrl = a.href.startsWith('http')
          ? a.href
          : location.origin + hrefAttr;

        const rawNum = getChapterNumberFromUrl(chapterUrl);
        const chapNum = rawNum ? String(rawNum).padStart(3, '0') : '';

        try {
          showProgress('Downloading chapter (text + images + afterword)...');
          const { title, bodyXhtml, resources } = await fetchAndExtractChapter(chapterUrl);
          const epubBytes = buildEPUBBytes({
            title,
            author: novelTitle,
            language: 'ja',
            bodyXhtml,
            resources
          });
          const blob = new Blob([epubBytes], { type: 'application/epub+zip' });

          const baseName = (chapNum ? chapNum + '- ' : '') + title;
          const filename = sanitizeFilename(baseName) + '.epub';
          downloadBlob(blob, filename);
          btn.textContent = '✓';
          hideProgress();
        } catch (err) {
          console.error('Error downloading chapter:', err);
          btn.textContent = '⚠️';
          showProgress('Error downloading this chapter. Check the console (F12 → Console).');
          hideProgress(4000);
        } finally {
          btn.disabled = false;
        }
      });
      a.insertAdjacentElement('afterend', btn);
    });
  }

  // ====== FLOATING BUTTONS ======
  function createFloatingButtons() {
    if (document.getElementById('tm-floating-box')) return;

    const box = document.createElement('div');
    box.id = 'tm-floating-box';

    // If we are on a chapter page (/nXXXXxx/1/), add "Download this chapter"
    if (isChapterPage) {
      const singleBtn = document.createElement('button');
      singleBtn.className = 'tm-float-btn';
      singleBtn.textContent = '📥 Download this chapter';
      singleBtn.addEventListener('click', async () => {
        if (singleBtn.disabled) return;
        singleBtn.disabled = true;
        singleBtn.textContent = '📥 Downloading...';

        const chapterUrl = location.href;
        const rawNum = getChapterNumberFromUrl(chapterUrl);
        const chapNum = rawNum ? String(rawNum).padStart(3, '0') : '';

        try {
          showProgress('Downloading current chapter (text + images + afterword)...');
          const { title, bodyXhtml, resources } = await fetchAndExtractChapter(chapterUrl);
          const epubBytes = buildEPUBBytes({
            title,
            author: novelTitle,
            language: 'ja',
            bodyXhtml,
            resources
          });
          const blob = new Blob([epubBytes], { type: 'application/epub+zip' });

          const baseName = (chapNum ? chapNum + '- ' : '') + title;
          const filename = sanitizeFilename(baseName) + '.epub';
          downloadBlob(blob, filename);
          showProgress('EPUB ready. Download started.');
          hideProgress(4000);
        } catch (err) {
          console.error('Error downloading current chapter:', err);
          showProgress('Error downloading this chapter. Check the console (F12 → Console).');
          hideProgress(5000);
        } finally {
          singleBtn.disabled = false;
          singleBtn.textContent = '📥 Download this chapter';
        }
      });
      box.appendChild(singleBtn);
    }

    // Button to download ALL chapters
    const allBtn = document.createElement('button');
    allBtn.className = 'tm-float-btn';
    allBtn.textContent = '📚 Download all';
    allBtn.addEventListener('click', async () => {
      if (allBtn.disabled) return;
      allBtn.disabled = true;
      allBtn.textContent = '📚 Working...';

      try {
        showProgress('Searching all chapters across all index pages...');
        let allChapters = [];
        try {
          allChapters = await collectAllChapterLinks();
        } catch (e) {
          console.warn('[SyosetuRipper] Error in collectAllChapterLinks, using DOM fallback:', e);
        }

        if (!allChapters.length) {
          // Fallback: only current page
          showProgress('Could not get chapters via fetch.\nUsing only chapters visible on this page...');
          allChapters = collectChaptersFromCurrentPage();
        }

        const total = allChapters.length;

        if (!total) {
          showProgress('No chapters found.');
          hideProgress(4000);
          allBtn.disabled = false;
          allBtn.textContent = '📚 Download all';
          return;
        }

        const files = [];

        for (let i = 0; i < total; i++) {
          const chap = allChapters[i];
          showProgress(
            `Downloading chapters: ${i + 1} / ${total}\n${chap.href}`
          );

          const { title, bodyXhtml, resources } = await fetchAndExtractChapter(chap.href);
          const epubBytes = buildEPUBBytes({
            title,
            author: novelTitle,
            language: 'ja',
            bodyXhtml,
            resources
          });

          const rawNum = chap.num;
          const chapNum = rawNum ? String(rawNum).padStart(3, '0') : '';
          const baseName = (chapNum ? chapNum + '- ' : '') +
                           (title || chap.text || `chapter_${i + 1}`);
          const name = sanitizeFilename(baseName) + '.epub';

          files.push({ name, data: epubBytes });
        }

        showProgress('Packaging ZIP with all EPUBs...');
        const zipBytes = buildZipUint8(files);
        const zipBlob = new Blob([zipBytes], { type: 'application/zip' });
        const zipName = sanitizeFilename(novelTitle || 'novel') + '_all_epub.zip';
        downloadBlob(zipBlob, zipName);
        showProgress('ZIP ready. Download started.');
        hideProgress(4000);
      } catch (err) {
        console.error('Error in bulk download:', err);
        showProgress('Error in bulk download. Check the console (F12 → Console).');
        hideProgress(5000);
      } finally {
        allBtn.disabled = false;
        allBtn.textContent = '📚 Download all';
      }
    });

    box.appendChild(allBtn);
    document.body.appendChild(box);
  }

  createFloatingButtons();
})();