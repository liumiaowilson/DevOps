(function(cmd, context) {
    const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    const PCLOUD_ROOT = '/MyPIM/Manga';
    const MAX_UPLOAD_ATTEMPTS = 3;
    const MAX_DOWNLOAD_ATTEMPTS = 3;
    const RETRY_DELAY_MS = 3000;

    // Shared e-hentai request headers, reused by both the local axios path and the
    // remote compute-automation path so the two modes hit e-hentai identically.
    const EH_HEADERS = { 'User-Agent': USER_AGENT, 'Cookie': 'nw=1; sl=dm_2' };
    const IMG_HEADERS = { 'User-Agent': USER_AGENT, 'Referer': 'https://e-hentai.org/' };

    // 'remote' as the second script arg routes e-hentai requests through the compute
    // /automation endpoint (which runs from a non-geo-blocked location), mirroring how
    // the mypimEHentaiBrowser LWC fetches e-hentai. pCloud calls always stay local.
    const REMOTE = context.argv[1] === 'remote';

    const galleryUrl = context.argv[0];
    if(!galleryUrl) {
        cmd.error('Gallery URL is required');
        return;
    }
    const urlMatch = /\/g\/(\d+)\/([a-f0-9]+)/.exec(galleryUrl);
    if(!urlMatch) {
        cmd.error('Invalid gallery URL: ' + galleryUrl);
        return;
    }
    const gid = urlMatch[1];
    const token = urlMatch[2];

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    const sanitize = name => (name || '').replace(/[/\\:*?"<>|]/g, '_').replace(/[\s#]+/g, '_').trim();

    // Item__c.Name is the standard Name field, capped at 80 chars by Salesforce.
    // pCloud folder names and File_1__c paths have no such limit, so truncation
    // is applied ONLY when persisting to the parent Manga record's Name.
    const truncateForRecordName = name => name.length > 80 ? name.substring(0, 80).trim() : name;

    const decode = s => (s || '')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&#039;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();

    const extractSuffix = url => {
        const m = /\.([a-z0-9]+)(?:\?|$)/i.exec(url || '');
        return (m ? m[1] : 'jpg').toLowerCase();
    };

    // Compute config (/Compute/BaseUrl, /Compute/Token) lives in Config_Item__c, the
    // same store ConfigManager reads server-side. Queried lazily and cached so a
    // fully-local run never touches it.
    let _computeConfig = null;
    const getComputeConfig = async () => {
        if(_computeConfig) return _computeConfig;
        const r = await context.mypim.query(
            "SELECT Path__c, Value__c FROM Config_Item__c WHERE Path__c IN ('/Compute/BaseUrl', '/Compute/Token')"
        );
        const m = {};
        for(const rec of r.records) m[rec.Path__c] = rec.Value__c;
        if(!m['/Compute/BaseUrl'] || !m['/Compute/Token']) {
            throw new Error('Compute config missing: /Compute/BaseUrl and /Compute/Token must exist in Config_Item__c');
        }
        _computeConfig = { baseUrl: m['/Compute/BaseUrl'].replace(/\/$/, ''), token: m['/Compute/Token'] };
        return _computeConfig;
    };

    // POST {token, data, code} to {baseUrl}/automation, where the remote VM runs `code`
    // (with axios + $data available) and returns a {success, result|message} envelope —
    // the same shape GComputeService.runComputeScript / the LWC's runAutomation use.
    const runAutomation = async (code, data) => {
        const { baseUrl, token } = await getComputeConfig();
        const resp = await context.axios.post(baseUrl + '/automation', {
            token,
            data: JSON.stringify(data),
            code,
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 120000,
        });
        const envelope = typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data;
        if(!envelope || envelope.success === false) {
            throw new Error((envelope && envelope.message) || 'runComputeAutomation failed');
        }
        return envelope.result;
    };

    // Remote GET for HTML pages — returns the response body as a string. Parsing of that
    // HTML still happens locally in node, so only the network hop is offloaded.
    const REMOTE_GET_SCRIPT = `
const axios = require('axios');
(function() {
    return axios.get($data.url, {
        headers: $data.headers,
        timeout: 30000,
        validateStatus: status => status === 200 || status === 451,
    }).then(resp => (typeof resp.data === 'string' ? resp.data : ''));
})()
`;

    // Remote GET for image bytes — base64-encodes the buffer to cross the JSON envelope.
    const REMOTE_IMAGE_SCRIPT = `
const axios = require('axios');
(function() {
    return axios.get($data.url, {
        responseType: 'arraybuffer',
        headers: $data.headers,
        timeout: 60000,
    }).then(resp => ({
        data: Buffer.from(resp.data).toString('base64'),
        contentType: resp.headers['content-type'] || 'application/octet-stream',
    }));
})()
`;

    // Fetch an e-hentai HTML page, returning the body string. Local axios by default;
    // remote compute automation when invoked with the 'remote' parameter.
    const ehGetHtml = async url => {
        if(REMOTE) {
            return runAutomation(REMOTE_GET_SCRIPT, { url, headers: EH_HEADERS });
        }
        const resp = await context.axios.get(url, {
            headers: EH_HEADERS,
            timeout: 30000,
            // e-hentai returns 451 (with the full HTML body) for AU IPs because of the
            // eSafety age-verification block. The body still contains the gallery markup.
            validateStatus: status => status === 200 || status === 451,
        });
        return typeof resp.data === 'string' ? resp.data : '';
    };

    const fetchGalleryTitle = async () => {
        const url = 'https://e-hentai.org/g/' + gid + '/' + token + '/';
        const html = await ehGetHtml(url);
        const tM = /<h1[^>]+id="gn"[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
        return decode(tM && tM[1]);
    };

    const fetchAllPageTokens = async () => {
        const base = 'https://e-hentai.org/g/' + gid + '/' + token + '/';
        const all = new Map();
        let p = 0;
        while(true) {
            const html = await ehGetHtml(base + '?p=' + p);
            const gdtIdx = html.indexOf('id="gdt"');
            if(gdtIdx === -1) break;
            const area = html.substring(gdtIdx);
            const re = /<a[^>]+href="https?:\/\/e-hentai\.org\/s\/([a-f0-9]+)\/(\d+)-(\d+)"/g;
            let mm;
            let added = 0;
            while((mm = re.exec(area)) !== null) {
                const n = parseInt(mm[3], 10);
                if(all.has(n)) continue;
                all.set(n, { pagetoken: mm[1], gid: mm[2], n });
                added++;
            }
            if(added === 0) break;
            p++;
        }
        return Array.from(all.values()).sort((a, b) => a.n - b.n);
    };

    const fetchPageImgSrc = async (pagetoken, n) => {
        const url = 'https://e-hentai.org/s/' + pagetoken + '/' + gid + '-' + n;
        const html = await ehGetHtml(url);
        const imgM = /<img[^>]+id="img"[^>]+src="([^"]+)"/i.exec(html);
        return imgM ? imgM[1] : null;
    };

    const downloadImage = async url => {
        if(REMOTE) {
            const result = await runAutomation(REMOTE_IMAGE_SCRIPT, { url, headers: IMG_HEADERS });
            return {
                buffer: Buffer.from(result.data, 'base64'),
                contentType: result.contentType || 'application/octet-stream',
            };
        }
        const resp = await context.axios.get(url, {
            responseType: 'arraybuffer',
            headers: IMG_HEADERS,
            timeout: 60000,
        });
        return {
            buffer: Buffer.from(resp.data),
            contentType: resp.headers['content-type'] || 'application/octet-stream',
        };
    };

    const getPCloudToken = async () => {
        const logFileName = 'pcloudtoken-' + Date.now() + '.json';
        const apexCode = [
            "String token = GPCloudService.doLogin('__default__');",
            "insert new ContentVersion(Title = '" + logFileName + "', PathOnClient = '" + logFileName + "', VersionData = Blob.valueOf(JSON.serialize(token)));",
        ].join('\n');

        const exec = new context.ExecuteService(context.mypim);
        const result = await exec.executeAnonymous({ apexCode });
        if(!result.success) {
            const messages = (result.diagnostic || []).map(d =>
                result.compiled
                    ? 'Line ' + d.lineNumber + ': ' + d.exceptionMessage
                    : 'Line ' + d.lineNumber + ': ' + d.compileProblem
            ).join('; ');
            throw new Error('pCloud login failed: ' + messages);
        }

        const cvData = await context.mypim.query(
            "SELECT Id, ContentDocumentId FROM ContentVersion WHERE Title = '" + logFileName + "' AND IsLatest = true"
        );
        if(!cvData.records.length) {
            throw new Error('pCloud token ContentVersion not found');
        }

        const cvId = cvData.records[0].Id;
        const cdId = cvData.records[0].ContentDocumentId;

        try {
            const versionData = await context.mypim.request('/sobjects/ContentVersion/' + cvId + '/VersionData');
            const accessToken = JSON.parse(versionData);
            if(!accessToken) {
                throw new Error('pCloud token is empty');
            }
            return accessToken;
        }
        finally {
            await context.mypim.sobject('ContentDocument').delete(cdId);
        }
    };

    const pcloudCreateFolder = async (path, accessToken) => {
        const resp = await context.axios.get('https://api.pcloud.com/createfolder', {
            params: { access_token: accessToken, path },
        });
        const data = resp.data;
        if(data && data.result === 2004) {
            return { exists: true };
        }
        if(!data || data.result !== 0) {
            throw new Error((data && data.error) || ('pCloud createfolder error ' + (data && data.result)));
        }
        return data;
    };

    const pcloudUploadFile = async (folderPath, filename, buffer, contentType, accessToken) => {
        const formDataMod = await context.require('form-data');
        const FormData = formDataMod.default || formDataMod;

        for(let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt++) {
            try {
                const form = new FormData();
                form.append('fileList', buffer, { filename, contentType });
                const resp = await context.axios.post('https://api.pcloud.com/uploadfile', form, {
                    params: {
                        access_token: accessToken,
                        path: folderPath.replace(/\/$/, ''),
                        filename,
                        renameifexists: 0,
                    },
                    headers: form.getHeaders(),
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity,
                    timeout: 120000,
                });
                const data = resp.data;
                if(!data || data.result !== 0) {
                    throw new Error((data && data.error) || ('pCloud upload error ' + (data && data.result)));
                }
                return data;
            }
            catch(err) {
                if(attempt >= MAX_UPLOAD_ATTEMPTS) throw err;
                cmd.log('Upload failed for ' + filename + ' (attempt ' + attempt + '/' + MAX_UPLOAD_ATTEMPTS + '): ' + err.message + '; retrying in ' + RETRY_DELAY_MS + 'ms');
                await sleep(RETRY_DELAY_MS);
            }
        }
    };

    return (async () => {
        cmd.log('Gallery: ' + gid + '/' + token);

        context.ux.action.start('Fetching gallery title');
        const title = await fetchGalleryTitle();
        context.ux.action.stop();
        if(!title) throw new Error('Gallery title not found — invalid URL or gallery is gone');
        const name = sanitize(title);
        if(!name) throw new Error('Title empty after sanitization');
        cmd.log('Title: ' + title);
        const folderPath = PCLOUD_ROOT + '/' + name;

        context.ux.action.start('Fetching page list');
        const pages = await fetchAllPageTokens();
        context.ux.action.stop();
        if(!pages.length) throw new Error('No pages found');
        cmd.log('Found ' + pages.length + ' pages');

        context.ux.action.start('Logging into pCloud');
        const accessToken = await getPCloudToken();
        context.ux.action.stop();

        cmd.log('Creating folder ' + folderPath);
        const folderResult = await pcloudCreateFolder(folderPath, accessToken);
        if(folderResult && folderResult.exists) {
            cmd.warn('Manga folder already exists at ' + folderPath + ' — continuing');
        }

        const padWidth = String(pages.length).length;
        const completed = [];
        const skipped = [];
        for(let i = 0; i < pages.length; i++) {
            const p = pages[i];
            const padded = String(i + 1).padStart(padWidth, '0');
            context.ux.action.start('Page ' + (i + 1) + '/' + pages.length);

            let download = null;
            for(let attempt = 1; attempt <= MAX_DOWNLOAD_ATTEMPTS; attempt++) {
                try {
                    const imgSrc = await fetchPageImgSrc(p.pagetoken, p.n);
                    if(!imgSrc) throw new Error('No image src found');
                    const { buffer, contentType } = await downloadImage(imgSrc);
                    download = { buffer, contentType, suffix: extractSuffix(imgSrc) };
                    break;
                }
                catch(err) {
                    if(attempt >= MAX_DOWNLOAD_ATTEMPTS) {
                        context.ux.action.stop('skipped');
                        cmd.warn('Download failed for page ' + (i + 1) + ' after ' + MAX_DOWNLOAD_ATTEMPTS + ' attempts: ' + err.message + '; skipping');
                        skipped.push(i + 1);
                        break;
                    }
                    cmd.log('Download failed for page ' + (i + 1) + ' (attempt ' + attempt + '/' + MAX_DOWNLOAD_ATTEMPTS + '): ' + err.message + '; retrying in ' + RETRY_DELAY_MS + 'ms');
                    await sleep(RETRY_DELAY_MS);
                }
            }
            if(!download) continue;

            const filename = padded + '.' + download.suffix;
            const uploadData = await pcloudUploadFile(folderPath, filename, download.buffer, download.contentType, accessToken);
            const uploaded = uploadData && uploadData.metadata && uploadData.metadata[0];
            if(!uploaded) throw new Error('pCloud upload returned no metadata for page ' + (i + 1));
            const itemPath = uploaded.path || (folderPath + '/' + uploaded.name);
            completed.push({ itemName: padded, itemPath });
            context.ux.action.stop();
        }
        if(skipped.length) {
            cmd.warn('Skipped ' + skipped.length + ' page(s) that failed to download: ' + skipped.join(', '));
        }

        context.ux.action.start('Creating Manga record');
        const parent = await context.mypim.sobject('Item__c').create({
            Name: truncateForRecordName(name),
            Type__c: 'Manga',
        });
        const parentId = parent.id || parent.Id;
        if(!parentId) throw new Error('Failed to create Manga record');
        context.ux.action.stop();

        context.ux.action.start('Creating ' + completed.length + ' MangaItem children');
        for(let i = 0; i < completed.length; i += 200) {
            const batch = completed.slice(i, i + 200).map(c => ({
                Name: c.itemName,
                Type__c: 'MangaItem',
                Parent__c: parentId,
                File_1__c: c.itemPath,
            }));
            await context.mypim.sobject('Item__c').create(batch);
        }
        context.ux.action.stop();

        cmd.logSuccess('Saved "' + name + '" — pCloud ' + folderPath + ', parent ' + parentId + ', ' + completed.length + ' pages');
    })().catch(err => {
        context.ux.action.stop();
        let msg = err.message || String(err);
        if(!REMOTE) {
            msg += '\n(If e-hentai is unreachable/geo-blocked, re-run with the "remote" parameter to route e-hentai requests through compute automation.)';
        }
        cmd.error(msg);
    });
})
