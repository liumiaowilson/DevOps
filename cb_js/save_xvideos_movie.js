(function(cmd, context) {
    const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    const PCLOUD_ROOT = '/MyPIM/Movie_Image';
    const MOVIE_ROOT = '/MyPIM/Movie';
    const XVIDEOS_REFERER = 'https://www.xvideos.com/';
    const QUEUE_CATEGORY_NAME = 'XVideosQueueItem';
    const MAX_UPLOAD_ATTEMPTS = 3;
    const MAX_DB_ATTEMPTS = 5;
    const RETRY_DELAY_MS = 3000;

    const filePath = context.argv[0];
    if(!filePath) {
        cmd.error('Movie file path is required');
        return;
    }

    // 'remote' as the second script arg routes www.xvideos.com requests through the compute
    // /computeAutomation endpoint (which runs from a non-geo-blocked location), mirroring
    // save_madou_movie.js. pCloud calls and the local python steps always stay local.
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

    // ---- Remote fetch helpers (mirrors save_madou_movie.js) ----

    // Run an automation script server-side via the org's /computeAutomation REST resource
    // (ComputeAutomationRestService -> GComputeService.runComputeScript). The compute HTTP
    // callout then originates from Salesforce, not this machine, so it works even where the
    // local network blocks egress to xvideos.com. doPost returns the serialized
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
        maxRedirects: 5,
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
        maxRedirects: 5,
    }).then(resp => ({
        data: Buffer.from(resp.data).toString('base64'),
        contentType: resp.headers['content-type'] || 'application/octet-stream',
    }));
})()
`;

    // Fetch an xvideos HTML page, returning the body string. Local axios by default;
    // remote compute automation when invoked with the 'remote' parameter.
    const xvGetHtml = async (url, headers) => {
        if(REMOTE) {
            return runAutomation(REMOTE_GET_SCRIPT, { url, headers });
        }
        const resp = await context.axios.get(url, { headers, timeout: 30000, maxRedirects: 5 });
        return typeof resp.data === 'string' ? resp.data : '';
    };

    // Download an xvideos image (the poster). Returns { buffer, contentType }. Local axios
    // by default; remote compute automation when invoked with the 'remote' parameter.
    const xvDownload = async (url, headers) => {
        if(REMOTE) {
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
            maxRedirects: 5,
        });
        return {
            buffer: Buffer.from(resp.data),
            contentType: resp.headers['content-type'] || 'image/jpeg',
        };
    };

    // Pull the poster URL from an xvideos watch page. Prefer the 16:9 thumbnail
    // (setThumbUrl169 / og:image), then the standard setThumbUrl, normalizing any
    // protocol-relative or root-relative form to an absolute https URL.
    const extractPosterUrl = html => {
        const setter = name => {
            const m = new RegExp('setThumbUrl' + name + "\\((['\"])([^'\"]+)\\1\\)").exec(html);
            return m ? m[2] : '';
        };
        const og = () => {
            const m = /property="og:image"\s+content="([^"]+)"/i.exec(html)
                || /content="([^"]+)"\s+property="og:image"/i.exec(html);
            return m ? m[1] : '';
        };
        let poster = setter('169') || og() || setter('');
        if(!poster) return '';
        poster = poster.replace(/\\\//g, '/');
        if(poster.startsWith('//')) poster = 'https:' + poster;
        else if(poster.startsWith('/')) poster = 'https://www.xvideos.com' + poster;
        return poster;
    };

    // Decode the handful of HTML entities xvideos titles carry so the stored Name reads
    // naturally (e.g. &amp; -> &, &#39; -> ').
    const decodeEntities = s => String(s)
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#x27;/gi, "'")
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
        .replace(/&nbsp;/g, ' ');

    // Pull the movie title from an xvideos watch page. Prefer html5player.setVideoTitle
    // (the raw title), then og:title, then the <title> tag stripped of its
    // " - XVIDEOS.COM" suffix. Returns '' if none are present.
    const extractTitle = html => {
        let title = '';
        let m = new RegExp("setVideoTitle\\((['\"])([^'\"]*)\\1\\)").exec(html);
        if(m) title = m[2];
        if(!title) {
            m = /property="og:title"\s+content="([^"]+)"/i.exec(html)
                || /content="([^"]+)"\s+property="og:title"/i.exec(html);
            if(m) title = m[1];
        }
        if(!title) {
            m = /<title>([^<]+)<\/title>/i.exec(html);
            if(m) title = m[1].replace(/\s*-\s*XVIDEOS\.COM.*$/i, '');
        }
        return decodeEntities(title).trim();
    };

    // ---- pCloud helpers (mirrors save_madou_movie.js) ----

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
            // The downloaded file is named after the xvideos id (download_xvideos derives
            // the filename from .../video.<id>/<slug>), so fileName is that id.
            const fileName = path.basename(resolvedPath, path.extname(resolvedPath));
            cmd.log('Movie: ' + fileName);

            // 1. Recover the page URL from the queue. The id alone can't rebuild the watch
            //    URL (xvideos requires the slug — an id-only URL 404s), so look up the
            //    XVideosQueueItem CustomData record whose Name matches the filename and read
            //    its Question__c (the full page URL stored when the item was queued).
            const queueName = truncateForRecordName(fileName);
            const queueResult = await withRetry('Query queue record', () => context.mypim.query(
                "SELECT Id, Question__c, Username__c FROM Item__c WHERE Type__c = 'CustomData'"
                + " AND Parent__r.Name = '" + QUEUE_CATEGORY_NAME + "'"
                + " AND Name = '" + soqlEscape(queueName) + "'"
                + " ORDER BY CreatedDate DESC LIMIT 1"
            ));
            if(!queueResult.records.length) {
                throw new Error('No ' + QUEUE_CATEGORY_NAME + " record with Name '" + queueName + "' — cannot recover the page URL");
            }
            const queueRecord = queueResult.records[0];
            const pageUrl = (queueRecord.Question__c || '').trim();
            if(!pageUrl) {
                throw new Error(QUEUE_CATEGORY_NAME + " record '" + queueName + "' has an empty Question__c (page URL)");
            }
            cmd.log('Page: ' + pageUrl);

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
            const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'save_xvideos_movie_'));
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

            // 5. Scrape the poster URL from the xvideos watch page.
            context.ux.action.start('Fetching xvideos page');
            const pageHtml = await xvGetHtml(pageUrl, { 'User-Agent': USER_AGENT, 'Referer': XVIDEOS_REFERER });
            const posterUrl = extractPosterUrl(pageHtml);
            // Record Name comes from the page's movie title (capped at 80), not the id.
            // Fall back to the id only if the page exposes no title at all.
            const movieTitle = extractTitle(pageHtml);
            context.ux.action.stop();
            if(!posterUrl) {
                throw new Error('Could not find the poster (setThumbUrl169 / og:image) on ' + pageUrl);
            }
            cmd.log('Poster: ' + posterUrl);
            const recordName = truncateForRecordName(movieTitle || fileName);
            cmd.log('Title: ' + (movieTitle || '(none found, using id ' + fileName + ')'));

            // 6. Download the poster and save it to a tmp folder.
            context.ux.action.start('Downloading poster');
            const { buffer: posterBuffer, contentType: posterContentType } = await xvDownload(posterUrl, { 'User-Agent': USER_AGENT, 'Referer': pageUrl });
            const localPosterPath = path.join(os.tmpdir(), fileName + '.jpg');
            fs.writeFileSync(localPosterPath, posterBuffer);
            context.ux.action.stop();
            cmd.log('Saved poster locally: ' + localPosterPath);

            // 7. Upload the poster to pCloud /MyPIM/Movie_Image/<fileName>.jpg
            context.ux.action.start('Logging into pCloud');
            const accessToken = await getPCloudToken();
            context.ux.action.stop();

            await pcloudCreateFolder(PCLOUD_ROOT, accessToken);

            context.ux.action.start('Uploading poster to pCloud');
            const posterFilename = fileName + '.jpg';
            const uploadData = await pcloudUploadFile(PCLOUD_ROOT, posterFilename, posterBuffer, posterContentType, accessToken);
            const uploaded = uploadData && uploadData.metadata && uploadData.metadata[0];
            const file1 = (uploaded && uploaded.path) || (PCLOUD_ROOT + '/' + posterFilename);
            // pCloud sometimes rewrites the uploaded filename (sanitizing characters);
            // uploaded.name carries the actual stored name. Derive the movie path from it
            // so Extension__c matches the same rewrite pCloud applies to the movie file.
            const coverFilename = (uploaded && uploaded.name) || posterFilename;
            const movieBaseName = path.basename(coverFilename, path.extname(coverFilename));
            context.ux.action.stop();
            cmd.log('Uploaded poster: ' + file1);

            // 8. Create the Movie Item__c record with everything populated.
            context.ux.action.start('Creating Movie record');
            const created = await withRetry('Create Movie record', () => context.mypim.sobject('Item__c').create({
                Name: recordName,
                External_Id__c: fileName,
                Type__c: 'Movie',
                Extension__c: MOVIE_ROOT + '/' + movieBaseName + '.mp4',
                File_1__c: file1,
                Text__c: summary,
                Description__c: description,
                Price__c: duration,
                Password__c: resolution,
                Show_In_UI__c: true,
                End_Date__c: new Date().toISOString(),
            }));
            const recordId = created.id || created.Id;
            if(!recordId) throw new Error('Failed to create Movie record');
            context.ux.action.stop();

            // 9. Best-effort cleanup: remove the XVideosQueueItem record we matched above.
            //    The Movie is already saved, so a missing/failed cleanup is logged, not fatal.
            try {
                await withRetry('Delete queue record', () => context.mypim.sobject('Item__c').delete(queueRecord.Id));
                cmd.log('Deleted queue record: ' + queueRecord.Id);
            }
            catch(err) {
                cmd.warn('Queue record cleanup failed (Movie was still saved): ' + (err.message || String(err)));
            }

            cmd.logSuccess('Saved "' + fileName + '" — Movie ' + recordId + ', poster ' + file1 + ', ' + duration + 's, ' + resolution);
        })().catch(err => {
            context.ux.action.stop();
            let msg = err.message || String(err);
            if(!REMOTE) {
                msg += '\n(If xvideos.com is unreachable/geo-blocked, re-run with the "remote" parameter to route xvideos requests through compute automation.)';
            }
            cmd.error(msg);
        });
    });
})
