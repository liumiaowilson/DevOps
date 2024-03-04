(function(cmd, context) {
    const srcPath = context.argv[0];
    if(!srcPath) {
        cmd.error('Src Path is required');
        return;
    }

    const destPath = context.argv[1];
    if(!destPath) {
        cmd.error('Dest Path is required');
        return;
    }

    const values = {};
    for(let i = 2; i < argv.length; i++) {
        const idx = argv[i].indexOf('=');
        if(idx < 0) {
            continue;
        }

        values[argv[i].substring(0, idx)] = argv[i].substring(idx + 1);
    }

    return context.fs.readFile(srcPath, 'utf8').then(content => {
        const newContent = content ? content.replace(/\{\{([^}]+)}}/g, (m, p) => values[p] || '') : content;
        return context.fs.writeFile(destPath, newContent).then(() => {
            cmd.logSuccess('Done');
        });
    });
})
