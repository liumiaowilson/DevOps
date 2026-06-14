(function(cmd, context) {
    const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    const url = context.argv[0];
    const outFile = context.argv[1];

    if(!url) {
        cmd.error('view_video URL is required');
        return;
    }
    if(!outFile) {
        cmd.error('Output file path is required');
        return;
    }

    // Resolve the HLS stream server-side via the org's /computeAutomation REST
    // resource so the callout originates from Salesforce (bypassing the local
    // network egress block that keeps pornhub.com from loading directly). This is
    // the bash-side twin of mypimPHubBrowser's FETCH_STREAM_SCRIPT: pornhub embeds
    // the player config as an inline `var flashvars_<viewkey> = { ...JSON... }`
    // blob on the /view_video.php page, gated behind age-disclaimer cookies. We
    // parse the first balanced {...} after that assignment, read mediaDefinitions,
    // and prefer the per-quality .m3u8 HLS entry (480 > 360 > 720 > first). When
    // the page only lists a get_media endpoint instead of direct .m3u8 URLs we
    // follow that one hop and apply the same preference (mirrors madou's fallback).
    const RESOLVE_SCRIPT = `
const axios = require('axios');
(function() {
    const detailUrl = $data.detailUrl || '';
    if(!detailUrl) return { error: 'missing detailUrl' };
    const headers = {
        'User-Agent': $data.ua,
        'Cookie': 'accessAgeDisclaimerPH=1; accessAgeDisclaimerUK=1; age_verified=1; platform=pc',
        'Referer': 'https://www.pornhub.com/',
    };
    // Pull the first balanced {...} object after "var flashvars_xxx =".
    const extractFlashvars = html => {
        const m = /var\\s+flashvars_\\w+\\s*=\\s*\\{/.exec(html);
        if(!m) return null;
        let i = m.index + m[0].length - 1; // points at the opening brace
        let depth = 0, inStr = false, quote = '', esc = false;
        for(let j = i; j < html.length; j++) {
            const c = html[j];
            if(inStr) {
                if(esc) esc = false;
                else if(c === '\\\\') esc = true;
                else if(c === quote) inStr = false;
                continue;
            }
            if(c === '"' || c === "'") { inStr = true; quote = c; continue; }
            if(c === '{') depth++;
            else if(c === '}') {
                depth--;
                if(depth === 0) {
                    const raw = html.slice(i, j + 1);
                    try { return JSON.parse(raw); }
                    catch(e) { return null; }
                }
            }
        }
        return null;
    };
    const isHls = d => d && typeof d.format === 'string' && d.format.toLowerCase() === 'hls';
    const cleanUrl = u => (u || '').replace(/\\\\\\//g, '/');
    // Quality preference: 480p first, then 360p, then 720p, then the page's first
    // entry. pornhub serves a separate single-rendition HLS playlist per quality,
    // so choosing the videoUrl fixes the playback resolution (we cap at 480p anyway).
    const PREF = ['480', '360', '720'];
    const qualityOf = d => {
        const m = /(\\d{3,4})[pP]/.exec(d.videoUrl || '');
        return m ? m[1] : String(d.quality == null ? '' : d.quality);
    };
    const pickPreferred = list => {
        for(let i = 0; i < PREF.length; i++) {
            const hit = list.find(d => qualityOf(d) === PREF[i]);
            if(hit) return hit;
        }
        return list[0] || null;
    };
    return axios.get(detailUrl, { headers, timeout: 90000, validateStatus: () => true }).then(resp => {
        const html = typeof resp.data === 'string' ? resp.data : '';
        const fv = extractFlashvars(html);
        if(!fv) return { error: 'could not parse flashvars from video page (status ' + resp.status + ')' };
        const poster = cleanUrl(fv.image_url || fv.thumb || '') || null;
        const defs = Array.isArray(fv.mediaDefinitions) ? fv.mediaDefinitions : [];
        if(!defs.length) return { error: 'no mediaDefinitions in flashvars' };
        // Prefer the per-quality hls .m3u8 entries listed inline.
        const directs = defs.filter(d => isHls(d) && /\\.m3u8(\\?|$)/i.test(d.videoUrl || ''));
        if(directs.length) {
            const chosen = pickPreferred(directs);
            return { m3u8Url: cleanUrl(chosen.videoUrl), poster, quality: qualityOf(chosen) };
        }
        // Otherwise follow the hls (or any) entry's get_media endpoint, which
        // returns a JSON array of the real format URLs, and re-apply the preference.
        const hop = defs.find(d => isHls(d) && d.videoUrl) || defs.find(d => d.videoUrl);
        if(!hop) return { error: 'no resolvable mediaDefinitions entry' };
        const mediaUrl = cleanUrl(hop.videoUrl);
        return axios.get(mediaUrl, { headers, timeout: 90000, validateStatus: () => true }).then(mr => {
            let arr = mr.data;
            if(typeof arr === 'string') { try { arr = JSON.parse(arr); } catch(e) { arr = null; } }
            if(!Array.isArray(arr) || !arr.length) return { error: 'get_media returned no formats' };
            const hlsArr = arr.filter(isHls);
            const chosen = pickPreferred(hlsArr.length ? hlsArr : arr);
            if(!chosen || !chosen.videoUrl) return { error: 'no hls url in get_media response' };
            return { m3u8Url: cleanUrl(chosen.videoUrl), poster, quality: qualityOf(chosen) };
        });
    });
})()
`;

    return (async () => {
        const raw = await context.mypim.apex.post('/computeAutomation', {
            code: RESOLVE_SCRIPT,
            data: JSON.stringify({ detailUrl: url, ua: USER_AGENT }),
        });
        const envelope = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if(!envelope || envelope.success === false) {
            throw new Error((envelope && envelope.message) || 'runComputeAutomation failed');
        }
        const result = envelope.result || {};
        // Write the resolver's JSON ({m3u8Url, poster, quality} or {error}) to the
        // out file so the bash caller can read it with jq.
        await context.fs.writeFile(outFile, JSON.stringify(result), 'utf8');
        // Print 'ok' to stdout on success, or the resolver's error so the caller
        // can surface why the stream couldn't be resolved.
        if(result && result.m3u8Url) cmd.log('ok');
        else cmd.error((result && result.error) || 'could not resolve stream');
    })().catch(err => {
        cmd.error(err.message || String(err));
    });
})
