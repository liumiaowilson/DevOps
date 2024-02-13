(function(cmd, context) {
    const compName = context.argv[0];
    if(!compName) {
        cmd.error('Component Name(c:cmp) is required');
        return;
    }

    const path = context.argv[1];
    if(!path) {
        cmd.error('Path is required');
        return;
    }

    return context.fs.readFile(path, 'utf8').then(content => {
        const attrs = JSON.parse(content);
        const compDefinition = {
            componentDef: compName,
            attributes: attrs,
        };
        const encodedCompDef = Buffer.from(JSON.stringify(compDefinition)).toString('base64');

        const url = context.connection.instanceUrl + '/one/one.app#' + encodedCompDef;

        cmd.log(url);
        context.open(url);
        return url;
    });
})
