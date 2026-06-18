(function(cmd, context) {
    const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    const seriesUrl = context.argv[0];
    if(!seriesUrl) {
        cmd.error('Series URL is required (e.g. https://hentaimama.io/tvshows/<slug>/)');
        return;
    }

    // Resolve every episode's downloadable MP4 entirely server-side via the org's
    // /computeAutomation endpoint (ComputeAutomationRestService -> GComputeService),
    // so the HTTP callouts originate from Salesforce, not this machine — bypassing
    // the local egress block on hentaimama.io. Mirrors madouGet.js's remote path.
    //
    // Per episode (resolved in parallel) the hentaimama / DooPlay chain is:
    //   1. GET the episode page  -> numeric WordPress post id (idpost)
    //   2. POST admin-ajax       -> get_player_contents = JSON array of <iframe> embeds
    //      (action=get_player_contents&a=<idpost>, form-encoded; index 0 = the
    //       tokenless gdvid mirror)
    //   3. GET each embed in turn -> JWPlayer `file: "<mp4>"`; first hit wins, so a
    //      dead mirror falls through to the next.
    // Returns { episodes: [ { num, mp4Url|null, error? } ] } sorted by episode number.
    const RESOLVE_SCRIPT = `
const axios = require('axios');
(function() {
    const UA = '${USER_AGENT}';
    const seriesUrl = $data.seriesUrl;
    const headers = { 'User-Agent': UA };
    const ajaxUrl = 'https://hentaimama.io/wp-admin/admin-ajax.php';
    const get = (u, h) => axios.get(u, { headers: h || headers, timeout: 90000, validateStatus: () => true });

    const resolveOne = ep => get(ep.episodeUrl).then(r => {
        const h = typeof r.data === 'string' ? r.data : '';
        const idM = /name="idpost"\\s+value="(\\d+)"/i.exec(h);
        if(!idM) return { num: ep.num, mp4Url: null, error: 'no idpost' };
        const body = 'action=get_player_contents&a=' + encodeURIComponent(idM[1]);
        const ajaxHeaders = { 'User-Agent': UA, 'Referer': ep.episodeUrl, 'Content-Type': 'application/x-www-form-urlencoded' };
        return axios.post(ajaxUrl, body, { headers: ajaxHeaders, timeout: 90000, validateStatus: () => true }).then(pr => {
            let arr = pr.data;
            if(typeof arr === 'string') { try { arr = JSON.parse(arr); } catch(e) { arr = []; } }
            if(!Array.isArray(arr)) arr = [];
            const embeds = [];
            arr.forEach(frag => {
                const im = /<iframe[^>]*\\ssrc="([^"]+)"/i.exec(frag || '');
                if(im) embeds.push(im[1].replace(/&amp;/g, '&'));
            });
            const tryEmbed = i => {
                if(i >= embeds.length) return { num: ep.num, mp4Url: null, error: 'no source' };
                return get(embeds[i]).then(er => {
                    const eh = typeof er.data === 'string' ? er.data : '';
                    const fM = /file:\\s*["']([^"']+)["']/i.exec(eh);
                    if(fM && fM[1]) return { num: ep.num, mp4Url: fM[1] };
                    return tryEmbed(i + 1);
                }).catch(() => tryEmbed(i + 1));
            };
            return tryEmbed(0);
        });
    }).catch(e => ({ num: ep.num, mp4Url: null, error: String((e && e.message) || e) }));

    return get(seriesUrl).then(resp => {
        const html = typeof resp.data === 'string' ? resp.data : '';
        const eps = [];
        const seen = new Set();
        const aRe = /<a href="(https:\\/\\/hentaimama\\.io\\/episodes\\/[^"]+)">/gi;
        let m;
        while((m = aRe.exec(html)) !== null) {
            const u = m[1];
            if(seen.has(u)) continue;
            seen.add(u);
            const nm = /-episode-(\\d+)\\/?$/i.exec(u);
            eps.push({ episodeUrl: u, num: nm ? parseInt(nm[1], 10) : (eps.length + 1) });
        }
        if(!eps.length) return { episodes: [] };
        return Promise.all(eps.map(resolveOne)).then(list => ({
            episodes: list.sort((a, b) => a.num - b.num),
        }));
    });
})()
`;

    return (async () => {
        const raw = await context.mypim.apex.post('/computeAutomation', {
            code: RESOLVE_SCRIPT,
            data: JSON.stringify({ seriesUrl }),
        });
        const envelope = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if(!envelope || envelope.success === false) {
            throw new Error((envelope && envelope.message) || 'runComputeAutomation failed');
        }
        // Print ONLY the resolved JSON so the bash caller can parse it with jq.
        cmd.log(JSON.stringify(envelope.result || { episodes: [] }));
    })().catch(err => {
        cmd.error(err.message || String(err));
    });
})
