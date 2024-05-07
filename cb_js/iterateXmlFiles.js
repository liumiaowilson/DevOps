(function(cmd, context) {
    const root = context.argv[0];
    if(!root) {
        cmd.error('Root is required');
        return;
    }

    const scriptPath = context.argv[1];
    if(!scriptPath) {
        cmd.error('Script Path is required');
        return;
    }

    context.ux.action.start('Iterating XML Files');
    return context.fs.readFile(scriptPath, 'utf8').then(script => {
        let fn = null;

        try {
            fn = eval(script);
        }
        catch(e) {
            cmd.error(e);
        }

        return context.require('xml-js').then(({ default: convert }) => {
            return context.fs.readdir(root).then(filenames => {
                return Promise.all(filenames.map(filename => {
                    return context.fs.readFile(root + '/' + filename, 'utf8').then(xml => {
                        const result = convert.xml2json(xml, {compact: true, spaces: 4});
                        const json = JSON.parse(result);
                        fn.apply(null, [ json, cmd, context ]);
                    });
                })).then(() => {
                    cmd.logSuccess('Done');
                });
            });
        });
    }).finally(() => {
        context.ux.action.stop();
    });
})
