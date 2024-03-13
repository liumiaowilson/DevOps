const iterateRecordTree = (record, fn, cmd, context) => {
    fn(record, cmd, { ...context });

    Object.keys(record).forEach(key => {
        const value = record[key];
        if(value && value.records) {
            value.records.forEach(childRecord => {
                iterateRecordTree(childRecord, fn, cmd, context);
            });
        }
    });
};

(function(cmd, context) {
    const path = context.argv[0];
    if(!path) {
        cmd.error('Path is required');
        return;
    }

    const scriptPath = context.argv[1];
    if(!scriptPath) {
        cmd.error('Script Path is required');
        return;
    }

    const homeDir = context.env.getString('CODE_BUILDER_HOME');

    return Promise.all([
        context.fs.readFile(path, 'utf8'),
        context.fs.readFile(scriptPath, 'utf8'),
    ]).then(([ dataJSON, script ]) => {
        const data = JSON.parse(dataJSON);
        const fn = eval(script);
        data.records.forEach(record => {
            iterateRecordTree(record, fn, cmd, context);
        });
    });
})
