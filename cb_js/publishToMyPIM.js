(function(cmd, context) {
    const fileName = context.argv[0];
    if(!fileName) {
        cmd.error('File Name is required');
        return;
    }

    const filePath = context.argv[1];
    if(!filePath) {
        cmd.error('File Path is required');
        return;
    }

    context.ux.action.start('Publish to MyPIM');
    return context.fs.readFile(filePath, 'utf8').then(fileContent => {
        return context.mypim.query(`SELECT Id FROM Item__c WHERE Type__c = 'File' AND Name = '${fileName}'`).then(data => {
            if(data.records.length) {
                return context.mypim.sobject('Item__c').update({
                    Id: data.records[0].Id,
                    Answer__c: fileContent,
                });
            }
            else {
                return context.mypim.sobject('Item__c').create({
                    Name: fileName,
                    Type__c: 'File',
                    Source__c: '/public/' + fileName,
                    Answer__c: fileContent,
                });
                            }
                        });
    }).finally(() => context.ux.action.stop());
})
