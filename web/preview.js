/* W-AtomBoard · Markdown 阅读页脚本 */
(function () {
  'use strict';

  var q = new URLSearchParams(location.search);
  var scope = q.get('scope') || 'atom';      // atom | project
  var ownerId = q.get('id') || '';
  var rel = q.get('path') || '';
  var embed = q.get('embed') === '1';        // 内嵌在 Atom 抽屉中阅读

  if (embed) document.body.classList.add('embed');

  var article = document.getElementById('article');
  var tocNav = document.getElementById('toc-nav');
  var crumb = document.getElementById('crumb');
  var footPath = document.getElementById('foot-path');
  var toc = document.getElementById('toc');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function setState(msg, cls) {
    article.innerHTML = '<p class="state' + (cls ? ' ' + cls : '') + '">' + esc(msg) + '</p>';
  }

  function apiUrl() {
    if (scope === 'project') {
      return '/api/projects/' + encodeURIComponent(ownerId) + '/resources/preview?path=' + encodeURIComponent(rel);
    }
    return '/api/atoms/' + encodeURIComponent(ownerId) + '/artifacts-preview?path=' + encodeURIComponent(rel);
  }

  function assetUrl(filePath) {
    if (scope === 'project') {
      return '/api/projects/' + encodeURIComponent(ownerId) + '/resources/asset?path=' + encodeURIComponent(filePath);
    }
    return '/api/atoms/' + encodeURIComponent(ownerId) + '/artifacts-asset?path=' + encodeURIComponent(filePath);
  }

  function dirOf(p) {
    var s = String(p || '');
    var i = s.lastIndexOf('/');
    return i < 0 ? '' : s.slice(0, i);
  }

  function joinPath(dir, base) {
    if (!dir) return base;
    var parts = dir.split('/');
    var segs = base.split('/');
    for (var i = 0; i < segs.length; i++) {
      var seg = segs[i];
      if (seg === '..') parts.pop();
      else if (seg && seg !== '.') parts.push(seg);
    }
    return parts.join('/');
  }

  /* ---------- 渲染 Markdown ---------- */
  function renderMarkdown(doc) {
    var md = String(doc.content || '');
    // 去掉 YAML frontmatter（得到大脑同步下来的文档带 frontmatter）
    md = md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');

    var html = marked.parse(md, { gfm: true, breaks: false });
    var clean = DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });

    var holder = document.createElement('div');
    holder.innerHTML = clean;

    // 图片重写为本地资产接口
    Array.prototype.forEach.call(holder.querySelectorAll('img'), function (img) {
      var src = img.getAttribute('src') || '';
      if (/^(https?:)?\/\//i.test(src) || src.indexOf('data:') === 0) return;
      var base = src.split('#')[0].split('?')[0];
      var joined = base.charAt(0) === '/' ? base : joinPath(dirOf(rel), base);
      img.setAttribute('src', assetUrl(joined));
      img.setAttribute('loading', 'lazy');
    });

    // 相对链接：站内文件跳回阅读页
    Array.prototype.forEach.call(holder.querySelectorAll('a'), function (a) {
      var href = a.getAttribute('href') || '';
      if (/^(https?:|mailto:|tel:|#)/i.test(href)) {
        if (/^https?:/i.test(href)) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noreferrer'); }
        return;
      }
      var base = href.split('#')[0].split('?')[0];
      if (!base) return;
      var joined = base.charAt(0) === '/' ? base : joinPath(dirOf(rel), base);
      a.setAttribute('href', '?scope=' + scope + '&id=' + encodeURIComponent(ownerId) + '&path=' + encodeURIComponent(joined));
    });

    return holder.innerHTML;
  }

  function renderPlain(doc) {
    var holder = document.createElement('div');
    var pre = document.createElement('pre');
    var code = document.createElement('code');
    code.textContent = String(doc.content || '');
    pre.appendChild(code);
    holder.appendChild(pre);
    return holder.innerHTML;
  }

  /* ---------- 目录 ---------- */
  function buildToc() {
    var heads = Array.prototype.slice.call(article.querySelectorAll('h1, h2, h3'));
    if (!heads.length) { tocNav.innerHTML = '<span class="state">无标题层级</span>'; return; }
    var html = '';
    heads.forEach(function (h, i) {
      var id = 'h-' + i;
      h.id = id;
      var text = (h.textContent || '').trim();
      var level = h.tagName === 'H1' ? 1 : (h.tagName === 'H2' ? 2 : 3);
      html += '<a href="#' + id + '" class="lv' + level + '" data-target="' + id + '">' + esc(text) + '</a>';
    });
    tocNav.innerHTML = html;

    var links = Array.prototype.slice.call(tocNav.querySelectorAll('a'));
    links.forEach(function (a) {
      a.addEventListener('click', function () {
        if (window.matchMedia('(max-width:1080px)').matches) toc.classList.remove('open');
      });
    });

    if ('IntersectionObserver' in window) {
      var obs = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          links.forEach(function (a) { a.classList.toggle('active', a.dataset.target === en.target.id); });
        });
      }, { rootMargin: '-90px 0px -70% 0px' });
      heads.forEach(function (h) { obs.observe(h); });
    }
  }

  function fmtDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    function p(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* ---------- 主流程 ---------- */
  function load() {
    if (!ownerId || !rel) { setState('缺少参数：无法定位要阅读的文件。', 'error'); return; }
    setState('正在载入文档…');
    fetch(apiUrl())
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; });
      })
      .then(function (res) {
        if (!res.ok || !res.d || !res.d.doc) {
          setState((res.d && res.d.error) || '读取失败。', 'error');
          return;
        }
        var doc = res.d.doc;
        var title = String(doc.name || rel).replace(/\.[^.]+$/, '');
        var isMd = /^(md|markdown)$/i.test(doc.ext || '');

        crumb.textContent = title;
        footPath.textContent = rel;
        document.title = title + ' · W-AtomBoard';

        var meta = [];
        if (res.d.atom) meta.push('<span><b>Atom</b> ' + esc(res.d.atom.id + ' ' + res.d.atom.title) + '</span>');
        if (res.d.project) meta.push('<span><b>项目</b> ' + esc(res.d.project.name) + '</span>');
        meta.push('<span><b>路径</b> ' + esc(rel) + '</span>');
        meta.push('<span><b>大小</b> ' + Math.max(1, Math.round((doc.size || 0) / 102.4) / 10) + ' KB</span>');
        if (doc.mtime) meta.push('<span><b>更新</b> ' + esc(fmtDate(doc.mtime)) + '</span>');

        var bodyHtml = isMd ? renderMarkdown(doc) : renderPlain(doc);
        var metaHtml = '<div class="doc-meta">' + meta.join('') + '</div>' +
          '<hr style="margin:34px 0 0">';

        // 文档自带 H1 时用它当标题，避免「文件名标题 + 正文标题」重复
        var probe = document.createElement('div');
        probe.innerHTML = bodyHtml;
        var firstEl = probe.firstElementChild;
        var ownH1 = firstEl && firstEl.tagName === 'H1' ? firstEl : null;

        if (ownH1) {
          var ownTitle = (ownH1.textContent || '').trim();
          if (ownTitle) { crumb.textContent = ownTitle; document.title = ownTitle + ' · W-AtomBoard'; }
          article.innerHTML = bodyHtml;
          var lead = article.querySelector('h1');
          if (lead) lead.insertAdjacentHTML('afterend', metaHtml);
          else article.insertAdjacentHTML('afterbegin', metaHtml);
        } else {
          article.innerHTML =
            '<h1>' + esc(title) + '</h1>' + metaHtml + bodyHtml;
        }

        buildToc();
        window.scrollTo(0, 0);
      })
      .catch(function (err) { setState('读取失败：' + err.message, 'error'); });
  }

  /* ---------- 顶栏行为 ---------- */
  document.getElementById('back').addEventListener('click', function () {
    if (history.length > 1) history.back(); else location.href = '/';
  });

  document.getElementById('copy-path').addEventListener('click', function () {
    var btn = this;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(rel).then(function () {
        btn.textContent = '已复制';
        setTimeout(function () { btn.textContent = '复制路径'; }, 1600);
      });
    } else {
      btn.textContent = rel;
    }
  });

  document.getElementById('open-system').addEventListener('click', function () {
    var url = scope === 'project'
      ? '/api/projects/' + encodeURIComponent(ownerId) + '/resources/open'
      : '/api/atoms/' + encodeURIComponent(ownerId) + '/artifacts-open';
    fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: rel })
    }).then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (d) {
        var btn = document.getElementById('open-system');
        if (!d.ok) {
          btn.textContent = '打开失败';
          setTimeout(function () { btn.textContent = '系统打开'; }, 1800);
        }
      });
  });

  document.getElementById('toc-toggle').addEventListener('click', function () {
    toc.classList.toggle('open');
  });

  var bar = document.getElementById('read-progress');
  window.addEventListener('scroll', function () {
    var h = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.width = (h > 0 ? Math.min(100, (window.scrollY / h) * 100) : 0) + '%';
  }, { passive: true });

  load();
})();
