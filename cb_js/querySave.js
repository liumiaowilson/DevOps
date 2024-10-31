(function(cmd, context) {
    const name = context.argv[0];
    if(!name) {
        cmd.error('Name is required');
        return;
    }

    const homeDir = context.env.getString('CODE_BUILDER_HOME');
    context.ux.action.start('Saving query');
    return Promise.all([
        context.fs.readFile(homeDir + '/.saved_queries', 'utf8'),
        context.fs.readFile(homeDir + '/.last_query', 'utf8'),
    ]).then(([ savedQueries, lastQuery ]) => {
        lastQuery = lastQuery.trim();
        const queries = JSON.parse(savedQueries || '{}');
        if(lastQuery) {
            queries[name] = lastQuery;
        }

        return context.fs.writeFile(homeDir + '/.saved_queries', JSON.stringify(queries, null, 4));
    }).finally(() => context.ux.action.stop());
})
