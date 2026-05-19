(function(cmd, context) {
    const path = '/API/ngrok/url';
    return context.mypim.query(
        `SELECT Id, Value__c FROM Config_Item__c WHERE Path__c = '${path}' LIMIT 1`
    ).then(data => {
        const record = data.records && data.records[0];
        if(!record || !record.Value__c) {
            cmd.error(`No Config_Item__c found with Path__c = '${path}' (or Value__c is empty)`);
            return;
        }
        cmd.log(record.Value__c);
    });
})
