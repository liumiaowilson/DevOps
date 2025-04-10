(function(cmd, context) {
    const compName = context.argv[0];
    if(!compName) {
        cmd.error('Component Name(c:cmp) is required');
        return;
    }

    const attrs = {};
    context.argv.slice(1).forEach(arg => {
        const [ key, value ] = arg.split('=');
        attrs[key] = value;
    });

    const compDefinition = {
        componentDef: compName,
        attributes: attrs,
    };
    const encodedCompDef = Buffer.from(JSON.stringify(compDefinition)).toString('base64');

    const url = context.connection.instanceUrl + '/one/one.app#' + encodedCompDef;

    cmd.log(url);
    return url;
})
