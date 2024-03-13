(function(cmd, context) {
    const pageName = 'TestVfPagePOC4735';
    const controllerName = pageName + 'Controller';
    const fileName = pageName[0].toLowerCase() + pageName.substring(1);
    const homeDir = context.env.getString('CODE_BUILDER_HOME') + '/';
    const projectName = 'VfPagePoc';

    return context.fs.readFile(homeDir + projectName + '/setting.json', 'utf8').then(content => {
        const setting = JSON.parse(content);

        return Promise.all([
            context.fs.readFile(homeDir + projectName + '/pages/' + pageName + '.page', 'utf8'),
            context.fs.readFile(homeDir + projectName + '/pages/' + pageName + '.page-meta.xml', 'utf8'),
            context.fs.readFile(homeDir + projectName + '/classes/' + controllerName + '.cls', 'utf8'),
            context.fs.readFile(homeDir + projectName + '/classes/' + controllerName + '.cls-meta.xml', 'utf8'),
        ]).then(([ page, pageMeta, controller, controllerMeta, ]) => {
            const poc = {
                page,
                pageMeta,
                controller,
                controllerMeta,
            };

            if(setting.recordId) {
                return context.mypim.sobject('Item__c').update({
                    Id: setting.recordId,
                    Answer__c: JSON.stringify(poc),
                });
            }
            else {
                return context.mypim.query(`SELECT Id FROM Item__c WHERE Type__c = 'PlainTextCategory' AND Name = 'VfPagePOC'`).then(data => {
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
