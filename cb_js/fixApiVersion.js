(function(cmd, context) {
    const path = context.argv[0];
    if(!path) {
        cmd.error('Source metadata folder is required');
        return;
    }

    const apiVersion = context.argv[1];
    if(!apiVersion) {
        cmd.error('Api version is required');
        return;
    }

    context.ux.action.start('Fixing api version');
    return context.fs.readdir(path).then(files => {
        const xmlFiles = [];
        for(const filename of files) {
            if(filename.endsWith('-meta.xml')) {
                xmlFiles.push(filename);
            }
        }

        return Promise.all(xmlFiles.map(filename => {
            return context.fs.readFile(path + '/' + filename, 'utf8').then(content => {
                const newContent = content.replace(/<apiVersion>([0-9.]+)<\/apiVersion>/g, `<apiVersion>${apiVersion}</apiVersion>`);
                if(newContent !== content) {
                    return context.fs.writeFile(path + '/' + filename, newContent).then(() => {
                        cmd.log(`Updated api version for ${filename}`);
                    });
                }
            });
        }));
    }).finally(() => {
        context.ux.action.stop();
    });
})
