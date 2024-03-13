(function(cmd, context) {
    const auraName = 'testAuraPOC1542';
    const fileName = auraName;
    const homeDir = context.env.getString('CODE_BUILDER_HOME') + '/';
    const projectName = 'AuraPoc';

    return context.fs.readFile(homeDir + projectName + '/setting.json', 'utf8').then(content => {
        const setting = JSON.parse(content);

        return Promise.all([
            context.fs.readFile(homeDir + projectName + '/aura/' + fileName + '/' + fileName + '.cmp', 'utf8'),
            context.fs.readFile(homeDir + projectName + '/aura/' + fileName + '/' + fileName + '.cmp-meta.xml', 'utf8'),
            context.fs.readFile(homeDir + projectName + '/aura/' + fileName + '/' + fileName + '.css', 'utf8'),
            context.fs.readFile(homeDir + projectName + '/aura/' + fileName + '/' + fileName + '.design', 'utf8'),
            context.fs.readFile(homeDir + projectName + '/aura/' + fileName + '/' + fileName + 'Controller.js', 'utf8'),
            context.fs.readFile(homeDir + projectName + '/aura/' + fileName + '/' + fileName + 'Helper.js', 'utf8'),
            context.fs.readFile(homeDir + projectName + '/payload.json', 'utf8'),
        ]).then(([ auraCmp, auraMeta, auraCss, auraDesign, auraController, auraHelper, auraPayload, ]) => {
            const poc = {
                cmp: auraCmp,
                meta: auraMeta,
                css: auraCss,
                design: auraDesign,
                controller: auraController,
                helper: auraHelper,
                payload: auraPayload,
            };

            if(setting.recordId) {
                return context.mypim.sobject('Item__c').update({
                    Id: setting.recordId,
                    Answer__c: JSON.stringify(poc),
                });
            }
            else {
                return context.mypim.query(`SELECT Id FROM Item__c WHERE Type__c = 'PlainTextCategory' AND Name = 'AuraPOC'`).then(data => {
                    return context.inquirer.prompt({
                        type: 'input',
                        name: 'name',
                        message: 'Name of Poc:',
                    }).then(resp => {
                        return context.mypim.sobject('Item__c').create({
                            Name: resp.name,
                            Type__c: 'PlainText',
                            Parent__c: data.records[0].Id,
                            Answer__c: JSON.stringify(poc),
                        });
                    });
                });
            }
        }).then(() => {
            cmd.logSuccess('Done');
        });
    });
})
