(function(cmd, context) {
    const NOVEL_PARENT_ID = 'a041U00000RutM9QAJ';
    const FIELD_MAX = 131072;
    const CHUNK_MAX = FIELD_MAX * 2;
    const MAX_ATTEMPTS = 5;
    const RETRY_DELAY_MS = 3000;

    const filePath = context.argv[0];

    if(!filePath) {
        cmd.error('File path is required');
        return;
    }

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    const createWithRetry = (record, chunkName, attempt) => {
        attempt = attempt || 1;
        return context.mypim.sobject('Item__c').create(record).catch(err => {
            if(attempt >= MAX_ATTEMPTS) throw err;
            cmd.log('Save failed for ' + chunkName + ' (attempt ' + attempt + '/' + MAX_ATTEMPTS + '): ' + err.message + '; retrying in ' + RETRY_DELAY_MS + 'ms');
            return sleep(RETRY_DELAY_MS).then(() => createWithRetry(record, chunkName, attempt + 1));
        });
    };

    return context.require('path').then(({ default: path }) => {
        const name = path.basename(filePath, path.extname(filePath));

        return context.fs.readFile(filePath, 'utf8').then(content => {
            if(!content || !content.trim()) {
                cmd.error('File is empty');
                return;
            }

            const chunks = [];
            for(let i = 0; i < content.length; i += CHUNK_MAX) {
                chunks.push(content.substring(i, i + CHUNK_MAX));
            }

            context.ux.action.start('Uploading ' + chunks.length + ' chunk(s) for ' + name);

            return chunks.reduce((prev, chunk, n) => prev.then(() => {
                const chunkName = chunks.length === 1 ? name : name + ' (' + (n + 1) + ')';
                context.ux.action.start('Uploading ' + chunkName);
                return createWithRetry({
                    Name: chunkName,
                    Type__c: 'PlainText',
                    Parent__c: NOVEL_PARENT_ID,
                    Question__c: chunk.substring(0, FIELD_MAX),
                    Answer__c: chunk.substring(FIELD_MAX),
                }, chunkName).then(result => {
                    cmd.log('Uploaded ' + chunkName + ' (' + (result.id || result.Id) + ')');
                }).catch(err => {
                    throw new Error('Upload failed at chunk ' + (n + 1) + ' after ' + MAX_ATTEMPTS + ' attempts: ' + err.message);
                });
            }), Promise.resolve()).then(() => {
                cmd.logSuccess('Uploaded ' + chunks.length + ' chunk(s) for ' + name);
            }).finally(() => context.ux.action.stop());
        });
    });
})
