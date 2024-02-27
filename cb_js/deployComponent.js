(function(cmd, context) {
    const path = context.argv[0];
    if(!path) {
        cmd.error('File path is required');
        return;
    }

    if(!path.endsWith('.json')) {
        cmd.error('Invalid component json path');
        return;
    }

    const metaPath = path.substring(0, path.length - 5) + '.meta.json';

    return Promise.all([
        context.fs.readFile(path, 'utf8'),
        context.fs.readFile(metaPath, 'utf8'),
    ]).then(([ jsonContent, metaContent ]) => {
        const meta = JSON.parse(metaContent);
        const code = meta['practifi__Code__c'];
        if(!code) {
            cmd.error('No component code can be found');
            return;
        }

        return context.connection.query(`SELECT Id FROM practifi__Component__c WHERE practifi__Code__c = '${code}'`).then(data => {
            if(!data.records.length) {
                cmd.error('No such component with this code found: ' + code);
                return;
            }

            return context.connection.sobject('practifi__Component__c').update({
                Id: data.records[0].Id,
                practifi__Locked__c: false,
                practifi__JSON__c: jsonContent,
            }).then(() => {
                cmd.logSuccess('Done. Click this component record to check: [m://' + data.records[0].Id + ']');
            });
        });
    });
})
