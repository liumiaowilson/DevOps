(function(cmd, context) {
    const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    const PCLOUD_ROOT = '/MyPIM/Movie_Image';
    const MOVIE_ROOT = '/MyPIM/Movie';
    const MADOU_BASE = 'https://madou.club';
    const DASH_BASE = 'https://dash.madou.club';
    const MAX_UPLOAD_ATTEMPTS = 3;
    const MAX_DB_ATTEMPTS = 5;
    const RETRY_DELAY_MS = 3000;

    const filePath = context.argv[0];
    if(!filePath) {
        cmd.error('Movie file path is required');
        return;
    }

    // 'remote' as the second script arg routes madou.club/dash.madou.club requests through
    // the compute /automation endpoint (which runs from a non-geo-blocked location), mirroring
    // save_manga.js. pCloud calls and the local python steps always stay local.
    const REMOTE = context.argv[1] === 'remote';

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // The long-running python steps (framing/compare/describe) idle the Salesforce
    // keep-alive socket for minutes, so the mypim calls that follow can land on a
    // half-closed connection. Treat connection-level drops/timeouts as transient.
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

    // ---- Remote fetch helpers (mirrors save_manga.js) ----

    // Run an automation script server-side via the org's /computeAutomation REST resource
    // (ComputeAutomationRestService -> GComputeService.runComputeScript). The compute HTTP
    // callout then originates from Salesforce, not this machine, so it works even where the
    // local network blocks egress to madou.club. doPost returns the serialized
    // {success, result|message} envelope (Apex REST wraps the String body, so it arrives
    // here as a JSON string). Returns the `result` payload.
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

    // Remote GET for HTML pages — returns the response body as a string. Parsing of that
    // HTML still happens locally in node, so only the network hop is offloaded.
    const REMOTE_GET_SCRIPT = `
const axios = require('axios');
(function() {
    return axios.get($data.url, {
        headers: $data.headers,
        timeout: 30000,
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

    // Fetch a madou HTML page, returning the body string. Local axios by default;
    // remote compute automation when invoked with the 'remote' parameter.
    const madouGetHtml = async (url, headers, useRemote = REMOTE) => {
        if(useRemote) {
            return runAutomation(REMOTE_GET_SCRIPT, { url, headers });
        }
        const resp = await context.axios.get(url, { headers, timeout: 30000 });
        return typeof resp.data === 'string' ? resp.data : '';
    };

    // Download a madou image (e.g. the poster). Returns { buffer, contentType }. Local axios
    // by default; remote compute automation when invoked with the 'remote' parameter.
    const madouDownload = async (url, headers, useRemote = REMOTE) => {
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

    // ---- pCloud helpers (mirrors save_manga.js) ----

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
                        // 0 = force overwrite any existing file with the same name (1 would
                        // rename the upload to avoid the collision; we want the cover replaced).
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
            cmd.log('Movie: ' + fileName);

            // 1. Scrape the poster from the madou page -> dash share iframe, download it, and
            //   upload it to pCloud /MyPIM/Movie_Image/<fileName>.jpg. Run this FIRST, before the
            //   minutes-long local python steps, so a geo-block/404/empty-scrape surfaces early
            //   instead of after all that work. This is best-effort: the share page's poster.jpg
            //   can be missing (HTTP 404) or the scrape can come back empty, and a missing poster
            //   must NOT block the Movie record. Retry the whole acquisition a few times for
            //   transient hiccups; if direct keeps failing, fall back to routing through compute
            //   automation ('remote'); if that still fails, skip the poster and leave File_1__c
            //   unset rather than aborting the save. When the run was already invoked in remote
            //   mode there is no direct path to fall back from.
            let file1 = null;
            // Default the movie path to the raw fileName; when a poster IS uploaded, pCloud may
            // rewrite the filename and we re-derive this from the stored name below.
            let movieBaseName = fileName;
            const maxPosterAttempts = 3;
            const posterModes = REMOTE ? [ true, ] : [ false, true, ];
            posterLoop:
            for(let modeIdx = 0; modeIdx < posterModes.length; modeIdx++) {
                const useRemote = posterModes[modeIdx];
                const modeLabel = useRemote ? 'remote' : 'direct';
                const lastMode = modeIdx === posterModes.length - 1;
                for(let posterAttempt = 1; posterAttempt <= maxPosterAttempts; posterAttempt++) {
                    try {
                        // 1a. Scrape the poster image URL from the madou page -> dash share iframe.
                        context.ux.action.start('Fetching madou page (' + modeLabel + ')');
                        const madouUrl = MADOU_BASE + '/' + encodeURIComponent(fileName) + '.html';
                        const pageHtml = await madouGetHtml(madouUrl, { 'User-Agent': USER_AGENT }, useRemote);
                        const shareM = /(https?:)?\/\/dash\.madou\.club\/share\/[a-f0-9]+/i.exec(pageHtml);
                        if(!shareM) {
                            throw new Error('Could not find the video iframe on ' + madouUrl);
                        }
                        let shareUrl = shareM[0];
                        if(shareUrl.startsWith('//')) shareUrl = 'https:' + shareUrl;
                        context.ux.action.stop();
                        cmd.log('Share: ' + shareUrl);

                        context.ux.action.start('Fetching share page (' + modeLabel + ')');
                        const shareHtml = await madouGetHtml(shareUrl, { 'User-Agent': USER_AGENT, 'Referer': madouUrl }, useRemote);
                        // The DPlayer config on the share page carries the poster, e.g. pic: '/videos/<id>/poster.jpg'
                        const picM = /pic:\s*['"]([^'"]+)['"]/i.exec(shareHtml);
                        context.ux.action.stop();
                        if(!picM) {
                            throw new Error('Could not find the poster (pic) on the share page ' + shareUrl);
                        }
                        let posterUrl = picM[1];
                        if(posterUrl.startsWith('//')) posterUrl = 'https:' + posterUrl;
                        else if(posterUrl.startsWith('/')) posterUrl = DASH_BASE + posterUrl;
                        cmd.log('Poster: ' + posterUrl);

                        // 1b. Download the poster and save it to a tmp folder.
                        context.ux.action.start('Downloading poster (' + modeLabel + ')');
                        const { buffer: posterBuffer, contentType: posterContentType } = await madouDownload(posterUrl, { 'User-Agent': USER_AGENT, 'Referer': shareUrl }, useRemote);
                        const localPosterPath = path.join(os.tmpdir(), fileName + '.jpg');
                        fs.writeFileSync(localPosterPath, posterBuffer);
                        context.ux.action.stop();
                        cmd.log('Saved poster locally: ' + localPosterPath);

                        // 1c. Upload the poster to pCloud /MyPIM/Movie_Image/<fileName>.jpg
                        context.ux.action.start('Logging into pCloud');
                        const accessToken = await getPCloudToken();
                        context.ux.action.stop();

                        await pcloudCreateFolder(PCLOUD_ROOT, accessToken);

                        context.ux.action.start('Uploading poster to pCloud');
                        const posterFilename = fileName + '.jpg';
                        const uploadData = await pcloudUploadFile(PCLOUD_ROOT, posterFilename, posterBuffer, posterContentType, accessToken);
                        const uploaded = uploadData && uploadData.metadata && uploadData.metadata[0];
                        file1 = (uploaded && uploaded.path) || (PCLOUD_ROOT + '/' + posterFilename);
                        // pCloud sometimes rewrites the uploaded filename (sanitizing characters);
                        // uploaded.name carries the actual stored name. Derive the movie path from it
                        // so Extension__c matches the same rewrite pCloud applies to the movie file.
                        const coverFilename = (uploaded && uploaded.name) || posterFilename;
                        movieBaseName = path.basename(coverFilename, path.extname(coverFilename));
                        context.ux.action.stop();
                        cmd.log('Uploaded poster: ' + file1);
                        break posterLoop;
                    }
                    catch(posterErr) {
                        context.ux.action.stop();
                        const pm = posterErr.message || String(posterErr);
                        const lastAttempt = posterAttempt >= maxPosterAttempts;
                        if(lastAttempt && lastMode) {
                            cmd.warn('Poster unavailable after ' + maxPosterAttempts + ' ' + modeLabel + ' attempt(s) (' + pm + '); saving Movie without a poster (File_1__c unset).');
                        }
                        else if(lastAttempt) {
                            cmd.log('Poster ' + modeLabel + ' attempts exhausted (' + pm + '); falling back to remote...');
                        }
                        else {
                            cmd.log('Poster ' + modeLabel + ' attempt ' + posterAttempt + '/' + maxPosterAttempts + ' failed (' + pm + '); retrying in ' + RETRY_DELAY_MS + 'ms');
                            await sleep(RETRY_DELAY_MS);
                        }
                    }
                }
            }

            // 2. Meta — probe duration + resolution from the local file (metaMovie logic).
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

            // 3. Summarize — extract frames then build summary.txt (summarizeMovie logic).
            const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'save_madou_movie_'));
            let summary;
            try {
                cmd.log('Extracting frames into ' + framesDir);
                const frameResult = cp.spawnSync('python3', [ pyScript('frame-movie.py'), resolvedPath, framesDir, ], { stdio: 'inherit' });
                if(frameResult.status !== 0) {
                    throw new Error('frame-movie.py exited with status ' + frameResult.status);
                }

                cmd.log('Summarizing frames...');
                const compareResult = cp.spawnSync('python3', [ pyScript('frame-compare.py'), framesDir, ], {
                    stdio: [ 'ignore', 'inherit', 'inherit', ],
                });
                if(compareResult.status !== 0) {
                    throw new Error('frame-compare.py exited with status ' + compareResult.status);
                }

                const summaryPath = path.join(framesDir, 'summary.txt');
                if(!fs.existsSync(summaryPath)) {
                    throw new Error('frame-compare.py did not produce summary.txt');
                }
                summary = fs.readFileSync(summaryPath, 'utf8');
                if(!summary || !summary.trim()) {
                    throw new Error('summary.txt is empty');
                }

                // 4. Describe — condense the summary into a description (describeMovie logic).
                cmd.log('Describing movie...');
                const describeResult = cp.spawnSync('python3', [ pyScript('describe-movie.py'), ], {
                    input: summary,
                    stdio: [ 'pipe', 'pipe', 'inherit', ],
                });
                if(describeResult.status !== 0) {
                    throw new Error('describe-movie.py exited with status ' + describeResult.status);
                }
                var description = describeResult.stdout.toString().trim();
                if(!description) {
                    throw new Error('describe-movie.py returned empty output');
                }
            }
            finally {
                try { fs.rmSync(framesDir, { recursive: true, force: true }); } catch(e) { /* best effort */ }
            }

            // 5. Create the Movie Item__c record with everything populated.
            context.ux.action.start('Creating Movie record');
            const movieFields = {
                Name: truncateForRecordName(fileName),
                External_Id__c: fileName,
                Type__c: 'Movie',
                Extension__c: MOVIE_ROOT + '/' + movieBaseName + '.mp4',
                Text__c: summary,
                Description__c: description,
                Price__c: duration,
                Password__c: resolution,
                Show_In_UI__c: true,
                End_Date__c: new Date().toISOString(),
            };
            // Only set File_1__c when the poster was successfully uploaded; a skipped poster
            // leaves it unset rather than pointing at a pCloud file that was never created.
            if(file1) movieFields.File_1__c = file1;
            const created = await withRetry('Create Movie record', () => context.mypim.sobject('Item__c').create(movieFields));
            const recordId = created.id || created.Id;
            if(!recordId) throw new Error('Failed to create Movie record');
            context.ux.action.stop();

            // 6. Best-effort cleanup: remove the matching "Done" MadouQueueItem record.
            //    The Movie is already saved, so a missing/failed cleanup is logged, not fatal.
            try {
                const queueName = truncateForRecordName(fileName);
                const queueResult = await withRetry('Query queue record', () => context.mypim.query(
                    "SELECT Id FROM Item__c WHERE Type__c = 'CustomData'"
                    + " AND Parent__r.Name = 'MadouQueueItem'"
                    + " AND Name = '" + soqlEscape(queueName) + "'"
                    + " AND Username__c = 'Done' LIMIT 1"
                ));
                if(queueResult.records.length) {
                    const queueId = queueResult.records[0].Id;
                    await withRetry('Delete queue record', () => context.mypim.sobject('Item__c').delete(queueId));
                    cmd.log('Deleted queue record: ' + queueId);
                }
                else {
                    cmd.log('No matching "Done" MadouQueueItem record to delete for "' + queueName + '"');
                }
            }
            catch(err) {
                cmd.warn('Queue record cleanup failed (Movie was still saved): ' + (err.message || String(err)));
            }

            cmd.logSuccess('Saved "' + fileName + '" — Movie ' + recordId + ', poster ' + (file1 || 'none') + ', ' + duration + 's, ' + resolution);
        })().catch(err => {
            context.ux.action.stop();
            let msg = err.message || String(err);
            if(!REMOTE) {
                msg += '\n(If madou.club is unreachable/geo-blocked, re-run with the "remote" parameter to route madou requests through compute automation.)';
            }
            cmd.error(msg);
        });
    });
})
