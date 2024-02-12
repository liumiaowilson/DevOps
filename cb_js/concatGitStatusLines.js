(function(cmd, context) {
    if(context.argv.length < 1) {
        cmd.error('File path is required');
        return;
    }

    const filePath = context.argv[0];
    const separator = ',';
    return context.fs.readFile(filePath, 'utf8').then(content => {
        const result = content.split('\n').map(line => {
            line = line.trim();
            if(line.startsWith('M ')) {
                return line.substring(2).trim();
            }
            else if(line.startsWith('?? ')) {
                return line.substring(3).trim();
            }
            else {
                return null;
            }
        }).filter(Boolean).join(separator);
        cmd.log(result);
        return result;
    });
})
