(function(cmd, context) {
    const lwcName = 'TestLwcPOC4921';
    const fileName = lwcName[0].toLowerCase() + lwcName.substring(1);
    const homeDir = context.env.getString('CODE_BUILDER_HOME') + '/';
    const projectName = 'LwcPoc';

    return context.fs.readFile(homeDir + projectName + '/setting.json', 'utf8').then(content => {
        const setting = JSON.parse(content);

        return Promise.all([
            context.fs.readFile(homeDir + projectName + '/lwc/' + fileName + '/' + fileName + '.js', 'utf8'),
            context.fs.readFile(homeDir + projectName + '/lwc/' + fileName + '/' + fileName + '.js-meta.xml', 'utf8'),
            context.fs.readFile(homeDir + projectName + '/lwc/' + fileName + '/' + fileName + '.html', 'utf8'),
            context.fs.readFile(homeDir + projectName + '/lwc/' + fileName + '/' + fileName + '.css', 'utf8'),
            context.fs.readFile(homeDir + projectName + '/payload.json', 'utf8'),
        ]).then(([ lwcJs, lwcMeta, lwcHtml, lwcCss, lwcPayload, ]) => {
            const poc = {
                js: lwcJs,
                meta: lwcMeta,
                html: lwcHtml,
                css: lwcCss,
                payload: lwcPayload,
            };

            if(setting.recordId) {
                return context.mypim.sobject('Item__c').update({
                    Id: setting.recordId,
                    Answer__c: JSON.stringify(poc),
                });
            }
            else {
                return context.mypim.query(`SELECT Id FROM Item__c WHERE Type__c = 'PlainTextCategory' AND Name = 'LwcPOC'`).then(data => {
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
