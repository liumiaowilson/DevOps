(function(cmd, context) {
    const patchFile = '/home/codebuilder/.local/share/sf/client/current/node_modules/@oclif/core/lib/config/ts-node.js';
    context.fs.readFile(patchFile, 'utf8').then(content => {
        const lines = content.split('\n');
        const index = lines.findIndex(line => line.includes('linked ESM module'));
        if(index < 0) return;

        let line1 = lines[index - 1];
        if(!line1.startsWith('// ')) {
            line1 = '// ' + line1;
        }
        lines[index - 1] = line1;

        let line2 = lines[index];
        if(!line2.startsWith('// ')) {
            line2 = '// ' + line2;
        }
        lines[index] = line2;

        content = lines.join('\n');
        return context.fs.writeFile(patchFile, content).then(() => {
            cmd.logSuccess('Done');
        });
    });
})
