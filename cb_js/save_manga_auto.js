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

        // Keep the URL list and the working-gid list in sync by filtering the queue
        // once and deriving both from the same valid entries.
        const validEntries = items.filter(
            entry => entry && entry.gallery && entry.gallery.gid && entry.gallery.token,
        );

        // Rebuild gallery URLs the same way handleExportAllAsyncSaves does (no trailing slash).
        const urls = validEntries.map(
            entry => 'https://e-hentai.org/g/' + entry.gallery.gid + '/' + entry.gallery.token,
        );

        if(!urls.length) {
            cmd.error('No queued galleries to export');
            return;
        }

        // The gids of everything we're about to save, deduped — these become the
        // browser's "Working URLs" so the Random action skips them while in flight.
        const workingGids = Array.from(
            new Set(validEntries.map(entry => String(entry.gallery.gid))),
        );

        // Replace workingGids in the eHentaiBrowser SystemState record (Type__c =
        // 'SystemState', JSON payload in Answer__c), preserving every other key the
        // LWC persists. Mirrors mypimUtils.saveSystemState's storage shape. If the
        // record doesn't exist yet (browser never persisted state), warn and skip
        // rather than synthesizing a SystemState row.
        const SYSTEM_STATE_QUERY =
            "SELECT Id, Answer__c FROM Item__c " +
            "WHERE Type__c = 'SystemState' AND Name = 'eHentaiBrowser' LIMIT 1";
        const saveWorkingUrls = () => context.mypim.query(SYSTEM_STATE_QUERY).then(stateData => {
            const stateRow = stateData && stateData.records && stateData.records[0];
            if(!stateRow) {
                cmd.warn('No eHentaiBrowser SystemState record found — skipped saving Working URLs');
                return;
            }
            let payload = {};
            if(stateRow.Answer__c) {
                try {
                    payload = JSON.parse(stateRow.Answer__c) || {};
                }
                catch(e) {
                    cmd.warn('Could not parse eHentaiBrowser SystemState — overwriting workingGids only: ' + e.message);
                    payload = {};
                }
            }
            payload.workingGids = workingGids;
            return context.mypim.sobject('Item__c').update({
                Id: stateRow.Id,
                Answer__c: JSON.stringify(payload),
            }).then(() => {
                cmd.logSuccess('Set ' + workingGids.length + ' gallery id(s) as Working URLs');
            });
        });

        return context.fs.writeFile(outFile, urls.join('\n'), 'utf8').then(() => {
            cmd.logSuccess('Exported ' + urls.length + ' gallery URL(s) to ' + outFile);

            // Save Working URLs before the destructive queue clear, so a failure there
            // surfaces while the queue is still intact.
            return saveWorkingUrls().then(() => {
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
    });
})
