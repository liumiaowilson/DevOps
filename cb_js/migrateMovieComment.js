(function(cmd, context) {
    const SOQL = "SELECT Id, Description__c, Question__c FROM Item__c WHERE Type__c = 'Movie'";
    const BATCH_SIZE = 200;

    const isBlank = v => v == null || String(v).trim() === '';

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

        const updates = records.map(r => {
            const comment = !isBlank(r.Description__c) ? r.Description__c : r.Question__c;
            return { Id: r.Id, Question__c: comment, Description__c: null };
        });

        context.ux.action.start('Updating ' + updates.length + ' records');
        for(let i = 0; i < updates.length; i += BATCH_SIZE) {
            const batch = updates.slice(i, i + BATCH_SIZE);
            await context.mypim.sobject('Item__c').update(batch);
            cmd.log('Updated ' + Math.min(i + BATCH_SIZE, updates.length) + ' / ' + updates.length);
        }
        context.ux.action.stop();

        cmd.logSuccess('Migrated comments on ' + updates.length + ' Movie records');
    })().catch(err => {
        context.ux.action.stop();
        cmd.error(err.message || String(err));
    });
})
