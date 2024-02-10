(function(cmd, context) {
    if(context.argv.length < 1) {
        cmd.error('File path is required');
        return;
    }

    const filePath = context.argv[0];
    const separator = context.argv[1] ?? ',';
    return context.fs.readFile(filePath, 'utf8').then(content => {
        const result = content.split('\n').map(line => line.trim()).filter(Boolean).join(separator);
        cmd.log(result);
        return result;
    });
})
