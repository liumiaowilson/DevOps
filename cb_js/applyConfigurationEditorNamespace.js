(function(cmd, context) {
    const folderName = context.argv[0];
    if(!folderName) {
        cmd.error('Folder Name is required');
        return;
    }

    const namespace = context.argv[1];
    if(!namespace) {
        cmd.error('Namespace is required');
        return;
    }

    context.ux.action.start('Applying configuration editor namespace');
    return context.fs.readdir(folderName).then(filenames => {
        return Promise.all(filenames.filter(filename => filename.endsWith('.cls')).map(filename => {
            return context.fs.readFile(`${folderName}/${filename}`, 'utf8').then(content => {
                const newContent = content.replace(new RegExp(`configurationEditor='c-`, 'g'), `configurationEditor='${namespace}-`);
                return context.fs.writeFile(`${folderName}/${filename}`, newContent);
            });
        }));
    }).finally(() => context.ux.action.stop());
})
