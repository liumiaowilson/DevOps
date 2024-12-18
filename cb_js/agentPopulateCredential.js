(function(cmd, context) {
    return context.mypim.query(`SELECT Id, Answer__c FROM Item__c WHERE Type__c = 'File' AND Name = 'ModelApiAgent'`).then(data => {
        const record = data.records[0];
        if(!record) {
            cmd.error('ModelApiAgent file is not found.');
            return;
        }

        const { clientId, clientSecret } = JSON.parse(record.Answer__c);
        context.ux.action.start('Creating Named Credential');
        return context.connection.requestPost('/services/data/v62.0/named-credentials/credential/', {
            "externalCredential": "Agent",
            "principalName": "Agent",
            "principalType": "NamedPrincipal",
            "credentials": {
                "clientId": {
                    "value": clientId,
                    "encrypted": false
                },
                "clientSecret": {
                    "value": clientSecret,
                    "encrypted": true
                }
            }
        }).finally(() => {
            context.ux.action.stop();
        });
    });
})
