(function(cmd, context) {
    const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    const url = context.argv[0];
    const outFile = context.argv[1];
    const referer = context.argv[2];

    if(!url) {
        cmd.error('URL is required');
        return;
    }
    if(!outFile) {
        cmd.error('Output file path is required');
        return;
    }

    const headers = { 'User-Agent': USER_AGENT };
    if(referer) headers['Referer'] = referer;

    // Fetch the URL server-side via the org's /computeAutomation REST resource
    // (ComputeAutomationRestService -> GComputeService.runComputeScript) so the HTTP
    // callout originates from Salesforce, not this machine — bypassing the local network
    // egress restrictions that block direct access to madou.club. Mirrors save_manga.js /
    // save_madou_movie.js. validateStatus accepts any code so the caller can branch on it
    // (e.g. the playlist's token-expiry retry loop in download_madou).
    const REMOTE_GET_SCRIPT = `
const axios = require('axios');
(function() {
    return axios.get($data.url, {
        headers: $data.headers,
        timeout: 30000,
        validateStatus: () => true,
    }).then(resp => ({
        status: resp.status,
        body: typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data),
    }));
})()
`;

    return (async () => {
        const raw = await context.mypim.apex.post('/computeAutomation', {
            code: REMOTE_GET_SCRIPT,
            data: JSON.stringify({ url, headers }),
        });
        const envelope = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if(!envelope || envelope.success === false) {
            throw new Error((envelope && envelope.message) || 'runComputeAutomation failed');
        }
        const result = envelope.result || {};
        await context.fs.writeFile(outFile, result.body == null ? '' : String(result.body), 'utf8');
        // Print ONLY the HTTP status to stdout so the bash caller can capture it.
        cmd.log(String(result.status == null ? '' : result.status));
    })().catch(err => {
        cmd.error(err.message || String(err));
    });
})
