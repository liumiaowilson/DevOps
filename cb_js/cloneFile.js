(function(cmd, context) {
    const fileName = context.argv[0];
    if(!fileName) {
        cmd.error('File name is required');
        return;
    }

    const newFileName = context.argv[1];
    if(!newFileName) {
        cmd.error('New file name is required');
        return;
    }

    context.ux.action.start('Cloning file');
    return context.require('path').then(({ default: path }) => {
        const folderName = path.dirname(fileName);

        const [ baseName, ] = path.basename(fileName).split('\.');
        const [ newBaseName, ] = path.basename(newFileName).split('\.');
        return context.fs.readdir(folderName).then(filenames => {
            return Promise.all(filenames.filter(filename => filename.startsWith(baseName + '.')).map(filename => {
                return context.fs.readFile(`${folderName}/${filename}`, 'utf8').then(content => {
                    const idx = filename.indexOf('\.');
                    const suffix = filename.substring(idx + 1);
                    const newFilename = newBaseName + '.' + suffix;
                    return context.fs.writeFile(`${folderName}/${newFilename}`, content);
                });
            }));
        });
    }).finally(() => context.ux.action.stop());
})
