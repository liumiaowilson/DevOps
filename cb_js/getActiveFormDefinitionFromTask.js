(function(cmd, context) {
    const recordId = context.argv[0];
    if(!recordId) {
        cmd.error('Record Id is required');
        return;
    }

    return context.connection.query(`SELECT Id, practifi__Activity_Configuration__r.practifi__Form_Definition__c FROM Task WHERE Id = '${recordId}'`).then(data => {
        if(!data.records.length) {
            cmd.error('No such task found');
            return;
        }

        const content = data.records[0]['practifi__Activity_Configuration__r']['practifi__Form_Definition__c'];
        cmd.log(JSON.stringify(JSON.parse(content), null, 4));
    });
})
