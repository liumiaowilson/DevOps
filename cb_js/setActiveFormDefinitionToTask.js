(function(cmd, context) {
    const recordId = context.argv[0];
    if(!recordId) {
        cmd.error('Record Id is required');
        return;
    }

    const path = context.argv[1];
    if(!path) {
        cmd.error('Path is required');
        return;
    }

    return context.connection.query(`SELECT Id, practifi__Activity_Configuration__c FROM Task WHERE Id = '${recordId}'`).then(data => {
        if(!data.records.length) {
            cmd.error('No such task found');
            return;
        }

        const acId = data.records[0].practifi__Activity_Configuration__c;

        return context.fs.readFile(path, 'utf8').then(formJSON => {
            return context.connection.sobject('practifi__Activity_Configuration__c').update({
                Id: acId,
                practifi__Form_Definition__c: JSON.stringify(JSON.parse(formJSON)),
            }).then(() => {
                cmd.logSuccess('Done');
            });
        });
    });
})
