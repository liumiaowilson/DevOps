(function(cmd, context) {
    const path = context.argv[0];
    if(!path) {
        cmd.error('Path is required');
        return;
    }

    const fieldName = context.argv[1];
    if(!fieldName) {
        cmd.error('Field name is required');
        return;
    }

    return context.fs.readFile(path, 'utf8').then(content => {
        const json = JSON.parse(content);
        const fields = json.fields || [];
        const field = fields.find(f => f.name === fieldName);
        if(!field) {
            cmd.error('No such field found');
            return;
        }
        else {
            const result = JSON.stringify(field, null, 4);
            cmd.log(result);
            return result;
        }
    });
})
