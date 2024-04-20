(function(cmd, context) {
    const path = context.argv[0];
    if(!path) {
        cmd.error('Path is required');
        return;
    }

    context.ux.action.start('Normalizing record');
    return context.fs.readFile(path, 'utf8').then(content => {
        const root = JSON.parse(content);
        cmd.log(JSON.stringify(root, (key, value) => {
            if(value === null) {
                return undefined;
            }

            if(typeof value === 'string') {
                if((value.startsWith('{') && value.endsWith('}')) ||
                    (value.startsWith('[') && value.endsWith(']'))) {
                    try {
                        value = JSON.parse(value);
                    }
                    catch(e) {
                    }
                }
            }

            return value;
        }, 4));

        return root;
    }).finally(() => context.ux.action.stop());
})
