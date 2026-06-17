(function(cmd, context) {
    const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    const PCLOUD_ROOT = '/MyPIM/Movie_Image';
    const MOVIE_ROOT = '/MyPIM/Movie';
    const PHUB_REFERER = 'https://www.pornhub.com/';
    // pornhub gates the watch page behind an age disclaimer; without these cookies it
    // serves an interstitial that carries no flashvars (so no poster/title). Mirrors
    // phubResolve.js / mypimPHubBrowser.
    const PHUB_COOKIE = 'accessAgeDisclaimerPH=1; accessAgeDisclaimerUK=1; age_verified=1; platform=pc';
    const QUEUE_CATEGORY_NAME = 'PHubQueueItem';
    const MAX_UPLOAD_ATTEMPTS = 3;
    const MAX_DB_ATTEMPTS = 5;
    const RETRY_DELAY_MS = 3000;

    const filePath = context.argv[0];
    if(!filePath) {
        cmd.error('Movie file path is required');
        return;
    }

    // 'remote' as the second script arg routes www.pornhub.com requests through the compute
    // /computeAutomation endpoint (which runs from a non-geo-blocked location), mirroring
    // save_xvideos_movie.js. pCloud calls and the local python steps always stay local.
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

    // ---- Remote fetch helpers (mirrors save_xvideos_movie.js) ----

    // Run an automation script server-side via the org's /computeAutomation REST resource
    // (ComputeAutomationRestService -> GComputeService.runComputeScript). The compute HTTP
    // callout then originates from Salesforce, not this machine, so it works even where the
    // local network blocks egress to pornhub.com. doPost returns the serialized
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

    // Fetch a pornhub HTML page, returning the body string. Local axios by default;
    // remote compute automation when invoked with the 'remote' parameter.
    const phGetHtml = async (url, headers) => {
        if(REMOTE) {
            return runAutomation(REMOTE_GET_SCRIPT, { url, headers });
        }
        const resp = await context.axios.get(url, { headers, timeout: 30000, maxRedirects: 5 });
        return typeof resp.data === 'string' ? resp.data : '';
    };

    // Download a pornhub image (the poster). Returns { buffer, contentType }. Local axios
    // by default; remote compute automation when invoked with the 'remote' parameter.
    const phDownload = async (url, headers) => {
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

    const cleanUrl = u => (u || '').replace(/\\\//g, '/');

    // Pull the first balanced {...} object after "var flashvars_xxx =" — pornhub's player
    // config blob (carries image_url and video_title). Mirrors phubResolve.js.
    const extractFlashvars = html => {
        const m = /var\s+flashvars_\w+\s*=\s*\{/.exec(html);
        if(!m) return null;
        let i = m.index + m[0].length - 1; // points at the opening brace
        let depth = 0, inStr = false, quote = '', esc = false;
        for(let j = i; j < html.length; j++) {
            const c = html[j];
            if(inStr) {
                if(esc) esc = false;
                else if(c === '\\') esc = true;
                else if(c === quote) inStr = false;
                continue;
            }
            if(c === '"' || c === "'") { inStr = true; quote = c; continue; }
            if(c === '{') depth++;
            else if(c === '}') {
                depth--;
                if(depth === 0) {
                    try { return JSON.parse(html.slice(i, j + 1)); }
                    catch(e) { return null; }
                }
            }
        }
        return null;
    };

    const normalizePoster = poster => {
        if(!poster) return '';
        poster = cleanUrl(poster);
        if(poster.startsWith('//')) poster = 'https:' + poster;
        else if(poster.startsWith('/')) poster = 'https://www.pornhub.com' + poster;
        return poster;
    };

    // Pull the poster URL from a pornhub watch page. Prefer the flashvars image_url
    // (the player's own cover), then thumb, then og:image, normalizing any
    // protocol-relative or root-relative form to an absolute https URL.
    const extractPosterUrl = (html, fv) => {
        if(fv && (fv.image_url || fv.thumb)) {
            const p = normalizePoster(fv.image_url || fv.thumb);
            if(p) return p;
        }
        const m = /property="og:image"\s+content="([^"]+)"/i.exec(html)
            || /content="([^"]+)"\s+property="og:image"/i.exec(html);
        return m ? normalizePoster(m[1]) : '';
    };

    // Decode the handful of HTML entities pornhub titles carry so the stored Name reads
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

    // Pull the movie title from a pornhub watch page. Prefer the flashvars video_title,
    // then og:title, then the <title> tag stripped of its " - Pornhub.com" suffix.
    // Returns '' if none are present.
    const extractTitle = (html, fv) => {
        let title = '';
        if(fv && fv.video_title) title = fv.video_title;
        if(!title) {
            const m = /property="og:title"\s+content="([^"]+)"/i.exec(html)
                || /content="([^"]+)"\s+property="og:title"/i.exec(html);
            if(m) title = m[1];
        }
        if(!title) {
            const m = /<title>([^<]+)<\/title>/i.exec(html);
            if(m) title = m[1].replace(/\s*-\s*Pornhub\.com.*$/i, '');
        }
        return decodeEntities(title).trim();
    };

    // ---- pCloud helpers (mirrors save_xvideos_movie.js) ----

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
            // The downloaded file is named after the pornhub viewkey (download_phub derives
            // the filename from .../view_video.php?viewkey=<key>), so fileName is that viewkey.
            const fileName = path.basename(resolvedPath, path.extname(resolvedPath));
            cmd.log('Movie: ' + fileName);

            // 1. Recover the page URL from the queue. The viewkey alone can't rebuild a usable
            //    watch URL reliably, so look up the PHubQueueItem CustomData record whose Name
            //    matches the filename and read its Question__c (the reference stored when the
            //    item was queued). Normalize that to an absolute view_video URL.
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
            const pageRef = (queueRecord.Question__c || '').trim();
            if(!pageRef) {
                throw new Error(QUEUE_CATEGORY_NAME + " record '" + queueName + "' has an empty Question__c (page URL)");
            }
            // Question__c holds either a full URL, a 'view_video.php?...' path, or a bare
            // viewkey; normalize each to an absolute pornhub URL (mirrors download_phub_auto).
            let pageUrl;
            if(/^https?:\/\//i.test(pageRef)) pageUrl = pageRef;
            else if(/^\/view_video\.php/i.test(pageRef)) pageUrl = 'https://www.pornhub.com' + pageRef;
            else if(/^view_video\.php/i.test(pageRef)) pageUrl = 'https://www.pornhub.com/' + pageRef;
            else if(pageRef.startsWith('/')) pageUrl = 'https://www.pornhub.com' + pageRef;
            else pageUrl = 'https://www.pornhub.com/view_video.php?viewkey=' + pageRef;
            cmd.log('Page: ' + pageUrl);

            // 2. Cover image — scrape the poster URL + title from the pornhub watch page (age-gate
            //    cookies required, else the flashvars/og tags are absent), download it, and upload
            //    it to pCloud /MyPIM/Movie_Image/<fileName>.jpg. Run this FIRST, before the
            //    minutes-long local python steps, so a geo-block/404/empty scrape surfaces early
            //    instead of after all that work. Best-effort: a missing poster must NOT block the
            //    Movie record — on any failure we log a warning, leave File_1__c unset, and still
            //    save the record. The page title (used for the record Name) is captured here too;
            //    if even the page fetch fails we fall back to the viewkey.
            let file1 = null;
            // Default the movie path to the raw fileName; when a poster IS uploaded, pCloud may
            // rewrite the filename and we re-derive this from the stored name below.
            let movieBaseName = fileName;
            // Record Name comes from the page's movie title (capped at 80), not the viewkey;
            // default to the viewkey and overwrite it once we successfully scrape a title.
            let recordName = truncateForRecordName(fileName);
            try {
                // 2a. Scrape the poster URL + title from the pornhub watch page.
                context.ux.action.start('Fetching pornhub page');
                const pageHtml = await phGetHtml(pageUrl, { 'User-Agent': USER_AGENT, 'Referer': PHUB_REFERER, 'Cookie': PHUB_COOKIE });
                const fv = extractFlashvars(pageHtml);
                const posterUrl = extractPosterUrl(pageHtml, fv);
                const movieTitle = extractTitle(pageHtml, fv);
                context.ux.action.stop();
                if(movieTitle) recordName = truncateForRecordName(movieTitle);
                cmd.log('Title: ' + (movieTitle || '(none found, using viewkey ' + fileName + ')'));
                if(!posterUrl) {
                    throw new Error('Could not find the poster (flashvars image_url / og:image) on ' + pageUrl);
                }
                cmd.log('Poster: ' + posterUrl);

                // 2b. Download the poster and save it to a tmp folder.
                context.ux.action.start('Downloading poster');
                const { buffer: posterBuffer, contentType: posterContentType } = await phDownload(posterUrl, { 'User-Agent': USER_AGENT, 'Referer': pageUrl });
                const localPosterPath = path.join(os.tmpdir(), fileName + '.jpg');
                fs.writeFileSync(localPosterPath, posterBuffer);
                context.ux.action.stop();
                cmd.log('Saved poster locally: ' + localPosterPath);

                // 2c. Upload the poster to pCloud /MyPIM/Movie_Image/<fileName>.jpg, force-
                //     overwriting any existing cover with the same name (renameifexists: 0).
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
            }
            catch(posterErr) {
                context.ux.action.stop();
                cmd.warn('Poster unavailable (' + (posterErr.message || String(posterErr)) + '); saving Movie without a poster (File_1__c unset).');
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

            // 4. Summarize — extract frames then build summary.txt (summarizeMovie logic).
            const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'save_phub_movie_'));
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

                // 5. Describe — condense the summary into a description (describeMovie logic).
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

            // 6. Create the Movie Item__c record with everything populated.
            context.ux.action.start('Creating Movie record');
            const movieFields = {
                Name: recordName,
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

            // 7. Best-effort cleanup: remove the PHubQueueItem record we matched above.
            //    The Movie is already saved, so a missing/failed cleanup is logged, not fatal.
            try {
                await withRetry('Delete queue record', () => context.mypim.sobject('Item__c').delete(queueRecord.Id));
                cmd.log('Deleted queue record: ' + queueRecord.Id);
            }
            catch(err) {
                cmd.warn('Queue record cleanup failed (Movie was still saved): ' + (err.message || String(err)));
            }

            cmd.logSuccess('Saved "' + fileName + '" — Movie ' + recordId + ', poster ' + (file1 || 'none') + ', ' + duration + 's, ' + resolution);
        })().catch(err => {
            context.ux.action.stop();
            let msg = err.message || String(err);
            if(!REMOTE) {
                msg += '\n(If pornhub.com is unreachable/geo-blocked, re-run with the "remote" parameter to route pornhub requests through compute automation.)';
            }
            cmd.error(msg);
        });
    });
})
