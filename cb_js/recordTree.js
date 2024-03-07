(function(cmd, context) {
    const path = context.argv[0];
    if(!path) {
        cmd.error('Path is required');
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

    return context.require('chalk').then(({ default: chalk }) => {
        return context.fs.readFile(path, 'utf8').then(dataJSON => {
            const data = JSON.parse(dataJSON);
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
})
