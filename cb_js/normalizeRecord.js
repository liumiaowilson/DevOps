const normalize = data => {
    if(data && typeof data === 'object' && data.constructor === Object) {
        if(data.attributes?.type) {
            Object.keys(data).forEach(key => {
                let value = data[key];
                let parsed = false;
                if(typeof value === 'string' && ((value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']')))) {
                    try {
                        value = JSON.parse(value);
                        parsed = true;
                    }
                    catch(e) {
                    }
                }

                data[key] = value;
                if(!parsed) {
                    normalize(value);
                }
            });
        }
        else {
            Object.keys(data).forEach(key => {
                normalize(data[key]);
            });
        }
    }
    else if(Array.isArray(data)) {
        data.forEach(normalize);
    }
    else {
        return;
    }
};

(function(cmd, context) {
    const path = context.argv[0];
    if(!path) {
        cmd.error('Path is required');
        return;
    }

    context.ux.action.start('Normalizing record');
    return context.fs.readFile(path, 'utf8').then(content => {
        const root = JSON.parse(content);
        normalize(root);
        cmd.log(JSON.stringify(root, (key, value) => {
            if(value === null) {
                return undefined;
            }

            return value;
        }, 4));

        return root;
    }).finally(() => context.ux.action.stop());
})
