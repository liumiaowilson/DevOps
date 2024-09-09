(function(cmd, context) {
    const folderName = context.argv[0];
    if(!folderName) {
        cmd.error('Folder name is required');
        return;
    }

    const newFolderName = context.argv[1];
    if(!newFolderName) {
        cmd.error('New folder name is required');
        return;
    }

    context.ux.action.start('Cloning folder');
    return context.require('path').then(({ default: path }) => {
        return context.fs.mkdir(newFolderName).then(() => {
            return context.fs.readdir(folderName).then(filenames => {
                return Promise.all(filenames.map(filename => {
                    return context.fs.readFile(`${folderName}/${filename}`, 'utf8').then(content => {
                        const folderBaseName = path.basename(folderName);
                        const newFilename = filename.startsWith(folderBaseName) ? newFolderName + filename.substring(folderBaseName.length) : filename;
                        return context.fs.writeFile(`${newFolderName}/${newFilename}`, content);
                    });
                }));
            });
        });
    }).finally(() => context.ux.action.stop());
})
