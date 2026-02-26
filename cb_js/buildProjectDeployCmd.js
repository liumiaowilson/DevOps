(function(cmd, context) {
    const filePaths = context.argv[0];
    if(!filePaths) {
        cmd.error('Input files are required');
        return;
    }

    const files = filePaths.split(',');
    const cmdStr = 'sf project deploy start -o $alias --ignore-conflicts' + files.map(f => ' -d "' + f + '"').join('');
    cmd.log(cmdStr);
})
