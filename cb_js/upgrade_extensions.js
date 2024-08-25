(function(cmd, context) {
    const homeDir = context.env.getString('CODE_BUILDER_HOME');
    context.ux.action.start('Upgrading extensions');
    return context.fs.readFile(homeDir + '/.local/share/code-server/extensions/extensions.json', 'utf8').then(content => {
        const def = JSON.parse(content);
        const data = def.reduce((acc, cur) => {
            return {
                ...acc,
                [cur.identifier.id]: cur.version,
            };
        }, {});

        return context.fs.readdir(homeDir + '/.local/share/code-server/User/profiles').then(folders => {
            const profile = folders[0];
            const extensionFilePath = homeDir + '/.local/share/code-server/User/profiles/' + profile + '/extensions.json';
            return context.fs.readFile(extensionFilePath, 'utf8').then(content => {
                const exts = JSON.parse(content);
                exts.forEach(ext => {
                    const id = ext.identifier.id;
                    const oldVersion = ext.version;
                    const newVersion = data[id];
                    if(oldVersion === newVersion) {
                        return;
                    }

                    ext.version = newVersion;
                    ext.relativeLocation = ext.relativeLocation.replace(oldVersion, newVersion);
                    ext.location.path = ext.location.path.replace(oldVersion, newVersion);
                });

                return context.fs.writeFile(extensionFilePath, JSON.stringify(exts, null, 4));
            });
        });
    }).finally(() => context.ux.action.stop());
})
