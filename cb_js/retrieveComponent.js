(function(cmd, context) {
    const normalizeName = name => name.replace(/\//g, ' ').replace(/[^a-zA-Z0-9]+/g, '_');

    return context.autocomplete({
        message: 'Which component do you want to retrieve?',
        source: input => {
            if(!input || input.length < 3) return [];

            const query = `FIND {${input}} IN ALL FIELDS RETURNING practifi__Component__c(Id, Name, RecordType.Name)`;
            return context.connection.search(query).then(data => {
                return data.searchRecords.map(r => ({ value: r.Name, description: r.RecordType.Name }));
            });
        },
    }).then(name => {
        if(!name) {
            cmd.error('No component name is selected');
            return;
        }

        return context.connection.query(`SELECT Id, Name, practifi__Code__c, practifi__External_Id__c, practifi__Locked__c, practifi__JSON__c FROM practifi__Component__c WHERE Name = '${name}'`).then(data => {
            if(!data.records.length) {
                cmd.error('No such component found with name: ' + name);
                return;
            }

            const record = data.records[0];
            const componentFilePath = normalizeName(record.Name) + '.json';
            const metaFilePath = normalizeName(record.Name) + '.meta.json';
            const meta = {
                Name: record.Name,
                'practifi__Code__c': record['practifi__Code__c'],
                'practifi__External_Id__c': record['practifi__External_Id__c'],
                'practifi__Locked__c': record['practifi__Locked__c'],
            };
            return Promise.resolve([
                context.fs.writeFile(componentFilePath, JSON.stringify(JSON.parse(record.practifi__JSON__c), null, 4)),
                context.fs.writeFile(metaFilePath, JSON.stringify(meta, null, 4)),
            ]).then(() => {
                cmd.logSuccess('Done. Component retrieved to local: ' + componentFilePath + ' and ' + metaFilePath);
            });
        });
    });
})
