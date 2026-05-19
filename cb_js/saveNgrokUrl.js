(function(cmd, context) {
    const url = context.argv[0];
    if(!url) {
        cmd.error('URL is required');
        return;
    }

    const path = '/API/ngrok/url';
    return context.mypim.query(`SELECT Id FROM Config_Item__c WHERE Path__c = '${path}' LIMIT 1`).then(data => {
        if(!data.records || data.records.length === 0) {
            cmd.error(`No Config_Item__c found with Path__c = '${path}'`);
            return;
        }

        return context.mypim.sobject('Config_Item__c').update({
            Id: data.records[0].Id,
            Value__c: url,
        }).then(() => {
            cmd.logSuccess(`Saved ngrok URL to Config_Item__c (${data.records[0].Id})`);
        });
    });
})
