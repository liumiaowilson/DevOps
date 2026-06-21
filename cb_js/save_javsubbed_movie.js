(function(cmd, context) {
    const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    const PCLOUD_ROOT = '/MyPIM/Movie_Image';
    const MOVIE_ROOT = '/MyPIM/Movie';
    const HOST = 'https://javsubbed.net/';
    const QUEUE_CATEGORY_NAME = 'JavSubbedQueueItem';
    const MAX_UPLOAD_ATTEMPTS = 3;
    const MAX_DB_ATTEMPTS = 5;
    const MAX_POSTER_ATTEMPTS = 3;
    const RETRY_DELAY_MS = 3000;

    const filePath = context.argv[0];
    if(!filePath) {
        cmd.error('Movie file path is required');
        return;
    }

    // No 'remote' mode: javsubbed.net (and its BunnyCDN poster host) are reachable
    // directly — the LWC only routes through compute automation to sidestep BROWSER
    // CORS, which doesn't apply to this local node fetch. (Mirrors download_javsubbed,
    // which likewise has no remote path, unlike the geo-blocked madou scripts.)

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

    // ---- javsubbed fetch helpers (direct local axios; no remote/compute-automation) ----

    // Fetch a javsubbed HTML page, returning the body string.
    const jsGetHtml = async (url, headers) => {
        const resp = await context.axios.get(url, { headers, timeout: 30000, maxRedirects: 5 });
        return typeof resp.data === 'string' ? resp.data : '';
    };

    // Download a javsubbed image (the poster). Returns { buffer, contentType }.
    const jsDownload = async (url, headers) => {
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

    // Decode the handful of HTML entities javsubbed titles carry (e.g. &amp; -> &,
    // &#8211; -> the en-dash in the <title> suffix) so the stored Name reads naturally.
    const decodeEntities = s => String(s)
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#x27;/gi, "'")
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
        .replace(/&nbsp;/g, ' ');

    // Pull the poster URL from a javsubbed detail page. Prefer og:image, then
    // twitter:image (both point at the BunnyCDN cover), normalizing any
    // protocol-relative or root-relative form to an absolute https URL.
    const extractPosterUrl = html => {
        const m = /property="og:image"\s+content="([^"]+)"/i.exec(html)
            || /content="([^"]+)"\s+property="og:image"/i.exec(html)
            || /name="twitter:image"\s+content="([^"]+)"/i.exec(html)
            || /content="([^"]+)"\s+name="twitter:image"/i.exec(html);
        let poster = m ? m[1] : '';
        if(!poster) return '';
        poster = poster.replace(/\\\//g, '/');
        if(poster.startsWith('//')) poster = 'https:' + poster;
        else if(poster.startsWith('/')) poster = 'https://javsubbed.net' + poster;
        return poster;
    };

    // Pull the movie title from a javsubbed detail page. Prefer og:title (clean), then
    // the <title> tag stripped of its " – JAVSUBBED.net" suffix. Returns '' if none.
    const extractTitle = html => {
        let m = /property="og:title"\s+content="([^"]+)"/i.exec(html)
            || /content="([^"]+)"\s+property="og:title"/i.exec(html);
        let title = m ? m[1] : '';
        if(!title) {
            m = /<title>([^<]+)<\/title>/i.exec(html);
            if(m) title = m[1].replace(/\s*(?:&#8211;|&#x2013;|–|-)\s*JAVSUBBED\.net.*$/i, '');
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
            // download_javsubbed names the output <slug>.mp4, so fileName is the slug —
            // both the detail-page path component and the Movie External_Id__c the
            // browser's Saved badge matches on.
            const fileName = path.basename(resolvedPath, path.extname(resolvedPath));
            cmd.log('Movie: ' + fileName);

            // The detail URL rebuilds straight from the slug (unlike xvideos, which needs
            // the queued page URL); javsubbed slugs are ASCII so encoding is a no-op.
            const detailUrl = HOST + encodeURIComponent(fileName) + '/';
            cmd.log('Page: ' + detailUrl);

            // 1. Cover image — scrape the poster URL + title from the detail page,
            //    download it, and upload it to pCloud /MyPIM/Movie_Image/<fileName>.jpg. Run this
            //    FIRST, before the minutes-long local python steps, so a 404/empty scrape surfaces
            //    early instead of after all that work. Best-effort: a missing poster must NOT block
            //    the Movie record — on failure we log a warning, leave File_1__c unset, and still
            //    save. The page title (used for the record Name) is captured here too; if even the
            //    page fetch fails we fall back to the slug. Retry a few times for transient hiccups.
            let file1 = null;
            // Default the movie path to the raw fileName; when a poster IS uploaded, pCloud may
            // rewrite the filename and we re-derive this from the stored name below.
            let movieBaseName = fileName;
            // Record Name comes from the page's movie title (capped at 80), not the slug; default
            // to the slug and overwrite it once we successfully scrape a title.
            let recordName = truncateForRecordName(fileName);
            for(let posterAttempt = 1; posterAttempt <= MAX_POSTER_ATTEMPTS; posterAttempt++) {
                try {
                    // 1a. Scrape the poster URL + title from the javsubbed detail page.
                    context.ux.action.start('Fetching javsubbed page');
                    const pageHtml = await jsGetHtml(detailUrl, { 'User-Agent': USER_AGENT, 'Referer': HOST });
                    const posterUrl = extractPosterUrl(pageHtml);
                    const movieTitle = extractTitle(pageHtml);
                    context.ux.action.stop();
                    if(movieTitle) recordName = truncateForRecordName(movieTitle);
                    cmd.log('Title: ' + (movieTitle || '(none found, using slug ' + fileName + ')'));
                    if(!posterUrl) {
                        throw new Error('Could not find the poster (og:image / twitter:image) on ' + detailUrl);
                    }
                    cmd.log('Poster: ' + posterUrl);

                    // 1b. Download the poster (BunnyCDN gates on a javsubbed.net Referer) to a tmp folder.
                    context.ux.action.start('Downloading poster');
                    const { buffer: posterBuffer, contentType: posterContentType } = await jsDownload(posterUrl, { 'User-Agent': USER_AGENT, 'Referer': HOST });
                    const localPosterPath = path.join(os.tmpdir(), fileName + '.jpg');
                    fs.writeFileSync(localPosterPath, posterBuffer);
                    context.ux.action.stop();
                    cmd.log('Saved poster locally: ' + localPosterPath);

                    // 1c. Upload the poster to pCloud /MyPIM/Movie_Image/<fileName>.jpg, force-
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
                    break;
                }
                catch(posterErr) {
                    context.ux.action.stop();
                    const pm = posterErr.message || String(posterErr);
                    if(posterAttempt >= MAX_POSTER_ATTEMPTS) {
                        cmd.warn('Poster unavailable after ' + MAX_POSTER_ATTEMPTS + ' attempt(s) (' + pm + '); saving Movie without a poster (File_1__c unset).');
                    }
                    else {
                        cmd.log('Poster attempt ' + posterAttempt + '/' + MAX_POSTER_ATTEMPTS + ' failed (' + pm + '); retrying in ' + RETRY_DELAY_MS + 'ms');
                        await sleep(RETRY_DELAY_MS);
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
            const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'save_javsubbed_movie_'));
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

            // 6. Best-effort cleanup: remove the matching "Done" JavSubbedQueueItem record.
            //    The Movie is already saved, so a missing/failed cleanup is logged, not fatal.
            //    The queue Name is the slug capped at 80, so match on the same truncation.
            try {
                const queueName = truncateForRecordName(fileName);
                const queueResult = await withRetry('Query queue record', () => context.mypim.query(
                    "SELECT Id FROM Item__c WHERE Type__c = 'CustomData'"
                    + " AND Parent__r.Name = '" + QUEUE_CATEGORY_NAME + "'"
                    + " AND Name = '" + soqlEscape(queueName) + "'"
                    + " AND Username__c = 'Done' LIMIT 1"
                ));
                if(queueResult.records.length) {
                    const queueId = queueResult.records[0].Id;
                    await withRetry('Delete queue record', () => context.mypim.sobject('Item__c').delete(queueId));
                    cmd.log('Deleted queue record: ' + queueId);
                }
                else {
                    cmd.log('No matching "Done" ' + QUEUE_CATEGORY_NAME + ' record to delete for "' + queueName + '"');
                }
            }
            catch(err) {
                cmd.warn('Queue record cleanup failed (Movie was still saved): ' + (err.message || String(err)));
            }

            cmd.logSuccess('Saved "' + fileName + '" — Movie ' + recordId + ', poster ' + (file1 || 'none') + ', ' + duration + 's, ' + resolution);
        })().catch(err => {
            context.ux.action.stop();
            cmd.error(err.message || String(err));
        });
    });
})
