// ==UserScript==
// @name         BOSS直聘竞争力筛选器
// @namespace    http://tampermonkey.net/
// @version      5.1
// @description  自动筛选出你在BOSS直聘上有竞争力的工作（排名前10或超过90%竞争者）
// @author       You
// @match        https://www.zhipin.com/*
// @match        https://m.zhipin.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    const isIframe = window.location.hostname === 'm.zhipin.com';

    // ============ iframe端（m.zhipin.com）：提取竞争力数据发送给父页面 ============
    if (isIframe) {
        function extractAndSend() {
            const text = document.body.innerText;
            const allHtml = document.body.innerHTML;

            let rank = null, total = null, percentile = null;

            const m1 = text.match(/(\d{1,5})\s*\/\s*(\d{1,5})\s*人/);
            if (m1) { rank = parseInt(m1[1]); total = parseInt(m1[2]); }

            if (!rank) {
                const m2 = text.match(/(\d{1,5})\s*\/\s*(\d{1,5})/);
                if (m2) { rank = parseInt(m2[1]); total = parseInt(m2[2]); }
            }

            if (!rank) {
                const m3 = allHtml.match(/(\d{1,5})\s*\/\s*(\d{1,5})/);
                if (m3) { rank = parseInt(m3[1]); total = parseInt(m3[2]); }
            }

            const pctMatch = text.match(/超过[了]?([\d.]+)%/) || allHtml.match(/超过[了]?([\d.]+)%/);
            if (pctMatch) { percentile = parseFloat(pctMatch[1]); }

            if (rank && total && window.parent !== window) {
                window.parent.postMessage({
                    type: 'boss-comp-data',
                    rank, total, percentile
                }, 'https://www.zhipin.com');
            }
        }

        setTimeout(extractAndSend, 2000);
        setTimeout(extractAndSend, 5000);
        setTimeout(extractAndSend, 10000);
        return;
    }

    // ============ 解除F12/右键禁用 ============
    document.addEventListener('keydown', e => {
        if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && e.key === 'I') || (e.ctrlKey && e.key === 'u')) {
            e.stopImmediatePropagation();
        }
    }, true);
    document.addEventListener('contextmenu', e => e.stopImmediatePropagation(), true);

    // ============ 配置 & 缓存 ============
    const CONFIG = {
        topRankThreshold: 10,
        percentileThreshold: 90,
        cacheExpireMs: 24 * 60 * 60 * 1000,
    };

    let cache = GM_getValue('boss_comp_cache', {});

    function cleanCache() {
        const now = Date.now();
        const cleaned = {};
        for (const [k, v] of Object.entries(cache)) {
            if (now - v.ts < CONFIG.cacheExpireMs) cleaned[k] = v;
        }
        cache = cleaned;
        GM_setValue('boss_comp_cache', cache);
    }

    function isCompetitive(rank, pct) {
        return rank <= CONFIG.topRankThreshold || pct >= CONFIG.percentileThreshold;
    }

    function pageKey() {
        return window.location.href.split('?')[0];
    }

    function extractJobTitle() {
        const titleEl = document.querySelector('.job-title h1') || 
                        document.querySelector('.job-title .name') ||
                        document.querySelector('h1.name') ||
                        document.querySelector('.info-primary .name h1') ||
                        document.querySelector('h1');
        return titleEl ? titleEl.textContent.trim() : '未知职位';
    }

    function extractKeywords() {
        const keywords = [];
        const text = document.body.innerText;
        const commonKeywords = ['node.js', 'nodejs', 'java', 'javascript', 'typescript', 'python', 'go', 'golang', 'vue', 'react', 'angular', 'html', 'css', 'mysql', 'redis', 'mongodb', 'docker', 'kubernetes', 'aws', 'azure', 'linux', 'git', '全栈', '前端', '后端', '移动端', 'ios', 'android', 'flutter', 'rust', 'c++', 'c#', '.net', 'php', 'ruby', 'swift', 'kotlin', 'scala', '大数据', '算法', '机器学习', '深度学习', 'ai', '人工智能'];
        
        for (const kw of commonKeywords) {
            if (text.toLowerCase().includes(kw.toLowerCase())) {
                keywords.push(kw);
            }
        }
        return keywords;
    }

    function saveData(url, data) {
        if (!data || typeof data.rank !== 'number' || typeof data.total !== 'number') return;
        if (data.rank <= 0 || data.total <= 0 || data.rank > data.total) return;
        if (data.percentile < 0 || data.percentile > 100) return;
        if (data.rank > 10000) return;

        const title = extractJobTitle();
        const keywords = extractKeywords();
        cache[url] = {
            rank: data.rank,
            total: data.total,
            percentile: data.percentile,
            ts: Date.now(),
            ok: isCompetitive(data.rank, data.percentile),
            url: url,
            title: title,
            keywords: keywords,
            hasData: true
        };
        GM_setValue('boss_comp_cache', cache);
        toast(`已缓存: 排名${data.rank}/${data.total}, 超过${data.percentile}%`);
    }

    function saveEmptyData(url, title) {
        const keywords = extractKeywords();
        cache[url] = {
            rank: null,
            total: null,
            percentile: null,
            ts: Date.now(),
            ok: false,
            url: url,
            title: title,
            keywords: keywords,
            hasData: false
        };
        GM_setValue('boss_comp_cache', cache);
    }

    // ============ 监听iframe postMessage ============
    window.addEventListener('message', (event) => {
        if (event.origin !== 'https://m.zhipin.com') return;
        if (event.data && event.data.type === 'boss-comp-data') {
            const { rank, total, percentile } = event.data;
            if (rank && total && rank > 0 && total > 0 && rank <= total) {
                const key = pageKey();
                saveData(key, {
                    rank, total,
                    percentile: percentile || +(((total - rank) / total * 100).toFixed(2))
                });
                setTimeout(() => { markJobCards(); updateToolbarStats(); }, 300);
                // 详情页采集成功后2秒自动关闭（仅自动采集打开的标签页）
                if (window.location.pathname.includes('job_detail') && window.opener) {
                    setTimeout(() => window.close(), 2000);
                }
            }
        }
    });

    // ============ XHR / Fetch 拦截 ============
    function tryExtract(resp) {
        if (!resp || typeof resp !== 'object') return null;
        function search(obj, depth) {
            if (!obj || depth > 5 || typeof obj !== 'object') return null;
            if (typeof obj.rank === 'number' && typeof obj.total === 'number' && obj.total > 0) {
                const pct = obj.percentile != null ? obj.percentile : +(((obj.total - obj.rank) / obj.total * 100).toFixed(2));
                return { rank: obj.rank, total: obj.total, percentile: pct };
            }
            if (obj.competitiveness) { const r = search(obj.competitiveness, depth + 1); if (r) return r; }
            for (const key of Object.keys(obj)) {
                if (key.toLowerCase().includes('competit') || key.toLowerCase().includes('jobrank')) {
                    const r = search(obj[key], depth + 1); if (r) return r;
                }
            }
            if (obj.zpData) { const r = search(obj.zpData, depth + 1); if (r) return r; }
            return null;
        }
        return search(resp, 0);
    }

    const _xhrOpen = XMLHttpRequest.prototype.open;
    const _xhrSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
        this._bossUrl = url;
        return _xhrOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function() {
        const xhr = this;
        const origCb = xhr.onreadystatechange;
        xhr.onreadystatechange = function() {
            if (xhr.readyState === 4 && xhr.status === 200) {
                try {
                    const resp = JSON.parse(xhr.responseText);
                    const data = tryExtract(resp);
                    if (data && window.location.pathname.includes('job_detail')) {
                        saveData(pageKey(), data);
                    }
                } catch(e) {}
            }
            if (origCb) origCb.apply(xhr, arguments);
        };
        return _xhrSend.apply(this, arguments);
    };

    const _fetch = window.fetch;
    window.fetch = function(input, init) {
        return _fetch.apply(this, arguments).then(resp => {
            const clone = resp.clone();
            clone.json().then(data => {
                const extracted = tryExtract(data);
                if (extracted && window.location.pathname.includes('job_detail')) {
                    saveData(pageKey(), extracted);
                }
            }).catch(() => {});
            return resp;
        });
    };

    // ============ 列表页标记 ============
    function markJobCards() {
        const cards = document.querySelectorAll('.job-card-wrapper, .job-list-item, [class*="job-card"], [class*="JobCard"], li[class*="job"], .search-job-result .job-card-box');

        for (const card of cards) {
            const links = card.querySelectorAll('a[href]');
            let cardUrl = null;
            for (const a of links) {
                if (a.href.includes('job_detail')) {
                    cardUrl = a.href.split('?')[0];
                    break;
                }
            }
            if (!cardUrl) continue;
            const data = cache[cardUrl];
            if (!data) continue;

            const old = card.querySelector('.boss-comp-badge');
            if (old) old.remove();

            const badge = document.createElement('div');
            badge.className = 'boss-comp-badge';
            let bg, text;
            if (!data.hasData) {
                bg = 'rgba(128,128,128,0.5)';
                text = '无数据';
            } else if (data.ok) {
                bg = '#00d6b5';
                text = `TOP${data.rank} | ${data.percentile}%`;
            } else {
                bg = 'rgba(0,0,0,0.5)';
                text = `#${data.rank}/${data.total}`;
            }
            badge.style.cssText = `position:absolute;top:6px;right:6px;padding:3px 8px;border-radius:4px;font-size:11px;font-weight:bold;color:#fff;background:${bg};z-index:10;pointer-events:none;`;
            badge.textContent = text;
            if (data.hasData) {
                badge.title = `排名${data.rank}/${data.total}，超过${data.percentile}%竞争者`;
            }

            if (getComputedStyle(card).position === 'static') card.style.position = 'relative';
            card.appendChild(badge);
        }
    }

    // ============ 采集当前页面职位URL ============
    function collectJobUrls() {
        const cards = document.querySelectorAll('.job-card-wrapper, .job-list-item, [class*="job-card"], [class*="JobCard"], li[class*="job"], .search-job-result .job-card-box');
        const result = [];
        const seen = new Set();

        for (const card of cards) {
            const links = card.querySelectorAll('a[href]');
            for (const a of links) {
                if (a.href.includes('job_detail')) {
                    const url = a.href.split('?')[0];
                    if (!seen.has(url)) {
                        seen.add(url);
                        result.push(url);
                    }
                    break;
                }
            }
        }
        return result;
    }

    // ============ 自动采集（带停止 + 自动翻页）============
    let autoState = { running: false, timer: null };

    function startAutoCollect() {
        if (autoState.running) { stopAutoCollect(); return; }

        cache = GM_getValue('boss_comp_cache', {});
        const allUrls = collectJobUrls();
        // 去重：过滤已缓存 + 数组内去重
        const seen = new Set();
        const queue = allUrls.filter(url => {
            if (cache[url] || seen.has(url)) return false;
            seen.add(url);
            return true;
        });

        if (allUrls.length === 0) {
            toast('当前页没有可采集的职位');
            return;
        }

        if (queue.length === 0) {
            toast('当前页所有职位已采集');
            return;
        }

        autoState.running = true;
        updateAutoCollectButton();

        let currentIndex = 0;
        let scrollAttempts = 0;
        const maxScrollAttempts = 5;
        const queuedUrls = new Set(queue);

        toast(`开始采集 ${queue.length} 个职位`);

        function processNext() {
            if (!autoState.running) return;

            if (currentIndex >= queue.length) {
                if (scrollAttempts >= maxScrollAttempts) {
                    finishAutoCollect();
                    return;
                }
                scrollAttempts++;
                window.scrollTo(0, document.body.scrollHeight);
                toast(`滚动加载第${scrollAttempts}次...`);

                autoState.timer = setTimeout(() => {
                    if (!autoState.running) return;
                    cache = GM_getValue('boss_comp_cache', {});
                    // 去重：过滤已缓存 + 已在队列中
                    const newUrls = collectJobUrls().filter(url => {
                        if (cache[url] || queuedUrls.has(url)) return false;
                        queuedUrls.add(url);
                        return true;
                    });

                    if (newUrls.length > 0) {
                        queue.push(...newUrls);
                        scrollAttempts = 0;
                        toast(`新加载 ${newUrls.length} 个职位`);
                    }
                    processNext();
                }, 2500);
                return;
            }

            const url = queue[currentIndex];
            currentIndex++;

            const tab = window.open(url, '_blank');

            // 轮询检查标签页是否关闭，关闭后1秒继续下一个
            function checkTabClosed() {
                if (!autoState.running) return;
                if (tab.closed) {
                    autoState.timer = setTimeout(() => {
                        cache = GM_getValue('boss_comp_cache', {});
                        updateToolbarStats();
                        markJobCards();
                        processNext();
                    }, 1000);
                } else {
                    autoState.timer = setTimeout(checkTabClosed, 500);
                }
            }

            // 3秒后开始检查（给页面加载时间）
            autoState.timer = setTimeout(checkTabClosed, 3000);
        }

        processNext();
    }

    function stopAutoCollect() {
        autoState.running = false;
        if (autoState.timer) { clearTimeout(autoState.timer); autoState.timer = null; }
        updateAutoCollectButton();
        toast('采集已停止');
    }

    function finishAutoCollect() {
        autoState.running = false;
        cache = GM_getValue('boss_comp_cache', {});
        const okCount = Object.values(cache).filter(v => v.ok).length;
        updateAutoCollectButton();
        updateToolbarStats();
        markJobCards();
        toast(`采集完成！共 ${Object.keys(cache).length} 个职位，${okCount} 个有竞争力`);
    }

    function updateAutoCollectButton() {
        const btn = document.getElementById('boss-comp-autocollect');
        if (!btn) return;
        if (autoState.running) {
            btn.textContent = '停止采集';
            btn.style.background = '#ff4444';
        } else {
            btn.textContent = '自动采集';
            btn.style.background = '#ff9800';
        }
    }

    // ============ 工具栏 ============
    function addToolbar() {
        if (document.getElementById('boss-comp-bar')) return;
        const okCount = Object.values(cache).filter(v => v.ok).length;
        const total = Object.keys(cache).length;

        const bar = document.createElement('div');
        bar.id = 'boss-comp-bar';
        bar.style.cssText = 'position:fixed;top:0;left:0;right:0;height:36px;background:#1a1a2e;color:#fff;display:flex;align-items:center;padding:0 16px;gap:12px;z-index:99998;font-size:13px;font-family:system-ui;box-shadow:0 2px 8px rgba(0,0,0,0.3);';
        bar.innerHTML = `
            <span style="font-weight:bold;color:#00d6b5;">竞争力筛选</span>
            <span id="boss-comp-stats">已分析 <b>${total}</b> 个，<b style="color:#00d6b5;">${okCount}</b> 个有竞争力</span>
            <button id="boss-comp-autocollect" style="padding:4px 14px;border:none;background:#ff9800;color:#fff;border-radius:4px;cursor:pointer;font-size:12px;font-weight:bold;">自动采集</button>
            <button id="boss-comp-viewcache" style="padding:4px 14px;border:1px solid #555;background:transparent;color:#fff;border-radius:4px;cursor:pointer;font-size:12px;">查看职位列表</button>
            <button id="boss-comp-closebar" style="padding:2px 8px;border:none;background:transparent;color:#fff;cursor:pointer;font-size:16px;margin-left:auto;">×</button>
        `;
        document.body.appendChild(bar);

        document.getElementById('boss-comp-autocollect').onclick = () => startAutoCollect();
        document.getElementById('boss-comp-viewcache').onclick = () => showCachePanel();
        document.getElementById('boss-comp-closebar').onclick = () => {
            bar.style.display = 'none';
        };
    }

    function updateToolbarStats() {
        const el = document.getElementById('boss-comp-stats');
        if (!el) return;
        const okCount = Object.values(cache).filter(v => v.ok).length;
        const total = Object.keys(cache).length;
        el.innerHTML = `已分析 <b>${total}</b> 个，<b style="color:#00d6b5;">${okCount}</b> 个有竞争力`;
    }

    // ============ 状态小绿点 ============
    let statusDot = null;
    function createStatusDot() {
        if (statusDot) return;
        statusDot = document.createElement('div');
        statusDot.style.cssText = 'position:fixed;bottom:8px;right:8px;width:12px;height:12px;border-radius:50%;background:#00d6b5;z-index:999999;box-shadow:0 0 6px #00d6b5;cursor:pointer;';
        statusDot.title = '竞争力筛选器 v5.1';
        statusDot.onclick = () => {
            const bar = document.getElementById('boss-comp-bar');
            if (bar) { bar.style.display = bar.style.display === 'none' ? 'flex' : 'none'; }
        };
        document.body.appendChild(statusDot);
    }

    // ============ 详情页 ============
    let detailTimer = null;
    function handleDetailPage() {
        const key = pageKey();
        if (cache[key]) { showPanel(cache[key]); return; }

        let attempts = 0;
        detailTimer = setInterval(() => {
            attempts++;
            // 数据已被postMessage保存，停止定时器
            if (cache[pageKey()]) {
                clearInterval(detailTimer);
                detailTimer = null;
                return;
            }
            const links = document.querySelectorAll('a');
            for (const link of links) {
                if (link.textContent.trim().includes('查看完整个人竞争力')) {
                    clearInterval(detailTimer);
                    detailTimer = null;
                    link.click();
                    toast('已点击"查看完整个人竞争力"，等待数据...');
                    return;
                }
            }
            if (attempts > 20) {
                clearInterval(detailTimer);
                detailTimer = null;
                // 没有找到竞争力分析按钮，缓存空数据
                const title = extractJobTitle();
                saveEmptyData(pageKey(), title);
                // 自动关闭（仅自动采集打开的标签页）
                if (window.opener) {
                    setTimeout(() => window.close(), 2000);
                }
            }
        }, 500);
    }

    function showPanel(data) {
        if (document.getElementById('boss-comp-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'boss-comp-panel';
        
        let color, bg, content;
        if (!data.hasData) {
            color = '#666';
            bg = '#f5f5f5';
            content = `<div style="padding:8px 12px;background:${bg};border-radius:6px;font-size:13px;color:#666;">无竞争力数据</div>`;
        } else {
            color = data.ok ? '#00d6b5' : '#ff6b6b';
            bg = data.ok ? '#e6f9f5' : '#fff0f0';
            content = `
                <div style="font-size:36px;font-weight:bold;color:${color};">${data.rank}<span style="font-size:16px;color:#999;">/${data.total}人</span></div>
                <div style="font-size:14px;color:#333;margin:8px 0;">超过 <b style="color:${color};">${data.percentile}%</b> 的竞争者</div>
                <div style="padding:8px 12px;background:${bg};border-radius:6px;font-size:13px;">${data.ok ? '有竞争力，建议沟通' : '竞争力一般'}</div>
            `;
        }
        
        panel.style.cssText = `position:fixed;top:50px;right:20px;background:#fff;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.18);padding:20px 24px;z-index:99997;min-width:260px;font-family:system-ui;border-left:4px solid ${color};`;
        panel.innerHTML = `
            <div style="font-size:13px;color:#888;margin-bottom:6px;">${data.title || '竞争力分析'}</div>
            ${content}
            <button id="boss-comp-close" style="margin-top:10px;width:100%;padding:6px;border:none;background:#f0f0f0;border-radius:6px;cursor:pointer;font-size:12px;">关闭</button>
        `;
        document.body.appendChild(panel);
        document.getElementById('boss-comp-close').onclick = () => panel.remove();
        setTimeout(() => { if (panel.parentNode) panel.remove(); }, 10000);
    }

    // ============ Toast队列 ============
    let toastQueue = [];
    let toastShowing = false;

    function toast(msg) {
        toastQueue.push(msg);
        if (!toastShowing) showNextToast();
    }

    function showNextToast() {
        if (toastQueue.length === 0) {
            toastShowing = false;
            return;
        }
        toastShowing = true;
        const msg = toastQueue.shift();

        const t = document.createElement('div');
        t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:#fff;padding:10px 24px;border-radius:8px;font-size:14px;z-index:999999;font-family:system-ui;white-space:nowrap;transition:opacity 0.3s;';
        t.textContent = msg;
        document.body.appendChild(t);

        setTimeout(() => {
            t.style.opacity = '0';
            setTimeout(() => {
                t.remove();
                showNextToast();
            }, 300);
        }, 2000);
    }

    // ============ 职位列表面板（带高级筛选）============
    function showCachePanel() {
        let panel = document.getElementById('boss-comp-cache-panel');
        if (panel) { panel.remove(); return; }

        cache = GM_getValue('boss_comp_cache', {});
        const keywords = GM_getValue('boss_comp_keywords', []);
        
        panel = document.createElement('div');
        panel.id = 'boss-comp-cache-panel';
        panel.style.cssText = 'position:fixed;top:50px;right:20px;background:#1a1a2e;color:#fff;padding:16px;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.3);z-index:999997;width:600px;max-width:90vw;font-family:system-ui;max-height:85vh;display:flex;flex-direction:column;';

        const totalAll = Object.keys(cache).length;
        const okAll = Object.values(cache).filter(v => v.ok).length;
        const notAll = totalAll - okAll;

        panel.innerHTML = `
            <div style="font-weight:bold;margin-bottom:10px;color:#00d6b5;font-size:16px;">职位列表</div>
            <div id="boss-comp-filter-btns" style="display:flex;gap:6px;margin-bottom:10px;">
                <button data-filter="all" style="flex:1;padding:6px;border:1px solid #00d6b5;background:#00d6b5;color:#fff;border-radius:4px;cursor:pointer;font-size:12px;">全部 (${totalAll})</button>
                <button data-filter="competitive" style="flex:1;padding:6px;border:1px solid #555;background:transparent;color:#aaa;border-radius:4px;cursor:pointer;font-size:12px;">有竞争力 (${okAll})</button>
                <button data-filter="not" style="flex:1;padding:6px;border:1px solid #555;background:transparent;color:#aaa;border-radius:4px;cursor:pointer;font-size:12px;">无竞争力 (${notAll})</button>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px;">
                <div style="font-size:11px;color:#aaa;">
                    <div style="margin-bottom:4px;">竞争力 ≥ (%)</div>
                    <input id="boss-comp-pct-min" type="number" placeholder="如 50" min="0" max="100" style="width:100%;padding:4px;border:1px solid #444;background:#2a2a3e;color:#fff;border-radius:3px;font-size:11px;box-sizing:border-box;">
                </div>
                <div style="font-size:11px;color:#aaa;">
                    <div style="margin-bottom:4px;">排名 ≤</div>
                    <input id="boss-comp-rank-max" type="number" placeholder="如 20" min="0" style="width:100%;padding:4px;border:1px solid #444;background:#2a2a3e;color:#fff;border-radius:3px;font-size:11px;box-sizing:border-box;">
                </div>
                <div style="font-size:11px;color:#aaa;">
                    <div style="margin-bottom:4px;">竞争人数 ≤</div>
                    <input id="boss-comp-total-max" type="number" placeholder="如 200" min="0" style="width:100%;padding:4px;border:1px solid #444;background:#2a2a3e;color:#fff;border-radius:3px;font-size:11px;box-sizing:border-box;">
                </div>
            </div>
            <div style="margin-bottom:10px;">
                <div style="font-size:11px;color:#aaa;margin-bottom:4px;">关键词筛选 (逗号分隔)</div>
                <input id="boss-comp-keywords" type="text" placeholder="node.js, java, javascript..." value="${keywords.join(', ')}" style="width:100%;padding:6px 10px;border:1px solid #444;background:#2a2a3e;color:#fff;border-radius:4px;font-size:12px;box-sizing:border-box;">
            </div>
            <div id="boss-comp-entries" style="flex:1;overflow-y:auto;font-size:12px;min-height:0;"></div>
            <div style="margin-top:12px;display:flex;gap:8px;">
                <button id="boss-comp-export" style="flex:1;padding:6px;border:1px solid #555;background:transparent;color:#fff;border-radius:4px;cursor:pointer;font-size:12px;">导出JSON</button>
                <button id="boss-comp-clearcache" style="flex:1;padding:6px;border:1px solid #ff4444;background:transparent;color:#ff4444;border-radius:4px;cursor:pointer;font-size:12px;">清除缓存</button>
            </div>
            <button id="boss-comp-closecache" style="margin-top:8px;width:100%;padding:6px;border:none;background:#f0f0f0;border-radius:6px;cursor:pointer;font-size:12px;color:#333;">关闭</button>
        `;
        document.body.appendChild(panel);

        let currentFilter = 'all';
        let filterState = { pctMin: null, rankMax: null, totalMax: null, keywords: [] };

        function applyFilters(entries) {
            let result = entries;
            
            if (currentFilter === 'competitive') {
                result = result.filter(([, v]) => v.ok);
            } else if (currentFilter === 'not') {
                result = result.filter(([, v]) => !v.ok);
            }

            if (filterState.pctMin !== null) {
                result = result.filter(([, v]) => v.hasData && v.percentile >= filterState.pctMin);
            }
            if (filterState.rankMax !== null) {
                result = result.filter(([, v]) => v.hasData && v.rank <= filterState.rankMax);
            }
            if (filterState.totalMax !== null) {
                result = result.filter(([, v]) => v.hasData && v.total <= filterState.totalMax);
            }
            if (filterState.keywords.length > 0) {
                result = result.filter(([url, v]) => {
                    const text = (v.title + ' ' + (v.keywords || []).join(' ')).toLowerCase();
                    return filterState.keywords.some(kw => text.includes(kw.toLowerCase()));
                });
            }

            return result;
        }

        function renderEntries() {
            const container = document.getElementById('boss-comp-entries');
            if (!container) return;

            let entries = Object.entries(cache).sort((a, b) => b[1].ts - a[1].ts);
            entries = applyFilters(entries);

            if (entries.length === 0) {
                container.innerHTML = '<div style="color:#888;padding:20px;text-align:center;">无匹配数据</div>';
                return;
            }

            let html = '';
            for (const [url, data] of entries) {
                const color = data.hasData ? (data.ok ? '#00d6b5' : '#888') : '#666';
                const bg = data.hasData ? (data.ok ? 'rgba(0,214,181,0.1)' : '#2a2a3e') : '#1a1a2e';
                const time = new Date(data.ts).toLocaleString('zh-CN');
                const title = data.title || '未知职位';
                const stats = data.hasData ? `${data.rank}/${data.total}人 | 超过${data.percentile}%` : '无竞争力数据';
                const kw = (data.keywords || []).map(k => `<span style="padding:2px 6px;background:#333;border-radius:3px;font-size:10px;color:#aaa;margin-right:4px;">${k}</span>`).join('');
                html += `
                    <div style="padding:10px 12px;margin-bottom:6px;background:${bg};border-radius:6px;border-left:3px solid ${color};">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <a href="${url}" target="_blank" style="font-weight:bold;color:${color};font-size:14px;text-decoration:none;" title="${url}">${title}</a>
                        <span style="color:${color};font-size:12px;">${stats}</span>
                    </div>
                    ${kw ? `<div style="margin-top:6px;">${kw}</div>` : ''}
                    <div style="margin-top:4px;display:flex;justify-content:space-between;align-items:center;">
                        <span style="color:#666;font-size:11px;">${time}</span>
                        <a href="${url}" target="_blank" style="color:#2196f3;font-size:11px;text-decoration:none;">打开 →</a>
                    </div>
                </div>`;
            }
            container.innerHTML = html;
        }

        // 筛选按钮
        document.getElementById('boss-comp-filter-btns').querySelectorAll('button').forEach(btn => {
            btn.onclick = () => {
                currentFilter = btn.dataset.filter;
                document.getElementById('boss-comp-filter-btns').querySelectorAll('button').forEach(b => {
                    b.style.border = '1px solid #555';
                    b.style.background = 'transparent';
                    b.style.color = '#aaa';
                });
                btn.style.border = '1px solid #00d6b5';
                btn.style.background = '#00d6b5';
                btn.style.color = '#fff';
                renderEntries();
            };
        });

        // 范围筛选
        const rangeInputs = {
            'pct-min': 'pctMin',
            'rank-max': 'rankMax',
            'total-max': 'totalMax'
        };
        
        Object.entries(rangeInputs).forEach(([id, key]) => {
            document.getElementById(`boss-comp-${id}`).oninput = (e) => {
                const val = e.target.value.trim();
                filterState[key] = val ? parseFloat(val) : null;
                renderEntries();
            };
        });

        // 关键词筛选
        document.getElementById('boss-comp-keywords').oninput = (e) => {
            const val = e.target.value.trim();
            filterState.keywords = val ? val.split(',').map(k => k.trim()).filter(k => k) : [];
            GM_setValue('boss_comp_keywords', filterState.keywords);
            renderEntries();
        };

        document.getElementById('boss-comp-closecache').onclick = () => panel.remove();
        document.getElementById('boss-comp-clearcache').onclick = () => {
            if (confirm('确定清除所有缓存数据？')) {
                cache = {};
                GM_setValue('boss_comp_cache', {});
                panel.remove();
                toast('缓存已清除');
                location.reload();
            }
        };
        document.getElementById('boss-comp-export').onclick = () => {
            const dataStr = JSON.stringify(cache, null, 2);
            const blob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `boss-competitiveness-cache-${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);
            toast('已导出缓存数据');
        };

        renderEntries();
    }

    // ============ SPA路由监听 + 初始化 ============
    let lastPath = '';
    function runOnRoute() {
        const path = window.location.pathname;
        if (path === lastPath) return;
        lastPath = path;

        createStatusDot();
        cleanCache();

        const isDetail = path.includes('job_detail');
        const isList = path.includes('/web/geek/job') || path.includes('/c/') || path.includes('job_list');

        if (isDetail) {
            handleDetailPage();
            addToolbar();
        }
        if (isList) {
            addToolbar();
            markJobCards();
        }
    }

    const _pushState = history.pushState;
    const _replaceState = history.replaceState;
    history.pushState = function() { _pushState.apply(this, arguments); setTimeout(runOnRoute, 500); };
    history.replaceState = function() { _replaceState.apply(this, arguments); setTimeout(runOnRoute, 500); };
    window.addEventListener('popstate', () => setTimeout(runOnRoute, 500));
    window.addEventListener('hashchange', () => setTimeout(runOnRoute, 500));

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { runOnRoute(); setTimeout(runOnRoute, 2000); });
    } else {
        runOnRoute();
        setTimeout(runOnRoute, 2000);
    }
})();
