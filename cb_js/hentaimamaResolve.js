(function(cmd, context) {
    const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    const seriesUrl = context.argv[0];
    if(!seriesUrl) {
        cmd.error('Series URL is required (e.g. https://hentaimama.io/tvshows/<slug>/)');
        return;
    }
    // 'remote' routes the hentaimama page / admin-ajax / embed fetches through the
    // org's /computeAutomation endpoint (which runs from a non-geo-blocked location),
    // mirroring madouGet.js / save_madou_movie.js. Direct (local axios) by default.
    const REMOTE = context.argv[1] === 'remote';

    // Run a script server-side via the org's /computeAutomation REST resource so the
    // HTTP callout originates from Salesforce, not this machine. Returns `result`.
    const runAutomation = async (code, data) => {
        const raw = await context.mypim.apex.post('/computeAutomation', {
            code,
            data: JSON.stringify(data),
        });
        const envelope = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if(!envelope || envelope.success === false) {
            throw new Error((envelope && envelope.message) || 'runComputeAutomation failed');
        }
        return envelope.result;
    };

    // Remote GET / POST scripts — no regex inside, so no escaping needed. They return
    // the response body as a string (the orchestration below parses it locally).
    const REMOTE_GET_SCRIPT = `
const axios = require('axios');
(function() {
    return axios.get($data.url, { headers: $data.headers, timeout: 60000, validateStatus: () => true })
        .then(r => (typeof r.data === 'string' ? r.data : JSON.stringify(r.data)));
})()
`;
    const REMOTE_POST_SCRIPT = `
const axios = require('axios');
(function() {
    return axios.post($data.url, $data.body, { headers: $data.headers, timeout: 60000, validateStatus: () => true })
        .then(r => (typeof r.data === 'string' ? r.data : JSON.stringify(r.data)));
})()
`;

    // Fetch helpers route direct (local axios) or remote (compute automation) based on
    // the flag; both return the response body as a string.
    const httpGet = async (url, headers) => {
        if(REMOTE) return runAutomation(REMOTE_GET_SCRIPT, { url, headers });
        const r = await context.axios.get(url, { headers, timeout: 60000, validateStatus: () => true });
        return typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
    };
    const httpPostForm = async (url, body, headers) => {
        if(REMOTE) return runAutomation(REMOTE_POST_SCRIPT, { url, body, headers });
        const r = await context.axios.post(url, body, { headers, timeout: 60000, validateStatus: () => true });
        return typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
    };

    const headers = { 'User-Agent': USER_AGENT };
    const ajaxUrl = 'https://hentaimama.io/wp-admin/admin-ajax.php';

    // Per episode (DooPlay chain): GET episode -> idpost; POST admin-ajax
    // get_player_contents -> JSON array of <iframe> embeds (mirrors in priority
    // order); GET each embed -> JWPlayer `file: "<url>"`. Prefer a progressive
    // .mp4 (the only thing a plain curl can download) and keep any .m3u8 HLS
    // playlist only as a last-resort fallback.
    const resolveOne = async ep => {
        try {
            const epHtml = await httpGet(ep.episodeUrl, headers);
            const idM = /name="idpost"\s+value="(\d+)"/i.exec(epHtml);
            if(!idM) return { num: ep.num, mp4Url: null, error: 'no idpost' };
            const body = 'action=get_player_contents&a=' + encodeURIComponent(idM[1]);
            const ajaxHeaders = { 'User-Agent': USER_AGENT, 'Referer': ep.episodeUrl, 'Content-Type': 'application/x-www-form-urlencoded' };
            const arrRaw = await httpPostForm(ajaxUrl, body, ajaxHeaders);
            let arr;
            try { arr = JSON.parse(arrRaw); } catch(e) { arr = []; }
            if(!Array.isArray(arr)) arr = [];
            const embeds = [];
            arr.forEach(frag => {
                const im = /<iframe[^>]*\ssrc="([^"]+)"/i.exec(frag || '');
                if(im) embeds.push(im[1].replace(/&amp;/g, '&'));
            });
            // fallback holds the first .m3u8 seen so an HLS-only title still
            // resolves, but an .mp4 from any embed always wins.
            let fallback = null;
            for(let i = 0; i < embeds.length; i++) {
                try {
                    const eh = await httpGet(embeds[i], headers);
                    const fM = /file:\s*["']([^"']+)["']/i.exec(eh);
                    if(fM && fM[1]) {
                        const u = fM[1];
                        if(/\.m3u8(\?|$)/i.test(u)) { if(!fallback) fallback = u; continue; }
                        return { num: ep.num, mp4Url: u };
                    }
                }
                catch(e) { /* try next mirror */ }
            }
            if(fallback) return { num: ep.num, mp4Url: fallback };
            return { num: ep.num, mp4Url: null, error: 'no source' };
        }
        catch(e) {
            return { num: ep.num, mp4Url: null, error: String((e && e.message) || e) };
        }
    };

    return (async () => {
        const html = await httpGet(seriesUrl, headers);
        const eps = [];
        const seen = new Set();
        const aRe = /<a href="(https:\/\/hentaimama\.io\/episodes\/[^"]+)">/gi;
        let m;
        while((m = aRe.exec(html)) !== null) {
            const u = m[1];
            if(seen.has(u)) continue;
            seen.add(u);
            const nm = /-episode-(\d+)\/?$/i.exec(u);
            eps.push({ episodeUrl: u, num: nm ? parseInt(nm[1], 10) : (eps.length + 1) });
        }
        if(!eps.length) {
            cmd.log(JSON.stringify({ episodes: [] }));
            return;
        }
        const list = await Promise.all(eps.map(resolveOne));
        list.sort((a, b) => a.num - b.num);
        // Print ONLY the resolved JSON so the bash caller can parse it with jq.
        cmd.log(JSON.stringify({ episodes: list }));
    })().catch(err => {
        cmd.error(err.message || String(err));
    });
})
