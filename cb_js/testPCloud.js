(function(cmd, context) {
    // Smoke-test the pCloud upload path used by save_mmcg_movie.js: log in, upload a
    // tiny dummy .txt file to /MyPIM/Movie_Image, then delete it. No real data touched.
    const PCLOUD_ROOT = '/MyPIM/Movie_Image';
    const MAX_UPLOAD_ATTEMPTS = 3;
    const MAX_DB_ATTEMPTS = 5;
    const RETRY_DELAY_MS = 3000;

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // The mypim calls can land on a half-closed keep-alive socket; treat connection-level
    // drops/timeouts as transient (verbatim from save_mmcg_movie.js).
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

    // ---- pCloud helpers (mirrors save_mmcg_movie.js) ----

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
                        // 0 = force overwrite any existing file with the same name.
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

    // Delete a single pCloud file by path. result 0 = deleted (mirrors the result-checking
    // of pcloudCreateFolder in save_mmcg_movie.js).
    const pcloudDeleteFile = async (filePath, accessToken) => {
        const resp = await context.axios.get('https://api.pcloud.com/deletefile', {
            params: { access_token: accessToken, path: filePath },
        });
        const data = resp.data;
        if(!data || data.result !== 0) {
            throw new Error((data && data.error) || ('pCloud deletefile error ' + (data && data.result)));
        }
        return data;
    };

    return (async () => {
        const filename = 'testPCloud-' + Date.now() + '.txt';
        const buffer = Buffer.from('pCloud upload smoke test ' + new Date().toISOString() + '\n');

        context.ux.action.start('Logging into pCloud');
        const accessToken = await getPCloudToken();
        context.ux.action.stop();

        context.ux.action.start('Uploading ' + filename + ' to ' + PCLOUD_ROOT);
        const uploadData = await pcloudUploadFile(PCLOUD_ROOT, filename, buffer, 'text/plain', accessToken);
        context.ux.action.stop();
        const uploaded = (uploadData && uploadData.metadata && uploadData.metadata[0]) || null;
        const uploadedPath = (uploaded && uploaded.path) || (PCLOUD_ROOT + '/' + filename);
        cmd.log('Uploaded: ' + uploadedPath);

        context.ux.action.start('Deleting ' + uploadedPath);
        await pcloudDeleteFile(uploadedPath, accessToken);
        context.ux.action.stop();
        cmd.log('Deleted:  ' + uploadedPath);

        cmd.log('pCloud test passed: uploaded and deleted ' + filename);
    })().catch(err => {
        context.ux.action.stop('failed');
        cmd.error('pCloud test failed: ' + (err && err.message || String(err)));
        process.exit(1);
    });
})
