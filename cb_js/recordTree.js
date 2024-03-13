(function(cmd, context) {
    const path = context.argv[0];
    if(!path) {
        cmd.error('Path is required');
        return;
    }

    const getRecordName = (record, keyPrefixMap, renderers) => {
        const keyPrefix = record.Id.substring(0, 3);
        const objectApiName = keyPrefixMap[keyPrefix];
        const renderer = renderers[objectApiName];

        if(!renderer) {
            return record.Name;
        }
        else {
            return renderer(record);
        }
    };

    const buildRecordTree = (record, context, chalk, keyPrefixMap, renderers) => {
        const tree = context.ux.tree();

        Object.keys(record).forEach(key => {
            const value = record[key];
            if(value && value.records) {
                for(const childRecord of value.records) {
                    const childTree = buildRecordTree(childRecord, context, chalk, keyPrefixMap, renderers);
                    const name = chalk.dim('(' + key + ')') + chalk.green(getRecordName(childRecord, keyPrefixMap, renderers)) + '[m://' + childRecord.Id + ']';
                    tree.insert(name, childTree);
                }
            }
        });

        return tree;
    };

    const homeDir = context.env.getString('CODE_BUILDER_HOME');

    return context.require('chalk').then(({ default: chalk }) => {
        return Promise.all([
            context.fs.readFile(path, 'utf8'),
            context.fs.readFile(homeDir + '/DevOps/js/recordTree.js', 'utf8'),
            context.fs.readFile(homeDir + '/keyPrefix.json', 'utf8'),
        ]).then(([ dataJSON, renderersScript, keyPrefixJSON ]) => {
            const data = JSON.parse(dataJSON);
            const renderers = eval(renderersScript);
            const keyPrefixMap = JSON.parse(keyPrefixJSON);

            const root = context.ux.tree();
            for(const record of data.records) {
                const tree = buildRecordTree(record, context, chalk, keyPrefixMap, renderers);
                const name = chalk.green(getRecordName(record, keyPrefixMap, renderers)) + '[m://' + record.Id + ']';
                root.insert(name, tree);
            }

            root.display();
            return data;
        });
    });
})
