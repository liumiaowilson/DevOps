(function(cmd, context) {
    const QUEUE_ITEM_CATEGORY_NAME = 'EHentaiQueueItem';
    const QUEUE_ITEM_PARENT_QUERY =
        "SELECT Id FROM Item__c WHERE Type__c = 'CustomDataCategory' " +
        "AND Name = '" + QUEUE_ITEM_CATEGORY_NAME + "' LIMIT 1";
    const QUEUE_ITEM_QUERY =
        "SELECT Id, Name, Question__c, Answer__c, Text__c FROM Item__c " +
        "WHERE Type__c = 'CustomData' AND Parent__r.Type__c = 'CustomDataCategory' " +
        "AND Parent__r.Name = '" + QUEUE_ITEM_CATEGORY_NAME + "' ORDER BY Name";

    const path = context.require('path');
    const os = context.require('os');
    const outFile = context.argv[0] || path.join(os.homedir(), 'Downloads', 'ehentai_urls.txt');

    return context.mypim.query(QUEUE_ITEM_QUERY).then(data => {
        const rows = (data && data.records) || [];

        // Reassemble the chunked JSON exactly as the LWC does: concatenate the three
        // fields of each row in Name order, then JSON.parse the resulting blob.
        let blob = '';
        for(const r of rows) {
            blob += (r.Question__c || '') + (r.Answer__c || '') + (r.Text__c || '');
        }

        let items = [];
        if(blob) {
            try {
                items = JSON.parse(blob);
            }
            catch(e) {
                cmd.error('Could not parse the EHentaiQueueItem queue: ' + e.message);
                return;
            }
        }
        if(!Array.isArray(items)) items = [];

        // Rebuild gallery URLs the same way handleExportAllAsyncSaves does (no trailing slash).
        const urls = items
            .filter(entry => entry && entry.gallery && entry.gallery.gid && entry.gallery.token)
            .map(entry => 'https://e-hentai.org/g/' + entry.gallery.gid + '/' + entry.gallery.token);

        if(!urls.length) {
            cmd.error('No queued galleries to export');
            return;
        }

        return context.fs.writeFile(outFile, urls.join('\n'), 'utf8').then(() => {
            cmd.logSuccess('Exported ' + urls.length + ' gallery URL(s) to ' + outFile);

            // Delete All — mirror the LWC's empty-queue save: keep the Chunk_00x records,
            // just blank their content (first row holds "[]"). Records are never deleted.
            const updates = rows.map((r, i) => ({
                Id: r.Id,
                Question__c: i === 0 ? '[]' : '',
                Answer__c: '',
                Text__c: '',
            }));
            return context.mypim.sobject('Item__c').update(updates).then(() => {
                cmd.logSuccess('Cleared the Job Manager queue');
            });
        });
    });
})
