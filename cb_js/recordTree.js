(function(cmd, context) {
    const recordId = context.argv[0];
    if(!recordId) {
        cmd.error('Record Id is required');
        return;
    }

    const getRecordName = record => {
        for(const key of Object.keys(record)) {
            if(key === 'Id') continue;

            const value = record[key];
            if(value && typeof value === 'string') {
                return value;
            }
        }

        return record.Id;
    };

    const buildRecordTree = (record, context, chalk) => {
        const tree = context.ux.tree();

        Object.keys(record).forEach(key => {
            const value = record[key];
            if(value && value.records) {
                for(const childRecord of value.records) {
                    const childTree = buildRecordTree(childRecord, context, chalk);
                    const name = chalk.dim('(' + key + ')') + chalk.green(getRecordName(childRecord)) + '[m://' + childRecord.Id + ']';
                    tree.insert(name, childTree);
                }
            }
        });

        return tree;
    };

    context.ux.action.start('Querying');
    return context.require('chalk').then(({ default: chalk }) => {
        return context.fs.readFile('/home/codebuilder/keyPrefix.json', 'utf8').then(keyPrefixJSON => {
            const prefixMap = JSON.parse(keyPrefixJSON);

            const objectApiName = prefixMap[recordId.substring(0, 3)];
            const queryFile = '/home/codebuilder/DevOps/soql/' + objectApiName + '.soql';

            return context.fs.readFile(queryFile, 'utf8').then(query => {
                query = query.replaceAll('{{recordId}}', recordId);

                return context.connection.query(query).then(data => {
                    const root = context.ux.tree();
                    for(const record of data.records) {
                        const tree = buildRecordTree(record, context, chalk);
                        const name = chalk.green(getRecordName(record)) + '[m://' + record.Id + ']';
                        root.insert(name, tree);
                    }

                    root.display();
                    return data;
                });
            });
        });
    }).finally(() => context.ux.action.stop());
})
