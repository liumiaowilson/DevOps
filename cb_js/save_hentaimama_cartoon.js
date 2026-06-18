(function(cmd, context) {
    const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    const PCLOUD_IMAGE_ROOT = '/MyPIM/Cartoon_Image';
    const CARTOON_ROOT = '/MyPIM/Cartoon';
    const HENTAIMAMA_BASE = 'https://hentaimama.io';
    const MAX_UPLOAD_ATTEMPTS = 3;
    const MAX_DB_ATTEMPTS = 5;
    const RETRY_DELAY_MS = 3000;

    const filePath = context.argv[0];
    if(!filePath) {
        cmd.error('Cartoon file path is required');
        return;
    }

    // 'remote' as the second script arg routes hentaimama.io requests through the
    // compute /automation endpoint (which runs from a non-geo-blocked location),
    // mirroring save_madou_movie.js. pCloud calls and the local python step stay local.
    const REMOTE = context.argv[1] === 'remote';

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    const isHangup = err => {
        if(!err) return false;
        if(err.code === 'ECONNRESET' || err.code === 'EPIPE' || err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') return true;
        const msg = ((err.message || '') + '').toLowerCase();
        return msg.includes('socket hang up') || msg.includes('econnreset') || msg.includes('timeout') || msg.includes('network error');
    };

    // Retry a mypim (Salesforce) connection operation on transient connection drops.
    const withRetry = async (label, fn) => {
        for(let attempt = 1; attempt <= MAX_DB_ATTEMPTS; attempt++) {
            try {
                return await fn();
            }
            catch(err) {
                if(attempt >= MAX_DB_ATTEMPTS || !isHangup(err)) throw err;
                cmd.log(label + ' failed (attempt ' + attempt + '/' + MAX_DB_ATTEMPTS + '): ' + (err.code || err.message) + '; retrying in ' + RETRY_DELAY_MS + 'ms');
                await sleep(RETRY_DELAY_MS);
            }
        }
    };

    // Item__c.Name is the standard Name field, capped at 80 chars by Salesforce.
    const truncateForRecordName = name => name.length > 80 ? name.substring(0, 80).trim() : name;

    // Escape a value for use inside a single-quoted SOQL string literal.
    const soqlEscape = value => String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    // Decode the small set of HTML entities that appear in hentaimama synopses.
    const decodeEntities = s => (s || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&#0?39;/g, "'")
        .replace(/&#8217;/g, "'")
        .replace(/&#8216;/g, "'")
        .replace(/&#8220;/g, '"')
        .replace(/&#8221;/g, '"')
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&ndash;/g, '-')
        .replace(/&hellip;/g, '...')
        .replace(/\s+/g, ' ')
        .trim();

    // ---- Remote fetch helpers (mirror save_madou_movie.js) ----

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

    const REMOTE_GET_SCRIPT = `
const axios = require('axios');
(function() {
    return axios.get($data.url, {
        headers: $data.headers,
        timeout: 30000,
    }).then(resp => (typeof resp.data === 'string' ? resp.data : ''));
})()
`;

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

    const hmGetHtml = async (url, headers, useRemote) => {
        if(useRemote) {
            return runAutomation(REMOTE_GET_SCRIPT, { url, headers });
        }
        const resp = await context.axios.get(url, { headers, timeout: 30000 });
        return typeof resp.data === 'string' ? resp.data : '';
    };

    const hmDownload = async (url, headers, useRemote) => {
        if(useRemote) {
            const result = await runAutomation(REMOTE_IMAGE_SCRIPT, { url, headers });
            return {
                buffer: Buffer.from(result.data, 'base64'),
                contentType: result.contentType || 'image/jpeg',
            };
        }
        const resp = await context.axios.get(url, {
            responseType: 'arraybuffer',
            headers,
            timeout: 60000,
        });
        return {
            buffer: Buffer.from(resp.data),
            contentType: resp.headers['content-type'] || 'image/jpeg',
        };
    };

    // ---- pCloud helpers (mirror save_madou_movie.js) ----

    const getPCloudToken = async () => {
        const logFileName = 'pcloudtoken-' + Date.now() + '.json';
        const apexCode = [
            "String token = GPCloudService.doLogin('__default__');",
            "insert new ContentVersion(Title = '" + logFileName + "', PathOnClient = '" + logFileName + "', VersionData = Blob.valueOf(JSON.serialize(token)));",
        ].join('\n');

        const exec = new context.ExecuteService(context.mypim);
        const result = await withRetry('pCloud login', () => exec.executeAnonymous({ apexCode }));
        if(!result.success) {
            const messages = (result.diagnostic || []).map(d =>
                result.compiled
                    ? 'Line ' + d.lineNumber + ': ' + d.exceptionMessage
                    : 'Line ' + d.lineNumber + ': ' + d.compileProblem
            ).join('; ');
            throw new Error('pCloud login failed: ' + messages);
        }

        const cvData = await withRetry('pCloud token query', () => context.mypim.query(
            "SELECT Id, ContentDocumentId FROM ContentVersion WHERE Title = '" + logFileName + "' AND IsLatest = true"
        ));
        if(!cvData.records.length) {
            throw new Error('pCloud token ContentVersion not found');
        }

        const cvId = cvData.records[0].Id;
        const cdId = cvData.records[0].ContentDocumentId;

        try {
            const versionData = await withRetry('pCloud token fetch', () => context.mypim.request('/sobjects/ContentVersion/' + cvId + '/VersionData'));
            const accessToken = JSON.parse(versionData);
            if(!accessToken) {
                throw new Error('pCloud token is empty');
            }
            return accessToken;
        }
        finally {
            await withRetry('pCloud token cleanup', () => context.mypim.sobject('ContentDocument').delete(cdId));
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

    return Promise.all([
        context.require('fs'),
        context.require('path'),
        context.require('os'),
        context.require('child_process'),
    ]).then(([ fsMod, pathMod, osMod, cpMod, ]) => {
        const fs = fsMod.default || fsMod;
        const path = pathMod.default || pathMod;
        const os = osMod.default || osMod;
        const cp = cpMod.default || cpMod;

        const pyScript = name => path.join(os.homedir(), 'mypim-codebuilder', 'scripts', name);

        return (async () => {
            const resolvedPath = filePath.replace(/^~(?=$|\/)/, os.homedir());
            if(!fs.existsSync(resolvedPath)) {
                throw new Error('File not found: ' + resolvedPath);
            }
            const fileName = path.basename(resolvedPath, path.extname(resolvedPath));
            cmd.log('Cartoon: ' + fileName);

            // The file is named '<slug>.mp4' (single episode) or '<slug>_<NNN>.mp4'
            // (multi-episode); recover the series slug + tvshows URL for the cover +
            // synopsis. External_Id__c keeps the full fileName so the browser's
            // saved-cartoon detection (which strips the trailing _<NNN>) matches.
            const slugM = /^(.+)_\d+$/.exec(fileName);
            const seriesSlug = slugM ? slugM[1] : fileName;
            const seriesUrl = HENTAIMAMA_BASE + '/tvshows/' + seriesSlug + '/';

            // 1. Fetch the series page (cover + synopsis live there). Best-effort: a
            //    geo-block/404/empty scrape must NOT block the Cartoon record. Retry a
            //    few times; direct first, falling back to remote (compute automation);
            //    when already invoked 'remote' there is no direct path to fall back from.
            let seriesHtml = null;
            let usedRemote = REMOTE;
            const maxAttempts = 3;
            const fetchModes = REMOTE ? [ true, ] : [ false, true, ];
            fetchLoop:
            for(let modeIdx = 0; modeIdx < fetchModes.length; modeIdx++) {
                const useRemote = fetchModes[modeIdx];
                const modeLabel = useRemote ? 'remote' : 'direct';
                const lastMode = modeIdx === fetchModes.length - 1;
                for(let attempt = 1; attempt <= maxAttempts; attempt++) {
                    try {
                        context.ux.action.start('Fetching series page (' + modeLabel + ')');
                        seriesHtml = await hmGetHtml(seriesUrl, { 'User-Agent': USER_AGENT }, useRemote);
                        context.ux.action.stop();
                        if(!seriesHtml || !seriesHtml.trim()) {
                            throw new Error('empty series page');
                        }
                        usedRemote = useRemote;
                        break fetchLoop;
                    }
                    catch(err) {
                        context.ux.action.stop();
                        const pm = err.message || String(err);
                        const lastAttempt = attempt >= maxAttempts;
                        if(lastAttempt && lastMode) {
                            cmd.warn('Series page unavailable after ' + maxAttempts + ' ' + modeLabel + ' attempt(s) (' + pm + '); saving without cover/description.');
                        }
                        else if(lastAttempt) {
                            cmd.log('Series page ' + modeLabel + ' attempts exhausted (' + pm + '); falling back to remote...');
                        }
                        else {
                            cmd.log('Series page ' + modeLabel + ' attempt ' + attempt + '/' + maxAttempts + ' failed (' + pm + '); retrying in ' + RETRY_DELAY_MS + 'ms');
                            await sleep(RETRY_DELAY_MS);
                        }
                    }
                }
            }

            // 2. Parse the synopsis (Description__c) and the poster URL from the series
            //    page, then download + upload the poster to pCloud. Description survives
            //    even if the cover upload fails.
            let description = '';
            let file1 = null;
            let cartoonBaseName = fileName;
            if(seriesHtml) {
                const dM = /<div class="wp-content">([\s\S]*?)<\/div>/i.exec(seriesHtml);
                if(dM) description = decodeEntities(dM[1]);
                cmd.log('Description: ' + (description ? description.length + ' chars' : 'none'));

                // The series poster lives in the header's <div class="poster"> as the
                // img's lazy-loaded data-src (src is a base64 placeholder).
                const posterM = /<div class="poster">[\s\S]*?<img[^>]*\sdata-src="([^"]+)"/i.exec(seriesHtml);
                const coverUrl = posterM ? posterM[1] : '';
                if(coverUrl) {
                    try {
                        cmd.log('Poster: ' + coverUrl);
                        context.ux.action.start('Downloading poster');
                        const { buffer: posterBuffer, contentType: posterContentType } = await hmDownload(coverUrl, { 'User-Agent': USER_AGENT, 'Referer': seriesUrl }, usedRemote);
                        context.ux.action.stop();

                        context.ux.action.start('Logging into pCloud');
                        const accessToken = await getPCloudToken();
                        context.ux.action.stop();

                        await pcloudCreateFolder(PCLOUD_IMAGE_ROOT, accessToken);

                        context.ux.action.start('Uploading poster to pCloud');
                        const posterFilename = fileName + '.jpg';
                        const uploadData = await pcloudUploadFile(PCLOUD_IMAGE_ROOT, posterFilename, posterBuffer, posterContentType, accessToken);
                        const uploaded = uploadData && uploadData.metadata && uploadData.metadata[0];
                        file1 = (uploaded && uploaded.path) || (PCLOUD_IMAGE_ROOT + '/' + posterFilename);
                        // pCloud may sanitize the stored filename; derive the cartoon path
                        // from the actual stored name so Extension__c matches the same rewrite.
                        const coverFilename = (uploaded && uploaded.name) || posterFilename;
                        cartoonBaseName = path.basename(coverFilename, path.extname(coverFilename));
                        context.ux.action.stop();
                        cmd.log('Uploaded poster: ' + file1);
                    }
                    catch(posterErr) {
                        context.ux.action.stop();
                        cmd.warn('Poster unavailable (' + (posterErr.message || String(posterErr)) + '); saving Cartoon without a poster (File_1__c unset).');
                    }
                }
                else {
                    cmd.warn('No poster found on the series page; saving Cartoon without a poster.');
                }
            }

            // 3. Meta — probe duration + resolution from the local file (metaMovie logic).
            cmd.log('Probing metadata...');
            const metaResult = cp.spawnSync('python3', [ pyScript('meta-movie.py'), resolvedPath, ], {
                stdio: [ 'ignore', 'pipe', 'inherit', ],
            });
            if(metaResult.status !== 0) {
                throw new Error('meta-movie.py exited with status ' + metaResult.status);
            }
            let meta;
            try {
                meta = JSON.parse(metaResult.stdout.toString().trim());
            }
            catch(e) {
                throw new Error('Failed to parse meta-movie.py output: ' + e.message);
            }
            const duration = Math.round(Number(meta.duration_seconds));
            const resolution = meta.resolution;
            if(!Number.isFinite(duration) || duration <= 0) {
                throw new Error('Invalid duration_seconds in meta-movie.py output: ' + meta.duration_seconds);
            }
            if(!resolution) {
                throw new Error('Missing resolution in meta-movie.py output');
            }
            cmd.log('Meta: ' + duration + 's, ' + resolution);

            // 4. Create the Cartoon Item__c record (no summary/description-generation step).
            context.ux.action.start('Creating Cartoon record');
            const cartoonFields = {
                Name: truncateForRecordName(fileName),
                External_Id__c: fileName,
                Type__c: 'Cartoon',
                Extension__c: CARTOON_ROOT + '/' + cartoonBaseName + '.mp4',
                Price__c: duration,
                Password__c: resolution,
                Show_In_UI__c: true,
                End_Date__c: new Date().toISOString(),
            };
            if(file1) cartoonFields.File_1__c = file1;
            if(description) cartoonFields.Description__c = description;
            const created = await withRetry('Create Cartoon record', () => context.mypim.sobject('Item__c').create(cartoonFields));
            const recordId = created.id || created.Id;
            if(!recordId) throw new Error('Failed to create Cartoon record');
            context.ux.action.stop();

            // 5. Best-effort cleanup: remove the matching "Done" HentaiMamaQueueItem record.
            //    The queue item is per-series (Name = series slug) while this script runs
            //    per-episode, so the first episode deletes it and later episodes log "no
            //    matching record". The Cartoon is already saved, so this is never fatal.
            try {
                const queueResult = await withRetry('Query queue record', () => context.mypim.query(
                    "SELECT Id FROM Item__c WHERE Type__c = 'CustomData'"
                    + " AND Parent__r.Name = 'HentaiMamaQueueItem'"
                    + " AND Name = '" + soqlEscape(seriesSlug) + "'"
                    + " AND Username__c = 'Done' LIMIT 1"
                ));
                if(queueResult.records.length) {
                    const queueId = queueResult.records[0].Id;
                    await withRetry('Delete queue record', () => context.mypim.sobject('Item__c').delete(queueId));
                    cmd.log('Deleted queue record: ' + queueId);
                }
                else {
                    cmd.log('No matching "Done" HentaiMamaQueueItem record to delete for "' + seriesSlug + '"');
                }
            }
            catch(err) {
                cmd.warn('Queue record cleanup failed (Cartoon was still saved): ' + (err.message || String(err)));
            }

            cmd.logSuccess('Saved "' + fileName + '" — Cartoon ' + recordId + ', poster ' + (file1 || 'none') + ', ' + (description ? 'described, ' : 'no description, ') + duration + 's, ' + resolution);
        })().catch(err => {
            context.ux.action.stop();
            let msg = err.message || String(err);
            if(!REMOTE) {
                msg += '\n(If hentaimama.io is unreachable/geo-blocked, re-run with the "remote" parameter to route hentaimama requests through compute automation.)';
            }
            cmd.error(msg);
        });
    });
})
