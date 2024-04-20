(function(cmd, context) {
    const query = context.argv.join(' ');

    return context.require('soql-parser-js').then(({ default: soqlParser }) => {
        const ast = soqlParser.parseQuery(query);
        cmd.log(JSON.stringify(ast, null, 4));
    });
})
