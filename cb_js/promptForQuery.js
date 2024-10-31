(function(cmd, context) {
    const homeDir = context.env.getString('CODE_BUILDER_HOME');

    return context.fs.readFile(homeDir + '/.saved_queries', 'utf8').then(content => {
        const queries = JSON.parse(content || '{}');
        return context.autocomplete({
            message: 'Which query to run?',
            source: input => {
                return Object.keys(queries).map(key => ({
                    value: key,
                    description: queries[key],
                })).filter(o => !input || o.value.toLowerCase().includes(input.toLowerCase()) || o.description.toLowerCase().includes(input.toLowerCase()))
                .sort((a, b) => a.value.localeCompare(b.value));
            },
        }).then(name => {
            if(!name) {
                return;
            }

            const query = queries[name];
            return context.fs.writeFile(homeDir + '/.selected_query', query);
        });
    });
})
