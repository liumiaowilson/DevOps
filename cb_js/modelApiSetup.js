(function(cmd, context) {
    const homeDir = context.env.getString('CODE_BUILDER_HOME');
    const globalOAuthSetFile = homeDir + '/modelApi/extlClntAppGlobalOauthSets/Model_Api_ECA_glbloauth.ecaGlblOauth-meta.xml';

    context.ux.action.start('Setting up Model API');
    return context.fs.readFile(globalOAuthSetFile, 'utf8').then(content => {
        const clientId = 'Model_Api_ECA_' + Date.now();
        let clientSecret = '';

        const lines = content.split('\n');
        lines.forEach(line => {
            line = line.trim();
            if(line.startsWith('<consumerSecret>')) {
                clientSecret = line.replace('<consumerSecret>', '').replace('</consumerSecret>', '').trim();
            }
        });

        content = content.replace('Model_Api_ECA_client_id', clientId);
        return context.fs.writeFile(globalOAuthSetFile, content).then(() => {
            const data = {
                instance_url: context.connection.instanceUrl,
                client_id: clientId,
                client_secret: clientSecret,
            };

            return context.mypim.query(`SELECT Id, Answer__c FROM Item__c WHERE Type__c = 'File' AND Name = 'ModelApiOrg'`) .then(result => {
                let record = result.records[0];
        
                if(!record) {
                    record = {
                        Type__c: 'File',
                        Name: 'ModelApiOrg',
                        Source__c: 'ModelApiOrg',
                        Answer__c: JSON.stringify(data, null, 4),
                    };
        
                    return context.mypim.create('Item__c', record).then(result => result.id);
                }
                else {
                    record.Answer__c = JSON.stringify(data, null, 4);
        
                    return context.mypim.update('Item__c', record).then(result => result.id);
                }
            });
        }).then(() => {
            cmd.log(context.connection.instanceUrl + '/lightning/setup/ManageExternalClientApplication/list');
        });
    }).finally(() => context.ux.action.stop());
})
