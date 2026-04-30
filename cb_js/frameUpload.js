(function(cmd, context) {
    const dir = context.argv[0];

    if(!dir) {
        cmd.error('Directory is required');
        return;
    }

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

            return context.mypim.update('Item__c', {
                Id: recordId,
                Text__c: summaryContent,
            }).then(() => {
                cmd.logSuccess('Uploaded summary to ' + recordId);
            });
        }).finally(() => context.ux.action.stop());
    });
})
