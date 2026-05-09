(function(cmd, context) {
    const SOQL = "SELECT Id FROM Item__c WHERE Type__c = 'Movie'";
    const BATCH_SIZE = 200;

    const queryAll = async () => {
        const records = [];
        let result = await context.mypim.query(SOQL);
        records.push(...result.records);
        while(!result.done) {
            result = await context.mypim.queryMore(result.nextRecordsUrl);
            records.push(...result.records);
        }
        return records;
    };

    return (async () => {
        context.ux.action.start('Querying Movie Item__c records');
        const records = await queryAll();
        context.ux.action.stop();

        if(!records.length) {
            cmd.logSuccess('No Movie records found');
            return;
        }

        const updates = records.map(r => ({ Id: r.Id, Show_In_UI__c: false }));

        context.ux.action.start('Updating ' + updates.length + ' records');
        for(let i = 0; i < updates.length; i += BATCH_SIZE) {
            const batch = updates.slice(i, i + BATCH_SIZE);
            await context.mypim.sobject('Item__c').update(batch);
            cmd.log('Updated ' + Math.min(i + BATCH_SIZE, updates.length) + ' / ' + updates.length);
        }
        context.ux.action.stop();

        cmd.logSuccess('Marked ' + updates.length + ' Movie records as unprocessed');
    })().catch(err => {
        context.ux.action.stop();
        cmd.error(err.message || String(err));
    });
})
