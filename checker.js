/* SailVisible AI 搜索可见性体检 — 前端逻辑（无依赖） */
(function () {
  'use strict';

  var isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  var API_BASE = (window.SV_CHECKER_API || (isLocal ? location.origin : 'https://sailvisible-checker-api.bryanhuang7878.workers.dev')).replace(/\/$/, '');
  var UNLOCK_KEY = 'sv_checker_unlocked';

  var CAT_LABEL = {
    crawl: 'AI 爬虫可访问性',
    tech: '海外访问与技术基础',
    index: '搜索引擎收录基础',
    ai: 'AI 可理解性',
    global: '海外获客就绪度'
  };

  var GRADE = {
    A: { label: '优秀', note: '技术基础扎实，下一步重点是内容与第三方背书，让 AI 主动推荐你。' },
    B: { label: '良好', note: '基础不错，修复下面的几个问题后，被 AI 搜索引用的概率会明显提升。' },
    C: { label: '一般', note: '存在影响海外收录和 AI 推荐的关键缺陷，建议优先修复红色项目。' },
    D: { label: '较差', note: '海外买家和 AI 很可能根本“看不到”你的网站，建议尽快系统整改。' }
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function list(arr) { return arr && arr.length ? arr.map(esc).join('、') : '无'; }

  /* 每一项：标题 / 为什么重要（免费）/ 检测结果（免费）/ 整改方法（留邮箱解锁） */
  var CHECKS = {
    robots_ai: {
      title: 'robots.txt 是否放行搜索与 AI 爬虫',
      why: 'ChatGPT 搜索依赖 OAI-SearchBot 和 Bing 索引，Gemini 依赖 Google 索引。被 robots.txt 屏蔽的爬虫读不到你的网站，AI 也就不会推荐你。',
      finding: function (d) {
        if (d.serverError) return 'robots.txt 返回服务器错误（5xx），Google 会把整站当作禁止抓取。';
        if (!d.exists) return '网站没有 robots.txt（默认全部允许抓取），但也错过了声明 Sitemap 的机会。';
        if (!d.blocked.length) return '已放行全部 8 个主要爬虫：' + list(d.allowed) + '。';
        return '被屏蔽的爬虫：<strong>' + list(d.blocked) + '</strong>' +
          (d.criticalBlocked.length ? '（其中 ' + list(d.criticalBlocked) + ' 直接决定能不能被 Google / ChatGPT 搜到）' : '') + '。';
      },
      fix: '在网站根目录的 robots.txt 中为 Googlebot、Bingbot、OAI-SearchBot、ChatGPT-User、PerplexityBot 等写入 <code>Allow: /</code>，删除针对它们的 <code>Disallow: /</code>，并在末尾加上 <code>Sitemap: https://你的域名/sitemap.xml</code>。如果不希望内容被拿去训练，可以只屏蔽 GPTBot 和 Google-Extended，搜索类爬虫一定要放行。'
    },
    waf_bots: {
      title: '防火墙是否误拦 AI 爬虫（实测）',
      why: '很多国内主机、CDN 和 WAF（如云盾、宝塔防火墙）会把海外爬虫当成攻击拦截。即使 robots.txt 写对了，AI 实际上还是打不开你的网站。',
      finding: function (d) {
        var parts = d.results.map(function (r) {
          return esc(r.bot) + '：' + (r.blocked ? '<strong>被拦截</strong>' + (r.status ? '（HTTP ' + r.status + '）' : '') : '正常访问');
        });
        return '我们用 AI 爬虫的身份从海外节点实际访问了首页 —— ' + parts.join('；') + '。' +
          (d.baselineChallenge ? ' 普通浏览器访问也出现了验证页，说明海外访问整体被限制。' : '');
      },
      fix: '在服务器 / CDN / WAF 中把以下 User-Agent 加入白名单：OAI-SearchBot、ChatGPT-User、GPTBot、Googlebot、Bingbot、PerplexityBot；关闭对海外 IP 的“地域封禁”和“人机验证”，宝塔用户检查“Nginx 防火墙 → UA 过滤 / 禁止海外访问”，阿里云 / 腾讯云用户检查 WAF 的 Bot 管理规则。'
    },
    noindex: {
      title: '页面是否设置了禁止收录（noindex）',
      why: '带有 noindex 的页面会被 Google 和 Bing 主动剔除出索引，AI 搜索也就无从引用。',
      finding: function (d) {
        if (d.meta.indexOf('noindex') > -1 || d.meta.indexOf('none') > -1) return '首页 meta robots 包含 <strong>' + esc(d.meta) + '</strong>，搜索引擎会拒绝收录。';
        if (d.header.indexOf('noindex') > -1) return '服务器响应头 X-Robots-Tag 包含 <strong>noindex</strong>。';
        return '未发现 noindex，首页允许被收录。';
      },
      fix: '删除首页 <code>&lt;meta name="robots" content="noindex"&gt;</code>（很多建站系统在“开发模式 / 禁止搜索引擎索引”开关里设置），同时检查服务器是否发送 <code>X-Robots-Tag: noindex</code>。'
    },
    https: {
      title: 'HTTPS 安全访问',
      why: 'Google 把 HTTPS 作为排名信号，海外买家的浏览器也会对 HTTP 网站显示“不安全”，直接影响信任和询盘。',
      finding: function (d) {
        if (!d.httpsOk) return '网站<strong>不能通过 HTTPS 正常访问</strong>。';
        if (d.redirect === 'none') return 'HTTPS 可用，但 HTTP 版本没有自动跳转到 HTTPS，会产生重复页面。';
        return 'HTTPS 正常，且 HTTP 会自动跳转到 HTTPS。';
      },
      fix: '申请免费 SSL 证书（Let\'s Encrypt / 云厂商免费证书），并在服务器设置 HTTP → HTTPS 的 301 跳转。'
    },
    speed: {
      title: '海外节点访问速度',
      why: '服务器放在国内、又没有海外 CDN 的网站，海外打开往往要好几秒，爬虫抓取量和买家停留时间都会下降。',
      finding: function (d) {
        return '从 Cloudflare 节点' + (d.colo ? '（' + esc(d.colo) + '）' : '') + '下载首页耗时 <strong>' + d.ms + ' ms</strong>' +
          '（首字节 ' + d.ttfb + ' ms，HTML 大小 ' + d.kb + ' KB）。' +
          (d.ms > 4000 ? ' 对海外访客来说偏慢。' : d.ms > 1500 ? ' 还有优化空间。' : ' 速度良好。');
      },
      fix: '外贸站建议部署在海外（香港、新加坡、美西）或接入海外 CDN（Cloudflare 免费版即可）；压缩图片为 WebP，开启 Gzip / Brotli，减少首页第三方脚本。'
    },
    viewport: {
      title: '移动端适配（viewport）',
      why: 'Google 采用移动优先索引，海外 B2B 买家也大量用手机查供应商。',
      finding: function (d, c) { return c.status === 'pass' ? '已设置移动端 viewport。' : '<strong>缺少 viewport 设置</strong>，手机上会显示成缩小的电脑版页面。'; },
      fix: '在 <code>&lt;head&gt;</code> 中加入 <code>&lt;meta name="viewport" content="width=device-width, initial-scale=1"&gt;</code>，并确认页面采用响应式布局。'
    },
    sitemap: {
      title: 'Sitemap 站点地图',
      why: 'Sitemap 告诉 Google 和 Bing 你有哪些页面，新页面才能更快被收录，进而被 AI 检索到。',
      finding: function (d) {
        if (!d.found) return '<strong>没有找到 sitemap.xml</strong>（已检查 robots.txt 声明、/sitemap.xml、/sitemap_index.xml）。';
        return '找到 Sitemap：' + esc(d.found) + '，包含 ' + d.urls + ' 条' + (d.index ? '子地图' : '网址') + '。' + (d.fromRobots ? '' : ' 建议同时在 robots.txt 中声明。');
      },
      fix: '用建站系统插件或在线工具生成 sitemap.xml 放在根目录，在 robots.txt 中声明，并提交到 Google Search Console 和 Bing Webmaster Tools。'
    },
    title: {
      title: '页面标题（Title）',
      why: '标题是搜索结果和 AI 引用时最先读取的信息，要写清“公司是谁 + 做什么 + 面向哪里”。',
      finding: function (d) {
        if (!d.len) return '<strong>首页没有标题</strong>。';
        return '当前标题（' + d.len + ' 字符）：“' + esc(d.text) + '”' + (d.len < 10 ? '，过短。' : d.len > 70 ? '，过长，搜索结果中会被截断。' : '。');
      },
      fix: '标题建议 15–60 个字符，格式如“公司英文名 | 核心产品 Manufacturer & Exporter in China”，外贸站首页标题建议用英文。'
    },
    description: {
      title: '页面描述（Meta Description）',
      why: '描述会显示在搜索结果中，也是 AI 判断页面主题的重要依据。',
      finding: function (d) {
        if (!d.len) return '<strong>首页没有 meta description</strong>。';
        return '当前描述（' + d.len + ' 字符）：“' + esc(d.text) + '”' + (d.len < 40 ? '，过短。' : d.len > 180 ? '，过长。' : '。');
      },
      fix: '写一段 80–160 个字符的描述，包含：主营产品、核心资质（如 ISO / CE）、产能或出口国家、联系方式入口。'
    },
    canonical: {
      title: '规范链接（Canonical）',
      why: '告诉搜索引擎哪个网址是“正式版本”，避免 www / 非 www、带参数网址被当成重复内容。',
      finding: function (d) { return d.href ? '已设置：' + esc(d.href) : '未设置 canonical 标签。'; },
      fix: '在每个页面 <code>&lt;head&gt;</code> 中加入 <code>&lt;link rel="canonical" href="该页面的正式网址"&gt;</code>。'
    },
    h1: {
      title: 'H1 主标题',
      why: 'H1 是页面最核心的主题声明，搜索引擎和 AI 都会优先读取。',
      finding: function (d) {
        if (!d.count) return '<strong>首页没有 H1 标题</strong>（很多网站把标题做成了图片或轮播图）。';
        return '共 ' + d.count + ' 个 H1' + (d.first ? '，第一个是：“' + esc(d.first) + '”' : '') + (d.count > 1 ? '。建议只保留 1 个。' : '。');
      },
      fix: '首页保留 1 个文字形式的 H1，写清公司定位，例如“Professional XXX Manufacturer in China”，不要只用图片表达。'
    },
    jsonld: {
      title: 'Schema 结构化数据（JSON-LD）',
      why: '结构化数据用机器能读懂的格式告诉 Google 和 AI：你是什么公司、卖什么产品、有哪些常见问答，是 GEO 优化的核心基建。',
      finding: function (d) {
        if (!d.count) return '<strong>没有任何 JSON-LD 结构化数据</strong>。';
        return '发现 ' + d.count + ' 段 JSON-LD' + (d.invalid ? '（其中 ' + d.invalid + ' 段格式错误）' : '') + '，类型：' + list(d.types) + '。';
      },
      fix: '至少部署 Organization（公司信息）、Product（主营产品）和 FAQPage（常见问题）三类 JSON-LD，可以用 Google 富媒体搜索测试工具验证。'
    },
    org_schema: {
      title: '企业身份信息（Organization Schema）',
      why: 'AI 在推荐供应商时，需要确认公司名称、官网、地址和联系方式，Organization Schema 是最直接的“身份证”。',
      finding: function (d) {
        if (!d.type) return '<strong>没有声明企业身份</strong>（Organization / LocalBusiness 等）。';
        return '已声明 ' + esc(d.type) + (d.hasContact ? '，并包含联系方式或地址。' : '，但<strong>缺少邮箱、电话或地址</strong>。');
      },
      fix: '在首页加入 Organization JSON-LD，包含 name、alternateName（中英文名）、url、logo、address、email、telephone、sameAs（LinkedIn / Facebook / YouTube 主页）。'
    },
    llms: {
      title: 'llms.txt（AI 专用说明文件）',
      why: 'llms.txt 是新兴的 AI 友好标准，用 Markdown 给大模型提供公司简介和核心页面清单，部署成本几乎为零。',
      finding: function (d) { return d.found ? '已部署 llms.txt。' : '未发现 /llms.txt。'; },
      fix: '在根目录创建 llms.txt：第一行写公司名，下面用几句话介绍主营业务与资质，然后列出核心页面链接（产品页、关于我们、联系方式）。'
    },
    content: {
      title: '无需 JavaScript 即可读取的正文',
      why: '大多数 AI 爬虫不执行 JavaScript。如果正文靠 JS 动态加载，或者主要是图片，AI 读到的就是一个空页面。',
      finding: function (d) {
        var s = '首页源码中可直接读取的文字约 <strong>' + d.chars + '</strong> 个字符。';
        if (d.spa) s += ' 页面疑似由 JavaScript 动态渲染（单页应用），AI 爬虫可能读不到内容。';
        else if (d.chars < 200) s += ' 内容过少，可能主要由图片构成。';
        else if (d.chars < 800) s += ' 偏少，建议补充文字介绍。';
        return s;
      },
      fix: '首页至少提供 300 字以上的文字介绍（公司、产品、优势、认证、出口市场）；Vue / React 网站请开启服务端渲染（SSR）或预渲染；图片中的关键信息同时用文字写出来。'
    },
    english: {
      title: '英文版网站',
      why: '海外买家和英文 AI 搜索只会推荐他们能读懂的网站。只有中文版的网站，在英文提问中几乎不可能出现。',
      finding: function (d) {
        if (d.mode === 'native') return '首页本身就是英文内容' + (d.lang ? '（lang="' + esc(d.lang) + '"）' : '') + '。';
        if (d.mode === 'alternate') return '发现英文版入口：' + (d.links.length ? d.links.map(esc).join('、') : '已检测到 English 切换链接') + '。';
        return '首页以中文为主（中文占比约 ' + Math.round(d.cjkRatio * 100) + '%），<strong>没有发现英文版入口</strong>。';
      },
      fix: '建设独立的英文页面（建议用 /en/ 子目录），由专业人员撰写而不是机翻；首页放置明显的 English 切换入口，并用 hreflang 标注中英文对应关系。'
    },
    hreflang: {
      title: '多语言标注（hreflang）',
      why: 'hreflang 告诉 Google 不同语言版本的对应关系，确保英语买家看到英文页、法语买家看到法文页。',
      finding: function (d) {
        if (d.langs.length >= 2) return '已标注语言版本：' + list(d.langs) + '。';
        if (d.langs.length === 1) return '只标注了 1 个语言版本（' + list(d.langs) + '），缺少对应关系。';
        return '未设置 hreflang' + (d.htmlLang ? '（页面 lang="' + esc(d.htmlLang) + '"）' : '，页面也没有声明 lang 属性') + '。';
      },
      fix: '在每个语言版本的 <code>&lt;head&gt;</code> 中互相加入 <code>&lt;link rel="alternate" hreflang="en" href="…"&gt;</code>、<code>hreflang="zh-CN"</code> 和 <code>hreflang="x-default"</code>。'
    },
    contact: {
      title: '海外买家联系方式',
      why: '海外买家习惯用邮箱、WhatsApp 和询盘表单联系供应商；只留国内手机号或微信，会直接流失询盘。',
      finding: function (d) {
        var items = [
          (d.email ? '✔' : '✘') + ' 邮箱',
          (d.whatsapp ? '✔' : '✘') + ' WhatsApp',
          (d.intlPhone ? '✔' : '✘') + ' 国际格式电话（+86）',
          (d.form ? '✔' : '✘') + ' 询盘表单'
        ];
        return '首页检测结果：' + items.join(' · ');
      },
      fix: '在页头或页脚放置企业邮箱（避免 QQ / 163 邮箱）、WhatsApp 点击链接（wa.me/86…）、+86 格式电话，并提供英文询盘表单。'
    },
    og: {
      title: '社交分享卡片（Open Graph）',
      why: '在 LinkedIn、WhatsApp、Facebook 分享网址时，Open Graph 决定显示的标题、描述和图片，是外贸社媒获客的门面。',
      finding: function (d) {
        return 'og:title ' + (d.title ? '✔' : '✘') + ' · og:description ' + (d.description ? '✔' : '✘') + ' · og:image ' + (d.image ? '✔' : '✘');
      },
      fix: '加入 <code>og:title</code>、<code>og:description</code>、<code>og:image</code>（建议 1200×630 的工厂或产品图）三个 meta 标签。'
    }
  };

  /* ---------------- DOM ---------------- */

  var $ = function (sel) { return document.querySelector(sel); };
  var form = $('#sv-check-form');
  var input = $('#sv-url');
  var btn = $('#sv-submit');
  var loading = $('#sv-loading');
  var errorBox = $('#sv-error');
  var result = $('#sv-result');
  if (!form) return;

  var lastResult = null;

  function unlocked() {
    try { return localStorage.getItem(UNLOCK_KEY) === '1'; } catch (e) { return false; }
  }

  function setLoading(on) {
    btn.disabled = on;
    btn.textContent = on ? '扫描中…' : '开始体检 →';
    loading.hidden = !on;
    if (on) {
      var steps = loading.querySelectorAll('li');
      steps.forEach(function (li) { li.className = ''; });
      var i = 0;
      clearInterval(setLoading.timer);
      setLoading.timer = setInterval(function () {
        if (i > 0 && steps[i - 1]) steps[i - 1].className = 'done';
        if (steps[i]) steps[i].className = 'active';
        i += 1;
        if (i > steps.length) clearInterval(setLoading.timer);
      }, 1200);
    } else {
      clearInterval(setLoading.timer);
    }
  }

  function showError(msg) {
    errorBox.innerHTML = msg;
    errorBox.hidden = false;
  }

  function run(url) {
    errorBox.hidden = true;
    result.hidden = true;
    setLoading(true);
    var endpoint = API_BASE + '/api/check?url=' + encodeURIComponent(url);
    fetch(endpoint)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        setLoading(false);
        if (!data.ok) {
          if (data.error === 'rate_limited') return showError('请求过于频繁，请 1 分钟后再试。');
          if (data.error === 'invalid_url') return showError('网址格式不正确，请输入类似 <code>www.example.com</code> 的网址。');
          if (data.error === 'unreachable') {
            return showError('<strong>从海外节点无法打开这个网站</strong>（' + esc(data.detail || '') + '）。<br>这本身就是一个严重问题：海外买家、Google 和 ChatGPT 很可能也打不开它。常见原因是服务器屏蔽了海外 IP、防火墙拦截或域名未备案被拦截。<br><a href="mailto:hello@sailvisible.com?subject=' + encodeURIComponent('网站海外无法访问：' + url) + '">联系我们免费排查 →</a>');
          }
          return showError('检测失败，请稍后再试。');
        }
        lastResult = data;
        render(data);
        try {
          var u = new URL(location.href);
          u.searchParams.set('url', data.host);
          history.replaceState(null, '', u.toString());
        } catch (e) { /* ignore */ }
      })
      .catch(function () {
        setLoading(false);
        showError('检测服务暂时无法连接，请稍后重试，或发邮件到 <a href="mailto:hello@sailvisible.com">hello@sailvisible.com</a> 获取人工诊断。');
      });
  }

  function statusIcon(s) {
    return s === 'pass' ? '<span class="sv-ico sv-pass" aria-label="通过">✓</span>'
      : s === 'warn' ? '<span class="sv-ico sv-warn" aria-label="需改进">!</span>'
        : '<span class="sv-ico sv-fail" aria-label="严重">✕</span>';
  }

  function render(data) {
    var g = GRADE[data.grade] || GRADE.D;
    var open = unlocked();
    var html = '';

    html += '<div class="sv-summary">';
    html += '  <div class="sv-score sv-grade-' + data.grade + '" style="--p:' + data.score + '"><span>' + data.score + '</span><small>/ 100</small></div>';
    html += '  <div class="sv-summary-text">';
    html += '    <div class="sv-host-row"><span class="sv-host">' + esc(data.host) + '</span><span class="sv-grade-pill sv-grade-pill-' + data.grade + '">GRADE ' + esc(data.grade) + ' · ' + g.label + '</span>' + (data.colo ? '<span class="badge">EDGE: ' + esc(data.colo) + '</span>' : '') + (data.cached ? '<span class="badge">30 分钟内缓存</span>' : '') + '</div>';
    html += '    <h2>AI 搜索可见性综合评估：' + g.label + '</h2>';
    html += '    <p>' + g.note + '</p>';
    html += '    <p class="sv-counts"><span class="sv-c-pass">✓ 通过 ' + data.summary.pass + '</span><span class="sv-c-warn">! 需改进 ' + data.summary.warn + '</span><span class="sv-c-fail">✕ 严重 ' + data.summary.fail + '</span></p>';
    html += '  </div>';
    html += '</div>';

    html += '<div class="sv-cats">';
    data.categories.forEach(function (c) {
      var pct = c.max ? Math.round((c.score / c.max) * 100) : 0;
      html += '<div class="sv-cat"><div class="sv-cat-head"><span>' + CAT_LABEL[c.id] + '</span><span>' + c.score + ' / ' + c.max + '</span></div><div class="sv-bar"><i style="width:' + pct + '%"></i></div></div>';
    });
    html += '</div>';

    if (!open) {
      html += '<div class="callout-box sv-unlock-hint"><strong>想知道每一项怎么改？</strong> 留下邮箱即可解锁下面所有问题的整改方法，我们还会免费帮你实测一次：在 ChatGPT 和 Gemini 里搜你的行业，看 AI 会不会推荐你。<a href="#sv-lead">立即解锁 ↓</a></div>';
    }

    var order = { fail: 0, warn: 1, pass: 2 };
    Object.keys(CAT_LABEL).forEach(function (cat) {
      var items = data.checks.filter(function (c) { return c.cat === cat; })
        .sort(function (a, b) { return order[a.status] - order[b.status]; });
      if (!items.length) return;
      html += '<h3 class="sv-cat-title">' + CAT_LABEL[cat] + '</h3><ul class="sv-checks">';
      items.forEach(function (c) {
        var def = CHECKS[c.id];
        if (!def) return;
        html += '<li class="sv-check sv-s-' + c.status + '">';
        html += statusIcon(c.status);
        html += '<div class="sv-check-body">';
        html += '<div class="sv-check-head"><strong>' + def.title + '</strong><span class="sv-pts">' + c.score + ' / ' + c.max + '</span></div>';
        html += '<p class="sv-finding">' + def.finding(c.data, c) + '</p>';
        if (c.status !== 'pass') {
          html += '<p class="sv-why">' + def.why + '</p>';
          html += open
            ? '<div class="sv-fix"><strong>整改方法：</strong>' + def.fix + '</div>'
            : '<div class="sv-fix sv-locked"><span><strong>整改方法：</strong>留下邮箱后立即解锁具体步骤</span><a href="#sv-lead">去解锁 ↓</a></div>';
        }
        html += '</div></li>';
      });
      html += '</ul>';
    });

    html += leadFormHtml(open);
    html += '<p class="sv-share">分享这份体检结果：<input type="text" readonly value="' + esc(location.origin + location.pathname + '?url=' + encodeURIComponent(data.host)) + '" onclick="this.select()"></p>';
    html += '<p class="sv-meta">检测时间：' + esc(new Date(data.checkedAt).toLocaleString('zh-CN')) + ' · 本工具只检测首页的技术基础，不代表 AI 的实际推荐结果。</p>';

    result.innerHTML = html;
    result.hidden = false;
    result.scrollIntoView({ behavior: 'smooth', block: 'start' });
    bindLeadForm();
  }

  function leadFormHtml(open) {
    var h = '<section id="sv-lead" class="sv-lead">';
    if (open) {
      h += '<h3>✅ 整改方法已解锁</h3><p>我们会在 1–2 个工作日内把 <strong>ChatGPT / Gemini 实测结果</strong>发到你的邮箱。想更快沟通，欢迎直接写信到 <a href="mailto:hello@sailvisible.com">hello@sailvisible.com</a>。</p>';
      h += '</section>';
      return h;
    }
    h += '<h3>免费领取：完整整改方案 + AI 推荐实测</h3>';
    h += '<p>留下邮箱，立即解锁所有问题的整改方法。我们的顾问还会用你所在行业的真实买家提问，在 ChatGPT 和 Gemini 里测一次，告诉你 AI 现在推荐的是谁、你差在哪里。</p>';
    h += '<form id="sv-lead-form" class="sv-lead-form" novalidate>';
    h += '<label>工作邮箱 *<input type="email" name="email" required placeholder="name@company.com" autocomplete="email"></label>';
    h += '<label>公司名称<input type="text" name="company" placeholder="例如：福建 XX 机械有限公司" autocomplete="organization"></label>';
    h += '<label>微信 / WhatsApp / 电话<input type="text" name="contact" placeholder="方便顾问联系你（选填）"></label>';
    h += '<label>主要目标市场<select name="market"><option value="">请选择（选填）</option><option>北美</option><option>欧洲</option><option>东南亚</option><option>中东</option><option>非洲</option><option>拉美</option><option>澳新</option><option>俄语区 / 中亚</option><option>全球</option></select></label>';
    h += '<input type="text" name="website_hp" tabindex="-1" autocomplete="off" class="sv-hp" aria-hidden="true">';
    h += '<button type="submit" class="btn">解锁整改方案</button>';
    h += '<p class="sv-lead-msg" role="status"></p>';
    h += '<p class="sv-privacy">我们只用这些信息发送体检报告和联系你，不会公开或出售；随时发信至 hello@sailvisible.com 可申请删除。</p>';
    h += '</form></section>';
    return h;
  }

  function bindLeadForm() {
    var f = document.getElementById('sv-lead-form');
    if (!f) return;
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = f.querySelector('.sv-lead-msg');
      var email = f.email.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        msg.textContent = '请填写正确的邮箱地址。';
        return;
      }
      var submitBtn = f.querySelector('button');
      submitBtn.disabled = true;
      submitBtn.textContent = '提交中…';
      var payload = {
        email: email,
        company: f.company.value,
        contact: f.contact.value,
        market: f.market.value,
        website_hp: f.website_hp.value,
        url: lastResult ? lastResult.finalUrl : '',
        score: lastResult ? lastResult.score : null,
        issues: lastResult ? lastResult.checks.filter(function (c) { return c.status !== 'pass'; }).map(function (c) { return c.id; }) : [],
        lang: 'zh'
      };
      fetch(API_BASE + '/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d.ok) throw new Error(d.error || 'failed');
          try { localStorage.setItem(UNLOCK_KEY, '1'); } catch (err) { /* ignore */ }
          if (typeof window.gtag === 'function') window.gtag('event', 'generate_lead', { method: 'ai_checker' });
          render(lastResult);
          var lead = document.getElementById('sv-lead');
          if (lead) lead.scrollIntoView({ behavior: 'smooth', block: 'center' });
        })
        .catch(function () {
          submitBtn.disabled = false;
          submitBtn.textContent = '解锁整改方案';
          msg.innerHTML = '提交失败，请直接发邮件到 <a href="mailto:hello@sailvisible.com?subject=' + encodeURIComponent('AI 可见性体检：' + (lastResult ? lastResult.host : '')) + '">hello@sailvisible.com</a>。';
        });
    });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var v = input.value.trim();
    if (!v) { input.focus(); return; }
    run(v);
  });

  document.querySelectorAll('.sv-sample').forEach(function (chip) {
    chip.addEventListener('click', function () {
      var u = chip.getAttribute('data-url');
      if (!u) return;
      input.value = u;
      run(u);
    });
  });

  // 支持 ?url=example.com 直接打开结果（便于分享）
  try {
    var preset = new URLSearchParams(location.search).get('url');
    if (preset) {
      input.value = preset;
      run(preset);
    }
  } catch (e) { /* ignore */ }
})();
