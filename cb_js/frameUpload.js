(function(cmd, context) {
    const MAX_ATTEMPTS = 5;
    const RETRY_DELAY_MS = 3000;

    const dir = context.argv[0];

    if(!dir) {
        cmd.error('Directory is required');
        return;
    }

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    const updateWithRetry = (record, attempt) => {
        attempt = attempt || 1;
        return context.mypim.update('Item__c', record).catch(err => {
            if(attempt >= MAX_ATTEMPTS) throw err;
            cmd.log('Save failed for ' + record.Id + ' (attempt ' + attempt + '/' + MAX_ATTEMPTS + '): ' + err.message + '; retrying in ' + RETRY_DELAY_MS + 'ms');
            return sleep(RETRY_DELAY_MS).then(() => updateWithRetry(record, attempt + 1));
        });
    };

    return context.require('path').then(({ default: path }) => {
        const metaPath = path.join(dir, 'meta.json');
        const summaryPath = path.join(dir, 'summary.txt');

        context.ux.action.start('Uploading summary');
        return Promise.all([
            context.fs.readFile(metaPath, 'utf8'),
            context.fs.readFile(summaryPath, 'utf8'),
        ]).then(([ metaContent, summaryContent, ]) => {
            const meta = JSON.parse(metaContent);
            const recordId = meta.recordId;

            if(!recordId) {
                cmd.error('meta.json is missing recordId');
                return;
            }
            if(!summaryContent || !summaryContent.trim()) {
                cmd.error('summary.txt is empty');
                return;
            }

            return updateWithRetry({
                Id: recordId,
                Text__c: summaryContent,
            }).then(() => {
                cmd.logSuccess('Uploaded summary to ' + recordId);
            }).catch(err => {
                throw new Error('Upload failed after ' + MAX_ATTEMPTS + ' attempts: ' + err.message);
            });
        }).finally(() => context.ux.action.stop());
    });
})
