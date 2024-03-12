(function(cmd, context) {
    const root = '/home/codebuilder/DevOps/cb_scripts/';
    return context.fs.readdir(root).then(filenames => {
        return Promise.all(filenames.map(filename => {
            return context.fs.readFile(root + filename, 'utf8').then(content => {
                return content.split('\n')
                    .map(line => {
                        if(line.startsWith('#') && !line.startsWith('#!')) {
                            return line.substring(1).trim();
                        }
                    })
                    .filter(Boolean)
                    .join('\n');
            });
        })).then(contents => {
            const result = [];
            contents.forEach(content => {
                if(!content) return;

                try {
                    result.push(JSON.parse(content));
                }
                catch(e) {}
            });

            result.sort((a, b) => a.name.localeCompare(b.name));

            cmd.log(JSON.stringify(result));

            return result;
        });
    });
})
